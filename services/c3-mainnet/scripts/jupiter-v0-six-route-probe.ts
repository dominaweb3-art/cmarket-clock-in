/** Public, unsigned v0/ALT measurement only. Never an execution authorization. */
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Connection,
  PublicKey,
} from "@solana/web3.js";
import { C3_MAINNET } from "../src/constants.ts";
import {
  JupiterV2ReadOnlyClient,
  type RouterRequest,
} from "../src/jupiter-v2.ts";
import {
  measureFreshRoutes,
  measureUnsignedV0Candidate,
  type LookupEvidence,
  type MeasuredV0,
} from "../pilot-open-local/jupiter-v0-measure.ts";

// An on-curve public constant with no usable wallet/key in this probe.
const SYNTHETIC_TAKER = "11111111111111111111111111111111";
const RPC = "https://api.mainnet-beta.solana.com";
const TOKEN = new PublicKey(C3_MAINNET.tokenProgram);
const ASSOCIATED = new PublicKey(C3_MAINNET.associatedTokenProgram);

function ata(mint: string): string {
  return PublicKey.findProgramAddressSync(
    [
      new PublicKey(SYNTHETIC_TAKER).toBuffer(),
      TOKEN.toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    ASSOCIATED,
  )[0].toBase58();
}

async function lookups(
  connection: Connection,
  advertised: Readonly<Record<string, readonly string[]>>,
): Promise<readonly LookupEvidence[]> {
  const evidence: LookupEvidence[] = [];
  for (const key of Object.keys(advertised)) {
    const response = await connection.getAccountInfoAndContext(
      new PublicKey(key),
      "finalized",
    );
    const info = response.value;
    if (!info || !info.owner.equals(AddressLookupTableProgram.programId))
      throw new Error("C3_V0_ALT_OWNER_OR_ACCOUNT_MISSING");
    evidence.push({
      table: new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: AddressLookupTableAccount.deserialize(info.data),
      }),
      owner: info.owner.toBase58(),
      observedSlot: response.context.slot,
    });
  }
  return evidence;
}

async function measureLeg(
  connection: Connection,
  client: JupiterV2ReadOnlyClient,
  name: string,
  inputMint: string,
  outputMint: string,
  amount: bigint,
): Promise<Readonly<{ output: bigint; result: MeasuredV0 }>> {
  let quotedOutput: bigint | null = null;
  const result = await measureFreshRoutes(async (maxAccounts) => {
    const request: RouterRequest = {
      inputMint,
      outputMint,
      amount,
      taker: SYNTHETIC_TAKER,
      destinationTokenAccount: ata(outputMint),
      slippageBps: 100,
      maxAccounts,
    };
    const build = await client.getExactInQuote(request);
    quotedOutput = BigInt(build.outAmount);
    // Observe the slot after the ALT reads; concurrent RPC calls may arrive
    // at different finalized slots and spuriously fail ordering checks.
    const lookupEvidence = await lookups(
      connection,
      build.addressesByLookupTableAddress,
    );
    const currentSlot = await connection.getSlot("finalized");
    const currentBlockHeight = await connection.getBlockHeight("finalized");
    const instructions = [
      ...build.computeBudgetInstructions,
      ...build.setupInstructions,
      build.swapInstruction,
      ...(build.cleanupInstruction ? [build.cleanupInstruction] : []),
    ];
    // These accounts are accepted for *measurement* only. No caller- or
    // Jupiter-provided list may become a production writable-account policy.
    const measurementOnlyWritableAccounts = [
      ...new Set(
        instructions.flatMap((ix) =>
          ix.accounts
            .filter((meta) => meta.isWritable)
            .map((meta) => meta.pubkey),
        ),
      ),
    ];
    return measureUnsignedV0Candidate({
      build,
      request,
      feePayer: SYNTHETIC_TAKER,
      lookupEvidence,
      currentSlot,
      currentBlockHeight,
      expectedSource: ata(inputMint),
      expectedDestination: ata(outputMint),
      allowedWritableAccounts: measurementOnlyWritableAccounts,
    });
  });
  if (quotedOutput === null) throw new Error("C3_V0_MISSING_QUOTED_OUTPUT");
  console.log(
    `${name}: unsigned=${result.bytes}/1232 bytes, programs=${result.programs.length}, signer_count=${result.requiredSigners.length}, executable=${result.executable}`,
  );
  return { output: quotedOutput, result };
}

async function main(): Promise<void> {
  const connection = new Connection(RPC, "finalized");
  const client = new JupiterV2ReadOnlyClient();
  const legs = [
    ["cbBTC", C3_MAINNET.cbBtcMint, 400_000n],
    ["Portal ETH", C3_MAINNET.portalEthMint, 300_000n],
    ["WSOL", C3_MAINNET.wrappedSolMint, 300_000n],
  ] as const;
  let failures = 0;
  for (const [name, mint, input] of legs) {
    let sellAmount: bigint | null = null;
    try {
      sellAmount = (
        await measureLeg(
          connection,
          client,
          `${name} buy`,
          C3_MAINNET.usdcMint,
          mint,
          input,
        )
      ).output;
    } catch (error) {
      failures += 1;
      console.log(
        `${name} buy: BLOCKED ${error instanceof Error ? error.message : "C3_V0_UNKNOWN"}`,
      );
    }
    if (sellAmount === null) {
      console.log(`${name} sell: NOT_MEASURED (buy output unavailable)`);
      failures += 1;
      continue;
    }
    try {
      await measureLeg(
        connection,
        client,
        `${name} sell`,
        mint,
        C3_MAINNET.usdcMint,
        sellAmount,
      );
    } catch (error) {
      failures += 1;
      console.log(
        `${name} sell: BLOCKED ${error instanceof Error ? error.message : "C3_V0_UNKNOWN"}`,
      );
    }
  }
  console.log(
    `UNSIGNED_READ_ONLY_ROUTE_MEASUREMENT; failures=${failures}; vault-CPI-and-governance-not-proven`,
  );
  if (failures) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "C3_V0_PROBE_FAILED");
  process.exitCode = 1;
});
