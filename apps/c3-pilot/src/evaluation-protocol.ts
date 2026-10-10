/** Devnet-only mobile protocol. No environment override, Mainnet policy,
 * transaction signing, automatic retry, or persisted session credential. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { evaluationErrorCode } from "./evaluation-errors.ts";
import { nativeEvaluationPost } from "./evaluation-transport.ts";
import {
  base58ToUint8Array,
  base64ToUint8Array,
} from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";

export const EVALUATION_ENDPOINT = "https://cmarket-nine.vercel.app";
export const EVALUATION_CHAIN = "solana:devnet";
export const EVALUATION_PROGRAM =
  "2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg";
export const EVALUATION_MAINNET = false as const;
export type EvaluationChallenge = Readonly<{
  challengeId: string;
  wallet: string;
  cluster: string;
  message: string;
  expiresAt: string;
}>;
export function inspectEvaluationChallenge(
  challenge: EvaluationChallenge,
  wallet: string,
  now = Date.now(),
) {
  const publicKey = base58ToUint8Array(wallet);
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const expiry = Date.parse(challenge.expiresAt);
  const prefix = `C Market Devnet evaluation wallet proof v1\nAudience: ${EVALUATION_ENDPOINT}\nNetwork: ${EVALUATION_CHAIN}\nTokens have no monetary value. This message does not transfer funds.\nWallet: ${wallet}\nChallenge: ${challenge.challengeId}\nNonce: `;
  const nonce = challenge.message?.slice(prefix.length, prefix.length + 64);
  if (
    publicKey.length !== 32 ||
    challenge.wallet !== wallet ||
    challenge.cluster !== EVALUATION_CHAIN ||
    !uuid.test(challenge.challengeId) ||
    !Number.isFinite(expiry) ||
    expiry <= now ||
    expiry - now > 125000 ||
    !/^[a-f0-9]{64}$/.test(nonce ?? "") ||
    challenge.message !== `${prefix}${nonce}\nExpires: ${challenge.expiresAt}`
  )
    throw Error("EVAL_MESSAGE_REJECTED");
  return new TextEncoder().encode(challenge.message);
}
export function inspectEvaluationSignedMessage(
  wallet: string,
  message: Uint8Array,
  payload: string,
) {
  const signed = base64ToUint8Array(payload);
  // The official MWA reference's sign-in fallback accepts detached signatures
  // as well as message || signature. Never accept a rewritten signed message:
  // both forms MUST verify against the exact challenge inspected above.
  let signature: Uint8Array;
  if (signed.length === 64) signature = signed;
  else if (
    signed.length === message.length + 64 &&
    message.every((v, i) => signed[i] === v)
  )
    signature = signed.slice(message.length);
  else throw Error("EVAL_WALLET_MESSAGE_CHANGED");
  if (!ed25519.verify(signature, message, base58ToUint8Array(wallet)))
    throw Error("EVAL_WALLET_SIGNATURE_INVALID");
  return signature;
}
export async function evaluationRequest(
  body: Readonly<Record<string, unknown>>,
  token?: string,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  // Hosted lifecycle advances may need paced finalized RPC reads. An abort is
  // never interpreted as failure or permission to repeat the original send.
  const timeout = setTimeout(() => controller.abort(), 50000);
  let stage = "FETCH";
  try {
    const native =
      typeof XMLHttpRequest !== "undefined"
        ? await nativeEvaluationPost(
            `${EVALUATION_ENDPOINT}/api/evaluation`,
            JSON.stringify(body),
            token,
          )
        : undefined;
    const response =
      native ??
      (await fetch(`${EVALUATION_ENDPOINT}/api/evaluation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }));
    stage = "READ_RESPONSE";
    const text = native ? native.text : await (response as Response).text();
    stage = "PARSE_RESPONSE";
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw Error(`EVAL_HTTP_${response.status}_INVALID_JSON`);
    }
    stage = "HTTP_STATUS";
    if (response.status < 200 || response.status >= 300) {
      const code = typeof result.error === "string" ? result.error : "";
      throw Error(
        /^[A-Z][A-Z0-9_]{2,90}$/.test(code) ? code : "EVAL_HTTP_ERROR",
      );
    }
    return result;
  } catch (error) {
    const code = evaluationErrorCode(error);
    if (code !== "EVAL_UNEXPECTED_ERROR") throw Error(code);
    // Diagnostic metadata only: no request, response, signature or session.
    const stack = error instanceof Error ? (error.stack ?? "") : "";
    const kind = /convert.*(?:native|dynamic)|NativeMap|HostFunction/i.test(
      stack,
    )
      ? "NATIVE_BRIDGE"
      : "UNKNOWN";
    throw Error(`EVAL_REQUEST_${stage}_${kind}`);
  } finally {
    clearTimeout(timeout);
  }
}

/** A DNS failure has no HTTP response. Recover ONLY the non-monetary proof,
 * with the same challenge/signature in memory and within its original expiry.
 * Never applies to prepare, submit, provision, advance or any transaction. */
export async function submitEvaluationProof(
  challenge: EvaluationChallenge,
  signature: string,
  request = evaluationRequest,
  wait: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
) {
  const body = Object.freeze({
    operation: "authenticate",
    challengeId: challenge.challengeId,
    message: challenge.message,
    signature,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    if (now() >= Date.parse(challenge.expiresAt))
      throw Error("EVAL_AUTH_CHALLENGE_EXPIRED");
    try {
      return await request(body);
    } catch (error) {
      if (
        attempt !== 0 ||
        evaluationErrorCode(error) !== "EVAL_NETWORK_DNS_ERROR"
      )
        throw error;
      // Android caches negative DNS answers. Wait past that cache window;
      // never ask the wallet to sign again and never refresh the challenge.
      if (now() + 11000 >= Date.parse(challenge.expiresAt)) throw error;
      await wait(11000);
    }
  }
  throw Error("EVAL_AUTH_PROOF_UNAVAILABLE");
}
