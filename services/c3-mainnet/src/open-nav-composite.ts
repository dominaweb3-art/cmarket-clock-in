/** Candidate ONLY. Injected source adapters can issue isolated evidence, never
 * production approval. Market bounds are NOT an oracle confidence interval.
 * A production collector still needs reviewed, authenticated upstream proofs.
 */
import { createHash } from "node:crypto";
import { canonicalize } from "./manifest.ts";
import {
  C3_MAINNET_ASSET_REGISTRY as registry,
  type C3AssetId,
} from "./registry.ts";
type ServerClock = Readonly<{ nowUnix(): number; monotonicMs(): number }>;

const ASSETS = ["USDC", "cbBTC", "PortalETH", "WSOL"] as const;
const U128 = (1n << 128n) - 1n;
const SCALE = 1_000_000_000_000n;
const sha = (v: unknown) =>
  createHash("sha256").update(canonicalize(v)).digest("hex");
function need(v: unknown, code: string): asserts v {
  if (!v) throw Error("C3_COMPOSITE_" + code);
}
function uint(v: unknown, positive = true) {
  need(
    typeof v === "string" &&
      /^[0-9]{1,39}$/.test(v) &&
      /^(0|[1-9][0-9]*)$/.test(v),
    "INTEGER",
  );
  const n = BigInt(v);
  need(n <= U128 && (!positive || n > 0n), "INTEGER");
  return n;
}
function int(
  v: unknown,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
): asserts v is number {
  need(
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max,
    "INTEGER",
  );
}
function exact(v: unknown, keys: readonly string[]) {
  need(v !== null && typeof v === "object" && !Array.isArray(v), "SHAPE");
  need([Object.prototype, null].includes(Object.getPrototypeOf(v)), "SHAPE");
  need(
    Reflect.ownKeys(v).length === keys.length &&
      keys.every(
        (k) =>
          Object.hasOwn(v, k) &&
          "value" in Object.getOwnPropertyDescriptor(v, k)!,
      ),
    "SHAPE",
  );
}
/** Bounded data snapshot before canonicalization; never invoke untrusted getters,
 * toJSON/prototypes, accept undefined/NaN, or recurse through cycles. */
function snapshot<T>(v: T): T {
  let count = 0;
  const seen = new Set<object>();
  const check = (x: unknown, depth: number): void => {
    need(++count <= 10000 && depth <= 10, "SHAPE");
    if (x === null || typeof x === "boolean") return;
    if (typeof x === "string") {
      need(x.length <= 1000, "SHAPE");
      return;
    }
    if (typeof x === "number") {
      need(Number.isSafeInteger(x), "INTEGER");
      return;
    }
    need(typeof x === "object" && x !== null && !seen.has(x), "SHAPE");
    seen.add(x);
    if (Array.isArray(x)) {
      need(
        Object.getPrototypeOf(x) === Array.prototype &&
          x.length <= 64 &&
          Reflect.ownKeys(x).length === x.length + 1 &&
          Object.keys(x).length === x.length,
        "SHAPE",
      );
      for (let j = 0; j < x.length; j++) {
        const d = Object.getOwnPropertyDescriptor(x, String(j));
        need(d && "value" in d, "SHAPE");
        check(d.value, depth + 1);
      }
    } else {
      need(
        [Object.prototype, null].includes(Object.getPrototypeOf(x)),
        "SHAPE",
      );
      for (const k of Reflect.ownKeys(x)) {
        need(typeof k === "string", "SHAPE");
        const d = Object.getOwnPropertyDescriptor(x, k);
        need(d && "value" in d, "SHAPE");
        check(d.value, depth + 1);
      }
    }
    seen.delete(x);
  };
  check(v, 0);
  return JSON.parse(canonicalize(v)) as T;
}
function ids(v: unknown) {
  need(
    Array.isArray(v) &&
      v.length > 0 &&
      v.length <= 16 &&
      v.every(
        (x) => typeof x === "string" && /^[a-zA-Z0-9:/._-]{3,160}$/.test(x),
      ) &&
      new Set(v).size === v.length,
    "PROVENANCE",
  );
  return v as string[];
}
function bps(a: bigint, b: bigint) {
  const n = (a > b ? a - b : b - a) * 10_000n,
    d = a < b ? a : b;
  return (n + d - 1n) / d;
}

