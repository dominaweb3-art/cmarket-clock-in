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
  createTransferCheckedInstruction,
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
import {
  prepareOpenUnsignedLeg,
  isolatedServerPolicy,
} from "../../../services/c3-mainnet/pilot-open-local/open-quote-workflow.ts";
import {
  VerifiedSettlementJournal,
  type OpenSnapshot,
  type Scope,
} from "../../../services/c3-mainnet/src/open-settlement-journal.ts";
import {
  isolatedKeeperJournal,
  type KeeperEvidenceIntake,
} from "../../../services/c3-mainnet/src/open-keeper-journal.ts";
import type { KeeperAction } from "../../../services/c3-mainnet/src/open-keeper-compiler.ts";
import { JupiterLegCompiler } from "../../../services/c3-mainnet/src/open-jupiter-compiler.ts";
import {
  applyReviewedOpenSchema,
  enrollOpenOwner,
} from "../../../services/c3-mainnet/src/open-owner-schema.ts";
import type { OpenCompilerPolicy } from "../../../services/c3-mainnet/src/open-owner-compiler.ts";
import { reconcileOwnerEconomicsFromSource } from "../../../services/c3-mainnet/src/open-owner-effects.ts";
import type { collectFinalizedOpenEconomicEvidence } from "../../../services/c3-mainnet/src/open-economic-quorum.ts";
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
import { ownerBackend } from "../../../apps/c3-pilot/src/owner-backend.ts";
import { OwnerController } from "../../../apps/c3-pilot/src/owner-controller.ts";
import { createIsolatedRestrictedPositionReader } from "../../../services/c3-mainnet/src/open-nav-position.ts";
import { approvedOwnerCompilerPolicy } from "../../../services/c3-mainnet/src/open-owner-trust.ts";
import { isolatedLegFactory } from "../../../services/c3-mainnet/src/open-leg-factory.ts";
import { proposeMinimumResolution } from "../../../services/c3-mainnet/src/open-minimum-resolution.ts";
import { verifyOwnerRenewalEvidence } from "../../../services/c3-mainnet/src/open-owner-renewal.ts";
import type { OpenProductionPolicy } from "../../../services/c3-mainnet/src/open-production-policy.ts";
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
  // Explicit synthetic DONOR fixtures only. Each transfers one unit on-chain;
  // these units must survive the six-leg cycle outside the user's position.
  const donorTokens = [c.usdcMint, ...assets].map((mint) =>
    getAssociatedTokenAddressSync(new PublicKey(mint), emergency.publicKey),
  );
  [c.usdcMint, ...assets].forEach((mint, index) =>
    tokenFixture(donorTokens[index]!, mint, emergency.publicKey, 1n),
  );
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
  // Tables observed in previous official build responses are also fetched
  // afresh and checked for owner/activity; not trusted from saved contents.
  // Jupiter may choose one again during sell preparation, minutes after buy.
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
  // Pool discovery can outlast the initial routes. Refresh all six directions
  // once BEFORE bank.start and clone their actual tables/accounts. No address
  // guessed account contents and no funded-bank injection.
  for (let n = 0; n < 3; n++) {
    const buy = await warmFresh(request(n, n === 0 ? 400_000n : 300_000n));
    await warmFresh(request(n + 3, BigInt(buy.outAmount)));
  }
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
  const now = async (commitment: "confirmed" | "finalized" = "confirmed") => {
    const clock = await local!.getAccountInfo(
      new PublicKey("SysvarC1ock11111111111111111111111111111111"),
      commitment,
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
  const donation = await provider.sendAndConfirm(
    new Transaction().add(
      ...[c.usdcMint, ...assets].map((mint, index) =>
        createTransferCheckedInstruction(
          donorTokens[index]!,
          new PublicKey(mint),
          new PublicKey(vaultAta(mint)),
          emergency.publicKey,
          1n,
          [6, 8, 8, 9][index]!,
        ),
      ),
    ),
    [emergency],
  );
  await finalized(donation);
  report.donationFixture =
    "four synthetic donor units transferred locally; excluded from shares, sell budgets and claim";
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
  await applyReviewedOpenSchema(journal.pool);
  // Explicit disposable-DB migration only; source services never auto-migrate.
  let db = new VerifiedSettlementJournal(journal.pool);
  const enrollmentPolicy: OpenCompilerPolicy = {
    version: "c3-owner-compiler/v1",
    program: VAULT_PROGRAM.toBase58(),
    wallet: owner.publicKey.toBase58(),
    vault: config.toBase58(),
    shareMint: share.publicKey.toBase58(),
    governance: governance.publicKey.toBase58(),
    keeper: keeper.publicKey.toBase58(),
    maxSlippageBps: 100,
    idlHash: cycleHash(Buffer.from(JSON.stringify(idl))),
    configurationHash: cycleHash(Buffer.from("c3-real-local-cycle-v1")),
    registryRevision: "1",
    quotePolicyRevision: "1",
  };
  const initial = await local.getMultipleAccountsInfo(
    [config, share.publicKey],
    "finalized",
  );
  const enrolledAccounts = Object.fromEntries(
    [config, share.publicKey].map((k, index) => {
      const a = initial[index]!;
      assert.ok(a);
      return [
        k.toBase58(),
        {
          owner: a.owner.toBase58(),
          executable: a.executable,
          data: [a.data.toString("base64"), "base64"],
        },
      ];
    }),
  );
  const id = await enrollOpenOwner(
    journal.pool,
    enrollmentPolicy,
    enrolledAccounts,
  );
  assert.equal(
    await enrollOpenOwner(journal.pool, enrollmentPolicy, enrolledAccounts),
    id,
  );
  let state: OpenSnapshot = (await db.read(id))!;
  const scope = (): Scope => ({
    intentId: id,
    wallet: state.wallet,
    vault: state.vault,
    expectedDbRevision: state.dbRevision,
    expectedChainRevision: state.chainRevision,
    idempotencyHash: cycleHash(Buffer.from(randomUUID())),
  });
  const serverContext = await isolatedServerPolicy(
    journal.pool,
    local,
    idl,
    id,
  );
  const positionReader = createIsolatedRestrictedPositionReader(
    journal.pool,
    approvedOwnerCompilerPolicy({
      ...serverContext.policy,
      version: "c3-open-production/v1",
    } as OpenProductionPolicy),
    serverContext.rpc,
    serverContext.genesis,
  );
  const positionEvidence: unknown[] = [];
  const readRestricted = async () => {
    const p = await positionReader.read(id);
    assert.equal(p.status, "RECONCILED_SINGLE_POSITION", JSON.stringify(p));
    if (p.status !== "RECONCILED_SINGLE_POSITION")
      throw Error("C3_CYCLE_POSITION_UNAVAILABLE");
    assert.equal(p.monetaryNav, null);
    for (const mint of ["USDC", "cbBTC", "PortalETH", "WSOL"] as const)
      assert.equal(p.donations[mint], "1");
    positionEvidence.push({
      stage: state.state,
      slot: p.contextSlot,
      shares: p.shareUnits,
      claimable: p.claimableUsdcBaseUnits,
      returned: p.returnedUsdcBaseUnits,
    });
    return p;
  };
  const pairRead = async (method: string, params: unknown[]) => {
    const [primary, secondary] = await Promise.all([
      serverContext.rpc.read(method, params),
      serverContext.rpc.read(method, params),
    ]);
    // SAME isolated validator twice, NOT independent production operators.
    return { status: "AGREED_UNVERIFIED_EFFECTS" as const, primary, secondary };
  };
  const collect = async (
    signature: string,
    accounts: readonly string[],
    minimumSlot = 1,
  ) => {
    const statuses = await pairRead("getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: true },
    ]);
    let slot: number | undefined;
    for (const response of [statuses.primary, statuses.secondary]) {
      const value = (
        response as {
          value: { confirmationStatus: string; err: unknown; slot: number }[];
        }
      ).value[0]!;
      assert.equal(value.confirmationStatus, "finalized");
      assert.equal(value.err, null);
      assert.ok(Number.isSafeInteger(value.slot) && value.slot >= minimumSlot);
      if (slot !== undefined) assert.equal(value.slot, slot);
      slot = value.slot;
    }
    const transaction = await pairRead("getTransaction", [
      signature,
      {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
        encoding: "json",
      },
    ]);
    for (const response of [transaction.primary, transaction.secondary]) {
      const value = response as {
        slot: number;
        meta: { err: unknown };
        transaction: { signatures: string[] };
      };
      assert.equal(value.slot, slot);
      assert.equal(value.meta.err, null);
      assert.equal(value.transaction.signatures[0], signature);
    }
    const snapshots = await pairRead("getMultipleAccounts", [
      accounts,
      { commitment: "finalized", encoding: "base64", minContextSlot: slot },
    ]);
    for (const response of [snapshots.primary, snapshots.secondary]) {
      const value = response as { context: { slot: number }; value: unknown[] };
      assert.ok(value.context.slot >= slot!);
      assert.equal(value.value.length, accounts.length);
      assert.ok(value.value.every(Boolean));
    }
    return {
      status: "FINALIZED_QUORUM_REQUIRES_SEMANTIC_VERIFICATION" as const,
      signature,
      slot: slot!,
      accounts: Object.freeze([...accounts]),
      statuses,
      transaction,
      snapshots,
    } satisfies Awaited<
      ReturnType<typeof collectFinalizedOpenEconomicEvidence>
    >;
  };
  const wire = (signature: string) =>
    pairRead("getTransaction", [
      signature,
      {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
        encoding: "base64",
      },
    ]);
  const ownerIntake = {
    collect,
    wire,
    genesis: async () => local!.getGenesisHash(),
  };
  const keeperIntake: KeeperEvidenceIntake = {
    collect: async (signature, accounts, minimumSlot) => {
      const evidence = await collect(signature, accounts, minimumSlot),
        genesis = await pairRead("getGenesisHash", []);
      assert.equal(genesis.primary, serverContext.genesis);
      assert.equal(genesis.secondary, serverContext.genesis);
      const meta = (
        evidence.transaction.primary as {
          meta: {
            innerInstructions: unknown[];
            preTokenBalances: unknown[];
            postTokenBalances: unknown[];
          };
        }
      ).meta;
      report.lastKeeperMetadata = {
        innerGroups: meta.innerInstructions.length,
        beforeTokens: meta.preTokenBalances,
        afterTokens: meta.postTokenBalances,
      }; // Public cloned-bank evidence only; never installed in the APK.
      return {
        ...evidence,
        wire: await wire(signature),
        genesis: {
          primary: String(genesis.primary),
          secondary: String(genesis.secondary),
        },
      };
    },
  };
  class ClonedFreshRoutes extends JupiterV2ReadOnlyClient {
    override async getExactInQuote(r: RouterRequest) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = await jupiter.getExactInQuote(r);
        try {
          await bank.verifyRoute(local!, candidate);
          return candidate;
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.startsWith("C3_BANK_FRESH_ROUTE_MISSING:") ||
            attempt === 2
          )
            throw error;
        }
      }
      throw Error("C3_CYCLE_FRESH_ROUTE_MISSING");
    }
  }
  const keeperJournal = isolatedKeeperJournal(
    journal.pool,
    serverContext.policy,
    serverContext.rpc,
    new JupiterLegCompiler(local, new ClonedFreshRoutes()),
    serverContext.genesis,
    keeperIntake,
  );
  const keeperOperation = async (action: KeeperAction, planSeconds = 120) => {
    stage = `keeper-${action}-compile`;
    const began = Date.now(),
      chainStart = await now();
    let prepared: Awaited<ReturnType<typeof keeperJournal.prepare>>;
    try {
      prepared = await keeperJournal.prepare(id, action, planSeconds);
    } finally {
      let chainEnd: number | null = null;
      try {
        chainEnd = await now();
      } catch {
        /* Diagnostic failure must not mask the compiler's rejection. */
      }
      report.lastKeeperPreparation = {
        action,
        planSeconds,
        elapsedMs: Date.now() - began,
        chainStart,
        chainEnd,
      };
    }
    const signed = VersionedTransaction.deserialize(prepared.packet);
    signed.sign([keeper]); // Ephemeral fixture only; no source signing port.
    const signature = await keeperJournal.recordSignedPacket(
      prepared.requestId,
      signed.serialize(),
    );
    assert.equal(
      await keeperJournal.claimSendAttempt(prepared.requestId),
      true,
    );
    assert.equal(
      await keeperJournal.claimSendAttempt(prepared.requestId),
      false,
    );
    assert.equal(
      await local!.sendRawTransaction(signed.serialize(), {
        maxRetries: 0,
        skipPreflight: false,
      }),
      signature,
    );
    await finalized(signature);
    const proof = await keeperJournal.reconcile(prepared.requestId);
    assert.equal(proof.status, "reconciled");
    assert.equal(
      (await keeperJournal.reconcile(prepared.requestId)).status,
      "already_reconciled",
    );
    state = (await db.read(id))!;
    report.keeperOperations ??= [] as unknown[];
    (report.keeperOperations as unknown[]).push({
      action,
      requestId: prepared.requestId,
      signature,
      messageHash: prepared.manifest.messageHash,
      minima: prepared.manifest.minima,
      routes: prepared.manifest.routes,
      evidenceHash: proof.evidenceHash,
    });
    return signature;
  };
  const clientPolicy: OwnerPolicy = {
    wallet: owner.publicKey.toBytes(),
    program: VAULT_PROGRAM.toBytes(),
    accounts: Object.fromEntries(
      Object.entries({
        config,
        deposit_intent: depositIntent,
        redemption_intent: redemptionIntent,
        deposit_plan: depositPlan,
        redemption_plan: redemptionPlan,
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
    process.argv.includes("--resolve-minimum")
      ? async (pre, ctx) => {
          const leg = pre[714] === 0 ? 0 : pre[714] === 1 ? 1 : 2,
            ordinal = (pre[145] === 1 ? 0 : 3) + leg;
          const trusted = await isolatedLegFactory(
            journal!.pool,
            serverContext.policy,
            serverContext.rpc,
            serverContext.genesis,
          ).capture(id, ordinal, BigInt(ctx.dbRevision), true);
          const material = await new JupiterLegCompiler(
            local!,
            new ClonedFreshRoutes(),
          ).reviewMinimum(trusted);
          if (material.quotedOutput >= pre.readBigUInt64LE(672 + 8 * leg))
            return undefined;
          const proposal = proposeMinimumResolution(
            pre,
            trusted,
            material,
            ctx.chainNow,
          );
          report.minimumProposal = {
            ...proposal,
            fixture:
              "unreachable owner floor deliberately installed on isolated validator; fresh Jupiter response unchanged",
          };
          return proposal;
        }
      : undefined,
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
    stage = `owner-${action}-prepare`;
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
    await reconcileOwnerEconomicsFromSource(
      journal!.pool,
      serverContext.policy,
      flow.snapshot!.requestId,
      ownerIntake,
    );
    state = (await db.read(id))!;
    await flow.restore(stored);
    await flow.recover();
    assert.equal(flow.snapshot!.signature, signature);
    report.ownerBackendProtocol =
      "same mobile controller: atomic owner packets, real HTTP+PG receipt before explicit local broadcast, restart GET recovery and effect-gated advancement; not physical MWA";
    return signature;
  };
  await ownerOperation("deposit");
  await keeperOperation("create_buy_plan");
  stage = "durable-funding";
  assert.equal(state.state, "funded");
  await readRestricted();
  await assert.rejects(backend.prepare(id, "deposit"));
  report.secondDeposit = "same backend refuses second deposit";
  if (process.argv.includes("--renew-plan")) {
    stage = "owner-durable-renewal";
    const old = await local.getAccountInfo(depositPlan, "finalized");
    assert.ok(old);
    const expires = Number(old.data.readBigInt64LE(706));
    // Real 120 s plan window: compilation of three fresh routes must not be
    // penalized by a shortened fixture TTL. Renewal still requires actual expiry.
    const deadline = Date.now() + 135000;
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
  const waitExpiry = async (plan: PublicKey) => {
    const expiry = Number(
        (await local!.getAccountInfo(plan, "finalized"))!.data.readBigInt64LE(
          706,
        ),
      ),
      deadline = Date.now() + 140000;
    while ((await now("finalized")) < expiry) {
      assert.ok(Date.now() < deadline, "bounded recovery expiry");
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  for (let ordinal = 0; ordinal < 6; ordinal++) {
    if (ordinal === 1 && process.argv.includes("--resolve-minimum")) {
      stage = "partial-economic-floor-fixture";
      await waitExpiry(depositPlan);
      const pre: Buffer = (await local.getAccountInfo(
        depositPlan,
        "finalized",
      ))!.data;
      assert.equal(
        pre[714],
        1,
        "one actual Jupiter buy completed before recovery",
      );
      const minima = [0, 1, 2].map((n) => pre.readBigUInt64LE(672 + 8 * n));
      minima[1] = 1_000_000_000_000n;
      const fixture = await prepareLocalRenewal(
        journal.pool,
        local,
        idl,
        scope(),
        { testMinimumOutputs: minima },
      );
      const fixtureTx = VersionedTransaction.deserialize(fixture.transaction);
      fixtureTx.sign([owner]);
      await recordLocalRenewalSignature(
        journal.pool,
        local,
        idl,
        scope(),
        fixture.requestId,
        fixtureTx.serialize(),
      );
      const fixtureSig = await local.sendTransaction(fixtureTx, {
        maxRetries: 0,
        skipPreflight: false,
      });
      await finalized(fixtureSig);
      await reconcileLocalRenewal(
        journal.pool,
        local,
        idl,
        scope(),
        fixture.requestId,
        fixtureSig,
      );
      state = (await db.read(id))!;
      await waitExpiry(depositPlan);
      stage = "partial-economic-owner-review";
      await flow.restore(stored);
      await flow.recover();
      assert.equal(flow.snapshot!.state, "finalized");
      await flow.prepare(id, "renew_plan", true);
      assert.ok(flow.economicReview);
      await assert.rejects(
        backend.prepare(id, "renew_plan"),
        "concurrent owner preparation must fail CAS/pending barrier",
      );
      signedPacket = undefined;
      await flow.approve();
      assert.ok(signedPacket);
      const rid = flow.snapshot!.requestId,
        sig = flow.snapshot!.signature!;
      // Crash/lost response BEFORE broadcast: receipt survives; reading status
      // cannot resend or call signer. The test caller broadcasts once explicitly.
      await flow.restore(stored);
      await flow.recover();
      assert.equal(flow.snapshot!.signature, sig);
      assert.notEqual(flow.snapshot!.state, "finalized");
      await assert.rejects(backend.prepare(id, "renew_plan"));
      assert.equal(
        await local.sendRawTransaction(signedPacket, {
          maxRetries: 0,
          skipPreflight: false,
        }),
        sig,
      );
      await finalized(sig);
      const req: {
        message_hash: Buffer;
        pre_state: Buffer;
        expected_chain_revision: string;
        expires_at: string;
        observed_slot: string;
      } = (
        await journal.pool.query(
          "SELECT * FROM c3_open.renewal_requests WHERE request_id=$1",
          [rid],
        )
      ).rows[0];
      const wire = await serverContext.rpc.read("getTransaction", [
        sig,
        {
          commitment: "finalized",
          encoding: "base64",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      const tx = await serverContext.rpc.read("getTransaction", [
        sig,
        {
          commitment: "finalized",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        },
      ]);
      const snap = await serverContext.rpc.read("getMultipleAccounts", [
        [depositPlan.toBase58()],
        { commitment: "finalized", encoding: "base64" },
      ]);
      verifyOwnerRenewalEvidence(
        {
          wallet: state.wallet,
          program: idl.address,
          plan: depositPlan.toBase58(),
          signature: sig,
          messageHash: req.message_hash,
          preState: req.pre_state,
          revision: req.expected_chain_revision,
          expiry: req.expires_at,
          observedSlot: Number(req.observed_slot),
        },
        wire,
        tx,
        snap,
      );
      const proof = await reconcileLocalRenewal(
        journal.pool,
        local,
        idl,
        scope(),
        rid,
        sig,
      );
      state = (await db.read(id))!;
      await flow.restore(stored);
      await flow.recover();
      assert.equal(flow.snapshot!.state, "finalized");
      assert.equal(
        state.chainRevision,
        BigInt(req.expected_chain_revision) + 1n,
      );
      report.minimumResolution = {
        signature: sig,
        generation: proof.generation.toString(),
        revision: state.chainRevision.toString(),
        restartAndUncertain: true,
        concurrentRequestRejected: true,
        productionMessageVerifier: true,
        physicalMwa: false,
      };
    }
    if (ordinal === 3) {
      stage = "issue-shares";
      await keeperOperation("record_buy");
      await ownerOperation("issue_shares");
      assert.equal(state.state, "active");
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
      const p = await readRestricted();
      assert.equal(p.ownershipBps, 10000);
      await ownerOperation("request_redemption");
      await keeperOperation("create_sell_plan");
      assert.equal(state.state, "redemption_requested");
    }
    stage = `leg-${ordinal}-fresh-route`;
    const amount: bigint =
      ordinal < 3
        ? ordinal === 0
          ? 400_000n
          : 300_000n
        : (await local.getAccountInfo(
            redemptionIntent,
            "finalized",
          ))!.data.readBigUInt64LE(122 + (ordinal % 3) * 8);
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
    const q: {
      state: string;
      canonical_payload: Buffer;
      evidence: { effectManifest: Record<string, unknown> };
    } = (
      await journal.pool.query(
        "SELECT q.*,ctx.context FROM c3_open.quote_authorizations q JOIN c3_open.all_quote_contexts ctx USING(intent_id,ordinal,intent_revision) WHERE encode(q.quote_id,'hex')=$1",
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
      expectedEffects: q.evidence.effectManifest,
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
    state = await db.recordSignedExecution(
      scope(),
      ordinal,
      worker,
      execute.serialize(),
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
      db = new VerifiedSettlementJournal(journal.pool);
      state = (await db.read(id))!;
      assert.equal((await db.readLeg(id, ordinal)).signature, signature);
      assert.equal((await positionReader.read(id)).status, "UNAVAILABLE");
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
    state = await db.reconcile(
      scope(),
      ordinal,
      local,
      "ISOLATED_VERIFIED",
      serverContext.genesis,
    );
    await assert.rejects(
      db.reconcile(
        scope(),
        ordinal,
        local,
        "ISOLATED_VERIFIED",
        serverContext.genesis,
      ),
    );
    report.duplicateReconciliation =
      "confirmed legs cannot be promoted twice; no resend";
    const output = (
      await getAccount(local, new PublicKey(vaultAta(req.outputMint)))
    ).amount;
    if (ordinal < 3) buys.push(output - 1n);
    steps.push({
      ordinal,
      signature,
      authorizationPersisted: true,
      input: amount.toString(),
      quotedOutput: build.outAmount,
      realizedOutput: (await local.getAccountInfo(
        new PublicKey(ordinal < 3 ? state.depositPlan : state.redemptionPlan!),
        "finalized",
      ))!.data
        .readBigUInt64LE(804 + (ordinal % 3) * 8)
        .toString(),
      threshold: build.otherAmountThreshold,
      minimum: seal.readBigUInt64LE(131).toString(),
      bytes: execBytes.length,
      finalized: true,
      reconciled: true,
    });
    console.log(`LOCAL_CLONED_JUPITER_LEG_${ordinal}:PASS`);
    // Reconstruct the service between legs; do not reconstruct or resend packets.
    db = new VerifiedSettlementJournal(journal.pool);
    state = (await db.read(id))!;
    await readRestricted();
  }
  stage = "redemption-and-claim";
  await keeperOperation("record_sell");
  assert.equal(state.state, "claimable");
  const claimPosition = await readRestricted();
  const realized = steps
    .slice(3)
    .reduce((total, leg) => total + BigInt(String(leg.realizedOutput)), 0n);
  assert.equal(claimPosition.claimableUsdcBaseUnits, realized.toString());
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
  await ownerOperation("claim");
  assert.equal(
    (await getAccount(local, ownerShares, "finalized", TOKEN_2022_PROGRAM_ID))
      .amount,
    0n,
  );
  assert.equal(state.state, "redeemed");
  const closedPosition = await readRestricted();
  assert.equal(closedPosition.returnedUsdcBaseUnits, realized.toString());
  await assert.rejects(instruction("claimUsdc", [], claimAccounts, [owner]));
  report.duplicateClaim = "rejected on-chain";
  report.sharesBurned = "1000000";
  report.usdcReturned = (
    await getAccount(local, ownerUsdc, "finalized")
  ).amount.toString();
  assert.equal(report.usdcReturned, realized.toString());
  for (const mint of [c.usdcMint, ...assets])
    assert.equal(
      (await getAccount(local, new PublicKey(vaultAta(mint)), "finalized"))
        .amount,
      1n,
    );
  report.restrictedPositionEvidence = positionEvidence;
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
