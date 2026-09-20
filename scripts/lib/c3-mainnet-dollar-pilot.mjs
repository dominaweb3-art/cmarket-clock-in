export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

export function allocatePilotUsdc(totalBaseUnits) {
  if (typeof totalBaseUnits !== "bigint" || totalBaseUnits < 1_000_000n) {
    throw new RangeError(
      "The supervised Mainnet pilot requires at least 1 USDC.",
    );
  }
  const cbBtc = (totalBaseUnits * 4_000n) / 10_000n;
  const portalEth = (totalBaseUnits * 3_000n) / 10_000n;
  const wsol = totalBaseUnits - cbBtc - portalEth;
  return Object.freeze({ cbBtc, portalEth, wsol });
}

export function estimateBountyUsdc({
  bountyLamports,
  solOutputLamports,
  solInputUsdcBaseUnits,
}) {
  if (
    [bountyLamports, solOutputLamports, solInputUsdcBaseUnits].some(
      (value) => typeof value !== "bigint" || value <= 0n,
    )
  ) {
    throw new RangeError(
      "Bounty estimate inputs must be positive bigint values.",
    );
  }
  return (
    (bountyLamports * solInputUsdcBaseUnits + solOutputLamports - 1n) /
    solOutputLamports
  );
}

export function evaluatePilotReadiness(config, evidence) {
  const checks = [];
  const add = (id, ok, detail) =>
    checks.push(Object.freeze({ id, ok, detail }));
  const weights = config.methodology;

  add(
    "disabled-current-artifact",
    config.network.cluster === "mainnet-beta" &&
      config.network.capabilityEnabled === false &&
      config.network.normalNavigationEnabled === false,
    "Mainnet must remain disabled until a separate reviewed release",
  );
  add(
    "mainnet-rpc-health",
    evidence.rpcHealth === "ok",
    "official Solana Mainnet RPC must answer the read-only health check",
  );
  add(
    "allocation",
    weights.cbBtcBps + weights.portalEthBps + weights.solBps === 10_000 &&
      weights.totalBps === 10_000,
    "C3 allocation must total exactly 10,000 bps",
  );
  add(
    "pilot-bounds",
    config.pilot.supervisedMinimumUsdc === "1.00" &&
      config.pilot.maximumPilotUsdc === "10.00" &&
      config.pilot.automaticRetries === 0 &&
      config.pilot.requiresExplicitWalletApproval === true &&
      config.pilot.requiresCostDisclosure === true,
    "the one-dollar path is supervised, bounded, disclosed, and never automatically retried",
  );
  add(
    "fees-disabled",
    config.fees.version === "c3-fees/product-candidate-v1" &&
      config.fees.collectionEnabled === false &&
      config.fees.skrDiscountEnabled === false &&
      config.fees.securityApproved === false &&
      config.fees.squadsGovernanceApproved === false,
    "candidate fees and SKR discount remain disabled",
  );
  add(
    "symmetry-program",
    evidence.program?.value?.executable === true &&
      evidence.program?.value?.owner === UPGRADEABLE_LOADER,
    "Symmetry must be executable and upgradeable-loader-owned on Mainnet",
  );
  add(
    "symmetry-global-config",
    evidence.globalConfig?.value?.owner === config.symmetry.programId,
    "Symmetry global config must be program-owned",
  );

  for (const name of ["inputUsdc", "cbBtc", "portalEth", "wsol"]) {
    const expected = config.assets[name];
    const account = evidence.mints?.[name]?.value;
    const parsed = account?.data?.parsed;
    add(
      `mint-${name}`,
      account?.owner === TOKEN_PROGRAM &&
        parsed?.type === "mint" &&
        parsed.info?.isInitialized === true &&
        parsed.info?.decimals === expected.decimals,
      `${name} mint owner, initialization, and decimals must match`,
    );
  }

  for (const size of config.pilot.quoteSizesUsdc) {
    for (const leg of ["cbBtc", "portalEth", "wsol"]) {
      add(
        `jupiter-${size}-${leg}`,
        evidence.quotes?.[String(size)]?.[leg]?.verified === true,
        `Jupiter exact-input route must exist for ${size} USDC ${leg} allocation`,
      );
    }
  }

  add(
    "pyth-authenticated-freshness",
    evidence.pyth?.authenticated === true && evidence.pyth?.fresh === true,
    "an authenticated official Pyth update must cover BTC, ETH, and SOL within 60 seconds",
  );
  add(
    "jupiter-production-auth",
    config.jupiter.productionBuildEndpoint ===
      "https://api.jup.ag/swap/v2/build" &&
      config.jupiter.credentialVariableName === "JUPITER_API_KEY" &&
      config.jupiter.credentialLocation ===
        "isolated_builder_only_never_mobile_or_repository" &&
      config.deployment.jupiterProductionCredentialProvisioned === true,
    "the isolated transaction builder must have the current official Jupiter V2 credential without exposing it to the app",
  );
  add(
    "unsigned-build-security-review",
    config.deployment.oneDollarUnsignedBuildSecurityApproved === true,
    "the one-dollar Jupiter builds must pass instruction-level security review before wallet use",
  );
  add(
    "vault-and-governance",
    [
      config.deployment.vaultAddress,
      config.deployment.shareMint,
      config.deployment.configurationSquads,
      config.deployment.emergencySquads,
      config.deployment.keeperPublicKey,
    ].every((value) => typeof value === "string" && value.length >= 32) &&
      config.deployment.securityApprovalRecorded === true &&
      config.deployment.squadsApprovalRecorded === true,
    "vault, share mint, separated public authorities, Security approval, and Squads approval are mandatory",
  );

  const blockers = checks.filter((check) => !check.ok);
  return Object.freeze({
    decision: blockers.length ? "NO-GO" : "GO",
    checks: Object.freeze(checks),
    blockers,
  });
}
