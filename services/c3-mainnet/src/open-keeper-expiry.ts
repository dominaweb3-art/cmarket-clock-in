/** Read-only proof of non-execution. Production callers supply only the fixed
 * two-operator quorum adapter; isolated callers cannot enroll Mainnet approval.
 * Neither wall-clock expiry nor a null signature status alone is sufficient. */
import { createHash } from "node:crypto";
import { VersionedTransaction } from "@solana/web3.js";
import { canonicalize } from "./manifest.ts";
import type { OwnerReadonlyRpc } from "./open-owner-service.ts";
import type { KeeperManifest } from "./open-keeper-journal.ts";
import { encodeBase58 } from "./solana.ts";
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const check = (v: unknown): void => {
  if (!v) throw Error("C3_KEEPER_NON_EXECUTION_NOT_PROVEN");
};
const object = (v: unknown): Record<string, unknown> => {
  check(v && typeof v === "object" && !Array.isArray(v));
  return v as Record<string, unknown>;
};
export async function proveKeeperNonExecution(
  rpc: OwnerReadonlyRpc,
  manifest: KeeperManifest,
  signature: string | null,
  signed: Buffer | null,
) {
  const pair = async (method: string, params: unknown[]) => {
    const result = object(await rpc.read(method, params));
    check(
      Object.hasOwn(result, "primary") && Object.hasOwn(result, "secondary"),
    );
    return [result.primary, result.secondary] as const;
  };
  check(
    (await pair("getGenesisHash", [])).every((v) => v === manifest.genesis),
  );
  check(
    Number.isSafeInteger(manifest.lastValidBlockHeight) &&
      manifest.lastValidBlockHeight > 0,
  );
  const height = await pair("getBlockHeight", [{ commitment: "finalized" }]);
  check(
    height.every(
      (v) =>
        Number.isSafeInteger(v) && Number(v) > manifest.lastValidBlockHeight,
    ),
  );
  const validity = await pair("isBlockhashValid", [
    manifest.blockhash,
    { commitment: "finalized" },
  ]);
  const validitySlots = validity.map((v) => object(object(v).context).slot);
  check(
    validity.every(
      (v, i) =>
        object(v).value === false &&
        Number.isSafeInteger(validitySlots[i]) &&
        Number(validitySlots[i]) >= manifest.slot,
    ),
  );
  // A new finalized barrier AFTER height/invalidity, on BOTH operators.
  const barriers = await pair("getSlot", [{ commitment: "finalized" }]);
  check(
    barriers.every(
      (v, i) =>
        Number.isSafeInteger(v) && Number(v) >= Number(validitySlots[i]),
    ),
  );
  const barrier = Math.max(
    ...barriers.map(Number),
    ...validitySlots.map(Number),
  );
  const names = manifest.snapshotAccounts.filter((n) => n !== CLOCK);
  check(names.length > 0 && new Set(names).size === names.length);
  const snap = await pair("getMultipleAccounts", [
    names,
    {
      commitment: "finalized",
      encoding: "base64",
      minContextSlot: barrier,
    },
  ]);
  const slots = snap.map((v) => object(object(v).context).slot);
  check(
    snap.every(
      (v, i) =>
        Number.isSafeInteger(slots[i]) &&
        Number(slots[i]) >= barrier &&
        Array.isArray(object(v).value) &&
        (object(v).value as unknown[]).length === names.length,
    ),
  );
  const slot = Math.max(...slots.map(Number));
  // Ignore rentEpoch transport metadata, not custody state or lamports. The
  // private prepared snapshot has already undergone config/mint/plan checks.
  const state = (v: unknown) => {
    if (v === null) return null;
    const a = object(v);
    check(
      typeof a.owner === "string" &&
        a.executable === false &&
        Number.isSafeInteger(a.lamports) &&
        Number(a.lamports) >= 0 &&
        Array.isArray(a.data) &&
        a.data.length === 2 &&
        a.data[1] === "base64" &&
        typeof a.data[0] === "string",
    );
    const data = a.data as string[];
    check(Buffer.from(data[0]!, "base64").toString("base64") === data[0]);
    return {
      owner: a.owner,
      executable: a.executable,
      lamports: a.lamports,
      data: a.data,
    };
  };
  for (const response of snap)
    check(
      canonicalize((object(response).value as unknown[]).map(state)) ===
        canonicalize(names.map((n) => state(manifest.preAccounts[n]))),
    );
  let failedEvidence: unknown = null;
  let signatureObservations: unknown = null;
  if (signature !== null) {
    check(signed);
    const packet = VersionedTransaction.deserialize(signed!);
    check(
      packet.signatures.length === 1 &&
        encodeBase58(packet.signatures[0]!) === signature &&
        createHash("sha256")
          .update(packet.message.serialize())
          .digest("hex") === manifest.messageHash,
    );
    const statuses = await pair("getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: true },
    ]);
    check(
      statuses.every(
        (v) =>
          Number.isSafeInteger(object(object(v).context).slot) &&
          Number(object(object(v).context).slot) >= slot &&
          Array.isArray(object(v).value) &&
          (object(v).value as unknown[]).length === 1,
      ) &&
        canonicalize(object(statuses[0]).value) ===
          canonicalize(object(statuses[1]).value),
    );
    const entries = object(statuses[0]).value as unknown[];
    const wires = await pair("getTransaction", [
      signature,
      {
        commitment: "finalized",
        encoding: "base64",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    // Preserve negative evidence too: null is a verified response, not an
    // omitted request. Bind both operators' observations to the durable hash.
    signatureObservations = { statuses, wires };
    if (entries[0] === null) check(wires.every((v) => v === null));
    if (entries[0] !== null) {
      const status = object(entries[0]);
      check(
        status.confirmationStatus === "finalized" &&
          status.err !== null &&
          status.err !== undefined &&
          Number.isSafeInteger(status.slot),
      );
      check(canonicalize(wires[0]) === canonicalize(wires[1]));
      const wire = object(wires[0]);
      const meta = object(wire.meta);
      check(
        wire.slot === status.slot &&
          canonicalize(meta.err) === canonicalize(status.err) &&
          Array.isArray(wire.transaction) &&
          wire.transaction[1] === "base64" &&
          typeof wire.transaction[0] === "string" &&
          Buffer.from(wire.transaction[0], "base64").equals(signed!),
      );
      check(
        Array.isArray(meta.preTokenBalances) &&
          Array.isArray(meta.postTokenBalances) &&
          canonicalize(meta.preTokenBalances) ===
            canonicalize(meta.postTokenBalances) &&
          Number.isSafeInteger(meta.fee) &&
          Number(meta.fee) > 0 &&
          Array.isArray(meta.preBalances) &&
          Array.isArray(meta.postBalances),
      );
      const pre = meta.preBalances as number[],
        post = meta.postBalances as number[];
      check(
        pre.length === packet.message.staticAccountKeys.length &&
          post.length === pre.length &&
          pre.every(
            (v, i) =>
              Number.isSafeInteger(v) &&
              v >= 0 &&
              Number.isSafeInteger(post[i]) &&
              post[i]! >= 0 &&
              v - post[i]! === (i === 0 ? meta.fee : 0),
          ),
      );
      failedEvidence = { statuses, wire };
    }
  } else check(signed === null);
  return Object.freeze({
    finalizedSlot: Number(slot),
    evidenceHash: createHash("sha256")
      .update(
        canonicalize({
          manifestHash: createHash("sha256")
            .update(canonicalize(manifest))
            .digest("hex"),
          height,
          validity,
          barriers,
          snap,
          signature,
          signatureObservations,
          failedEvidence,
        }),
      )
      .digest("hex"),
    outcome: failedEvidence
      ? ("FAILED_FINALIZED" as const)
      : ("EXPIRED_UNEXECUTED" as const),
  });
}
