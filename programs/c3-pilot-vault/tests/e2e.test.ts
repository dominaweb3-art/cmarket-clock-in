import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  AnchorProvider,
  BN,
  Program,
  Wallet,
  setProvider,
} from "@coral-xyz/anchor";
import type { Idl } from "@coral-xyz/anchor";
import {
  AuthorityType,
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createInitializeNonTransferableMintInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  transferChecked,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { C3PilotClient } from "../../../packages/c3-pilot-client/src/index.ts";
import { openValidatorJournal } from "../../../services/c3-mainnet/pilot-open-local/validator-bridge.ts";
import type {
  OpenSnapshot,
  Scope,
} from "../../../services/c3-mainnet/pilot-open-local/orchestrator.ts";

const url = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
if (url !== "http://127.0.0.1:8899")
  throw new Error("MOCK_LOCAL_ONLY tests refuse non-local RPC");
const walletPath = process.env.ANCHOR_WALLET;
if (
  !walletPath ||
  resolve(walletPath) !==
    resolve(import.meta.dirname, "../target/local-test-wallet.json")
)
  throw new Error("MOCK_LOCAL_ONLY requires ignored local test wallet");

type AnyProgram = Program<Idl>;
const idl = JSON.parse(
  readFileSync(
    new URL("../target/idl/c3_pilot_vault.json", import.meta.url),
    "utf8",
  ),
) as Idl;
const payer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")) as number[]),
);
const connection = new Connection(url, "confirmed");
const provider = new AnchorProvider(connection, new Wallet(payer), {
  commitment: "confirmed",
});
setProvider(provider);
const program: AnyProgram = new Program(idl, provider);
const routerId = new PublicKey("7dfvugVLSaDFrXF6i2SbNji5vJmCvKP9grj4Nh8EysfZ");
const [poolAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("liquidity")],
  routerId,
);
const digest = (...parts: Uint8Array[]): number[] => [
  ...createHash("sha256").update(Buffer.concat(parts)).digest(),
];
const bytes = (value: string): Uint8Array => Buffer.from(value);
const hexDigest = (...parts: Uint8Array[]): string =>
  Buffer.from(digest(...parts)).toString("hex");
