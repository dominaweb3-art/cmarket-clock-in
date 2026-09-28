import assert from "node:assert/strict";
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

async function expectFailure(
  action: () => Promise<unknown>,
  name: string,
): Promise<void> {
  await assert.rejects(action, `${name} must fail`);
}

test(
  "MOCK_LOCAL_ONLY: exact one-owner buy, hold, full redemption and USDC claim on isolated validator",
  { timeout: 240_000 },
  async () => {
    await airdrop(payer.publicKey, 20_000_000_000);
    const owner = Keypair.generate();
    const attacker = Keypair.generate();
    const keeper = Keypair.generate();
    const emergency = Keypair.generate();
    await airdrop(owner.publicKey, 2_000_000_000);
    await airdrop(attacker.publicKey, 2_000_000_000);

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
      vaultAuthority,
      null,
      6,
    );
    const ethMint = await createMint(
      connection,
      payer,
      vaultAuthority,
      null,
      6,
    );
    const wsolMint = await createMint(
      connection,
      payer,
      vaultAuthority,
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
    const depositSettlementId = Array.from({ length: 32 }, () => 1);
    const depositMockSig = await program.methods
      .mockSettleDeposit(depositSettlementId)
      .accountsStrict({ accounts: commonMock, intent: depositIntent })
      .signers([keeper])
      .rpc();
    await expectFailure(
      () =>
        program.methods
          .recordDepositSettlement(depositSettlementId)
          .accountsStrict({
            keeper: attacker.publicKey,
            config,
            intent: depositIntent,
            vaultUsdc,
            vaultBtc,
            vaultEth,
            vaultWsol,
          })
          .signers([attacker])
          .rpc(),
      "unauthorized keeper settlement record",
    );
    await expectFailure(
      () =>
        program.methods
          .mockSettleDeposit(depositSettlementId)
          .accountsStrict({ accounts: commonMock, intent: depositIntent })
          .signers([keeper])
          .rpc(),
      "duplicate mock deposit settlement",
    );
    await expectFailure(
      () =>
        program.methods
          .mockSettleDeposit(depositSettlementId)
          .accountsStrict({
            accounts: { ...commonMock, vaultBtc: attackerUsdc },
            intent: depositIntent,
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
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([owner])
          .rpc(),
      "claim before liquidation",
    );
    const burnSig = await program.methods
      .lockOrBurnShares()
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
    assert.equal(await balance(ownerShares, TOKEN_2022_PROGRAM_ID), 0n);
    await expectFailure(
      () =>
        program.methods
          .lockOrBurnShares()
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
      "duplicate burn",
    );
    const redemptionSettlementId = Array.from({ length: 32 }, () => 2);
    const redemptionMockSig = await program.methods
      .mockSettleRedemption(redemptionSettlementId)
      .accountsStrict({ accounts: commonMock, intent: redemptionIntent })
      .signers([keeper])
      .rpc();
    await expectFailure(
      () =>
        program.methods
          .mockSettleRedemption(redemptionSettlementId)
          .accountsStrict({ accounts: commonMock, intent: redemptionIntent })
          .signers([keeper])
          .rpc(),
      "duplicate mock redemption settlement",
    );
    const recordRedemptionSig = await program.methods
      .recordRedemptionSettlement(redemptionSettlementId)
      .accountsStrict({
        keeper: keeper.publicKey,
        config,
        intent: redemptionIntent,
        vaultUsdc,
        vaultBtc,
        vaultEth,
        vaultWsol,
      })
      .signers([keeper])
      .rpc();
    await expectFailure(
      () =>
        program.methods
          .recordRedemptionSettlement(redemptionSettlementId)
          .accountsStrict({
            keeper: keeper.publicKey,
            config,
            intent: redemptionIntent,
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
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([owner])
      .rpc();
    assert.equal(await balance(ownerUsdc), 990_000n);
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
          depositMockSig,
          recordDepositSig,
          shareSig,
          redemptionCreateSig,
          burnSig,
          redemptionMockSig,
          recordRedemptionSig,
          pauseBeforeClaimSig,
          claimSig,
          closeSig,
        },
      }),
    );
  },
);