export const OPEN_COMPOSITE_CANDIDATE = Object.freeze({
  version: "c3-composite-isolated/v1" as const,
  approval: "NOT_MAINNET_APPROVED" as const,
  maximumAgeSeconds: 60,
  maximumDivergenceBps: 100,
  maximumOracleConfidenceBps: 200,
  minimumWindowSeconds: 300,
  maximumSampleGapSeconds: 60,
  minimumLiquidityUsdE12: (100_000n * SCALE).toString(),
  minimumDepthWithin100BpsUsdE12: (100n * SCALE).toString(),
  // A separate measured cost bound, never inferred from TVL or reported volume.
  minimumManipulationCostUsdE12: (100n * SCALE).toString(),
  maximumPilotExposureUsdE12: SCALE.toString(),
});
type Common = Readonly<{
  asset: C3AssetId;
  mint: string;
  sourceId: string;
  operatorId: string;
  upstreamIds: readonly string[];
  poolIds: readonly string[];
  priceUsdE12: string;
  evidenceHash: string;
  contextSlot: number;
}>;
export type CompositeObservation = Common &
  (
    | Readonly<{
        kind: "oracle";
        publishedAtUnix: number;
        confidenceUsdE12: string;
      }>
    | Readonly<{
        kind: "market";
        observedAtUnix: number;
        lastTradeAtUnix: number;
        windowStartUnix: number;
        samples: readonly Readonly<{ timeUnix: number; priceUsdE12: string }>[];
        liquidityUsdE12: string;
        depthWithin100BpsUsdE12: string;
        manipulationCostUsdE12: string;
      }>
  );
/** Server-internal isolated adapters. Review pins must describe all dependencies,
 * including USD anchors. Different HTTP vendors reading one pool fail admission.
 * These injected proofs are test fixtures, NOT live authenticated market evidence.
 */
