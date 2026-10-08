/** Devnet-only mobile protocol. No environment override, Mainnet policy,
 * transaction signing, automatic retry, or persisted session credential. */
import { ed25519 } from "@noble/curves/ed25519.js";
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
  if (
    signed.length !== message.length + 64 ||
    !message.every((v, i) => signed[i] === v)
  )
    throw Error("EVAL_WALLET_MESSAGE_CHANGED");
  const signature = signed.slice(message.length);
  if (!ed25519.verify(signature, message, base58ToUint8Array(wallet)))
    throw Error("EVAL_WALLET_SIGNATURE_INVALID");
  return signature;
}
export async function evaluationRequest(
  body: Readonly<Record<string, unknown>>,
  token?: string,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${EVALUATION_ENDPOINT}/api/evaluation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      const code = typeof result.error === "string" ? result.error : "";
      throw Error(
        /^[A-Z][A-Z0-9_]{2,90}$/.test(code) ? code : "EVAL_HTTP_ERROR",
      );
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
