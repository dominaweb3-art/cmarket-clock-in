/** LOCAL CLONED BANK, not Mainnet acquisition. All transaction keys are
 * generated here in memory. Exactly one synthetic owner USDC genesis fixture.
 * Real Jupiter and Whirlpool binaries/state; canonical vault lifecycle + PG.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  AnchorProvider,
  Program,
  Wallet,
  BN,
  type Idl,
} from "@coral-xyz/anchor";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getMintLen,
  createInitializeNonTransferableMintInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  Connection,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  CloneBank,
  cycleHash,
} from "../../../services/c3-mainnet/pilot-open-local/clone-bank.ts";
import {
  JupiterV2ReadOnlyClient,
  type RouterBuild,
  type RouterRequest,
} from "../../../services/c3-mainnet/src/jupiter-v2.ts";
import { C3_MAINNET as c } from "../../../services/c3-mainnet/src/constants.ts";
import {
  VAULT_PROGRAM,
  VAULT_AUTHORITY,
  vaultAta,
} from "../../../services/c3-mainnet/pilot-open-local/jupiter-vault-cpi-inspection.ts";
import { openValidatorJournal } from "../../../services/c3-mainnet/pilot-open-local/validator-bridge.ts";
import { IsolatedOpenTestSigner } from "../../../services/c3-mainnet/pilot-open-local/isolated-test-signer.ts";
import { prepareOpenUnsignedLeg } from "../../../services/c3-mainnet/pilot-open-local/open-quote-workflow.ts";
import {
  OpenLocalSettlementRepository,
  type OpenSnapshot,
  type Scope,
} from "../../../services/c3-mainnet/pilot-open-local/orchestrator.ts";
import { encodeBase58 } from "../../../services/c3-mainnet/src/solana.ts";
import { validateDirectWhirlpoolRoute } from "../../../services/c3-mainnet/pilot-open-local/jupiter-route-v2.ts";
import { createReadServer } from "../../../services/c3-mainnet/pilot-open-local/read-server.ts";
import { createCycleController } from "../../../services/c3-mainnet/pilot-open-local/cycle-controller.ts";
import { reconcilePersistedOpenLeg } from "../../../services/c3-mainnet/pilot-open-local/open-reconcile.ts";
import {
  prepareLocalRenewal,
  reconcileLocalRenewal,
  recordLocalRenewalSignature,
} from "../../../services/c3-mainnet/pilot-open-local/plan-generations.ts";
import { createIsolatedOwnerServer } from "../../../services/c3-mainnet/pilot-open-local/owner-server.ts";
import { recordLocalFinalizedOwnerMessage } from "../../../services/c3-mainnet/pilot-open-local/owner-operations.ts";
import { ownerBackend } from "../../../apps/c3-pilot/src/owner-backend.ts";
import { OwnerController } from "../../../apps/c3-pilot/src/owner-controller.ts";
import type {
  MoneyAction,
  OwnerPolicy,
} from "../../../apps/c3-pilot/src/owner-policy.ts";
const idl = JSON.parse(
  readFileSync(
    new URL("../target/idl/c3_pilot_vault.json", import.meta.url),
    "utf8",
  ),
) as Idl;
const bank = new CloneBank();
let ownerServer: ReturnType<typeof createIsolatedOwnerServer> | undefined;
const governance = Keypair.generate(),
  owner = Keypair.generate(),
  keeper = Keypair.generate(),
  emergency = Keypair.generate(),
  share = Keypair.generate();
const config = PublicKey.findProgramAddressSync(
  [Buffer.from("c3-vault-v1")],
  VAULT_PROGRAM,
)[0];
const derive = (seed: string, k: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from(seed), k.toBuffer()],
    VAULT_PROGRAM,
  )[0];
const registry = derive("c3-route-reg-v1", config),
  policy = derive("c3-quote-policy-v1", config);
const ownerUsdc = PublicKey.findProgramAddressSync(
  [
    owner.publicKey.toBuffer(),
    TOKEN_PROGRAM_ID.toBuffer(),
    new PublicKey(c.usdcMint).toBuffer(),
  ],
  new PublicKey(c.associatedTokenProgram),
)[0];
const assets = [c.cbBtcMint, c.portalEthMint, c.wrappedSolMint];
const holdings = {
  vaultUsdc: new PublicKey(vaultAta(c.usdcMint)),
  vaultBtc: new PublicKey(vaultAta(c.cbBtcMint)),
  vaultEth: new PublicKey(vaultAta(c.portalEthMint)),
  vaultWsol: new PublicKey(vaultAta(c.wrappedSolMint)),
};
const jupiter = new JupiterV2ReadOnlyClient({
  fetchImpl: (url, init) => {
    const u = new URL(String(url));
    if (u.origin !== "https://api.jup.ag" || init?.method !== "GET")
      throw Error("C3_CYCLE_READ_ONLY_JUPITER");
    u.searchParams.set("dexes", "Whirlpool");
    return fetch(u, init);
  },
});
const request = (leg: number, amount: bigint): RouterRequest => ({
  inputMint: leg < 3 ? c.usdcMint : assets[leg % 3]!,
  outputMint: leg < 3 ? assets[leg % 3]! : c.usdcMint,
  amount,
  taker: VAULT_AUTHORITY.toBase58(),
  destinationTokenAccount: vaultAta(leg < 3 ? assets[leg % 3]! : c.usdcMint),
  slippageBps: 100,
  maxAccounts: 16,
});
function tokenFixture(
  address: PublicKey,
  mint: string,
  authority: PublicKey,
  amount: bigint,
) {
  const data = Buffer.alloc(165);
  new PublicKey(mint).toBuffer().copy(data);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  const native = mint === c.wrappedSolMint;
  if (native) {
    data.writeUInt32LE(1, 109);
    data.writeBigUInt64LE(2_039_280n, 113);
  }
  bank.fixture(address.toBase58(), {
    owner: TOKEN_PROGRAM_ID,
    data,
    executable: false,
    lamports: Number(2_039_280n + (native ? amount : 0n)),
  });
}
class FrozenFreshRoute extends JupiterV2ReadOnlyClient {
  private readonly build: RouterBuild;
  constructor(build: RouterBuild) {
    super();
    this.build = build;
  }
  override async getExactInQuote(r: RouterRequest) {
    assert.equal(r.inputMint, this.build.inputMint);
    assert.equal(r.outputMint, this.build.outputMint);
    assert.equal(r.amount.toString(), this.build.inAmount);
    assert.ok(
      Date.now() < this.build.blockhashWithMetadata.fetchedAtEpochMs + 30_000,
    );
    return this.build;
  }
}
let stage = "warm-clone",
  local: Connection | undefined,
  signer: IsolatedOpenTestSigner | undefined,
  journal: Awaited<ReturnType<typeof openValidatorJournal>> | undefined;
const report: Record<string, unknown> = {
  scope: "LOCAL_CLONED_JUPITER",
  mainnetAcquisition: false,
  syntheticInputUsdc: "1000000",
  legs: [],
};
const steps = report.legs as Record<string, unknown>[];
const controller = process.argv.includes("--app-control")
  ? createCycleController(() => ({
      stage,
      confirmedLegs: steps.length,
      sharesIssued: String(report.sharesIssued ?? "0"),
      sharesBurned: String(report.sharesBurned ?? "0"),
      usdcReturned: String(report.usdcReturned ?? "0"),
    }))
  : null;
try {
  if (controller) {
    await new Promise<void>((r) =>
      controller.server.listen(8787, "127.0.0.1", r),
    );
    console.log("LOCAL_CYCLE_APP_READY:8787");
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        controller.started,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("C3_APP_CONTROL_TIMEOUT")),
            900_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer!);
    }
  }
  for (const k of [governance, owner, keeper, emergency])
    bank.fixture(k.publicKey.toBase58(), {
      owner: SystemProgram.programId,
      data: Buffer.alloc(0),
      lamports: 10_000_000_000,
      executable: false,
    });
  tokenFixture(ownerUsdc, c.usdcMint, owner.publicKey, 1_000_000n);
  bank.fixture(VAULT_AUTHORITY.toBase58(), {
    owner: SystemProgram.programId,
    data: Buffer.alloc(0),
    lamports: 1_000_000,
    executable: false,
  });
  for (const mint of [c.usdcMint, ...assets])
    tokenFixture(new PublicKey(vaultAta(mint)), mint, VAULT_AUTHORITY, 0n);
  // Warm all directions, but NEVER execute these quotes or pre-fund sell assets.
  const warmFresh = async (r: RouterRequest): Promise<RouterBuild> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const build = await jupiter.getExactInQuote(r);
      validateDirectWhirlpoolRoute(build, {
        authority: r.taker,
        source: vaultAta(r.inputMint),
        destination: vaultAta(r.outputMint),
        inputMint: r.inputMint,
        outputMint: r.outputMint,
        inputAmount: r.amount,
        maxSlippageBps: 100,
      });
      try {
        await bank.warm(build);
        return build;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.startsWith("C3_BANK_PUBLIC_ACCOUNT_MISSING:") ||
          attempt === 2
        )
          throw error;
      }
    }
    throw Error("C3_BANK_FRESH_PREPARATION_EXHAUSTED");
  };
  for (let n = 0; n < 3; n++) {
    const buy = await warmFresh(request(n, n === 0 ? 400_000n : 300_000n));
    await warmFresh(request(n + 3, BigInt(buy.outAmount)));
  }
  // Clone bounded authenticated asset-pair pools, not a growing hardcoded list
  // of pools from failed quotes. No mutation is allowed after bank.start().
  await bank.warmAssetPairPools();
  // Public tables observed in these official build responses. They are not
  // trusted by address alone: warmLookupTable checks current RPC ownership and
  // activity, and each selected authorization binds exact resolved contents.
  for (const table of [
    "3xNgJps1ngjeLuj586aAmYMoR6HD6hwqkLMDD1sjNRPm",
    "9AsimPML6N36BAe8keQRAHpLuKgCKv9QJV9912TXZhBD",
    "CoSBewWF5pNJ6fiJSNJj6XNcMPWC5wa9gnAPwFvcrwzx",
    "DgWeFqhGCczQw3WhXGVVU8U3QwSFZSGGkQ5FXbNb1iHX",
    "93LqNFYWTiDrjgCdJ8tK22fTSBpCZXtSaQ8YeHkZ1WS1",
    "E7fYV7bWfHLTy1R98Nxzyx2S8MC6d3Rmuh1SHj5H7mB5",
    "J7znuMyVHurxwjL19Rbtq2CSbjPEhqWvwEcgdWajEtnc",
  ])
    await bank.warmLookupTable(table);
  stage = "start-bank";
  local = await bank.start();
  journal = await openValidatorJournal();
  signer = await IsolatedOpenTestSigner.start();
  const provider = new AnchorProvider(local, new Wallet(governance), {
    commitment: "confirmed",
  });
  const confirmed = async (signature: string) => {
    for (let n = 0; n < 100; n++) {
      const s = (
        await local!.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (s?.err)
        throw Error("C3_CYCLE_CONFIRMED_TX_ERROR:" + JSON.stringify(s.err));
      if (s && ["confirmed", "finalized"].includes(s.confirmationStatus ?? ""))
        return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw Error("C3_CYCLE_CONFIRM_TIMEOUT_NO_RESEND");
  };
  provider.sendAndConfirm = async (tx, signers = []) => {
    const latest = await local!.getLatestBlockhash();
    if (tx instanceof Transaction) {
      tx.feePayer = governance.publicKey;
      tx.recentBlockhash = latest.blockhash;
      tx.partialSign(governance, ...signers);
    } else tx.sign([governance, ...signers]);
    const signature = await local!.sendRawTransaction(tx.serialize(), {
      maxRetries: 0,
    });
    await confirmed(signature);
    return signature;
  };
  const program = new Program(idl, provider);
  const finalized = async (signature: string) => {
    for (let n = 0; n < 120; n++) {
      const s = (
        await local!.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        })
      ).value[0];
      if (s?.err) throw Error("C3_CYCLE_TX_FAILED");
      if (s?.confirmationStatus === "finalized") return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw Error("C3_CYCLE_FINALITY_TIMEOUT");
  };
  const now = async () => {
    const clock = await local!.getAccountInfo(
      new PublicKey("SysvarC1ock11111111111111111111111111111111"),
    );
    assert.ok(clock);
    return Number(clock.data.readBigInt64LE(32));
  };
  const instruction = async (
    name: string,
    args: unknown[],
    accounts: Record<string, PublicKey>,
    signers: Keypair[] = [],
  ) => {
    const builder = program.methods[name]!(...args)
      .accountsStrict(accounts)
      .signers(signers);
    return builder.rpc();
  };
  const mintLen = getMintLen([ExtensionType.NonTransferable]),
    rent = await local.getMinimumBalanceForRentExemption(mintLen);
  await provider.sendAndConfirm(
    new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: governance.publicKey,
        newAccountPubkey: share.publicKey,
        lamports: rent,
        space: mintLen,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeNonTransferableMintInstruction(
        share.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMintInstruction(
        share.publicKey,
        6,
        VAULT_AUTHORITY,
        VAULT_AUTHORITY,
        TOKEN_2022_PROGRAM_ID,
      ),
    ),
    [share],
  );
  const ownerShares = getAssociatedTokenAddressSync(
    share.publicKey,
    owner.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  await provider.sendAndConfirm(
    new Transaction().add(
      createAssociatedTokenAccountInstruction(
        governance.publicKey,
        ownerShares,
        owner.publicKey,
        share.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
    ),
  );
  stage = "initialize-canonical-vault";
  await instruction(
    "initializeVault",
    [keeper.publicKey, new BN(1), [4000, 3000, 3000], new BN(1_000_000)],
    {
      payer: governance.publicKey,
      governance: governance.publicKey,
      emergency: emergency.publicKey,
      owner: owner.publicKey,
      vaultAuthority: VAULT_AUTHORITY,
      config,
      usdcMint: new PublicKey(c.usdcMint),
      btcMint: new PublicKey(c.cbBtcMint),
      ethMint: new PublicKey(c.portalEthMint),
      wsolMint: new PublicKey(c.wrappedSolMint),
      shareMint: share.publicKey,
      ...holdings,
      tokenProgram: TOKEN_PROGRAM_ID,
      shareTokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    },
  );
  await instruction("initializeRouteRegistry", [], {
    governance: governance.publicKey,
    config,
    registry,
    systemProgram: SystemProgram.programId,
  });
  await instruction("initializeQuotePolicy", [], {
    governance: governance.publicKey,
    config,
    policy,
    systemProgram: SystemProgram.programId,
  });
  await instruction(
    "configureQuotePolicy",
    [
      new PublicKey(signer.publicKey),
      [...new PublicKey(await local.getGenesisHash()).toBuffer()],
      new BN(30),
      100,
    ],
    { governance: governance.publicKey, config, policy },
  );
  const programs = [
      c.jupiterProgram,
      "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
      c.tokenProgram,
      // Official Orca SwapV2 readonly account. Legacy SPL mints have no memo
      // extension: the economic verifier still rejects any actual Memo CPI.
      "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    ].map((v) => new PublicKey(v)),
    slot = await local.getSlot(),
    end = slot + 10_000;
  const u64 = (v: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(v));
    return b;
  };
  const registryHash = createHash("sha256")
    .update(
      Buffer.concat([
        Buffer.from("c3-route-registry-v1"),
        config.toBuffer(),
        u64(1),
        u64(slot),
        u64(end),
        Buffer.from([programs.length]),
        ...programs.map((p) => p.toBuffer()),
      ]),
    )
    .digest();
  await program.methods.replaceRouteRegistry!(
    programs,
    new BN(slot),
    new BN(end),
    [...registryHash],
  )
    .accountsStrict({ governance: governance.publicKey, config, registry })
    .remainingAccounts(
      programs.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      })),
    )
    .rpc();
  const unpauseSig = await instruction("unpause", [], {
    authority: governance.publicKey,
    config,
  });
  await finalized(unpauseSig);
  const intent = (seed: string) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from(seed),
        config.toBuffer(),
        owner.publicKey.toBuffer(),
        u64(1),
      ],
      VAULT_PROGRAM,
    )[0];
  const depositIntent = intent("deposit"),
    depositPlan = derive("c3-plan-v1", depositIntent),
    redemptionIntent = intent("redemption"),
    redemptionPlan = derive("c3-plan-v1", redemptionIntent);
  const id = randomUUID();
  let db = journal.db;
  let state: OpenSnapshot = await db.createDraft({
    intentId: id,
    wallet: owner.publicKey.toBase58(),
    vault: config.toBase58(),
    shareMint: share.publicKey.toBase58(),
    depositPlan: depositPlan.toBase58(),
    configurationHash: cycleHash(Buffer.from("c3-real-local-cycle-v1")),
    expiresAt: new Date(Date.now() + 3_600_000),
    idempotencyHash: cycleHash(Buffer.from(randomUUID())),
  });
  const scope = (): Scope => ({
    intentId: id,
    wallet: state.wallet,
    vault: state.vault,
    expectedDbRevision: state.dbRevision,
    expectedChainRevision: state.chainRevision,
    idempotencyHash: cycleHash(Buffer.from(randomUUID())),
  });
  const clientPolicy: OwnerPolicy = {
    wallet: owner.publicKey.toBytes(),
    program: VAULT_PROGRAM.toBytes(),
    accounts: Object.fromEntries(
      Object.entries({
        config,
        deposit_intent: depositIntent,
        redemption_intent: redemptionIntent,
        deposit: depositIntent,
        system_program: SystemProgram.programId,
        vault_authority: VAULT_AUTHORITY,
        share_mint: share.publicKey,
        owner_shares: ownerShares,
        owner_usdc: ownerUsdc,
        usdc_mint: new PublicKey(c.usdcMint),
        token_program: TOKEN_PROGRAM_ID,
        share_token_program: TOKEN_2022_PROGRAM_ID,
        vault_usdc: holdings.vaultUsdc,
        vault_btc: holdings.vaultBtc,
        vault_eth: holdings.vaultEth,
        vault_wsol: holdings.vaultWsol,
      }).map(([name, key]) => [name, key.toBytes()]),
    ),
  };
  ownerServer = createIsolatedOwnerServer(
    journal.pool,
    local,
    idl,
    id,
    (code) => console.error("LOCAL_OWNER_GATE", code),
  );
  await new Promise<void>((resolve) =>
    ownerServer!.listen(0, "127.0.0.1", resolve),
  );
  const ownerAddress = ownerServer.address();
  assert.ok(ownerAddress && typeof ownerAddress !== "string");
  const backend = ownerBackend(
    `http://127.0.0.1:${ownerAddress.port}`,
    (b) => Buffer.from(b).toString("base64"),
    (s) => new Uint8Array(Buffer.from(s, "base64")),
  );
  let stored = "",
    signedPacket: Uint8Array | undefined;
  const flow = new OwnerController({
    gate: () => assert.match(local!.rpcEndpoint, /^http:\/\/127\.0\.0\.1:/),
    wallet: owner.publicKey.toBase58(),
    policy: clientPolicy,
    backend,
    evidenceScope: "LOCAL_CLONE",
    now: () => Math.floor(Date.now() / 1000),
    save: async (r) => {
      stored = JSON.stringify(r);
    },
    signature: (b) =>
      encodeBase58(VersionedTransaction.deserialize(b).signatures[0]!),
    sign: async (b) => {
      const tx = VersionedTransaction.deserialize(b);
      tx.sign([owner]);
      signedPacket = tx.serialize();
      return signedPacket;
    },
  });
  const ownerOperation = async (action: MoneyAction) => {
    if (flow.snapshot) {
      await flow.restore(stored);
      await flow.recover();
      assert.equal(flow.snapshot.state, "finalized");
    }
    signedPacket = undefined;
    await flow.prepare(id, action);
    await flow.approve();
    assert.ok(signedPacket);
    assert.equal(JSON.parse(stored).state, "signed");
    // Ephemeral LOCAL owner, not MWA. Only this isolated harness broadcasts.
    const signature = await local!.sendRawTransaction(signedPacket, {
      skipPreflight: false,
      maxRetries: 0,
    });
    await finalized(signature);
    await recordLocalFinalizedOwnerMessage(
      journal!.pool,
      local!,
      idl,
      scope(),
      flow.snapshot!.requestId,
    );
    await flow.restore(stored);
    await flow.recover();
    assert.equal(flow.snapshot!.signature, signature);
    report.ownerBackendProtocol =
      "same mobile controller: atomic owner packets, real HTTP+PG receipt before explicit local broadcast, restart GET recovery and effect-gated advancement; not physical MWA";
    return signature;
  };
  const depositSig = await ownerOperation("deposit");
  const depositSettlement = Array(32).fill(1),
    redemptionSettlement = Array(32).fill(2);
  const createPlan = async (selling: boolean) => {
    const timestamp = await now();
    return instruction(
      selling
        ? "createRedemptionSettlementPlan"
        : "createDepositSettlementPlan",
      [
        Array.from({ length: 3 }, (_, i) => Array(32).fill(i + 1)),
        [new BN(1), new BN(1), new BN(1)],
        new BN(timestamp),
        new BN(
          timestamp +
            (!selling && process.argv.includes("--renew-plan") ? 5 : 120),
        ),
        100,
        selling ? redemptionSettlement : depositSettlement,
      ],
      {
        keeper: keeper.publicKey,
        config,
        intent: selling ? redemptionIntent : depositIntent,
        plan: selling ? redemptionPlan : depositPlan,
        systemProgram: SystemProgram.programId,
      },
      [keeper],
    );
  };
  const planSig = await createPlan(false);
  await finalized(planSig);
  stage = "durable-funding";
  state = await db.reconcileLocalLifecycle(
    scope(),
    "draft",
    "funded",
    local,
    idl,
    [depositSig, planSig],
  );
  if (process.argv.includes("--renew-plan")) {
    stage = "owner-durable-renewal";
    const old = await local.getAccountInfo(depositPlan, "finalized");
    assert.ok(old);
    const expires = Number(old.data.readBigInt64LE(706));
    const deadline = Date.now() + 20000;
    const finalizedNow = async () => {
      const clock = await local!.getAccountInfo(
        new PublicKey("SysvarC1ock11111111111111111111111111111111"),
        "finalized",
      );
      assert.ok(clock);
      return Number(clock.data.readBigInt64LE(32));
    };
    while ((await finalizedNow()) < expires) {
      assert.ok(Date.now() < deadline, "bounded local Clock expiry wait");
      await new Promise((r) => setTimeout(r, 250));
    }
    const renewal = await prepareLocalRenewal(
      journal.pool,
      local,
      idl,
      scope(),
    );
    const signed = VersionedTransaction.deserialize(renewal.transaction);
    signed.sign([owner]); // ephemeral LOCAL test key, NOT user MWA approval
    await recordLocalRenewalSignature(
      journal.pool,
      local,
      idl,
      scope(),
      renewal.requestId,
      signed.serialize(),
    );
    const signature = await local.sendTransaction(signed, {
      skipPreflight: false,
      maxRetries: 0,
    });
    await finalized(signature);
    const proof = await reconcileLocalRenewal(
      journal.pool,
      local,
      idl,
      scope(),
      renewal.requestId,
      signature,
    );
    state = (await db.read(state.intentId))!;
    assert.equal(state.chainRevision, 1n);
    report.ownerRenewal = {
      signature,
      generation: proof.generation.toString(),
      revision: state.chainRevision.toString(),
      evidenceHash: proof.evidenceHash,
      mwaUserApproval: false,
    };
  }
  const buys: bigint[] = [];
  for (let ordinal = 0; ordinal < 6; ordinal++) {
    if (ordinal === 3) {
      stage = "issue-shares";
      const recordSig = await instruction(
        "recordDepositSettlement",
        [depositSettlement],
        {
          keeper: keeper.publicKey,
          config,
          intent: depositIntent,
          plan: depositPlan,
          ...holdings,
        },
        [keeper],
      );
      await finalized(recordSig);
      const shareSig = await ownerOperation("issue_shares");
      await finalized(shareSig);
      state = await db.reconcileLocalLifecycle(
        scope(),
        "buying",
        "active",
        local,
        idl,
        [recordSig, shareSig],
      );
      assert.equal(
        (
          await getAccount(
            local,
            ownerShares,
            "finalized",
            TOKEN_2022_PROGRAM_ID,
          )
        ).amount,
        1_000_000n,
      );
      report.sharesIssued = "1000000";
      const createSig = await ownerOperation("request_redemption");
      const redPlanSig = await createPlan(true);
      await finalized(redPlanSig);
      state = await db.reconcileLocalLifecycle(
        scope(),
        "active",
        "redemption_requested",
        local,
        idl,
        [createSig, redPlanSig],
      );
    }
    stage = `leg-${ordinal}-fresh-route`;
    const amount: bigint =
      ordinal < 3
        ? ordinal === 0
          ? 400_000n
          : 300_000n
        : (
            await getAccount(
              local,
              new PublicKey(vaultAta(assets[ordinal % 3]!)),
            )
          ).amount;
    if (ordinal >= 3)
      assert.equal(
        amount,
        buys[ordinal % 3],
        "sell input must equal this run's purchased balance",
      );
    const req = request(ordinal, amount);
    let build: RouterBuild | undefined;
    // Quotes only: bounded fresh route selection BEFORE any authorization or
    // submission. Never retry an uncertain transaction or mutate this bank.
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = await jupiter.getExactInQuote(req);
      try {
        await bank.verifyRoute(local, candidate);
        build = candidate;
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.startsWith("C3_BANK_FRESH_ROUTE_MISSING:") ||
          attempt === 2
        )
          throw error;
      }
    }
    assert.ok(build);
    validateDirectWhirlpoolRoute(build, {
      authority: req.taker,
      source: vaultAta(req.inputMint),
      destination: vaultAta(req.outputMint),
      inputMint: req.inputMint,
      outputMint: req.outputMint,
      inputAmount: amount,
      maxSlippageBps: 100,
    });
    let worker = randomUUID();
    const competitor = randomUUID();
    const old = scope();
    const leases = await Promise.allSettled([
      db.lease(old, ordinal, worker),
      db.lease(old, ordinal, competitor),
    ]);
    assert.equal(leases.filter((v) => v.status === "fulfilled").length, 1);
    state = (
      leases.find(
        (v) => v.status === "fulfilled",
      ) as PromiseFulfilledResult<OpenSnapshot>
    ).value;
    if (leases[1]?.status === "fulfilled") worker = competitor;
    stage = `leg-${ordinal}-durable-authorization`;
    const prepared = await prepareOpenUnsignedLeg(
      {
        pool: journal.pool,
        rpc: local,
        idl,
        signer,
        jupiter: new FrozenFreshRoute(build),
      },
      { intentId: id, ordinal, expectedRevision: state.dbRevision },
    );
    const q: { state: string; canonical_payload: Buffer } = (
      await journal.pool.query(
        "SELECT q.*,ctx.context FROM c3_open.quote_authorizations q JOIN c3_open.quote_contexts ctx USING(intent_id,ordinal,intent_revision) WHERE encode(q.quote_id,'hex')=$1",
        [prepared.quoteId],
      )
    ).rows[0];
    assert.equal(q.state, "signed");
    const seal = q.canonical_payload as Buffer;
    state = await db.prepare(scope(), ordinal, worker, {
      routeHash: seal.subarray(139, 171).toString("hex"),
      instructionHash: seal.subarray(171, 203).toString("hex"),
      authorizationHash: cycleHash(seal),
      inputMint: req.inputMint,
      outputMint: req.outputMint,
      source: vaultAta(req.inputMint),
      destination: vaultAta(req.outputMint),
      inputAmount: amount,
      minimumOutput: seal.readBigUInt64LE(131),
      quoteExpiresAt: new Date(Number(seal.readBigInt64LE(284)) * 1000),
      expectedEffects: { scope: "LOCAL_CLONED_JUPITER" },
    });
    assert.ok(seal.readBigUInt64LE(131) >= BigInt(build.otherAmountThreshold));
    const [authBytes, execBytes] = prepared.unsignedPackets;
    assert.ok(
      authBytes &&
        execBytes &&
        authBytes.length <= 1232 &&
        execBytes.length <= 1232,
    );
    const auth = VersionedTransaction.deserialize(authBytes),
      execute = VersionedTransaction.deserialize(execBytes);
    auth.sign([governance]);
    execute.sign([keeper]);
    stage = `leg-${ordinal}-onchain-authorization`;
    // Local Clock can lag the host by one tick. Wait for its real advancement,
    // never rewrite signed timestamps or prolong an expired quote.
    for (
      let tick = 0;
      tick < 20 && BigInt(await now()) < seal.readBigInt64LE(268);
      tick++
    )
      await new Promise((r) => setTimeout(r, 250));
    assert.ok(BigInt(await now()) >= seal.readBigInt64LE(268));
    assert.ok(BigInt(await now()) < seal.readBigInt64LE(284));
    const authSig = await local.sendRawTransaction(auth.serialize(), {
      maxRetries: 0,
    });
    await confirmed(authSig);
    const signature = encodeBase58(execute.signatures[0]!);
    state = await db.recordSignature(
      scope(),
      ordinal,
      worker,
      signature,
      cycleHash(seal),
    );
    state = await db.markSubmitted(scope(), ordinal, worker, signature);
    stage = `leg-${ordinal}-real-jupiter-cpi`;
    assert.equal(
      await local.sendRawTransaction(execute.serialize(), { maxRetries: 0 }),
      signature,
    );
    await finalized(signature);
    if (ordinal === 1) {
      state = await db.uncertain(
        scope(),
        ordinal,
        "LOCAL_OBSERVATION_INTERRUPTED",
      );
      db = await OpenLocalSettlementRepository.fromVerifiedPool(journal.pool);
      state = (await db.read(id))!;
      assert.equal((await db.readLeg(id, ordinal)).signature, signature);
      state = await db.beginReconciliation(scope(), ordinal);
      report.uncertainRecovery =
        "retained signature; read-only reconciliation, no resend";
    }
    const restarted = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--experimental-strip-types",
          fileURLToPath(
            new URL(
              "../../../services/c3-mainnet/pilot-open-local/cycle-restart-probe.ts",
              import.meta.url,
            ),
          ),
          id,
          String(ordinal),
          signature,
        ],
        { encoding: "utf8", timeout: 20_000 },
      ),
    );
    assert.notEqual(restarted.pid, process.pid);
    assert.equal(restarted.signaturePreserved, true);
    assert.equal(restarted.dbRevision, state.dbRevision.toString());
    report.processRestart =
      "new OS process recovered same PostgreSQL intent/revision/signature";
    if (ordinal === 0) {
      const actual: VersionedTransactionResponse | null =
        await local.getTransaction(signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        });
      assert.ok(actual?.meta);
      for (const mode of ["owner-missing", "extra-debit", "unknown-cpi"]) {
        const hostile = new Connection(local.rpcEndpoint);
        const meta = {
          ...actual.meta,
          preTokenBalances: structuredClone(actual.meta.preTokenBalances),
          postTokenBalances: structuredClone(actual.meta.postTokenBalances),
          innerInstructions: structuredClone(actual.meta.innerInstructions),
        };
        if (mode === "owner-missing") delete meta.preTokenBalances![0]!.owner;
        if (mode === "extra-debit")
          meta.postTokenBalances![0]!.uiTokenAmount.amount = (
            BigInt(meta.postTokenBalances![0]!.uiTokenAmount.amount) + 1n
          ).toString();
        if (mode === "unknown-cpi")
          meta.innerInstructions![0]!.instructions.push({
            programIdIndex: 0,
            accounts: [],
            data: "2",
          });
        hostile.getTransaction = (async () => ({
          ...actual,
          meta,
        })) as Connection["getTransaction"];
        await assert.rejects(
          reconcilePersistedOpenLeg(journal.pool, hostile, id, ordinal),
          /C3_RECONCILE_/,
        );
      }
      report.actualRpcAdversarial =
        "three mutations of actual finalized validator evidence rejected before database promotion";
    }
    stage = `leg-${ordinal}-finalized-reconciliation`;
    state = await db.reconcileLocalJupiterLeg(scope(), ordinal, local);
    await assert.rejects(db.reconcileLocalJupiterLeg(scope(), ordinal, local));
    report.duplicateReconciliation =
      "confirmed legs cannot be promoted twice; no resend";
    const output = (
      await getAccount(local, new PublicKey(vaultAta(req.outputMint)))
    ).amount;
    if (ordinal < 3) buys.push(output);
    steps.push({
      ordinal,
      signature,
      authorizationPersisted: true,
      input: amount.toString(),
      quotedOutput: build.outAmount,
      threshold: build.otherAmountThreshold,
      minimum: seal.readBigUInt64LE(131).toString(),
      bytes: execBytes.length,
      finalized: true,
      reconciled: true,
    });
    console.log(`LOCAL_CLONED_JUPITER_LEG_${ordinal}:PASS`);
    // Reconstruct the service between legs; do not reconstruct or resend packets.
    db = await OpenLocalSettlementRepository.fromVerifiedPool(journal.pool);
    state = (await db.read(id))!;
  }
  stage = "redemption-and-claim";
  const recordSig = await instruction(
    "recordRedemptionSettlement",
    [redemptionSettlement],
    {
      keeper: keeper.publicKey,
      config,
      intent: redemptionIntent,
      plan: redemptionPlan,
      ...holdings,
    },
    [keeper],
  );
  await finalized(recordSig);
  state = await db.reconcileLocalLifecycle(
    scope(),
    "selling",
    "claimable",
    local,
    idl,
    [recordSig],
  );
  const claimAccounts = {
    owner: owner.publicKey,
    config,
    intent: redemptionIntent,
    vaultAuthority: VAULT_AUTHORITY,
    vaultUsdc: holdings.vaultUsdc,
    ownerUsdc,
    usdcMint: new PublicKey(c.usdcMint),
    shareMint: share.publicKey,
    ownerShares,
    shareTokenProgram: TOKEN_2022_PROGRAM_ID,
    tokenProgram: TOKEN_PROGRAM_ID,
  };
  const claimSig = await ownerOperation("claim");
  await finalized(claimSig);
  state = await db.reconcileLocalLifecycle(
    scope(),
    "claimable",
    "redeemed",
    local,
    idl,
    [claimSig],
  );
  assert.equal(
    (await getAccount(local, ownerShares, "finalized", TOKEN_2022_PROGRAM_ID))
      .amount,
    0n,
  );
  assert.equal(state.state, "redeemed");
  await assert.rejects(instruction("claimUsdc", [], claimAccounts, [owner]));
  report.duplicateClaim = "rejected on-chain";
  report.sharesBurned = "1000000";
  report.usdcReturned = (
    await getAccount(local, ownerUsdc, "finalized")
  ).amount.toString();
  report.result = "PASS_LOCAL_CLONED_JUPITER_CYCLE";
  report.intentId = id;
  // Read-only handset view of the SAME durable intent; never a Mainnet position.
  const server = controller ? null : createReadServer(journal.pool);
  if (server) {
    await new Promise<void>((r) => server.listen(8787, "127.0.0.1", r));
    console.log("LOCAL_CYCLE_BACKEND_READY:8787");
    if (process.argv.includes("--hold-viewer"))
      await new Promise((r) => setTimeout(r, 180_000));
    await new Promise<void>((r) => server.close(() => r()));
  }
} catch (error) {
  report.result = "BLOCKED";
  report.stage = stage;
  report.error = error instanceof Error ? error.message : "C3_CYCLE_FAILED";
  console.error("C3_INTEGRATED_CYCLE_BLOCKED", stage, report.error);
  process.exitCode = 1;
} finally {
  if (controller) {
    controller.finish(report.result === "PASS_LOCAL_CLONED_JUPITER_CYCLE");
    bank.writeReport(report);
    await new Promise((r) => setTimeout(r, 180_000));
    await new Promise<void>((r) => controller.server.close(() => r()));
  }
  bank.writeReport(report);
  signer?.close();
  if (ownerServer)
    await new Promise<void>((resolve) => ownerServer!.close(() => resolve()));
  await journal?.close();
  bank.close();
  console.log("C3_CYCLE_REPORT", bank.directory);
}
