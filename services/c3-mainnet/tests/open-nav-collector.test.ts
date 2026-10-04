import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { C3_MAINNET } from "../src/constants.ts";
import {
  C3_MAINNET_ASSET_REGISTRY as registry,
  type C3AssetId,
} from "../src/registry.ts";
import { publicKeyBytes, encodeBase58 } from "../src/solana.ts";
import {
  PYTH_NAV_LAYOUT_VERSION,
  PYTH_NAV_RECEIVER,
  PINNED_OPEN_NAV_COLLECTOR_POLICY,
  createIsolatedOpenNavCollector,
  evaluateIsolatedOpenNavPoint,
  collectVerifiedOpenNavPoint,
  evaluateVerifiedOpenNav,
  decodePythPriceUpdateV2,
  type PythNavCollectorPolicy,
  type OpenNavRpcReadPort,
  type PythNavFeed,
  type VerifiedOpenNavPoint,
  type IsolatedOpenNavPoint,
} from "../src/open-nav-collector.ts";

const NOW = 1_800_000_000,
  SLOT = 100;
const ASSETS = ["USDC", "cbBTC", "PortalETH", "WSOL"] as const;
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const SYSVAR = "Sysvar1111111111111111111111111111111111111";
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function le(value: bigint, bytes: 4 | 8, signed = false) {
  const b = Buffer.alloc(bytes);
  if (bytes === 4) b.writeInt32LE(Number(value));
  else if (signed) b.writeBigInt64LE(value);
  else b.writeBigUInt64LE(value);
  return b;
}
/** Synthetic fixture serialized in OFFICIAL Rust/Borsh field order, not
 * production observations. Full has one-byte enum tag and 133 serialized bytes.
 * Account allocation is 134. Different EMA/previous values catch wrong offsets.
 */
function wire(f: PythNavFeed, price = 80_000_000n, published = NOW - 1) {
  const serialized = Buffer.concat([
    Buffer.from("22f123639d7ef4cd", "hex"),
    publicKeyBytes(f.writeAuthority),
    Buffer.from([1]),
    Buffer.from(f.feedId, "hex"),
    le(price, 8, true),
    le(171n, 8),
    le(-8n, 4),
    le(BigInt(published), 8, true),
    le(BigInt(published - 2), 8, true),
    le(987_654_321n, 8, true),
    le(373n, 8),
    le(98n, 8),
  ]);
  assert.equal(serialized.length, 133);
  return Buffer.concat([serialized, Buffer.from([253])]); // unused old byte
}
const rpcAccount = (data: Uint8Array, owner: string, executable = false) => ({
  owner,
  executable,
  data: [Buffer.from(data).toString("base64"), "base64"],
  lamports: 1,
  rentEpoch: 0,
});
function fixture() {
  const programDataAddress = encodeBase58(
    Uint8Array.from({ length: 32 }, () => 44),
  );
  // Isolated version-pin fixture, NOT a real receiver binary/deployment.
  const programData = Buffer.concat([
    le(3n, 4),
    le(90n, 8),
    Buffer.from([0]),
    Buffer.alloc(32),
    Buffer.from("ISOLATED_PROGRAM_BYTES"),
  ]);
  const feeds = {} as Record<C3AssetId, PythNavFeed>;
  ASSETS.forEach((asset, i) => {
    feeds[asset] = {
      asset,
      mint: registry[asset].mint,
      operatorId: "pyth",
      feedId: (i + 1).toString().repeat(64),
      account: encodeBase58(Uint8Array.from({ length: 32 }, () => i + 10)),
      ownerProgram: PYTH_NAV_RECEIVER,
      layoutVersion: PYTH_NAV_LAYOUT_VERSION,
      writeAuthority: C3_MAINNET.usdcMint,
      maximumAgeSeconds: 60,
      maximumConfidenceBps: 200,
      maximumChainClockSkewSeconds: 5,
    };
  });
  const policy: PythNavCollectorPolicy = {
    version: "c3-pyth-nav-collector/v1",
    feeds,
    receiverProgramData: programDataAddress,
    receiverProgramDataHash: digest(programData),
    maximumCollectionMs: 8000,
    maximumPublishSpreadSeconds: 5,
  };
  const clock = Buffer.concat([
    le(BigInt(SLOT), 8),
    le(BigInt(NOW - 100), 8, true),
    le(2n, 8),
    le(3n, 8),
    le(BigInt(NOW), 8, true),
  ]);
  const program = Buffer.concat([
    le(2n, 4),
    publicKeyBytes(programDataAddress),
  ]);
  const snapshot = {
    context: { slot: SLOT },
    value: [
      rpcAccount(clock, SYSVAR),
      rpcAccount(program, LOADER, true),
      rpcAccount(programData, LOADER),
      ...ASSETS.map((a) => rpcAccount(wire(feeds[a]), PYTH_NAV_RECEIVER)),
    ],
  };
  const calls: string[] = [];
  const times = { wall: NOW, mono: 10 };
  const ports: OpenNavRpcReadPort[] = ["aaa", "bbb"].map((id) => ({
    providerId: id,
    operatorId: id,
    getGenesisHash: async () => {
      calls.push(`${id}:genesis`);
      return C3_MAINNET.genesisHash;
    },
    getFinalizedSlot: async () => {
      calls.push(`${id}:slot`);
      return id === "aaa" ? 99 : SLOT;
    },
    getFinalizedAccounts: async (addresses, minimum) => {
      calls.push(`${id}:accounts`);
      assert.equal(minimum, SLOT);
      assert.equal(addresses.length, 7);
      assert.deepEqual(addresses.slice(1), [
        PYTH_NAV_RECEIVER,
        programDataAddress,
        ...ASSETS.map((a) => feeds[a].account),
      ]);
      return structuredClone(snapshot);
    },
  }));
  return {
    policy,
    snapshot,
    calls,
    ports,
    times,
    clock: {
      nowUnix: () => times.wall,
      monotonicMs: () => times.mono,
    },
  };
}
function changedBytes(
  f: ReturnType<typeof fixture>,
  index: number,
  change: (b: Buffer) => void,
) {
  const a = f.snapshot.value[index]!;
  const b = Buffer.from(a.data[0]!, "base64");
  change(b);
  a.data[0] = b.toString("base64");
}

