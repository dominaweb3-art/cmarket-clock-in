export const DEVNET_BALANCE_RPC = "https://api.devnet.solana.com";
export const BALANCE_MINTS = [
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "J4cTKzcwdrkpU1qYxbJ1LpiJivpKcZeHmcyuGj1o1Nza",
] as const;
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export function balanceUnits(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const fraction = (amount % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${amount / base}${fraction ? "." + fraction : ""}`;
}
export function tokenBalance(
  result: unknown,
  wallet: string,
  mint: string,
): string {
  const r = result as {
    value?: {
      account?: {
        owner?: string;
        data?: {
          parsed?: {
            type?: string;
            info?: {
              owner?: string;
              mint?: string;
              state?: string;
              tokenAmount?: { amount?: string; decimals?: number };
            };
          };
        };
      };
    }[];
  };
  if (!Array.isArray(r?.value)) throw Error("BALANCE_INVALID");
  let total = 0n;
  for (const row of r.value) {
    const info = row.account?.data?.parsed?.info;
    const a = info?.tokenAmount;
    if (
      row.account?.owner !== TOKEN ||
      row.account.data?.parsed?.type !== "account" ||
      info?.owner !== wallet ||
      info.mint !== mint ||
      info.state !== "initialized" ||
      a?.decimals !== 6 ||
      typeof a.amount !== "string" ||
      !/^\d{1,20}$/.test(a.amount) ||
      BigInt(a.amount) > 18446744073709551615n
    )
      throw Error("BALANCE_INVALID");
    total += BigInt(a.amount);
  }
  return balanceUnits(total, 6);
}
