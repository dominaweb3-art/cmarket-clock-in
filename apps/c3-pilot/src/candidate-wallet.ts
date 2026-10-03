import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol";
import {
  CANDIDATE_CHAIN,
  requireCandidateMoneyGate,
  runCandidateMonetarySession,
} from "./candidate-config";
import {
  inspectOwnerTransaction,
  freezeOwnerReview,
  type OwnerInstructionReview,
} from "./owner-transaction-review";
import {
  base64ToUint8Array,
  base64FromUint8Array,
  base58ToUint8Array,
  base64ToBase58,
} from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";
/** Explicit Connect button only. Chain changes for this separate candidate,
 * NEVER for QA or the stable Devnet app. No sign-in message/token persistence. */
export async function connectCandidateWallet(): Promise<string> {
  return transact(async (wallet) => {
    const r = await wallet.authorize({
      chain: CANDIDATE_CHAIN,
      identity: {
        name: "C Market C3 Candidate",
        uri: "https://cmarket-identity.vercel.app",
      },
    });
    const a = r.accounts[0];
    if (!a) throw new Error("C3_WALLET_ACCOUNT_UNAVAILABLE");
    const address = base64ToBase58(a.address);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
      throw new Error("C3_WALLET_ADDRESS_INVALID");
    return address;
  });
}
/** Owner sign-in is a separate explicit non-transaction message. Still gated:
 * this disabled release cannot start authentication via a route/env override. */
export async function authenticateCandidateOwner(
  walletAddress: string,
  message: Uint8Array,
): Promise<Uint8Array> {
  requireCandidateMoneyGate();
  const frozen = message.slice();
  return runCandidateMonetarySession(() =>
    transact(async (wallet) => {
      const authorized = await wallet.authorize({
        chain: CANDIDATE_CHAIN,
        identity: {
          name: "C Market C3 Candidate",
          uri: "https://cmarket-identity.vercel.app",
        },
      });
      const account = authorized.accounts.find(
        (a) => base64ToBase58(a.address) === walletAddress,
      );
      if (!account) throw Error("C3_WALLET_CHANGED");
      const result = await wallet.signMessages({
        addresses: [account.address],
        payloads: [base64FromUint8Array(frozen)],
      });
      if (result.signed_payloads.length !== 1)
        throw Error("C3_WALLET_RESPONSE_INVALID");
      const signed = base64ToUint8Array(result.signed_payloads[0]!);
      // MWA signed message is original payload followed by its Ed25519 signature.
      if (
        signed.length !== frozen.length + 64 ||
        !frozen.every((b, i) => signed[i] === b)
      )
        throw Error("C3_WALLET_MESSAGE_CHANGED");
      return signed.slice(frozen.length);
    }),
  );
}
/** No monetary wallet callback can exist before the final release approval.
 * Later implementation must validate the exact unsigned deposit/claim message,
 * identity, freshness and effect manifest BEFORE invoking MWA. Not a stub trade. */
export async function requestCandidateMonetarySignature(
  walletAddress: string,
  packet: Uint8Array,
  expected: readonly OwnerInstructionReview[],
): Promise<Uint8Array> {
  // Immutable gate BEFORE any inspection, wallet callback or RPC operation.
  // Templates are not yet supplied by a reviewed backend, so this candidate
  // remains deliberately unreachable. No constructor/env/deep-link bypass.
  requireCandidateMoneyGate();
  const frozen = freezeOwnerReview(
    packet,
    base58ToUint8Array(walletAddress),
    expected,
  );
  // Immutable payload string created BEFORE any await or external callback.
  const payload = base64FromUint8Array(frozen.bytes),
    review = frozen.review;
  return runCandidateMonetarySession(() =>
    transact(async (wallet) => {
      const authorization = await wallet.authorize({
        chain: CANDIDATE_CHAIN,
        identity: {
          name: "C Market C3 Candidate",
          uri: "https://cmarket-identity.vercel.app",
        },
      });
      if (
        !authorization.accounts.some(
          (a) => base64ToBase58(a.address) === walletAddress,
        )
      )
        throw Error("C3_WALLET_CHANGED");
      const result = await wallet.signTransactions({ payloads: [payload] });
      if (result.signed_payloads.length !== 1)
        throw Error("C3_WALLET_RESPONSE_INVALID");
      const signed = base64ToUint8Array(result.signed_payloads[0]!);
      const after = inspectOwnerTransaction(
        signed,
        frozen.wallet,
        frozen.templates,
        true,
      );
      if (
        after.message.length !== review.message.length ||
        !after.message.every((v, i) => v === review.message[i])
      )
        throw Error("C3_WALLET_MESSAGE_CHANGED");
      // No signAndSend: signed result must be journaled/verified server-side BEFORE
      // any future explicit submission. This method performs no submission.
      return signed;
    }),
  );
}
