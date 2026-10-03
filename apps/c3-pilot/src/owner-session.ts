/** Explicit owner authentication. Bearer exists in memory only; never stored,
 * logged or silently refreshed by recovery/background polling. */
export function createOwnerSession(
  origin: string,
  wallet: string,
  intentId: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  encode: (bytes: Uint8Array) => string,
  now: () => number = () => Date.now(),
  fetcher: typeof fetch = fetch,
) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("C3_OWNER_AUTH_ORIGIN");
  let token: string | null = null,
    expires = 0,
    busy = false;
  const request = async (path: string, body: unknown) => {
    const response = await fetcher(origin + path, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    if (!response.ok || text.length > 2500)
      throw Error("C3_OWNER_AUTH_UNAVAILABLE");
    return JSON.parse(text) as Record<string, unknown>;
  };
  return {
    authenticate: async () => {
      if (busy) throw Error("C3_OPERATION_ALREADY_PENDING");
      busy = true;
      try {
        const r = await request("/v1/c3/owner/challenge", { intentId });
        if (
          typeof r.challengeId !== "string" ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
            r.challengeId,
          ) ||
          typeof r.message !== "string" ||
          r.message.length > 1200
        )
          throw Error("C3_OWNER_AUTH_CHALLENGE");
        const lines = r.message.split("\n");
        if (
          lines.length !== 7 ||
          lines[0] !== "C Market owner session v1" ||
          lines[1] !== `Audience: ${origin}` ||
          lines[2] !== `Wallet: ${wallet}` ||
          lines[3] !== `Intent: ${intentId}` ||
          lines[4] !== `Challenge: ${r.challengeId}` ||
          !/^Nonce: [a-f0-9]{64}$/.test(lines[5]!) ||
          !lines[6]!.startsWith("Expires: ")
        )
          throw Error("C3_OWNER_AUTH_CHALLENGE");
        const until = Date.parse(lines[6]!.slice(9));
        if (!Number.isFinite(until) || until <= now() || until > now() + 125000)
          throw Error("C3_OWNER_AUTH_EXPIRY");
        const message = new TextEncoder().encode(r.message),
          signature = await signMessage(message.slice());
        if (signature.length !== 64 || now() >= until)
          throw Error("C3_OWNER_AUTH_SIGNATURE");
        const authenticated = await request("/v1/c3/owner/session", {
          challengeId: r.challengeId,
          message: encode(message),
          signature: encode(signature),
        });
        if (
          typeof authenticated.token !== "string" ||
          !/^[a-f0-9]{64}$/.test(authenticated.token)
        )
          throw Error("C3_OWNER_AUTH_SESSION");
        token = authenticated.token;
        expires = now() + 540000;
      } finally {
        busy = false;
      }
    },
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      if (!token || now() >= expires) throw Error("C3_OWNER_REAUTH_REQUIRED");
      if (typeof input !== "string" || new URL(input).origin !== origin)
        throw Error("C3_OWNER_SESSION_DESTINATION");
      const headers = new Headers(init?.headers);
      headers.set("authorization", "Bearer " + token);
      return fetcher(input, { ...init, headers, redirect: "error" });
    }) as typeof fetch,
    clear: () => {
      token = null;
      expires = 0;
    },
  };
}
