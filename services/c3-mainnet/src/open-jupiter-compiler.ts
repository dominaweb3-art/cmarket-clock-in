/** Actual Jupiter CPI compiler; verified RPC accounts/ALTs and unsigned envelopes.
 * No signing or broadcast. Durable verified context is required. */
import { createHash, randomBytes } from "node:crypto";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Ed25519Program,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { C3_MAINNET } from "./constants.ts";
import { JupiterV2ReadOnlyClient, type RouterBuild } from "./jupiter-v2.ts";
import { quoteAltContentsHash } from "./quote-alt.ts";
import {
  quoteIdForNonce,
  quoteContextHash,
  encodeQuoteSealV1,
  deriveQuoteMinimum,
} from "./quote-seal.ts";
import {
  VAULT_AUTHORITY,
  VAULT_PROGRAM,
  inspectUnsignedEnvelope,
} from "./open-v0-envelope.ts";
import {
  openQuoteContext,
  type OpenQuoteBuilder,
  type StoredQuoteContext,
  type ValidatedQuoteMaterial,
} from "./open-quote-context.ts";
import { validateDirectWhirlpoolRoute } from "./open-jupiter-route.ts";
import { awaitQuoteClock } from "./open-quote-clock.ts";
import { verifyWhirlpoolOracle } from "./open-whirlpool-oracle.ts";
const hash = (...parts: Uint8Array[]) =>
  createHash("sha256").update(Buffer.concat(parts)).digest();
const assert = (c: unknown, code: string): void => {
  if (!c) throw new Error(`C3_OPEN_BUILD_${code}`);
};
const pub = (s: string) => new PublicKey(s);
const vec = (b: Buffer) => {
  const n = Buffer.alloc(4);
  n.writeUInt32LE(b.length);
  return Buffer.concat([n, b]);
};
const pda = (...seeds: Buffer[]) =>
  PublicKey.findProgramAddressSync(seeds, VAULT_PROGRAM)[0];