test("official Full Borsh fields decode without inventing a version or fixed two-byte enum", () => {
  const f = fixture(),
    pin = f.policy.feeds.USDC;
  const decoded = decodePythPriceUpdateV2(
    rpcAccount(wire(pin), PYTH_NAV_RECEIVER),
    pin,
    SLOT,
  );
  assert.equal(decoded.priceMantissa, "80000000");
  assert.equal(decoded.confidenceMantissa, "171");
  assert.equal(decoded.exponent, -8);
  assert.equal(decoded.publishTimeUnix, NOW - 1);
  assert.equal(decoded.postedSlot, "98");
  assert.equal(decoded.status, "UNSEALED_RAW_PYTH_FIELDS");
  const adjacent = decodePythPriceUpdateV2(
    rpcAccount(wire(pin, 9007199254740993n), PYTH_NAV_RECEIVER),
    pin,
    SLOT,
  );
  assert.equal(adjacent.priceMantissa, "9007199254740993");
});

test("raw decoder rejects Partial, discriminators, authority/feed/owner/version, lengths and invalid i64", () => {
  const f = fixture(),
    pin = f.policy.feeds.USDC;
  const bad = (change: (b: Buffer) => void) => {
    const b = wire(pin);
    change(b);
    assert.throws(() =>
      decodePythPriceUpdateV2(rpcAccount(b, PYTH_NAV_RECEIVER), pin, SLOT),
    );
  };
  bad((b) => {
    b[40] = 0;
  });
  bad((b) => {
    b[40] = 2;
  });
  bad((b) => {
    b[0] = 0;
  });
  bad((b) => {
    b[8] = 0;
  });
  bad((b) => {
    b[41] = 0;
  });
  bad((b) => {
    b.writeBigInt64LE(-1n, 73);
  });
  bad((b) => {
    b.writeBigInt64LE(0n, 93);
  });
  bad((b) => {
    b.writeBigInt64LE(BigInt(NOW + 1), 101);
  });
  bad((b) => {
    b.writeBigUInt64LE(101n, 125);
  });
  for (const bytes of [
    wire(pin).subarray(0, 133),
    Buffer.concat([wire(pin), Buffer.from([0])]),
  ])
    assert.throws(
      () =>
        decodePythPriceUpdateV2(
          rpcAccount(bytes, PYTH_NAV_RECEIVER),
          pin,
          SLOT,
        ),
      /LAYOUT/,
    );
  assert.throws(
    () =>
      decodePythPriceUpdateV2(
        rpcAccount(wire(pin), C3_MAINNET.tokenProgram),
        pin,
        SLOT,
      ),
    /ACCOUNT/,
  );
  assert.throws(
    () =>
      decodePythPriceUpdateV2(
        rpcAccount(wire(pin), PYTH_NAV_RECEIVER),
        { ...pin, layoutVersion: "future" } as unknown as PythNavFeed,
        SLOT,
      ),
    /LAYOUT_VERSION/,
  );
});

