import { C3_MAINNET_EXECUTION_CAPABILITY } from "./constants.ts";

const MAX_RESPONSE_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type FetchLike = (
  input: string | URL | globalThis.Request,
  init?: RequestInit,
) => Promise<Response>;

type AuthenticatedClientOptions = Readonly<{
  endpoint: string;
  apiKey: string | undefined;
  fetchImpl?: FetchLike;
}>;

export type JupiterReadOnlyClient = Readonly<{
  requestQuote: (query: Readonly<Record<string, string>>) => Promise<unknown>;
  requestUnsignedBuild: (validatedRequest: unknown) => Promise<unknown>;
}>;

export type PythReadOnlyClient = Readonly<{
  requestLatestPrices: (feedIds: readonly string[]) => Promise<unknown>;
}>;

function exactHttpsEndpoint(endpoint: string, expectedHost: string): URL {
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" || parsed.hostname !== expectedHost)
    throw new Error("Authenticated service endpoint is not approved.");
  if (parsed.username || parsed.password)
    throw new Error("Credentials must not be embedded in service URLs.");
  return parsed;
}

function requiredCredential(value: string | undefined): string {
  if (!value || value.trim().length === 0)
    throw new Error("Required isolated server credential is missing.");
  return value;
}

async function authenticatedJson(
  fetchImpl: FetchLike,
  url: URL,
  init: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        `Authenticated service returned HTTP ${response.status}.`,
      );
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_RESPONSE_BYTES)
      throw new Error("Authenticated service response exceeded size limit.");
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES)
      throw new Error("Authenticated service response exceeded size limit.");
    return JSON.parse(body) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

export function createJupiterReadOnlyClient(
  options: AuthenticatedClientOptions,
): JupiterReadOnlyClient {
  const base = exactHttpsEndpoint(options.endpoint, "api.jup.ag");
  const apiKey = requiredCredential(options.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = Object.freeze({
    accept: "application/json",
    "content-type": "application/json",
    "x-api-key": apiKey,
  });
  return Object.freeze({
    requestQuote: async (query: Readonly<Record<string, string>>) => {
      const url = new URL(base);
      for (const [key, value] of Object.entries(query))
        url.searchParams.set(key, value);
      return authenticatedJson(fetchImpl, url, { method: "GET", headers });
    },
    requestUnsignedBuild: async (validatedRequest: unknown) => {
      if (C3_MAINNET_EXECUTION_CAPABILITY !== false)
        throw new Error("Mainnet build capability must remain disabled.");
      return authenticatedJson(fetchImpl, base, {
        method: "POST",
        headers,
        body: JSON.stringify(validatedRequest),
      });
    },
  });
}

export function createPythReadOnlyClient(
  options: AuthenticatedClientOptions,
): PythReadOnlyClient {
  const base = exactHttpsEndpoint(options.endpoint, "pyth.dourolabs.app");
  const apiKey = requiredCredential(options.apiKey);
  const fetchImpl = options.fetchImpl ?? fetch;
  return Object.freeze({
    requestLatestPrices: async (feedIds: readonly string[]) => {
      if (
        feedIds.length === 0 ||
        feedIds.some((id) => !/^[a-f0-9]{64}$/.test(id))
      )
        throw new Error("Pyth feed request is malformed.");
      const url = new URL(base);
      for (const id of feedIds) url.searchParams.append("ids[]", id);
      return authenticatedJson(fetchImpl, url, {
        method: "GET",
        headers: Object.freeze({
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
        }),
      });
    },
  });
}
