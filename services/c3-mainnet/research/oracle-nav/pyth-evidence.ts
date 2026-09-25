/** Authenticated Pyth Core evidence collection. Research-only; never exported or built for production. */
import { createHash } from "node:crypto";
import { FEEDS } from "./candidate.ts";

export const HERMES = "https://pyth.dourolabs.app/hermes";
export const REQUIRED = Object.freeze([
  { symbol: "Crypto.BTC/USD", id: FEEDS.cbBTC },
  { symbol: "Crypto.ETH/USD", id: FEEDS.PortalETH },
  { symbol: "Crypto.SOL/USD", id: FEEDS.WSOL },
  { symbol: "Crypto.USDC/USD", id: FEEDS.USDC },
]);
const MAX_AGE = 60;
const MAX_CONFIDENCE_BPS = 200n;
const TIMEOUT_MS = 8_000;

type Json = Record<string, unknown>;
export type FeedMetadata = Readonly<{
  id: string;
  symbol: string;
  description: string | null;
  assetClass: string | null;
  quoteCurrency: string;
}>;
export type Sample = Readonly<{
  id: string;
  symbol: string;
  endpoint: string;
  httpStatus: 200;
  observedAt: number;
  publishedAt: number;
  price: string;
  exponent: number;
  confidence: string;
  confidenceBpsCeil: string;
  ageSeconds: number;
  responseSchema: string;
  fingerprint: string;
}>;
export type ResearchEvidence = Readonly<{
  researchOnly: true;
  sourceOperator: "Pyth";
  authProduct: "Pyth Core Hermes (entitlement not independently identified)";
  metadataEndpoint: string;
  metadataHttpStatus: 200;
  feeds: readonly FeedMetadata[];
  samples: readonly (readonly Sample[])[];
  proxySearch: Readonly<Record<string, readonly FeedMetadata[]>>;
  decision: "NO_GO";
}>;

export class PythEvidenceError extends Error {
  readonly code: string;
  readonly httpStatus: number | undefined;
  readonly endpoint: string | undefined;
  constructor(code: string, httpStatus?: number, endpoint?: string) {
    super(
      `${code}${httpStatus ? ` HTTP ${httpStatus}` : ""}${endpoint ? ` ${endpoint}` : ""}`,
    );
    this.code = code;
    this.httpStatus = httpStatus;
    this.endpoint = endpoint;
  }
}

function object(value: unknown, label: string): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PythEvidenceError(`malformed_${label}`);
  return value as Json;
}
function canonicalId(id: unknown): string {
  if (typeof id !== "string" || !/^(0x)?[a-f0-9]{64}$/i.test(id))
    throw new PythEvidenceError("malformed_feed_id");
  return id.toLowerCase().replace(/^0x/, "");
}
function canonicalUnsigned(value: unknown, label: string): bigint {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    value.length > 50
  )
    throw new PythEvidenceError(`malformed_${label}`);
  return BigInt(value);
}
function metadata(value: unknown): FeedMetadata {
  const row = object(value, "metadata");
  const attrs = object(row.attributes, "attributes");
  const symbol = attrs.symbol;
  if (typeof symbol !== "string" || symbol.length > 120)
    throw new PythEvidenceError("malformed_symbol");
  const quote =
    typeof attrs.quote_currency === "string"
      ? attrs.quote_currency
      : (symbol.split("/")[1] ?? "");
  return {
    id: canonicalId(row.id),
    symbol,
    description:
      typeof attrs.description === "string"
        ? attrs.description.slice(0, 300)
        : null,
    assetClass:
      typeof attrs.asset_type === "string"
        ? attrs.asset_type.slice(0, 120)
        : null,
    quoteCurrency: quote,
  };
}
export function selectRequiredMetadata(
  catalog: unknown,
): readonly FeedMetadata[] {
  if (!Array.isArray(catalog)) throw new PythEvidenceError("malformed_catalog");
  const rows = catalog.map(metadata);
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.id)) throw new PythEvidenceError("duplicate_feed_id");
    ids.add(row.id);
  }
  return REQUIRED.map(({ id, symbol }) => {
    const row = rows.find((item) => item.id === id);
    if (!row) throw new PythEvidenceError("required_feed_missing");
    if (row.symbol !== symbol || row.quoteCurrency !== "USD")
      throw new PythEvidenceError("wrong_symbol_or_quote");
    return row;
  });
}

export function selectProxyCandidates(
  catalog: unknown,
  kind: "cbBTC" | "PortalETH",
): readonly FeedMetadata[] {
  if (!Array.isArray(catalog)) throw new PythEvidenceError("malformed_catalog");
  const rows = catalog.map(metadata);
  const exact =
    kind === "cbBTC"
      ? new Set(["Crypto.CBBTC/BTC", "Crypto.CBBTC/USD"])
      : new Set([
          "Crypto.PORTALETH/ETH",
          "Crypto.PORTALETH/USD",
          "Crypto.WORMHOLEETH/ETH",
          "Crypto.WORMHOLEETH/USD",
        ]);
  return rows.filter((row) => exact.has(row.symbol));
}

