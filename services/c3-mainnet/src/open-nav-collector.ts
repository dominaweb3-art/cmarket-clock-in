/** Raw Pyth PRICE collection, not custody verification or transaction authority.
 * Rust source pin (SDK 2.0.0, default/core feature):
 * https://github.com/pyth-network/pyth-crosschain/blob/2bb0eb54b2b3af8854d0c26f3884c28a0fce0802/target_chains/solana/pyth_solana_receiver_sdk/src/price_update.rs
 * PriceFeedMessage fields: same commit, pythnet/pythnet_sdk/src/messages.rs.
 * Clock/upgradeable loader layouts: solana-labs/solana v1.18.26,
 * sdk/program/src/{clock,bpf_loader_upgradeable}.rs.
 * Full guardian verification is checked in bytes; RPC truth still relies on
 * reviewed providers. Two RPC operators are NOT independent price oracles.
 * No public point registration; isolated ports can ONLY issue isolated points.
 * External missing: reviewed direct feed/address/write-authority pins for ALL
 * four exact mints (especially PortalETH), receiver ProgramData hash, providers,
 * and source policy enrollment. A price point alone never proves share-owned
 * inventory, reserve classification, or finalized economic settlement.
 */
import { createHash } from "node:crypto";
import { C3_MAINNET } from "./constants.ts";
import { publicKeyBytes, encodeBase58 } from "./solana.ts";
import {
  C3_MAINNET_ASSET_REGISTRY as registry,
  type C3AssetId,
} from "./registry.ts";
import {
  decodeOpenNavDirectQuote,
  type OpenNavDirectSource,
  type OpenNavUnavailable,
} from "./open-nav.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import {
  assertIndependentRpcProviders,
  type ReviewedRpcProvider,
} from "./pilot-rpc-evidence.ts";

export const PYTH_NAV_LAYOUT_VERSION =
  "pyth-solana-receiver-sdk/2.0.0@2bb0eb54b2b3af8854d0c26f3884c28a0fce0802" as const;
export const PYTH_NAV_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const SYSVAR = "Sysvar1111111111111111111111111111111111111";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const ASSETS = ["USDC", "cbBTC", "PortalETH", "WSOL"] as const;
const DISCRIMINATOR = Buffer.from("22f123639d7ef4cd", "hex");
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const missing = (reason: OpenNavUnavailable["reason"]): OpenNavUnavailable =>
  Object.freeze({ status: "UNAVAILABLE", reason });
function fail(code: string): never {
  throw Error(`C3_OPEN_NAV_COLLECTOR_${code}`);
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("SHAPE");
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) fail("SHAPE");
  const result = Object.create(null) as Record<string, unknown>;
  for (const k of Reflect.ownKeys(v)) {
    if (typeof k !== "string") fail("SHAPE");
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !("value" in d)) fail("SHAPE");
    result[k] = d.value;
  }
  return result;
}
function integer(v: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max)
    fail("INTEGER");
  return v;
}
function positiveTime(v: bigint): number {
  if (v < 1n || v > BigInt(Number.MAX_SAFE_INTEGER)) fail("TIME");
  return Number(v);
}
function address(v: unknown): string {
  if (typeof v !== "string" || v.length > 44) fail("ADDRESS");
  if (encodeBase58(publicKeyBytes(v)) !== v) fail("ADDRESS");
  return v;
}
function sha(v: unknown): string {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v) || /^0+$/.test(v))
    fail("HASH");
  return v;
}
function account(v: unknown, owner: string, executable = false): Buffer {
  const a = object(v);
  if (
    a.owner !== owner ||
    a.executable !== executable ||
    !Array.isArray(a.data) ||
    a.data.length !== 2 ||
    a.data[1] !== "base64" ||
    typeof a.data[0] !== "string" ||
    a.data[0].length > 2_800_000
  )
    fail("ACCOUNT");
  const b = Buffer.from(a.data[0], "base64");
  if (b.toString("base64") !== a.data[0] || b.length === 0) fail("BASE64");
  return b;
}

