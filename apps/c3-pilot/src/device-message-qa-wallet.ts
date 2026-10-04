import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol";
import {
  base58ToUint8Array,
  base64ToUint8Array,
  base64ToBase58,
  base64FromUint8Array,
} from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";
import {
  createDeviceQaReview,
  consumeDeviceQaReview,
  verifyDeviceQaReply,
  assertDeviceQaFresh,
  DEVICE_QA_CHAIN,
  type DeviceQaReview,
} from "./device-message-qa";
export const prepareDeviceQa = (wallet: string) =>
  createDeviceQaReview(base58ToUint8Array(wallet));
/** Only called by the explicit second review button. Does NOT call owner auth,
 * any transaction signing, submit/send, backend, storage or an enabled gate. */
export async function signDeviceQa(review: DeviceQaReview) {
  const expected = consumeDeviceQaReview(review);
  return transact(async (wallet) => {
    const authorized = await wallet.authorize({
      chain: DEVICE_QA_CHAIN,
      identity: {
        name: "C Market · Device QA (no funds)",
        uri: "https://cmarket-identity.vercel.app",
      },
    });
    const account = authorized.accounts.find((a) => {
      const key = base58ToUint8Array(base64ToBase58(a.address));
      return key.length === 32 && key.every((b, i) => expected.wallet[i] === b);
    });
    assertDeviceQaFresh(expected);
    if (!account) throw Error("C3_DEVICE_QA_WALLET_OR_EXPIRY");
    const result = await wallet.signMessages({
      addresses: [account.address],
      payloads: [base64FromUint8Array(expected.bytes)],
    });
    if (result.signed_payloads.length !== 1)
      throw Error("C3_DEVICE_QA_RESPONSE");
    return verifyDeviceQaReply(
      expected,
      base64ToUint8Array(result.signed_payloads[0]!),
    );
  });
}
