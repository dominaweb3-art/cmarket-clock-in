import {
  createIsolatedCompositeCollector,
  type CompositeObservation,
  type CompositeSourcePort,
} from "../../src/open-nav-composite.ts";
import {
  C3_MAINNET_ASSET_REGISTRY as registry,
  type C3AssetId,
} from "../../src/registry.ts";
const assets = ["USDC", "cbBTC", "PortalETH", "WSOL"] as const;
/** Synthetic, disjoint-market proofs. NOT live liquidity/independence evidence. */
export function compositeFixture(now = 1800000000, slot = 100) {
  const times = { wall: now, mono: 0 };
  let onRead = () => {};
  const sources: Record<C3AssetId, CompositeObservation>[] = [
    "venue-alpha",
    "venue-beta",
  ].map(
    (name, j) =>
      Object.fromEntries(
        assets.map((asset) => {
          const price = asset === "USDC" ? "980000000000" : "2000000000000";
          return [
            asset,
            {
              asset,
              mint: registry[asset].mint,
              kind: "market",
              sourceId: name,
              operatorId: name,
              upstreamIds: [name + "/" + asset + "/USD"],
              poolIds: [name + "/" + asset + "-usd"],
              priceUsdE12: price,
              evidenceHash: String(j + 1).repeat(64),
              contextSlot: slot,
              observedAtUnix: now,
              lastTradeAtUnix: now - 1,
              windowStartUnix: now - 300,
              samples: Array.from({ length: 6 }, (_, i) => ({
                timeUnix: now - 300 + i * 60,
                priceUsdE12: price,
              })),
              liquidityUsdE12: "100000000000000000",
              depthWithin100BpsUsdE12: "100000000000000",
              manipulationCostUsdE12: "100000000000000",
            },
          ];
        }),
      ) as unknown as Record<C3AssetId, CompositeObservation>,
  );
  const make = () => {
    const ports: CompositeSourcePort[] = sources.map((s) => ({
      sourceId: s.USDC.sourceId,
      operatorId: s.USDC.operatorId,
      kinds: Object.fromEntries(
        assets.map((a) => [a, s[a].kind]),
      ) as CompositeSourcePort["kinds"],
      upstreamIds: Object.fromEntries(
        assets.map((a) => [a, s[a].upstreamIds]),
      ) as CompositeSourcePort["upstreamIds"],
      poolIds: Object.fromEntries(
        assets.map((a) => [a, s[a].poolIds]),
      ) as CompositeSourcePort["poolIds"],
      read: async () => {
        onRead();
        return s;
      },
    }));
    return createIsolatedCompositeCollector(ports, {
      nowUnix: () => times.wall,
      monotonicMs: () => times.mono,
    });
  };
  return {
    sources,
    times,
    make,
    setRead: (f: () => void) => {
      onRead = f;
    },
  };
}
