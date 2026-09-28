/** Public read-only feasibility probe. It cannot authorize or execute a C3 settlement. */
import { C3_MAINNET } from "../src/constants.ts";
import { JupiterV2ReadOnlyClient } from "../src/jupiter-v2.ts";

const RPC = "https://api.mainnet-beta.solana.com";
const SYNTHETIC_TAKER = "11111111111111111111111111111111";
const mints = [
  C3_MAINNET.usdcMint,
  C3_MAINNET.cbBtcMint,
  C3_MAINNET.portalEthMint,
  C3_MAINNET.wrappedSolMint,
] as const;

async function readMintAccounts(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(RPC, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getMultipleAccounts",
        params: [mints, { encoding: "jsonParsed", commitment: "finalized" }],
      }),
    });
    if (!response.ok) throw new Error(`C3_RPC_HTTP_${response.status}`);
    const raw = await response.text();
    if (raw.length > 64_000) throw new Error("C3_RPC_RESPONSE_TOO_LARGE");
    const parsed = JSON.parse(raw) as {
      result?: {
        value?: Array<{
          owner: string;
          data?: {
            parsed?: {
              type?: string;
              info?: { decimals?: number; supply?: string };
            };
          };
        } | null>;
      };
    };
    const accounts = parsed.result?.value;
    if (!Array.isArray(accounts) || accounts.length !== mints.length)
      throw new Error("C3_RPC_MINT_EVIDENCE_MISSING");
    for (let index = 0; index < mints.length; index += 1) {
      const account = accounts[index];
      if (
        account?.owner !== C3_MAINNET.tokenProgram ||
        account.data?.parsed?.type !== "mint" ||
        !Number.isSafeInteger(account.data.parsed.info?.decimals) ||
        !/^[0-9]+$/.test(account.data.parsed.info?.supply ?? "")
      )
        throw new Error(`C3_RPC_MINT_${index}_INVALID`);
      console.log(`mint ${index + 1}: verified owner/decimals/supply`);
    }
    if (accounts[0]?.data?.parsed?.info?.decimals !== 6)
      throw new Error("C3_RPC_USDC_DECIMALS_MISMATCH");
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  console.log(
    "C3 Jupiter V2 public read-only preflight; no wallet, signing or submission.",
  );
  await readMintAccounts();
  const apiKey = process.env.C3_JUPITER_API_KEY;
  const client = new JupiterV2ReadOnlyClient(apiKey ? { apiKey } : {});
  const registry = await client.getProgramRegistry();
  console.log(
    `Jupiter program-label endpoint: reachable; ${Object.keys(registry).length} labels (informational only).`,
  );
  const legs = [
    { name: "cbBTC", mint: C3_MAINNET.cbBtcMint, input: 400_000n },
    { name: "Portal ETH", mint: C3_MAINNET.portalEthMint, input: 300_000n },
    { name: "WSOL", mint: C3_MAINNET.wrappedSolMint, input: 300_000n },
  ] as const;
  const deposits = [];
  for (const leg of legs) {
    const build = await client.getExactInQuote({
      inputMint: C3_MAINNET.usdcMint,
      outputMint: leg.mint,
      amount: leg.input,
      taker: SYNTHETIC_TAKER,
      slippageBps: 100,
      maxAccounts: 32,
    });
    deposits.push(build);
    console.log(
      `${leg.name} deposit: quote/build received; output=${build.outAmount}, minimum=${build.otherAmountThreshold}, impact=${build.priceImpactPct}, swap_accounts=${build.swapInstruction.accounts.length}, lookup_tables=${Object.keys(build.addressesByLookupTableAddress).length}, setup=${build.setupInstructions.length}, cleanup=${build.cleanupInstruction ? 1 : 0}.`,
    );
  }
  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index]!;
    const previous = deposits[index]!;
    const build = await client.getExactInQuote({
      inputMint: leg.mint,
      outputMint: C3_MAINNET.usdcMint,
      amount: BigInt(previous.outAmount),
      taker: SYNTHETIC_TAKER,
      slippageBps: 100,
      maxAccounts: 32,
    });
    console.log(
      `${leg.name} redemption: quote/build received; output=${build.outAmount}, minimum=${build.otherAmountThreshold}, impact=${build.priceImpactPct}, swap_accounts=${build.swapInstruction.accounts.length}, lookup_tables=${Object.keys(build.addressesByLookupTableAddress).length}, setup=${build.setupInstructions.length}, cleanup=${build.cleanupInstruction ? 1 : 0}.`,
    );
  }
  console.log(
    "READ_ONLY_QUOTES_AVAILABLE; EXECUTABLE_VAULT_SETTLEMENT_UNVERIFIED (synthetic taker, no deployed vault or destination, CPI/ALT/size not proven).",
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "C3_PREFLIGHT_UNKNOWN_ERROR";
  console.error(
    message.startsWith("C3_") ? message : "C3_PREFLIGHT_NETWORK_ERROR",
  );
  process.exitCode = 1;
});
