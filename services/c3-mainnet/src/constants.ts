export const C3_MAINNET_EXECUTION_CAPABILITY = false as const;

export const C3_ALLOCATION = /* @__PURE__ */ Object.freeze({
  btcBps: 4_000,
  ethBps: 3_000,
  solBps: 3_000,
  totalBps: 10_000,
});

export const C3_AMOUNTS = /* @__PURE__ */ Object.freeze({
  usdcDecimals: 6,
  shareDecimals: 6,
  minimumPurchaseUsdcBaseUnits: 1_000_000n,
  maximumPilotPurchaseUsdcBaseUnits: 10_000_000n,
  u64Max: 18_446_744_073_709_551_615n,
});

export const C3_FEES = /* @__PURE__ */ Object.freeze({
  denominator: 100_000n,
  buyRateUnits: 150n,
  sellRateUnits: 150n,
  skrDiscountedRateUnits: 75n,
  collectionEnabled: false,
  skrDiscountEnabled: false,
  securityApproved: false,
  governanceApproved: false,
});

export const C3_MAINNET = /* @__PURE__ */ Object.freeze({
  cluster: "mainnet-beta" as const,
  genesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  cbBtcMint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
  portalEthMint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  wrappedSolMint: "So11111111111111111111111111111111111111112",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  associatedTokenProgram: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  systemProgram: "11111111111111111111111111111111",
  computeBudgetProgram: "ComputeBudget111111111111111111111111111111",
  addressLookupTableProgram: "AddressLookupTab1e1111111111111111111111111",
  jupiterProgram: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  squadsV4Program: "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf",
  symmetryProgram: "BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate",
  symmetryGlobalConfig: "BV49JWNeVnRjvMg4BHVoRFXNXHMFqgZFsfHg2QUekynd",
});

export const SERVER_CREDENTIAL_NAMES = /* @__PURE__ */ Object.freeze({
  jupiter: "C3_JUPITER_API_KEY",
  pyth: "C3_PYTH_API_KEY",
  rpcPrimaryUrl: "C3_MAINNET_RPC_PRIMARY_URL",
  rpcSecondaryUrl: "C3_MAINNET_RPC_SECONDARY_URL",
  rpcPrimaryOperator: "C3_MAINNET_RPC_PRIMARY_OPERATOR_ID",
  rpcSecondaryOperator: "C3_MAINNET_RPC_SECONDARY_OPERATOR_ID",
});

export function assertExecutionDisabled(): void {
  if (C3_MAINNET_EXECUTION_CAPABILITY !== false)
    throw new Error("C3 Mainnet execution capability must fail closed.");
}
