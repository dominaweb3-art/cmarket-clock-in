/** Immutable disabled capability. Public Expo values cannot enable settlement. */
export const C3_PILOT_EXECUTION_ENABLED = false as const;
export const C3_MAINNET_EXECUTION_ENABLED = false as const;
const KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HASH = /^[a-f0-9]{64}$/;

export type PilotConfig = Readonly<{
  version: "local-pilot/v1";
  cluster: "local-validator";
  programId: string;
  vault: string;
  shareMint: string;
  usdcMint: string;
  backendUrl: string;
  ownerAllowlist: string;
  configurationHash: string;
}>;

export function parsePilotConfig(
  values: Record<string, string | undefined>,
  release: boolean,
): PilotConfig | null {
  if (
    values.EXPO_PUBLIC_C3_PILOT_CONFIG_VERSION !== "local-pilot/v1" ||
    values.EXPO_PUBLIC_C3_PILOT_CLUSTER !== "local-validator"
  )
    return null;
  const programId = values.EXPO_PUBLIC_C3_PILOT_PROGRAM_ID;
  const vault = values.EXPO_PUBLIC_C3_PILOT_VAULT;
  const shareMint = values.EXPO_PUBLIC_C3_PILOT_SHARE_MINT;
  const usdcMint = values.EXPO_PUBLIC_C3_PILOT_USDC_MINT;
  const backendUrl = values.EXPO_PUBLIC_C3_PILOT_BACKEND_URL;
  const ownerAllowlist = values.EXPO_PUBLIC_C3_PILOT_OWNER_ALLOWLIST;
  const configurationHash = values.EXPO_PUBLIC_C3_PILOT_CONFIG_HASH;
  if (
    !programId ||
    !vault ||
    !shareMint ||
    !usdcMint ||
    !backendUrl ||
    !ownerAllowlist ||
    !configurationHash ||
    ![programId, vault, shareMint, usdcMint, ownerAllowlist].every((value) =>
      KEY.test(value),
    ) ||
    !HASH.test(configurationHash)
  )
    return null;
  let endpoint: URL;
  try {
    endpoint = new URL(backendUrl);
  } catch {
    return null;
  }
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    return null;
  if (release && endpoint.protocol !== "https:") return null;
  if (
    !release &&
    endpoint.protocol !== "https:" &&
    !(endpoint.protocol === "http:" && endpoint.hostname === "10.0.2.2")
  )
    return null;
  return Object.freeze({
    version: "local-pilot/v1",
    cluster: "local-validator",
    programId,
    vault,
    shareMint,
    usdcMint,
    backendUrl: endpoint.toString().replace(/\/$/, ""),
    ownerAllowlist,
    configurationHash,
  });
}

export const PILOT_CONFIG = parsePilotConfig(
  {
    EXPO_PUBLIC_C3_PILOT_CONFIG_VERSION:
      process.env.EXPO_PUBLIC_C3_PILOT_CONFIG_VERSION,
    EXPO_PUBLIC_C3_PILOT_CLUSTER: process.env.EXPO_PUBLIC_C3_PILOT_CLUSTER,
    EXPO_PUBLIC_C3_PILOT_PROGRAM_ID:
      process.env.EXPO_PUBLIC_C3_PILOT_PROGRAM_ID,
    EXPO_PUBLIC_C3_PILOT_VAULT: process.env.EXPO_PUBLIC_C3_PILOT_VAULT,
    EXPO_PUBLIC_C3_PILOT_SHARE_MINT:
      process.env.EXPO_PUBLIC_C3_PILOT_SHARE_MINT,
    EXPO_PUBLIC_C3_PILOT_USDC_MINT: process.env.EXPO_PUBLIC_C3_PILOT_USDC_MINT,
    EXPO_PUBLIC_C3_PILOT_BACKEND_URL:
      process.env.EXPO_PUBLIC_C3_PILOT_BACKEND_URL,
    EXPO_PUBLIC_C3_PILOT_OWNER_ALLOWLIST:
      process.env.EXPO_PUBLIC_C3_PILOT_OWNER_ALLOWLIST,
    EXPO_PUBLIC_C3_PILOT_CONFIG_HASH:
      process.env.EXPO_PUBLIC_C3_PILOT_CONFIG_HASH,
  },
  typeof __DEV__ === "undefined" || !__DEV__,
);
