/** SYNTHETIC expiry evidence; no wallet or network. Actual PG CAS is separate. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { keeperFixture } from "./open-keeper-journal.test.ts";
import { proveKeeperNonExecution } from "../src/open-keeper-expiry.ts";
export async function keeperExpiryFixture(chainNow = 1000) {
  const f = await keeperFixture("create_buy_plan", 0, chainNow);
  const manifest = f.manifest;
  const data: Record<string, unknown> = {
    getGenesisHash: manifest.genesis,
    getBlockHeight: manifest.lastValidBlockHeight + 1,
    getSlot: 201,
    isBlockhashValid: { context: { slot: 200 }, value: false },
    getMultipleAccounts: {
      context: { slot: 201 },
      value: manifest.snapshotAccounts
        .filter((n) => n !== "SysvarC1ock11111111111111111111111111111111")
        .map((n) => structuredClone(manifest.preAccounts[n])),
    },
    getSignatureStatuses: { context: { slot: 202 }, value: [null] },
    getTransaction: null,
  };
  const rpc = {
    read: async (method: string) => {
      if (!Object.hasOwn(data, method)) throw Error("UNEXPECTED_READ");
      return data[method];
    },
  };
  const pairRpc = {
    read: async (method: string) => ({
      primary: await rpc.read(method),
      secondary: structuredClone(await rpc.read(method)),
    }),
  };
  return { ...f, data, rpc, pairRpc, compilerRpc: f.rpc, signed: f.packet };
}
test("expired keeper needs invalid blockhash AND unchanged finalized custody; uncertain signature retained", async () => {
  const f = await keeperExpiryFixture();
  const before = Buffer.from(f.signed);
  const proof = await proveKeeperNonExecution(
    f.pairRpc,
    f.manifest,
    f.signature,
    Buffer.from(f.signed),
  );
  assert.equal(proof.outcome, "EXPIRED_UNEXECUTED");
  assert.equal(proof.finalizedSlot, 201);
  assert.match(proof.evidenceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(Buffer.from(f.signed), before);
  assert.equal(
    (await proveKeeperNonExecution(f.pairRpc, f.manifest, null, null)).outcome,
    "EXPIRED_UNEXECUTED",
  );
});
test("clock alone, disagreement, successful/processed signature, changed state, missing evidence and substituted wire fail", async () => {
  for (const mode of [
    "height",
    "valid",
    "slot",
    "genesis",
    "missing",
    "inventory",
    "success",
    "processed",
    "status-slot",
    "packet",
  ] as const) {
    const f = await keeperExpiryFixture();
    const snap = f.data.getMultipleAccounts as {
      context: { slot: number };
      value: (Record<string, unknown> | null)[];
    };
    const status = f.data.getSignatureStatuses as {
      context: { slot: number };
      value: unknown[];
    };
    switch (mode) {
      case "height":
        f.data.getBlockHeight = f.manifest.lastValidBlockHeight;
        break;
      case "valid":
        (f.data.isBlockhashValid as { value: boolean }).value = true;
        break;
      case "slot":
        snap.context.slot = 1;
        break;
      case "genesis":
        f.data.getGenesisHash = "wrong";
        break;
      case "missing":
        snap.value.pop();
        break;
      case "inventory":
        snap.value[0]!.lamports = 1;
        break;
      case "success":
        status.value[0] = {
          confirmationStatus: "finalized",
          err: null,
          slot: 200,
        };
        break;
      case "processed":
        status.value[0] = {
          confirmationStatus: "processed",
          err: { InstructionError: [0, 1] },
          slot: 200,
        };
        break;
      case "status-slot":
        status.context.slot = 1;
        break;
      case "packet":
        break;
    }
    const packet = Buffer.from(f.signed);
    if (mode === "packet") packet[70] = packet[70]! ^ 1;
    await assert.rejects(
      proveKeeperNonExecution(f.pairRpc, f.manifest, f.signature, packet),
      /NON_EXECUTION_NOT_PROVEN/,
    );
  }
});
test("finalized failed keeper proof permits fees only, not funds or signature substitution", async () => {
  const f = await keeperExpiryFixture();
  const err = { InstructionError: [0, { Custom: 42 }] };
  f.data.getSignatureStatuses = {
    context: { slot: 202 },
    value: [{ confirmationStatus: "finalized", err, slot: 200 }],
  };
  const pre = f.evidence.transaction.primary.meta.preBalances;
  const wire = {
    slot: 200,
    transaction: [Buffer.from(f.signed).toString("base64"), "base64"],
    meta: {
      err,
      fee: 5000,
      preBalances: pre,
      postBalances: pre.map((v, i) => v - (i === 0 ? 5000 : 0)),
      preTokenBalances: [],
      postTokenBalances: [],
    },
  };
  f.data.getTransaction = wire;
  assert.equal(
    (
      await proveKeeperNonExecution(
        f.pairRpc,
        f.manifest,
        f.signature,
        Buffer.from(f.signed),
      )
    ).outcome,
    "FAILED_FINALIZED",
  );
  wire.meta.postBalances[1]!--;
  await assert.rejects(
    proveKeeperNonExecution(
      f.pairRpc,
      f.manifest,
      f.signature,
      Buffer.from(f.signed),
    ),
    /NON_EXECUTION_NOT_PROVEN/,
  );
});

test("negative evidence from BOTH operators is required, including transaction absence and post-expiry barrier", async () => {
  for (const mode of [
    "transaction-present",
    "secondary-snapshot-old",
    "secondary-status-old",
    "secondary-valid",
    "secondary-height",
    "secondary-genesis",
    "secondary-slot-old",
  ] as const) {
    const f = await keeperExpiryFixture();
    const pairRpc = {
      read: async (method: string) => {
        const a = structuredClone(await f.rpc.read(method));
        let b = structuredClone(a);
        if (mode === "transaction-present" && method === "getTransaction")
          b = { slot: 201, meta: { err: null } };
        if (
          mode === "secondary-snapshot-old" &&
          method === "getMultipleAccounts"
        )
          (b as { context: { slot: number } }).context.slot = 200;
        if (
          mode === "secondary-status-old" &&
          method === "getSignatureStatuses"
        )
          (b as { context: { slot: number } }).context.slot = 200;
        if (mode === "secondary-valid" && method === "isBlockhashValid")
          (b as { value: boolean }).value = true;
        if (mode === "secondary-height" && method === "getBlockHeight")
          b = f.manifest.lastValidBlockHeight;
        if (mode === "secondary-genesis" && method === "getGenesisHash")
          b = "wrong";
        if (mode === "secondary-slot-old" && method === "getSlot") b = 199;
        return { primary: a, secondary: b };
      },
    };
    await assert.rejects(
      proveKeeperNonExecution(
        pairRpc,
        f.manifest,
        f.signature,
        Buffer.from(f.signed),
      ),
      /NON_EXECUTION_NOT_PROVEN/,
    );
  }
});