test("collector obtains finalized fixed raw accounts + chain Clock from two ports; isolated cannot promote", async () => {
  const f = fixture();
  const collector = createIsolatedOpenNavCollector(f.policy, f.ports, f.clock);
  const point = await collector.collect(),
    result = evaluateIsolatedOpenNavPoint(point);
  assert.equal(result.status, "PYTH_FULL_QUORUM_PRICES_NOT_NAV");
  assert.equal(result.evidenceScope, "ISOLATED_ONLY");
  assert.equal(result.economicOracleOperators, 1);
  assert.equal(result.pricesUsdE12.USDC, "800000000000"); // no USDC parity
  assert.equal(result.contextSlot, SLOT);
  assert.equal(f.calls.filter((x) => x.endsWith(":accounts")).length, 2);
  assert.equal(
    evaluateVerifiedOpenNav(point as unknown as VerifiedOpenNavPoint).status,
    "UNAVAILABLE",
  );
  for (const forged of [
    structuredClone(point),
    { ...result, verified: true },
    decodePythPriceUpdateV2(f.snapshot.value[3], f.policy.feeds.USDC, SLOT),
  ])
    assert.deepEqual(
      evaluateIsolatedOpenNavPoint(forged as unknown as IsolatedOpenNavPoint),
      { status: "UNAVAILABLE", reason: "POINT_NOT_VERIFIED" },
    );
});

test("fixed source policy cannot be replaced/mutated during provider awaits", async () => {
  const f = fixture();
  // Original transport responses must remain original despite policy mutation.
  const snapshots = f.ports.map((p) => ({
    ...p,
    getFinalizedAccounts: async () => structuredClone(f.snapshot),
  }));
  const collector = createIsolatedOpenNavCollector(
    f.policy,
    snapshots,
    f.clock,
  );
  Object.assign(f.policy.feeds.USDC, {
    feedId: "f".repeat(64),
    account: C3_MAINNET.cbBtcMint,
  });
  Object.assign(f.policy, { receiverProgramDataHash: "f".repeat(64) });
  snapshots[0]!.getFinalizedAccounts = async () => {
    throw Error("replacement must not execute");
  };
  assert.equal(
    evaluateIsolatedOpenNavPoint(await collector.collect()).status,
    "PYTH_FULL_QUORUM_PRICES_NOT_NAV",
  );
});

test("wrong genesis/barrier/context/bank/Clock or even agreeing tampered receiver bytes fail closed", async () => {
  for (const kind of [
    "genesis",
    "lag",
    "different-bank",
    "clock-owner",
    "clock-slot",
    "clock-time",
    "receiver-link",
    "receiver-hash",
    "feed-owner",
    "feed-disagreement",
  ]) {
    const f = fixture();
    if (kind === "genesis")
      f.ports[0] = { ...f.ports[0]!, getGenesisHash: async () => "local" };
    if (kind === "lag") f.snapshot.context.slot = 99;
    if (kind === "different-bank")
      f.ports[0] = {
        ...f.ports[0]!,
        getFinalizedAccounts: async () => ({
          ...structuredClone(f.snapshot),
          context: { slot: 101 },
        }),
      };
    if (kind === "clock-owner") f.snapshot.value[0]!.owner = PYTH_NAV_RECEIVER;
    if (kind === "clock-slot")
      changedBytes(f, 0, (b) => b.writeBigUInt64LE(99n, 0));
    if (kind === "clock-time")
      changedBytes(f, 0, (b) => b.writeBigInt64LE(BigInt(NOW - 10), 32));
    if (kind === "receiver-link")
      changedBytes(f, 1, (b) => {
        b[4] = 0;
      });
    if (kind === "receiver-hash")
      changedBytes(f, 2, (b) => {
        b[b.length - 1] = 0;
      });
    if (kind === "feed-owner")
      f.snapshot.value[3]!.owner = C3_MAINNET.tokenProgram;
    if (kind === "feed-disagreement")
      f.ports[0] = {
        ...f.ports[0]!,
        getFinalizedAccounts: async () => {
          const s = structuredClone(f.snapshot);
          s.value[3]!.data[0] = wire(f.policy.feeds.USDC, 80_000_001n).toString(
            "base64",
          );
          return s;
        },
      };
    await assert.rejects(
      () =>
        createIsolatedOpenNavCollector(f.policy, f.ports, f.clock).collect(),
      /C3_OPEN_NAV/,
      kind,
    );
  }
});

