/** Offline, read-only procurement estimate. NOT deployment approval/configuration.
 * Reads only the pinned public rent report and disabled ELF/IDL. No environment,
 * key files, network, shell deployment, wallet or transaction API. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { C3_MAINNET_EXECUTION_CAPABILITY } from "../src/constants.ts";
import { APPROVED_OPEN_PRODUCTION_POLICY } from "../src/open-production-policy.ts";

const BINARY_HASH =
  "d4aca9adebad10179b51f9d03b40fe399b8619347586370123105c985171beb1";
const IDL_HASH =
  "7fdf9c352cd1f28f95f8d72b1280af857c0ee8cc0f9f1991fe78088cce7e5eeb";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const fail = (): never => {
  throw Error("C3_BUDGET_PUBLIC_EVIDENCE_INVALID");
};
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Record<string, unknown>;
}
function integer(v: unknown): bigint {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return fail();
  return BigInt(v);
}
const sol = (n: bigint) =>
  `${n / 1000000000n}.${(n % 1000000000n).toString().padStart(9, "0")}`;
const usd = (n: bigint) =>
  `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;

export function inspectOpenPilotBudget(
  input: unknown,
  binary: Uint8Array,
  idl: Uint8Array,
) {
  const r = object(input);
  // Fix the exact reviewed rent snapshot too, not just self-consistent sums.
  if (
    sha(Buffer.from(JSON.stringify(r))) !==
      "0bbfe183c7c79dcc75431580a5f72af6de6ee20c2a48e38d210f02c4b07d0b70" ||
    r.timestamp !== "2026-10-04T00:00:32.535Z"
  )
    return fail();
  if (
    r.version !== "c3-pilot-costs/v1" ||
    r.artifactScope !== "DISABLED_NOT_DEPLOYABLE" ||
    r.genesisVerified !== true ||
    r.binaryHash !== BINARY_HASH ||
    r.idlHash !== IDL_HASH ||
    sha(binary) !== BINARY_HASH ||
    sha(idl) !== IDL_HASH ||
    binary.length !== 692864 ||
    r.binaryBytes !== binary.length ||
    !Array.isArray(r.accounts)
  )
    return fail();
  let persistent = 0n,
    buffer = 0n;
  const accounts = new Map<
    string,
    { bytes: bigint; count: bigint; per: bigint; total: bigint }
  >();
  for (const v of r.accounts) {
    const a = object(v);
    if (typeof a.kind !== "string" || accounts.has(a.kind)) return fail();
    const bytes = integer(a.bytes),
      count = integer(a.count),
      per = integer(a.lamportsPerAccount),
      total = integer(a.totalLamports);
    if (!count || !per || count * per !== total) return fail();
    accounts.set(a.kind, { bytes, count, per, total });
    if (a.kind === "transientDeploymentBuffer") buffer += total;
    else persistent += total;
  }
  if (
    persistent !== integer(r.persistentRentLamports) ||
    buffer + persistent !== integer(r.transientPeakRentLamports) ||
    integer(r.depositUsdcBaseUnits) !== 1000000n ||
    accounts.get("legacyVaultTokenAccounts")?.bytes !== 165n ||
    accounts.get("legacyVaultTokenAccounts")?.count !== 4n ||
    accounts.get("SwapLegAuthorization")?.count !== 6n ||
    accounts.get("QuoteReceipt")?.count !== 6n ||
    accounts.get("transientDeploymentBuffer")?.bytes !==
      BigInt(binary.length + 37) ||
    accounts.get("programData")?.bytes !== BigInt(binary.length + 45)
  )
    return fail();
  const ownerAta = accounts.get("legacyVaultTokenAccounts")!.per;
  const oneRenewalLeg =
    accounts.get("SwapLegAuthorization")!.per +
    accounts.get("QuoteReceipt")!.per;
  // PROPOSALS only: cap/reserve is not a measured fee or an approval.
  const operatingReserve = 50000000n,
    squadsCreationFee = 100000000n;
  const contingencyRenewalSixLegs = oneRenewalLeg * 6n;
  const proposedPeak =
    persistent +
    buffer +
    ownerAta +
    operatingReserve +
    squadsCreationFee +
    contingencyRenewalSixLegs;
  const monthly = [
    {
      item: "DigitalOcean backend 4GiB",
      cents: 2400n,
      source: "https://www.digitalocean.com/pricing/droplets",
    },
    {
      item: "DigitalOcean isolated signer VM 2GiB (NOT an HSM/service contract)",
      cents: 1200n,
      source: "https://www.digitalocean.com/pricing/droplets",
    },
    {
      item: "Daily VM backups proposal at 30% of the two VM prices",
      cents: 1080n,
      source: "https://www.digitalocean.com/pricing/droplets",
    },
    {
      item: "DigitalOcean PostgreSQL single node 1GiB; NOT HA; checkout/storage confirmation required",
      cents: 1500n,
      source:
        "https://docs.digitalocean.com/products/databases/postgresql/details/pricing/",
    },
    {
      item: "Quicknode Build MONTHLY not annual",
      cents: 4900n,
      source: "https://www.quicknode.com/pricing",
    },
    {
      item: "Alchemy Free up to 30M CU; quota is NOT an SLA",
      cents: 0n,
      source: "https://www.alchemy.com/pricing",
    },
  ];
  return Object.freeze({
    version: "c3-open-budget-review/v1",
    status: "INCOMPLETE_NOT_APPROVED",
    pricingObservedClientDate: "2026-10-04",
    evidenceTimestampUtc: r.timestamp,
    artifactScope: r.artifactScope,
    binaryHash: BINARY_HASH,
    idlHash: IDL_HASH,
    mainnetEnabled: false,
    monetaryGate: "BLOCKED",
    budgetApproved: false,
    capital: {
      persistentSol: sol(persistent),
      recoverableBufferSol: sol(buffer),
      measuredPeakSol: sol(persistent + buffer),
      optionalMissingOwnerAtaSol: sol(ownerAta),
      sixLegRenewalRentAllowanceSol: sol(contingencyRenewalSixLegs),
      operationalReserveProposalSol: sol(operatingReserve),
      squadsAppCreationFeeSol: sol(squadsCreationFee),
      proposedKnownPeakSol: sol(proposedPeak),
      separateDepositUsdc: "1.000000",
      futureEnabledBinaryRequiresNewRentEvidence: true,
    },
    consumedCosts: {
      squadsFee:
        "0.100000000 SOL if using Squads app; NOT vault rent and not refundable buffer",
      transactionFees:
        "UNMEASURED until exact deployment/owner/keeper messages and fee payer are reviewed",
      priorityFees: "UNMEASURED; 0.05 SOL reserve is NOT an approved fee cap",
      swaps:
        "Fresh quotes required; includes route fees, slippage and market loss, not fixed dollar parity",
      cMarketFee: "DISABLED",
    },
    infrastructure: {
      monthlyPublishedSubtotalUsd: usd(
        monthly.reduce((n, v) => n + v.cents, 0n),
      ),
      components: monthly.map((v) => ({
        item: v.item,
        usdPerMonth: usd(v.cents),
        source: v.source,
      })),
      alchemyPaygRateUsdPerMillionCu: "0.525",
      databaseHa: false,
      singleNodeDowntimeRiskMustBeAccepted: true,
      missingCosts: [
        "Optional informational pricing quota/availability; independent monetary NAV is NOT used by the restricted single-position candidate (pooled/later deposits still require separate reviewed pricing)",
        "isolated signer/HSM operation, security hardening and adapter review",
        "database additional storage/HA and backup restore verification",
        "RPC overage/support SLA",
        "DNS/domain, taxes, egress, security review, operational labor",
        "Squads accounts/configuration transaction rent/fees not included in app fee",
      ],
    },
    totalBudget: {
      status: "UNPRICED_COMPONENTS_BLOCK_FINAL_APPROVAL",
      upfrontKnownPeak:
        "7.286983440 SOL plus separate 1 USDC; includes proposed 0.05 SOL reserve and 0.1 SOL consumed Squads app fee",
      upfrontAdditionalTerms: [
        "final enabled-binary rent delta and reviewed upgrade headroom",
        "governance account rent (persistent until permitted closure)",
        "consumed deployment/base/priority and six-leg swap fees/slippage",
        "one-time hardened signer adapter, restoration/security review and infrastructure setup",
      ],
      recurringFormulaUsd:
        "110.80 + optional informational pricing overage + signer/HSM operation + additional PG storage/HA + RPC overage/SLA + DNS/tax/egress + operations/review",
      allInTotalUsd: null,
      reason:
        "Missing supplier/workload quotes and final release messages; unknown terms are NOT zero. No SOL or USDC parity assumed.",
    },
    requiredOwnerDecisions: [
      "Review exactly-one-lifetime-position realized-USDC policy, Security/governance/budget and final binary separately; Product authorized isolated testing only, not Mainnet enablement",
      "Public wallet + distinct governance/upgrade/pause/keeper/quote-authority identities + 2-of-3 members/timelock decision",
      "Approve hosting/RPC/signer choice and a concrete complete budget after missing quotes; server-only credentials, never chat/APK",
    ],
    codeBlockers: [
      "Restricted-pilot source approval remains null; no independent monetary NAV is needed for its fixed first-only units/full realized-USDC claim. Pooled valuation remains unavailable",
      "Public identities/provider review, hardened production signer/HTTPS service and explicit physical MWA test are not production-admitted",
      "Current source approval remains null; disabled binary cannot be deployed as a working pilot",
    ],
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (
      C3_MAINNET_EXECUTION_CAPABILITY ||
      APPROVED_OPEN_PRODUCTION_POLICY !== null
    )
      throw Error("C3_BUDGET_DISABLED_BOUNDARY_CHANGED");
    const directory = new URL(
      "../../../artifacts/c3-pilot-candidate/2026-10-03-production-factory-disabled/",
      import.meta.url,
    );
    const [r, binary, idl] = await Promise.all([
      readFile(new URL("public-rent-estimate.json", directory), "utf8"),
      readFile(new URL("c3_pilot_vault-disabled.so", directory)),
      readFile(new URL("c3_pilot_vault-disabled.idl.json", directory)),
    ]);
    console.log(
      JSON.stringify(
        inspectOpenPilotBudget(JSON.parse(r), binary, idl),
        null,
        2,
      ),
    );
    process.exitCode = 2; // Missing prices/authorities/budget; never readiness success.
  } catch (e) {
    console.log(
      e instanceof Error && /^C3_BUDGET_[A-Z_]+$/.test(e.message)
        ? e.message
        : "C3_BUDGET_PUBLIC_ARTIFACT_UNAVAILABLE",
    );
    process.exitCode = 1;
  }
}
