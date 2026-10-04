/** Synthetic raw public accounts + read-only ports. No PG, network or keys. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { C3_MAINNET as c } from "../src/constants.ts";
import { C3_MAINNET_ASSET_REGISTRY as registry } from "../src/registry.ts";
import {
  encodeBase58,
  publicKeyBytes,
  findProgramAddress,
} from "../src/solana.ts";
import { canonicalize } from "../src/manifest.ts";
import {
  openAddresses,
  SHARE_TOKEN_PROGRAM,
  type OpenAccount,
} from "../src/open-state-semantics.ts";
import { VAULT_PROGRAM } from "../src/open-v0-envelope.ts";
import type { OpenCompilerPolicy } from "../src/open-owner-compiler.ts";
import {
  createIsolatedOpenNavCollector,
  PYTH_NAV_LAYOUT_VERSION,
  PYTH_NAV_RECEIVER,
  type PythNavCollectorPolicy,
  type OpenNavRpcReadPort,
  type IsolatedOpenNavPoint,
} from "../src/open-nav-collector.ts";
import {
  createIsolatedOpenNavPositionReader,
  readProductionOpenNavPosition,
} from "../src/open-nav-position.ts";
const NOW = 1800000000,
  SLOT = 100,
  ID = "isolated-intent";
const ASSETS = ["USDC", "cbBTC", "PortalETH", "WSOL"] as const;
const CLOCK = "SysvarC1ock11111111111111111111111111111111",
  SYSVAR = "Sysvar1111111111111111111111111111111111111",
  LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const key = (n: number) => encodeBase58(Buffer.alloc(32, n));
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const dh = (v: unknown) => sha(canonicalize(v));
const put = (b: Buffer, o: number, k: string) =>
  Buffer.from(publicKeyBytes(k)).copy(b, o);
const raw = (b: Buffer, owner: string, executable = false): OpenAccount => ({
  owner,
  executable,
  data: [b.toString("base64"), "base64"],
  lamports: 1,
});
const anchor = (n: number, name: string) => {
  const b = Buffer.alloc(n);
  Buffer.from(sha("account:" + name), "hex").copy(b, 0, 0, 8);
  b[8] = 1;
  return b;
};
async function pricePoint() {
  const pd = Buffer.alloc(46);
  pd.writeUInt32LE(3);
  pd.writeBigUInt64LE(90n, 4);
  pd[45] = 7;
  const program = Buffer.alloc(36);
  program.writeUInt32LE(2);
  put(program, 4, key(51));
  const feeds = Object.fromEntries(
    ASSETS.map((asset, j) => [
      asset,
      {
        asset,
        mint: registry[asset].mint,
        operatorId: "pyth",
        feedId: String(j + 1).repeat(64),
        account: key(20 + j),
        ownerProgram: PYTH_NAV_RECEIVER,
        layoutVersion: PYTH_NAV_LAYOUT_VERSION,
        writeAuthority: key(30),
        maximumAgeSeconds: 60,
        maximumConfidenceBps: 200,
        maximumChainClockSkewSeconds: 5,
      },
    ]),
  ) as PythNavCollectorPolicy["feeds"];
  const clock = Buffer.alloc(40);
  clock.writeBigUInt64LE(BigInt(SLOT));
  clock.writeBigInt64LE(BigInt(NOW), 32);
  const accounts = [
    raw(clock, SYSVAR),
    raw(program, LOADER, true),
    raw(pd, LOADER),
    ...ASSETS.map((asset) => {
      const b = Buffer.alloc(134);
      Buffer.from("22f123639d7ef4cd", "hex").copy(b);
      put(b, 8, key(30));
      b[40] = 1;
      Buffer.from(feeds[asset].feedId, "hex").copy(b, 41);
      b.writeBigInt64LE(asset === "USDC" ? 98000000n : 200000000n, 73);
      b.writeBigUInt64LE(1n, 81);
      b.writeInt32LE(-8, 89);
      b.writeBigInt64LE(BigInt(NOW - 1), 93);
      b.writeBigInt64LE(BigInt(NOW - 2), 101);
      b.writeBigUInt64LE(99n, 125);
      return raw(b, PYTH_NAV_RECEIVER);
    }),
  ];
  const times = { wall: NOW, mono: 10 };
  const ports: OpenNavRpcReadPort[] = ["first", "second"].map((name) => ({
    providerId: name,
    operatorId: name,
    getGenesisHash: async () => c.genesisHash,
    getFinalizedSlot: async () => SLOT,
    getFinalizedAccounts: async () => ({
      context: { slot: SLOT },
      value: structuredClone(accounts),
    }),
  }));
  const policy: PythNavCollectorPolicy = {
    version: "c3-pyth-nav-collector/v1",
    feeds,
    receiverProgramData: key(51),
    receiverProgramDataHash: sha(pd),
    maximumCollectionMs: 8000,
    maximumPublishSpreadSeconds: 5,
  };
  const point = await createIsolatedOpenNavCollector(policy, ports, {
    nowUnix: () => times.wall,
    monotonicMs: () => times.mono,
  }).collect();
  return { point, times };
}
function fixture(
  stage:
    | "funded"
    | "buying"
    | "active"
    | "selling"
    | "claimable"
    | "redeemed" = "active",
) {
  const owned = ["active", "selling", "claimable"].includes(stage),
    closed = stage === "redeemed",
    selling = ["selling", "claimable", "redeemed"].includes(stage),
    program = VAULT_PROGRAM.toBase58(),
    genesis = key(80);
  const policy: OpenCompilerPolicy = {
    version: "c3-owner-compiler/v1",
    program,
    vault: findProgramAddress([Buffer.from("c3-vault-v1")], program).address,
    wallet: key(60),
    shareMint: key(61),
    governance: key(62),
    keeper: key(63),
    maxSlippageBps: 100,
    idlHash: "a".repeat(64),
    configurationHash: "b".repeat(64),
    registryRevision: "1",
    quotePolicyRevision: "1",
  };
  const a = openAddresses(policy),
    accounts: Record<string, OpenAccount | null> = {},
    cfg = anchor(546, "VaultConfig");
  cfg.writeBigUInt64LE(1n, 9);
  put(cfg, 17, policy.governance);
  put(cfg, 81, policy.keeper);
  put(cfg, 113, policy.wallet);
  put(cfg, 274, policy.shareMint);
  const mints = [c.usdcMint, c.cbBtcMint, c.portalEthMint, c.wrappedSolMint];
  mints.forEach((m, j) => {
    put(cfg, 146 + j * 32, m);
    put(cfg, 306 + j * 32, a.vaultTokens[j]!);
  });
  [4000, 3000, 3000].forEach((w, j) => cfg.writeUInt16LE(w, 434 + j * 2));
  cfg.writeBigUInt64LE(1000000n, 440);
  cfg.writeBigUInt64LE(1000000n, 448);
  cfg.writeBigUInt64LE(1n, 456);
  cfg.writeBigUInt64LE(selling ? 1n : 0n, 464);
  cfg.writeBigUInt64LE(owned || closed ? 1000000n : 0n, 472);
  cfg[480] = closed ? 4 : selling ? 3 : owned ? 2 : 1;
  cfg[481] = findProgramAddress([Buffer.from("c3-authority-v1")], program).bump;
  accounts[policy.vault] = raw(cfg, program);
  const mint = Buffer.alloc(170);
  mint.writeUInt32LE(1);
  put(mint, 4, a.authority);
  mint.writeBigUInt64LE(owned ? 1000000n : 0n, 36);
  mint[44] = 6;
  mint[45] = 1;
  mint[165] = 1;
  mint.writeUInt16LE(9, 166);
  accounts[policy.shareMint] = raw(mint, SHARE_TOKEN_PROGRAM);
  function token(
    addr: string,
    owner: string,
    mintKey: string,
    amount: bigint,
    shares = false,
  ) {
    const b = Buffer.alloc(shares ? 174 : 165);
    put(b, 0, mintKey);
    put(b, 32, owner);
    b.writeBigUInt64LE(amount, 64);
    b[108] = 1;
    if (shares) {
      b[165] = 2;
      b.writeUInt16LE(7, 166);
      b.writeUInt16LE(13, 170);
    }
    accounts[addr] = raw(b, shares ? SHARE_TOKEN_PROGRAM : c.tokenProgram);
  }
  token(
    a.ownerShares,
    policy.wallet,
    policy.shareMint,
    owned ? 1000000n : 0n,
    true,
  );
  const bought = [10000000n, 20000000n, 300000000n],
    buyCount = stage === "funded" ? 0 : stage === "buying" ? 1 : 3,
    sellCount =
      stage === "selling" ? 1 : stage === "claimable" || closed ? 3 : 0;
  const deposit = anchor(288, "DepositIntent"),
    redemption = anchor(234, "RedemptionIntent");
  for (const b of [deposit, redemption]) {
    b.writeBigUInt64LE(1n, 9);
    put(b, 17, policy.vault);
    put(b, 49, policy.wallet);
    b.writeBigUInt64LE(1n, 81);
    b.writeBigUInt64LE(80n, 89);
    b.writeBigInt64LE(BigInt(NOW - 5), 97);
    b.writeBigInt64LE(BigInt(NOW + 60), 105);
    b.writeBigUInt64LE(1000000n, 114);
  }
  deposit[113] = owned || closed ? 5 : 2;
  deposit.writeBigUInt64LE(1000000n, 122);
  [4000, 3000, 3000].forEach((v, j) => deposit.writeUInt16LE(v, 194 + j * 2));
  if (owned || closed) {
    bought.forEach((n, j) => deposit.writeBigUInt64LE(n, 162 + j * 8));
    deposit.writeBigUInt64LE(1000000n, 186);
  }
  redemption[113] = closed ? 6 : stage === "claimable" ? 4 : 2;
  bought.forEach((n, j) => redemption.writeBigUInt64LE(n, 122 + j * 8));
  if (sellCount === 3) redemption.writeBigUInt64LE(990000n, 154);
  if (closed) redemption.writeBigUInt64LE(990000n, 162);
  accounts[a.deposit] = raw(deposit, program);
  accounts[a.redemption] = selling ? raw(redemption, program) : null;
  function plan(sell: boolean, count: number) {
    const b = anchor(901, "SettlementPlan");
    b[8] = 2;
    b.writeBigUInt64LE(1n, 9);
    [
      policy.vault,
      sell ? a.redemption : a.deposit,
      policy.wallet,
      policy.shareMint,
    ].forEach((k, j) => put(b, 17 + j * 32, k));
    b[145] = sell ? 2 : 1;
    b.writeBigUInt64LE(1000000n, 146);
    put(b, 544, c.jupiterProgram);
    b.writeUInt16LE(100, 696);
    b.writeBigInt64LE(BigInt(NOW - 3), 698);
    b.writeBigInt64LE(BigInt(NOW + 60), 706);
    b[714] = (1 << count) - 1;
    b[715] =
      count === 3
        ? sell
          ? 6
          : 3
        : count === 0
          ? sell
            ? 4
            : 1
          : sell
            ? 5
            : 2;
    b.writeBigUInt64LE(BigInt(count), 716);
    b[724] = 1;
    for (let j = 0; j < 3; j++) {
      b.writeUInt16LE([4000, 3000, 3000][j]!, 154 + j * 2);
      [
        sell ? mints[j + 1]! : c.usdcMint,
        sell ? c.usdcMint : mints[j + 1]!,
        sell ? a.vaultTokens[j + 1]! : a.vaultTokens[0]!,
        sell ? a.vaultTokens[0]! : a.vaultTokens[j + 1]!,
      ].forEach((k, n) => put(b, [160, 256, 352, 448][n]! + j * 32, k));
      b.writeBigUInt64LE(1n, 672 + j * 8);
      const budget = sell ? bought[j]! : [400000n, 300000n, 300000n][j]!;
      b.writeBigUInt64LE(budget, 780 + j * 8);
      if (j < count) {
        b.writeBigUInt64LE(budget, 756 + j * 8);
        b.writeBigUInt64LE(sell ? 330000n : bought[j]!, 804 + j * 8);
      }
    }
    b[900] = findProgramAddress(
      [
        Buffer.from("c3-plan-v1"),
        publicKeyBytes(sell ? a.redemption : a.deposit),
      ],
      program,
    ).bump;
    return b;
  }
  accounts[a.depositPlan] = buyCount
    ? raw(plan(false, buyCount), program)
    : null;
  accounts[a.redemptionPlan] = selling
    ? raw(plan(true, sellCount), program)
    : null;
  const spent = [400000n, 300000n, 300000n]
    .slice(0, buyCount)
    .reduce((n, v) => n + v, 0n);
  a.vaultTokens.forEach((addr, j) =>
    token(
      addr,
      a.authority,
      mints[j]!,
      1n +
        (closed
          ? 0n
          : j === 0
            ? selling
              ? BigInt(sellCount) * 330000n
              : 1000000n - spent
            : j <= buyCount && j > sellCount
              ? bought[j - 1]!
              : 0n),
    ),
  );
  const clock = Buffer.alloc(40);
  clock.writeBigUInt64LE(BigInt(SLOT));
  clock.writeBigInt64LE(BigInt(NOW), 32);
  accounts[CLOCK] = raw(clock, SYSVAR);
  const receipts = [
    "deposit",
    ...(owned || closed ? ["issue_shares"] : []),
    ...(selling ? ["request_redemption"] : []),
    ...(closed ? ["claim"] : []),
  ].map((action) => {
    const auth = {
        version: "c3-owner-authorization/v2",
        intentId: ID,
        wallet: policy.wallet,
        vault: policy.vault,
        shareMint: policy.shareMint,
        configurationHash: policy.configurationHash,
        idlHash: policy.idlHash,
        registryRevision: policy.registryRevision,
        quotePolicyRevision: policy.quotePolicyRevision,
        feesEnabled: false,
        plan:
          action === "request_redemption" || action === "claim"
            ? a.redemptionPlan
            : a.depositPlan,
        messageHash: "c".repeat(64),
        action,
      },
      economic = {
        version: "c3-owner-effects/v2",
        wallet: policy.wallet,
        program: policy.program,
        vault: policy.vault,
        shareMint: policy.shareMint,
        semanticScope: policy,
        plan: auth.plan,
        onchainIntent:
          action === "request_redemption" || action === "claim"
            ? a.redemption
            : a.deposit,
        messageHash: auth.messageHash,
        action,
      };
    return {
      action,
      stage: {
        deposit: "funded",
        issue_shares: "active",
        request_redemption: "redemption_requested",
        claim: "redeemed",
      }[action],
      requestHash: auth.messageHash,
      submissionHash: auth.messageHash,
      signature: "2".repeat(88),
      slot: "99",
      messageEvidence: "d".repeat(64),
      effectEvidence: "e".repeat(64),
      authorization: auth,
      authorizationHash: dh(auth),
      policyHash: dh(policy),
      economic,
      economicHash: dh(economic),
    };
  });
  const legs = Array.from({ length: 6 }, (_, ordinal) => {
    const sell = ordinal >= 3,
      j = ordinal % 3,
      completed = j < (sell ? sellCount : buyCount),
      p = plan(sell, j + 1);
    return {
      ordinal,
      state: completed ? "confirmed" : "pending",
      signature: completed ? "2".repeat(88) : null,
      evidenceHash: completed ? "d".repeat(64) : null,
      context: completed
        ? {
            scope: "ISOLATED_VERIFIED",
            genesis: Buffer.from(publicKeyBytes(genesis)).toString("hex"),
            authorizationHash: "e".repeat(64),
          }
        : null,
      effects: completed
        ? {
            scope: "SEMANTIC_EFFECTS_VERIFIED",
            inputAmount: p.readBigUInt64LE(780 + j * 8).toString(),
            outputAmount: p.readBigUInt64LE(804 + j * 8).toString(),
            chainRevision: String(j + 1),
            authorizationHash: "e".repeat(64),
            quoteId: "f".repeat(64),
            planStateBase64: p.toString("base64"),
            planStateHash: sha(p),
          }
        : null,
    };
  });
  const snapshot = {
    intent: {
      id: ID,
      wallet: policy.wallet,
      vault: policy.vault,
      shareMint: policy.shareMint,
      configurationHash: policy.configurationHash,
      state: stage,
      dbRevision: "10",
      chainRevision: String(selling ? sellCount : buyCount),
      depositPlan: a.depositPlan,
      redemptionPlan: selling ? a.redemptionPlan : null,
      amount: "1000000",
    },
    enrollment: dh(policy),
    legs,
    receipts,
    pending: false,
  };
  let queries = 0;
  const pool = {
    query: async () => {
      queries++;
      return { rows: [{ snapshot: structuredClone(snapshot) }] };
    },
  } as unknown as Pool;
  let onRead = () => {};
  const rpc = {
    read: async (method: string, params: unknown[]) => {
      if (method === "getGenesisHash") return genesis;
      onRead();
      const names = params[0] as string[];
      return {
        context: { slot: SLOT },
        value: names.map((n) => structuredClone(accounts[n])),
      };
    },
  };
  return {
    policy,
    a,
    accounts,
    snapshot,
    pool,
    rpc,
    genesis,
    setRead: (fn: () => void) => {
      onRead = fn;
    },
    queries: () => queries,
    reader: createIsolatedOpenNavPositionReader(pool, policy, rpc, genesis),
  };
}
test("production gate before all ports; isolated cannot request Mainnet custody", async () => {
  let calls = 0;
  const pool = {
    query: async () => {
      calls++;
      throw Error("unexpected");
    },
  } as unknown as Pool;
  assert.deepEqual(await readProductionOpenNavPosition(pool, ID), {
    status: "UNAVAILABLE",
    reason: "PRODUCTION_NOT_APPROVED",
  });
  assert.equal(calls, 0);
  const f = fixture();
  assert.throws(
    () =>
      createIsolatedOpenNavPositionReader(
        f.pool,
        f.policy,
        f.rpc,
        c.genesisHash,
      ),
    /ISOLATED_MAINNET_FORBIDDEN/,
  );
});
for (const stage of [
  "funded",
  "buying",
  "active",
  "selling",
  "claimable",
  "redeemed",
] as const)
  test(
    "raw finalized accounting excludes donated units: " + stage,
    async () => {
      const f = fixture(stage),
        { point } = await pricePoint(),
        r = await f.reader.read(ID, point);
      assert.equal(r.status, "NAV_ACCOUNTING_JOIN", JSON.stringify(r));
      if (r.status !== "NAV_ACCOUNTING_JOIN") return;
      assert.equal(r.evidenceScope, "ISOLATED_ONLY");
      assert.equal(f.queries(), 2);
      for (const asset of ASSETS)
        assert.equal(
          BigInt(r.inventory[asset].custodyBaseUnits) -
            BigInt(r.inventory[asset].accountedBaseUnits),
          1n,
        );
      if (stage === "active") {
        assert.equal(r.math.netUsdE12, "1200000000000");
        assert.equal(r.math.sharePriceUsdE12, "1200000000000");
      }
      if (stage === "claimable") {
        assert.equal(r.actualFullClaimUsdcBaseUnits, "990000");
        assert.equal(r.math.netUsdE12, "970200000000");
      }
      if (stage === "redeemed") {
        assert.equal(r.actualFullClaimUsdcBaseUnits, "990000");
        assert.equal(r.math.netUsdE12, "0");
      }
      if (stage === "funded" || stage === "buying") {
        assert.equal(r.math.netUsdE12, "0");
        assert.equal(r.math.sharePriceUsdE12, null);
      }
    },
  );
test("missing effects, uncertainty, forged scopes/manifest/hash and deficit fail closed", async () => {
  const { point } = await pricePoint();
  for (const mode of [
    "pending",
    "receipt",
    "hash",
    "semantic-scope",
    "scope",
    "input",
    "backing",
    "supply",
    "clock",
    "schema",
  ]) {
    const f = fixture();
    if (mode === "pending") f.snapshot.pending = true;
    if (mode === "receipt") f.snapshot.receipts.pop();
    if (mode === "hash")
      f.snapshot.receipts[0]!.submissionHash = "a".repeat(64);
    if (mode === "semantic-scope") {
      const receipt = f.snapshot.receipts[0]!;
      receipt.economic = {
        ...receipt.economic,
        semanticScope: { ...receipt.economic.semanticScope, wallet: key(70) },
      };
      receipt.economicHash = dh(receipt.economic);
    }
    if (mode === "scope") f.snapshot.legs[0]!.context!.scope = "LOCAL_CLONE";
    if (mode === "input") f.snapshot.legs[0]!.effects!.inputAmount = "400001";
    const mutate = (address: string, fn: (b: Buffer) => void) => {
      const account = f.accounts[address]!;
      const bytes = Buffer.from(account.data[0]!, "base64");
      fn(bytes);
      f.accounts[address] = raw(bytes, account.owner);
    };
    if (mode === "backing")
      mutate(f.a.vaultTokens[1]!, (b) => b.writeBigUInt64LE(0n, 64));
    if (mode === "supply")
      mutate(f.policy.shareMint, (b) => b.writeBigUInt64LE(999999n, 36));
    if (mode === "clock")
      mutate(CLOCK, (b) => b.writeBigInt64LE(BigInt(NOW + 61), 32));
    if (mode === "schema")
      mutate(f.policy.vault, (b) => {
        b[8] = 2;
      });
    const r = await f.reader.read(ID, point);
    assert.equal(r.status, "UNAVAILABLE", mode + JSON.stringify(r));
  }
});
test("full snapshot recheck catches journal arrival without intent revision bump", async () => {
  const f = fixture(),
    { point } = await pricePoint();
  f.setRead(() => {
    f.snapshot.pending = true;
  });
  assert.deepEqual(await f.reader.read(ID, point), {
    status: "UNAVAILABLE",
    reason: "C3_NAV_POSITION_SNAPSHOT_CHANGED",
  });
});
test("price seal cannot be serialized/self-certified; expiration during custody read", async () => {
  const f = fixture(),
    p = await pricePoint();
  assert.equal(
    (
      await f.reader.read(
        ID,
        JSON.parse(JSON.stringify(p.point)) as IsolatedOpenNavPoint,
      )
    ).status,
    "UNAVAILABLE",
  );
  assert.equal(f.queries(), 0);
  f.setRead(() => {
    p.times.wall += 61;
    p.times.mono += 61000;
  });
  assert.deepEqual(await f.reader.read(ID, p.point), {
    status: "UNAVAILABLE",
    reason: "PRICE_POINT_EXPIRED",
  });
});
