import { createHash } from "node:crypto";

import {
  C3_MAINNET,
  canonicalize,
  decodeBase58,
  deriveAssociatedTokenAddress,
  encodeBase58,
  validateCanonicalV0Transaction,
  type C3AuthorizationManifest,
  type RawFinalizedTransaction,
  type ReconciledVaultSnapshot,
  type TrustedOperationPolicy,
  type VaultSnapshotPolicy,
} from "../src/index.ts";

export const wallet = C3_MAINNET.cbBtcMint;
export const vault = C3_MAINNET.symmetryGlobalConfig;
export const shareMint = C3_MAINNET.portalEthMint;
export const userUsdc = deriveAssociatedTokenAddress(
  wallet,
  C3_MAINNET.usdcMint,
);
export const vaultUsdc = deriveAssociatedTokenAddress(
  vault,
  C3_MAINNET.usdcMint,
);
export const userShares = deriveAssociatedTokenAddress(wallet, shareMint);

function short(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let next = remaining & 0x7f;
    remaining >>= 7;
    if (remaining > 0) next |= 0x80;
    bytes.push(next);
  } while (remaining > 0);
  return bytes;
}

export function makeV0Message(
  mutation: Readonly<{
    wallet?: string;
    destination?: string;
    shareDestination?: string;
    vault?: string;
    program?: string;
    data?: Uint8Array;
    blockhash?: string;
    writableReadonlyCount?: number;
    extraSigner?: string;
  }> = {},
): string {
  const signer = mutation.wallet ?? wallet;
  const staticKeys = [
    signer,
    mutation.destination ?? userUsdc,
    mutation.vault ?? vaultUsdc,
    mutation.shareDestination ?? userShares,
    C3_MAINNET.usdcMint,
    shareMint,
    mutation.program ?? C3_MAINNET.symmetryProgram,
  ];
  if (mutation.extraSigner) staticKeys.splice(1, 0, mutation.extraSigner);
  const requiredSigners = mutation.extraSigner ? 2 : 1;
  const programIndex = staticKeys.length - 1;
  const instructionAccounts = staticKeys
    .map((_, index) => index)
    .filter((index) => index !== programIndex);
  const data = mutation.data ?? Uint8Array.of(1, 2, 3, 4);
  const bytes = Uint8Array.from([
    0x80,
    requiredSigners,
    0,
    mutation.writableReadonlyCount ?? 3,
    ...short(staticKeys.length),
    ...staticKeys.flatMap((key) => [...decodeBase58(key)]),
    ...decodeBase58(mutation.blockhash ?? C3_MAINNET.wrappedSolMint),
    ...short(1),
    programIndex,
    ...short(instructionAccounts.length),
    ...instructionAccounts,
    ...short(data.length),
    ...data,
    ...short(0),
  ]);
  return Buffer.from(bytes).toString("base64");
}

export function trustedPolicy(
  mutation: Partial<TrustedOperationPolicy> = {},
): TrustedOperationPolicy {
  return {
    policySchemaVersion: "c3-operation-policy/v2",
    configurationVersion: "c3-mainnet-deployment/v1",
    configurationHash: "1".repeat(64),
    cluster: "mainnet-beta",
    genesisHash: C3_MAINNET.genesisHash,
    operation: "deposit_intent",
    wallet,
    feePayer: wallet,
    vault,
    shareMint,
    inputMint: C3_MAINNET.usdcMint,
    userInputTokenAccount: userUsdc,
    vaultInputTokenAccount: vaultUsdc,
    userShareTokenAccount: userShares,
    inputAmountBaseUnits: "1000000",
    expectedOutputBaseUnits: "1000000",
    minimumOutputBaseUnits: "990000",
    feeBaseUnits: "0",
    bountyBaseUnits: "0",
    allowedPrograms: [C3_MAINNET.symmetryProgram],
    approvedRoutePrograms: [],
    instructions: [
      {
        programId: C3_MAINNET.symmetryProgram,
        accountAddresses: [
          wallet,
          userUsdc,
          vaultUsdc,
          userShares,
          C3_MAINNET.usdcMint,
          shareMint,
        ],
        signerFlags: [true, false, false, false, false, false],
        writableFlags: [true, true, true, true, false, false],
        dataBase64: Buffer.from(Uint8Array.of(1, 2, 3, 4)).toString("base64"),
      },
    ],
    expectedEffects: [
      {
        kind: "token_credit",
        owner: wallet,
        mint: shareMint,
        amountBaseUnits: "1000000",
        tokenAccount: userShares,
      },
      {
        kind: "token_debit",
        owner: wallet,
        mint: C3_MAINNET.usdcMint,
        amountBaseUnits: "1000000",
        tokenAccount: userUsdc,
      },
      {
        kind: "token_credit",
        owner: vault,
        mint: C3_MAINNET.usdcMint,
        amountBaseUnits: "1000000",
        tokenAccount: vaultUsdc,
      },
    ],
    expectedDestinations: [userShares, vaultUsdc],
    reconciliationPostConditions: [
      "vault USDC credited",
      "user C3 shares credited",
    ],
    quoteContextHash: "2".repeat(64),
    quoteObservedAtUnix: 990,
    quoteExpiresAtUnix: 1_010,
    transactionExpiresAtUnix: 1_050,
    lastValidBlockHeight: 123,
    lookupTableContents: [],
    evidenceHash: "3".repeat(64),
    evidenceSource: "synthetic-test",
    ...mutation,
  };
}

