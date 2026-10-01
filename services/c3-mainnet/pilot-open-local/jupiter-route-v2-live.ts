/** Official API/RPC read-only probe. Never builds/signs/submits a transaction. */
import { JupiterV2ReadOnlyClient } from "../src/jupiter-v2.ts";
import { C3_MAINNET as c } from "../src/constants.ts";
import { validateDirectWhirlpoolRoute } from "./jupiter-route-v2.ts";
import { VAULT_AUTHORITY, vaultAta } from "./jupiter-vault-cpi-inspection.ts";
const client = new JupiterV2ReadOnlyClient({
  fetchImpl: (input, init) => {
    const url = new URL(String(input));
    url.searchParams.set("dexes", "Whirlpool");
    return fetch(url, init);
  },
});
for (const [asset, input] of [
  [c.cbBtcMint, 400000n],
  [c.portalEthMint, 300000n],
  [c.wrappedSolMint, 300000n],
] as const) {
  let amount: bigint = input;
  for (const sell of [false, true]) {
    const inputMint = sell ? asset : c.usdcMint,
      outputMint = sell ? c.usdcMint : asset;
    const q = await client.getExactInQuote({
      inputMint,
      outputMint,
      amount,
      taker: VAULT_AUTHORITY.toBase58(),
      destinationTokenAccount: vaultAta(outputMint),
      slippageBps: 100,
      maxAccounts: 16,
    });
    validateDirectWhirlpoolRoute(q, {
      authority: VAULT_AUTHORITY.toBase58(),
      source: vaultAta(inputMint),
      destination: vaultAta(outputMint),
      inputMint,
      outputMint,
      inputAmount: amount,
      maxSlippageBps: 100,
    });
    console.log(
      JSON.stringify({
        asset:
          asset === c.cbBtcMint
            ? "BTC"
            : asset === c.portalEthMint
              ? "ETH"
              : "SOL",
        direction: sell ? "sell" : "buy",
        instructionValidation: "PASS",
        input: q.inAmount,
        output: q.outAmount,
        threshold: q.otherAmountThreshold,
        slippageBps: q.slippageBps,
        quoteFetchedAtMs: q.blockhashWithMetadata.fetchedAtEpochMs,
        expiryMs: q.blockhashWithMetadata.fetchedAtEpochMs + 30000,
        onchainExecution: false,
      }),
    );
    amount = BigInt(q.outAmount);
  }
}
