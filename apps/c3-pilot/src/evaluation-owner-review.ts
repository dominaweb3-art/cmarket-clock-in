/** CLOCKIN_ONLY. Independent, fixed Devnet owner packet review; no server
 * supplied account templates, mutable program ID, wallet callback or storage. */
import { sha256 } from "@noble/hashes/sha2.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  base58ToUint8Array,
  base64ToUint8Array,
} from "@solana-mobile/mobile-wallet-adapter-protocol/encoding";
import { EVALUATION_PROGRAM } from "./evaluation-protocol.ts";
import {
  inspectOwnerTransaction,
  type OwnerInstructionReview,
} from "./owner-transaction-review.ts";
export type EvaluationMoneyAction =
  "deposit" | "issue_shares" | "request_redemption" | "claim" | "renew_plan";
type RenewalReview = Readonly<{ direction: 1 | 2; revision: bigint }>;
const encoder = new TextEncoder();
const text = (s: string) => encoder.encode(s);
const join = (...parts: Uint8Array[]) => {
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
};
const key = (s: string) => {
  const k = base58ToUint8Array(s);
  if (k.length !== 32) throw Error("EVAL_OWNER_KEY");
  return k;
};
const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
function pda(seeds: Uint8Array[], program: Uint8Array) {
  if (seeds.length > 15 || seeds.some((s) => s.length > 32))
    throw Error("EVAL_OWNER_SEED");
  for (let bump = 255; bump >= 0; bump--) {
    const address = sha256(
      join(
        ...seeds,
        Uint8Array.of(bump),
        program,
        text("ProgramDerivedAddress"),
      ),
    );
    let onCurve = false;
    try {
      ed25519.Point.fromBytes(address);
      onCurve = true;
    } catch {}
    if (!onCurve) return address;
  }
  throw Error("EVAL_OWNER_PDA");
}
const u64 = (v: bigint) => {
  if (v < 0n || v >= 1n << 64n) throw Error("EVAL_OWNER_U64");
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};
const hex = (b: Uint8Array) =>
  Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