export function authorizationFixture(): C3AuthorizationManifest {
  const policy = trustedPolicy();
  const decoded = validateCanonicalV0Transaction(policy, makeV0Message());
  const payload: Omit<C3AuthorizationManifest, "authorizationHash"> = {
    schemaVersion: "c3-authorization/v2",
    executionCapability: false,
    configurationVersion: policy.configurationVersion,
    configurationHash: policy.configurationHash,
    cluster: policy.cluster,
    genesisHash: policy.genesisHash,
    operation: policy.operation,
    intentId: `c3-${"a".repeat(32)}`,
    idempotencyKey: "b".repeat(64),
    wallet,
    vault,
    shareMint,
    inputMint: C3_MAINNET.usdcMint,
    inputAmountBaseUnits: "1000000",
    expectedOutputBaseUnits: "1000000",
    minimumOutputBaseUnits: "990000",
    feeBaseUnits: "0",
    bountyBaseUnits: "0",
    slippageBps: 100,
    quoteContextHash: policy.quoteContextHash,
    quoteObservedAtUnix: 990,
    quoteExpiresAtUnix: 1_010,
    transactionExpiresAtUnix: 1_050,
    recentBlockhash: decoded.recentBlockhash,
    lastValidBlockHeight: 123,
    canonicalV0MessageBase64: decoded.messageBase64,
    canonicalV0MessageHash: decoded.messageHash,
    wireBytes: decoded.wireBytes,
    staticAccounts: decoded.staticAccounts,
    loadedAccounts: decoded.loadedAccounts,
    compiledInstructions: decoded.instructions,
    lookupTables: decoded.lookupTables,
    allowedPrograms: policy.allowedPrograms,
    approvedRoutePrograms: [],
    expectedEffects: [...policy.expectedEffects].sort((a, b) =>
      a.tokenAccount.localeCompare(b.tokenAccount),
    ),
    expectedDestinations: policy.expectedDestinations,
    reconciliationPostConditions: policy.reconciliationPostConditions,
  };
  return Object.freeze({
    ...payload,
    authorizationHash: createHash("sha256")
      .update(canonicalize(payload))
      .digest("hex"),
  });
}

export function finalizedTransactionFixture(
  mutation: Partial<RawFinalizedTransaction> = {},
): RawFinalizedTransaction {
  const authorization = authorizationFixture();
  return {
    signature: encodeBase58(
      Uint8Array.from({ length: 64 }, (_, index) => index + 1),
    ),
    cluster: C3_MAINNET.cluster,
    genesisHash: C3_MAINNET.genesisHash,
    confirmationStatus: "finalized",
    slot: 10,
    blockTimeUnix: 1_000,
    error: null,
    canonicalV0MessageHash: authorization.canonicalV0MessageHash,
    feePayer: wallet,
    signers: [wallet],
    staticAccounts: authorization.staticAccounts.map(
      (account) => account.address,
    ),
    loadedAddresses: [],
    lookupTableContentsHash: "0".repeat(64),
    outerInstructions: [
      {
        programId: C3_MAINNET.symmetryProgram,
        dataBase64: "AQIDBA==",
        accounts: [wallet, userUsdc, vaultUsdc, userShares],
        inner: false,
        decodedKind: "other",
      },
    ],
    innerInstructions: [
      {
        programId: C3_MAINNET.symmetryProgram,
        dataBase64: "AQ==",
        accounts: [userUsdc, vaultUsdc],
        inner: true,
        decodedKind: "transfer_checked",
      },
    ],
    preTokenBalances: [
      {
        tokenAccount: userUsdc,
        owner: wallet,
        mint: C3_MAINNET.usdcMint,
        amountBaseUnits: "2000000",
      },
      {
        tokenAccount: vaultUsdc,
        owner: vault,
        mint: C3_MAINNET.usdcMint,
        amountBaseUnits: "0",
      },
      {
        tokenAccount: userShares,
        owner: wallet,
        mint: shareMint,
        amountBaseUnits: "0",
      },
    ],
    postTokenBalances: [
      {
        tokenAccount: userUsdc,
        owner: wallet,
        mint: C3_MAINNET.usdcMint,
        amountBaseUnits: "1000000",
      },
      {
        tokenAccount: vaultUsdc,
        owner: vault,
        mint: C3_MAINNET.usdcMint,
        amountBaseUnits: "1000000",
      },
      {
        tokenAccount: userShares,
        owner: wallet,
        mint: shareMint,
        amountBaseUnits: "1000000",
      },
    ],
    preLamports: ["1000000"],
    postLamports: ["995000"],
    shareSupplyBefore: "0",
    shareSupplyAfter: "1000000",
    logs: ["synthetic parser fixture"],
    ...mutation,
  };
}

