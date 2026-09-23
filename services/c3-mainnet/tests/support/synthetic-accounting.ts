import { createHash } from "node:crypto";

import { C3_ALLOCATION, C3_AMOUNTS, C3_FEES } from "../../src/constants.ts";
import { canonicalize } from "../../src/manifest.ts";
import {
  absolute,
  assertU64,
  checkedAddU64,
  checkedMulDivFloorU64,
  checkedSubU64,
  mulDivCeil,
  mulDivFloor,
} from "../../src/math.ts";
import {
  assertVerifiedVaultSnapshotEvidence,
  type VerifiedVaultSnapshotEvidence,
} from "./synthetic-reconciliation.ts";
import type { C3AssetId } from "../../src/registry.ts";

export type ReconciledVaultSnapshot = Readonly<{
  schemaVersion: "c3-vault-snapshot/v1";
  snapshotId: string;
  cluster: "mainnet-beta";
  genesisHash: string;
  configurationHash: string;
  slot: number;
  blockTimeUnix: number;
  vault: string;
  balances: readonly Readonly<{
    asset: C3AssetId;
    mint: string;
    tokenAccount: string;
    balanceBaseUnits: string;
    decimals: number;
    priceUsdMicros: string;
    oracleId: string;
    oracleConfidenceBps: number;
    oraclePublishTimeUnix: number;
  }>[];
  shareMint: string;
  shareSupplyBaseUnits: string;
  pendingAuthorizedInflowsUsdcBaseUnits: string;
  pendingAuthorizedOutflowsUsdcBaseUnits: string;
  pendingKeeperEffectsUsdcBaseUnits: string;
  reservedFeesUsdcBaseUnits: string;
  reservedBountyUsdcBaseUnits: string;
  unsolicitedDonations: readonly string[];
  reconciliationEvidenceHash: string;
  providerEvidenceFingerprints: readonly [string, string];
  snapshotFingerprint: string;
}>;

export type VaultSnapshotPolicy = Readonly<{
  configurationHash: string;
  vault: string;
  shareMint: string;
  tokenAccounts: Readonly<Record<C3AssetId, string>>;
  mints: Readonly<Record<C3AssetId, string>>;
  decimals: Readonly<Record<C3AssetId, number>>;
  oracleIds: Readonly<Record<C3AssetId, string>>;
  maximumAgeSeconds: number;
  maximumSlotDrift: number;
  bootstrapEvidenceHash?: string;
  minimumBootstrapUsdcBaseUnits: string;
}>;

const INTEGER = /^(0|[1-9]\d*)$/;
const HASH = /^[a-f0-9]{64}$/;
const trustedSnapshots = new WeakSet<object>();
const VAULT_SNAPSHOT_POLICY_REGISTRY: ReadonlyMap<string, VaultSnapshotPolicy> =
  new Map();
const snapshotRepository = new Map<
  string,
  Readonly<{ snapshot: ReconciledVaultSnapshot; policy: VaultSnapshotPolicy }>
>();