export type PythNavFeed = Readonly<
  OpenNavDirectSource & {
    layoutVersion: typeof PYTH_NAV_LAYOUT_VERSION;
    writeAuthority: string;
  }
>;
export type PythNavCollectorPolicy = Readonly<{
  version: "c3-pyth-nav-collector/v1";
  feeds: Readonly<Record<C3AssetId, PythNavFeed>>;
  receiverProgramData: string;
  // Hash of the ENTIRE ProgramData account: deployment slot, upgrade authority,
  // and binary. Upgrade/same address with new bytes invalidates enrollment.
  receiverProgramDataHash: string;
  maximumCollectionMs: number;
  maximumPublishSpreadSeconds: number;
}>;
export const PINNED_OPEN_NAV_COLLECTOR_POLICY: PythNavCollectorPolicy | null =
  null;

function copiedPolicy(p: PythNavCollectorPolicy): PythNavCollectorPolicy {
  // This API is server-internal. Copy before any await to prevent policy races.
  const q = object(p);
  if (
    Object.keys(q).sort().join() !==
      [
        "version",
        "feeds",
        "receiverProgramData",
        "receiverProgramDataHash",
        "maximumCollectionMs",
        "maximumPublishSpreadSeconds",
      ]
        .sort()
        .join() ||
    q.version !== "c3-pyth-nav-collector/v1"
  )
    fail("POLICY");
  const feeds = object(q.feeds);
  if (Object.keys(feeds).sort().join() !== [...ASSETS].sort().join())
    fail("POLICY");
  const out = {} as Record<C3AssetId, PythNavFeed>;
  const used = new Set<string>();
  for (const asset of ASSETS) {
    const f = object(feeds[asset]) as unknown as PythNavFeed;
    if (
      Object.keys(f).sort().join() !==
        [
          "asset",
          "mint",
          "operatorId",
          "feedId",
          "account",
          "ownerProgram",
          "maximumAgeSeconds",
          "maximumConfidenceBps",
          "maximumChainClockSkewSeconds",
          "layoutVersion",
          "writeAuthority",
        ]
          .sort()
          .join() ||
      f.asset !== asset ||
      f.mint !== registry[asset].mint ||
      f.operatorId !== "pyth" ||
      f.layoutVersion !== PYTH_NAV_LAYOUT_VERSION ||
      f.ownerProgram !== PYTH_NAV_RECEIVER ||
      typeof f.feedId !== "string" ||
      !/^[a-f0-9]{64}$/.test(f.feedId) ||
      [registry.cbBTC.oracleFeedId, registry.PortalETH.oracleFeedId].includes(
        f.feedId,
      )
    )
      fail("DIRECT_FEED_POLICY");
    address(f.account);
    address(f.writeAuthority);
    integer(f.maximumAgeSeconds, 1, 60);
    integer(f.maximumConfidenceBps, 1, 200);
    integer(f.maximumChainClockSkewSeconds, 0, 60);
    if (used.has(f.account) || used.has(f.feedId)) fail("DUPLICATE_FEED");
    used.add(f.account);
    used.add(f.feedId);
    out[asset] = Object.freeze({ ...f });
  }
  const programData = address(q.receiverProgramData);
  if (
    [CLOCK, PYTH_NAV_RECEIVER, ...ASSETS.map((a) => out[a].account)].includes(
      programData,
    ) ||
    ASSETS.some((a) => [CLOCK, PYTH_NAV_RECEIVER].includes(out[a].account))
  )
    fail("ACCOUNT_ALIAS");
  return Object.freeze({
    version: "c3-pyth-nav-collector/v1",
    feeds: Object.freeze(out),
    receiverProgramData: programData,
    receiverProgramDataHash: sha(q.receiverProgramDataHash),
    maximumCollectionMs: integer(q.maximumCollectionMs, 1, 8000),
    maximumPublishSpreadSeconds: integer(q.maximumPublishSpreadSeconds, 0, 60),
  });
}

/** Standalone decoder returns UNSEALED fields; only collection can mint a point.
 * Borsh Full=1 at offset40 is ONE byte. Full fields: feed41, price73, conf81,
 * expo89, publish93, previous101, ema109, emaConf117, posted125. LEN134 reserves
 * room for Partial's extra byte; byte133 is UNUSED and may retain old data.
 * There is no embedded version integer: layout/source revision + discriminator,
 * exact allocated length, owner and collector's ProgramData hash are the pins.
 */
