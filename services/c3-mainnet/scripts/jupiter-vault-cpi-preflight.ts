/** Read-only first-leg blocker reproduction. No wallet, signing, simulation or submission. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
  deriveQuoteMinimum,
  encodeQuoteSealV1,
  quoteIdForNonce,
} from "../src/quote-seal.ts";
import {
  inspectVaultCpiEnvelope,
  VAULT_AUTHORITY,
  vaultAta,
} from "../pilot-open-local/jupiter-vault-cpi-inspection.ts";
import type { LookupEvidence } from "../pilot-open-local/jupiter-v0-measure.ts";
import {
  quoteAltContentsHash,
  type QuoteAltAccount,
} from "../src/quote-alt.ts";

const hash = (text: string): Buffer =>
  createHash("sha256").update(text).digest();
async function main(): Promise<void> {
  const connection = new Connection("https://api.mainnet-beta.solana.com", {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
    fetch: (url, init) =>
      fetch(url, { ...init, signal: AbortSignal.timeout(12_000) }),
  });
  if ((await connection.getGenesisHash()) !== C3_MAINNET.genesisHash)
    throw new Error("C3_CPI_RPC_GENESIS_MISMATCH");
  const client = new JupiterV2ReadOnlyClient();
  const request: RouterRequest = {
    inputMint: C3_MAINNET.usdcMint,
    outputMint: C3_MAINNET.cbBtcMint,
    amount: 400_000n,
    taker: VAULT_AUTHORITY.toBase58(),
    destinationTokenAccount: vaultAta(C3_MAINNET.cbBtcMint),
    slippageBps: 100,
    maxAccounts: 32,
  };
  const build = await client.getExactInQuote(request);
  const evidence: LookupEvidence[] = [];
  const rawAlts: QuoteAltAccount[] = [];
  for (const key of Object.keys(build.addressesByLookupTableAddress)) {
    const response = await connection.getAccountInfoAndContext(
      new PublicKey(key),
      "finalized",
    );
    if (
      !response.value ||
      !response.value.owner.equals(AddressLookupTableProgram.programId)
    )
      throw new Error("C3_CPI_ALT_OWNER_OR_ACCOUNT_MISSING");
    evidence.push({
      table: new AddressLookupTableAccount({
        key: new PublicKey(key),
        state: AddressLookupTableAccount.deserialize(response.value.data),
      }),
      owner: response.value.owner.toBase58(),
      observedSlot: response.context.slot,
    });
    rawAlts.push({
      address: key,
      owner: response.value.owner.toBase58(),
      data: response.value.data,
    });
  }
  const currentSlot = await connection.getSlot("finalized");
  const currentBlockHeight = await connection.getBlockHeight("finalized");
  const inspection = inspectVaultCpiEnvelope({
    build,
    request,
    lookupEvidence: evidence,
    currentSlot,
    currentBlockHeight,
    nowMs: Date.now(),
  });
  const rust = readFileSync(
    new URL(
      "../../../programs/c3-pilot-vault/programs/c3_pilot_vault/src/swap_leg.rs",
      import.meta.url,
    ),
    "utf8",
  );
  const blockers: string[] = [];
  const nonce = hash("diagnostic-no-authorization-created");
  let codecResult = "ACCEPTED_DIAGNOSTIC_ONLY";
  // Synthetic context deliberately cannot authorize an intent. This call only
  // measures codec compatibility with actual public ALT bytes. It does not
  // load durable intent/policy or create a fund-authorizing signature.
  try {
    const now = BigInt(Math.floor(Date.now() / 1_000));
    encodeQuoteSealV1({
      contextHash: hash("synthetic-context"),
      quoteId: quoteIdForNonce(nonce),
      nonce,
      inputAmount: request.amount,
      quotedOutput: BigInt(build.outAmount),
      slippageBps: request.slippageBps,
      minimumOutput: deriveQuoteMinimum(
        BigInt(build.outAmount),
        request.slippageBps,
        BigInt(build.otherAmountThreshold),
      ),
      routeHash: hash("diagnostic-route"),
      instructionHash: Buffer.from(inspection.instructionHash, "hex"),
      accountMetasHash: hash("diagnostic-metas"),
      altCount: inspection.lookupCount,
      altContentsHash: quoteAltContentsHash(rawAlts, BigInt(currentSlot)),
      builderTimestamp: now,
      builderSlot: BigInt(currentSlot),
      expiresAt: now + 30n,
      expiresSlot: BigInt(currentSlot + 60),
    });
  } catch (error) {
    codecResult =
      error instanceof Error ? error.message : "UNKNOWN_CODEC_FAILURE";
  }
  if (codecResult !== "ACCEPTED_DIAGNOSTIC_ONLY")
    blockers.push(`QUOTE_CODEC:${codecResult}`);
  if (
    inspection.lookupCount &&
    /seal\.alt_count == 0 && seal\.alt_contents_hash == \[0; 32\]/.test(rust)
  )
    blockers.push("AUTHORIZE_SWAP_LEG_REJECTS_VERIFIED_ALT");
  if (
    inspection.routerAliasIndexes.length &&
    /require!\(key != router, VaultError::SwapAccount\)/.test(rust)
  )
    blockers.push("EXECUTE_SWAP_LEG_REJECTS_REQUIRED_JUPITER_SELF_METAS");
  if (!inspection.fits) blockers.push("VAULT_OUTER_V0_EXCEEDS_1232_BYTES");
  if (
    deriveQuoteMinimum(
      BigInt(build.outAmount),
      request.slippageBps,
      BigInt(build.otherAmountThreshold),
    ) < BigInt(build.otherAmountThreshold)
  )
    blockers.push("QUOTE_SEAL_MINIMUM_WEAKER_THAN_JUPITER_THRESHOLD");
  if (
    rust.includes('[b"liquidity"], &router') &&
    !rust.includes("crate::whirlpool_roles::pool_token_role")
  )
    blockers.push("PRODUCTION_POOL_AUTHORITY_VALIDATION_IS_MOCK_SPECIFIC");
  blockers.push(
    "DURABLE_INTENT_TO_VALIDATED_JUPITER_TO_SIGNER_FLOW_NOT_CONNECTED",
  );
  // Even a fit is only unsigned compatibility evidence, not an execution test.
  console.log(
    JSON.stringify(
      {
        decision: "BLOCKED",
        observedAt: new Date().toISOString(),
        operation: "first-buy-leg-USDC-to-cbBTC",
        inputBaseUnits: request.amount.toString(),
        quotedOutputBaseUnits: build.outAmount,
        jupiterMinimumBaseUnits: build.otherAmountThreshold,
        currentSealMinimumBaseUnits: deriveQuoteMinimum(
          BigInt(build.outAmount),
          request.slippageBps,
          BigInt(build.otherAmountThreshold),
        ).toString(),
        slippageBps: request.slippageBps,
        rpcGenesisVerified: true,
        inspection,
        codecResult,
        inspectedRustSha256: hash(rust).toString("hex"),
        blockers,
        cpiExecuted: false,
        assetsAcquired: false,
        existingIntentLoaded: false,
        authorizationPersistedOrSigned: false,
        productionEnabled: false,
      },
      null,
      2,
    ),
  );
  process.exitCode = 2;
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      decision: "BLOCKED",
      operation: "read-only-first-leg-inspection",
      error:
        error instanceof Error ? error.message : "C3_CPI_INSPECTION_FAILED",
      cpiExecuted: false,
      assetsAcquired: false,
    }),
  );
  process.exitCode = 1;
});
