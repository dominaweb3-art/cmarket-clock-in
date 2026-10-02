import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol";
import { base64ToBase58 } from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";
import { CANDIDATE_CHAIN, requireCandidateMoneyGate } from "./candidate-config";
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
/** No monetary wallet callback can exist before the final release approval.
 * Later implementation must validate the exact unsigned deposit/claim message,
 * identity, freshness and effect manifest BEFORE invoking MWA. Not a stub trade. */
export async function requestCandidateMonetarySignature(): Promise<never> {
  return requireCandidateMoneyGate();
}