export type CompositeSourcePort = Readonly<{
  sourceId: string;
  operatorId: string;
  kinds: Readonly<Record<C3AssetId, "oracle" | "market">>;
  upstreamIds: Readonly<Record<C3AssetId, readonly string[]>>;
  poolIds: Readonly<Record<C3AssetId, readonly string[]>>;
  read: () => Promise<Readonly<Record<C3AssetId, CompositeObservation>>>;
}>;
declare const BRAND: unique symbol;
export type IsolatedCompositePoint = Readonly<{
  scope: "ISOLATED_ONLY";
  [BRAND]: true;
}>;
type Data = {
  sources: readonly Readonly<Record<C3AssetId, CompositeObservation>>[];
  clock: ServerClock;
  received: number;
  mono: number;
};
const points = new WeakMap<object, Data>();
function observation(o: CompositeObservation, asset: C3AssetId, now: number) {
  const common = [
    "asset",
    "mint",
    "sourceId",
    "operatorId",
    "upstreamIds",
    "poolIds",
    "priceUsdE12",
    "evidenceHash",
    "contextSlot",
    "kind",
  ];
  exact(o, [
    ...common,
    ...(o.kind === "oracle"
      ? ["publishedAtUnix", "confidenceUsdE12"]
      : [
          "observedAtUnix",
          "lastTradeAtUnix",
          "windowStartUnix",
          "samples",
          "liquidityUsdE12",
          "depthWithin100BpsUsdE12",
          "manipulationCostUsdE12",
        ]),
  ]);
  need(o.asset === asset && o.mint === registry[asset].mint, "EXACT_MINT");
  need(
    /^[a-f0-9]{64}$/.test(o.evidenceHash) && !/^0+$/.test(o.evidenceHash),
    "EVIDENCE_HASH",
  );
  int(o.contextSlot);
  ids(o.upstreamIds);
  need(
    Array.isArray(o.poolIds) && (o.poolIds.length === 0 || ids(o.poolIds)),
    "POOLS",
  );
  const price = uint(o.priceUsdE12);
  const recent = (t: number) => {
    int(t);
    need(
      t <= now && now - t <= OPEN_COMPOSITE_CANDIDATE.maximumAgeSeconds,
      "STALE_SOURCE",
    );
  };
  if (o.kind === "oracle") {
    recent(o.publishedAtUnix);
    need(
      uint(o.confidenceUsdE12, false) * 10_000n <= price * 200n,
      "ORACLE_CONFIDENCE",
    );
    return { price, asOf: o.publishedAtUnix };
  }
  need(o.kind === "market" && o.poolIds.length > 0, "MARKET_KIND");
  recent(o.observedAtUnix);
  recent(o.lastTradeAtUnix);
  need(o.lastTradeAtUnix <= o.observedAtUnix, "TRADE_AFTER_OBSERVATION");
  int(o.windowStartUnix);
  need(
    o.observedAtUnix - o.windowStartUnix >= 300 &&
      o.observedAtUnix - o.windowStartUnix <= 600,
    "WINDOW",
  );
  need(
    Array.isArray(o.samples) && o.samples.length >= 6 && o.samples.length <= 64,
    "SAMPLES",
  );
  let weighted = 0n,
    duration = 0;
  for (let i = 0; i < o.samples.length; i++) {
    const s = o.samples[i]!;
    exact(s, ["timeUnix", "priceUsdE12"]);
    int(s.timeUnix);
    const n = uint(s.priceUsdE12);
    need(bps(n, price) <= 100n, "MARKET_WINDOW_VOLATILITY");
    if (i === 0) need(s.timeUnix === o.windowStartUnix, "WINDOW_START");
    const next = o.samples[i + 1]?.timeUnix ?? o.observedAtUnix;
    int(next);
    const gap = next - s.timeUnix;
    need(
      gap >= (i + 1 === o.samples.length ? 0 : 1) && gap <= 60,
      "SAMPLE_GAP",
    );
    weighted += n * BigInt(gap);
    duration += gap;
  }
  need(
    duration === o.observedAtUnix - o.windowStartUnix &&
      weighted / BigInt(duration) === price,
    "TWAP_MISMATCH",
  );
  need(
    uint(o.liquidityUsdE12) >=
      uint(OPEN_COMPOSITE_CANDIDATE.minimumLiquidityUsdE12) &&
      uint(o.depthWithin100BpsUsdE12) >=
        uint(OPEN_COMPOSITE_CANDIDATE.minimumDepthWithin100BpsUsdE12) &&
      uint(o.manipulationCostUsdE12) >=
        uint(OPEN_COMPOSITE_CANDIDATE.minimumManipulationCostUsdE12),
    "MARKET_MANIPULATION_BOUNDS",
  );
  return { price, asOf: o.observedAtUnix };
}
function evaluate(d: Data) {
  const wall = d.clock.nowUnix(),
    mono = d.clock.monotonicMs();
  int(wall);
  need(
    Number.isFinite(mono) &&
      mono >= d.mono &&
      wall >= d.received &&
      mono - d.mono <= 60_000 &&
      Math.abs((wall - d.received) * 1000 - (mono - d.mono)) <= 2000,
    "CLOCK",
  );
  // Already-old sources expire on elapsed monotonic time even if wall time
  // stalls within its permitted skew. Never extend lifetime by clock tolerance.
  const now = Math.max(wall, d.received + Math.ceil((mono - d.mono) / 1000));
  const prices = {} as Record<C3AssetId, string>,
    freshness = {} as Record<
      C3AssetId,
      {
        observedAtUnix: number;
        maximumAgeSeconds: number;
        maximumChainClockSkewSeconds: number;
      }
    >,
    hashes = {} as Record<C3AssetId, string>;
  const slots: number[] = [];
  for (const asset of ASSETS) {
    const a = d.sources[0]![asset],
      b = d.sources[1]![asset];
    const x = observation(a, asset, now),
      y = observation(b, asset, now);
    need(bps(x.price, y.price) <= 100n, "DIVERGENCE");
    prices[asset] = ((x.price + y.price) / 2n).toString();
    freshness[asset] = {
      observedAtUnix: Math.min(x.asOf, y.asOf),
      maximumAgeSeconds: 60,
      maximumChainClockSkewSeconds: 5,
    };
    hashes[asset] = sha([a, b]);
    slots.push(a.contextSlot, b.contextSlot);
  }
  need(Math.max(...slots) - Math.min(...slots) <= 150, "SLOT_SPREAD");
  return Object.freeze({
    status: "COMPOSITE_CANDIDATE_NOT_PRODUCTION" as const,
    evidenceScope: "ISOLATED_ONLY" as const,
    contextSlot: Math.max(...slots),
    evaluatedAtUnix: now,
    pricesUsdE12: Object.freeze(prices),
    freshness: Object.freeze(freshness),
    evidenceHashes: Object.freeze(hashes),
    economicOracleOperators: 0 as const,
  });
}
export function createIsolatedCompositeCollector(
  ports: readonly CompositeSourcePort[],
  clock: ServerClock,
) {
  need(ports.length === 2, "SOURCE_COUNT");
  const fixed = ports.map((p) => {
    exact(p, [
      "sourceId",
      "operatorId",
      "kinds",
      "upstreamIds",
      "poolIds",
      "read",
    ]);
    need(typeof p.read === "function", "PORT");
    need(
      /^[a-z][a-z0-9-]{2,63}$/.test(p.sourceId) &&
        /^[a-z][a-z0-9-]{2,63}$/.test(p.operatorId),
      "SOURCE_ID",
    );
    const pins = snapshot({
      sourceId: p.sourceId,
      operatorId: p.operatorId,
      kinds: p.kinds,
      upstreamIds: p.upstreamIds,
      poolIds: p.poolIds,
    });
    exact(pins.upstreamIds, ASSETS);
    exact(pins.poolIds, ASSETS);
    exact(pins.kinds, ASSETS);
    for (const a of ASSETS) {
      need(["oracle", "market"].includes(pins.kinds[a]), "SOURCE_KIND");
      ids(pins.upstreamIds[a]);
      need(
        Array.isArray(pins.poolIds[a]) &&
          (pins.poolIds[a].length === 0 || ids(pins.poolIds[a])),
        "POOLS",
      );
    }
    return { pins, read: p.read.bind(p) };
  });
  const [a, b] = fixed;
  need(
    a!.pins.sourceId !== b!.pins.sourceId &&
      a!.pins.operatorId !== b!.pins.operatorId,
    "INDEPENDENCE",
  );
  // Global, not just per-mint: shared USD anchors and hidden cross-asset pools
  // invalidate economic independence even when requested token symbols differ.
  const dependencies = (p: (typeof fixed)[number]) =>
    new Set(
      ASSETS.flatMap((x) => [...p.pins.upstreamIds[x], ...p.pins.poolIds[x]]),
    );
  const depA = dependencies(a!);
  need(
    [...dependencies(b!)].every((x) => !depA.has(x)),
    "SHARED_UPSTREAM_OR_POOL",
  );
  const fixedClock = Object.freeze({
    nowUnix: clock.nowUnix.bind(clock),
    monotonicMs: clock.monotonicMs.bind(clock),
  });
  return Object.freeze({
    collect: async (): Promise<IsolatedCompositePoint> => {
      const received = fixedClock.nowUnix(),
        mono = fixedClock.monotonicMs();
      int(received);
      need(Number.isFinite(mono) && mono >= 0, "CLOCK");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const sources = await Promise.race([
          Promise.all(
            fixed.map(async (p) => {
              const result = await p.read();
              exact(result, ASSETS);
              const copy = snapshot(result) as Record<
                C3AssetId,
                CompositeObservation
              >;
              for (const asset of ASSETS) {
                const o = copy[asset];
                need(
                  o.sourceId === p.pins.sourceId &&
                    o.operatorId === p.pins.operatorId &&
                    o.kind === p.pins.kinds[asset] &&
                    canonicalize(o.upstreamIds) ===
                      canonicalize(p.pins.upstreamIds[asset]) &&
                    canonicalize(o.poolIds) ===
                      canonicalize(p.pins.poolIds[asset]),
                  "PIN_SUBSTITUTION",
                );
              }
              return copy;
            }),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(Error("C3_COMPOSITE_TIMEOUT")),
              8000,
            );
          }),
        ]);
        need(fixedClock.monotonicMs() - mono <= 8000, "TIMEOUT");
        const data = { sources, clock: fixedClock, received, mono };
        evaluate(data);
        const point = Object.freeze({
          scope: "ISOLATED_ONLY" as const,
        }) as IsolatedCompositePoint;
        points.set(point, data);
        return point;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  });
}
export function evaluateIsolatedCompositePoint(p: unknown) {
  const d = p && typeof p === "object" ? points.get(p) : undefined;
  if (!d)
    return { status: "UNAVAILABLE" as const, reason: "POINT_NOT_VERIFIED" };
  try {
    return evaluate(d);
  } catch {
    return {
      status: "UNAVAILABLE" as const,
      reason: "COMPOSITE_PRICE_EXPIRED_OR_CONTRADICTORY",
    };
  }
}
