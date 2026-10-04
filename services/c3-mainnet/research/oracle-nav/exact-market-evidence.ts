/** Read-only market evidence, deliberately NOT an oracle/NAV trust adapter.
 * Orca layout pin f4b99e79e7140f3917e4ce81a2e8ad06ccdf8ce4/state/whirlpool.rs.
 * A finalized snapshot is not a last-trade timestamp, confidence interval,
 * independent economic oracle or executable quote. No transaction/wallet API.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { C3_MAINNET as c } from "../../src/constants.ts";
import { C3_MAINNET_ASSET_REGISTRY as registry } from "../../src/registry.ts";
import { inspectMint } from "./open-vault-source-evidence.ts";

const ORCA = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const SCALE = 1_000_000_000_000n;
const ASSETS = ["USDC", "cbBTC", "PortalETH", "WSOL"] as const;
const POOLS = Object.freeze([
  {
    address: "HxA6SKW5qA4o12fjVgTpXdq2YnZ5Zv1s7SB4FFomsyLM",
    base: "cbBTC",
    quote: "USDC",
  },
  {
    address: "HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF",
    base: "PortalETH",
    quote: "WSOL",
  },
  {
    address: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE",
    base: "WSOL",
    quote: "USDC",
  },
] as const);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function fail(s: string): never {
  throw Error("C3_MARKET_" + s);
}
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail("SHAPE");
  return v as Record<string, unknown>;
}
export function decimalE12(v: unknown): bigint {
  if (
    typeof v !== "string" ||
    v.length > 80 ||
    !/^(0|[1-9][0-9]{0,18})(\.[0-9]{1,60})?$/.test(v)
  )
    fail("DECIMAL");
  const [whole, fraction = ""] = v.split(".");
  const n =
    BigInt(whole!) * SCALE + BigInt((fraction + "0".repeat(12)).slice(0, 12));
  if (n <= 0n) fail("ZERO_PRICE");
  return n;
}
export function divergenceBpsCeil(a: bigint, b: bigint) {
  if (a <= 0n || b <= 0n) fail("ZERO_PRICE");
  const d = (a > b ? a - b : b - a) * 10_000n,
    minimum = a < b ? a : b;
  return (d / minimum + (d % minimum ? 1n : 0n)).toString();
}
function raw(v: unknown, owner: string, length: number) {
  const r = obj(v);
  if (
    r.owner !== owner ||
    r.executable !== false ||
    !Array.isArray(r.data) ||
    r.data.length !== 2 ||
    r.data[1] !== "base64" ||
    typeof r.data[0] !== "string" ||
    r.data[0].length > 4096
  )
    fail("ACCOUNT");
  const b = Buffer.from(r.data[0], "base64");
  if (b.length !== length || b.toString("base64") !== r.data[0]) fail("LAYOUT");
  return b;
}
const pub = (b: Buffer, n: number) =>
  new PublicKey(b.subarray(n, n + 32)).toBase58();
/** Caller-supplied bytes never acquire a production evidence brand. */
export function decodeOrcaMarketPool(
  address: string,
  v: unknown,
  base: keyof typeof registry,
  quote: keyof typeof registry,
) {
  const b = raw(v, ORCA, 653),
    disc = createHash("sha256")
      .update("account:Whirlpool")
      .digest()
      .subarray(0, 8);
  if (!b.subarray(0, 8).equals(disc) || b.readUInt16LE(41) === 0)
    fail("POOL_DISCRIMINATOR");
  const a = pub(b, 101),
    z = pub(b, 181);
  if (!(
    (a === registry[base].mint && z === registry[quote].mint) ||
    (z === registry[base].mint && a === registry[quote].mint)
  ))
    fail("EXACT_MINT_PAIR");
  const [expected, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("whirlpool"),
      b.subarray(8, 40),
      b.subarray(101, 133),
      b.subarray(181, 213),
      b.subarray(43, 45),
    ],
    new PublicKey(ORCA),
  );
  if (expected.toBase58() !== address || bump !== b[40]) fail("POOL_PDA");
  const u128 = (n: number) =>
    b.readBigUInt64LE(n) + (b.readBigUInt64LE(n + 8) << 64n);
  const liquidity = u128(49),
    sqrt = u128(65);
  // Official Q64 bounds. Do not accept a positive-but-invalid pool encoding.
  if (
    !liquidity ||
    sqrt < 4295048016n ||
    sqrt > 79226673515401279992447579055n ||
    b.readUInt16LE(47) > 2_500 ||
    b.readUInt16LE(45) > 60_000
  )
    fail("POOL_RANGE");
  const numerator = a === registry[base].mint ? sqrt * sqrt : 1n << 128n;
  const denominator = a === registry[base].mint ? 1n << 128n : sqrt * sqrt;
  const price =
    (numerator * 10n ** BigInt(registry[base].decimals) * SCALE) /
    (denominator * 10n ** BigInt(registry[quote].decimals));
  if (!price) fail("ZERO_PRICE");
  return Object.freeze({
    address,
    base,
    quote,
    priceQuoteE12: price.toString(),
    rawSha256: sha(b),
    vaultA: pub(b, 133),
    vaultB: pub(b, 213),
    mintA: a,
    mintB: z,
    liquidityUnits: liquidity.toString(),
    feeMillionths: b.readUInt16LE(45),
    priceKind: "SPOT_MARKET_RATIO_NOT_USD_ORACLE" as const,
    lastTradeTime: null,
    confidence: null,
  });
}
function token(v: unknown, mint: string, authority: string) {
  const b = raw(v, c.tokenProgram, 165);
  if (
    pub(b, 0) !== mint ||
    pub(b, 32) !== authority ||
    b[108] !== 1 ||
    b.readUInt32LE(72) !== 0 ||
    b.readUInt32LE(129) !== 0 ||
    b.readUInt32LE(109) !== (mint === c.wrappedSolMint ? 1 : 0)
  )
    fail("POOL_CUSTODY");
  return b.readBigUInt64LE(64).toString();
}

