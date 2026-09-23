// Historical correlation only. This cannot approve a Symmetry policy or execute C3.
import { C3_MAINNET } from "../../src/constants.ts";
import type { ObservedInstruction } from "./decoder.ts";

export type DecodedEvidence = ReturnType<
  typeof import("./decoder.ts").decodePublicFixture
>;
export type Stage = "usdcDeposit" | "shareMint" | "shareBurn" | "usdcRedeem";
const stages: Stage[] = ["usdcDeposit", "shareMint", "shareBurn", "usdcRedeem"];
// Raw-byte observations for this public sample only; these are NOT official IDL discriminators.
const observedDiscriminators: Record<Stage, readonly string[]> = {
  usdcDeposit: [
    "7850f57bd495a32f",
    "47ccf3b7d1766f5e",
    "7fd7296ef4b38307",
    "585c9edb5347efa4",
    "40eeabc687fd2509",
  ],
  shareMint: ["a1cf302d079ce98f"],
  shareBurn: ["7850f57bd495a32f", "47ccf3b7d1766f5e", "7fd7296ef4b38307"],
  usdcRedeem: ["5331700269c16a7e"],
};
const observedLogNames: Record<Stage, readonly string[]> = {
  usdcDeposit: [
    "CreateRebalanceIntentHandler",
    "ResizeRebalanceIntentHandler",
    "InitRebalanceIntentHandler",
    "DepositTokensHandler",
    "LockDepositsHandler",
  ],
  shareMint: ["MintBasketHandler"],
  shareBurn: [
    "CreateRebalanceIntentHandler",
    "ResizeRebalanceIntentHandler",
    "InitRebalanceIntentHandler",
  ],
  usdcRedeem: ["RedeemTokensHandler"],
};
// Full token-account set in this one historical sample; not a generic vault policy.
const observedTokenAccounts: Record<Stage, readonly string[]> = {
  usdcDeposit: [
    "35T4fJeQ9e2QTFBQ8arP3NttYaDCtj95sDoTfdQjxikW",
    "GJ33KzpktwTV1vavhDKdYJVTUnztbd3xUMdSV8zFAJmH",
    "8UF6dpLjMRCpn8woGh1M4tzBDjQ4pV6ak3cZ2L9MsvNb",
    "AQQM2SPg5zsteNtLBrSoEdS1hRNZKighdCzwnzHpzphP",
    "4PzfY9AeVRmFxVzF7r3UfyufywKNLUX7tSkZqZuooxzZ",
    "DzFZmcJvxKF71pXo9WKvgLf7m6XpudqmEq6qRvhmwHCt",
  ],
  shareMint: [
    "GJ33KzpktwTV1vavhDKdYJVTUnztbd3xUMdSV8zFAJmH",
    "AQQM2SPg5zsteNtLBrSoEdS1hRNZKighdCzwnzHpzphP",
  ],
  shareBurn: [
    "35T4fJeQ9e2QTFBQ8arP3NttYaDCtj95sDoTfdQjxikW",
    "8UF6dpLjMRCpn8woGh1M4tzBDjQ4pV6ak3cZ2L9MsvNb",
    "AQQM2SPg5zsteNtLBrSoEdS1hRNZKighdCzwnzHpzphP",
    "GJ33KzpktwTV1vavhDKdYJVTUnztbd3xUMdSV8zFAJmH",
  ],
  usdcRedeem: [
    "4PzfY9AeVRmFxVzF7r3UfyufywKNLUX7tSkZqZuooxzZ",
    "DzFZmcJvxKF71pXo9WKvgLf7m6XpudqmEq6qRvhmwHCt",
  ],
};

export const OBSERVED_SAMPLE = Object.freeze({
  user: "8RZ4GrQDsctRGrW4tDZcYZRqFAW23eWkrVcJQ1DH7GyX",
  vault: "AwDFvjEPPwdF1YgXV8asNt6LeEFDduinYneCn6mHDAsh",
  shareMint: "9ihGfswnUZ6MysSR3KgmrZ57FXDVAiAQ6sEHwLuWwzJ4",
  userUsdc: "4PzfY9AeVRmFxVzF7r3UfyufywKNLUX7tSkZqZuooxzZ",
  vaultUsdc: "DzFZmcJvxKF71pXo9WKvgLf7m6XpudqmEq6qRvhmwHCt",
  userShare: "GJ33KzpktwTV1vavhDKdYJVTUnztbd3xUMdSV8zFAJmH",
  usdcBaseUnits: "20000000",
  shareBaseUnits: "20",
});

function exactTransfer(
  tx: DecodedEvidence,
  source: string,
  destination: string,
  owner: string,
  amount: string,
  mint: string,
): ObservedInstruction {
  const matching = tx.innerInstructions.filter(
    (ix) =>
      ix.programId === C3_MAINNET.tokenProgram &&
      ix.tokenOperation === "transferChecked" &&
      ix.tokenSource === source &&
      ix.tokenDestination === destination &&
      ix.tokenAuthority === owner &&
      ix.tokenAmount === amount &&
      ix.tokenDecimals === 6 &&
      ix.accounts[1] === mint,
  );
  if (matching.length !== 1)
    throw new Error("Observed transfer is missing or ambiguous");
  return matching[0]!;
}
function effect(
  tx: DecodedEvidence,
  account: string,
  owner: string,
  mint: string,
  delta: string,
): void {
  const matching = tx.tokenEffects.filter(
    (row) =>
      row.account === account &&
      row.owner === owner &&
      row.mint === mint &&
      row.delta === delta &&
      !row.incompleteSide,
  );
  if (matching.length !== 1)
    throw new Error("Observed token ownership or delta is unverified");
}

