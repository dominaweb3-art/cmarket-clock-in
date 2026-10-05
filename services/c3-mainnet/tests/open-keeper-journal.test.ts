/** Signed SYNTHETIC public-state fixtures. No validator/network/real wallet. */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { completedCompilerFixture } from "./open-owner-compiler.test.ts";
import {
  compileKeeperFromDurableState,
  type KeeperAction,
} from "../src/open-keeper-compiler.ts";
import { JupiterLegCompiler } from "../src/open-jupiter-compiler.ts";
import {
  OPEN_ROUTE_PROGRAMS,
  type SettlementServerPolicy,
} from "../src/open-leg-factory.ts";
import {
  verifyKeeperEffects,
  verifyKeeperSignedPacket,
  keeperRecoveryDisposition,
  isolatedKeeperJournal,
  productionKeeperJournal,
  KEEPER_JOURNAL_SCHEMA,
  type KeeperEvidence,
  type KeeperManifest,
} from "../src/open-keeper-journal.ts";
import {
  C3_MAINNET as c,
  C3_MAINNET_EXECUTION_CAPABILITY,
} from "../src/constants.ts";
import { APPROVED_OPEN_PRODUCTION_POLICY } from "../src/open-production-policy.ts";
import {
  encodeBase58,
  findProgramAddress,
  publicKeyBytes,
} from "../src/solana.ts";
import {
  openAddresses,
  type OpenAccount,
} from "../src/open-state-semantics.ts";
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest();
const CLOCK = "SysvarC1ock11111111111111111111111111111111";