/** Identity is the address relationship, NEVER name/symbol or top-pool ranking. */
export function inspectGeckoPools(
  input: unknown,
  asset: keyof typeof registry,
) {
  const data = obj(input).data;
  if (!Array.isArray(data) || data.length > 30) fail("MARKET_RESPONSE");
  return data.slice(0, 8).map((v) => {
    const row = obj(v),
      attr = obj(row.attributes),
      relationships = obj(row.relationships);
    const id = (name: string) => obj(obj(relationships[name]).data).id;
    const target = "solana_" + registry[asset].mint;
    const side =
      id("base_token") === target
        ? "base"
        : id("quote_token") === target
          ? "quote"
          : fail("MARKET_MINT");
    if (typeof attr.address !== "string") fail("MARKET_ADDRESS");
    new PublicKey(attr.address);
    // Missing prices are evidence of unavailability, never zero or USD parity.
    const price = attr[side + "_token_price_usd"];
    let normalized: string | null = null;
    try {
      normalized = price == null ? null : decimalE12(price).toString();
    } catch {
      /* Unavailable observation, never coerce invalid prices. */
    }
    return Object.freeze({
      pool: attr.address,
      mint: registry[asset].mint,
      side,
      marketPriceUsdE12: normalized,
      observedPoolProvider: "geckoterminal",
      publishedAtUnix: null,
      confidence: null,
      sourceProvenance: "HTTP_MARKET_AGGREGATE_UNAUTHENTICATED",
      eligibleForNav: false,
    });
  });
}
/** A diagnostic only. Uses explicit pool provenance and an observed USDC/USD value;
 * never asserts independence or promotes this contrast to an oracle. */