export function reconcileObservedCandidate(
  input: Readonly<Partial<Record<Stage, DecodedEvidence>>>,
) {
  const sample = OBSERVED_SAMPLE;
  if (
    Object.keys(input).length !== stages.length ||
    stages.some((stage) => !input[stage])
  )
    throw new Error("Incomplete or duplicate lifecycle stage");
  const [deposit, mint, burn, redeem] = stages.map(
    (stage) => input[stage]!,
  ) as [DecodedEvidence, DecodedEvidence, DecodedEvidence, DecodedEvidence];
  if (!(
    deposit.slot < mint.slot &&
    mint.slot < burn.slot &&
    burn.slot < redeem.slot
  ))
    throw new Error("Observed lifecycle order is inconsistent");
  if (
    new Set(stages.map((stage) => input[stage]!.signature)).size !==
    stages.length
  )
    throw new Error("Duplicate transaction signature in lifecycle");
  for (const stage of stages) {
    const tx = input[stage]!;
    const observed = tx.outerInstructions
      .filter((ix) => ix.programId === C3_MAINNET.symmetryProgram)
      .map((ix) => ix.discriminatorHex);
    const logs = tx.logs
      .filter((line) => line.startsWith("Program log: Instruction: "))
      .map((line) => line.slice("Program log: Instruction: ".length));
    if (
      JSON.stringify(observed) !==
        JSON.stringify(observedDiscriminators[stage]) ||
      JSON.stringify(logs) !== JSON.stringify(observedLogNames[stage])
    )
      throw new Error(
        "Unknown observed Symmetry instruction or log correlation",
      );
    if (
      JSON.stringify(tx.tokenEffects.map((row) => row.account).sort()) !==
      JSON.stringify([...observedTokenAccounts[stage]].sort())
    )
      throw new Error("Unexpected token account in historical sample");
    if (
      tx.innerInstructions.some(
        (ix) => ix.programId === C3_MAINNET.symmetryProgram,
      )
    )
      throw new Error("Unexpected inner Symmetry instruction");
  }
  if (
    deposit.feePayer !== sample.user ||
    burn.feePayer !== sample.user ||
    mint.feePayer === sample.user ||
    redeem.feePayer === sample.user
  )
    throw new Error("Unexpected observed signer roles");
  exactTransfer(
    deposit,
    sample.userUsdc,
    sample.vaultUsdc,
    sample.user,
    sample.usdcBaseUnits,
    C3_MAINNET.usdcMint,
  );
  effect(
    deposit,
    sample.userUsdc,
    sample.user,
    C3_MAINNET.usdcMint,
    `-${sample.usdcBaseUnits}`,
  );
  effect(
    deposit,
    sample.vaultUsdc,
    sample.vault,
    C3_MAINNET.usdcMint,
    sample.usdcBaseUnits,
  );
  const mints = mint.innerInstructions.filter(
    (ix) =>
      ix.tokenOperation === "mintToChecked" &&
      ix.accounts[0] === sample.shareMint &&
      ix.tokenDestination === sample.userShare &&
      ix.tokenAuthority === sample.vault &&
      ix.tokenAmount === sample.shareBaseUnits &&
      ix.tokenDecimals === 6,
  );
  if (mints.length !== 1)
    throw new Error("Observed share mint is missing or ambiguous");
  effect(
    mint,
    sample.userShare,
    sample.user,
    sample.shareMint,
    sample.shareBaseUnits,
  );
  const burns = burn.innerInstructions.filter(
    (ix) =>
      ix.tokenOperation === "burnChecked" &&
      ix.accounts[1] === sample.shareMint &&
      ix.tokenSource === sample.userShare &&
      ix.tokenAuthority === sample.user &&
      ix.tokenAmount === sample.shareBaseUnits &&
      ix.tokenDecimals === 6,
  );
  if (burns.length !== 1)
    throw new Error("Observed share burn is missing or ambiguous");
  effect(
    burn,
    sample.userShare,
    sample.user,
    sample.shareMint,
    `-${sample.shareBaseUnits}`,
  );
  exactTransfer(
    redeem,
    sample.vaultUsdc,
    sample.userUsdc,
    sample.vault,
    sample.usdcBaseUnits,
    C3_MAINNET.usdcMint,
  );
  effect(
    redeem,
    sample.vaultUsdc,
    sample.vault,
    C3_MAINNET.usdcMint,
    `-${sample.usdcBaseUnits}`,
  );
  effect(
    redeem,
    sample.userUsdc,
    sample.user,
    C3_MAINNET.usdcMint,
    sample.usdcBaseUnits,
  );
  // These four signatures are not an exhaustive on-chain intent history. No C3 composition, output
  // selection, auction or keeper idempotency follows from this correlation.
  return Object.freeze({
    classification: "PARTIALLY_VERIFIED_SAMPLE" as const,
    c3UsdcOnlyRedemption: "UNVERIFIED" as const,
    user: sample.user,
    vault: sample.vault,
    usdcBaseUnits: sample.usdcBaseUnits,
    sharesBaseUnits: sample.shareBaseUnits,
    observedStages: stages,
    missing: [
      "Official IDL and account/PDA layouts",
      "Proof of one shared intent across all four signatures",
      "Complete intermediate auction/price/bounty transactions",
      "Vault composition and C3-specific 40/30/30 proof",
      "keep_tokens setting and USDC output selection",
      "USDC-only redemption from multi-asset vault",
      "Observed mint-supply delta at historical slots",
    ],
  });
}