export function decodePythPriceUpdateV2(
  raw: unknown,
  pin: PythNavFeed,
  contextSlot: number,
) {
  if (
    pin.layoutVersion !== PYTH_NAV_LAYOUT_VERSION ||
    pin.ownerProgram !== PYTH_NAV_RECEIVER
  )
    fail("LAYOUT_VERSION");
  address(pin.account);
  address(pin.writeAuthority);
  integer(contextSlot);
  const b = account(raw, PYTH_NAV_RECEIVER);
  if (b.length !== 134 || !b.subarray(0, 8).equals(DISCRIMINATOR))
    fail("LAYOUT");
  if (b[40] !== 1) fail("FULL_VERIFICATION_REQUIRED");
  if (
    encodeBase58(b.subarray(8, 40)) !== pin.writeAuthority ||
    b.subarray(41, 73).toString("hex") !== pin.feedId
  )
    fail("FEED_AUTHORITY");
  const price = b.readBigInt64LE(73),
    confidence = b.readBigUInt64LE(81);
  const publishTimeUnix = positiveTime(b.readBigInt64LE(93));
  const previous = b.readBigInt64LE(101),
    posted = b.readBigUInt64LE(125);
  if (
    price <= 0n ||
    previous < 0n ||
    previous > BigInt(publishTimeUnix) ||
    posted < 1n ||
    posted > BigInt(contextSlot)
  )
    fail("PRICE_MESSAGE");
  return Object.freeze({
    status: "UNSEALED_RAW_PYTH_FIELDS" as const,
    priceMantissa: price.toString(),
    confidenceMantissa: confidence.toString(),
    exponent: b.readInt32LE(89),
    publishTimeUnix,
    postedSlot: posted.toString(),
    evidenceHash: hash(b),
  });
}

export type OpenNavRpcReadPort = Readonly<{
  providerId: string;
  operatorId: string;
  getGenesisHash(): Promise<unknown>;
  getFinalizedSlot(): Promise<unknown>;
  getFinalizedAccounts(
    addresses: readonly string[],
    minimumSlot: number,
  ): Promise<unknown>;
}>;
type ServerClock = Readonly<{ nowUnix(): number; monotonicMs(): number }>;
const serverClock: ServerClock = Object.freeze({
  nowUnix: () => Math.floor(Date.now() / 1000),
  monotonicMs: () => performance.now(),
});
type Scope = "ISOLATED_ONLY" | "PRODUCTION_PRICE_EVIDENCE";
declare const pointBrand: unique symbol;
export type VerifiedOpenNavPoint = Readonly<{
  scope: "PRODUCTION_PRICE_EVIDENCE";
  [pointBrand]: true;
}>;
export type IsolatedOpenNavPoint = Readonly<{
  scope: "ISOLATED_ONLY";
  [pointBrand]: true;
}>;
type PointData = Readonly<{
  scope: Scope;
  policy: PythNavCollectorPolicy;
  clock: ServerClock;
  receivedAtUnix: number;
  receivedAtMonotonic: number;
  contextSlot: number;
  chainTimeUnix: number;
  rawQuotes: Readonly<
    Record<C3AssetId, ReturnType<typeof decodePythPriceUpdateV2>>
  >;
}>;
const points = new WeakMap<object, PointData>();