export const snapshotPolicy: VaultSnapshotPolicy = {
  configurationHash: "4".repeat(64),
  vault,
  shareMint,
  tokenAccounts: {
    USDC: vaultUsdc,
    cbBTC: C3_MAINNET.cbBtcMint,
    PortalETH: C3_MAINNET.portalEthMint,
    WSOL: C3_MAINNET.wrappedSolMint,
  },
  mints: {
    USDC: C3_MAINNET.usdcMint,
    cbBTC: C3_MAINNET.cbBtcMint,
    PortalETH: C3_MAINNET.portalEthMint,
    WSOL: C3_MAINNET.wrappedSolMint,
  },
  decimals: { USDC: 6, cbBTC: 8, PortalETH: 8, WSOL: 9 },
  oracleIds: { USDC: "usdc", cbBTC: "btc", PortalETH: "eth", WSOL: "sol" },
  maximumAgeSeconds: 60,
  maximumSlotDrift: 20,
  bootstrapEvidenceHash: "5".repeat(64),
  minimumBootstrapUsdcBaseUnits: "1000000",
};

export function vaultSnapshot(
  navUsdcBaseUnits = "20000000",
  shareSupplyBaseUnits = "10000000",
  mutation: Partial<ReconciledVaultSnapshot> = {},
): ReconciledVaultSnapshot {
  return {
    schemaVersion: "c3-vault-snapshot/v1",
    cluster: "mainnet-beta",
    genesisHash: C3_MAINNET.genesisHash,
    configurationHash: snapshotPolicy.configurationHash,
    slot: 100,
    blockTimeUnix: 990,
    vault,
    balances: [
      {
        asset: "USDC",
        mint: C3_MAINNET.usdcMint,
        tokenAccount: vaultUsdc,
        balanceBaseUnits: navUsdcBaseUnits,
        decimals: 6,
        priceUsdMicros: "1000000",
        oracleId: "usdc",
        oracleConfidenceBps: 1,
        oraclePublishTimeUnix: 990,
      },
      {
        asset: "cbBTC",
        mint: C3_MAINNET.cbBtcMint,
        tokenAccount: C3_MAINNET.cbBtcMint,
        balanceBaseUnits: "0",
        decimals: 8,
        priceUsdMicros: "100000000000",
        oracleId: "btc",
        oracleConfidenceBps: 10,
        oraclePublishTimeUnix: 990,
      },
      {
        asset: "PortalETH",
        mint: C3_MAINNET.portalEthMint,
        tokenAccount: C3_MAINNET.portalEthMint,
        balanceBaseUnits: "0",
        decimals: 8,
        priceUsdMicros: "3000000000",
        oracleId: "eth",
        oracleConfidenceBps: 10,
        oraclePublishTimeUnix: 990,
      },
      {
        asset: "WSOL",
        mint: C3_MAINNET.wrappedSolMint,
        tokenAccount: C3_MAINNET.wrappedSolMint,
        balanceBaseUnits: "0",
        decimals: 9,
        priceUsdMicros: "100000000",
        oracleId: "sol",
        oracleConfidenceBps: 10,
        oraclePublishTimeUnix: 990,
      },
    ],
    shareMint,
    shareSupplyBaseUnits,
    pendingAuthorizedInflowsUsdcBaseUnits: "0",
    pendingAuthorizedOutflowsUsdcBaseUnits: "0",
    pendingKeeperEffectsUsdcBaseUnits: "0",
    reservedFeesUsdcBaseUnits: "0",
    reservedBountyUsdcBaseUnits: "0",
    unsolicitedDonations: [],
    reconciliationEvidenceHash: "6".repeat(64),
    productionEvidence: true,
    ...mutation,
  };
}