const WHIRLPOOL = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const PROGRAMS = new Set([
  C3_MAINNET.jupiterProgram,
  WHIRLPOOL,
  C3_MAINNET.tokenProgram,
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
]);
type ExecutionContext = StoredQuoteContext & {
  keeper: string;
  governance: string;
  policy: string;
  reviewedPrograms: string[];
};
export class JupiterLegCompiler implements OpenQuoteBuilder {
  private readonly rpc: Connection;
  private readonly jupiter: JupiterV2ReadOnlyClient;
  private readonly retained = new Map<
    string,
    {
      ctx: ExecutionContext;
      build: RouterBuild;
      nonce: Buffer;
      alts: AddressLookupTableAccount[];
      execute: TransactionInstruction;
      blockhash: string;
      expiresMs: number;
      payloadHash: Buffer | null;
    }
  >();
  constructor(
    rpc: Connection,
    jupiter = new JupiterV2ReadOnlyClient({
      fetchImpl: (input, init) => {
        const url = new URL(String(input));
        url.searchParams.set("dexes", "Whirlpool");
        return fetch(url, init);
      },
    }),
  ) {
    this.rpc = rpc;
    this.jupiter = jupiter;
  }
  private authorization(
    ctx: ExecutionContext,
    nonce: Buffer,
  ): TransactionInstruction {
    const id = quoteIdForNonce(nonce);
    const auth = pda(
      Buffer.from("c3-swap-auth-v1"),
      pub(ctx.plan).toBuffer(),
      nonce,
    );
    const receipt = pda(Buffer.from("c3-quote-receipt-v1"), id);
    const fixed = [
      [pub(ctx.governance), true, true],
      [pub(ctx.vault), false, false],
      [pub(ctx.registry), false, false],
      [pub(ctx.policy), false, false],
      [pub(ctx.plan), false, true],
      [VAULT_AUTHORITY, false, false],
      [pub(ctx.source), false, false],
      [pub(ctx.destination), false, false],
      [pub(ctx.routerProgram), false, false],
      [auth, false, true],
      [receipt, false, true],
      [SYSVAR_INSTRUCTIONS_PUBKEY, false, false],
      [SystemProgram.programId, false, false],
    ] as const;
    return new TransactionInstruction({
      programId: VAULT_PROGRAM,
      keys: fixed.map(([pubkey, isSigner, isWritable]) => ({
        pubkey,
        isSigner,
        isWritable,
      })),
      data: Buffer.concat([
        hash(Buffer.from("global:authorize_swap_leg")).subarray(0, 8),
        nonce,
        id,
      ]),
    });
  }
  async validateAndBuild(
    trusted: StoredQuoteContext,
  ): Promise<ValidatedQuoteMaterial> {
    assert(
      !(trusted as StoredQuoteContext & { economicReviewOnly?: boolean })
        .economicReviewOnly,
      "REVIEW_NOT_EXECUTABLE",
    );
    return this.buildValidated(trusted, false);
  }
  /** Full CPI/account/ALT/size checks; no retained packets, seal or signer. */
  async reviewMinimum(
    trusted: StoredQuoteContext,
  ): Promise<ValidatedQuoteMaterial> {
    assert(
      (trusted as StoredQuoteContext & { economicReviewOnly?: boolean })
        .economicReviewOnly === true,
      "REVIEW_CONTEXT",
    );
    const {
      economicReviewOnly: _review,
      planMinimumOutput: _minimum,
      ...reviewContext
    } = trusted;
    void _review;
    void _minimum;
    const ctx = {
      ...reviewContext,
      planExpiresAt: String(Math.floor(Date.now() / 1000) + 30),
    };
    return this.buildValidated(ctx, true);
  }
  private async buildValidated(
    trusted: StoredQuoteContext,
    reviewOnly: boolean,
  ): Promise<ValidatedQuoteMaterial> {
    const ctx = trusted as ExecutionContext;
    assert(
      ctx.keeper &&
        ctx.governance &&
        ctx.policy &&
        Array.isArray(ctx.reviewedPrograms) &&
        ctx.reviewedPrograms.length > 0 &&
        ctx.reviewedPrograms.every((p) => PROGRAMS.has(p)),
      "REVIEWED_CONTEXT_MISSING",
    );
    const genesis = await this.rpc.getGenesisHash();
    assert(
      pub(genesis).toBuffer().toString("hex") === ctx.genesisHash,
      "GENESIS_MISMATCH",
    );
    const build = await this.jupiter.getExactInQuote({
      inputMint: ctx.inputMint,
      outputMint: ctx.outputMint,
      amount: BigInt(ctx.inputAmount),
      taker: VAULT_AUTHORITY.toBase58(),
      destinationTokenAccount: ctx.destination,
      slippageBps: ctx.maxSlippageBps,
      maxAccounts: 16,
    });
    await awaitQuoteClock(
      build.blockhashWithMetadata.fetchedAtEpochMs,
      ctx.maxQuoteAgeSeconds * 1000,
    );
    assert(
      build.otherInstructions.length === 0 && !build.tipInstruction,
      "EXTRA_INSTRUCTIONS",
    );
    const metas = build.swapInstruction.accounts;
    const route = validateDirectWhirlpoolRoute(build, {
      authority: VAULT_AUTHORITY.toBase58(),
      source: ctx.source,
      destination: ctx.destination,
      inputMint: ctx.inputMint,
      outputMint: ctx.outputMint,
      inputAmount: BigInt(ctx.inputAmount),
      maxSlippageBps: ctx.maxSlippageBps,
    });
    assert(
      metas.some((m) => m.pubkey === ctx.source && m.isWritable) &&
        metas.some((m) => m.pubkey === ctx.destination && m.isWritable) &&
        metas.some(
          (m) => m.pubkey === VAULT_AUTHORITY.toBase58() && m.isSigner,
        ) &&
        metas.every(
          (m) => !m.isSigner || m.pubkey === VAULT_AUTHORITY.toBase58(),
        ),
      "SOURCE_DESTINATION_AUTHORITY",
    );
    // Setup/cleanup are not trusted executable additions. Vault token accounts
    // must already exist; execute only the reviewed CPI instruction below.
    const observed = await this.rpc.getMultipleAccountsInfoAndContext(
      metas.map((m) => pub(m.pubkey)),
      "finalized",
    );
    const poolState =
      observed.value[metas.findIndex((m) => m.pubkey === route.pool)];
    assert(
      poolState?.owner.toBase58() === WHIRLPOOL &&
        poolState.data.length === 653,
      "POOL_STATE",
    );
    assert(
      poolState!.data
        .subarray(route.aToB ? 101 : 181, route.aToB ? 133 : 213)
        .equals(pub(ctx.inputMint).toBuffer()) &&
        poolState!.data
          .subarray(route.aToB ? 181 : 101, route.aToB ? 213 : 133)
          .equals(pub(ctx.outputMint).toBuffer()),
      "POOL_DIRECTION",
    );
    // Legacy Whirlpool allows its exact readonly oracle PDA to be uninitialized.
    // Preserve the ordered meta and observed absence; never invent oracle data.
    const oracle = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle"), pub(route.pool).toBuffer()],
      pub(WHIRLPOOL),
    )[0];
    const oracleAccount =
      observed.value[metas.findIndex((m) => m.pubkey === oracle.toBase58())];
    if (oracleAccount)
      verifyWhirlpoolOracle(
        oracle,
        pub(route.pool),
        oracleAccount.owner,
        oracleAccount.data,
        oracleAccount.executable,
      );
    for (const [i, meta] of metas.entries()) {
      if (
        observed.value[i] === null &&
        route.legacy &&
        meta.pubkey === oracle.toBase58() &&
        !meta.isSigner &&
        !meta.isWritable
      )
        observed.value[i] = {
          owner: SystemProgram.programId,
          lamports: 0,
          data: Buffer.alloc(0),
          executable: false,
          rentEpoch: 0,
        };
    }
    for (const [i, a] of observed.value.entries()) {
      assert(a, "ACCOUNT_MISSING:" + metas[i]!.pubkey);
      const meta = metas[i]!;
      if (a!.executable)
        assert(
          PROGRAMS.has(meta.pubkey) &&
            ctx.reviewedPrograms.includes(meta.pubkey) &&
            !meta.isWritable,
          "PROGRAM_NOT_REVIEWED:" + meta.pubkey,
        );
      else if (meta.isWritable)
        assert(
          a!.owner.toBase58() === C3_MAINNET.tokenProgram ||
            a!.owner.toBase58() === WHIRLPOOL,
          "WRITABLE_OWNER",
        );
      if (
        a!.owner.toBase58() === C3_MAINNET.tokenProgram &&
        meta.isWritable &&
        a!.data.length === 165
      ) {
        assert(
          a!.data[108] === 1 &&
            a!.data.readUInt32LE(72) === 0 &&
            a!.data.readUInt32LE(129) === 0,
          "TOKEN_DELEGATE_OR_CLOSE",
        );
        const owner = pub(new PublicKey(a!.data.subarray(32, 64)).toBase58());
        if (owner.equals(VAULT_AUTHORITY))
          assert(
            meta.pubkey === ctx.source || meta.pubkey === ctx.destination,
            "UNEXPECTED_VAULT_TOKEN",
          );
        else {
          // Legacy SPL Whirlpool reserves must belong to the pool PDA and be
          // the exact vault/mint pair encoded in its actual 653-byte state.
          const pool = metas.findIndex((m) => m.pubkey === owner.toBase58());
          const data = observed.value[pool]?.data;
          assert(
            data?.length === 653 &&
              observed.value[pool]?.owner.toBase58() === WHIRLPOOL &&
              data
                .subarray(0, 8)
                .equals(hash(Buffer.from("account:Whirlpool")).subarray(0, 8)),
            "POOL_ROLE",
          );
          const isA =
            new PublicKey(data!.subarray(133, 165)).toBase58() === meta.pubkey;
          const isB =
            new PublicKey(data!.subarray(213, 245)).toBase58() === meta.pubkey;
          assert(
            (isA || isB) &&
              a!.data
                .subarray(0, 32)
                .equals(data!.subarray(isA ? 101 : 181, isA ? 133 : 213)),
            "RESERVE_MINT",
          );
          const expected = PublicKey.createProgramAddressSync(
            [
              Buffer.from("whirlpool"),
              data!.subarray(8, 40),
              data!.subarray(101, 133),
              data!.subarray(181, 213),
              data!.subarray(43, 45),
              data!.subarray(40, 41),
            ],
            pub(WHIRLPOOL),
          );
          assert(expected.equals(owner), "POOL_PDA");
        }
      }
    }
    const rest = metas.slice(11);
    const reserveA = new PublicKey(
      poolState!.data.subarray(133, 165),
    ).toBase58();
    const reserveB = new PublicKey(
      poolState!.data.subarray(213, 245),
    ).toBase58();
    assert(
      rest[route.legacy ? 4 : 8]!.pubkey === reserveA &&
        rest[route.legacy ? 6 : 10]!.pubkey === reserveB &&
        rest[route.legacy ? 10 : 14]!.pubkey === oracle.toBase58(),
      "ORDERED_POOL_RESERVES_OR_ORACLE",
    );
    for (const [address, mint] of [
      [ctx.source, ctx.inputMint],
      [ctx.destination, ctx.outputMint],
    ]) {
      const a = observed.value[metas.findIndex((m) => m.pubkey === address)];
      assert(
        a?.owner.toBase58() === C3_MAINNET.tokenProgram &&
          a.data.length === 165 &&
          a.data.subarray(0, 32).equals(pub(mint!).toBuffer()) &&
          a.data.subarray(32, 64).equals(VAULT_AUTHORITY.toBuffer()),
        "VAULT_TOKEN",
      );
      if (address === ctx.source)
        assert(
          a!.data.readBigUInt64LE(64) >= BigInt(ctx.inputAmount),
          "INSUFFICIENT_INPUT",
        );
    }
    const altNames = Object.keys(build.addressesByLookupTableAddress);
    const altInfo = await this.rpc.getMultipleAccountsInfoAndContext(
      altNames.map(pub),
      "finalized",
    );
    const currentSlot = BigInt(
      Math.max(observed.context.slot, altInfo.context.slot),
    );
    const altRaw = altNames.map((address, i) => {
      const a = altInfo.value[i];
      assert(a && !a.executable, "ALT_MISSING");
      return { address, owner: a!.owner.toBase58(), data: a!.data };
    });
    const altHash = quoteAltContentsHash(altRaw, currentSlot);
    const alts = altRaw.map(
      (a) =>
        new AddressLookupTableAccount({
          key: pub(a.address),
          state: AddressLookupTableAccount.deserialize(a.data),
        }),
    );
    for (const a of alts)
      assert(
        JSON.stringify(a.state.addresses.map((k) => k.toBase58())) ===
          JSON.stringify(build.addressesByLookupTableAddress[a.key.toBase58()]),
        "ALT_CONTENTS_CHANGED",
      );
    const nonce = randomBytes(32),
      id = quoteIdForNonce(nonce);
    const auth = pda(
        Buffer.from("c3-swap-auth-v1"),
        pub(ctx.plan).toBuffer(),
        nonce,
      ),
      receipt = pda(Buffer.from("c3-quote-receipt-v1"), id);
    const fixed = [
      [pub(ctx.keeper), false],
      [pub(ctx.vault), false],
      [pub(ctx.registry), false],
      [pub(ctx.policy), false],
      [pub(ctx.plan), true],
      [auth, true],
      [receipt, true],
      [VAULT_AUTHORITY, false],
      [pub(ctx.source), true],
      [pub(ctx.destination), true],
      [pub(ctx.routerProgram), false],
      [pub(C3_MAINNET.tokenProgram), false],
    ] as const;
    const flags = Buffer.from(
        metas.map((m) => Number(m.isSigner) | (Number(m.isWritable) << 1)),
      ),
      raw = Buffer.from(build.swapInstruction.data, "base64");
    assert(
      raw.length >= 8 &&
        raw.length <= 1024 &&
        raw.toString("base64") === build.swapInstruction.data,
      "INSTRUCTION_DATA",
    );
    const execute = new TransactionInstruction({
      programId: VAULT_PROGRAM,
      keys: [
        ...fixed.map(([pubkey, isWritable], i) => ({
          pubkey,
          isSigner: i === 0,
          isWritable,
        })),
        ...metas.map((m) => ({
          pubkey: pub(m.pubkey),
          isSigner: false,
          isWritable: m.isWritable,
        })),
        ...altNames.map((a) => ({
          pubkey: pub(a),
          isSigner: false,
          isWritable: false,
        })),
      ],
      data: Buffer.concat([
        hash(Buffer.from("global:execute_swap_leg")).subarray(0, 8),
        vec(raw),
        vec(flags),
      ]),
    });
    const blockhash = (await this.rpc.getLatestBlockhash("finalized"))
      .blockhash;
    const message = new TransactionMessage({
      payerKey: pub(ctx.keeper),
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
        execute,
      ],
    }).compileToV0Message(alts);
    const envelope = inspectUnsignedEnvelope(message);
    assert(envelope.fits, "TRANSACTION_SIZE");
    const keys = message.getAccountKeys({ addressLookupTableAccounts: alts }),
      count = Buffer.alloc(2),
      rev = Buffer.alloc(8);
    count.writeUInt16LE(metas.length);
    rev.writeBigUInt64LE(BigInt(ctx.registryRevision));
    const metaHash = hash(
      Buffer.from("c3-ordered-metas-v3"),
      rev,
      Buffer.from(ctx.registryHash, "hex"),
      count,
      ...metas.map((m, i) => {
        const index =
          message.compiledInstructions[1]!.accountKeyIndexes[12 + i]!;
        assert(keys.get(index)?.toBase58() === m.pubkey, "ORDERED_METAS");
        const n = Buffer.alloc(2);
        n.writeUInt16LE(i);
        return Buffer.concat([
          n,
          pub(m.pubkey).toBuffer(),
          Buffer.from([
            flags[i]!,
            Number(message.isAccountWritable(index)),
            Number(observed.value[i]!.executable),
          ]),
        ]);
      }),
    );
    const expiresMs = Math.min(
      build.blockhashWithMetadata.fetchedAtEpochMs +
        ctx.maxQuoteAgeSeconds * 1000,
      Number(BigInt(ctx.planExpiresAt) * 1000n),
    );
    assert(Date.now() < expiresMs, "QUOTE_EXPIRED");
    const authorize = this.authorization(ctx, nonce);
    authorize.keys.push(
      ...altNames.map((a) => ({
        pubkey: pub(a),
        isSigner: false,
        isWritable: false,
      })),
    );
    const authorizationMessage = new TransactionMessage({
      payerKey: pub(ctx.governance),
      recentBlockhash: blockhash,
      instructions: [
        Ed25519Program.createInstructionWithPublicKey({
          publicKey: Buffer.from(ctx.authority, "hex"),
          message: Buffer.alloc(300),
          signature: Buffer.alloc(64),
        }),
        authorize,
      ],
    }).compileToV0Message(alts);
    const authEnvelope = inspectUnsignedEnvelope(authorizationMessage);
    assert(authEnvelope.fits, "AUTHORIZATION_TRANSACTION_SIZE");
    const material: ValidatedQuoteMaterial = {
      authorizationNonce: nonce,
      quotedOutput: BigInt(build.outAmount),
      jupiterThreshold: BigInt(build.otherAmountThreshold),
      slippageBps: build.slippageBps,
      routeHash: hash(Buffer.from(JSON.stringify(build.routePlan))),
      instructionHash: hash(Buffer.from("c3-router-data-v1"), raw),
      accountMetasHash: metaHash,
      altCount: altRaw.length,
      altContentsHash: altHash,
      builderTimestamp: BigInt(
        Math.floor(build.blockhashWithMetadata.fetchedAtEpochMs / 1000),
      ),
      builderSlot: currentSlot,
      expiresAt: BigInt(Math.floor(expiresMs / 1000)),
      expiresSlot: currentSlot + 100n,
      unsignedPacketBytes: Math.max(envelope.bytes, authEnvelope.bytes),
      executionMessageHash: hash(message.serialize()).toString("hex"),
      effectManifest: {
        pool: route.pool,
        poolInput: new PublicKey(
          poolState!.data.subarray(
            route.aToB ? 133 : 213,
            route.aToB ? 165 : 245,
          ),
        ).toBase58(),
        poolOutput: new PublicKey(
          poolState!.data.subarray(
            route.aToB ? 213 : 133,
            route.aToB ? 245 : 165,
          ),
        ).toBase58(),
      },
    };
    if (ctx.planMinimumOutput !== undefined)
      assert(
        /^[1-9][0-9]{0,19}$/.test(ctx.planMinimumOutput) &&
          deriveQuoteMinimum(
            material.quotedOutput,
            material.slippageBps,
            material.jupiterThreshold,
            BigInt(ctx.planMinimumOutput),
          ) >= BigInt(ctx.planMinimumOutput),
        "COMMITTED_PLAN_MINIMUM",
      );
    const expected = encodeQuoteSealV1({
      ...material,
      contextHash: quoteContextHash(openQuoteContext(ctx)),
      quoteId: id,
      nonce,
      inputAmount: BigInt(ctx.inputAmount),
      minimumOutput: deriveQuoteMinimum(
        material.quotedOutput,
        material.slippageBps,
        material.jupiterThreshold,
        ctx.planMinimumOutput === undefined
          ? undefined
          : BigInt(ctx.planMinimumOutput),
      ),
    });
    if (reviewOnly) return material;
    this.retained.set(id.toString("hex"), {
      ctx,
      build,
      nonce,
      alts,
      execute,
      blockhash,
      expiresMs,
      payloadHash: hash(expected),
    });
    // Unsigned instructions remain memory-only and are disposed on expiry.
    const timer = setTimeout(
      () => this.retained.delete(id.toString("hex")),
      Math.max(0, expiresMs - Date.now()),
    );
    timer.unref();
    return material;
  }
  unsignedPackets(
    quoteId: string,
    payload: Buffer,
    signature: Buffer,
  ): readonly Uint8Array[] {
    const r = this.retained.get(quoteId);
    assert(
      r &&
        Date.now() < r.expiresMs &&
        payload.length === 300 &&
        payload.subarray(49, 81).toString("hex") === quoteId &&
        r.payloadHash?.equals(hash(payload)),
      "REBUILD_REQUIRES_NEW_AUTHORIZATION",
    );
    const authorize = this.authorization(r!.ctx, r!.nonce);
    authorize.keys.push(
      ...r!.alts.map((a) => ({
        pubkey: a.key,
        isSigner: false,
        isWritable: false,
      })),
    );
    const messages = [
      new TransactionMessage({
        payerKey: pub(r!.ctx.governance),
        recentBlockhash: r!.blockhash,
        instructions: [
          Ed25519Program.createInstructionWithPublicKey({
            publicKey: Buffer.from(r!.ctx.authority, "hex"),
            message: payload,
            signature,
          }),
          authorize,
        ],
      }).compileToV0Message(r!.alts),
      new TransactionMessage({
        payerKey: pub(r!.ctx.keeper),
        recentBlockhash: r!.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1400000 }),
          r!.execute,
        ],
      }).compileToV0Message(r!.alts),
    ];
    const packets = messages.map((m) => {
      assert(inspectUnsignedEnvelope(m).fits, "TRANSACTION_SIZE");
      return new VersionedTransaction(m).serialize();
    });
    this.retained.delete(quoteId);
    return Object.freeze(packets);
  }
}
