/**
 * Build capability for the shipped Devnet artifact.
 *
 * This is intentionally source-controlled and immutable at runtime. Creating a
 * Mainnet-capable artifact requires a reviewed source change to this constant,
 * a separate release commit, and the full Mainnet security/release checklist.
 */
export const C3_MAINNET_BUILD_CAPABILITY = false as const

export function isC3MainnetBuildCapable(): boolean {
  return C3_MAINNET_BUILD_CAPABILITY
}
