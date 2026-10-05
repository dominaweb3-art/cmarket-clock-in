/** Source-reviewed first-pilot policy. Never accept account templates from the
 * same server that supplies a transaction. The release has no approved policy. */
import type { OwnerInstructionReview } from "./owner-transaction-review.ts";
import {
  validateResolutionReview,
  type MinimumResolutionReview,
} from "./minimum-resolution.ts";
export type MoneyAction =
  "deposit" | "issue_shares" | "request_redemption" | "claim" | "renew_plan";
export type OwnerPolicy = Readonly<{
  wallet: Uint8Array;
  program: Uint8Array;
  accounts: Readonly<Record<string, Uint8Array>>;
}>;
// Exact current reviewed IDL ordering/privileges. '*' is writable, '+' signer.
const methods = {
  resolve_settlement_minimums: {
    d: [113, 229, 173, 91, 8, 189, 58, 220],
    a: ["owner+", "config", "plan*"],
  },
  renew_settlement_plan: {
    d: [184, 149, 8, 59, 254, 68, 86, 19],
    a: ["owner+", "config", "plan*"],
  },
  create_deposit_intent: {
    d: [172, 123, 241, 167, 192, 199, 8, 138],
    a: ["owner*+", "config*", "intent*", "system_program"],
  },
  deposit_usdc: {
    d: [184, 148, 250, 169, 224, 213, 34, 126],
    a: [
      "owner*+",
      "config",
      "intent*",
      "owner_usdc*",
      "vault_usdc*",
      "usdc_mint",
      "vault_btc",
      "vault_eth",
      "vault_wsol",
      "token_program",
    ],
  },
  issue_initial_shares: {
    d: [58, 167, 56, 125, 211, 251, 94, 235],
    a: [
      "owner*+",
      "config*",
      "intent*",
      "vault_authority",
      "share_mint*",
      "vault_usdc",
      "vault_btc",
      "vault_eth",
      "vault_wsol",
      "owner_shares*",
      "share_token_program",
    ],
  },
  create_redemption_intent: {
    d: [40, 189, 78, 203, 20, 104, 143, 111],
    a: [
      "owner*+",
      "config*",
      "deposit",
      "intent*",
      "owner_shares",
      "vault_btc",
      "vault_eth",
      "vault_wsol",
      "vault_usdc",
      "system_program",
    ],
  },
  lock_shares_for_redemption: {
    d: [254, 55, 118, 85, 48, 134, 116, 150],
    a: [
      "owner*+",
      "config",
      "intent*",
      "owner_shares*",
      "share_mint*",
      "share_token_program",
    ],
  },
  claim_usdc: {
    d: [43, 131, 9, 102, 229, 140, 91, 141],
    a: [
      "owner*+",
      "config*",
      "intent*",
      "vault_authority",
      "vault_usdc*",
      "owner_usdc*",
      "usdc_mint",
      "share_mint*",
      "owner_shares*",
      "token_program",
      "share_token_program",
    ],
  },
} as const;
export function ownerTemplates(
  policy: OwnerPolicy,
  action: MoneyAction,
  expiry: number,
  now: number,
  renewal?: Readonly<{
    chainRevision: string;
    planDirection: "buy" | "sell";
    minimumResolution?: MinimumResolutionReview;
  }>,
): OwnerInstructionReview[] {
  if (
    !Number.isSafeInteger(expiry) ||
    !Number.isSafeInteger(now) ||
    expiry <= now ||
    expiry > now + 3600 ||
    policy.wallet.length !== 32 ||
    policy.program.length !== 32
  )
    throw Error("C3_OWNER_POLICY_INVALID");
  const names: (keyof typeof methods)[] =
    action === "deposit"
      ? ["create_deposit_intent", "deposit_usdc"]
      : action === "request_redemption"
        ? ["create_redemption_intent", "lock_shares_for_redemption"]
        : [
            action === "issue_shares"
              ? "issue_initial_shares"
              : action === "renew_plan"
                ? renewal?.minimumResolution
                  ? "resolve_settlement_minimums"
                  : "renew_settlement_plan"
                : "claim_usdc",
          ];
  const prefix =
    action === "request_redemption" || action === "claim"
      ? "redemption"
      : "deposit";
  const equal = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((v, i) => v === b[i]);
  const instructions = names.map((name) => {
    const def = methods[name];
    const args = new Uint8Array(32),
      view = new DataView(args.buffer);
    view.setBigUint64(0, 1n, true);
    view.setBigUint64(8, 1_000_000n, true);
    view.setBigUint64(16, 1n, true);
    view.setBigInt64(24, BigInt(expiry), true);
    const renewArgs = new Uint8Array(renewal?.minimumResolution ? 112 : 16);
    if (action === "renew_plan") {
      if (
        !renewal ||
        !/^(0|[1-9][0-9]{0,19})$/.test(renewal.chainRevision) ||
        BigInt(renewal.chainRevision) >= (1n << 64n) - 1n ||
        !["buy", "sell"].includes(renewal.planDirection)
      )
        throw Error("C3_OWNER_RENEWAL_REVIEW_REQUIRED");
      new DataView(renewArgs.buffer).setBigUint64(
        0,
        BigInt(renewal.chainRevision),
        true,
      );
      new DataView(renewArgs.buffer).setBigInt64(8, BigInt(expiry), true);
      if (renewal.minimumResolution) {
        const r = renewal.minimumResolution;
        validateResolutionReview(r, now);
        const output =
          renewal.planDirection === "sell"
            ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            : [
                "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
                "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
                "So11111111111111111111111111111111111111112",
              ][r.leg];
        if (r.outputMint !== output)
          throw Error("C3_OWNER_ECONOMIC_ASSET_CHANGED");
        const unhex = (s: string) =>
          new Uint8Array(s.match(/../g)!.map((v) => parseInt(v, 16)));
        renewArgs.set(unhex(r.planHash), 16);
        r.minima.forEach((v, n) =>
          new DataView(renewArgs.buffer).setBigUint64(
            48 + 8 * n,
            BigInt(v),
            true,
          ),
        );
        renewArgs.set(unhex(r.evidenceHash), 72);
        new DataView(renewArgs.buffer).setBigInt64(
          104,
          BigInt(r.quoteExpiresAt),
          true,
        );
      }
    }
    return {
      program: new Uint8Array(policy.program),
      data: new Uint8Array([
        ...def.d,
        ...(name.startsWith("create_")
          ? args
          : name === "renew_settlement_plan" ||
              name === "resolve_settlement_minimums"
            ? renewArgs
            : []),
      ]),
      accounts: def.a.map((field) => {
        const name = field.replace(/[+*]/g, "");
        const key =
          name === "owner"
            ? policy.wallet
            : policy.accounts[
                name === "intent"
                  ? prefix + "_intent"
                  : name === "plan"
                    ? renewal?.planDirection === "sell"
                      ? "redemption_plan"
                      : "deposit_plan"
                    : name
              ];
        if (!key || key.length !== 32)
          throw Error("C3_OWNER_POLICY_ACCOUNT_MISSING");
        return {
          key: new Uint8Array(key),
          writable: field.includes("*"),
          signer: field.includes("+"),
        };
      }),
    };
  });
  // Solana v0 privileges are unioned over all outer instructions.
  for (const ix of instructions)
    for (const a of ix.accounts) {
      a.writable =
        equal(a.key, policy.wallet) ||
        instructions.some((i) =>
          i.accounts.some((b) => equal(a.key, b.key) && b.writable),
        );
      a.signer = equal(a.key, policy.wallet);
    }
  return instructions;
}
