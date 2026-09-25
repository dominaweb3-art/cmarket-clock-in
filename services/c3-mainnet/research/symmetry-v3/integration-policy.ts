/** Synthetic summary guard for selected public-example fields. Not a raw SDK/chain verifier or C3 policy. */
export const PUBLIC_EXAMPLE = Object.freeze({
  wallet: "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx",
  vault: "AwDFvjEPPwdF1YgXV8asNt6LeEFDduinYneCn6mHDAsh",
  shareMint: "9ihGfswnUZ6MysSR3KgmrZ57FXDVAiAQ6sEHwLuWwzJ4",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  usdcSource: "7EJSueeCjseYzghxU2XhcGEUn7RJDh43Z2dL6dvGy9mw",
  usdcVaultDestination: "DzFZmcJvxKF71pXo9WKvgLf7m6XpudqmEq6qRvhmwHCt",
  amount: 1_000_000n,
});
const SYMMETRY = "BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
const PROGRAMS = [
  [
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    "11111111111111111111111111111111",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    SYMMETRY,
    SYMMETRY,
    SYMMETRY,
    COMPUTE,
    COMPUTE,
  ],
  [SYMMETRY, COMPUTE, COMPUTE],
] as const;
const DISCRIMINATORS = [
  [
    "01",
    "02000000d5c14200",
    "11",
    "7850f57bd495a32f",
    "47ccf3b7d1766f5e",
    "7fd7296ef4b38307",
    "0240420f00",
    "03a8610000000000",
  ],
  ["585c9edb5347efa4", "0240420f00", "03a8610000000000"],
] as const;
const MAX_U64 = (1n << 64n) - 1n;
export type PublicUnsignedCandidate = Readonly<{
  wallet: string;
  vault: string;
  shareMint: string;
  amount: bigint;
  minOutput: bigint | null;
  slippageBps: number;
  expiresAt: number;
  observedAt: number;
  hasFinalUsdcEvidence: boolean;
  walletTokenDebits: readonly string[];
  walletSolTransfers: readonly string[];
  innerPrograms: readonly string[];
  batches: readonly Readonly<{
    bytes: number;
    version: "0" | "legacy";
    feePayer: string;
    signers: readonly string[];
    alts: readonly string[];
    instructions: readonly Readonly<{
      programId: string;
      discriminator: string;
      accounts: readonly string[];
      usdcDepositBaseUnits?: bigint;
    }>[];
  }>[];
}>;
export function inspectPublicUnsignedCandidate(
  candidate: PublicUnsignedCandidate,
): "BLOCKED" {
  const fail = (): never => {
    throw new Error("PUBLIC_EXAMPLE_UNSIGNED_BUILD_REJECTED");
  };
  if (
    candidate.wallet !== PUBLIC_EXAMPLE.wallet ||
    candidate.vault !== PUBLIC_EXAMPLE.vault ||
    candidate.shareMint !== PUBLIC_EXAMPLE.shareMint
  )
    fail();
  if (
    typeof candidate.amount !== "bigint" ||
    candidate.amount !== PUBLIC_EXAMPLE.amount ||
    candidate.amount < 0n ||
    candidate.amount > MAX_U64
  )
    fail();
  if (
    !Number.isSafeInteger(candidate.slippageBps) ||
    candidate.slippageBps < 0 ||
    candidate.slippageBps > 100
  )
    fail();
  if (
    !Number.isSafeInteger(candidate.observedAt) ||
    !Number.isSafeInteger(candidate.expiresAt) ||
    candidate.observedAt > candidate.expiresAt
  )
    fail();
  if (
    candidate.walletTokenDebits.length ||
    candidate.walletSolTransfers.length ||
    candidate.innerPrograms.length
  )
    fail();
  if (candidate.batches.length !== 2) fail();
  for (const [index, batch] of candidate.batches.entries()) {
    if (
      batch.version !== "0" ||
      !Number.isSafeInteger(batch.bytes) ||
      batch.bytes > 1232 ||
      batch.bytes <= 0
    )
      fail();
    if (
      batch.feePayer !== candidate.wallet ||
      batch.signers.length !== 1 ||
      batch.signers[0] !== candidate.wallet ||
      batch.alts.length
    )
      fail();
    const expectedPrograms = PROGRAMS[index];
    const expectedData = DISCRIMINATORS[index];
    if (!expectedPrograms || !expectedData)
      throw new Error("PUBLIC_EXAMPLE_UNSIGNED_BUILD_REJECTED");
    if (batch.instructions.length !== expectedPrograms.length) fail();
    for (const [i, ix] of batch.instructions.entries()) {
      if (
        ix.programId !== expectedPrograms[i] ||
        ix.discriminator !== expectedData[i]
      )
        fail();
    }
  }
  const first = candidate.batches[0]?.instructions;
  const deposit = candidate.batches[1]?.instructions[0];
  if (!first || !deposit)
    throw new Error("PUBLIC_EXAMPLE_UNSIGNED_BUILD_REJECTED");
  if (
    first[3]?.accounts[0] !== candidate.wallet ||
    first[3]?.accounts[2] !== candidate.vault ||
    first[5]?.accounts[5] !== candidate.shareMint
  )
    fail();
  if (
    deposit.accounts[0] !== candidate.wallet ||
    deposit.accounts[1] !== candidate.vault ||
    deposit.accounts[7] !== PUBLIC_EXAMPLE.usdcMint ||
    deposit.accounts[8] !== PUBLIC_EXAMPLE.usdcSource ||
    deposit.accounts[9] !== PUBLIC_EXAMPLE.usdcVaultDestination
  )
    fail();
  if (deposit.usdcDepositBaseUnits !== candidate.amount) fail();
  // The observed public vault does not prove a C3 share destination, output minimum,
  // USDC-only redemption, inner CPI effects or a governed production policy.
  if (candidate.minOutput !== null || candidate.hasFinalUsdcEvidence) fail();
  return "BLOCKED";
}
