const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const PYTH_RECEIVER_PROGRAM = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";

export const REQUIRED_AUTHORITY_KEYS = Object.freeze([
  "creator",
  "hostFeeDestination",
  "configuration",
  "emergency",
  "keeper",
]);

export function isConcretePublicKey(value) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 44 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(value) &&
    !value.includes("PLACEHOLDER")
  );
}

export function classifyMintAccount(account, expected) {
  const parsed = account?.value?.data?.parsed;
  if (!account?.value || parsed?.type !== "mint")
    return { verified: false, reason: "mint account missing or unparsed" };
  if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(account.value.owner)) {
    return { verified: false, reason: "unexpected mint owner" };
  }
  if (!parsed.info?.isInitialized)
    return { verified: false, reason: "mint is not initialized" };
  if (parsed.info.decimals !== expected.decimals)
    return { verified: false, reason: "mint decimals mismatch" };
  return {
    verified: true,
    reason: "mint owner, initialization, and decimals verified",
  };
}

export function classifyOracleAccount(account, expected) {
  if (!account?.value)
    return { verified: false, reason: "oracle account missing" };
  if (
    account.value.owner !== PYTH_RECEIVER_PROGRAM ||
    account.value.owner !== expected.accountOwner
  ) {
    return { verified: false, reason: "oracle account owner mismatch" };
  }
  return {
    verified: true,
    reason: "Pyth receiver-owned price account verified",
  };
}

function push(checks, id, ok, detail) {
  checks.push(Object.freeze({ id, ok, detail }));
}

