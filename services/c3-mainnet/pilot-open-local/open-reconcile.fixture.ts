/** Real serialized v0/signature shape, synthetic RPC effects. Not chain execution. */
import { createHash } from "node:crypto";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { C3_MAINNET as c } from "../src/constants.ts";
import { encodeBase58 } from "../src/solana.ts";
import {
  VAULT_AUTHORITY,
  VAULT_PROGRAM,
} from "./jupiter-vault-cpi-inspection.ts";
import { type ExecutionExpectation } from "./open-reconcile.ts";
import type { StoredQuoteContext } from "./open-quote.ts";
import { encodeQuoteSealV1, quoteIdForNonce } from "../src/quote-seal.ts";
import {
  quoteAltContentsHash,
  type QuoteAltAccount,
} from "../src/quote-alt.ts";
const whirl = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest();
export const addr = (i: number) => new PublicKey(Buffer.alloc(32, i));
export function fixture(alt?: QuoteAltAccount) {
  const keeper = Keypair.generate(),
    source = addr(3),
    destination = addr(4),
    pool = addr(5),
    pi = addr(6),
    po = addr(7),
    unrelated = addr(8);
  const nonce = hash(keeper.publicKey.toBuffer());
  const pda = (...seeds: Buffer[]) =>
    PublicKey.findProgramAddressSync(seeds, VAULT_PROGRAM)[0];
  const vault = pda(Buffer.from("c3-vault-v1"));
  const context: StoredQuoteContext = {
    keeper: keeper.publicKey.toBase58(),
    governance: addr(25).toBase58(),
    policy: pda(Buffer.from("c3-quote-policy-v1"), vault.toBuffer()).toBase58(),
    registry: pda(Buffer.from("c3-route-reg-v1"), vault.toBuffer()).toBase58(),
    plan: pda(
      Buffer.from("c3-plan-v1"),
      keeper.publicKey.toBuffer(),
    ).toBase58(),
    vault: vault.toBase58(),
    intent: keeper.publicKey.toBase58(),
    wallet: keeper.publicKey.toBase58(),
    configVersion: "1",
    registryRevision: "1",
    registryHash: hash(Buffer.from("registry")).toString("hex"),
    planRevision: "0",
    policyRevision: "1",
    reviewedPrograms: [c.jupiterProgram, whirl.toBase58()],
    genesisHash: addr(41).toBuffer().toString("hex"),
    leg: 0,
    direction: 1,
    inputMint: c.usdcMint,
    outputMint: c.cbBtcMint,
    source: source.toBase58(),
    destination: destination.toBase58(),
    inputAmount: "400000",
    routerProgram: c.jupiterProgram,
    authority: Buffer.alloc(32).toString("hex"),
    maxSlippageBps: 100,
    maxQuoteAgeSeconds: 30,
    planExpiresAt: "1050",
    configurationHash: hash(Buffer.from("synthetic config")).toString("hex"),
  };
  const route = Buffer.from(
    "bb64facc31c4af14801a060000000000dc0100000000000064000000000001000000110110270001",
    "hex",
  );
  const all = [
    VAULT_AUTHORITY,
    source,
    destination,
    new PublicKey(c.usdcMint),
    new PublicKey(c.cbBtcMint),
    new PublicKey(c.tokenProgram),
    new PublicKey(c.tokenProgram),
    destination,
    new PublicKey("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"),
    new PublicKey(c.jupiterProgram),
    whirl,
    new PublicKey(c.tokenProgram),
    VAULT_AUTHORITY,
    pool,
    source,
    pi,
    destination,
    po,
    addr(30),
    addr(31),
    unrelated,
    addr(32),
  ];
  const fixed = [
    keeper.publicKey,
    vault,
    new PublicKey(context.registry),
    new PublicKey(context.policy),
    new PublicKey(context.plan),
    pda(
      Buffer.from("c3-swap-auth-v1"),
      new PublicKey(context.plan).toBuffer(),
      nonce,
    ),
    pda(Buffer.from("c3-quote-receipt-v1"), quoteIdForNonce(nonce)),
    VAULT_AUTHORITY,
    source,
    destination,
    new PublicKey(c.jupiterProgram),
    new PublicKey(c.tokenProgram),
  ];
  const execution = Buffer.alloc(16 + route.length + all.length);
  hash(Buffer.from("global:execute_swap_leg")).subarray(0, 8).copy(execution);
  execution.writeUInt32LE(route.length, 8);
  route.copy(execution, 12);
  execution.writeUInt32LE(all.length, 12 + route.length);
  const msg = new TransactionMessage({
    payerKey: keeper.publicKey,
    recentBlockhash: addr(9).toBase58(),
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
      new TransactionInstruction({
        programId: VAULT_PROGRAM,
        keys: [
          ...fixed,
          ...all,
          ...(alt ? [new PublicKey(alt.address)] : []),
        ].map((pubkey) => ({
          pubkey,
          isSigner: pubkey.equals(keeper.publicKey),
          isWritable: ![VAULT_AUTHORITY, whirl].some((k) => k.equals(pubkey)),
        })),
        data: execution,
      }),
    ],
  }).compileToV0Message();
  const signed = new VersionedTransaction(msg);
  signed.sign([keeper]);
  const index = (k: PublicKey) =>
    msg.staticAccountKeys.findIndex((a) => a.equals(k));
  const bal = (k: PublicKey, mint: string, owner: string, n: string) => ({
    accountIndex: index(k),
    mint,
    owner,
    programId: c.tokenProgram,
    uiTokenAmount: {
      amount: n,
      decimals: mint === c.cbBtcMint ? 8 : 6,
      uiAmount: null,
      uiAmountString: n,
    },
  });
  const pre = [
    bal(source, c.usdcMint, VAULT_AUTHORITY.toBase58(), "1000000"),
    bal(destination, c.cbBtcMint, VAULT_AUTHORITY.toBase58(), "0"),
    bal(pi, c.usdcMint, pool.toBase58(), "10000000"),
    bal(po, c.cbBtcMint, pool.toBase58(), "100000"),
    bal(unrelated, c.portalEthMint, VAULT_AUTHORITY.toBase58(), "100"),
  ];
  const post = structuredClone(pre);
  post[0]!.uiTokenAmount.amount = "600000";
  post[1]!.uiTokenAmount.amount = "476";
  post[2]!.uiTokenAmount.amount = "10400000";
  post[3]!.uiTokenAmount.amount = "99524";
  const transfer = (
    src: PublicKey,
    dst: PublicKey,
    auth: PublicKey,
    n: bigint,
  ) => {
    const b = Buffer.alloc(9);
    b[0] = 3;
    b.writeBigUInt64LE(n, 1);
    return {
      programIdIndex: index(new PublicKey(c.tokenProgram)),
      accounts: [src, dst, auth].map(index),
      data: encodeBase58(b),
      stackHeight: 4,
    };
  };
  const inner = [
    {
      programIdIndex: index(new PublicKey(c.jupiterProgram)),
      accounts: all.map(index),
      data: encodeBase58(route),
      stackHeight: 2,
    },
    {
      programIdIndex: index(whirl),
      accounts: all.slice(11).map(index),
      data: (() => {
        const d = Buffer.alloc(42);
        hash(Buffer.from("global:swap")).subarray(0, 8).copy(d);
        d.writeBigUInt64LE(400000n, 8);
        d[40] = 1;
        d[41] = 1;
        return encodeBase58(d);
      })(),
      stackHeight: 3,
    },
    transfer(source, pi, VAULT_AUTHORITY, 400000n),
    transfer(po, destination, pool, 476n),
    {
      programIdIndex: index(new PublicKey(c.jupiterProgram)),
      accounts: [
        index(new PublicKey("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf")),
      ],
      data: (() => {
        const d = Buffer.alloc(132);
        Buffer.from("e445a52e51cb9a1d982f4eebc0606e6a", "hex").copy(d);
        d.writeUInt32LE(1, 16);
        new PublicKey(c.usdcMint).toBuffer().copy(d, 20);
        d.writeBigUInt64LE(400000n, 52);
        new PublicKey(c.cbBtcMint).toBuffer().copy(d, 60);
        d.writeBigUInt64LE(476n, 92);
        whirl.toBuffer().copy(d, 100);
        return encodeBase58(d);
      })(),
      stackHeight: 3,
    },
  ];
  const tx = {
    slot: 101,
    blockTime: 1001,
    version: 0,
    transaction: {
      message: msg,
      signatures: [encodeBase58(signed.signatures[0]!)],
    },
    meta: {
      err: null,
      fee: 5000,
      preBalances: msg.staticAccountKeys.map(() => 10000000),
      postBalances: msg.staticAccountKeys.map(() => 10000000),
      preTokenBalances: pre,
      postTokenBalances: post,
      innerInstructions: [{ index: 1, instructions: inner }],
      loadedAddresses: { writable: [], readonly: [] },
      logMessages: [],
    },
  } as VersionedTransactionResponse;
  tx.meta!.postBalances[0] = tx.meta!.preBalances[0]! - 5000;
  // Use the canonical codec, NOT hand-written fixture offsets that could agree
  // with the verifier while both differ from the actual 300-byte chain codec.
  const seal = encodeQuoteSealV1({
    contextHash: hash(Buffer.from("context")),
    quoteId: quoteIdForNonce(nonce),
    nonce,
    inputAmount: 400000n,
    quotedOutput: 476n,
    slippageBps: 100,
    minimumOutput: 472n,
    routeHash: hash(Buffer.from("route")),
    instructionHash: hash(
      Buffer.concat([Buffer.from("c3-router-data-v1"), route]),
    ),
    accountMetasHash: hash(Buffer.from("metas")),
    altCount: alt ? 1 : 0,
    altContentsHash: quoteAltContentsHash(alt ? [alt] : [], 100n),
    builderTimestamp: 1000n,
    builderSlot: 100n,
    expiresAt: 1030n,
    expiresSlot: 200n,
  });
  const e: ExecutionExpectation = {
    signature: tx.transaction.signatures[0]!,
    messageHash: hash(msg.serialize()).toString("hex"),
    seal,
    context,
    pool: pool.toBase58(),
    poolInput: pi.toBase58(),
    poolOutput: po.toBase58(),
  };
  return {
    tx,
    e,
    inner,
    post,
    pre,
    route,
    index,
    source,
    destination,
    pi,
    po,
    unrelated,
  };
}