export async function keeperFixture(
  action: KeeperAction,
  prefund = 0,
  chainNow = 1000,
) {
  const sell = action.includes("sell"),
    create = action.startsWith("create"),
    f = completedCompilerFixture(sell),
    keeper = Keypair.generate(),
    genesis = Keypair.generate().publicKey.toBase58();
  const put = (b: Buffer, o: number, key: string) =>
      Buffer.from(publicKeyBytes(key)).copy(b, o),
    raw = (b: Buffer, owner: string): OpenAccount => ({
      ...f.raw(b, owner),
      lamports: 2000000,
    });
  put(f.cfg, 81, keeper.publicKey.toBase58());
  f.accounts[f.policy.vault] = raw(f.cfg, f.policy.program);
  for (const [addr, account] of Object.entries(f.accounts))
    if (account) f.accounts[addr] = { ...account, lamports: 2000000 };
  const pda = (seed: string) =>
    findProgramAddress(
      [Buffer.from(seed), publicKeyBytes(f.policy.vault)],
      f.policy.program,
    ).address;
  const regAddress = pda("c3-route-reg-v1"),
    qAddress = pda("c3-quote-policy-v1"),
    reg = Buffer.alloc(652),
    q = Buffer.alloc(181),
    quoteAuthority = Keypair.generate().publicKey.toBase58();
  for (const [b, name] of [
    [reg, "RouteProgramRegistry"],
    [q, "QuoteAuthorityPolicy"],
  ] as const) {
    hash("account:" + name).copy(b, 0, 0, 8);
    b[8] = 1;
    put(b, 9, f.policy.vault);
    put(b, 41, f.policy.governance);
    b.writeBigUInt64LE(1n, 73);
    b.writeBigUInt64LE(1n, 81);
    b[121] = 1;
  }
  reg.writeBigUInt64LE(1n, 122);
  reg.writeBigUInt64LE(99999n, 130);
  reg[138] = OPEN_ROUTE_PROGRAMS.length;
  OPEN_ROUTE_PROGRAMS.forEach((k, i) => put(reg, 139 + i * 32, k));
  const registryHash = hash(
    Buffer.concat([
      Buffer.from("c3-route-registry-v1"),
      Buffer.from(publicKeyBytes(f.policy.vault)),
      reg.subarray(81, 89),
      reg.subarray(122, 138),
      Buffer.from([reg[138]!]),
      reg.subarray(139, 139 + reg[138]! * 32),
    ]),
  );
  registryHash.copy(reg, 89);
  put(q, 89, quoteAuthority);
  q.writeBigInt64LE(30n, 122);
  q.writeUInt16LE(100, 130);
  put(q, 132, genesis);
  Buffer.from("C3QUOTESEAL-V1!!").copy(q, 164);
  f.accounts[regAddress] = raw(reg, f.policy.program);
  f.accounts[qAddress] = raw(q, f.policy.program);
  const policy: SettlementServerPolicy = {
    programId: f.policy.program,
    idlHash: f.policy.idlHash,
    configurationHash: f.policy.configurationHash,
    wallet: f.policy.wallet,
    vault: f.policy.vault,
    shareMint: f.policy.shareMint,
    governance: f.policy.governance,
    keeper: keeper.publicKey.toBase58(),
    registry: regAddress,
    registryRevision: "1",
    registryHash: registryHash.toString("hex"),
    quotePolicy: qAddress,
    quotePolicyRevision: "1",
    quoteAuthority,
    maxSlippageBps: 100,
  };
  const clock = Buffer.from(f.accounts[CLOCK]!.data[0]!, "base64");
  clock.writeBigInt64LE(BigInt(chainNow), 32);
  f.accounts[CLOCK] = raw(clock, "Sysvar1111111111111111111111111111111111111");
  const intentName = sell ? f.a.redemption : f.a.deposit,
    planName = sell ? f.a.redemptionPlan : f.a.depositPlan;
  f.intent[113] = 2;
  f.intent.fill(0, sell ? 170 : 224, sell ? 202 : 256);
  if (sell) f.intent.writeBigUInt64LE(0n, 154);
  else {
    f.intent.fill(0, 162, 186);
    f.intent.fill(0, 200, 224);
  }
  f.accounts[intentName] = raw(f.intent, f.policy.program);
  if (create) {
    f.intent.writeBigInt64LE(BigInt(chainNow + 5000), 105);
    f.accounts[intentName] = raw(f.intent, f.policy.program);
    f.accounts[planName] = null;
    f.a.vaultTokens.forEach((addr, i) => {
      const bytes = Buffer.from(f.accounts[addr]!.data[0]!, "base64");
      bytes.writeBigUInt64LE(
        sell
          ? i === 0
            ? 0n
            : f.intent.readBigUInt64LE(122 + (i - 1) * 8)
          : i === 0
            ? 1000000n
            : 0n,
        64,
      );
      f.accounts[addr] = raw(bytes, c.tokenProgram);
    });
  }
  const row = {
    wallet: policy.wallet,
    vault: policy.vault,
    share_mint: policy.shareMint,
    configuration_hash: policy.configurationHash,
    state: create
      ? sell
        ? "redemption_requested"
        : "funded"
      : sell
        ? "selling"
        : "buying",
    db_revision: "12",
    chain_revision: create ? "0" : "3",
    db_now: new Date(chainNow * 1000),
  };
  const legs = [0, 1, 2].map((i) => ({
    ordinal: (sell ? 3 : 0) + i,
    state: "confirmed",
    observed_effects: {
      inputAmount: f.plan.readBigUInt64LE(780 + i * 8).toString(),
      outputAmount: f.plan.readBigUInt64LE(804 + i * 8).toString(),
    },
  }));
  const pool = {
    query: async (sql: string) => ({
      rows: sql.includes("FROM c3_open.legs") ? legs : [row],
    }),
  } as unknown as Pool;
  const rpc = {
    read: async (method: string, params: unknown[]) => {
      if (method === "getGenesisHash") return genesis;
      if (method === "getMultipleAccounts")
        return {
          context: { slot: 100 },
          value: (params[0] as string[]).map((n) => f.accounts[n]),
        };
      if (method === "getAccountInfo") return { value: f.accounts[CLOCK] };
      if (method === "getLatestBlockhash")
        return {
          value: { blockhash: f.context.blockhash, lastValidBlockHeight: 200 },
        };
      if (method === "getMinimumBalanceForRentExemption") return 2000000;
      throw Error("UNEXPECTED_SYNTHETIC_READ");
    },
  };
  const compiler = {
    validateAndBuild: async () => ({
      quotedOutput: 100n,
      slippageBps: 100,
      jupiterThreshold: 98n,
      builderTimestamp: BigInt(chainNow),
      expiresAt: BigInt(chainNow + 30),
      builderSlot: 100n,
      routeHash: hash("synthetic route"),
      instructionHash: hash("synthetic ix"),
      accountMetasHash: hash("synthetic metas"),
      altContentsHash: hash("synthetic alts"),
      unsignedPacketBytes: 900,
    }),
  } as unknown as JupiterLegCompiler;
  const compiled = await compileKeeperFromDurableState(
      pool,
      policy,
      randomUUID(),
      action,
      rpc,
      compiler,
    ),
    manifest: KeeperManifest = {
      ...compiled.manifest,
      genesis,
      planRent: 2000000,
      snapshotAccounts: Object.keys(compiled.manifest.preAccounts),
    },
    signed = VersionedTransaction.deserialize(compiled.packet);
  signed.sign([keeper]);
  const packet = signed.serialize(),
    keys = signed.message.staticAccountKeys.map((k) => k.toBase58()),
    idx = (k: string) => keys.indexOf(k),
    signature = encodeBase58(signed.signatures[0]!);
  const post = structuredClone(manifest.preAccounts) as Record<
    string,
    OpenAccount
  >;
  if (create) {
    const p = Buffer.from(f.plan);
    p[714] = 0;
    p[715] = sell ? 4 : 1;
    p.writeBigUInt64LE(0n, 716);
    p.fill(0, 756, 780);
    p.fill(0, 804, 900);
    p.writeUInt16LE(100, 696);
    p.writeBigInt64LE(BigInt(chainNow), 698);
    p.writeBigInt64LE(BigInt(chainNow + 120), 706);
    manifest.routes.forEach((v, i) =>
      Buffer.from(v, "hex").copy(p, 576 + i * 32),
    );
    manifest.minima.forEach((v, i) =>
      p.writeBigUInt64LE(BigInt(v), 672 + i * 8),
    );
    Buffer.from(manifest.settlementId, "hex").copy(p, 724);
    post[planName] = {
      ...raw(p, f.policy.program),
      lamports: Math.max(prefund, manifest.planRent),
    };
  } else {
    const d = Buffer.from(f.intent);
    d[113] = sell ? 4 : 3;
    Buffer.from(manifest.settlementId, "hex").copy(d, sell ? 170 : 224);
    if (sell) d.writeBigUInt64LE(900000n, 154);
    else
      for (let i = 0; i < 3; i++) {
        d.writeBigUInt64LE(f.plan.readBigUInt64LE(804 + i * 8), 162 + i * 8);
        d.writeBigUInt64LE(f.plan.readBigUInt64LE(780 + i * 8), 200 + i * 8);
      }
    post[intentName] = raw(d, f.policy.program);
  }
  const preBalances = keys.map((k) =>
      k === keeper.publicKey.toBase58()
        ? 100000000
        : k === planName && create
          ? prefund
          : 2000000,
    ),
    rentDelta = create ? Math.max(0, manifest.planRent - prefund) : 0;
  const postBalances = preBalances.map(
    (v, i) =>
      v +
      (i === 0
        ? -5000 - rentDelta
        : create && i === idx(planName)
          ? rentDelta
          : 0),
  );
  const cpi = (
    op: number,
    value?: bigint,
    owner?: string,
    accounts = [idx(planName)],
  ) => {
    const data = Buffer.alloc(
      4 + (value !== undefined ? 8 : 0) + (op === 0 ? 8 : 0) + (owner ? 32 : 0),
    );
    data.writeUInt32LE(op);
    if (value !== undefined) data.writeBigUInt64LE(value, 4);
    if (op === 0) data.writeBigUInt64LE(901n, 12);
    if (owner) put(data, data.length - 32, owner);
    return {
      programIdIndex: idx(c.systemProgram),
      accounts,
      data: encodeBase58(data),
      stackHeight: 2,
    };
  };
  const tokenBalances = create
    ? []
    : f.a.vaultTokens.map((addr, i) => ({
        accountIndex: idx(addr),
        mint: [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint][i],
        owner: f.a.authority,
        programId: c.tokenProgram,
        uiTokenAmount: {
          amount: Buffer.from(post[addr]!.data[0]!, "base64")
            .readBigUInt64LE(64)
            .toString(),
          decimals: [6, 8, 8, 9][i],
        },
      }));
  const meta = {
    err: null,
    fee: 5000,
    preBalances,
    postBalances,
    preTokenBalances: tokenBalances,
    postTokenBalances: structuredClone(tokenBalances),
    innerInstructions: create
      ? [
          {
            index: 0,
            instructions:
              prefund === 0
                ? [cpi(0, 2000000n, policy.programId, [0, idx(planName)])]
                : [
                    ...(rentDelta
                      ? [
                          cpi(2, BigInt(rentDelta), undefined, [
                            0,
                            idx(planName),
                          ]),
                        ]
                      : []),
                    cpi(8, 901n),
                    cpi(1, undefined, policy.programId),
                  ],
          },
        ]
      : [],
  };
  const transaction = {
    slot: 101,
    meta,
    transaction: {
      signatures: [signature],
      message: {
        header: signed.message.header,
        recentBlockhash: signed.message.recentBlockhash,
        accountKeys: keys,
        addressTableLookups: [],
        instructions: signed.message.compiledInstructions.map((i) => ({
          programIdIndex: i.programIdIndex,
          accounts: Array.from(i.accountKeyIndexes),
          data: encodeBase58(i.data),
        })),
      },
    },
  };
  const paired = <T>(v: T) => ({ primary: v, secondary: structuredClone(v) });
  const evidence = {
    genesis: paired(genesis),
    statuses: paired({
      value: [{ slot: 101, err: null, confirmationStatus: "finalized" }],
    }),
    transaction: paired(transaction),
    wire: paired({
      slot: 101,
      meta: structuredClone(meta),
      transaction: [Buffer.from(packet).toString("base64"), "base64"],
    }),
    snapshots: paired({
      context: { slot: 102 },
      value: Object.keys(manifest.preAccounts).map((n) => post[n]!),
    }),
  } satisfies KeeperEvidence;
  return {
    policy,
    manifest,
    unsigned: compiled.packet,
    packet,
    evidence,
    signature,
    pool,
    rpc,
    compiler,
    keeper,
    keys,
  };
}

