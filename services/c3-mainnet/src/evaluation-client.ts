/** Evaluation-only public-data compiler. No production policy override, keys,
 * signing, broadcast, quote simulation, or runtime-selected program IDs. */
import { BorshCoder, BN, type Idl } from "@coral-xyz/anchor";
import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { EVALUATION, evaluationPdas } from "./evaluation-scope.ts";

export const EVAL_TOKEN = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const EVAL_SHARES = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export function evaluationAta(
  mint: PublicKey,
  owner: PublicKey,
  token = EVAL_TOKEN,
) {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), token.toBuffer(), mint.toBuffer()],
    ATA,
  )[0];
}
export type EvaluationOwnerAction =
  "deposit" | "issue_shares" | "request_redemption" | "claim";
export type EvaluationConfig = Readonly<{
  wallet: string;
  shareMint: string;
  usdcMint: string;
  btcMint: string;
  ethMint: string;
  solMint: string;
  version: bigint;
}>;
const integer = (n: bigint) => {
  if (typeof n !== "bigint" || n < 0n || n > (1n << 64n) - 1n)
    throw Error("EVAL_U64");
  return new BN(n.toString());
};

export class EvaluationClient {
  readonly coder: BorshCoder;
  readonly program = new PublicKey(EVALUATION.program);
  readonly owner: PublicKey;
  readonly vault: PublicKey;
  readonly authority: PublicKey;
  readonly idl: Idl;
  readonly config: EvaluationConfig;
  constructor(idl: Idl, config: EvaluationConfig) {
    this.idl = idl;
    this.config = Object.freeze({ ...config });
    if (idl.address !== EVALUATION.program) throw Error("EVAL_IDL_PROGRAM");
    if (config.version !== 1n) throw Error("EVAL_CONFIG_VERSION");
    this.owner = new PublicKey(config.wallet);
    ({ vault: this.vault, authority: this.authority } = evaluationPdas(
      config.wallet,
    ));
    const mints = [
      config.shareMint,
      config.usdcMint,
      config.btcMint,
      config.ethMint,
      config.solMint,
    ];
    if (new Set(mints).size !== 5) throw Error("EVAL_DISTINCT_MINTS");
    for (const mint of mints) new PublicKey(mint);
    this.coder = new BorshCoder(idl);
  }
  intent(direction: "deposit" | "redemption", nonce = 1n) {
    integer(nonce);
    const n = Buffer.alloc(8);
    n.writeBigUInt64LE(nonce);
    return PublicKey.findProgramAddressSync(
      [Buffer.from(direction), this.vault.toBuffer(), this.owner.toBuffer(), n],
      this.program,
    )[0];
  }
  pda(seed: string, key: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(seed), key.toBuffer()],
      this.program,
    )[0];
  }
  /** All account identities are derived from server-verified config, never body fields. */
  accounts(intent: PublicKey): Record<string, PublicKey> {
    const usdc = new PublicKey(this.config.usdcMint),
      btc = new PublicKey(this.config.btcMint),
      eth = new PublicKey(this.config.ethMint),
      sol = new PublicKey(this.config.solMint),
      share = new PublicKey(this.config.shareMint);
    return {
      owner: this.owner,
      config: this.vault,
      vault_authority: this.authority,
      intent,
      deposit: this.intent("deposit"),
      usdc_mint: usdc,
      share_mint: share,
      owner_usdc: evaluationAta(usdc, this.owner),
      owner_shares: evaluationAta(share, this.owner, EVAL_SHARES),
      vault_usdc: evaluationAta(usdc, this.authority),
      vault_btc: evaluationAta(btc, this.authority),
      vault_eth: evaluationAta(eth, this.authority),
      vault_wsol: evaluationAta(sol, this.authority),
      token_program: EVAL_TOKEN,
      share_token_program: EVAL_SHARES,
      system_program: SystemProgram.programId,
    };
  }
  instruction(
    name: string,
    args: Record<string, unknown>,
    accounts: Record<string, PublicKey>,
  ) {
    const definition = this.idl.instructions.find((i) => i.name === name);
    if (!definition) throw Error("EVAL_INSTRUCTION_UNAVAILABLE");
    // Borsh fixed arrays may otherwise encode an absent field as zero bytes.
    // Require the exact IDL argument names before any unsigned packet is built.
    if (
      Object.keys(args).length !== definition.args.length ||
      definition.args.some(
        (a) => !Object.hasOwn(args, a.name) || args[a.name] == null,
      )
    )
      throw Error("EVAL_INSTRUCTION_ARGUMENTS");
    const keys = definition.accounts.map((item) => {
      if ("accounts" in item) throw Error("EVAL_NESTED_ACCOUNT_UNREVIEWED");
      const pubkey = accounts[item.name];
      if (!pubkey || (item.address && item.address !== pubkey.toBase58()))
        throw Error("EVAL_ACCOUNT_IDENTITY");
      if (
        (item.name === "config" && !pubkey.equals(this.vault)) ||
        (item.name === "vault_authority" && !pubkey.equals(this.authority)) ||
        (item.name === "owner" && !pubkey.equals(this.owner))
      )
        throw Error("EVAL_ACCOUNT_SCOPE");
      return {
        pubkey,
        isSigner: item.signer === true,
        isWritable: item.writable === true,
      };
    });
    return new TransactionInstruction({
      programId: this.program,
      keys,
      data: this.coder.instruction.encode(name, args),
    });
  }
  ownerInstructions(action: EvaluationOwnerAction, chainTime: bigint) {
    integer(chainTime);
    const expiry = integer(chainTime + 300n),
      deposit = this.accounts(this.intent("deposit")),
      redemption = this.accounts(this.intent("redemption"));
    switch (action) {
      case "deposit":
        return [
          this.instruction(
            "create_deposit_intent",
            {
              nonce: integer(1n),
              amount: integer(EVALUATION.amount),
              config_version: integer(1n),
              expires_at: expiry,
            },
            deposit,
          ),
          this.instruction("deposit_usdc", {}, deposit),
        ];
      case "issue_shares":
        return [this.instruction("issue_initial_shares", {}, deposit)];
      case "request_redemption":
        return [
          this.instruction(
            "create_redemption_intent",
            {
              nonce: integer(1n),
              shares: integer(EVALUATION.amount),
              config_version: integer(1n),
              expires_at: expiry,
            },
            redemption,
          ),
          this.instruction("lock_shares_for_redemption", {}, redemption),
        ];
      case "claim":
        return [this.instruction("claim_usdc", {}, redemption)];
      default:
        throw Error("EVAL_OWNER_ACTION");
    }
  }
  /** Signature placeholders only. Exact message/hash can be bound in PG before MWA. */
  compileOwner(
    action: EvaluationOwnerAction,
    chainTime: bigint,
    blockhash: string,
    lastValidBlockHeight: number,
  ) {
    if (
      !Number.isSafeInteger(lastValidBlockHeight) ||
      lastValidBlockHeight <= 0
    )
      throw Error("EVAL_BLOCK_HEIGHT");
    new PublicKey(blockhash);
    const instructions = this.ownerInstructions(action, chainTime);
    const message = new TransactionMessage({
      payerKey: this.owner,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    if (
      message.header.numRequiredSignatures !== 1 ||
      !message.staticAccountKeys[0]?.equals(this.owner) ||
      message.addressTableLookups.length !== 0
    )
      throw Error("EVAL_OWNER_SIGNERS");
    const packet = new VersionedTransaction(message).serialize();
    if (packet.length > 1232) throw Error("EVAL_TRANSACTION_TOO_LARGE");
    return {
      packet: Buffer.from(packet),
      messageHash: createHash("sha256").update(message.serialize()).digest(),
      blockhash,
      lastValidBlockHeight,
      instructions,
    };
  }
}
