import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol";
import { base64ToBase58 } from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";

/** Authorization only, on Devnet, by an explicit connect-button action. No
 * sign-in message, wallet signature, transaction method or auth-token storage.
 * Connection NEVER enables the immutable-disabled C3 monetary capability.
 */
export async function connectReadOnlyWallet(): Promise<string> {
  return transact(async (wallet) => {
    const result = await wallet.authorize({
      chain: "solana:devnet",
      identity: {
        name: "C Market C3 Pilot",
        uri: "https://cmarket-identity.vercel.app",
      },
    });
    const account = result.accounts[0];
    if (!account) throw new Error("WALLET_ACCOUNT_UNAVAILABLE");
    const address = base64ToBase58(account.address);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
      throw new Error("INVALID_WALLET_ADDRESS");
    return address;
  });
}
