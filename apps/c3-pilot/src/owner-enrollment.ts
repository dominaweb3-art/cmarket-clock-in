/** Pre-intent control proof, not a transaction or an execution approval.
 * Scope comes from the source-reviewed release, never a server response.
 * No persistence, automatic retries, token storage or wallet invocation on read. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base58ToUint8Array } from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";

export type OwnerEnrollmentScope = Readonly<{
  wallet: string;
  program: string;
  vault: string;
  policyHash: string;
  registryRevision: string;
  quotePolicyRevision: string;
}>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
let sequence = 0;
export function createOwnerEnrollment(
  origin: string,
  reviewedScope: OwnerEnrollmentScope,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  encode: (bytes: Uint8Array) => string,
  now: () => number = () => Date.now(),
  fetcher: typeof fetch = fetch,
) {
  const u = new URL(origin);
  if (
    u.protocol !== "https:" ||
    u.origin !== origin ||
    u.username ||
    u.password
  )
    throw Error("C3_OWNER_ENROLLMENT_ORIGIN");
  const scope = Object.freeze({ ...reviewedScope });
  for (const key of [scope.wallet, scope.program, scope.vault]) {
    if (
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key) ||
      base58ToUint8Array(key).length !== 32
    )
      throw Error("C3_OWNER_ENROLLMENT_SCOPE");
  }
  if (
    !/^[a-f0-9]{64}$/.test(scope.policyHash) ||
    scope.policyHash === "0".repeat(64) ||
    ![scope.registryRevision, scope.quotePolicyRevision].every((v) =>
      /^[1-9][0-9]{0,18}$/.test(v),
    )
  )
    throw Error("C3_OWNER_ENROLLMENT_SCOPE");
  const publicKey = base58ToUint8Array(scope.wallet);
  let busy = false;
  let intentId: string | null = null;
  const post = async (path: string, body: unknown) => {
    const response = await fetcher(origin + path, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    if (!response.ok || text.length > 2500)
      throw Error("C3_OWNER_ENROLLMENT_UNCERTAIN");
    return JSON.parse(text) as Record<string, unknown>;
  };
  const sign = async (message: string) => {
    const bytes = new TextEncoder().encode(message);
    const signature = await signMessage(bytes.slice());
    if (
      !(signature instanceof Uint8Array) ||
      signature.length !== 64 ||
      !ed25519.verify(signature, bytes, publicKey, { zip215: false })
    )
      throw Error("C3_OWNER_ENROLLMENT_SIGNATURE");
    return { message: encode(bytes), signature: encode(signature) };
  };
  return {
    get intentId() {
      return intentId;
    },
    // Only an explicit owner action may call enroll. Restart starts empty;
    // a fresh proof returns the same PostgreSQL intent rather than creating one.
    enroll: async () => {
      if (busy) throw Error("C3_OPERATION_ALREADY_PENDING");
      if (intentId) return intentId;
      busy = true;
      try {
        const started = now();
        if (!Number.isSafeInteger(started) || started < 1000)
          throw Error("C3_OWNER_ENROLLMENT_CLOCK");
        const requestedAtUnix = Math.floor(started / 1000);
        // This is a PUBLIC request uniqueness value, not an authentication
        // secret/challenge. Authentication is the owner signature; the server
        // creates the unpredictable challenge with its own CSPRNG.
        const nonce = bytesToHex(
          sha256(
            new TextEncoder().encode(
              `${origin}\n${scope.wallet}\n${scope.policyHash}\n${started}\n${performance.now()}\n${++sequence}`,
            ),
          ),
        );
        const request = await sign(
          [
            "C Market owner enrollment challenge request v1",
            "Purpose: request one control-proof challenge; NO transaction, transfer, token approval, login or Mainnet execution authorization.",
            `Audience: ${origin}`,
            `Wallet: ${scope.wallet}`,
            `Program: ${scope.program}`,
            `Vault: ${scope.vault}`,
            `Policy SHA-256: ${scope.policyHash}`,
            `Nonce: ${nonce}`,
            `Requested at Unix: ${requestedAtUnix}`,
          ].join("\n"),
        );
        if (now() < started || now() - started >= 120000)
          throw Error("C3_OWNER_ENROLLMENT_EXPIRY");
        const challenge = await post("/v1/c3/owner/enrollment-challenge", {
          nonce,
          requestedAtUnix,
          signature: request.signature,
        });
        if (
          Object.keys(challenge).sort().join(",") !==
            "challengeId,expiresAt,message" ||
          typeof challenge.challengeId !== "string" ||
          !uuid.test(challenge.challengeId) ||
          typeof challenge.message !== "string" ||
          typeof challenge.expiresAt !== "string"
        )
          throw Error("C3_OWNER_ENROLLMENT_CHALLENGE");
        const until = Date.parse(challenge.expiresAt);
        if (
          !Number.isFinite(until) ||
          new Date(until).toISOString() !== challenge.expiresAt ||
          now() < started ||
          until <= now() ||
          until > now() + 125000
        )
          throw Error("C3_OWNER_ENROLLMENT_EXPIRY");
        const lines = challenge.message.split("\n");
        const expected = [
          "C Market owner enrollment control proof v1",
          "Purpose: enroll this wallet only; NO transaction, transfer, token approval or Mainnet execution authorization.",
          "Network: solana:mainnet (message only)",
          `Audience: ${origin}`,
          `Wallet: ${scope.wallet}`,
          `Program: ${scope.program}`,
          `Vault: ${scope.vault}`,
          `Policy SHA-256: ${scope.policyHash}`,
          `Registry revision: ${scope.registryRevision}`,
          `Quote policy revision: ${scope.quotePolicyRevision}`,
          `Challenge: ${challenge.challengeId}`,
          lines[11],
          `Expires: ${challenge.expiresAt}`,
        ];
        if (
          lines.length !== 13 ||
          !/^Nonce: [a-f0-9]{64}$/.test(lines[11] ?? "") ||
          !expected.every((v, i) => v === lines[i])
        )
          throw Error("C3_OWNER_ENROLLMENT_CHALLENGE");
        const proof = await sign(challenge.message);
        if (now() < started || now() >= until)
          throw Error("C3_OWNER_ENROLLMENT_EXPIRY");
        const result = await post("/v1/c3/owner/enroll", {
          challengeId: challenge.challengeId,
          ...proof,
        });
        if (
          Object.keys(result).join(",") !== "intentId" ||
          typeof result.intentId !== "string" ||
          !uuid.test(result.intentId)
        )
          throw Error("C3_OWNER_ENROLLMENT_RESPONSE");
        intentId = result.intentId;
        return intentId;
      } finally {
        busy = false;
      }
    },
  };
}
