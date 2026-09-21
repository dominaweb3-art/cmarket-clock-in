import { C3_ALLOCATION, C3_MAINNET } from "./constants.ts";
import { publicKeyBytes } from "./solana.ts";
import type { C3AssetId } from "./registry.ts";

export type ReviewedSymmetryDescriptor = Readonly<{
  schemaVersion: "c3-symmetry-adapter/v1";
  adapterId: string;
  programId: string;
  globalConfig: string;
  authoritativeSourceUrl: string;
  authoritativeSourceHash: string;
  accountLayoutHash: string;
  instructionLayoutHash: string;
  sdkDependencySafe: boolean;
  productionReviewed: boolean;
}>;

export type RawSymmetryAccount = Readonly<{
  address: string;
  ownerProgram: string;
  executable: boolean;
  lamports: string;
  dataBase64: string;
  observedSlot: number;
  source: "reviewed-rpc" | "synthetic-test";
}>;

export type SymmetryVaultState = Readonly<{
  programId: string;
  globalConfig: string;
  vault: string;
  shareMint: string;
  authority: string;
  shareSupplyBaseUnits: string;
  targetBps: Readonly<{ btc: 4_000; eth: 3_000; sol: 3_000 }>;
  balances: Readonly<Record<C3AssetId, string>>;
  observedSlot: number;
  evidenceFingerprint: string;
  adapterId: string;
  productionEvidence: boolean;
}>;

export interface SymmetryAccountDecoder {
  decodeVaultAccount(
    raw: RawSymmetryAccount,
    descriptor: ReviewedSymmetryDescriptor,
  ): SymmetryVaultState;
}

export class ReadOnlySymmetryAdapter {
  readonly #descriptor: ReviewedSymmetryDescriptor;
  readonly #decoder: SymmetryAccountDecoder;
  readonly #fetchAccount: (address: string) => Promise<RawSymmetryAccount>;

  constructor(
    descriptor: ReviewedSymmetryDescriptor,
    decoder: SymmetryAccountDecoder,
    fetchAccount: (address: string) => Promise<RawSymmetryAccount>,
  ) {
    const issues = validateSymmetryDescriptor(descriptor);
    if (issues.length > 0) throw new Error(issues.join(" "));
    this.#descriptor = Object.freeze({ ...descriptor });
    this.#decoder = decoder;
    this.#fetchAccount = fetchAccount;
  }

  async readVaultState(
    expected: Readonly<{ vault: string; shareMint: string; authority: string }>,
  ): Promise<SymmetryVaultState> {
    const raw = await this.#fetchAccount(expected.vault);
    if (
      raw.address !== expected.vault ||
      raw.ownerProgram !== this.#descriptor.programId ||
      raw.executable ||
      raw.source !== "reviewed-rpc" ||
      raw.dataBase64.length === 0 ||
      Buffer.from(raw.dataBase64, "base64").length === 0
    )
      throw new Error(
        "Symmetry account evidence is missing, malformed, or wrongly owned.",
      );
    const state = this.#decoder.decodeVaultAccount(raw, this.#descriptor);
    const issues = validateSymmetryVaultState(
      state,
      expected,
      this.#descriptor,
    );
    if (issues.length > 0) throw new Error(issues.join(" "));
    return Object.freeze(state);
  }
}

export function validateSymmetryDescriptor(
  descriptor: ReviewedSymmetryDescriptor,
): readonly string[] {
  const issues: string[] = [];
  const hashes = [
    descriptor.authoritativeSourceHash,
    descriptor.accountLayoutHash,
    descriptor.instructionLayoutHash,
  ];
  if (descriptor.schemaVersion !== "c3-symmetry-adapter/v1")
    issues.push("Unsupported Symmetry adapter schema.");
  if (
    !descriptor.adapterId ||
    descriptor.adapterId.toLowerCase().includes("placeholder")
  )
    issues.push("Concrete Symmetry adapter identity is required.");
  if (
    descriptor.programId !== C3_MAINNET.symmetryProgram ||
    descriptor.globalConfig !== C3_MAINNET.symmetryGlobalConfig
  )
    issues.push("Symmetry program or global configuration mismatch.");
  if (
    !descriptor.authoritativeSourceUrl.startsWith("https://") ||
    hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))
  )
    issues.push("Authoritative Symmetry source/layout evidence is missing.");
  if (!descriptor.sdkDependencySafe)
    issues.push(
      "Symmetry adapter would reintroduce an unapproved dependency chain.",
    );
  if (!descriptor.productionReviewed)
    issues.push(
      "Symmetry adapter has not passed independent production review.",
    );
  return Object.freeze(issues);
}

export function validateSymmetryVaultState(
  state: SymmetryVaultState,
  expected?: Readonly<{ vault: string; shareMint: string; authority: string }>,
  descriptor?: ReviewedSymmetryDescriptor,
): readonly string[] {
  const issues: string[] = [];
  if (state.programId !== C3_MAINNET.symmetryProgram)
    issues.push("Symmetry program mismatch.");
  if (state.globalConfig !== C3_MAINNET.symmetryGlobalConfig)
    issues.push("Symmetry global configuration mismatch.");
  if (
    expected &&
    (state.vault !== expected.vault ||
      state.shareMint !== expected.shareMint ||
      state.authority !== expected.authority)
  )
    issues.push("Symmetry vault, share mint, or authority mismatch.");
  if (descriptor && state.adapterId !== descriptor.adapterId)
    issues.push("Symmetry state was decoded by an unapproved adapter.");
  try {
    for (const key of [state.vault, state.shareMint, state.authority])
      publicKeyBytes(key);
  } catch {
    issues.push("Symmetry state contains malformed public keys.");
  }
  if (
    state.targetBps.btc !== C3_ALLOCATION.btcBps ||
    state.targetBps.eth !== C3_ALLOCATION.ethBps ||
    state.targetBps.sol !== C3_ALLOCATION.solBps
  )
    issues.push("Symmetry target allocation mismatch.");
  if (!Number.isSafeInteger(state.observedSlot) || state.observedSlot <= 0)
    issues.push("Symmetry state slot is invalid.");
  if (
    !/^[a-f0-9]{64}$/.test(state.evidenceFingerprint) ||
    !state.productionEvidence
  )
    issues.push("Symmetry production evidence is invalid.");
  if (!/^[1-9]\d*$/.test(state.shareSupplyBaseUnits))
    issues.push("Symmetry share supply is zero or malformed.");
  const expectedAssets: C3AssetId[] = ["USDC", "cbBTC", "PortalETH", "WSOL"];
  if (Object.keys(state.balances).length !== expectedAssets.length)
    issues.push("Symmetry balance set is incomplete.");
  for (const asset of expectedAssets)
    if (!/^(0|[1-9]\d*)$/.test(state.balances[asset]))
      issues.push(`${asset} vault balance is missing or invalid.`);
  return Object.freeze(issues);
}