export function contrastMarketRatio(
  ratioE12: string,
  assetUsdE12: string | null,
  usdcUsdE12: string | null,
) {
  if (assetUsdE12 === null || usdcUsdE12 === null)
    return { status: "UNAVAILABLE", eligibleForNav: false };
  for (const v of [ratioE12, assetUsdE12, usdcUsdE12])
    if (!/^[1-9][0-9]{0,38}$/.test(v)) fail("SCALED_INTEGER");
  const ratio = (decimalE12("1") * BigInt(assetUsdE12)) / BigInt(usdcUsdE12);
  if (ratio <= 0n) fail("ZERO_PRICE");
  const divergence = divergenceBpsCeil(BigInt(ratioE12), ratio);
  return {
    status: "DIAGNOSTIC_SHARED_MARKET_NOT_INDEPENDENT",
    divergenceBpsCeil: divergence,
    exceedsCandidate100BpsLimit: BigInt(divergence) > 100n,
    observationAgeVerified: false,
    confidenceVerified: false,
    eligibleForNav: false,
  };
}
async function json(url: string, payload?: object) {
  const r = await fetch(url, {
    ...(payload
      ? {
          method: "POST",
          body: JSON.stringify(payload),
          headers: { "content-type": "application/json" },
        }
      : {}),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.body) fail("HTTP_BODY");
  const reader = r.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const n = await reader.read();
      if (n.done) break;
      size += n.value.length;
      if (size > 8_000_000) {
        await reader.cancel();
        fail("RESPONSE_SIZE");
      }
      chunks.push(n.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!r.ok) return { http: r.status, data: null };
  return {
    http: r.status,
    data: JSON.parse(Buffer.concat(chunks).toString()) as unknown,
  };
}
let seq = 0;
async function rpc(
  method: "getGenesisHash" | "getMultipleAccounts",
  params: unknown[],
) {
  const id = ++seq,
    r = await json("https://api.mainnet-beta.solana.com", {
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
  const body = obj(r.data);
  if (
    body.id !== id ||
    body.jsonrpc !== "2.0" ||
    body.error ||
    body.result == null
  )
    fail("RPC_RESPONSE");
  return body.result;
}
export async function collectExactMarketEvidence() {
  const report: Record<string, unknown> = {
    observedAt: new Date().toISOString(),
    scope: "RESEARCH_MARKET_NOT_NAV",
    eligibleForNav: false,
    mainnetEnabled: false,
  };
  let ratios: {
    asset: "cbBTC" | "PortalETH" | "WSOL";
    pool: string;
    ratio: string;
  }[] = [];
  try {
    if ((await rpc("getGenesisHash", [])) !== c.genesisHash) fail("CHAIN");
    const names = [
      CLOCK,
      ...POOLS.map((p) => p.address),
      ...ASSETS.map((a) => registry[a].mint),
    ];
    const first = obj(
      await rpc("getMultipleAccounts", [
        names,
        { commitment: "finalized", encoding: "base64" },
      ]),
    );
    if (!Array.isArray(first.value) || first.value.length !== names.length)
      fail("RPC_ACCOUNTS");
    const preliminary = POOLS.map((p, j) =>
      decodeOrcaMarketPool(
        p.address,
        (first.value as unknown[])[j + 1],
        p.base,
        p.quote,
      ),
    );
    const allNames = [
      ...names,
      ...preliminary.flatMap((p) => [p.vaultA, p.vaultB]),
    ];
    const s = obj(
      await rpc("getMultipleAccounts", [
        allNames,
        {
          commitment: "finalized",
          encoding: "base64",
          minContextSlot: obj(first.context).slot,
        },
      ]),
    );
    const slot = obj(s.context).slot;
    if (
      !Number.isSafeInteger(slot) ||
      !Array.isArray(s.value) ||
      s.value.length !== allNames.length
    )
      fail("RPC_ACCOUNTS");
    const values = s.value,
      clock = raw(values[0], "Sysvar1111111111111111111111111111111111111", 40);
    const chainTime = clock.readBigInt64LE(32),
      now = BigInt(Math.floor(Date.now() / 1000));
    if (
      clock.readBigUInt64LE(0) !== BigInt(slot as number) ||
      chainTime < 1n ||
      now < chainTime ||
      now - chainTime > 60n
    )
      fail("SNAPSHOT_FRESHNESS");
    ASSETS.forEach((a, j) => inspectMint(values[4 + j], registry[a].decimals));
    const pools = POOLS.map((p, j) => {
      const d = decodeOrcaMarketPool(p.address, values[j + 1], p.base, p.quote);
      if (
        d.vaultA !== preliminary[j]!.vaultA ||
        d.vaultB !== preliminary[j]!.vaultB
      )
        fail("ACCOUNT_SET_CHANGED");
      return {
        ...d,
        custodyA: token(values[8 + j * 2], d.mintA, d.address),
        custodyB: token(values[9 + j * 2], d.mintB, d.address),
      };
    });
    report.orca = {
      status: "EXACT_POOL_AND_CUSTODY_DECODED_NOT_ORACLE",
      operator: "orca",
      rpcOperators: 1,
      slot,
      chainTime: chainTime.toString(),
      pools,
      portalEthUsdcSpotE12: (
        (BigInt(pools[1]!.priceQuoteE12) * BigInt(pools[2]!.priceQuoteE12)) /
        SCALE
      ).toString(),
      usdParityAssumed: false,
      pricePublishedAt: null,
      confidence: null,
      authenticatedProgramBinary: false,
    };
    ratios = [
      {
        asset: "cbBTC",
        pool: POOLS[0].address,
        ratio: pools[0]!.priceQuoteE12,
      },
      {
        asset: "PortalETH",
        pool: POOLS[1].address,
        ratio: (
          (BigInt(pools[1]!.priceQuoteE12) * BigInt(pools[2]!.priceQuoteE12)) /
          SCALE
        ).toString(),
      },
      { asset: "WSOL", pool: POOLS[2].address, ratio: pools[2]!.priceQuoteE12 },
    ];
  } catch (e) {
    report.orca = {
      status: "UNAVAILABLE",
      reason:
        e instanceof Error && /^C3_MARKET_[A-Z_]+$/.test(e.message)
          ? e.message
          : "READ_UNAVAILABLE",
    };
  }
  const gecko: Record<string, unknown> = {};
  for (const a of ASSETS) {
    try {
      const r = await json(
        `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${registry[a].mint}/pools?page=1`,
      );
      gecko[a] = {
        http: r.http,
        pools: r.data ? inspectGeckoPools(r.data, a) : [],
        receivedAt: new Date().toISOString(),
      };
    } catch (e) {
      gecko[a] = {
        status: "UNAVAILABLE",
        reason:
          e instanceof Error && /^C3_MARKET_[A-Z_]+$/.test(e.message)
            ? e.message
            : "READ_OR_SCHEMA_UNAVAILABLE",
      };
    }
  }
  report.geckoTerminal = gecko;
  const rows = (
    asset: keyof typeof registry,
  ): ReturnType<typeof inspectGeckoPools> => {
    const r = obj(gecko[asset]);
    return Array.isArray(r.pools) ? r.pools : [];
  };
  let usdc: string | null = null;
  try {
    const r = await json(
      `https://api.geckoterminal.com/api/v2/networks/solana/pools/${POOLS[0].address}`,
    );
    const observation = r.data
      ? inspectGeckoPools({ data: [obj(r.data).data] }, "USDC")[0]
      : undefined;
    if (observation && observation.pool !== POOLS[0].address)
      fail("MARKET_ADDRESS");
    usdc = observation?.marketPriceUsdE12 ?? null;
    report.usdcContrastAnchor = {
      http: r.http,
      observation: observation ?? null,
      eligibleForNav: false,
    };
  } catch {
    report.usdcContrastAnchor = {
      status: "UNAVAILABLE",
      eligibleForNav: false,
    };
  }
  report.contrasts = ratios.map((r) => ({
    asset: r.asset,
    mint: registry[r.asset].mint,
    pool: r.pool,
    onchainRatioPools:
      r.asset === "PortalETH" ? [POOLS[1].address, POOLS[2].address] : [r.pool],
    httpUsdNumeratorPool: r.pool,
    httpUsdDenominatorPool: POOLS[0].address,
    ...contrastMarketRatio(
      r.ratio,
      rows(r.asset).find((p) => p.pool === r.pool)?.marketPriceUsdE12 ?? null,
      usdc,
    ),
  }));
  report.decision = "NO_COMPATIBLE_TWO_DIRECT_USD_ORACLES_VERIFIED";
  report.blockers = [
    "Exact Portal ETH/USD authenticated feed mapping not established",
    "Two independent upstream sets and confidence per exact mint not established",
    "Spot snapshot age is NOT last trade age; no TWAP/market depth certificate",
    "Market HTTP JSON must not enter production collector",
  ];
  return report;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await collectExactMarketEvidence();
  const directory = new URL(
    "../../results/oracle-source-discovery/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL("exact-markets.json", directory),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 2; // Mandatory oracle requirements not met. Never admission.
}