for (const action of [
  "create_buy_plan",
  "create_sell_plan",
  "record_buy",
  "record_sell",
] as const) {
  test("keeper exact finalized message/state: " + action, async () => {
    const f = await keeperFixture(action);
    assert.equal(
      verifyKeeperEffects(
        f.policy,
        f.manifest,
        f.unsigned,
        f.packet,
        f.evidence,
      ).signature,
      f.signature,
    );
    const mutation = structuredClone(f.evidence);
    mutation.snapshots.primary.context.slot = 100;
    assert.throws(
      () =>
        verifyKeeperEffects(
          f.policy,
          f.manifest,
          f.unsigned,
          f.packet,
          mutation,
        ),
      /SNAPSHOT_BARRIER/,
    );
    mutation.snapshots.primary.context.slot = 102;
    const names = Object.keys(f.manifest.preAccounts),
      index = names.indexOf(f.manifest.onchainIntent),
      bytes = Buffer.from(
        mutation.snapshots.primary.value[index]!.data[0]!,
        "base64",
      );
    bytes[113] = 5;
    mutation.snapshots.primary.value[index] = {
      ...mutation.snapshots.primary.value[index]!,
      data: [bytes.toString("base64"), "base64"],
    };
    mutation.snapshots.secondary = structuredClone(mutation.snapshots.primary);
    assert.throws(
      () =>
        verifyKeeperEffects(
          f.policy,
          f.manifest,
          f.unsigned,
          f.packet,
          mutation,
        ),
      /INTENT_BINDING/,
    );
  });
}
test("keeper late PDA prefunding reconstructs only exact System CPI/rent", async () => {
  for (const amount of [1, 1000000, 5000000]) {
    const f = await keeperFixture("create_buy_plan", amount);
    assert.equal(
      verifyKeeperEffects(
        f.policy,
        f.manifest,
        f.unsigned,
        f.packet,
        f.evidence,
      ).signature,
      f.signature,
    );
  }
});
test("stale keeper recovery never claims closure or releases the barrier", async () => {
  const f = await keeperFixture("create_buy_plan");
  for (const attempted of [false, true]) {
    const disposition = keeperRecoveryDisposition(
      f.manifest,
      f.signature,
      attempted,
      false,
      1200000,
    );
    assert.equal(disposition.state, "STALE_PACKET_BLOCKED");
    assert.equal(disposition.barrierReleased, false);
    assert.equal(disposition.closedUnexecuted, false);
    assert.equal(disposition.replacementAllowed, false);
    assert.equal(disposition.automaticallyResend, false);
    assert.equal(
      disposition.failedOrExpiredClosure,
      "EXPLICIT_FINALIZED_NON_EXECUTION_PROOF_REQUIRED",
    );
  }
  assert.equal(
    keeperRecoveryDisposition(f.manifest, null, false, false, 1000000).state,
    "UNSIGNED_REVIEW_REQUIRED",
  );
  assert.equal(
    keeperRecoveryDisposition(f.manifest, f.signature, false, false, 1000000)
      .state,
    "SIGNED_REVIEW_REQUIRED",
  );
  assert.equal(
    keeperRecoveryDisposition(f.manifest, f.signature, true, false, 1000000)
      .state,
    "SEND_ATTEMPTED_RECONCILE_ONLY",
  );
  const proven = keeperRecoveryDisposition(
    f.manifest,
    f.signature,
    true,
    true,
    1200000,
  );
  assert.equal(proven.state, "FINALIZED_EFFECTS_VERIFIED");
  assert.equal(proven.barrierReleased, true);
});
test("keeper rejects altered message, fake finality, unknown CPI and fee", async () => {
  const f = await keeperFixture("create_buy_plan"),
    modified = VersionedTransaction.deserialize(f.unsigned);
  modified.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
  modified.sign([f.keeper]);
  assert.throws(
    () =>
      verifyKeeperSignedPacket(
        modified.serialize(),
        f.unsigned,
        f.policy.keeper,
      ),
    /SIGNED_MESSAGE/,
  );
  for (const mode of ["fee", "cpi", "finality", "genesis", "token", "quorum"]) {
    const e = structuredClone(f.evidence);
    if (mode === "fee") e.transaction.primary.meta.fee++;
    if (mode === "cpi")
      e.transaction.primary.meta.innerInstructions[0]!.instructions[0]!.data =
        "2";
    if (mode === "finality")
      e.statuses.primary.value[0]!.confirmationStatus = "confirmed";
    if (mode === "genesis") e.genesis.primary = c.genesisHash;
    if (mode === "token")
      e.transaction.primary.meta.preTokenBalances.push(
        {} as (typeof e.transaction.primary.meta.preTokenBalances)[number],
      );
    if (mode !== "quorum") {
      e.transaction.secondary = structuredClone(e.transaction.primary);
      e.wire.primary.meta = structuredClone(e.transaction.primary.meta);
      e.wire.secondary = structuredClone(e.wire.primary);
    } else e.transaction.secondary.slot++;
    assert.throws(
      () => verifyKeeperEffects(f.policy, f.manifest, f.unsigned, f.packet, e),
      /C3_KEEPER_/,
    );
  }
});
test("realistic RPC outer stackHeight metadata cannot hide instruction substitution", async () => {
  const f = await keeperFixture("create_buy_plan");
  for (const stackHeight of [null, 1]) {
    const e = structuredClone(f.evidence);
    for (const tx of [e.transaction.primary, e.transaction.secondary])
      Object.assign(tx.transaction.message.instructions[0]!, { stackHeight });
    assert.ok(
      verifyKeeperEffects(f.policy, f.manifest, f.unsigned, f.packet, e),
    );
  }
  for (const stackHeight of [0, 2, "1"]) {
    const e = structuredClone(f.evidence);
    for (const tx of [e.transaction.primary, e.transaction.secondary])
      Object.assign(tx.transaction.message.instructions[0]!, { stackHeight });
    assert.throws(
      () => verifyKeeperEffects(f.policy, f.manifest, f.unsigned, f.packet, e),
      /JSON_STACK_HEIGHT/,
    );
  }
});
test("source approval and isolated genesis reject before database/network", async () => {
  let reads = 0;
  const pool = {
    query: () => {
      reads++;
      throw Error("DB forbidden");
    },
  } as unknown as Pool;
  assert.equal(C3_MAINNET_EXECUTION_CAPABILITY, false);
  assert.equal(APPROVED_OPEN_PRODUCTION_POLICY, null);
  assert.throws(
    () =>
      productionKeeperJournal(pool, async () => {
        reads++;
        throw Error("network forbidden");
      }),
    /NOT_APPROVED/,
  );
  const f = await keeperFixture("record_buy");
  assert.throws(
    () =>
      isolatedKeeperJournal(pool, f.policy, f.rpc, f.compiler, c.genesisHash, {
        collect: async () => f.evidence,
      }),
    /ISOLATED_MAINNET_FORBIDDEN/,
  );
  assert.equal(reads, 0);
  assert.ok(KEEPER_JOURNAL_SCHEMA.includes("BEFORE UPDATE OR DELETE"));
  assert.equal(
    readFileSync(
      new URL(
        "../pilot-open-local/migrations/0012_keeper_journal.sql",
        import.meta.url,
      ),
      "utf8",
    ).trim(),
    KEEPER_JOURNAL_SCHEMA.trim(),
  );
});

