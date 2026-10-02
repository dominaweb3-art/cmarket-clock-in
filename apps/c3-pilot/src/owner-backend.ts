import type {
  OwnerBackend,
  PreparedOwnerOperation,
} from "./owner-controller.ts";
/** Portable HTTP adapter; the release supplies only a source-reviewed HTTPS
 * origin. Isolated loopback is supplied by tests, never the candidate factory. */
export function ownerBackend(
  origin: string,
  encode: (v: Uint8Array) => string,
  decode: (v: string) => Uint8Array,
  fetcher: typeof fetch = fetch,
): OwnerBackend {
  const read = async (path: string, body?: unknown) => {
    const r = await fetcher(origin + path, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    if (!r.ok || text.length > 12000)
      throw Error("C3_OWNER_BACKEND_UNAVAILABLE");
    const value = JSON.parse(text) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("C3_OWNER_RESPONSE_INVALID");
    return value;
  };
  return {
    prepare: async (intentId, action) => {
      const r = await read("/v1/c3/owner/prepare", { intentId, action });
      if (
        typeof r.packet !== "string" ||
        r.packet.length > 1644 ||
        typeof r.expiry !== "number" ||
        typeof r.requestId !== "string" ||
        typeof r.messageHash !== "string" ||
        typeof r.wallet !== "string"
      )
        throw Error("C3_OWNER_RESPONSE_INVALID");
      return { ...r, packet: decode(r.packet) } as PreparedOwnerOperation;
    },
    recordSignature: async (requestId, signed) => {
      const r = await read("/v1/c3/owner/receipt", {
        requestId,
        packet: encode(signed),
      });
      if (typeof r.signature !== "string")
        throw Error("C3_OWNER_RESPONSE_INVALID");
      return { signature: r.signature };
    },
    status: async (requestId) => {
      const r = await read(
        "/v1/c3/owner/status?requestId=" + encodeURIComponent(requestId),
      );
      if (
        typeof r.requestId !== "string" ||
        typeof r.messageHash !== "string" ||
        !(r.signature === null || typeof r.signature === "string") ||
        typeof r.state !== "string" ||
        !["signed", "uncertain", "finalized"].includes(r.state) ||
        (["signed", "finalized"].includes(r.state) && r.signature === null) ||
        (r.state === "finalized" &&
          (typeof r.economicEvidenceHash !== "string" ||
            !/^[a-f0-9]{64}$/.test(r.economicEvidenceHash) ||
            typeof r.evidenceScope !== "string" ||
            !["LOCAL_CLONE", "MAINNET_INDEPENDENT_RPC"].includes(
              r.evidenceScope,
            )))
      )
        throw Error("C3_OWNER_RESPONSE_INVALID");
      return {
        requestId: r.requestId,
        messageHash: r.messageHash,
        signature: r.signature,
        state: r.state as "signed" | "uncertain" | "finalized",
        ...(r.state === "finalized"
          ? {
              economicEvidenceHash: r.economicEvidenceHash as string,
              evidenceScope: r.evidenceScope as
                "LOCAL_CLONE" | "MAINNET_INDEPENDENT_RPC",
            }
          : {}),
      };
    },
  };
}
