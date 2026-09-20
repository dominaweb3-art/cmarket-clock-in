import { C3_ALLOCATION, C3_MAINNET } from "./constants.ts";
import type { C3AssetId } from "./registry.ts";

export type SymmetryVaultState = Readonly<{
  programId: string;
  globalConfig: string;
  vault: string;
  shareMint: string;
  shareSupplyBaseUnits: string;
  targetBps: Readonly<{ btc: 4_000; eth: 3_000; sol: 3_000 }>;
  balances: Readonly<Record<C3AssetId, string>>;
  observedSlot: number;
  evidenceFingerprint: string;
}>;

export type SymmetryUnsignedIntent = Readonly<{
  operation:
    | "initialize_vault"
    | "deposit"
    | "issue_shares"
    | "rebalance"
    | "redeem"
    | "withdraw_usdc"
    | "pause";
  decodedInstructions: readonly unknown[];
  requiredSigners: readonly string[];
  addressLookupTables: readonly string[];
  recentBlockhash: string;
  lastValidBlockHeight: number;
}>;

export interface ReviewedSymmetryAdapter {
  readVaultState(vault: string): Promise<SymmetryVaultState>;
  buildUnsignedIntent(
    input: Readonly<Record<string, unknown>>,
  ): Promise<SymmetryUnsignedIntent>;
}

export function validateSymmetryVaultState(
  state: SymmetryVaultState,
): readonly string[] {
  const issues: string[] = [];
  if (state.programId !== C3_MAINNET.symmetryProgram)
    issues.push("Symmetry program mismatch.");
  if (state.globalConfig !== C3_MAINNET.symmetryGlobalConfig)
    issues.push("Symmetry global configuration mismatch.");
  if (
    state.targetBps.btc !== C3_ALLOCATION.btcBps ||
    state.targetBps.eth !== C3_ALLOCATION.ethBps ||
    state.targetBps.sol !== C3_ALLOCATION.solBps
  )
    issues.push("Symmetry target allocation mismatch.");
  if (!Number.isSafeInteger(state.observedSlot) || state.observedSlot <= 0)
    issues.push("Symmetry state slot is invalid.");
  if (!/^[a-f0-9]{64}$/.test(state.evidenceFingerprint))
    issues.push("Symmetry evidence fingerprint is invalid.");
  for (const [asset, balance] of Object.entries(state.balances))
    if (!/^(0|[1-9]\d*)$/.test(balance))
      issues.push(`${asset} vault balance is invalid.`);
  return Object.freeze(issues);
}
