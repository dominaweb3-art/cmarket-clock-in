/** Read-only second collector. This provider is an aggregate market mark, NOT
 * an independent oracle or executable quote. Absence of pool lineage, depth,
 * TWAP and manipulation proofs keeps every live observation INELIGIBLE.
 * https://developers.jup.ag/docs/price (methodology and blockId semantics).
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { C3_MAINNET_ASSET_REGISTRY as registry } from "../../src/registry.ts";
import { C3_MAINNET as c } from "../../src/constants.ts";
import { decimalE12 } from "./exact-market-evidence.ts";
const ASSETS = ["USDC", "cbBTC", "PortalETH", "WSOL"] as const;
export function inspectJupiterMarketPrices(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("C3_JUPITER_PRICE_SHAPE");
  const rows = input as Record<string, unknown>;
  const expected = ASSETS.map((a) => registry[a].mint);
  if (Object.keys(rows).some((k) => !expected.includes(k)))
    throw Error("C3_JUPITER_PRICE_UNREQUESTED_MINT");
  return ASSETS.map((asset) => {
    const row = rows[registry[asset].mint];
    if (row === undefined)
      return {
        asset,
        mint: registry[asset].mint,
        status: "UNAVAILABLE" as const,
        eligibleForNav: false as const,
      };
    if (!row || typeof row !== "object" || Array.isArray(row))
      throw Error("C3_JUPITER_PRICE_ROW");
    const r = row as Record<string, unknown>;
    if (
      r.decimals !== registry[asset].decimals ||
      typeof r.blockId !== "number" ||
      !Number.isSafeInteger(r.blockId) ||
      r.blockId < 1 ||
      typeof r.usdPrice !== "number" ||
      !Number.isFinite(r.usdPrice) ||
      r.usdPrice <= 0
    )
      throw Error("C3_JUPITER_PRICE_BINDING");
    // JSON numeric precision is provider precision, not exact token arithmetic.
    // Informational only: conservatively truncate to E12; never monetary authority.
    const price = decimalE12(String(r.usdPrice));
    return {
      asset,
      mint: registry[asset].mint,
      status: "INFORMATIONAL_MARKET" as const,
      priceUsdE12: price.toString(),
      blockId: r.blockId,
      eligibleForNav: false as const,
      publishedAtUnix: null,
      confidence: null,
      upstreamPoolIds: null,
      oracleDependencies: null,
      liquidityReportedUsd:
        typeof r.liquidity === "number" &&
        Number.isFinite(r.liquidity) &&
        r.liquidity >= 0
          ? r.liquidity
          : null,
      blockers: [
        "UPSTREAM_LINEAGE_UNDISCLOSED",
        "TWAP_DEPTH_MANIPULATION_EVIDENCE_ABSENT",
      ],
    };
  });
}
async function json(url: string, body?: object) {
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!r.ok) return { http: r.status, data: null, hash: null };
  if (!r.body) throw Error("C3_JUPITER_PRICE_BODY");
  const reader = r.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const v = await reader.read();
      if (v.done) break;
      size += v.value.length;
      if (size > 128000) {
        await reader.cancel();
        throw Error("C3_JUPITER_PRICE_SIZE");
      }
      chunks.push(v.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  return {
    http: r.status,
    data: JSON.parse(bytes.toString()) as unknown,
    hash: createHash("sha256").update(bytes).digest("hex"),
  };
}
export async function collectJupiterMarketEvidence() {
  const startedAt = new Date().toISOString();
  // Exactly one keyless Jupiter call; no key, retry, wallet, transaction or storage.
  const result = await json(
    "https://api.jup.ag/price/v3?ids=" +
      ASSETS.map((a) => registry[a].mint).join(","),
  );
  if (result.data === null)
    return {
      startedAt,
      http: result.http,
      status: "UNAVAILABLE",
      decision: "BLOCKED",
      reason: "OFFICIAL_PRICE_HTTP_UNAVAILABLE",
    };
  const rows = inspectJupiterMarketPrices(result.data);
  let id = 0;
  const rpc = async (method: string, params: unknown[]) => {
    const n = ++id,
      v = await json("https://api.mainnet-beta.solana.com", {
        jsonrpc: "2.0",
        id: n,
        method,
        params,
      });
    const r = v.data as {
      jsonrpc?: string;
      id?: number;
      error?: unknown;
      result?: unknown;
    } | null;
    if (
      !r ||
      r.jsonrpc !== "2.0" ||
      r.id !== n ||
      r.error ||
      r.result === undefined
    )
      throw Error("C3_JUPITER_PRICE_RPC");
    return r.result;
  };
  if ((await rpc("getGenesisHash", [])) !== c.genesisHash)
    throw Error("C3_JUPITER_PRICE_GENESIS");
  const finalized = await rpc("getSlot", [{ commitment: "finalized" }]);
  if (
    typeof finalized !== "number" ||
    !Number.isSafeInteger(finalized) ||
    finalized < 1
  )
    throw Error("C3_JUPITER_PRICE_SLOT");
  const times = new Map<number, unknown>();
  for (const row of rows)
    if ("blockId" in row && !times.has(row.blockId))
      times.set(row.blockId, await rpc("getBlockTime", [row.blockId]));
  // Check after the final RPC, not against collection-start wall time.
  const now = Math.floor(Date.now() / 1000);
  const evidence = rows.map((row) => {
    if (!("blockId" in row)) return row;
    const t = times.get(row.blockId),
      recent =
        typeof t === "number" &&
        Number.isSafeInteger(t) &&
        t > 0 &&
        t <= now &&
        now - t <= 60 &&
        row.blockId <= finalized;
    return {
      ...row,
      slotTimestampUnix: t ?? null,
      finalizedObservation: row.blockId <= finalized,
      observationFreshWithin60Seconds: recent,
    };
  });
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    http: result.http,
    responseHash: result.hash,
    finalizedSlot: finalized,
    evidence,
    status: "MARKET_CONTRAST_ONLY",
    decision: "BLOCKED",
    economicIndependence: "UNVERIFIED_NOT_COUNTED",
    rpcEvidence: "SINGLE_PUBLIC_RPC_NOT_PRODUCTION_QUORUM",
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await collectJupiterMarketEvidence(), null, 2));
    process.exitCode = 2;
  } catch {
    console.log(
      JSON.stringify({
        decision: "BLOCKED",
        reason: "MARKET_OR_RPC_EVIDENCE_UNAVAILABLE",
      }),
    );
    process.exitCode = 2;
  }
}