function base58(value: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${Buffer.from(value).toString("hex")}`);
  let encoded = "";
  while (number > 0n) {
    encoded = alphabet[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  for (const byte of value) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}
const readOnlyClient = new C3PilotClient(idl, program.programId);
const [config] = PublicKey.findProgramAddressSync(
  [Buffer.from("c3-vault-v1")],
  program.programId,
);
const [vaultAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("c3-authority-v1")],
  program.programId,
);
const fetchState = (
  name: string,
  address: PublicKey,
): Promise<Record<string, unknown>> =>
  (
    program.account as unknown as Record<
      string,
      { fetch: (key: PublicKey) => Promise<Record<string, unknown>> }
    >
  )[name].fetch(address);

function intent(
  kind: "deposit" | "redemption",
  owner: PublicKey,
  nonce: number,
): PublicKey {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(BigInt(nonce));
  return PublicKey.findProgramAddressSync(
    [Buffer.from(kind), config.toBuffer(), owner.toBuffer(), bytes],
    program.programId,
  )[0];
}

function settlementPlan(intentAddress: PublicKey): PublicKey {
  return readOnlyClient.settlementPlanPda(intentAddress);
}

async function airdrop(to: PublicKey, lamports: number): Promise<void> {
  const signature = await connection.requestAirdrop(to, lamports);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
}

async function balance(
  account: PublicKey,
  tokenProgram = TOKEN_PROGRAM_ID,
): Promise<bigint> {
  return (await getAccount(connection, account, "confirmed", tokenProgram))
    .amount;
}

async function settlementTimes(): Promise<[BN, BN]> {
  const slot = await connection.getSlot("confirmed");
  const blockTime = await connection.getBlockTime(slot);
  if (blockTime == null) throw new Error("LOCAL_VALIDATOR_CLOCK_UNAVAILABLE");
  return [new BN(blockTime), new BN(blockTime + 110)];
}

async function expectFailure(
  action: () => Promise<unknown>,
  name: string,
): Promise<void> {
  await assert.rejects(action, `${name} must fail`);
}

test(
  "MOCK_LOCAL_ONLY: exact one-owner buy, hold, full redemption and USDC claim on isolated validator",
  { timeout: 240_000 },
  async (t) => {
    await airdrop(payer.publicKey, 20_000_000_000);
    const owner = Keypair.generate();
    const attacker = Keypair.generate();
    const keeper = Keypair.generate();
    const emergency = Keypair.generate();
    await airdrop(owner.publicKey, 2_000_000_000);
    await airdrop(attacker.publicKey, 2_000_000_000);
    await airdrop(keeper.publicKey, 2_000_000_000);

    const usdcMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      6,
    );
    const btcMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      6,
    );
    const ethMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      6,
    );
    const wsolMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      6,
    );
    const shareMint = Keypair.generate();
    const mintSpace = getMintLen([ExtensionType.NonTransferable]);
    const rent = await connection.getMinimumBalanceForRentExemption(mintSpace);
    const shareCreate = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: shareMint.publicKey,
        lamports: rent,
        space: mintSpace,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeNonTransferableMintInstruction(
        shareMint.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMintInstruction(
        shareMint.publicKey,
        6,
        vaultAuthority,
        vaultAuthority,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendAndConfirmTransaction(connection, shareCreate, [
      payer,
      shareMint,
    ]);

    const ownerUsdc = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        usdcMint,
        owner.publicKey,
      )
    ).address;
    const attackerUsdc = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        usdcMint,
        attacker.publicKey,
      )
    ).address;
    const ownerShares = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        shareMint.publicKey,
        owner.publicKey,
        false,
        "confirmed",
        undefined,
        TOKEN_2022_PROGRAM_ID,
      )
    ).address;
    const attackerShares = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        shareMint.publicKey,
        attacker.publicKey,
        false,
        "confirmed",
        undefined,
        TOKEN_2022_PROGRAM_ID,
      )
    ).address;
    const vaultUsdc = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        usdcMint,
        vaultAuthority,
        true,
      )
    ).address;
    const vaultBtc = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        btcMint,
        vaultAuthority,
        true,
      )
    ).address;
    const vaultEth = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        ethMint,
        vaultAuthority,
        true,
      )
    ).address;
    const vaultWsol = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        wsolMint,
        vaultAuthority,
        true,
      )
    ).address;
    const poolAccounts = new Map<string, PublicKey>();
    for (const mint of [usdcMint, btcMint, ethMint, wsolMint]) {
      const account = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        poolAuthority,
        true,
      );
      poolAccounts.set(mint.toBase58(), account.address);
      await mintTo(connection, payer, mint, account.address, payer, 2_000_000);
    }
    for (const mint of [btcMint, ethMint, wsolMint]) {
      await setAuthority(
        connection,
        payer,
        mint,
        payer,
        AuthorityType.MintTokens,
        vaultAuthority,
      );
    }
    await mintTo(connection, payer, usdcMint, ownerUsdc, payer, 1_000_000);
    await setAuthority(
      connection,
      payer,
      usdcMint,
      payer,
      AuthorityType.MintTokens,
      vaultAuthority,
    );

    const initAccounts = {
      payer: payer.publicKey,
      governance: payer.publicKey,
      emergency: emergency.publicKey,
      owner: owner.publicKey,
      vaultAuthority,
      config,
      usdcMint,
      btcMint,
      ethMint,
      wsolMint,
      shareMint: shareMint.publicKey,
      vaultUsdc,
      vaultBtc,
      vaultEth,
      vaultWsol,
      tokenProgram: TOKEN_PROGRAM_ID,
      shareTokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
    const durable = process.env.C3_DISPOSABLE_TEST_DATABASE
      ? await openValidatorJournal()
      : null;
    if (durable) t.after(() => durable.close());
    const journalId = randomUUID();
    const depositPlanAddress = settlementPlan(
      intent("deposit", owner.publicKey, 1),
    );
    let journalState: OpenSnapshot | null = durable
      ? await durable.db.createDraft({
          intentId: journalId,
          wallet: owner.publicKey.toBase58(),
          vault: config.toBase58(),
          shareMint: shareMint.publicKey.toBase58(),
          depositPlan: depositPlanAddress.toBase58(),
          configurationHash: hexDigest(bytes("c3-local-cpi-v1")),
          expiresAt: new Date(Date.now() + 3_600_000),
          idempotencyHash: hexDigest(bytes(`create:${journalId}`)),
        })
      : null;
    const journalScope = (): Scope => {
      if (!journalState) throw new Error("C3_LOCAL_JOURNAL_NOT_ENABLED");
      return {
        intentId: journalId,
        wallet: owner.publicKey.toBase58(),
        vault: config.toBase58(),
        expectedDbRevision: journalState.dbRevision,
        expectedChainRevision: journalState.chainRevision,
        idempotencyHash: hexDigest(
          bytes(`${journalId}:${journalState.dbRevision}:${randomUUID()}`),
        ),
      };
    };
    const checkpoint = async (
      from: "draft" | "buying" | "active" | "selling" | "claimable",
      to:
        "funded" | "active" | "redemption_requested" | "claimable" | "redeemed",
      plan: PublicKey,
      revision: bigint,
      signature: string,
    ): Promise<void> => {
      if (!durable || !journalState) return;
      journalState = await durable.db.recordLocalChainCheckpoint(
        journalScope(),
        from,
        to,
        {
          source: "MOCK_LOCAL_ONLY",
          plan: plan.toBase58(),
          wallet: owner.publicKey.toBase58(),
          vault: config.toBase58(),
          amount: 1_000_000n,
          chainRevision: revision,
          evidenceHash: hexDigest(bytes(signature)),
          ...(to === "redemption_requested"
            ? { redemptionPlan: plan.toBase58() }
            : {}),
        },
      );
    };
    const initialize = (
      accounts = initAccounts,
      weights = [4000, 3000, 3000],
    ) =>
      program.methods
        .initializeVault(
          keeper.publicKey,
          new BN(1),
          weights,
          new BN(1_000_000),
        )
        .accountsStrict(accounts)
        .rpc();
    await expectFailure(
      () => initialize(initAccounts, [4000, 3000, 3001]),
      "allocation over 10000",
    );
    await expectFailure(
      () => initialize(initAccounts, [5000, 3000, 2000]),
      "changed allocation",
    );
    await expectFailure(
      () => initialize({ ...initAccounts, btcMint: usdcMint }),
      "repeated mint",
    );
    await expectFailure(
      () => initialize({ ...initAccounts, shareMint: btcMint }),
      "fake share mint",
    );
    await expectFailure(
      () => initialize({ ...initAccounts, vaultBtc: vaultEth }),
      "substituted vault asset account",
    );
    await expectFailure(
      () =>
        initialize({ ...initAccounts, tokenProgram: SystemProgram.programId }),
      "wrong token program",
    );

    const initSig = await initialize();
    assert.equal((await fetchState("vaultConfig", config)).paused, true);

    const depositNonce = 1;
    const depositIntent = intent("deposit", owner.publicKey, depositNonce);
    const expires = () => new BN(Math.floor(Date.now() / 1000) + 1800);
    const createDeposit = (who: Keypair, amount: number, nonce: number) =>
      program.methods
        .createDepositIntent(
          new BN(nonce),
          new BN(amount),
          new BN(1),
          expires(),
        )
        .accountsStrict({
          owner: who.publicKey,
          config,
          intent: intent("deposit", who.publicKey, nonce),
          systemProgram: SystemProgram.programId,
        })
        .signers([who])
        .rpc();
    await expectFailure(
      () => createDeposit(owner, 1_000_000, depositNonce),
      "deposit while paused",
    );
    await expectFailure(
      () =>
        program.methods
          .unpause()
          .accountsStrict({ authority: attacker.publicKey, config })
          .signers([attacker])
          .rpc(),
      "unauthorized unpause",
    );
    await expectFailure(
      () =>
        program.methods
          .setKeeper(attacker.publicKey)
          .accountsStrict({ authority: attacker.publicKey, config })
          .signers([attacker])
          .rpc(),
      "unauthorized keeper change",
    );
    await program.methods
      .unpause()
      .accountsStrict({ authority: payer.publicKey, config })
      .rpc();
    await expectFailure(
      () => createDeposit(attacker, 1_000_000, 1),
      "wrong owner",
    );
    await expectFailure(
      () => createDeposit(owner, 999_999, depositNonce),
      "below one USDC",
    );
    await expectFailure(
      () => createDeposit(owner, 1_000_001, depositNonce),
      "above one USDC",
    );
    await expectFailure(
      () =>
        program.methods
          .createDepositIntent(
            new BN(depositNonce),
            new BN(1_000_000),
            new BN(2),
            expires(),
          )
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: depositIntent,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc(),
      "stale configuration",
    );
    await expectFailure(
      () =>
        program.methods
          .createDepositIntent(
            new BN(depositNonce),
            new BN(1_000_000),
            new BN(1),
            new BN(Math.floor(Date.now() / 1000) - 1),
          )
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: depositIntent,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc(),
      "expired deposit",
    );
    const createSig = await createDeposit(owner, 1_000_000, depositNonce);
    await expectFailure(
      () =>
        program.methods
          .pause()
          .accountsStrict({ authority: attacker.publicKey, config })
          .signers([attacker])
          .rpc(),
      "unauthorized pause",
    );
    await expectFailure(
      () =>
        program.methods
          .setKeeper(attacker.publicKey)
          .accountsStrict({ authority: payer.publicKey, config })
          .rpc(),
      "keeper rotation while intent active",
    );
    await expectFailure(
      () => createDeposit(owner, 1_000_000, depositNonce),
      "duplicate nonce",
    );
    await expectFailure(
      () => createDeposit(owner, 1_000_000, 2),
      "second deposit",
    );
    await expectFailure(
      () =>
        program.methods
          .issueInitialShares()
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: depositIntent,
            vaultAuthority,
            shareMint: shareMint.publicKey,
            ownerShares,
            vaultUsdc,
            vaultBtc,
            vaultEth,
            vaultWsol,
            shareTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "mint before settlement",
    );

    const depositSig = await program.methods
      .depositUsdc()
      .accountsStrict({
        owner: owner.publicKey,
        config,
        intent: depositIntent,
        ownerUsdc,
        vaultUsdc,
        usdcMint,
        vaultBtc,
        vaultEth,
        vaultWsol,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
    await checkpoint("draft", "funded", depositPlanAddress, 0n, depositSig);
    assert.equal(await balance(ownerUsdc), 0n);
    assert.equal(await balance(vaultUsdc), 1_000_000n);
    await expectFailure(
      () =>
        program.methods
          .depositUsdc()
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: depositIntent,
            ownerUsdc,
            vaultUsdc,
            usdcMint,
            vaultBtc,
            vaultEth,
            vaultWsol,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "duplicate deposit",
    );
    await expectFailure(
      () =>
        program.methods
          .depositUsdc()
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: depositIntent,
            ownerUsdc,
            vaultUsdc,
            usdcMint: btcMint,
            vaultBtc,
            vaultEth,
            vaultWsol,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "wrong USDC mint",
    );

    const commonMock = {
      keeper: keeper.publicKey,
      config,
      vaultAuthority,
      vaultUsdc,
      vaultBtc,
      vaultEth,
      vaultWsol,
      usdcMint,
      btcMint,
      ethMint,
      wsolMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    };
    const runCpiLeg = async (
      plan: PublicKey,
      leg: number,
      revision: number,
      direction: "buy" | "sell",
    ): Promise<string> => {
      const assets = [btcMint, ethMint, wsolMint];
      const vaultAssets = [vaultBtc, vaultEth, vaultWsol];
      const inputMint = direction === "buy" ? usdcMint : assets[leg];
      const outputMint = direction === "buy" ? assets[leg] : usdcMint;
      const source = direction === "buy" ? vaultUsdc : vaultAssets[leg];
      const destination = direction === "buy" ? vaultAssets[leg] : vaultUsdc;
      const input =
        direction === "buy"
          ? [400_000, 300_000, 300_000][leg]
          : [40_000, 30_000, 30_000][leg];
      const output =
        direction === "buy"
          ? [40_000, 30_000, 30_000][leg]
          : [396_000, 297_000, 297_000][leg];
      const routerData = Buffer.alloc(25);
      Buffer.from(digest(bytes("global:swap"))).copy(routerData, 0, 0, 8);
      routerData.writeBigUInt64LE(BigInt(input), 8);
      routerData.writeBigUInt64LE(BigInt(output), 16);
      const routerKeys = [
        [vaultAuthority, false],
        [source, true],
        [destination, true],
        [poolAccounts.get(inputMint.toBase58())!, true],
        [poolAccounts.get(outputMint.toBase58())!, true],
        [poolAuthority, false],
        [inputMint, false],
        [outputMint, false],
        [TOKEN_PROGRAM_ID, false],
      ] as const;
      const routerInstruction = {
        data: routerData,
        keys: routerKeys.map(([pubkey, isWritable]) => ({
          pubkey,
          isWritable,
        })),
      };
      const ordered = Buffer.alloc(2);
      ordered.writeUInt16LE(routerInstruction.keys.length);
      const metaBytes = Buffer.concat([
        ordered,
        ...routerInstruction.keys.map((key) =>
          Buffer.concat([
            key.pubkey.toBuffer(),
            Buffer.from([
              Number(key.pubkey.equals(vaultAuthority)),
              Number(key.isWritable),
            ]),
          ]),
        ),
      ]);
      const fingerprint = digest(
        bytes("c3-local-route-v1"),
        routerInstruction.data,
      );
      const idempotency = digest(
        bytes("c3-local-leg-v1"),
        plan.toBuffer(),
        Buffer.from([leg]),
      );
      const [authorization] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("c3-swap-auth-v1"),
          plan.toBuffer(),
          Buffer.from(idempotency),
        ],
        program.programId,
      );
      const [quoteTime, planExpiry] = await settlementTimes();
      const args = {
        leg,
        expectedRevision: new BN(revision),
        inputAmount: new BN(input),
        minimumOutput: new BN(output),
        maxSlippageBps: 100,
        quoteCreatedAt: quoteTime,
        expiresAt: new BN(
          Math.min(planExpiry.toNumber(), quoteTime.toNumber() + 30),
        ),
        quoteFingerprint: fingerprint,
        routeFingerprint: fingerprint,
        instructionHash: digest(
          bytes("c3-router-data-v1"),
          routerInstruction.data,
        ),
        accountMetasHash: digest(bytes("c3-ordered-metas-v1"), metaBytes),
        idempotency,
      };
      const authorizationAccounts = {
        governance: payer.publicKey,
        config,
        plan,
        vaultAuthority,
        source,
        destination,
        routerProgram: routerId,
        authorization,
        systemProgram: SystemProgram.programId,
      };
      const executionAccounts = {
        keeper: keeper.publicKey,
        config,
        plan,
        authorization,
        vaultAuthority,
        source,
        destination,
        routerProgram: routerId,
        tokenProgram: TOKEN_PROGRAM_ID,
      };
      const remaining = routerInstruction.keys.map((key) => ({
        pubkey: key.pubkey,
        isSigner: false,
        isWritable: key.isWritable,
      }));
      if (direction === "buy" && leg === 0 && revision === 0) {
        await expectFailure(
          () =>
            program.methods
              .authorizeSwapLeg(args)
              .accountsStrict({
                ...authorizationAccounts,
                governance: attacker.publicKey,
              })
              .signers([attacker])
              .rpc(),
          "attacker cannot authorize CPI",
        );
        await expectFailure(
          () =>
            program.methods
              .authorizeSwapLeg({ ...args, inputAmount: new BN(input + 1) })
              .accountsStrict(authorizationAccounts)
              .rpc(),
          "excess input cannot be authorized",
        );
        await expectFailure(
          () =>
            program.methods
              .authorizeSwapLeg({ ...args, minimumOutput: new BN(output - 1) })
              .accountsStrict(authorizationAccounts)
              .rpc(),
          "reduced minimum cannot be authorized",
        );
        await expectFailure(
          () =>
            program.methods
              .authorizeSwapLeg({
                ...args,
                quoteCreatedAt: new BN(quoteTime.toNumber() - 100),
              })
              .accountsStrict(authorizationAccounts)
              .rpc(),
          "expired quote cannot be authorized",
        );
        await expectFailure(
          () =>
            program.methods
              .authorizeSwapLeg(args)
              .accountsStrict({
                ...authorizationAccounts,
                routerProgram: SystemProgram.programId,
              })
              .rpc(),
          "substituted router cannot be authorized",
        );
        await expectFailure(
          () =>
            program.methods
              .authorizeSwapLeg(args)
              .accountsStrict({
                ...authorizationAccounts,
                destination: attackerUsdc,
              })
              .rpc(),
          "attacker destination cannot be authorized",
        );
      }
      const ordinal = direction === "buy" ? leg : leg + 3;
      const workerA = hexDigest(bytes(`worker-a:${journalId}`)).slice(0, 32);
      const workerB = hexDigest(bytes(`worker-b:${journalId}`)).slice(0, 32);
      const workerUuid = (hex: string) =>
        `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
      let worker = workerUuid(workerA);
      const authorizationHash = hexDigest(
        bytes("c3-auth-v1"),
        Buffer.from(idempotency),
      );
      const expectedEffects = {
        source: source.toBase58(),
        destination: destination.toBase58(),
        inputMint: inputMint.toBase58(),
        outputMint: outputMint.toBase58(),
        debit: String(input),
        credit: String(output),
        router: routerId.toBase58(),
      };
      if (durable && journalState) {
        if (ordinal === 4) {
          const race = await Promise.allSettled([
            durable.db.lease(journalScope(), ordinal, workerUuid(workerA)),
            durable.db.lease(journalScope(), ordinal, workerUuid(workerB)),
          ]);
          assert.equal(
            race.filter((result) => result.status === "fulfilled").length,
            1,
          );
          const winner = race.findIndex(
            (result) => result.status === "fulfilled",
          );
          worker = workerUuid(winner === 0 ? workerA : workerB);
          journalState = (race[winner] as PromiseFulfilledResult<OpenSnapshot>)
            .value;
        } else {
          journalState = await durable.db.lease(
            journalScope(),
            ordinal,
            worker,
          );
        }
        journalState = await durable.db.prepare(
          journalScope(),
          ordinal,
          worker,
          {
            routeHash: Buffer.from(fingerprint).toString("hex"),
            instructionHash: Buffer.from(args.instructionHash).toString("hex"),
            authorizationHash,
            inputMint: inputMint.toBase58(),
            outputMint: outputMint.toBase58(),
            source: source.toBase58(),
            destination: destination.toBase58(),
            inputAmount: BigInt(input),
            minimumOutput: BigInt(output),
            quoteExpiresAt: new Date(args.expiresAt.toNumber() * 1000),
            expectedEffects,
          },
        );
      }
      await program.methods
        .authorizeSwapLeg(args)
        .accountsStrict(authorizationAccounts)
        .rpc();
      const execute = (
        data: Buffer,
        accounts = executionAccounts,
        metas = remaining,
      ) =>
        program.methods
          .executeSwapLeg(data)
          .accountsStrict(accounts)
          .remainingAccounts(metas)
          .signers([keeper])
          .rpc();
      if (direction === "buy" && leg === 0 && revision === 0) {
        const altered = Buffer.from(routerInstruction.data);
        altered[24] = 1;
        await expectFailure(() => execute(altered), "CPI data mutation");
        await expectFailure(
          () =>
            execute(
              routerInstruction.data,
              executionAccounts,
              [...remaining].reverse(),
            ),
          "CPI account reorder",
        );
        await expectFailure(
          () =>
            execute(routerInstruction.data, executionAccounts, [
              ...remaining,
              { pubkey: attackerUsdc, isSigner: false, isWritable: true },
            ]),
          "unexpected writable token account",
        );
        await expectFailure(
          () =>
            execute(routerInstruction.data, executionAccounts, [
              ...remaining,
              {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
              },
            ]),
          "unknown executable route program",
        );
        await expectFailure(
          () =>
            execute(routerInstruction.data, {
              ...executionAccounts,
              destination: attackerUsdc,
            }),
          "keeper-controlled destination",
        );
      }
      if (!durable || !journalState) return execute(routerInstruction.data);
      const ix = await program.methods
        .executeSwapLeg(routerInstruction.data)
        .accountsStrict(executionAccounts)
        .remainingAccounts(remaining)
        .instruction();
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({
        feePayer: keeper.publicKey,
        recentBlockhash: latest.blockhash,
      }).add(ix);
      transaction.sign(keeper);
      assert.ok(transaction.signature, "local keeper signature is required");
      const signature = base58(transaction.signature);
      journalState = await durable.db.recordSignature(
        journalScope(),
        ordinal,
        worker,
        signature,
        authorizationHash,
      );
      if (ordinal === 1) {
        const restart = spawnSync(
          process.execPath,
          [
            "--experimental-strip-types",
            "tests/restart-reader.ts",
            journalId,
            String(ordinal),
          ],
          {
            cwd: new URL("..", import.meta.url),
            env: process.env,
            encoding: "utf8",
            timeout: 10_000,
          },
        );
        assert.equal(
          restart.status,
          0,
          "signature did not survive process restart",
        );
        assert.equal(JSON.parse(restart.stdout).signature, signature);
      }
      journalState = await durable.db.markSubmitted(
        journalScope(),
        ordinal,
        worker,
        signature,
      );
      try {
        const returned = await connection.sendRawTransaction(
          transaction.serialize(),
          {
            maxRetries: 0,
          },
        );
        if (ordinal !== 1) assert.equal(returned, signature);
        // Leg 1 deliberately discards the RPC return value and reconciles the
        // pre-persisted signature instead of rebuilding or submitting again.
      } catch (error) {
        journalState = await durable.db.uncertain(
          journalScope(),
          ordinal,
          "RPC_SUBMISSION_UNCERTAIN",
        );
        throw error;
      }
      const finalized = await connection.confirmTransaction(
        { signature, ...latest },
        "finalized",
      );
      assert.equal(finalized.value.err, null);
      const result = await connection.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      assert.ok(
        result?.meta && result.meta.err === null,
        "raw finalized transaction evidence is required",
      );
      assert.equal(
        result.transaction.signatures[0],
        signature,
        "persisted signature differs from finalized transaction",
      );
      const message = result.transaction.message;
      assert.ok(
        "accountKeys" in message && "instructions" in message,
        "local settlement requires a legacy message with raw instructions",
      );
      const accountKeys = message.accountKeys;
      assert.deepEqual(
        Buffer.from(message.serialize()),
        Buffer.from(transaction.serializeMessage()),
        "finalized outer message changed after authorization",
      );
      assert.ok(accountKeys[0]?.equals(keeper.publicKey), "fee payer mismatch");
      assert.equal(
        message.instructions.length,
        1,
        "unexpected outer instruction",
      );
      assert.ok(
        accountKeys[message.instructions[0]!.programIdIndex]?.equals(
          program.programId,
        ),
        "outer vault instruction missing",
      );
      assert.ok(
        result.meta.innerInstructions?.some((group) =>
          group.instructions.some((instruction) =>
            accountKeys[instruction.programIdIndex]?.equals(routerId),
          ),
        ),
        "inner router CPI missing",
      );
      assert.ok(
        result.meta.innerInstructions?.every((group) =>
          group.instructions.every((instruction) => {
            const programKey = accountKeys[instruction.programIdIndex];
            return (
              programKey?.equals(routerId) ||
              programKey?.equals(TOKEN_PROGRAM_ID)
            );
          }),
        ),
        "unreviewed inner program",
      );
      if (ordinal === 1) {
        journalState = await durable.db.uncertain(
          journalScope(),
          ordinal,
          "RPC_RESPONSE_LOST_AFTER_FINALITY",
        );
        assert.equal(journalState.state, "reconciliation_required");
        journalState = await durable.db.beginReconciliation(
          journalScope(),
          ordinal,
        );
        assert.equal(
          (await durable.db.readLeg(journalId, ordinal)).signature,
          signature,
        );
      }
      const tokenAmount = (
        list: typeof result.meta.preTokenBalances,
        account: PublicKey,
        mint: PublicKey,
      ) => {
        const index = accountKeys.findIndex((key) => key.equals(account));
        const entry = list?.find((value) => value.accountIndex === index);
        assert.ok(
          entry &&
            entry.owner === vaultAuthority.toBase58() &&
            entry.mint === mint.toBase58(),
          "vault token owner/mint evidence missing",
        );
        return BigInt(entry.uiTokenAmount.amount);
      };
      assert.equal(
        tokenAmount(result.meta.preTokenBalances, source, inputMint) -
          tokenAmount(result.meta.postTokenBalances, source, inputMint),
        BigInt(input),
      );
      assert.equal(
        tokenAmount(result.meta.postTokenBalances, destination, outputMint) -
          tokenAmount(result.meta.preTokenBalances, destination, outputMint),
        BigInt(output),
      );
      for (const entry of result.meta.preTokenBalances ?? []) {
        if (entry.owner !== vaultAuthority.toBase58()) continue;
        const key = accountKeys[entry.accountIndex];
        if (key?.equals(source) || key?.equals(destination)) continue;
        const after:
          | { owner?: string; mint: string; uiTokenAmount: { amount: string } }
          | undefined = result.meta.postTokenBalances?.find(
          (value) => value.accountIndex === entry.accountIndex,
        );
        assert.ok(
          after &&
            after.owner === entry.owner &&
            after.mint === entry.mint &&
            after.uiTokenAmount.amount === entry.uiTokenAmount.amount,
          "unrelated vault asset changed",
        );
      }
      assert.equal(
        ((await fetchState("settlementPlan", plan)).revision as BN).toString(),
        String(revision + 1),
      );
      journalState = await durable.db.recordLocalConfirmedLeg(
        journalScope(),
        ordinal,
        {
          source: "MOCK_LOCAL_ONLY",
          plan: plan.toBase58(),
          signature,
          evidenceHash: hexDigest(
            bytes(signature),
            bytes(JSON.stringify(expectedEffects)),
          ),
          chainRevision: BigInt(revision + 1),
          observedEffects: expectedEffects,
        },
      );
      return signature;
    };
    const depositSettlementId = Array.from({ length: 32 }, () => 1);
    const depositPlan = settlementPlan(depositIntent);
    const depositHashes = [1, 2, 3].map((value) =>
      Array.from({ length: 32 }, () => value),
    );
    const createDepositPlan = async (minimums = [40_000, 30_000, 30_000]) => {
      const [quoteTime, planExpiry] = await settlementTimes();
      return program.methods
        .createDepositSettlementPlan(
          depositHashes,
          minimums.map((value) => new BN(value)),
          quoteTime,
          planExpiry,
          100,
          depositSettlementId,
        )
        .accountsStrict({
          keeper: keeper.publicKey,
          config,
          intent: depositIntent,
          plan: depositPlan,
          systemProgram: SystemProgram.programId,
        })
        .signers([keeper])
        .rpc();
    };
    const depositPlanSig = await createDepositPlan();
    await expectFailure(
      () =>
        program.methods
          .recordDepositSettlement(depositSettlementId)
          .accountsStrict({
            keeper: keeper.publicKey,
            config,
            intent: depositIntent,
            plan: depositPlan,
            vaultUsdc,
            vaultBtc,
            vaultEth,
            vaultWsol,
          })
          .signers([keeper])
          .rpc(),
      "settlement before all three buy legs",
    );
    await expectFailure(
      () => createDepositPlan(),
      "duplicate deposit settlement plan",
    );
    const runDepositLeg = async (
      leg: number,
      revision: number,
      routeHash = depositHashes[leg],
    ) =>
      leg === revision &&
      (!journalState || journalState.chainRevision === BigInt(revision)) &&
      Buffer.from(routeHash).equals(Buffer.from(depositHashes[leg]))
        ? runCpiLeg(depositPlan, leg, revision, "buy")
        : program.methods
            .mockExecuteDepositLeg(leg, new BN(revision), routeHash)
            .accountsStrict({
              accounts: commonMock,
              intent: depositIntent,
              plan: depositPlan,
            })
            .signers([keeper])
            .rpc();
    await expectFailure(() => runDepositLeg(1, 0), "skipped first buy leg");
    await expectFailure(
      () => runDepositLeg(0, 0, depositHashes[1]),
      "altered buy route commitment",
    );
    const depositLegSigs: string[] = [];
    depositLegSigs.push(await runDepositLeg(0, 0));
    assert.equal(await balance(vaultUsdc), 600_000n);
    assert.equal(await balance(vaultBtc), 40_000n);
    await expectFailure(() => runDepositLeg(0, 0), "duplicate first buy leg");
    await expectFailure(() => runDepositLeg(1, 0), "stale plan revision");
    await expectFailure(
      () => runDepositLeg(1, 1, depositHashes[0]),
      "interrupted second buy leg with changed route",
    );
    assert.equal(await balance(vaultUsdc), 600_000n);
    assert.equal(
      (await fetchState("settlementPlan", depositPlan)).executedBitmap,
      1,
    );
    depositLegSigs.push(await runDepositLeg(1, 1));
    assert.equal(await balance(vaultUsdc), 300_000n);
    assert.equal(await balance(vaultEth), 30_000n);
    await expectFailure(
      () => runDepositLeg(2, 2, depositHashes[1]),
      "interrupted third buy leg with changed route",
    );
    assert.equal(await balance(vaultUsdc), 300_000n);
    assert.equal(
      (await fetchState("settlementPlan", depositPlan)).executedBitmap,
      3,
    );
    depositLegSigs.push(await runDepositLeg(2, 2));
    assert.equal(await balance(vaultUsdc), 0n);
    const depositPlanState = await fetchState("settlementPlan", depositPlan);
    assert.equal(depositPlanState.executedBitmap, 7);
    assert.equal((depositPlanState.revision as BN).toNumber(), 3);
    const planAccount = await connection.getAccountInfo(
      depositPlan,
      "confirmed",
    );
    assert.ok(planAccount, "settlement plan persists on the local validator");
    const decodedPlan = readOnlyClient.decodeSettlementPlan(
      planAccount.data,
    ) as { executed_bitmap: number; revision: BN };
    assert.equal(decodedPlan.executed_bitmap, 7);
    assert.equal(decodedPlan.revision.toNumber(), 3);
    await expectFailure(
      () =>
        program.methods
          .recordDepositSettlement(depositSettlementId)
          .accountsStrict({
            keeper: attacker.publicKey,
            config,
            intent: depositIntent,
            plan: depositPlan,
            vaultUsdc,
            vaultBtc,
            vaultEth,
            vaultWsol,
          })
          .signers([attacker])
          .rpc(),
      "unauthorized keeper settlement record",
    );
    await expectFailure(() => runDepositLeg(2, 3), "duplicate third buy leg");
    await expectFailure(
      () =>
        program.methods
          .mockExecuteDepositLeg(2, new BN(3), depositHashes[2])
          .accountsStrict({
            accounts: { ...commonMock, vaultBtc: attackerUsdc },
            intent: depositIntent,
            plan: depositPlan,
          })
          .signers([keeper])
          .rpc(),
      "third-party settlement destination",
    );
    const recordDepositSig = await program.methods
      .recordDepositSettlement(depositSettlementId)
      .accountsStrict({
        keeper: keeper.publicKey,
        config,
        intent: depositIntent,
        plan: depositPlan,
        vaultUsdc,
        vaultBtc,
        vaultEth,
        vaultWsol,
      })
      .signers([keeper])
      .rpc();
    const depositState = await fetchState("depositIntent", depositIntent);
    assert.equal((depositState.btcInputUsdc as BN).toNumber(), 400_000);
    assert.equal((depositState.ethInputUsdc as BN).toNumber(), 300_000);
    assert.equal((depositState.wsolInputUsdc as BN).toNumber(), 300_000);
    await expectFailure(
      () =>
        program.methods
          .recordDepositSettlement(depositSettlementId)
          .accountsStrict({
            keeper: keeper.publicKey,
            config,
            intent: depositIntent,
            plan: depositPlan,
            vaultUsdc,
            vaultBtc,
            vaultEth,
            vaultWsol,
          })
          .signers([keeper])
          .rpc(),
      "duplicate deposit settlement record",
    );
    await expectFailure(
      () =>
        program.methods
          .issueInitialShares()
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: depositIntent,
            vaultAuthority,
            shareMint: shareMint.publicKey,
            ownerShares: attackerShares,
            vaultUsdc,
            vaultBtc,
            vaultEth,
            vaultWsol,
            shareTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "shares minted to attacker",
    );
    assert.deepEqual(
      [
        await balance(vaultBtc),
        await balance(vaultEth),
        await balance(vaultWsol),
      ],
      [40_000n, 30_000n, 30_000n],
    );
    assert.equal(await balance(vaultUsdc), 0n);
    const shareSig = await program.methods
      .issueInitialShares()
      .accountsStrict({
        owner: owner.publicKey,
        config,
        intent: depositIntent,
        vaultAuthority,
        shareMint: shareMint.publicKey,
        ownerShares,
        vaultUsdc,
        vaultBtc,
        vaultEth,
        vaultWsol,
        shareTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
    await checkpoint("buying", "active", depositPlan, 3n, shareSig);
    assert.equal(await balance(ownerShares, TOKEN_2022_PROGRAM_ID), 1_000_000n);
    await expectFailure(
      () =>
        transferChecked(
          connection,
          payer,
          ownerShares,
          shareMint.publicKey,
          attackerShares,
          owner,
          1,
          6,
          undefined,
          undefined,
          TOKEN_2022_PROGRAM_ID,
        ),
      "share transfer must be rejected by Token-2022",
    );
    for (const mint of [btcMint, ethMint, wsolMint]) {
      const ownerAssetAta = getAssociatedTokenAddressSync(
        mint,
        owner.publicKey,
      );
      assert.equal(
        await connection.getAccountInfo(ownerAssetAta),
        null,
        "underlying asset must not reach user",
      );
    }
    assert.equal((await fetchState("depositIntent", depositIntent)).status, 5);
    await expectFailure(
      () =>
        program.methods
          .issueInitialShares()
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: depositIntent,
            vaultAuthority,
            shareMint: shareMint.publicKey,
            ownerShares,
            vaultUsdc,
            vaultBtc,
            vaultEth,
            vaultWsol,
            shareTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "duplicate share issuance",
    );

    const redemptionNonce = 1;
    const redemptionIntent = intent(
      "redemption",
      owner.publicKey,
      redemptionNonce,
    );
    const createRedemption = (shares: number) =>
      program.methods
        .createRedemptionIntent(
          new BN(redemptionNonce),
          new BN(shares),
          new BN(1),
          expires(),
        )
        .accountsStrict({
          owner: owner.publicKey,
          config,
          intent: redemptionIntent,
          ownerShares,
          vaultBtc,
          vaultEth,
          vaultWsol,
          vaultUsdc,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();
    await expectFailure(() => createRedemption(0), "zero redemption");
    await expectFailure(() => createRedemption(500_000), "partial redemption");
    await expectFailure(
      () =>
        program.methods
          .createRedemptionIntent(
            new BN(redemptionNonce),
            new BN(1_000_000),
            new BN(1),
            new BN(Math.floor(Date.now() / 1000) - 1),
          )
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: redemptionIntent,
            ownerShares,
            vaultBtc,
            vaultEth,
            vaultWsol,
            vaultUsdc,
            systemProgram: SystemProgram.programId,
          })
          .signers([owner])
          .rpc(),
      "expired redemption",
    );
    const redemptionCreateSig = await createRedemption(1_000_000);
    await expectFailure(
      () => createRedemption(1_000_000),
      "duplicate redemption",
    );
    await expectFailure(
      () =>
        program.methods
          .claimUsdc()
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: redemptionIntent,
            vaultAuthority,
            vaultUsdc,
            ownerUsdc,
            usdcMint,
            shareMint: shareMint.publicKey,
            ownerShares,
            shareTokenProgram: TOKEN_2022_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "claim before liquidation",
    );
    const lockSig = await program.methods
      .lockSharesForRedemption()
      .accountsStrict({
        owner: owner.publicKey,
        config,
        intent: redemptionIntent,
        ownerShares,
        shareMint: shareMint.publicKey,
        shareTokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
    assert.equal(await balance(ownerShares, TOKEN_2022_PROGRAM_ID), 1_000_000n);
    await expectFailure(
      () =>
        program.methods
          .lockSharesForRedemption()
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: redemptionIntent,
            ownerShares,
            shareMint: shareMint.publicKey,
            shareTokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "duplicate lock",
    );
    const redemptionSettlementId = Array.from({ length: 32 }, () => 2);
    const redemptionPlan = settlementPlan(redemptionIntent);
    const redemptionHashes = [4, 5, 6].map((value) =>
      Array.from({ length: 32 }, () => value),
    );
    const [redemptionQuoteTime, redemptionPlanExpiry] = await settlementTimes();
    const redemptionPlanSig = await program.methods
      .createRedemptionSettlementPlan(
        redemptionHashes,
        [396_000, 297_000, 297_000].map((value) => new BN(value)),
        redemptionQuoteTime,
        redemptionPlanExpiry,
        100,
        redemptionSettlementId,
      )
      .accountsStrict({
        keeper: keeper.publicKey,
        config,
        intent: redemptionIntent,
        plan: redemptionPlan,
        systemProgram: SystemProgram.programId,
      })
      .signers([keeper])
      .rpc();
    await checkpoint(
      "active",
      "redemption_requested",
      redemptionPlan,
      0n,
      redemptionPlanSig,
    );
    await expectFailure(
      () =>
        program.methods
          .recordRedemptionSettlement(redemptionSettlementId)
          .accountsStrict({
            keeper: keeper.publicKey,
            config,
            intent: redemptionIntent,
            plan: redemptionPlan,
            vaultUsdc,
            vaultBtc,
            vaultEth,
            vaultWsol,
          })
          .signers([keeper])
          .rpc(),
      "redemption settlement before all three sell legs",
    );
    const runRedemptionLeg = async (
      leg: number,
      revision: number,
      routeHash = redemptionHashes[leg],
    ) =>
      leg === revision &&
      (!journalState || journalState.chainRevision === BigInt(revision)) &&
      Buffer.from(routeHash).equals(Buffer.from(redemptionHashes[leg]))
        ? runCpiLeg(redemptionPlan, leg, revision, "sell")
        : program.methods
            .mockExecuteRedemptionLeg(leg, new BN(revision), routeHash)
            .accountsStrict({
              accounts: commonMock,
              intent: redemptionIntent,
              plan: redemptionPlan,
            })
            .signers([keeper])
            .rpc();
    await expectFailure(() => runRedemptionLeg(2, 0), "skipped sell leg");
    const redemptionLegSigs: string[] = [];
    redemptionLegSigs.push(await runRedemptionLeg(0, 0));
    assert.equal(await balance(vaultBtc), 0n);
    assert.equal(await balance(vaultUsdc), 396_000n);
    await expectFailure(
      () => runRedemptionLeg(1, 1, redemptionHashes[0]),
      "interrupted second sell leg with changed route",
    );
    assert.equal(await balance(vaultUsdc), 396_000n);
    assert.equal(
      (await fetchState("settlementPlan", redemptionPlan)).executedBitmap,
      1,
    );
    redemptionLegSigs.push(await runRedemptionLeg(1, 1));
    assert.equal(await balance(vaultEth), 0n);
    redemptionLegSigs.push(await runRedemptionLeg(2, 2));
    assert.equal(await balance(vaultWsol), 0n);
    assert.equal(await balance(vaultUsdc), 990_000n);
    await expectFailure(
      () => runRedemptionLeg(2, 3),
      "duplicate third sell leg",
    );
    const recordRedemptionSig = await program.methods
      .recordRedemptionSettlement(redemptionSettlementId)
      .accountsStrict({
        keeper: keeper.publicKey,
        config,
        intent: redemptionIntent,
        plan: redemptionPlan,
        vaultUsdc,
        vaultBtc,
        vaultEth,
        vaultWsol,
      })
      .signers([keeper])
      .rpc();
    await checkpoint(
      "selling",
      "claimable",
      redemptionPlan,
      3n,
      recordRedemptionSig,
    );
    await expectFailure(
      () =>
        program.methods
          .recordRedemptionSettlement(redemptionSettlementId)
          .accountsStrict({
            keeper: keeper.publicKey,
            config,
            intent: redemptionIntent,
            plan: redemptionPlan,
            vaultUsdc,
            vaultBtc,
            vaultEth,
            vaultWsol,
          })
          .signers([keeper])
          .rpc(),
      "duplicate redemption settlement record",
    );
    assert.equal(await balance(vaultUsdc), 990_000n);
    const claimable = (await fetchState("redemptionIntent", redemptionIntent))
      .usdcClaimable as BN;
    assert.equal(claimable.toNumber(), 990_000);
    const pauseBeforeClaimSig = await program.methods
      .pause()
      .accountsStrict({ authority: payer.publicKey, config })
      .rpc();
    assert.equal((await fetchState("vaultConfig", config)).paused, true);
    await expectFailure(
      () =>
        program.methods
          .claimUsdc()
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: redemptionIntent,
            vaultAuthority,
            vaultUsdc,
            ownerUsdc: attackerUsdc,
            usdcMint,
            shareMint: shareMint.publicKey,
            ownerShares,
            shareTokenProgram: TOKEN_2022_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "claim to attacker",
    );
    const claimSig = await program.methods
      .claimUsdc()
      .accountsStrict({
        owner: owner.publicKey,
        config,
        intent: redemptionIntent,
        vaultAuthority,
        vaultUsdc,
        ownerUsdc,
        usdcMint,
        shareMint: shareMint.publicKey,
        ownerShares,
        shareTokenProgram: TOKEN_2022_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
    await checkpoint("claimable", "redeemed", redemptionPlan, 3n, claimSig);
    if (durable) {
      assert.equal((await durable.db.read(journalId))?.state, "redeemed");
      for (let ordinal = 0; ordinal < 6; ordinal++) {
        const leg: { state: string; signature: string | null } =
          await durable.db.readLeg(journalId, ordinal);
        assert.equal(leg.state, "confirmed");
        assert.ok(
          leg.signature,
          "confirmed leg signature must survive restart",
        );
      }
    }
    assert.equal(await balance(ownerUsdc), 990_000n);
    assert.equal(await balance(ownerShares, TOKEN_2022_PROGRAM_ID), 0n);
    assert.equal(await balance(vaultUsdc), 0n);
    assert.equal(
      (await fetchState("redemptionIntent", redemptionIntent)).status,
      6,
    );
    await expectFailure(
      () =>
        program.methods
          .claimUsdc()
          .accountsStrict({
            owner: owner.publicKey,
            config,
            intent: redemptionIntent,
            vaultAuthority,
            vaultUsdc,
            ownerUsdc,
            usdcMint,
            shareMint: shareMint.publicKey,
            ownerShares,
            shareTokenProgram: TOKEN_2022_PROGRAM_ID,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "duplicate claim",
    );
    const closeSig = await program.methods
      .closeCompletedIntent()
      .accountsStrict({
        owner: owner.publicKey,
        config,
        redemption: redemptionIntent,
      })
      .signers([owner])
      .rpc();
    assert.equal(await connection.getAccountInfo(redemptionIntent), null);
    assert.equal((await fetchState("vaultConfig", config)).lifecycle, 4);
    console.log(
      JSON.stringify({
        network: "local-validator-only",
        programId: program.programId.toBase58(),
        amounts: {
          depositedUSDC: "1000000",
          mockBTC: "40000",
          mockETH: "30000",
          mockWSOL: "30000",
          sharesIssued: "1000000",
          sharesBurned: "1000000",
          usdcReturned: "990000",
          mockSlippage: "10000",
        },
        signatures: {
          initSig,
          createSig,
          depositSig,
          depositPlanSig,
          depositLegSigs,
          recordDepositSig,
          shareSig,
          redemptionCreateSig,
          lockSig,
          redemptionPlanSig,
          redemptionLegSigs,
          recordRedemptionSig,
          pauseBeforeClaimSig,
          claimSig,
          closeSig,
        },
      }),
    );
  },
);
