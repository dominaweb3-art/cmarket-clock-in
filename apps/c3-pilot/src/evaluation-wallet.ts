import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol";
import {
  base64FromUint8Array,
  base64ToBase58,
} from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";
import {
  EVALUATION_CHAIN,
  EVALUATION_ENDPOINT,
  inspectEvaluationChallenge,
  inspectEvaluationSignedMessage,
  type EvaluationChallenge,
} from "./evaluation-protocol";

const identity = Object.freeze({
  name: "C Market Devnet Evaluation",
  uri: EVALUATION_ENDPOINT,
});
/** Connection alone never requests a message or transaction signature. */
export async function connectEvaluationWallet() {
  return transact(async (wallet) => {
    const authorization = await wallet.authorize({
      chain: EVALUATION_CHAIN,
      identity,
    });
    const account = authorization.accounts[0];
    if (!account) throw Error("EVAL_WALLET_ACCOUNT_UNAVAILABLE");
    return base64ToBase58(account.address);
  });
}
/** Separate user button + explanation. This signs a bounded authentication
 * message only; no transaction API exists in this module. */
export async function signEvaluationProof(
  challenge: EvaluationChallenge,
  owner: string,
) {
  const message = inspectEvaluationChallenge(challenge, owner);
  return transact(async (wallet) => {
    inspectEvaluationChallenge(challenge, owner);
    const authorization = await wallet.authorize({
      chain: EVALUATION_CHAIN,
      identity,
    });
    const account = authorization.accounts.find(
      (a) => base64ToBase58(a.address) === owner,
    );
    if (!account) throw Error("EVAL_WALLET_CHANGED");
    inspectEvaluationChallenge(challenge, owner);
    const result = await wallet.signMessages({
      addresses: [account.address],
      payloads: [base64FromUint8Array(message)],
    });
    if (result.signed_payloads.length !== 1)
      throw Error("EVAL_WALLET_RESPONSE_INVALID");
    return inspectEvaluationSignedMessage(
      owner,
      message,
      result.signed_payloads[0]!,
    );
  });
}
