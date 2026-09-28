import { BorshCoder } from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { AccountMeta } from "@solana/web3.js";

const U64_MAX = (1n << 64n) - 1n;
const vaultSeed = Buffer.from("c3-vault-v1");
const authoritySeed = Buffer.from("c3-authority-v1");

/** Monetary inputs are decimal strings, never JS numbers or exponent notation. */
export function toBaseUnits(value: string, decimals = 6): bigint {
  if (
    typeof value !== "string" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  ) {
    throw new TypeError("A decimal string and valid decimals are required");
  }
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new TypeError("Invalid decimal amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals)
    throw new RangeError("Too many decimal places");
  const amount =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (amount > U64_MAX) throw new RangeError("Amount exceeds u64");
  return amount;
}

export type C3InstructionName =
  | "initialize_vault"
  | "set_keeper"
  | "pause"
  | "unpause"
  | "create_deposit_intent"
  | "deposit_usdc"
  | "record_deposit_settlement"
  | "issue_initial_shares"
  | "create_redemption_intent"
  | "lock_or_burn_shares"
  | "record_redemption_settlement"
  | "claim_usdc"
  | "expire_intent"
  | "close_completed_intent";

/** Public-data-only client: never stores a private key, signs, sends, or retries. */
export class C3PilotClient {
  readonly coder: BorshCoder;
  readonly programId: PublicKey;
  readonly idl: Idl;
  constructor(idl: Idl, programId: PublicKey) {
    this.idl = idl;
    this.coder = new BorshCoder(idl);
    this.programId = programId;
    if (idl.address && idl.address !== programId.toBase58())
      throw new Error("IDL program address mismatch");
  }

  vaultPda(): PublicKey {
    return PublicKey.findProgramAddressSync([vaultSeed], this.programId)[0];
  }
  authorityPda(): PublicKey {
    return PublicKey.findProgramAddressSync([authoritySeed], this.programId)[0];
  }
  depositIntentPda(owner: PublicKey, nonce: bigint): PublicKey {
    return this.intentPda("deposit", owner, nonce);
  }
  redemptionIntentPda(owner: PublicKey, nonce: bigint): PublicKey {
    return this.intentPda("redemption", owner, nonce);
  }
  private intentPda(
    prefix: string,
    owner: PublicKey,
    nonce: bigint,
  ): PublicKey {
    if (nonce < 0n || nonce > U64_MAX) throw new RangeError("Invalid nonce");
    const n = Buffer.alloc(8);
    n.writeBigUInt64LE(nonce);
    return PublicKey.findProgramAddressSync(
      [Buffer.from(prefix), this.vaultPda().toBuffer(), owner.toBuffer(), n],
      this.programId,
    )[0];
  }

  instruction(
    name: C3InstructionName,
    args: Record<string, unknown>,
    accounts: Record<string, PublicKey>,
  ): TransactionInstruction {
    const ix = this.idl.instructions.find(
      (entry) => entry.name === name || entry.name === snakeToCamel(name),
    );
    if (!ix) throw new Error(`Instruction not present in IDL: ${name}`);
    if (accounts.config && !accounts.config.equals(this.vaultPda()))
      throw new Error("Config PDA substitution");
    if (
      accounts.vaultAuthority &&
      !accounts.vaultAuthority.equals(this.authorityPda())
    )
      throw new Error("Authority PDA substitution");
    const keys: AccountMeta[] = [];
    const walk = (items: typeof ix.accounts, namespace = ""): void => {
      for (const item of items) {
        const full = namespace ? `${namespace}.${item.name}` : item.name;
        if ("accounts" in item) {
          walk(item.accounts, full);
          continue;
        }
        const key = accounts[full] ?? accounts[item.name];
        if (!key) throw new Error(`Missing account: ${full}`);
        if (
          "address" in item &&
          item.address &&
          key.toBase58() !== item.address
        )
          throw new Error(`Program substitution: ${full}`);
        keys.push({
          pubkey: key,
          isSigner: item.signer === true,
          isWritable: item.writable === true,
        });
      }
    };
    walk(ix.accounts);
    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data: this.coder.instruction.encode(ix.name, args),
    });
  }

  unsignedTransaction(instructions: TransactionInstruction[]): Transaction {
    if (instructions.length === 0)
      throw new Error("At least one instruction is required");
    return new Transaction().add(...instructions);
  }

  decodeVault(data: Buffer): unknown {
    return this.coder.accounts.decode("VaultConfig", data);
  }
  decodeDeposit(data: Buffer): unknown {
    return this.coder.accounts.decode("DepositIntent", data);
  }
  decodeRedemption(data: Buffer): unknown {
    return this.coder.accounts.decode("RedemptionIntent", data);
  }
  decodeEvents(logs: string[]): unknown[] {
    // EventParser is read-only; no wallet or RPC object is needed.
    const events: unknown[] = [];
    for (const line of logs) {
      if (!line.startsWith("Program data: ")) continue;
      const decoded = this.coder.events.decode(
        line.slice("Program data: ".length),
      );
      if (decoded) events.push(decoded);
    }
    return events;
  }
}

function snakeToCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
