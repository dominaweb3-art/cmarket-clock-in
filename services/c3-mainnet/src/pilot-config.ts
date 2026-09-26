import { C3_MAINNET, C3_MAINNET_EXECUTION_CAPABILITY } from "./constants.ts";

/** Immutable first-acceptance-test limits. Configuration never turns on execution. */
export const C3_PILOT = Object.freeze({
  schemaVersion: "c3-owner-pilot/v1" as const,
  cluster: "mainnet-beta" as const,
  targetBps: Object.freeze({ btc: 4_000, eth: 3_000, sol: 3_000 }),
  amountUsdcBaseUnits: 1_000_000n,
  aggregateTvlCapUsdcBaseUnits: 1_000_000n,
  maxConfiguredWallets: 1,
  maxOpenDepositIntents: 1,
  maxOpenRedemptionIntents: 1,
  automaticRetries: 0,
  automaticReversals: 0,
  automaticResubmissions: 0,
  publicRegistrationEnabled: false,
  publicMainnetNavigationEnabled: false,
  skrRewardsEnabled: false,
  cMarketFeeCollectionEnabled: false,
  keeperSpendingOutsideApprovedIntent: false,
  maxSerializedTransactionBytes: 1_232,
});

export type C3PilotPublicConfiguration = Readonly<{
  schemaVersion: string;
  deploymentStatus: string;
  securityApprovalStatus: string;
  governanceApprovalStatus: string;
  cluster: string;
  vaultAddress: string | null;
  shareMint: string | null;
  ownerWalletAllowlist: readonly string[];
  maxConfiguredWallets: number;
  symmetryProgram: string;
  usdcMint: string;
  cbBtcMint: string;
  portalEthMint: string;
  wrappedSolMint: string;
  targetBps: Readonly<{ btc: number; eth: number; sol: number }>;
  pilotAmountUsdcBaseUnits: string;
  aggregateTvlCapUsdcBaseUnits: string;
  maxOpenDepositIntents: number;
  maxOpenRedemptionIntents: number;
  automaticRetries: number;
  automaticReversals: number;
  automaticResubmissions: number;
  publicRegistrationEnabled: boolean;
  publicMainnetNavigationEnabled: boolean;
  skrRewardsEnabled: boolean;
  cMarketFeeCollectionEnabled: boolean;
  keeperSpendingOutsideApprovedIntent: boolean;
  maxSerializedTransactionBytes: number;
  rpcPrimaryProviderId: string | null;
  rpcSecondaryProviderId: string | null;
}>;

const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const C3_PILOT_DISABLED = "C3_OWNER_PILOT_NOT_APPROVED";

/** Readiness is informational. It cannot enable Mainnet or accept caller attestations. */
export function inspectC3PilotConfiguration(
  config: C3PilotPublicConfiguration,
): readonly string[] {
  if (
    !config ||
    typeof config !== "object" ||
    !config.targetBps ||
    typeof config.targetBps !== "object" ||
    !Array.isArray(config.ownerWalletAllowlist)
  )
    return Object.freeze(["malformed_configuration"]);
  const missing: string[] = [];
  if (
    config.schemaVersion !== C3_PILOT.schemaVersion ||
    config.cluster !== C3_PILOT.cluster
  )
    missing.push("configuration_identity");
  if (!KEY.test(config.vaultAddress ?? "")) missing.push("vault_address");
  if (!KEY.test(config.shareMint ?? "")) missing.push("share_mint");
  if (
    config.ownerWalletAllowlist.length !== 1 ||
    !KEY.test(config.ownerWalletAllowlist[0] ?? "")
  )
    missing.push("single_owner_wallet");
  if (
    !config.rpcPrimaryProviderId ||
    !config.rpcSecondaryProviderId ||
    config.rpcPrimaryProviderId === config.rpcSecondaryProviderId
  )
    missing.push("independent_rpc_providers");
  if (config.deploymentStatus !== "deployed")
    missing.push("deployed_vault_evidence");
  if (config.securityApprovalStatus !== "approved")
    missing.push("security_approval");
  if (config.governanceApprovalStatus !== "approved")
    missing.push("squads_governance_approval");
  if (
    Object.values(config.targetBps).reduce((sum, value) => sum + value, 0) !==
      10_000 ||
    config.targetBps.btc !== 4_000 ||
    config.targetBps.eth !== 3_000 ||
    config.targetBps.sol !== 3_000
  )
    missing.push("fixed_target_allocation");
  for (const [field, expected] of Object.entries({
    symmetryProgram: C3_MAINNET.symmetryProgram,
    usdcMint: C3_MAINNET.usdcMint,
    cbBtcMint: C3_MAINNET.cbBtcMint,
    portalEthMint: C3_MAINNET.portalEthMint,
    wrappedSolMint: C3_MAINNET.wrappedSolMint,
  }))
    if (config[field as keyof C3PilotPublicConfiguration] !== expected)
      missing.push(field);
  if (
    config.pilotAmountUsdcBaseUnits !== "1000000" ||
    config.aggregateTvlCapUsdcBaseUnits !== "1000000" ||
    config.maxConfiguredWallets !== 1 ||
    config.maxOpenDepositIntents !== 1 ||
    config.maxOpenRedemptionIntents !== 1 ||
    config.automaticRetries !== 0 ||
    config.automaticReversals !== 0 ||
    config.automaticResubmissions !== 0 ||
    config.publicRegistrationEnabled ||
    config.publicMainnetNavigationEnabled ||
    config.skrRewardsEnabled ||
    config.cMarketFeeCollectionEnabled ||
    config.keeperSpendingOutsideApprovedIntent ||
    config.maxSerializedTransactionBytes !== 1_232
  )
    missing.push("immutable_pilot_limits");
  if (C3_MAINNET_EXECUTION_CAPABILITY !== false)
    missing.push("build_capability_must_remain_false");
  return Object.freeze(missing);
}

export function assertC3PilotExecutable(
  _config: C3PilotPublicConfiguration,
): never {
  throw new Error(C3_PILOT_DISABLED);
}