function evaluated(data: PointData) {
  const wall = integer(data.clock.nowUnix());
  const mono = data.clock.monotonicMs();
  if (
    !Number.isFinite(mono) ||
    mono < data.receivedAtMonotonic ||
    wall < data.receivedAtUnix ||
    Math.abs(
      (wall - data.receivedAtUnix) * 1000 - (mono - data.receivedAtMonotonic),
    ) > 2000
  )
    fail("CLOCK_REGRESSION");
  const now = Math.max(
    wall,
    data.receivedAtUnix + Math.floor((mono - data.receivedAtMonotonic) / 1000),
  );
  const prices = {} as Record<C3AssetId, string>;
  const hashes = {} as Record<C3AssetId, string>;
  const freshness = {} as Record<
    C3AssetId,
    Readonly<{
      publishedAtUnix: number;
      maximumAgeSeconds: number;
      maximumChainClockSkewSeconds: number;
    }>
  >;
  for (const asset of ASSETS) {
    const f = data.policy.feeds[asset];
    const source: OpenNavDirectSource = {
      asset: f.asset,
      mint: f.mint,
      operatorId: f.operatorId,
      feedId: f.feedId,
      account: f.account,
      ownerProgram: f.ownerProgram,
      maximumAgeSeconds: f.maximumAgeSeconds,
      maximumConfidenceBps: f.maximumConfidenceBps,
      maximumChainClockSkewSeconds: f.maximumChainClockSkewSeconds,
    };
    const q = data.rawQuotes[asset];
    prices[asset] = decodeOpenNavDirectQuote(
      {
        asset,
        mint: source.mint,
        quoteCurrency: "USD",
        priceKind: "direct",
        operatorId: source.operatorId,
        feedId: source.feedId,
        account: source.account,
        ownerProgram: source.ownerProgram,
        genesisHash: C3_MAINNET.genesisHash,
        commitment: "finalized",
        contextSlot: data.contextSlot,
        priceMantissa: q.priceMantissa,
        confidenceMantissa: q.confidenceMantissa,
        exponent: q.exponent,
        publishTimeUnix: q.publishTimeUnix,
        receivedTimeUnix: data.receivedAtUnix,
        evidenceHash: q.evidenceHash,
      },
      source,
      {
        genesisHash: C3_MAINNET.genesisHash,
        finalizedSlot: data.contextSlot,
        chainTimeUnix: data.chainTimeUnix,
        evaluatedAtUnix: now,
      },
    ).priceUsdE12;
    hashes[asset] = q.evidenceHash;
    freshness[asset] = Object.freeze({
      publishedAtUnix: q.publishTimeUnix,
      maximumAgeSeconds: f.maximumAgeSeconds,
      maximumChainClockSkewSeconds: f.maximumChainClockSkewSeconds,
    });
  }
  return Object.freeze({
    status: "PYTH_FULL_QUORUM_PRICES_NOT_NAV" as const,
    evidenceScope: data.scope,
    contextSlot: data.contextSlot,
    chainTimeUnix: data.chainTimeUnix,
    evaluatedAtUnix: now,
    pricesUsdE12: Object.freeze(prices),
    evidenceHashes: Object.freeze(hashes),
    freshness: Object.freeze(freshness),
    economicOracleOperators: 1 as const,
  });
}

