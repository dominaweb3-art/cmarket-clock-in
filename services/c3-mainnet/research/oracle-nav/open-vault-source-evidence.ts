/** Official, keyless, READ-ONLY discovery. Never a production oracle adapter.
 * Catalog symbols / parsed prices cannot certify an exact mint or independence.
 * No environment loading, transaction construction, credentials or wallet API.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { C3_MAINNET } from "../../src/constants.ts";
import { C3_MAINNET_ASSET_REGISTRY as registry } from "../../src/registry.ts";

export function inspectCatalog(input: unknown) {
  if (!Array.isArray(input) || input.length > 30_000)
    throw Error("CATALOG_SHAPE");
  const rows: { feedId: string; symbol: string }[] = [];
  for (const row of input) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.id) ||
      typeof row.attributes?.symbol !== "string"
    )
      throw Error("CATALOG_ROW");
    const symbol = row.attributes.symbol;
    if (
      [
        "Crypto.CBBTC/USD",
        "Crypto.WETH/USD",
        "Crypto.USDC/USD",
        "Crypto.SOL/USD",
      ].includes(symbol) ||
      /portal|wormhole/i.test(symbol)
    )
      rows.push({ feedId: row.id, symbol });
  }
  return Object.freeze({
    status: "CATALOG_ONLY_NOT_EXACT_MINT_EVIDENCE" as const,
    rows: Object.freeze(rows.map((r) => Object.freeze(r))),
    portalNamedFeedFound: rows.some((r) => /portal|wormhole/i.test(r.symbol)),
    economicSourcesVerified: 0,
  });
}

export function inspectMint(raw: unknown, decimals: number) {
  const r = raw as { owner?: string; executable?: boolean; data?: unknown[] };
  if (
    !r ||
    r.owner !== C3_MAINNET.tokenProgram ||
    r.executable !== false ||
    !Array.isArray(r.data) ||
    r.data[1] !== "base64" ||
    typeof r.data[0] !== "string"
  )
    throw Error("MINT_OWNER_OR_SHAPE");
  const b = Buffer.from(r.data[0], "base64");
  if (
    b.length !== 82 ||
    b.toString("base64") !== r.data[0] ||
    b[44] !== decimals ||
    b[45] !== 1 ||
    ![0, 1].includes(b.readUInt32LE(0)) ||
    ![0, 1].includes(b.readUInt32LE(46))
  )
    throw Error("MINT_LAYOUT");
  return Object.freeze({
    owner: r.owner,
    decimals,
    initialized: true,
    supplyBaseUnits: b.readBigUInt64LE(36).toString(),
    rawSha256: createHash("sha256").update(b).digest("hex"),
  });
}

async function read(url: string, body?: object) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    redirect: "error",
    ...(body
      ? {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.body)
    return { http: response.status, data: null };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const v = await reader.read();
      if (v.done) break;
      size += v.value.length;
      if (size > 8_000_000) {
        await reader.cancel();
        throw Error("RESPONSE_SIZE");
      }
      chunks.push(v.value);
    }
  } finally {
    reader.releaseLock();
  }
  return {
    http: response.status,
    data: JSON.parse(Buffer.concat(chunks).toString("utf8")),
  };
}

export async function discoverOfficialSources() {
  const observedAt = new Date().toISOString();
  const report: Record<string, unknown> = {
    observedAt,
    scope: "READ_ONLY_DISCOVERY_NOT_NAV",
    mainnetEnabled: false,
    decision: "BLOCKED_EXACT_MINT_AND_INDEPENDENT_SOURCE_POLICY",
  };
  const attempts = async (name: string, work: () => Promise<unknown>) => {
    try {
      report[name] = await work();
    } catch {
      report[name] = { status: "UNAVAILABLE", reason: "READ_OR_SCHEMA_FAILED" };
    }
  };
  await attempts("pythCatalog", async () => {
    const r = await read("https://hermes.pyth.network/v2/price_feeds");
    return r.data
      ? { http: r.http, ...inspectCatalog(r.data) }
      : { http: r.http, status: "UNAVAILABLE" };
  });
  await attempts("mints", async () => {
    const genesis = await read("https://api.mainnet-beta.solana.com", {
      jsonrpc: "2.0",
      id: 1,
      method: "getGenesisHash",
      params: [],
    });
    if (genesis.data?.result !== C3_MAINNET.genesisHash) throw Error("GENESIS");
    const assets = ["USDC", "cbBTC", "PortalETH", "WSOL"] as const;
    const r = await read("https://api.mainnet-beta.solana.com", {
      jsonrpc: "2.0",
      id: 1,
      method: "getMultipleAccounts",
      params: [
        assets.map((a) => registry[a].mint),
        { commitment: "finalized", encoding: "base64" },
      ],
    });
    if (
      r.data?.error ||
      !Number.isSafeInteger(r.data?.result?.context?.slot) ||
      r.data.result.value?.length !== 4
    )
      throw Error("RPC");
    return {
      http: r.http,
      slot: r.data.result.context.slot,
      evidence: "SINGLE_OFFICIAL_RPC_NOT_PRODUCTION_QUORUM",
      assets: assets.map((asset, i) => ({
        asset,
        mint: registry[asset].mint,
        ...inspectMint(r.data.result.value[i], registry[asset].decimals),
      })),
    };
  });
  await attempts("jupiterReference", async () => {
    // Exactly ONE keyless request; no retries / API key / prices used for NAV.
    const r = await read(
      "https://api.jup.ag/price/v3?ids=" +
        Object.values(registry)
          .map((a) => a.mint)
          .join(","),
    );
    return {
      http: r.http,
      returnedMints: r.data
        ? Object.keys(r.data).filter((k) =>
            Object.values(registry).some((a) => a.mint === k),
          )
        : [],
      status: "NOT_ACCEPTED_AS_INDEPENDENT_CONFIDENCE_ORACLE",
      reason:
        "Official docs describe external oracle anchors plus swaps; schema lacks confidence interval and reviewed independent provenance.",
    };
  });
  report.requiredExternalEvidence =
    "Two reviewed exact-mint/USD feed mappings with raw verifiable updates, confidence, freshness and non-overlapping upstream operators. CBBTC/WETH symbols are insufficient. Switchboard canonical quote feed IDs + queue/program + reviewed job definitions and upstream provenance are not supplied or verified.";
  report.sources = [
    "https://docs.pyth.network/price-feeds/core/price-feeds",
    "https://dev-forum.pyth.network/t/solana-mint-account-to-pyth-oracle-price/214",
    "https://developers.jup.ag/docs/price",
    "https://docs.switchboard.xyz/docs-by-chain/solana-svm/price-feeds/basic-price-feed",
  ];
  return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await discoverOfficialSources();
  const dir = new URL(
    "../../results/oracle-source-discovery/",
    import.meta.url,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(
    new URL("latest.json", dir),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 2; // Discovery never authorizes NAV, issuance or redemption.
}
