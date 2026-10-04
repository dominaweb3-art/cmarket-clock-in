/** Public, source-reviewed production policy. Neither environment nor a caller
 * may provide approval. Missing owner/governance decisions remain null. */
import { C3_MAINNET, C3_MAINNET_EXECUTION_CAPABILITY } from "./constants.ts";
import {
  assertIndependentRpcProviders,
  type ReviewedRpcProvider,
} from "./pilot-rpc-evidence.ts";
import { publicKeyBytes } from "./solana.ts";

export type OpenProductionPolicy = Readonly<{
  version: "c3-open-production/v1";
  programId: string;
  binaryHash: string;
  binaryLength: number;
  upgradeAuthority: string;
  idlHash: string;
  configurationHash: string;
  vault: string;
  shareMint: string;
  wallet: string;
  governance: string;
  keeper: string;
  quoteAuthority: string;
  registry: string;
  registryRevision: string;
  registryHash: string;
  quotePolicy: string;
  quotePolicyRevision: string;
  maxSlippageBps: number;
  securityApprovalHash: string;
  governanceApprovalHash: string;
  budgetApprovalHash: string;
  providers: readonly ReviewedRpcProvider[];
}>;
// Changing this null AND the execution capability requires a separate source
// review of the concrete release. No constructor or runtime override exists.
export const APPROVED_OPEN_PRODUCTION_POLICY: OpenProductionPolicy | null =
  null;

/** Validates metadata, NOT evidence that somebody approved it. */
export function validateOpenProductionPolicy(p: OpenProductionPolicy): void {
  const hash = /^[a-f0-9]{64}$/;
  if (
    p.version !== "c3-open-production/v1" ||
    !Number.isSafeInteger(p.binaryLength) ||
    p.binaryLength < 4 ||
    p.binaryLength > 2000000 ||
    ![
      p.binaryHash,
      p.idlHash,
      p.configurationHash,
      p.registryHash,
      p.securityApprovalHash,
      p.governanceApprovalHash,
      p.budgetApprovalHash,
    ].every((v) => hash.test(v) && v !== "0".repeat(64)) ||
    ![p.registryRevision, p.quotePolicyRevision].every((v) =>
      /^[1-9][0-9]{0,18}$/.test(v),
    ) ||
    !Number.isInteger(p.maxSlippageBps) ||
    p.maxSlippageBps < 1 ||
    p.maxSlippageBps > 100
  )
    throw new Error("C3_OPEN_PRODUCTION_POLICY_INVALID");
  for (const k of [
    p.programId,
    p.vault,
    p.shareMint,
    p.wallet,
    p.governance,
    p.keeper,
    p.quoteAuthority,
    p.registry,
    p.quotePolicy,
    p.upgradeAuthority,
  ])
    publicKeyBytes(k);
  if (new Set([p.wallet, p.governance, p.keeper, p.quoteAuthority]).size !== 4)
    throw new Error("C3_OPEN_PRODUCTION_ROLES_NOT_SEPARATED");
  assertIndependentRpcProviders(p.providers);
}

export function requireOpenProductionPolicy(): OpenProductionPolicy {
  if (!C3_MAINNET_EXECUTION_CAPABILITY || !APPROVED_OPEN_PRODUCTION_POLICY)
    throw new Error("C3_OPEN_PRODUCTION_NOT_APPROVED");
  validateOpenProductionPolicy(APPROVED_OPEN_PRODUCTION_POLICY);
  return APPROVED_OPEN_PRODUCTION_POLICY;
}
export const OPEN_PRODUCTION_ASSETS = Object.freeze({
  genesisHash: C3_MAINNET.genesisHash,
  input: C3_MAINNET.usdcMint,
  outputs: Object.freeze([
    C3_MAINNET.cbBtcMint,
    C3_MAINNET.portalEthMint,
    C3_MAINNET.wrappedSolMint,
  ]),
  amounts: Object.freeze([400_000n, 300_000n, 300_000n]),
  router: C3_MAINNET.jupiterProgram,
  feesEnabled: false,
  skrEnabled: false,
});
