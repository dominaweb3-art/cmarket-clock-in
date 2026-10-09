/** SHARED. Deterministic, per-wallet Devnet provisioning instructions only.
 * No generated private mint keys, customer keys, Mainnet assets or price claims.
 * Execution must use the service journal and finalized account verification. */
import { createHash } from "node:crypto";
import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { EVALUATION } from "./evaluation-scope.ts";
import {
  EvaluationClient,
  EVAL_TOKEN,
  EVAL_SHARES,
  evaluationAta,
} from "./evaluation-client.ts";

export const EVALUATION_MINT_AUTHORITY =
  "FUfbAJQMsm6fvmdfduNLBDDZajjZTSmjhaKq6Eew3tZq";
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const digest = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
const seed = (v: string) =>
  digest("evaluation-mint-v1:" + v)
    .toString("hex")
    .slice(0, 32);
const u64 = (v: bigint) => {
  if (typeof v !== "bigint" || v < 0n || v > (1n << 64n) - 1n)
    throw Error("EVAL_PROVISION_U64");
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
};
export async function evaluationAssetMints() {
  const authority = new PublicKey(EVALUATION_MINT_AUTHORITY);
  return Promise.all(
    ["usdc", "btc", "eth", "sol"].map((name) =>
      PublicKey.createWithSeed(authority, seed("test:" + name), EVAL_TOKEN),
    ),
  );
}
export async function evaluationShareMint(wallet: string) {
  const owner = new PublicKey(wallet);
  if (!PublicKey.isOnCurve(owner.toBytes()))
    throw Error("EVAL_PROVISION_OWNER");
  return PublicKey.createWithSeed(
    new PublicKey(EVALUATION.governance),
    seed("shares:" + wallet),
    EVAL_SHARES,
  );
}
export function evaluationCreateMint(
  kind: "usdc" | "btc" | "eth" | "sol" | "shares",
  address: PublicKey,
  wallet: string | undefined,
  mintAuthority: PublicKey,
  rent: number,
) {
  const shares = kind === "shares";
  if (shares !== !!wallet || !Number.isSafeInteger(rent) || rent <= 0)
    throw Error("EVAL_PROVISION_MINT_CONFIG");
  const payer = new PublicKey(
    shares ? EVALUATION.governance : EVALUATION_MINT_AUTHORITY,
  );
  const program = shares ? EVAL_SHARES : EVAL_TOKEN;
  const name = seed(shares ? "shares:" + wallet : "test:" + kind);
  const expected = digest(
    Buffer.concat([payer.toBuffer(), Buffer.from(name), program.toBuffer()]),
  );
  if (!address.equals(new PublicKey(expected)))
    throw Error("EVAL_PROVISION_MINT_ADDRESS");
  const data = Buffer.alloc(67);
  data[0] = 20; // Official SPL InitializeMint2, no rent sysvar account.
  data[1] = 6;
  mintAuthority.toBuffer().copy(data, 2);
  if (shares) {
    data[34] = 1;
    mintAuthority.toBuffer().copy(data, 35);
  }
  return [
    SystemProgram.createAccountWithSeed({
      fromPubkey: payer,
      newAccountPubkey: address,
      basePubkey: payer,
      seed: name,
      lamports: rent,
      space: shares ? 170 : 82,
      programId: program,
    }),
    ...(shares
      ? [
          new TransactionInstruction({
            programId: program,
            keys: [{ pubkey: address, isSigner: false, isWritable: true }],
            data: Buffer.from([32]),
          }),
        ]
      : []),
    new TransactionInstruction({
      programId: program,
      keys: [{ pubkey: address, isSigner: false, isWritable: true }],
      data,
    }),
  ];
}
export function evaluationCreateAta(
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  token = EVAL_TOKEN,
) {
  return new TransactionInstruction({
    programId: ATA,
    data: Buffer.from([1]),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      {
        pubkey: evaluationAta(mint, owner, token),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: token, isSigner: false, isWritable: false },
    ],
  });
}
export function evaluationMintTestTokens(
  mint: PublicKey,
  recipient: PublicKey,
  amount: bigint,
) {
  // Inputs to this internal builder must come from the fixed asset config and
  // verified wallet proof. HTTP clients never provide recipient/mint/amount.
  if (amount <= 0n || amount > 100_000_000n)
    throw Error("EVAL_PROVISION_MINT_LIMIT");
  return new TransactionInstruction({
    programId: EVAL_TOKEN,
    data: Buffer.concat([Buffer.from([7]), u64(amount)]),
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      {
        pubkey: evaluationAta(mint, recipient),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: new PublicKey(EVALUATION_MINT_AUTHORITY),
        isSigner: true,
        isWritable: false,
      },
    ],
  });
}
export function evaluationInitializeWallet(client: EvaluationClient) {
  return client.instruction(
    "initialize_vault",
    {
      keeper: new PublicKey(EVALUATION.keeper),
      config_version: new BN(1),
      weights: [4000, 3000, 3000],
      max_tvl: new BN(1_000_000),
    },
    {
      ...client.accounts(client.intent("deposit")),
      payer: new PublicKey(EVALUATION.governance),
      governance: new PublicKey(EVALUATION.governance),
      emergency: new PublicKey(EVALUATION.governance),
      btc_mint: new PublicKey(client.config.btcMint),
      eth_mint: new PublicKey(client.config.ethMint),
      wsol_mint: new PublicKey(client.config.solMint),
    },
  );
}
export function compileEvaluationProvisioning(
  instructions: readonly TransactionInstruction[],
  signer: string,
  blockhash: string,
) {
  if (
    ![EVALUATION.governance, EVALUATION_MINT_AUTHORITY].includes(signer) ||
    !instructions.length ||
    instructions.length > 12
  )
    throw Error("EVAL_PROVISION_SIGNER");
  const allowed = [
    SystemProgram.programId,
    EVAL_TOKEN,
    EVAL_SHARES,
    ATA,
    new PublicKey(EVALUATION.program),
  ];
  if (instructions.some((i) => !allowed.some((k) => k.equals(i.programId))))
    throw Error("EVAL_PROVISION_PROGRAM");
  const message = new TransactionMessage({
    payerKey: new PublicKey(signer),
    recentBlockhash: blockhash,
    instructions: [...instructions],
  }).compileToV0Message();
  if (
    message.header.numRequiredSignatures !== 1 ||
    message.addressTableLookups.length
  )
    throw Error("EVAL_PROVISION_SIGNERS");
  let packet: Uint8Array;
  try {
    packet = new VersionedTransaction(message).serialize();
  } catch {
    throw Error("EVAL_PROVISION_SIZE");
  }
  if (packet.length > 1232) throw Error("EVAL_PROVISION_SIZE");
  return {
    packet: Buffer.from(packet),
    messageHash: digest(message.serialize()),
  };
}
