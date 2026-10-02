/** Separate pre-approval release. Source review, never public env/storage/deep
 * links, controls capability. This artifact CANNOT request a monetary signature. */
export const MAINNET_MONETARY_CAPABILITY = false as const;
export const APPROVED_CANDIDATE_CONFIGURATION = null;
export const CANDIDATE_CHAIN = "solana:mainnet" as const;
export function requireCandidateMoneyGate(): never {
  throw new Error("C3_MAINNET_PILOT_NOT_APPROVED");
}
/** Keeps direct calls closed as well as disabled UI/navigation. */
export async function runCandidateMonetarySession<T>(
  session: () => Promise<T>,
): Promise<T> {
  requireCandidateMoneyGate();
  return session();
}
export function candidateHttpsEndpoint(
  value: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/" ||
      !["", "443"].includes(u.port) ||
      /^(localhost|127\.|10\.|192\.168\.|\[?::1)/i.test(u.hostname)
    )
      return null;
    return u.origin;
  } catch {
    return null;
  }
}
