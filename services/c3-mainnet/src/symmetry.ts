import type { C3AssetId } from "./registry.ts";

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
}>;

export type SymmetryAdapterStatus = Readonly<{
  registryVersion: "c3-symmetry-adapter-registry/v1";
  enabledAdapterIds: readonly string[];
  productionReady: false;
  reason: string;
}>;

const SYMMETRY_ADAPTER_REGISTRY: ReadonlyMap<string, never> = new Map<
  string,
  never
>();

export function symmetryAdapterRegistryStatus(): SymmetryAdapterStatus {
  return Object.freeze({
    registryVersion: "c3-symmetry-adapter-registry/v1",
    enabledAdapterIds: Object.freeze([...SYMMETRY_ADAPTER_REGISTRY.keys()]),
    productionReady: false,
    reason:
      "No official Symmetry account layout, instruction discriminator set, and dependency-safe decoder has completed review.",
  });
}

export async function readSymmetryVaultState(
  adapterId: string,
): Promise<SymmetryVaultState> {
  if (!SYMMETRY_ADAPTER_REGISTRY.has(adapterId))
    throw new Error(
      "Unknown or disabled Symmetry adapter; external configuration is missing.",
    );
  throw new Error("Symmetry adapter registry is fail-closed.");
}
