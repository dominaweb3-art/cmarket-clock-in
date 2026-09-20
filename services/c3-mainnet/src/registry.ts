import { C3_MAINNET } from "./constants.ts";

export type C3AssetId = "USDC" | "cbBTC" | "PortalETH" | "WSOL";

export type C3AssetDefinition = Readonly<{
  id: C3AssetId;
  role: "input" | "btc" | "eth" | "sol";
  mint: string;
  decimals: number;
  tokenProgram: string;
  oracleFeedId: string;
  issuer: string;
  routePolicy: "jupiter-reviewed-only";
  riskDisclosure: string;
  status: "candidate";
}>;

export const C3_MAINNET_ASSET_REGISTRY: Readonly<
  Record<C3AssetId, C3AssetDefinition>
> = Object.freeze({
  USDC: Object.freeze({
    id: "USDC",
    role: "input",
    mint: C3_MAINNET.usdcMint,
    decimals: 6,
    tokenProgram: C3_MAINNET.tokenProgram,
    oracleFeedId:
      "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    issuer: "Circle",
    routePolicy: "jupiter-reviewed-only",
    riskDisclosure:
      "Centralized fiat-backed stablecoin with issuer freeze and redemption risk.",
    status: "candidate",
  }),
  cbBTC: Object.freeze({
    id: "cbBTC",
    role: "btc",
    mint: C3_MAINNET.cbBtcMint,
    decimals: 8,
    tokenProgram: C3_MAINNET.tokenProgram,
    oracleFeedId:
      "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    issuer: "Coinbase",
    routePolicy: "jupiter-reviewed-only",
    riskDisclosure:
      "Custodial wrapped Bitcoin exposure with issuer, redemption, liquidity, and depeg risk.",
    status: "candidate",
  }),
  PortalETH: Object.freeze({
    id: "PortalETH",
    role: "eth",
    mint: C3_MAINNET.portalEthMint,
    decimals: 8,
    tokenProgram: C3_MAINNET.tokenProgram,
    oracleFeedId:
      "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    issuer: "Wormhole Portal",
    routePolicy: "jupiter-reviewed-only",
    riskDisclosure:
      "Bridge-wrapped ETH with bridge, custody, redemption, liquidity, and depeg risk.",
    status: "candidate",
  }),
  WSOL: Object.freeze({
    id: "WSOL",
    role: "sol",
    mint: C3_MAINNET.wrappedSolMint,
    decimals: 9,
    tokenProgram: C3_MAINNET.tokenProgram,
    oracleFeedId:
      "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    issuer: "Solana native wrapper",
    routePolicy: "jupiter-reviewed-only",
    riskDisclosure:
      "WSOL is the SPL representation used internally; vault accounting must preserve native SOL/WSOL semantics.",
    status: "candidate",
  }),
});

export type AssetEvidence = Readonly<{
  cluster: "mainnet-beta";
  mint: string;
  decimals: number;
  ownerProgram: string;
  initialized: boolean;
  supplyBaseUnits: string;
  metadataVerified: boolean;
  liquidityVerified: boolean;
  observedAtUnix: number;
}>;

export function validateAssetEvidence(
  asset: C3AssetDefinition,
  evidence: AssetEvidence,
): string[] {
  const issues: string[] = [];
  if (evidence.cluster !== "mainnet-beta")
    issues.push(`${asset.id}: wrong cluster`);
  if (evidence.mint !== asset.mint) issues.push(`${asset.id}: wrong mint`);
  if (evidence.decimals !== asset.decimals)
    issues.push(`${asset.id}: wrong decimals`);
  if (evidence.ownerProgram !== asset.tokenProgram)
    issues.push(`${asset.id}: wrong token program`);
  if (!evidence.initialized)
    issues.push(`${asset.id}: mint is not initialized`);
  if (
    !/^(0|[1-9]\d*)$/.test(evidence.supplyBaseUnits) ||
    BigInt(evidence.supplyBaseUnits) <= 0n
  )
    issues.push(`${asset.id}: invalid supply`);
  if (!evidence.metadataVerified)
    issues.push(`${asset.id}: metadata is not verified`);
  if (!evidence.liquidityVerified)
    issues.push(`${asset.id}: liquidity is not verified`);
  return issues;
}