export function evaluateC3DevnetReadiness(config, evidence) {
  const checks = [];
  const weights = config?.methodology;
  const total =
    (weights?.bitcoinBps ?? 0) +
    (weights?.ethereumBps ?? 0) +
    (weights?.solanaBps ?? 0);

  push(
    checks,
    "schema-version",
    config?.schemaVersion === "c3-devnet-config/v1",
    "versioned schema must match v1",
  );
  push(
    checks,
    "network-isolation",
    config?.network?.cluster === "devnet" &&
      config?.network?.mainnetEnabled === false,
    "cluster must be exact devnet and Mainnet must be immutable false",
  );
  push(
    checks,
    "allocation",
    total === 10_000 && weights?.totalBps === 10_000,
    "weights must total exactly 10,000 bps",
  );
  push(
    checks,
    "fee-policy",
    config?.fees?.version === "c3-fees/product-candidate-v1" &&
      config?.fees?.buyRateUnitsPer100000 === 150 &&
      config?.fees?.sellRateUnitsPer100000 === 150 &&
      config?.fees?.verifiedSkrRateUnitsPer100000 === 75 &&
      config?.fees?.collectionEnabled === false &&
      config?.fees?.skrDiscountEnabled === false &&
      config?.fees?.vaultHostDepositFeeBpsAtDeployment === 0 &&
      config?.fees?.vaultHostWithdrawFeeBpsAtDeployment === 0,
    "Product-approved candidate is recorded while all fee collection remains disabled",
  );

  const obsolete = config?.fees?.obsoleteProposals ?? [];
  push(
    checks,
    "fee-provenance",
    obsolete.some(
      (item) =>
        item.operation === "deposit" &&
        item.basisPoints === 60 &&
        item.status === "obsolete",
    ) &&
      obsolete.some(
        (item) =>
          item.operation === "withdraw" &&
          item.basisPoints === 10 &&
          item.status === "obsolete",
      ),
    "60/10 bps proposals must remain recorded as obsolete",
  );

  push(
    checks,
    "rpc-health",
    evidence?.rpcHealth === "ok",
    "official Devnet RPC must report healthy",
  );
  push(
    checks,
    "symmetry-program",
    evidence?.program?.value?.executable === true &&
      evidence?.program?.value?.owner === UPGRADEABLE_LOADER,
    "Symmetry program must be executable and owned by the upgradeable loader",
  );
  push(
    checks,
    "symmetry-global-config",
    evidence?.globalConfig?.value?.owner === config?.symmetry?.programId,
    "global config PDA must be owned by the Symmetry program",
  );
  push(
    checks,
    "deployment-plan",
    Number.isSafeInteger(config?.deployment?.vaultId) &&
      config.deployment.vaultId >= 0 &&
      isConcretePublicKey(config.deployment.expectedShareMint) &&
      isConcretePublicKey(config.deployment.expectedVaultPda) &&
      /^[a-f0-9]{64}$/.test(config.deployment.creationPlanSha256 ?? "") &&
      typeof config.deployment.squadsApprovalEvidence === "string" &&
      /^https:\/\//.test(config.deployment.squadsApprovalEvidence),
    "vault id, derived PDAs, immutable plan hash, and Squads approval evidence must be concrete",
  );

  for (const assetName of ["inputUsdc", "bitcoin", "ethereum", "solana"]) {
    const asset = config?.assets?.[assetName];
    const isTestExposure = assetName === "bitcoin" || assetName === "ethereum";
    push(
      checks,
      `${assetName}-mint-present`,
      isConcretePublicKey(asset?.mint),
      `${assetName} mint must be a concrete Devnet address`,
    );
    if (isTestExposure) {
      push(
        checks,
        `${assetName}-simulation-label`,
        asset?.productionForbidden === true &&
          /TEST|simulation/i.test(asset?.label ?? ""),
        `${assetName} test asset must be visibly simulated and forbidden in production`,
      );
    }
    if (isConcretePublicKey(asset?.mint)) {
      const mintResult = classifyMintAccount(
        evidence?.mints?.[assetName],
        asset,
      );
      push(
        checks,
        `${assetName}-mint-account`,
        mintResult.verified,
        mintResult.reason,
      );
    }

    if (asset?.oracle) {
      const oracleResult = classifyOracleAccount(
        evidence?.oracles?.[assetName]?.account,
        asset.oracle,
      );
      push(
        checks,
        `${assetName}-oracle-account`,
        oracleResult.verified,
        oracleResult.reason,
      );
      push(
        checks,
        `${assetName}-oracle-freshness`,
        evidence?.oracles?.[assetName]?.fresh === true,
        "fresh signed Pyth update transport must be available within policy",
      );
    }
  }

  push(
    checks,
    "symmetry-usdc-account",
    classifyMintAccount(evidence?.symmetryUsdc, { decimals: 6 }).verified,
    "SDK-required Symmetry Devnet USDC mint must exist with expected token semantics",
  );

  for (const leg of ["bitcoin", "ethereum", "solana"]) {
    push(
      checks,
      `jupiter-route-${leg}`,
      evidence?.routes?.[leg]?.verified === true,
      `a current read-only Jupiter Devnet route from input USDC to ${leg} must exist`,
    );
  }

  for (const key of REQUIRED_AUTHORITY_KEYS) {
    push(
      checks,
      `authority-${key}`,
      isConcretePublicKey(config?.authorities?.[key]),
      `${key} authority must be reviewed and concrete`,
    );
  }
  push(
    checks,
    "authority-separation",
    config?.authorities?.configuration !== config?.authorities?.emergency &&
      config?.authorities?.keeper !== config?.authorities?.configuration &&
      config?.authorities?.keeper !== config?.authorities?.emergency,
    "configuration, emergency, and keeper roles must use separate reviewed addresses",
  );
  push(
    checks,
    "metadata-uri",
    typeof config?.metadata?.uri === "string" &&
      /^https:\/\//.test(config.metadata.uri),
    "immutable HTTPS metadata URI must be reviewed before vault creation",
  );
  push(
    checks,
    "share-accounting",
    !/UNVERIFIED/i.test(config?.share?.accounting ?? ""),
    "exact fee order, rounding, and dust behavior must be verified from program evidence",
  );

  const blockers = checks.filter((check) => !check.ok);
  return Object.freeze({
    decision: blockers.length === 0 ? "GO" : "NO-GO",
    checks: Object.freeze(checks),
    blockers,
  });
}

export const READINESS_CONSTANTS = Object.freeze({
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  PYTH_RECEIVER_PROGRAM,
  UPGRADEABLE_LOADER,
});
