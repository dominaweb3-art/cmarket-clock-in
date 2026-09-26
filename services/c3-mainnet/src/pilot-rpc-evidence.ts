/** Read-only two-provider evidence intake. It cannot mark a pilot leg confirmed. */
import { createHash } from "node:crypto";

import { canonicalize } from "./manifest.ts";
import { decodeVersionedMessage, encodeBase58 } from "./solana.ts";

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const ID = /^[a-z][a-z0-9-]{2,63}$/;
const HASH = /^[a-f0-9]{64}$/;

export type ReviewedRpcProvider = Readonly<{
  providerId: string;
  operatorId: string;
  endpoint: string;
  reviewEvidenceHash: string;
}>;

export type RpcEvidenceResult = Readonly<{
  status: "MANUAL_REVIEW";
  reason: string;
  signature: string;
  evidenceHash: string | null;
  slot: number | null;
  blockTime: number | null;
}>;

function endpointIdentity(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("C3_RPC_INVALID_ENDPOINT");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !["", "443"].includes(url.port)
  )
    throw new Error("C3_RPC_HTTPS_ENDPOINT_REQUIRED");
  return `${url.hostname.toLowerCase().replace(/\.$/, "")}${url.pathname.replace(/\/$/, "")}`;
}

export function assertIndependentRpcProviders(
  providers: readonly ReviewedRpcProvider[],
): void {
  if (
    providers.length !== 2 ||
    providers.some(
      (provider) =>
        !ID.test(provider.providerId) ||
        !ID.test(provider.operatorId) ||
        !HASH.test(provider.reviewEvidenceHash),
    )
  )
    throw new Error("C3_RPC_REVIEWED_PROVIDER_PAIR_REQUIRED");
  const [first, second] = providers;
  if (
    !first ||
    !second ||
    first.providerId === second.providerId ||
    first.operatorId === second.operatorId ||
    endpointIdentity(first.endpoint) === endpointIdentity(second.endpoint)
  )
    throw new Error("C3_RPC_PROVIDERS_NOT_INDEPENDENT");
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("C3_RPC_HTTP_FAILURE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("C3_RPC_EVIDENCE_TOO_LARGE");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

async function readTransaction(
  provider: ReviewedRpcProvider,
  signature: string,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetcher(provider.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        signature,
        {
          encoding: "base64",
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        },
      ],
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const raw = await boundedJson(response);
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("C3_RPC_MALFORMED_RESPONSE");
  const wrapper = raw as Record<string, unknown>;
  if (
    wrapper.error ||
    !wrapper.result ||
    typeof wrapper.result !== "object" ||
    Array.isArray(wrapper.result)
  )
    throw new Error("C3_RPC_MISSING_FINALIZED_TRANSACTION");
  const result = wrapper.result as Record<string, unknown>;
  if (
    !Number.isSafeInteger(result.slot) ||
    Number(result.slot) <= 0 ||
    !Array.isArray(result.transaction) ||
    result.transaction[1] !== "base64" ||
    typeof result.transaction[0] !== "string" ||
    !result.meta ||
    typeof result.meta !== "object" ||
    Array.isArray(result.meta)
  )
    throw new Error("C3_RPC_INCOMPLETE_EVIDENCE");
  return result;
}

/** All outcomes stay manual review until a reviewed instruction/effect policy exists. */
export async function collectIndependentTransactionEvidence(
  providers: readonly ReviewedRpcProvider[],
  signature: string,
  fetcher: typeof fetch = fetch,
): Promise<RpcEvidenceResult> {
  assertIndependentRpcProviders(providers);
  if (!SIGNATURE.test(signature)) throw new Error("C3_RPC_INVALID_SIGNATURE");
  const manual = (
    reason: string,
    hash: string | null = null,
    slot: number | null = null,
    blockTime: number | null = null,
  ): RpcEvidenceResult =>
    Object.freeze({
      status: "MANUAL_REVIEW",
      reason,
      signature,
      evidenceHash: hash,
      slot,
      blockTime,
    });
  try {
    // Sequential reads: no retries, no signature submission.
    const first = await readTransaction(providers[0]!, signature, fetcher);
    const second = await readTransaction(providers[1]!, signature, fetcher);
    const normalized = (value: Record<string, unknown>) => ({
      slot: value.slot,
      blockTime: value.blockTime,
      transaction: value.transaction,
      meta: value.meta,
      version: value.version,
    });
    const one = normalized(first);
    const two = normalized(second);
    if (canonicalize(one) !== canonicalize(two))
      return manual("C3_RPC_PROVIDER_EVIDENCE_CONFLICT");
    const meta = first.meta as Record<string, unknown>;
    if (
      meta.err !== null ||
      !Array.isArray(meta.innerInstructions) ||
      !Array.isArray(meta.preTokenBalances) ||
      !Array.isArray(meta.postTokenBalances) ||
      !Array.isArray(meta.preBalances) ||
      !Array.isArray(meta.postBalances) ||
      !Array.isArray(meta.logMessages) ||
      !meta.loadedAddresses ||
      typeof meta.loadedAddresses !== "object"
    )
      return manual("C3_RPC_INCOMPLETE_EFFECT_EVIDENCE");
    const wire = Buffer.from((first.transaction as string[])[0]!, "base64");
    if (
      wire.toString("base64") !== (first.transaction as string[])[0] ||
      wire.length < 66
    )
      return manual("C3_RPC_INVALID_SIGNED_WIRE");
    const count = wire[0];
    if (count !== 1 || wire.length < 1 + count * 64 + 1)
      return manual("C3_RPC_INVALID_SIGNATURE_VECTOR");
    if (encodeBase58(wire.subarray(1, 65)) !== signature)
      return manual("C3_RPC_SIGNED_WIRE_SIGNATURE_MISMATCH");
    const message = wire.subarray(1 + count * 64);
    // Without independently fetched ALT account content, never accept loaded addresses as authority.
    const decoded = decodeVersionedMessage(message.toString("base64"), []);
    const hash = createHash("sha256").update(canonicalize(one)).digest("hex");
    if (decoded.lookupTables.length > 0)
      return manual("C3_RPC_ALT_REVIEW_REQUIRED", hash);
    return manual(
      "C3_RPC_SEMANTIC_RECONCILIATION_NOT_APPROVED",
      hash,
      first.slot as number,
      typeof first.blockTime === "number" ? first.blockTime : null,
    );
  } catch {
    return manual("C3_RPC_MISSING_OR_INVALID_EVIDENCE");
  }
}