function computeSnapshotFingerprint(snapshot: ReconciledVaultSnapshot): string {
  const payload = { ...snapshot } as Record<string, unknown>;
  delete payload.snapshotFingerprint;
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

export function acceptVerifiedVaultSnapshot(
  snapshot: ReconciledVaultSnapshot,
  policyIdentifier: string,
  evidence: VerifiedVaultSnapshotEvidence,
  nowUnix: number,
  currentSlot: number,
): string {
  const policy = VAULT_SNAPSHOT_POLICY_REGISTRY.get(policyIdentifier);
  if (!policy)
    throw new Error(
      "Unknown sealed vault snapshot policy; external configuration is missing.",
    );
  assertVerifiedVaultSnapshotEvidence(evidence);
  if (
    evidence.snapshotFingerprint !== snapshot.snapshotFingerprint ||
    canonicalize(evidence.providerEvidenceFingerprints) !==
      canonicalize(snapshot.providerEvidenceFingerprints)
  )
    throw new Error("Vault snapshot does not match sealed quorum evidence.");
  trustedSnapshots.add(snapshot);
  try {
    validateReconciledVaultSnapshot(snapshot, policy, nowUnix, currentSlot);
  } catch (error) {
    trustedSnapshots.delete(snapshot);
    throw error;
  }
  if (snapshotRepository.has(snapshot.snapshotId))
    throw new Error("Vault snapshot identifier already exists.");
  snapshotRepository.set(
    snapshot.snapshotId,
    Object.freeze({
      snapshot: Object.freeze(snapshot),
      policy: Object.freeze(policy),
    }),
  );
  return snapshot.snapshotId;
}

export function vaultSnapshotPolicyRegistryStatus(): Readonly<{
  registryVersion: "c3-vault-snapshot-policy-registry/v1";
  configuredPolicyIds: readonly string[];
  productionReady: false;
}> {
  return Object.freeze({
    registryVersion: "c3-vault-snapshot-policy-registry/v1",
    configuredPolicyIds: Object.freeze([
      ...VAULT_SNAPSHOT_POLICY_REGISTRY.keys(),
    ]),
    productionReady: false,
  });
}

function snapshotAmount(value: string, label: string): bigint {
  if (!INTEGER.test(value))
    throw new Error(`${label} is not a canonical integer.`);
  return assertU64(BigInt(value), label);
}

export function validateReconciledVaultSnapshot(
  snapshot: ReconciledVaultSnapshot,
  policy: VaultSnapshotPolicy,
  nowUnix: number,
  currentSlot: number,
): Readonly<{ navUsdMicros: bigint; shareSupplyBaseUnits: bigint }> {
  if (
    snapshot.schemaVersion !== "c3-vault-snapshot/v1" ||
    !/^c3-snapshot-[a-f0-9]{32,64}$/.test(snapshot.snapshotId) ||
    snapshot.cluster !== "mainnet-beta" ||
    snapshot.genesisHash !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2NZh" ||
    snapshot.configurationHash !== policy.configurationHash ||
    snapshot.vault !== policy.vault ||
    snapshot.shareMint !== policy.shareMint
  )
    throw new Error("Vault snapshot identity does not match trusted policy.");
  if (
    !trustedSnapshots.has(snapshot) ||
    !HASH.test(snapshot.reconciliationEvidenceHash) ||
    !HASH.test(snapshot.snapshotFingerprint) ||
    snapshot.snapshotFingerprint !== computeSnapshotFingerprint(snapshot) ||
    snapshot.providerEvidenceFingerprints.length !== 2 ||
    snapshot.providerEvidenceFingerprints.some((value) => !HASH.test(value))
  )
    throw new Error("Vault snapshot lacks sealed reconciliation provenance.");
  if (
    !Number.isSafeInteger(snapshot.slot) ||
    snapshot.slot <= 0 ||
    !Number.isSafeInteger(snapshot.blockTimeUnix) ||
    nowUnix < snapshot.blockTimeUnix ||
    nowUnix - snapshot.blockTimeUnix > policy.maximumAgeSeconds ||
    !Number.isSafeInteger(currentSlot) ||
    currentSlot < snapshot.slot ||
    currentSlot - snapshot.slot > policy.maximumSlotDrift
  )
    throw new Error("Vault snapshot is stale or has mismatched slot context.");
  if (snapshot.unsolicitedDonations.length > 0)
    throw new Error(
      "Unsolicited donations require explicit manual reconciliation.",
    );
  const expectedAssets: C3AssetId[] = ["USDC", "cbBTC", "PortalETH", "WSOL"];
  if (snapshot.balances.length !== expectedAssets.length)
    throw new Error(
      "Vault snapshot must include every canonical asset exactly once.",
    );
  const seen = new Set<C3AssetId>();
  const priced: PricedBalance[] = [];
  for (const balance of snapshot.balances) {
    if (seen.has(balance.asset))
      throw new Error("Vault snapshot contains duplicate balances.");
    seen.add(balance.asset);
    if (
      balance.mint !== policy.mints[balance.asset] ||
      balance.tokenAccount !== policy.tokenAccounts[balance.asset] ||
      balance.decimals !== policy.decimals[balance.asset] ||
      balance.oracleId !== policy.oracleIds[balance.asset]
    )
      throw new Error(
        "Vault balance account, mint, decimals, or oracle mismatch.",
      );
    if (
      !Number.isInteger(balance.oracleConfidenceBps) ||
      balance.oracleConfidenceBps < 0 ||
      balance.oracleConfidenceBps > 200 ||
      nowUnix < balance.oraclePublishTimeUnix ||
      nowUnix - balance.oraclePublishTimeUnix > policy.maximumAgeSeconds
    )
      throw new Error(
        "Vault oracle evidence is stale or outside confidence policy.",
      );
    priced.push({
      asset: balance.asset,
      balanceBaseUnits: snapshotAmount(
        balance.balanceBaseUnits,
        `${balance.asset} balance`,
      ),
      decimals: balance.decimals,
      priceUsdMicros: snapshotAmount(
        balance.priceUsdMicros,
        `${balance.asset} price`,
      ),
    });
  }
  if (seen.size !== expectedAssets.length)
    throw new Error("Vault snapshot omits a canonical asset.");
  let navUsdMicros = calculateVaultNavUsdMicros(priced);
  const inflows = snapshotAmount(
    snapshot.pendingAuthorizedInflowsUsdcBaseUnits,
    "pending inflows",
  );
  const outflows = snapshotAmount(
    snapshot.pendingAuthorizedOutflowsUsdcBaseUnits,
    "pending outflows",
  );
  const keeper = snapshotAmount(
    snapshot.pendingKeeperEffectsUsdcBaseUnits,
    "pending keeper effects",
  );
  const fees = snapshotAmount(
    snapshot.reservedFeesUsdcBaseUnits,
    "reserved fees",
  );
  const bounty = snapshotAmount(
    snapshot.reservedBountyUsdcBaseUnits,
    "reserved bounty",
  );
  const liabilities = [outflows, fees, bounty].reduce(
    (sum, value) => checkedAddU64(sum, value, "snapshot liabilities"),
    0n,
  );
  const available = [navUsdMicros, inflows, keeper].reduce(
    (sum, value) => checkedAddU64(sum, value, "snapshot available NAV"),
    0n,
  );
  if (liabilities > available)
    throw new Error("Vault snapshot pending liabilities exceed assets.");
  navUsdMicros = checkedSubU64(available, liabilities, "snapshot net NAV");
  const shareSupplyBaseUnits = snapshotAmount(
    snapshot.shareSupplyBaseUnits,
    "share supply",
  );
  if ((navUsdMicros === 0n) !== (shareSupplyBaseUnits === 0n))
    throw new Error("NAV and share supply disagree outside bootstrap.");
  if (
    shareSupplyBaseUnits === 0n &&
    policy.bootstrapEvidenceHash !== undefined &&
    !HASH.test(policy.bootstrapEvidenceHash)
  )
    throw new Error("Bootstrap evidence is malformed.");
  return Object.freeze({ navUsdMicros, shareSupplyBaseUnits });
}

export type PricedBalance = Readonly<{
  asset: C3AssetId;
  balanceBaseUnits: bigint;
  decimals: number;
  priceUsdMicros: bigint;
}>;

export type FeeMode = "inactive" | "candidate" | "skr_candidate";

export type CostInputs = Readonly<{
  symmetryBountyUsdcBaseUnits: bigint;
  networkFeeUsdcBaseUnits: bigint;
  priorityFeeUsdcBaseUnits: bigint;
  accountRentUsdcBaseUnits: bigint;
  jupiterDexFeeUsdcBaseUnits: bigint;
  slippageUsdcBaseUnits: bigint;
  priceImpactUsdcBaseUnits: bigint;
  warningThresholdBps: number;
}>;

export function calculateVaultNavUsdMicros(
  balances: readonly PricedBalance[],
): bigint {
  if (balances.length === 0)
    throw new RangeError("Vault NAV requires at least one asset.");
  let total = 0n;
  for (const balance of balances) {
    assertU64(balance.balanceBaseUnits, `${balance.asset} balance`);
    if (
      !Number.isInteger(balance.decimals) ||
      balance.decimals < 0 ||
      balance.decimals > 18
    )
      throw new RangeError("Invalid asset decimals.");
    if (balance.priceUsdMicros <= 0n)
      throw new RangeError(`${balance.asset} price must be positive.`);
    total = checkedAddU64(
      total,
      assertU64(
        checkedMulDivFloorU64(
          balance.balanceBaseUnits,
          balance.priceUsdMicros,
          10n ** BigInt(balance.decimals),
          `${balance.asset} priced value`,
        ),
        `${balance.asset} priced value`,
      ),
      "vault NAV",
    );
  }
  return total;
}

export function calculateFee(amountBaseUnits: bigint, mode: FeeMode): bigint {
  assertU64(amountBaseUnits, "fee amount");
  if (mode === "inactive") return 0n;
  if (
    !C3_FEES.collectionEnabled ||
    !C3_FEES.securityApproved ||
    !C3_FEES.governanceApproved
  ) {
    throw new Error("C3 fee collection is not approved or enabled.");
  }
  const rate =
    mode === "skr_candidate"
      ? C3_FEES.skrDiscountedRateUnits
      : C3_FEES.buyRateUnits;
  return mulDivFloor(amountBaseUnits, rate, C3_FEES.denominator);
}

export function calculateCandidateFeeForDisclosure(
  amountBaseUnits: bigint,
  discounted = false,
): bigint {
  assertU64(amountBaseUnits, "fee disclosure amount");
  const rate = discounted
    ? C3_FEES.skrDiscountedRateUnits
    : C3_FEES.buyRateUnits;
  return mulDivFloor(amountBaseUnits, rate, C3_FEES.denominator);
}

export function quoteDeposit(
  input: Readonly<{
    depositUsdcBaseUnits: bigint;
    snapshotId: string;
    nowUnix: number;
    currentSlot: number;
    slippageBps: number;
    costInputs: CostInputs;
  }>,
): Readonly<{
  expectedSharesBaseUnits: bigint;
  minimumSharesBaseUnits: bigint;
  activeFeeBaseUnits: bigint;
  candidateFeeBaseUnits: bigint;
  totalEstimatedEffectiveCostBaseUnits: bigint;
  effectiveCostBps: bigint;
  economicallyInefficient: boolean;
}> {
  const deposit = assertU64(input.depositUsdcBaseUnits, "deposit");
  const stored = snapshotRepository.get(input.snapshotId);
  if (!stored)
    throw new Error("Trusted reconciled vault snapshot is unavailable.");
  if (deposit < C3_AMOUNTS.minimumPurchaseUsdcBaseUnits)
    throw new RangeError("Controlled pilot minimum is 1 USDC.");
  if (deposit > C3_AMOUNTS.maximumPilotPurchaseUsdcBaseUnits)
    throw new RangeError("Controlled pilot maximum is 10 USDC.");
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 100
  )
    throw new RangeError("Slippage must be 0-100 bps.");
  const { navUsdMicros, shareSupplyBaseUnits } =
    validateReconciledVaultSnapshot(
      stored.snapshot,
      stored.policy,
      input.nowUnix,
      input.currentSlot,
    );
  if (
    shareSupplyBaseUnits === 0n &&
    (!stored.policy.bootstrapEvidenceHash ||
      deposit <
        snapshotAmount(
          stored.policy.minimumBootstrapUsdcBaseUnits,
          "minimum bootstrap",
        ))
  )
    throw new Error(
      "Initial deposit requires reviewed bootstrap evidence and minimum seed.",
    );

  const activeFeeBaseUnits = calculateFee(deposit, "inactive");
  const netDeposit = deposit - activeFeeBaseUnits;
  const expectedSharesBaseUnits =
    shareSupplyBaseUnits === 0n
      ? netDeposit
      : mulDivFloor(netDeposit, shareSupplyBaseUnits, navUsdMicros);
  if (expectedSharesBaseUnits <= 0n)
    throw new RangeError("Deposit would issue zero C3 shares.");
  const minimumSharesBaseUnits = mulDivFloor(
    expectedSharesBaseUnits,
    BigInt(10_000 - input.slippageBps),
    10_000n,
  );
  const candidateFeeBaseUnits = calculateCandidateFeeForDisclosure(deposit);
  const variableCosts = [
    input.costInputs.symmetryBountyUsdcBaseUnits,
    input.costInputs.networkFeeUsdcBaseUnits,
    input.costInputs.priorityFeeUsdcBaseUnits,
    input.costInputs.accountRentUsdcBaseUnits,
    input.costInputs.jupiterDexFeeUsdcBaseUnits,
    input.costInputs.slippageUsdcBaseUnits,
    input.costInputs.priceImpactUsdcBaseUnits,
  ];
  for (const value of variableCosts) assertU64(value, "cost component");
  const totalEstimatedEffectiveCostBaseUnits = variableCosts.reduce(
    (sum, value) => checkedAddU64(sum, value, "estimated effective cost"),
    activeFeeBaseUnits,
  );
  const effectiveCostBps = mulDivCeil(
    totalEstimatedEffectiveCostBaseUnits,
    10_000n,
    deposit,
  );
  return Object.freeze({
    expectedSharesBaseUnits,
    minimumSharesBaseUnits,
    activeFeeBaseUnits,
    candidateFeeBaseUnits,
    totalEstimatedEffectiveCostBaseUnits,
    effectiveCostBps,
    economicallyInefficient:
      effectiveCostBps >= BigInt(input.costInputs.warningThresholdBps),
  });
}

