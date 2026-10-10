/** Public error codes only. Never expose native error messages, payloads or tokens. */
export function evaluationErrorCode(error: unknown): string {
  if (typeof error === "string" && /^[A-Z][A-Z0-9_]{2,90}$/.test(error))
    return error;
  if (!error || typeof error !== "object") return "EVAL_UNEXPECTED_ERROR";
  const value = error as {
    message?: unknown;
    code?: unknown;
    userInfo?: { jsonRpcErrorCode?: unknown };
  };
  if (
    typeof value.message === "string" &&
    /^[A-Z][A-Z0-9_]{2,90}$/.test(value.message)
  )
    return value.message;
  const rpc =
    value.code === "JSON_RPC_ERROR"
      ? value.userInfo?.jsonRpcErrorCode
      : value.code;
  const protocol: Record<string, string> = {
    "-1": "EVAL_MWA_AUTHORIZATION_FAILED",
    "-2": "EVAL_MWA_INVALID_PAYLOAD",
    "-3": "EVAL_MWA_NOT_SIGNED",
    "-32602": "EVAL_MWA_INVALID_PARAMS",
    "-100": "EVAL_MWA_ORIGIN_REJECTED",
  };
  if (typeof rpc === "number" && protocol[String(rpc)])
    return protocol[String(rpc)]!;
  if (typeof value.code === "string" && /^ERROR_[A-Z_]{2,70}$/.test(value.code))
    return `EVAL_MWA_${value.code.slice(6)}`;
  if (typeof value.message === "string") {
    // Expo's FetchError wraps native IO errors in "fetch failed: ..." and
    // discards their error code. Classify only known transport categories;
    // never expose its raw native message, URL, headers or response contents.
    if (
      /fetch failed:|network request failed|networkerror|failed to fetch/i.test(
        value.message,
      )
    ) {
      if (/ssl|certificate|tls|handshake/i.test(value.message))
        return "EVAL_NETWORK_TLS_ERROR";
      if (/unable to resolve host|unknownhost|dns/i.test(value.message))
        return "EVAL_NETWORK_DNS_ERROR";
      if (/abort|cancel|timed? ?out|timeout/i.test(value.message))
        return "EVAL_REQUEST_TIMEOUT";
      return "EVAL_NETWORK_REQUEST_FAILED";
    }
  }
  if (error instanceof ReferenceError) return "EVAL_RUNTIME_REFERENCE_ERROR";
  if (error instanceof TypeError) return "EVAL_RUNTIME_TYPE_ERROR";
  if (error instanceof RangeError) return "EVAL_RUNTIME_RANGE_ERROR";
  if (error instanceof SyntaxError) return "EVAL_RESPONSE_PARSE_ERROR";
  if (typeof value.message === "string") {
    if (
      /network request failed|networkerror|failed to fetch/i.test(value.message)
    )
      return "EVAL_NETWORK_REQUEST_FAILED";
    if (/abort|timed? ?out/i.test(value.message)) return "EVAL_REQUEST_TIMEOUT";
  }
  return "EVAL_UNEXPECTED_ERROR";
}
