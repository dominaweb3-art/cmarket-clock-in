/** Read-only quorum intake. Agreement is NOT semantic confirmation. This API
 * never promotes a leg; source-pinned operators and effect verification follow. */
import { canonicalize } from "./manifest.ts";
import { C3_MAINNET } from "./constants.ts";
import {
  assertIndependentRpcProviders,
  type ReviewedRpcProvider,
} from "./pilot-rpc-evidence.ts";
const METHODS = new Set([
  "getGenesisHash",
  "getTransaction",
  "getAccountInfo",
  "getMultipleAccounts",
  "getSignatureStatuses",
  "getBlockHeight",
  "getSlot",
  "isBlockhashValid",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
]);
async function read(
  provider: ReviewedRpcProvider,
  method: string,
  params: unknown[],
  fetcher: typeof fetch,
): Promise<unknown> {
  const r = await fetcher(provider.endpoint, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok || !r.body) throw new Error("C3_OPEN_RPC_UNAVAILABLE");
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) {
        await reader.cancel();
        throw new Error("C3_OPEN_RPC_OVERSIZED");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const v = JSON.parse(Buffer.concat(chunks).toString()) as Record<
    string,
    unknown
  >;
  // A lossy JS parse must never turn two different u64 RPC values into quorum.
  // Reject rather than guess; raw token amounts must be supplied as strings.
  const exactNumbers = (value: unknown): void => {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
    )
      throw new Error("C3_OPEN_RPC_UNSAFE_INTEGER");
    if (value !== null && typeof value === "object")
      for (const child of Object.values(value)) exactNumbers(child);
  };
  exactNumbers(v);
  if (
    v.jsonrpc !== "2.0" ||
    v.id !== 1 ||
    v.error ||
    v.result === undefined ||
    (v.result === null && method !== "getTransaction")
  )
    throw new Error("C3_OPEN_RPC_MISSING_EVIDENCE");
  return v.result;
}
export async function readIndependentOpenEvidence(
  providers: readonly ReviewedRpcProvider[],
  method: string,
  params: unknown[],
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  assertIndependentRpcProviders(providers);
  if (
    new URL(providers[0]!.endpoint).hostname
      .toLowerCase()
      .replace(/\.$/, "") ===
    new URL(providers[1]!.endpoint).hostname.toLowerCase().replace(/\.$/, "")
  )
    throw new Error("C3_OPEN_RPC_HOST_ALIAS");
  if (!METHODS.has(method))
    throw new Error("C3_OPEN_RPC_READ_ONLY_METHOD_REQUIRED");
  if (method !== "getGenesisHash") {
    for (const provider of providers)
      if (
        (await read(provider, "getGenesisHash", [], fetcher)) !==
        C3_MAINNET.genesisHash
      )
        throw new Error("C3_OPEN_RPC_WRONG_CLUSTER");
  }
  const a = await read(providers[0]!, method, params, fetcher),
    b = await read(providers[1]!, method, params, fetcher);
  // Context slots may advance independently. Equality of account bytes is
  // required, and neither response is interpreted as historical state proof.
  const normalized = (v: unknown) => {
    if (v && typeof v === "object" && "context" in v && "value" in v) {
      const r = v as { context: { slot?: unknown }; value: unknown };
      if (!Number.isSafeInteger(r.context.slot) || Number(r.context.slot) < 1)
        throw new Error("C3_OPEN_RPC_CONTEXT_MISSING");
      return r.value;
    }
    return v;
  };
  if (canonicalize(normalized(a)) !== canonicalize(normalized(b)))
    throw new Error("C3_OPEN_RPC_QUORUM_DISAGREEMENT");
  if (method === "getGenesisHash" && a !== C3_MAINNET.genesisHash)
    throw new Error("C3_OPEN_RPC_WRONG_CLUSTER");
  return Object.freeze({
    status: "AGREED_UNVERIFIED_EFFECTS",
    primary: a,
    secondary: b,
  });
}
