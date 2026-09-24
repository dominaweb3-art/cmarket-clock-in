import { readFileSync } from "node:fs";

const path = new URL(
  "../../../config/c3/c3-oracle-nav-candidate.v1.json",
  import.meta.url,
);
try {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const bps = data.allocationBps;
  if (
    data.schemaVersion !== "c3-oracle-nav-candidate/v1" ||
    data.status !== "blocked" ||
    data.mainnetExecutionEnabled !== false ||
    data.readinessResult !== "NO-GO" ||
    bps.cbBTC !== 4000 ||
    bps.PortalETH !== 3000 ||
    bps.WSOL !== 3000 ||
    bps.total !== 10000 ||
    bps.cbBTC + bps.PortalETH + bps.WSOL !== bps.total
  )
    throw new Error("invalid blocked candidate or allocation");
  for (const asset of ["USDC", "cbBTC", "PortalETH", "WSOL"]) {
    const a = data.assets[asset];
    if (!a?.mint || !a?.referenceFeedId || !Number.isInteger(a.decimals))
      throw new Error(`${asset}: invalid asset policy`);
    const evidence = a.priceEvidence;
    if (
      evidence?.cluster !== "mainnet-beta" ||
      !evidence.sourceUrl?.startsWith("https://") ||
      [
        "retrievedAt",
        "feedAccountId",
        "exponent",
        "confidence",
        "publishTime",
        "observedPrice",
        "evidenceHash",
      ].some((key) => evidence[key] !== null)
    )
      throw new Error(`${asset}: unverified price misrepresented`);
  }
  if (
    data.evidence.vaultAndShareMintVerified ||
    data.evidence.symmetryAccountingFormulaVerified ||
    data.evidence.secondaryOracleVerified ||
    data.evidence.pegMarketEvidenceVerified ||
    data.evidence.pythAuthenticatedProductionAccessVerified ||
    data.pilotCandidatesDisabled.feesEnabled ||
    data.pilotCandidatesDisabled.limitsEnabled ||
    data.missingEvidence.length < 7
  )
    throw new Error("blocked inputs mislabeled as ready");
  console.log(
    "C3 oracle/NAV: NO-GO (research-only; no vault, share mint or live NAV)",
  );
  for (const reason of data.missingEvidence)
    console.log(`- missing: ${reason}`);
} catch (error) {
  console.error(
    `C3 oracle/NAV manifest INVALID: ${error instanceof Error ? error.message : "unknown error"}`,
  );
  process.exitCode = 1;
}