const donationActions = [
  "create_buy_plan",
  "create_sell_plan",
  "record_buy",
  "record_sell",
] as const;
const donationMints = [
  c.usdcMint,
  c.cbBtcMint,
  c.portalEthMint,
  c.wrappedSolMint,
];
type KeeperFixture = Awaited<ReturnType<typeof keeperFixture>>;
function keeperCustody(f: KeeperFixture) {
  return openAddresses({ ...f.policy, program: f.policy.programId })
    .vaultTokens;
}
function changeKeeperSnapshot(
  f: KeeperFixture,
  address: string,
  change: (b: Buffer) => void,
) {
  const index = f.manifest.snapshotAccounts.indexOf(address);
  assert.ok(index >= 0);
  const raw = f.evidence.snapshots.primary.value[index]!;
  const b = Buffer.from(raw.data[0]!, "base64");
  change(b);
  f.evidence.snapshots.primary.value[index] = {
    ...raw,
    data: [b.toString("base64"), "base64"],
  };
}
function synchronizeKeeperEvidence(f: KeeperFixture) {
  f.evidence.transaction.secondary = structuredClone(
    f.evidence.transaction.primary,
  );
  f.evidence.wire.primary.meta = structuredClone(
    f.evidence.transaction.primary.meta,
  );
  f.evidence.wire.secondary = structuredClone(f.evidence.wire.primary);
  f.evidence.snapshots.secondary = structuredClone(
    f.evidence.snapshots.primary,
  );
}
function keeperDonation(
  f: KeeperFixture,
  mintIndex: number,
  window: "prepare/execution" | "execution/snapshot",
) {
  const address = keeperCustody(f)[mintIndex]!;
  changeKeeperSnapshot(f, address, (b) =>
    b.writeBigUInt64LE(b.readBigUInt64LE(64) + 1n, 64),
  );
  if (
    window === "prepare/execution" &&
    f.manifest.action.startsWith("record")
  ) {
    for (const balances of [
      f.evidence.transaction.primary.meta.preTokenBalances,
      f.evidence.transaction.primary.meta.postTokenBalances,
    ]) {
      const entry = balances.find(
        (t) => t.accountIndex === f.keys.indexOf(address),
      )!;
      entry.uiTokenAmount.amount = (
        BigInt(entry.uiTokenAmount.amount) + 1n
      ).toString();
    }
  }
  synchronizeKeeperEvidence(f);
}
function verifyKeeperFixture(f: KeeperFixture) {
  return verifyKeeperEffects(
    f.policy,
    f.manifest,
    f.unsigned,
    f.packet,
    f.evidence,
  );
}