async function collect(
  p: PythNavCollectorPolicy,
  ports: readonly OpenNavRpcReadPort[],
  clock: ServerClock,
  scope: Scope,
) {
  const startedWall = integer(clock.nowUnix()),
    start = clock.monotonicMs();
  if (!Number.isFinite(start) || start < 0) fail("CLOCK");
  const check = () => {
    const wall = integer(clock.nowUnix()),
      mono = clock.monotonicMs();
    if (
      !Number.isFinite(mono) ||
      mono < start ||
      wall < startedWall ||
      mono - start > p.maximumCollectionMs ||
      Math.abs((wall - startedWall) * 1000 - (mono - start)) > 2000
    )
      fail("DEADLINE_OR_CLOCK");
  };
  const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
    check();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const left = p.maximumCollectionMs - (clock.monotonicMs() - start);
      const result = await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("C3_OPEN_NAV_COLLECTOR_TIMEOUT")),
            left,
          );
        }),
      ]);
      check();
      return result;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  const genesis = await bounded(() =>
    Promise.all(ports.map((x) => x.getGenesisHash())),
  );
  if (genesis.some((x) => x !== C3_MAINNET.genesisHash)) fail("GENESIS");
  const slots = await bounded(() =>
    Promise.all(ports.map((x) => x.getFinalizedSlot())),
  );
  const minimum = Math.max(...slots.map((x) => integer(x)));
  const addresses = Object.freeze([
    CLOCK,
    PYTH_NAV_RECEIVER,
    p.receiverProgramData,
    ...ASSETS.map((a) => p.feeds[a].account),
  ]);
  const snapshots = await bounded(() =>
    Promise.all(ports.map((x) => x.getFinalizedAccounts(addresses, minimum))),
  );
  const parsed = snapshots.map((v) => {
    const r = object(v),
      slot = integer(object(r.context).slot);
    if (
      slot < minimum ||
      !Array.isArray(r.value) ||
      r.value.length !== addresses.length
    )
      fail("CONTEXT");
    const data = r.value.map((a, i) =>
      account(
        a,
        i === 0 ? SYSVAR : i < 3 ? LOADER : PYTH_NAV_RECEIVER,
        i === 1,
      ),
    );
    return { slot, data };
  });
  const [a, b] = parsed;
  if (
    !a ||
    !b ||
    a.slot !== b.slot ||
    a.data.some((bytes, i) => !bytes.equals(b.data[i]!))
  )
    fail("QUORUM");
  const clockBytes = a.data[0]!,
    program = a.data[1]!,
    programData = a.data[2]!;
  if (
    clockBytes.length !== 40 ||
    clockBytes.readBigUInt64LE(0) !== BigInt(a.slot)
  )
    fail("CLOCK_ACCOUNT");
  const chainTimeUnix = positiveTime(clockBytes.readBigInt64LE(32));
  if (
    program.length !== 36 ||
    program.readUInt32LE(0) !== 2 ||
    encodeBase58(program.subarray(4)) !== p.receiverProgramData ||
    programData.length < 45 ||
    programData.readUInt32LE(0) !== 3 ||
    programData.readBigUInt64LE(4) > BigInt(a.slot) ||
    ![0, 1].includes(programData[12]!) ||
    hash(programData) !== p.receiverProgramDataHash
  )
    fail("RECEIVER_VERSION");
  const rawQuotes = {} as Record<
    C3AssetId,
    ReturnType<typeof decodePythPriceUpdateV2>
  >;
  ASSETS.forEach((asset, i) => {
    rawQuotes[asset] = decodePythPriceUpdateV2(
      {
        owner: PYTH_NAV_RECEIVER,
        executable: false,
        data: [a.data[i + 3]!.toString("base64"), "base64"],
      },
      p.feeds[asset],
      a.slot,
    );
  });
  const publications = ASSETS.map((x) => rawQuotes[x].publishTimeUnix);
  if (
    Math.max(...publications) - Math.min(...publications) >
    p.maximumPublishSpreadSeconds
  )
    fail("PUBLISH_SPREAD");
  check();
  const data: PointData = Object.freeze({
    scope,
    policy: p,
    clock,
    receivedAtUnix: integer(clock.nowUnix()),
    receivedAtMonotonic: clock.monotonicMs(),
    contextSlot: a.slot,
    chainTimeUnix,
    rawQuotes: Object.freeze(rawQuotes),
  });
  evaluated(data);
  check();
  const point = Object.freeze({ scope });
  points.set(point, data);
  return point;
}

/** Synthetic RPC/clock injection is explicitly isolated, never production.
 * The returned closure copies pins/port method references BEFORE any await.
 */
