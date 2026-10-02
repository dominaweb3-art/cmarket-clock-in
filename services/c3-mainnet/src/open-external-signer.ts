/** Server-side HTTPS transport to a reviewed isolated quote-signing service.
 * Credentials/mTLS belong to the injected server transport, never this module
 * or the APK. No key generation, signing fallback or automatic HTTP retry.
 */
import { createHash } from "node:crypto";
import type { DurableQuoteSigningProvider } from "./open-signing-journal.ts";
export class HttpsOpenQuoteSigner implements DurableQuoteSigningProvider {
  readonly publicKey: Uint8Array;
  private readonly endpoint: string;
  private readonly transport: typeof fetch;
  constructor(
    metadata: Readonly<{
      endpoint: string;
      publicKey: Uint8Array;
      reviewEvidenceHash: string;
    }>,
    transport: typeof fetch,
  ) {
    const u = new URL(metadata.endpoint);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/v1/c3/quote-signatures/" ||
      !["", "443"].includes(u.port) ||
      metadata.publicKey.length !== 32 ||
      !/^[a-f0-9]{64}$/.test(metadata.reviewEvidenceHash) ||
      metadata.reviewEvidenceHash === "0".repeat(64)
    )
      throw Error("C3_EXTERNAL_SIGNER_REVIEW_REQUIRED");
    this.endpoint = u.href;
    this.publicKey = Uint8Array.from(metadata.publicKey);
    this.transport = transport;
  }
  async signIdempotently(
    requestId: string,
    bytes: Uint8Array,
  ): Promise<Uint8Array> {
    if (bytes.length !== 300) throw Error("C3_EXTERNAL_SIGNER_PAYLOAD");
    const payloadHash = createHash("sha256").update(bytes).digest("hex");
    const r = await this.call(requestId, "POST", {
      requestId,
      payloadHash,
      canonicalBytes: Buffer.from(bytes).toString("base64"),
    });
    if (!r) throw Error("C3_EXTERNAL_SIGNER_UNCERTAIN");
    return r;
  }
  lookupSignature(requestId: string): Promise<Uint8Array | null> {
    return this.call(requestId, "GET");
  }
  private async call(
    id: string,
    method: "GET" | "POST",
    body?: unknown,
  ): Promise<Uint8Array | null> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error("C3_EXTERNAL_SIGNER_ID");
    const r = await this.transport(this.endpoint + id, {
      method,
      redirect: "error",
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000),
    });
    if (method === "GET" && r.status === 404) {
      await r.body?.cancel();
      return null;
    }
    if (!r.ok || !r.body) {
      await r.body?.cancel();
      throw Error("C3_EXTERNAL_SIGNER_UNCERTAIN");
    }
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let n = 0;
    try {
      for (;;) {
        const v = await reader.read();
        if (v.done) break;
        n += v.value.byteLength;
        if (n > 4096) {
          await reader.cancel();
          throw Error("C3_EXTERNAL_SIGNER_RESPONSE");
        }
        chunks.push(v.value);
      }
    } finally {
      reader.releaseLock();
    }
    const v = JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >;
    if (
      v.requestId !== id ||
      v.publicKey !== Buffer.from(this.publicKey).toString("hex") ||
      typeof v.signature !== "string" ||
      !/^[a-f0-9]{128}$/.test(v.signature)
    )
      throw Error("C3_EXTERNAL_SIGNER_RESPONSE");
    return Buffer.from(v.signature, "hex"); // cryptographic check belongs to journal
  }
}