for (const action of donationActions)
  for (const [mintIndex, mint] of donationMints.entries())
    for (const window of ["prepare/execution", "execution/snapshot"] as const)
      test(`keeper ${action}: +1 ${mint} donation at ${window}, no transaction token movement`, async () => {
        const f = await keeperFixture(action);
        const pinned = JSON.stringify(f.manifest);
        keeperDonation(f, mintIndex, window);
        const meta = f.evidence.transaction.primary.meta;
        assert.deepEqual(meta.preTokenBalances, meta.postTokenBalances);
        if (action.startsWith("create"))
          assert.deepEqual(meta.preTokenBalances, []);
        assert.equal(verifyKeeperFixture(f).signature, f.signature);
        assert.equal(JSON.stringify(f.manifest), pinned);
        const address = keeperCustody(f)[mintIndex]!;
        const prepared = Buffer.from(
          f.manifest.preAccounts[address]!.data[0]!,
          "base64",
        );
        const observed = Buffer.from(
          f.evidence.snapshots.primary.value[
            f.manifest.snapshotAccounts.indexOf(address)
          ]!.data[0]!,
          "base64",
        );
        assert.equal(
          observed.readBigUInt64LE(64),
          prepared.readBigUInt64LE(64) + 1n,
        );
        assert.deepEqual(observed.subarray(0, 64), prepared.subarray(0, 64));
        assert.deepEqual(observed.subarray(72), prepared.subarray(72));
      });

