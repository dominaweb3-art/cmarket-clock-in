import { createHash } from "node:crypto";

import {
  C3_MAINNET,
  buildDisabledUnsignedPackage,
  canonicalize,
  createAuthorizationContext,
  decodeBase58,
  deriveAssociatedTokenAddress,
  encodeBase58,
  type C3AuthorizationManifest,
  type ReconciledVaultSnapshot,
  type VaultSnapshotPolicy,
} from "./support/index.ts";

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

export function authorizationFixture(): C3AuthorizationManifest {
  const context = createAuthorizationContext({
    policyIdentifier: "c3.deposit-intent.disabled-validation.v1",
    operation: "deposit_intent",
    wallet,
    inputAmountBaseUnits: "1000000",
    slippageBps: 100,
  });
  return buildDisabledUnsignedPackage(
    context.intentId,
    makeV0Message(),
    context.issuedAtUnix,
  );
}

export const fixtureSignature = encodeBase58(
  Uint8Array.from({ length: 64 }, (_, index) => index + 1),
);

export function officialTransactionFixture(
  authorization: C3AuthorizationManifest = authorizationFixture(),
  mutation: Record<string, unknown> = {},
) {
  const message = Buffer.from(authorization.canonicalV0MessageBase64, "base64");
  const signed = Buffer.concat([
    Buffer.from([1]),
    Buffer.from(decodeBase58(fixtureSignature)),
    message,
  ]);
  const balance = (
    accountIndex: number,
    mint: string,
    owner: string,
    amount: string,
  ) => ({
    accountIndex,
    mint,
    owner,
    uiTokenAmount: {
      amount,
      decimals: 6,
      uiAmount: null,
      uiAmountString: amount,
    },
  });
  return {
    slot: 10,
    blockTime: authorization.issuedAtUnix,
    version: 0,
    transaction: [signed.toString("base64"), "base64"],
    meta: {
      err: null,
      fee: 5000,
      preBalances: [1_000_000, 0, 0, 0, 0, 0, 0],
      postBalances: [995_000, 0, 0, 0, 0, 0, 0],
      loadedAddresses: { writable: [], readonly: [] },
      innerInstructions: [{ index: 0, instructions: [] }],
      preTokenBalances: [
        balance(1, C3_MAINNET.usdcMint, wallet, "2000000"),
        balance(2, C3_MAINNET.usdcMint, vault, "0"),
        balance(3, shareMint, wallet, "0"),
      ],
      postTokenBalances: [
        balance(1, C3_MAINNET.usdcMint, wallet, "1000000"),
        balance(2, C3_MAINNET.usdcMint, vault, "1000000"),
        balance(3, shareMint, wallet, "1000000"),
      ],
      logMessages: ["sanitized official RPC fixture"],
    },
    ...mutation,
  };
}

export function officialStatusFixture() {
  return { slot: 10, err: null, confirmationStatus: "finalized" };
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

export function fabricatedVaultSnapshot(): ReconciledVaultSnapshot {
  const snapshot = {
    schemaVersion: "c3-vault-snapshot/v1" as const,
    snapshotId: `c3-snapshot-${"1".repeat(32)}`,
    cluster: "mainnet-beta" as const,
    genesisHash: C3_MAINNET.genesisHash,
    configurationHash: snapshotPolicy.configurationHash,
    slot: 100,
    blockTimeUnix: 990,
    vault,
    balances: [
      {
        asset: "USDC" as const,
        mint: C3_MAINNET.usdcMint,
        tokenAccount: vaultUsdc,
        balanceBaseUnits: "20000000",
        decimals: 6,
        priceUsdMicros: "1000000",
        oracleId: "usdc",
        oracleConfidenceBps: 1,
        oraclePublishTimeUnix: 990,
      },
      {
        asset: "cbBTC" as const,
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
        asset: "PortalETH" as const,
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
        asset: "WSOL" as const,
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
    shareSupplyBaseUnits: "10000000",
    pendingAuthorizedInflowsUsdcBaseUnits: "0",
    pendingAuthorizedOutflowsUsdcBaseUnits: "0",
    pendingKeeperEffectsUsdcBaseUnits: "0",
    reservedFeesUsdcBaseUnits: "0",
    reservedBountyUsdcBaseUnits: "0",
    unsolicitedDonations: [],
    reconciliationEvidenceHash: "6".repeat(64),
    providerEvidenceFingerprints: ["7".repeat(64), "8".repeat(64)] as const,
    snapshotFingerprint: "",
  };
  const payload = { ...snapshot } as Record<string, unknown>;
  delete payload.snapshotFingerprint;
  return Object.freeze({
    ...snapshot,
    snapshotFingerprint: createHash("sha256")
      .update(canonicalize(payload))
      .digest("hex"),
  });
}