test("policy rejects underlying references, duplicated feeds/accounts, alias operators and unsupported layouts", () => {
  for (const kind of [
    "underlying",
    "duplicate",
    "operator",
    "layout",
    "clock",
    "extra",
  ]) {
    const f = fixture();
    if (kind === "underlying")
      Object.assign(f.policy.feeds.cbBTC, {
        feedId: registry.cbBTC.oracleFeedId,
      });
    if (kind === "duplicate")
      Object.assign(f.policy.feeds.PortalETH, {
        account: f.policy.feeds.USDC.account,
      });
    if (kind === "operator") f.ports[1] = { ...f.ports[1]!, operatorId: "aaa" };
    if (kind === "layout")
      Object.assign(f.policy.feeds.USDC, { layoutVersion: "sdk/other" });
    if (kind === "clock")
      Object.assign(f.policy.feeds.USDC, { maximumAgeSeconds: NaN });
    if (kind === "extra") Object.assign(f.policy, { verified: true });
    assert.throws(() =>
      createIsolatedOpenNavCollector(f.policy, f.ports, f.clock),
    );
  }
});

test("collector refuses stale/future/confident/incoherent prices and delayed completion", async () => {
  for (const kind of [
    "stale",
    "future",
    "confidence",
    "spread",
    "aged-during-read",
    "regression",
    "deadline",
  ]) {
    const f = fixture();
    if (kind === "stale")
      changedBytes(f, 3, (b) => {
        b.writeBigInt64LE(BigInt(NOW - 61), 93);
        b.writeBigInt64LE(BigInt(NOW - 62), 101);
      });
    if (kind === "future")
      changedBytes(f, 3, (b) => b.writeBigInt64LE(BigInt(NOW + 1), 93));
    if (kind === "confidence")
      changedBytes(f, 3, (b) => b.writeBigUInt64LE(1_600_001n, 81));
    if (kind === "spread")
      changedBytes(f, 3, (b) => {
        b.writeBigInt64LE(BigInt(NOW - 10), 93);
        b.writeBigInt64LE(BigInt(NOW - 11), 101);
      });
    if (kind === "aged-during-read")
      ASSETS.forEach((_, i) =>
        changedBytes(f, i + 3, (b) => {
          b.writeBigInt64LE(BigInt(NOW - 59), 93);
          b.writeBigInt64LE(BigInt(NOW - 60), 101);
        }),
      );
    if (["aged-during-read", "regression", "deadline"].includes(kind)) {
      const original = f.ports[1]!.getFinalizedAccounts;
      f.ports[1] = {
        ...f.ports[1]!,
        getFinalizedAccounts: async (a, m) => {
          const s = await original(a, m);
          f.times.wall +=
            kind === "regression" ? -1 : kind === "deadline" ? 9 : 2;
          f.times.mono += kind === "deadline" ? 9000 : 2000;
          return s;
        },
      };
    }
    await assert.rejects(
      () =>
        createIsolatedOpenNavCollector(f.policy, f.ports, f.clock).collect(),
      /C3_OPEN_NAV/,
      kind,
    );
  }
});

test("sealed points expire on current clock and monotonic time; no cached last-good fallback", async () => {
  const f = fixture(),
    p = await createIsolatedOpenNavCollector(
      f.policy,
      f.ports,
      f.clock,
    ).collect();
  f.times.wall += 61;
  f.times.mono += 61_000;
  assert.deepEqual(evaluateIsolatedOpenNavPoint(p), {
    status: "UNAVAILABLE",
    reason: "PRICE_POINT_EXPIRED",
  });
  const g = fixture();
  Object.assign(g.policy.feeds.USDC, { maximumAgeSeconds: 1 });
  const point = await createIsolatedOpenNavCollector(
    g.policy,
    g.ports,
    g.clock,
  ).collect();
  g.times.mono += 1100; // frozen Date cannot extend price validity
  assert.equal(evaluateIsolatedOpenNavPoint(point).status, "UNAVAILABLE");
});

test("never-resolving ports are bounded; production has no caller overrides and performs no RPC while disabled", async () => {
  const f = fixture();
  Object.assign(f.policy, { maximumCollectionMs: 15 });
  f.ports[0] = { ...f.ports[0]!, getGenesisHash: () => new Promise(() => {}) };
  await assert.rejects(
    () => createIsolatedOpenNavCollector(f.policy, f.ports, f.clock).collect(),
    /TIMEOUT/,
  );
  assert.equal(f.calls.filter((x) => x.endsWith(":accounts")).length, 0);
  assert.equal(PINNED_OPEN_NAV_COLLECTOR_POLICY, null);
  assert.deepEqual(await collectVerifiedOpenNavPoint(), {
    status: "UNAVAILABLE",
    reason: "PRODUCTION_NOT_APPROVED",
  });
});