for (const action of donationActions)
  test(`keeper ${action}: donations preserve custody metadata and reject removals, movement and inner effects`, async () => {
    const original = await keeperFixture(action);
    for (const [mintIndex] of donationMints.entries()) {
      const donated = {
        ...original,
        evidence: structuredClone(original.evidence),
      };
      keeperDonation(donated, mintIndex, "execution/snapshot");
      assert.equal(verifyKeeperFixture(donated).signature, original.signature);
      const address = keeperCustody(donated)[mintIndex]!;
      for (const defect of [
        "snapshot-removal",
        "missing-account",
        "mint",
        "authority",
        "delegate",
        "delegate-bytes",
        "native-reserve",
        "close-authority",
        "owner-program",
        "executable",
        "lamport-removal",
        "negative-lamports",
        "tx-movement",
        "negative-token",
        "pre-removal",
        "inner",
      ] as const) {
        const f = { ...donated, evidence: structuredClone(donated.evidence) };
        const meta = f.evidence.transaction.primary.meta;
        const prepared = Buffer.from(
          f.manifest.preAccounts[address]!.data[0]!,
          "base64",
        ).readBigUInt64LE(64);
        if (defect === "snapshot-removal") {
          // Unsigned amounts cannot be smaller than zero; positive fixtures
          // prove removals, while zero fixtures are covered by missing-account.
          if (prepared === 0n) continue;
          changeKeeperSnapshot(f, address, (b) =>
            b.writeBigUInt64LE(prepared - 1n, 64),
          );
        } else if (
          [
            "missing-account",
            "owner-program",
            "executable",
            "lamport-removal",
            "negative-lamports",
          ].includes(defect)
        ) {
          const index = f.manifest.snapshotAccounts.indexOf(address);
          const raw = f.evidence.snapshots.primary.value[index]!;
          f.evidence.snapshots.primary.value[index] =
            defect === "missing-account"
              ? (null as unknown as OpenAccount)
              : {
                  ...raw,
                  ...(defect === "owner-program"
                    ? { owner: c.systemProgram }
                    : defect === "executable"
                      ? { executable: true }
                      : {
                          lamports:
                            defect === "negative-lamports"
                              ? -1
                              : raw.lamports! - 1,
                        }),
                };
        } else if (
          defect === "tx-movement" ||
          defect === "negative-token" ||
          defect === "pre-removal"
        ) {
          const before = meta.preTokenBalances.find(
            (t) => t.accountIndex === f.keys.indexOf(address),
          );
          const after = meta.postTokenBalances.find(
            (t) => t.accountIndex === f.keys.indexOf(address),
          );
          if (!before || !after) {
            meta.preTokenBalances.push({
              accountIndex: 0,
              mint: donationMints[mintIndex],
              owner: f.policy.keeper,
              programId: c.tokenProgram,
              uiTokenAmount: {
                amount: "-1",
                decimals: [6, 8, 8, 9][mintIndex],
              },
            });
          } else if (defect === "tx-movement")
            after.uiTokenAmount.amount = (
              BigInt(after.uiTokenAmount.amount) + 1n
            ).toString();
          else if (defect === "negative-token")
            before.uiTokenAmount.amount = after.uiTokenAmount.amount = "-1";
          else {
            if (prepared === 0n) continue;
            before.uiTokenAmount.amount = after.uiTokenAmount.amount = (
              prepared - 1n
            ).toString();
          }
        } else if (defect === "inner") {
          meta.innerInstructions.push({
            index: 0,
            instructions: [
              {
                programIdIndex: f.keys.indexOf(c.tokenProgram),
                accounts: [],
                data: encodeBase58(Buffer.from([8])),
                stackHeight: 2,
              },
            ],
          });
        } else
          changeKeeperSnapshot(f, address, (b) => {
            if (defect === "mint") b[0] = b[0]! ^ 1;
            if (defect === "authority") b[32] = b[32]! ^ 1;
            if (defect === "delegate") b.writeUInt32LE(1, 72);
            if (defect === "delegate-bytes") b[76] = 1;
            if (defect === "native-reserve") b[113] = 1;
            if (defect === "close-authority") b.writeUInt32LE(1, 129);
          });
        synchronizeKeeperEvidence(f);
        assert.throws(
          () => verifyKeeperFixture(f),
          /C3_(KEEPER|OPEN_STATE)_/,
          `${mintIndex}/${defect}`,
        );
      }
    }
  });