export function evaluationOwnerAccounts(wallet: string) {
  const owner = key(wallet),
    program = key(EVALUATION_PROGRAM),
    token = key("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    shareToken = key("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    ata = key("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  ed25519.Point.fromBytes(owner);
  const mintAuthority = key("FUfbAJQMsm6fvmdfduNLBDDZajjZTSmjhaKq6Eew3tZq"),
    governance = key("6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC");
  const seed = (s: string) =>
    text(hex(sha256(text("evaluation-mint-v1:" + s))).slice(0, 32));
  const mints = ["usdc", "btc", "eth", "sol"].map((n) =>
    sha256(join(mintAuthority, seed("test:" + n), token)),
  );
  const share = sha256(join(governance, seed("shares:" + wallet), shareToken));
  const vault = pda([sha256(join(text("c3-vault-v1"), owner))], program),
    authority = pda([sha256(join(text("c3-authority-v1"), owner))], program);
  const intent = (s: string) => pda([text(s), vault, owner, u64(1n)], program);
  const associated = (mint: Uint8Array, o: Uint8Array, t = token) =>
    pda([o, t, mint], ata);
  return {
    owner,
    program,
    config: vault,
    vault_authority: authority,
    deposit: intent("deposit"),
    redemption: intent("redemption"),
    usdc_mint: mints[0]!,
    share_mint: share,
    owner_usdc: associated(mints[0]!, owner),
    owner_shares: associated(share, owner, shareToken),
    vault_usdc: associated(mints[0]!, authority),
    vault_btc: associated(mints[1]!, authority),
    vault_eth: associated(mints[2]!, authority),
    vault_wsol: associated(mints[3]!, authority),
    token_program: token,
    share_token_program: shareToken,
    system_program: key("11111111111111111111111111111111"),
  };
}
// Exact IDL ordering. '+' signer; '*' writable. Checked against the Borsh
// compiler in regression tests, including privilege union across instructions.
const definitions = {
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
  renew_settlement_plan: {
    d: [184, 149, 8, 59, 254, 68, 86, 19],
    a: ["owner+", "config", "plan*"],
  },
} as const;
export function evaluationOwnerTemplates(
  wallet: string,
  action: EvaluationMoneyAction,
  chainTime: bigint,
  renewal?: RenewalReview,
): OwnerInstructionReview[] {
  const accounts = evaluationOwnerAccounts(wallet);
  const methods: (keyof typeof definitions)[] =
    action === "deposit"
      ? ["create_deposit_intent", "deposit_usdc"]
      : action === "request_redemption"
        ? ["create_redemption_intent", "lock_shares_for_redemption"]
        : action === "issue_shares"
          ? ["issue_initial_shares"]
          : action === "claim"
            ? ["claim_usdc"]
            : action === "renew_plan"
              ? ["renew_settlement_plan"]
              : [];
  if (!methods.length) throw Error("EVAL_OWNER_ACTION");
  const args = join(u64(1n), u64(1_000_000n), u64(1n), u64(chainTime + 300n));
  const intent =
    action === "request_redemption" || action === "claim"
      ? accounts.redemption
      : accounts.deposit;
  if (
    action === "renew_plan" &&
    (!renewal ||
      ![1, 2].includes(renewal.direction) ||
      renewal.revision <= 0n ||
      renewal.revision >= (1n << 64n) - 1n)
  )
    throw Error("EVAL_OWNER_RENEWAL_CONTEXT");
  const plan = renewal
    ? pda(
        [
          text("c3-plan-v1"),
          renewal.direction === 1 ? accounts.deposit : accounts.redemption,
        ],
        accounts.program,
      )
    : undefined;
  const result = methods.map((name) => ({
    program: accounts.program,
    data: join(
      Uint8Array.from(definitions[name].d),
      ...(name.startsWith("create_")
        ? [args]
        : name === "renew_settlement_plan"
          ? [join(u64(renewal!.revision), u64(chainTime + 110n))]
          : []),
    ),
    accounts: definitions[name].a.map((field) => {
      const n = field.replace(/[+*]/g, "");
      const k =
        n === "intent"
          ? intent
          : n === "plan"
            ? plan
            : accounts[n as keyof typeof accounts];
      if (!k) throw Error("EVAL_OWNER_ACCOUNT");
      return {
        key: k,
        signer: field.includes("+"),
        writable: field.includes("*"),
      };
    }),
  }));
  for (const i of result)
    for (const a of i.accounts) {
      a.writable =
        equal(a.key, accounts.owner) ||
        result.some((j) =>
          j.accounts.some((b) => equal(a.key, b.key) && b.writable),
        );
      a.signer = equal(a.key, accounts.owner);
    }
  return result;
}
export function reviewEvaluationOwnerPacket(
  result: Readonly<Record<string, unknown>>,
  wallet: string,
  action: EvaluationMoneyAction,
  now = Date.now(),
) {
  const deadline = Date.parse(String(result.expiresAt)),
    time = String(result.chainTime);
  if (
    result.action !== action ||
    result.cluster !== "solana:devnet" ||
    result.simulatedAssets !== true ||
    !/^[0-9]{1,12}$/.test(time) ||
    Math.abs(Number(time) * 1000 - now) > 60000 ||
    !Number.isFinite(deadline) ||
    deadline <= now ||
    deadline - now > 46000 ||
    typeof result.packet !== "string" ||
    result.packet.length > 1644 ||
    !/^[a-f0-9]{64}$/.test(String(result.messageHash)) ||
    !/^[a-f0-9-]{36}$/.test(String(result.requestId))
  )
    throw Error("EVAL_OWNER_REVIEW_SCOPE");
  let renewal: RenewalReview | undefined;
  if (action === "renew_plan") {
    const r = result.renewal as Record<string, unknown> | undefined;
    if (
      !r ||
      ![1, 2].includes(Number(r.direction)) ||
      typeof r.revision !== "string" ||
      !/^[1-9][0-9]{0,19}$/.test(r.revision) ||
      r.expiry !== String(BigInt(time) + 110n)
    )
      throw Error("EVAL_OWNER_RENEWAL_CONTEXT");
    renewal = { direction: r.direction as 1 | 2, revision: BigInt(r.revision) };
  }
  const packet = base64ToUint8Array(result.packet),
    templates = evaluationOwnerTemplates(wallet, action, BigInt(time), renewal),
    review = inspectOwnerTransaction(packet, key(wallet), templates);
  if (
    hex(sha256(review.message)) !== result.messageHash ||
    !equal(key(String(result.vault)), evaluationOwnerAccounts(wallet).config)
  )
    throw Error("EVAL_OWNER_REVIEW_BINDING");
  return { packet, templates, review, expiresAt: deadline };
}
export function verifyEvaluationWalletPacket(
  signed: Uint8Array,
  prepared: ReturnType<typeof reviewEvaluationOwnerPacket>,
  wallet: string,
) {
  const review = inspectOwnerTransaction(
    signed,
    key(wallet),
    prepared.templates,
    true,
  );
  if (
    !equal(review.message, prepared.review.message) ||
    !ed25519.verify(review.signature, review.message, key(wallet))
  )
    throw Error("EVAL_OWNER_WALLET_CHANGED");
  return signed;
}