export function createIsolatedOpenNavCollector(
  policy: PythNavCollectorPolicy,
  ports: readonly OpenNavRpcReadPort[],
  clock: ServerClock = serverClock,
) {
  const p = copiedPolicy(policy);
  if (
    ports.length !== 2 ||
    ports.some(
      (x) =>
        !/^[a-z][a-z0-9-]{2,63}$/.test(x.providerId) ||
        !/^[a-z][a-z0-9-]{2,63}$/.test(x.operatorId),
    ) ||
    ports[0]!.providerId === ports[1]!.providerId ||
    ports[0]!.operatorId === ports[1]!.operatorId
  )
    fail("INDEPENDENT_RPC_PORTS");
  const fixed = Object.freeze(
    ports.map((x) =>
      Object.freeze({
        providerId: x.providerId,
        operatorId: x.operatorId,
        getGenesisHash: x.getGenesisHash.bind(x),
        getFinalizedSlot: x.getFinalizedSlot.bind(x),
        getFinalizedAccounts: x.getFinalizedAccounts.bind(x),
      }),
    ),
  );
  const fixedClock = Object.freeze({
    nowUnix: clock.nowUnix.bind(clock),
    monotonicMs: clock.monotonicMs.bind(clock),
  });
  return Object.freeze({
    collect: async () =>
      (await collect(
        p,
        fixed,
        fixedClock,
        "ISOLATED_ONLY",
      )) as IsolatedOpenNavPoint,
  });
}
export function evaluateIsolatedOpenNavPoint(point: IsolatedOpenNavPoint) {
  const d = point && typeof point === "object" ? points.get(point) : undefined;
  if (!d || d.scope !== "ISOLATED_ONLY") return missing("POINT_NOT_VERIFIED");
  try {
    return evaluated(d);
  } catch {
    return missing("PRICE_POINT_EXPIRED");
  }
}
/** Prices only. Neither this API nor the isolated variant returns NAV/success
 * for caller inventory. Serialized or isolated points cannot be promoted.
 */
export function evaluateVerifiedOpenNav(point: VerifiedOpenNavPoint) {
  const d = point && typeof point === "object" ? points.get(point) : undefined;
  if (!d || d.scope !== "PRODUCTION_PRICE_EVIDENCE")
    return missing("POINT_NOT_VERIFIED");
  try {
    requireOpenProductionPolicy();
  } catch {
    return missing("PRODUCTION_NOT_APPROVED");
  }
  try {
    return evaluated(d);
  } catch {
    return missing("PRICE_POINT_EXPIRED");
  }
}

function productionPort(provider: ReviewedRpcProvider): OpenNavRpcReadPort {
  const read = async (method: string, params: unknown[]) => {
    const response = await fetch(provider.endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.body) fail("RPC_HTTP");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const v = await reader.read();
        if (v.done) break;
        size += v.value.length;
        if (size > 4_000_000) {
          await reader.cancel();
          fail("RPC_SIZE");
        }
        chunks.push(v.value);
      }
    } finally {
      reader.releaseLock();
    }
    const r = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (r.jsonrpc !== "2.0" || r.id !== 1 || r.error || r.result == null)
      fail("RPC_RESPONSE");
    return r.result;
  };
  return Object.freeze({
    providerId: provider.providerId,
    operatorId: provider.operatorId,
    getGenesisHash: () => read("getGenesisHash", []),
    getFinalizedSlot: () => read("getSlot", [{ commitment: "finalized" }]),
    getFinalizedAccounts: (
      addresses: readonly string[],
      minContextSlot: number,
    ) =>
      read("getMultipleAccounts", [
        addresses,
        { commitment: "finalized", encoding: "base64", minContextSlot },
      ]),
  });
}
/** No args: production policy, ports and clocks are never caller overrides. */
export async function collectVerifiedOpenNavPoint(): Promise<
  VerifiedOpenNavPoint | OpenNavUnavailable
> {
  let production;
  try {
    production = requireOpenProductionPolicy();
  } catch {
    return missing("PRODUCTION_NOT_APPROVED");
  }
  if (PINNED_OPEN_NAV_COLLECTOR_POLICY === null)
    return missing("SOURCE_POLICY_NOT_PINNED");
  const policy = copiedPolicy(PINNED_OPEN_NAV_COLLECTOR_POLICY);
  assertIndependentRpcProviders(production.providers);
  if (
    new URL(production.providers[0]!.endpoint).hostname
      .toLowerCase()
      .replace(/\.$/, "") ===
    new URL(production.providers[1]!.endpoint).hostname
      .toLowerCase()
      .replace(/\.$/, "")
  )
    fail("RPC_HOST_ALIAS");
  const fixedProviders = production.providers.map((p) =>
    Object.freeze({ ...p }),
  );
  return (await collect(
    policy,
    fixedProviders.map(productionPort),
    serverClock,
    "PRODUCTION_PRICE_EVIDENCE",
  )) as VerifiedOpenNavPoint;
}