export function quoteRedemption(
  input: Readonly<{
    sharesBaseUnits: bigint;
    snapshotId: string;
    nowUnix: number;
    currentSlot: number;
    slippageBps: number;
  }>,
): Readonly<{
  expectedUsdcBaseUnits: bigint;
  minimumUsdcBaseUnits: bigint;
  activeFeeBaseUnits: bigint;
}> {
  const shares = assertU64(input.sharesBaseUnits, "redemption shares");
  const stored = snapshotRepository.get(input.snapshotId);
  if (!stored)
    throw new Error("Trusted reconciled vault snapshot is unavailable.");
  const { navUsdMicros: nav, shareSupplyBaseUnits: supply } =
    validateReconciledVaultSnapshot(
      stored.snapshot,
      stored.policy,
      input.nowUnix,
      input.currentSlot,
    );
  if (shares === 0n || supply === 0n || shares > supply)
    throw new RangeError("Invalid proportional redemption.");
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 100
  )
    throw new RangeError("Invalid redemption slippage.");
  const gross = mulDivFloor(shares, nav, supply);
  const activeFeeBaseUnits = calculateFee(gross, "inactive");
  const expectedUsdcBaseUnits = gross - activeFeeBaseUnits;
  return Object.freeze({
    expectedUsdcBaseUnits,
    minimumUsdcBaseUnits: mulDivFloor(
      expectedUsdcBaseUnits,
      BigInt(10_000 - input.slippageBps),
      10_000n,
    ),
    activeFeeBaseUnits,
  });
}

export function calculateAllocationAndDrift(
  values: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>,
): Readonly<{
  total: bigint;
  currentBps: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
  driftBps: Readonly<{ btc: bigint; eth: bigint; sol: bigint }>;
}> {
  const total = checkedAddU64(
    checkedAddU64(
      assertU64(values.btc, "BTC allocation value"),
      assertU64(values.eth, "ETH allocation value"),
      "BTC and ETH allocation total",
    ),
    assertU64(values.sol, "SOL allocation value"),
    "allocation total",
  );
  if (total <= 0n)
    throw new RangeError("Allocation requires positive vault value.");
  const btc = mulDivFloor(values.btc, 10_000n, total);
  const eth = mulDivFloor(values.eth, 10_000n, total);
  const sol = 10_000n - btc - eth;
  return Object.freeze({
    total,
    currentBps: Object.freeze({ btc, eth, sol }),
    driftBps: Object.freeze({
      btc: absolute(btc - BigInt(C3_ALLOCATION.btcBps)),
      eth: absolute(eth - BigInt(C3_ALLOCATION.ethBps)),
      sol: absolute(sol - BigInt(C3_ALLOCATION.solBps)),
    }),
  });
}