export function validateLatest(
  payload: unknown,
  feeds: readonly FeedMetadata[],
  observedAt: number,
  endpoint: string,
): readonly Sample[] {
  const root = object(payload, "latest_response");
  if (!Array.isArray(root.parsed))
    throw new PythEvidenceError("malformed_parsed");
  if (root.parsed.length !== feeds.length)
    throw new PythEvidenceError("missing_or_extra_feed");
  const seen = new Set<string>();
  return root.parsed.map((item: unknown) => {
    const row = object(item, "parsed_item");
    const id = canonicalId(row.id);
    if (seen.has(id)) throw new PythEvidenceError("duplicate_feed_id");
    seen.add(id);
    const feed = feeds.find((entry) => entry.id === id);
    if (!feed) throw new PythEvidenceError("wrong_feed_id");
    const data = object(row.price, "price");
    const price = canonicalUnsigned(data.price, "price");
    const conf = canonicalUnsigned(data.conf, "confidence");
    if (price <= 0n) throw new PythEvidenceError("nonpositive_price");
    const exponent = data.expo;
    if (
      typeof exponent !== "number" ||
      !Number.isSafeInteger(exponent) ||
      exponent < -18 ||
      exponent > 0
    )
      throw new PythEvidenceError("exponent_out_of_bounds");
    const publishedAt = data.publish_time;
    if (
      typeof publishedAt !== "number" ||
      !Number.isSafeInteger(publishedAt) ||
      publishedAt <= 0
    )
      throw new PythEvidenceError("malformed_publish_time");
    const ageSeconds = observedAt - publishedAt;
    if (ageSeconds < 0) throw new PythEvidenceError("future_publish_time");
    if (ageSeconds > MAX_AGE) throw new PythEvidenceError("stale_publish_time");
    if (conf * 10_000n > price * MAX_CONFIDENCE_BPS)
      throw new PythEvidenceError("excessive_confidence");
    const publicFields = {
      id,
      symbol: feed.symbol,
      observedAt,
      publishedAt,
      price: price.toString(),
      exponent,
      confidence: conf.toString(),
    };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(publicFields))
      .digest("hex");
    return {
      ...publicFields,
      endpoint,
      httpStatus: 200 as const,
      confidenceBpsCeil: ((conf * 10_000n + price - 1n) / price).toString(),
      ageSeconds,
      responseSchema: "Hermes v2 parsed.price",
      fingerprint,
    };
  });
}

export async function authenticatedGet(
  key: string | undefined,
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  if (!key || key.trim() === "") throw new PythEvidenceError("missing_key");
  if (!endpoint.startsWith(`${HERMES}/v2/`))
    throw new PythEvidenceError("invalid_endpoint");
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    // Network exception text may contain a URL or credential. Deliberately discard it.
    throw new PythEvidenceError("network_or_timeout", undefined, endpoint);
  }
  if (!response.ok)
    throw new PythEvidenceError("http_error", response.status, endpoint);
  try {
    return await response.json();
  } catch {
    throw new PythEvidenceError("malformed_json", response.status, endpoint);
  }
}

export async function collectPythEvidence(
  key: string | undefined,
  fetcher: typeof fetch = fetch,
  now: () => number = () => Math.floor(Date.now() / 1000),
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ResearchEvidence> {
  if (!key || key.trim() === "") throw new PythEvidenceError("missing_key");
  const metadataEndpoint = `${HERMES}/v2/price_feeds`;
  // One authenticated catalog request; no concurrent bursts or retry.
  const catalog = await authenticatedGet(key, metadataEndpoint, fetcher);
  const feeds = selectRequiredMetadata(catalog);
  const proxySearch = {
    cbBTC: selectProxyCandidates(catalog, "cbBTC"),
    PortalETH: selectProxyCandidates(catalog, "PortalETH"),
  };
  const params = new URLSearchParams();
  for (const feed of feeds) params.append("ids[]", `0x${feed.id}`);
  const endpoint = `${HERMES}/v2/updates/price/latest?${params}`;
  const samples: Sample[][] = [];
  for (let index = 0; index < 3; index++) {
    await pause(1_500);
    const payload = await authenticatedGet(key, endpoint, fetcher);
    samples.push([...validateLatest(payload, feeds, now(), endpoint)]);
  }
  const evidence: ResearchEvidence = {
    researchOnly: true,
    sourceOperator: "Pyth",
    authProduct: "Pyth Core Hermes (entitlement not independently identified)",
    metadataEndpoint,
    metadataHttpStatus: 200,
    feeds,
    samples,
    proxySearch,
    decision: "NO_GO",
  };
  if (JSON.stringify(evidence).includes(key))
    throw new PythEvidenceError("secret_reflected_in_public_metadata");
  return evidence;
}
