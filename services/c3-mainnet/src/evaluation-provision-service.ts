/** Hosted, bounded provisioning for authenticated evaluation wallets.
 * Each HTTP invocation advances at most one durably journaled transaction.
 * No private wallet key, local validator, database-only position or Mainnet. */
import { createHash } from "node:crypto";
import { BorshCoder, BN, type Idl } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { evaluationRpc } from "./evaluation-rpc.ts";
import type { Pool } from "pg";
import { EvaluationAuth } from "./evaluation-auth.ts";
import {
  EVALUATION,
  evaluationAmount,
  assertEvaluationDatabase,
} from "./evaluation-scope.ts";
import {
  EvaluationClient,
  EVAL_TOKEN,
  EVAL_SHARES,
  evaluationAta,
} from "./evaluation-client.ts";
import {
  evaluationAssetMints,
  evaluationShareMint,
  evaluationCreateMint,
  evaluationCreateAta,
  evaluationMintTestTokens,
  evaluationInitializeWallet,
  compileEvaluationProvisioning,
  EVALUATION_MINT_AUTHORITY,
  EVALUATION_FAUCET_USDC_AMOUNT,
} from "./evaluation-provisioning.ts";
import {
  EvaluationServiceJournal,
  evaluationOperationId,
  type EvaluationPacketSigner,
} from "./evaluation-service-journal.ts";
import {
  accountBytes,
  verifyOpenToken,
  verifyShareMintForAuthority,
  type OpenAccount,
} from "./open-state-semantics.ts";
import { evaluationPosition } from "./evaluation-state.ts";
import { EvaluationOwnerService } from "./evaluation-owner-service.ts";
const digest = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("EVAL_PROVISION_" + code);
};
const raw = (
  v: {
    owner: PublicKey;
    data: Buffer;
    executable: boolean;
    lamports: number;
  } | null,
): OpenAccount | null =>
  v
    ? {
        owner: v.owner.toBase58(),
        data: [v.data.toString("base64"), "base64"],
        executable: v.executable,
        lamports: v.lamports,
      }
    : null;
type Step = {
  operationId?: string;
  name: string;
  scope: string;
  signer: string;
  instructions: TransactionInstruction[];
  verify: () => Promise<void>;
};
export type EvaluationProvisionSigners = Readonly<{
  governance: EvaluationPacketSigner;
  mint: EvaluationPacketSigner;
}>;

export class EvaluationProvisionService {
  private readonly pool: Pool;
  private readonly idl: Idl;
  private readonly signers: EvaluationProvisionSigners;
  private readonly rpc = evaluationRpc();
  private readonly journal: EvaluationServiceJournal;
  constructor(pool: Pool, idl: Idl, signers: EvaluationProvisionSigners) {
    check(
      idl.address === EVALUATION.program &&
        signers.governance.publicKey === EVALUATION.governance &&
        signers.mint.publicKey === EVALUATION_MINT_AUTHORITY,
      "IDENTITIES",
    );
    this.pool = pool;
    this.idl = idl;
    this.signers = signers;
    this.journal = new EvaluationServiceJournal(pool);
  }
  private async mint(address: PublicKey, authority: PublicKey) {
    const a = raw(await this.rpc.getAccountInfo(address, "finalized"));
    const b = accountBytes(a, EVAL_TOKEN.toBase58(), 82);
    check(
      b.readUInt32LE(0) === 1 &&
        b.subarray(4, 36).equals(authority.toBuffer()) &&
        b[44] === 6 &&
        b[45] === 1 &&
        b.readUInt32LE(46) === 0,
      "MINT_STATE",
    );
    return b;
  }
  private async token(address: PublicKey, owner: PublicKey, mint: PublicKey) {
    return verifyOpenToken(
      raw(await this.rpc.getAccountInfo(address, "finalized"))!,
      owner.toBase58(),
      mint.toBase58(),
      EVAL_TOKEN.toBase58(),
    );
  }
  private async program(address: string, hash: string, size: number) {
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const [data] = PublicKey.findProgramAddressSync(
      [new PublicKey(address).toBuffer()],
      loader,
    );
    const infos = await this.rpc.getMultipleAccountsInfo(
      [new PublicKey(address), data],
      "finalized",
    );
    const p = infos[0],
      d = infos[1];
    check(
      p?.executable &&
        p.owner.equals(loader) &&
        p.data.length === 36 &&
        p.data.readUInt32LE(0) === 2 &&
        p.data.subarray(4).equals(data.toBuffer()),
      "PROGRAM_NOT_DEPLOYED",
    );
    check(
      d &&
        d.owner.equals(loader) &&
        d.data.length >= 45 + size &&
        d.data.readUInt32LE(0) === 3 &&
        d.data[12] === 1 &&
        d.data
          .subarray(13, 45)
          .equals(new PublicKey(EVALUATION.governance).toBuffer()) &&
        digest(d.data.subarray(45, 45 + size)).toString("hex") === hash &&
        d.data.subarray(45 + size).every((n) => n === 0),
      "PROGRAM_BINARY",
    );
  }
  private async run(step: Step) {
    const purpose =
      step.scope === "assets"
        ? "assets"
        : step.name.startsWith("faucet")
          ? "faucet"
          : "wallet";
    const id =
      step.operationId ?? evaluationOperationId(step.scope, purpose, step.name);
    const receipt = (
      await this.pool.query(
        "SELECT * FROM c3_eval.service_receipts WHERE operation_id=$1",
        [id],
      )
    ).rows[0];
    if (receipt) {
      check(receipt.outcome === "effects_verified", "PREVIOUS_FAILURE");
      return { complete: true, operationId: id };
    }
    const previous = (
      await this.pool.query(
        "SELECT * FROM c3_eval.service_packets WHERE operation_id=$1",
        [id],
      )
    ).rows[0];
    const latest = previous
      ? null
      : await this.rpc.getLatestBlockhash("finalized");
    const packet = previous
      ? previous.unsigned_packet
      : compileEvaluationProvisioning(
          step.instructions,
          step.signer,
          latest!.blockhash,
        ).packet;
    const signer =
      step.signer === EVALUATION.governance
        ? this.signers.governance
        : this.signers.mint;
    const sent = await this.journal.dispatch(
      {
        operationId: id,
        scope: step.scope,
        purpose,
        packet,
        lastValidBlockHeight: previous
          ? Number(previous.last_valid_height)
          : latest!.lastValidBlockHeight,
      },
      signer,
    );
    const result = await this.journal.reconcile(
      id,
      async (tx: VersionedTransactionResponse) => {
        check(tx.meta?.innerInstructions, "MISSING_INNER_EVIDENCE");
        // Exact outer message is already bound by the journal. Provisioning CPI
        // may only create/init the committed system/ATA/token accounts.
        const keys = tx.transaction.message.staticAccountKeys;
        const allowed = [
          SystemProgram.programId.toBase58(),
          EVAL_TOKEN.toBase58(),
          EVAL_SHARES.toBase58(),
        ];
        check(
          tx.meta!.innerInstructions!.every((group) =>
            group.instructions.every((i) =>
              allowed.includes(keys[i.programIdIndex]?.toBase58() ?? ""),
            ),
          ),
          "PROVISION_CPI",
        );
        await step.verify();
        return digest(
          JSON.stringify({
            slot: tx.slot,
            signature: sent.signature,
            message: digest(tx.transaction.message.serialize()).toString("hex"),
            pre: tx.meta!.preTokenBalances,
            post: tx.meta!.postTokenBalances,
          }),
        );
      },
    );
    return {
      complete: result.state === "effects_verified",
      operationId: id,
      signature: sent.signature,
      state: result.state,
    };
  }
  private async round(
    token: string,
    proof: { wallet: string; challengeId: string },
    newPurchase: boolean,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,7421))", [
        proof.wallet,
      ]);
      const last = (
        await c.query(
          "SELECT round FROM c3_eval.evaluation_round_requests WHERE wallet=$1 ORDER BY round DESC LIMIT 1",
          [proof.wallet],
        )
      ).rows[0];
      const current = (
        await c.query(
          "SELECT * FROM c3_eval.current_wallet_vaults WHERE wallet=$1",
          [proof.wallet],
        )
      ).rows[0];
      let round = BigInt(String(last?.round ?? current?.round ?? "1"));
      // Reconcile/resume a reservation, never allocate a second one concurrently.
      if (last && (!current || round > BigInt(String(current.round)))) {
        await c.query("COMMIT");
        return round;
      }
      if (!newPurchase && current) {
        await c.query("COMMIT");
        return BigInt(String(current.round));
      }
      let predecessor: string | null = null,
        evidence: Buffer | null = null;
      if (current) {
        const ctx = await new EvaluationOwnerService(
          this.pool,
          this.idl,
        ).context(token);
        if (ctx.position.lifecycle === 0 && round >= 2n) {
          await c.query("COMMIT");
          return round;
        }
        check(
          ctx.position.lifecycle === 4 &&
            ctx.position.shares === 0n &&
            ctx.position.returned > 0n,
          "FINISH_CURRENT_POSITION_FIRST",
        );
        check(
          !(
            await c.query(
              `SELECT 1 FROM c3_eval.owner_requests r JOIN c3_eval.intents i USING(intent_id)
          WHERE i.wallet=$1 AND NOT EXISTS(SELECT 1 FROM c3_eval.owner_effect_receipts e WHERE e.request_id=r.request_id)
          AND NOT EXISTS(SELECT 1 FROM c3_eval.owner_request_outcomes o WHERE o.request_id=r.request_id) LIMIT 1`,
              [proof.wallet],
            )
          ).rowCount,
          "UNCERTAIN_OWNER_OPERATION",
        );
        check(
          !(
            await c.query(
              "SELECT 1 FROM c3_eval.intents WHERE wallet=$1 AND state NOT IN ('redeemed','expired','cancelled') LIMIT 1",
              [proof.wallet],
            )
          ).rowCount,
          "FINISH_DURABLE_POSITION_FIRST",
        );
        predecessor = String(ctx.client.vault);
        evidence = digest(
          JSON.stringify({
            vault: predecessor,
            slot: ctx.slot,
            lifecycle: ctx.position.lifecycle,
            shares: String(ctx.position.shares),
            returned: String(ctx.position.returned),
          }),
        );
      }
      round += 1n;
      check(round <= EVALUATION.maximumRounds, "ROUND_LIMIT");
      await c.query(
        "INSERT INTO c3_eval.evaluation_round_requests(wallet,round,challenge_id,predecessor_vault,predecessor_evidence_hash) VALUES($1,$2,$3,$4,$5)",
        [
          proof.wallet,
          round.toString(),
          proof.challengeId,
          predecessor,
          evidence,
        ],
      );
      await c.query("COMMIT");
      return round;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  async advance(token: string, newPurchase = false) {
    const proof = await new EvaluationAuth(this.pool).authorize(token);
    await assertEvaluationDatabase(this.pool);
    check((await this.rpc.getGenesisHash()) === EVALUATION.genesis, "NETWORK");
    await this.program(
      EVALUATION.program,
      "a582571274157d7486e69a8bc89fd36abdc40fb52bf7430f28115343d885a703",
      928400,
    );
    await this.program(
      EVALUATION.router,
      "5ce781e0ac62380da84233765586a8bb1c54478d700ec45451d9c9608bf39473",
      206904,
    );
    // Reserve the global allowance before any funding, across server instances.
    const reservation = await this.pool.connect();
    try {
      await reservation.query("BEGIN");
      await reservation.query("SET LOCAL lock_timeout='3s'");
      await reservation.query("SELECT pg_advisory_xact_lock(7428123)");
      if (
        !(
          await reservation.query(
            "SELECT 1 FROM c3_eval.provisioning_slots WHERE wallet=$1",
            [proof.wallet],
          )
        ).rowCount
      ) {
        const count = Number(
          (
            await reservation.query(
              "SELECT count(*) FROM c3_eval.provisioning_slots",
            )
          ).rows[0].count,
        );
        check(count < 50, "WALLET_LIMIT");
        await reservation.query(
          "INSERT INTO c3_eval.provisioning_slots(slot,wallet,challenge_id) VALUES($1,$2,$3)",
          [count + 1, proof.wallet, proof.challengeId],
        );
      }
      await reservation.query("COMMIT");
    } catch (error) {
      await reservation.query("ROLLBACK");
      throw error;
    } finally {
      reservation.release();
    }
    const round = await this.round(token, proof, newPurchase);
    const scope = round === 1n ? proof.wallet : proof.wallet + ":" + round;
    const mints = await evaluationAssetMints(),
      share = await evaluationShareMint(proof.wallet, round);
    const mintAuthority = new PublicKey(EVALUATION_MINT_AUTHORITY),
      governance = new PublicKey(EVALUATION.governance),
      owner = new PublicKey(proof.wallet);
    const poolAuthority = PublicKey.findProgramAddressSync(
      [Buffer.from("liquidity")],
      new PublicKey(EVALUATION.router),
    )[0];
    const currentAmount = (
      await this.pool.query(
        "SELECT deposit_amount FROM c3_eval.current_wallet_vaults WHERE wallet=$1 AND round=$2",
        [proof.wallet, round.toString()],
      )
    ).rows[0]?.deposit_amount;
    const client = new EvaluationClient(this.idl, {
      wallet: proof.wallet,
      shareMint: share.toBase58(),
      usdcMint: String(mints[0]),
      btcMint: String(mints[1]),
      ethMint: String(mints[2]),
      solMint: String(mints[3]),
      version: round,
      depositAmount: evaluationAmount(
        String(currentAmount ?? EVALUATION.amount),
      ),
    });
    const unpauseOperation = await this.unpauseOperation(
      client,
      scope,
      proof.challengeId,
      newPurchase,
    );
    const mintRent = await this.rpc.getMinimumBalanceForRentExemption(82),
      shareRent = await this.rpc.getMinimumBalanceForRentExemption(170);
    const steps: Step[] = [
      {
        scope: "assets",
        name: "fund-keeper",
        signer: EVALUATION.governance,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: governance,
            toPubkey: new PublicKey(EVALUATION.keeper),
            lamports: 50_000_000,
          }),
        ],
        verify: async () => {
          check(
            (await this.rpc.getBalance(
              new PublicKey(EVALUATION.keeper),
              "finalized",
            )) >= 50_000_000,
            "KEEPER_FUNDING",
          );
        },
      },
      {
        scope: "assets",
        name: "fund-mint-authority",
        signer: EVALUATION.governance,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: governance,
            toPubkey: mintAuthority,
            lamports: 50_000_000,
          }),
        ],
        verify: async () => {
          check(
            (await this.rpc.getBalance(mintAuthority, "finalized")) >=
              50_000_000,
            "MINT_FUNDING",
          );
        },
      },
    ];
    for (let i = 0; i < 4; i++) {
      const name = ["usdc", "btc", "eth", "sol"][i]! as
          "usdc" | "btc" | "eth" | "sol",
        mint = mints[i]!;
      steps.push({
        scope: "assets",
        name: "mint-" + name,
        signer: EVALUATION_MINT_AUTHORITY,
        instructions: evaluationCreateMint(
          name,
          mint,
          undefined,
          mintAuthority,
          mintRent,
        ),
        verify: async () => {
          await this.mint(mint, mintAuthority);
        },
      });
      steps.push({
        scope: "assets",
        name: "pool-" + name,
        signer: EVALUATION_MINT_AUTHORITY,
        instructions: [
          evaluationCreateAta(mintAuthority, mint, poolAuthority),
          evaluationMintTestTokens(mint, poolAuthority, 100_000_000n),
        ],
        verify: async () => {
          check(
            (await this.token(
              evaluationAta(mint, poolAuthority),
              poolAuthority,
              mint,
            )) >= 100_000_000n,
            "POOL_BALANCE",
          );
        },
      });
    }
    steps.push({
      scope: proof.wallet,
      name: "share-mint",
      signer: EVALUATION.governance,
      instructions: evaluationCreateMint(
        "shares",
        share,
        proof.wallet,
        client.authority,
        shareRent,
        round,
      ),
      verify: async () => {
        verifyShareMintForAuthority(
          client.authority.toBase58(),
          raw(await this.rpc.getAccountInfo(share, "finalized"))!,
        );
      },
    });
    for (const mint of mints)
      steps.push({
        scope: proof.wallet,
        name: "vault-ata-" + mint,
        signer: EVALUATION.governance,
        instructions: [evaluationCreateAta(governance, mint, client.authority)],
        verify: async () => {
          await this.token(
            evaluationAta(mint, client.authority),
            client.authority,
            mint,
          );
        },
      });
    steps.push({
      scope: proof.wallet,
      name: "owner-atas",
      signer: EVALUATION.governance,
      instructions: [
        evaluationCreateAta(governance, mints[0]!, owner),
        evaluationCreateAta(governance, share, owner, EVAL_SHARES),
      ],
      verify: async () => {
        await this.token(evaluationAta(mints[0]!, owner), owner, mints[0]!);
        verifyOpenToken(
          raw(
            await this.rpc.getAccountInfo(
              evaluationAta(share, owner, EVAL_SHARES),
              "finalized",
            ),
          )!,
          proof.wallet,
          share.toBase58(),
          EVAL_SHARES.toBase58(),
        );
      },
    });
    steps.push({
      scope: proof.wallet,
      name: "initialize-vault",
      signer: EVALUATION.governance,
      instructions: [evaluationInitializeWallet(client)],
      verify: async () => {
        await this.position(client);
      },
    });
    const registry = client.pda("c3-route-reg-v1", client.vault),
      policy = client.pda("c3-quote-policy-v1", client.vault);
    const accounts = {
      ...client.accounts(client.intent("deposit")),
      governance,
      registry,
      policy,
    };
    steps.push({
      scope: proof.wallet,
      name: "initialize-controls",
      signer: EVALUATION.governance,
      instructions: [
        client.instruction("initialize_route_registry", {}, accounts),
        client.instruction("initialize_quote_policy", {}, accounts),
      ],
      verify: async () => {
        check(
          (await this.rpc.getAccountInfo(registry, "finalized")) &&
            (await this.rpc.getAccountInfo(policy, "finalized")),
          "CONTROLS",
        );
      },
    });
    const slot = await this.rpc.getSlot("finalized"),
      activation = BigInt(slot),
      expiry = activation + 1_000_000n;
    const bytes = (n: bigint) => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(n);
      return b;
    };
    const programs = [new PublicKey(EVALUATION.router), EVAL_TOKEN];
    const registryHash = digest(
      Buffer.concat([
        Buffer.from("c3-route-registry-v1"),
        client.vault.toBuffer(),
        bytes(round),
        bytes(activation),
        bytes(expiry),
        Buffer.from([2]),
        ...programs.map((p) => p.toBuffer()),
      ]),
    );
    const replace = client.instruction(
      "replace_route_registry",
      {
        programs,
        activation_slot: new BN(activation.toString()),
        expiry_slot: new BN(expiry.toString()),
        config_hash: [...registryHash],
      },
      accounts,
    );
    replace.keys.push(
      ...programs.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      })),
    );
    steps.push({
      scope: proof.wallet,
      name: "activate-controls",
      signer: EVALUATION.governance,
      instructions: [
        replace,
        client.instruction(
          "configure_quote_policy",
          {
            authority: new PublicKey(EVALUATION.quotes),
            genesis_hash: [...new PublicKey(EVALUATION.genesis).toBuffer()],
            max_age_seconds: new BN(30),
            max_slippage_bps: 100,
          },
          accounts,
        ),
      ],
      verify: async () => {
        const r = this.decode(
            "RouteProgramRegistry",
            raw(await this.rpc.getAccountInfo(registry, "finalized"))!,
          ),
          q = this.decode(
            "QuoteAuthorityPolicy",
            raw(await this.rpc.getAccountInfo(policy, "finalized"))!,
          );
        check(
          r.enabled === true &&
            r.schema_version === 1 &&
            q.schema_version === 1 &&
            String(r.config_version) === String(round) &&
            String(q.config_version) === String(round) &&
            String(r.vault) === String(client.vault) &&
            String(q.vault) === String(client.vault) &&
            String(r.governance) === EVALUATION.governance &&
            String(q.governance) === EVALUATION.governance &&
            String(r.revision) === "1" &&
            String(q.revision) === "1" &&
            r.program_count === 2 &&
            Array.isArray(r.programs) &&
            r.programs.length === 16 &&
            r.programs.every(
              (p, i) =>
                String(p) ===
                (i < 2 ? String(programs[i]) : String(PublicKey.default)),
            ) &&
            q.enabled === true &&
            String(q.authority) === EVALUATION.quotes &&
            String(q.max_age_seconds) === "30" &&
            q.max_slippage_bps === 100 &&
            Buffer.from(q.genesis_hash as number[]).equals(
              new PublicKey(EVALUATION.genesis).toBuffer(),
            ) &&
            Buffer.from(q.domain as number[]).equals(
              Buffer.from("C3QUOTESEAL-V1!!"),
            ),
          "POLICY",
        );
        const registeredActivation = BigInt(String(r.activation_slot)),
          registeredExpiry = BigInt(String(r.expiry_slot)),
          observed = BigInt(await this.rpc.getSlot("finalized"));
        check(
          registeredActivation <= observed &&
            registeredExpiry > observed &&
            registeredExpiry === registeredActivation + 1_000_000n,
          "REGISTRY_WINDOW",
        );
        const registeredHash = digest(
          Buffer.concat([
            Buffer.from("c3-route-registry-v1"),
            client.vault.toBuffer(),
            bytes(round),
            bytes(registeredActivation),
            bytes(registeredExpiry),
            Buffer.from([2]),
            ...programs.map((p) => p.toBuffer()),
          ]),
        );
        check(
          Buffer.from(r.config_hash as number[]).equals(registeredHash),
          "REGISTRY_HASH",
        );
      },
    });
    steps.push({
      scope: proof.wallet,
      name: "unpause",
      operationId: unpauseOperation,
      signer: EVALUATION.governance,
      instructions: [
        client.instruction(
          "unpause",
          {},
          { ...accounts, authority: governance },
        ),
      ],
      verify: async () => {
        check(!(await this.position(client)).paused, "PAUSED");
      },
    });
    steps.push({
      scope: proof.wallet,
      // Stable per-wallet journal identity makes this a one-time 200 TEST USDC
      // grant. Retries reconcile the same transaction and cannot mint twice.
      name: "faucet-usdc-200",
      signer: EVALUATION_MINT_AUTHORITY,
      instructions: [
        evaluationMintTestTokens(
          mints[0]!,
          owner,
          EVALUATION_FAUCET_USDC_AMOUNT,
        ),
      ],
      verify: async () => {
        check(
          (await this.token(
            evaluationAta(mints[0]!, owner),
            owner,
            mints[0]!,
          )) >= EVALUATION_FAUCET_USDC_AMOUNT,
          "FAUCET_BALANCE",
        );
      },
    });
    steps.push({
      scope: proof.wallet,
      name: "faucet-fees",
      signer: EVALUATION.governance,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: governance,
          toPubkey: owner,
          lamports: 20_000_000,
        }),
      ],
      verify: async () => {
        check(
          (await this.rpc.getBalance(owner, "finalized")) >= 20_000_000,
          "FEE_BALANCE",
        );
      },
    });
    for (const step of steps) {
      if (step.scope === proof.wallet && !step.name.startsWith("faucet"))
        step.scope = scope;
      if (step.name === "unpause" && !EVALUATION.lifecycleReady)
        return {
          ready: false,
          stage: "SETTLEMENT_RELEASE_VERIFICATION_REQUIRED",
          simulatedAssets: true,
        };
      if (step.name.startsWith("vault-ata-") && step.scope === scope)
        step.operationId = await this.unpauseOperation(
          client,
          scope,
          proof.challengeId,
          newPurchase,
          step,
        );
      const result = await this.run(step);
      // A new transaction may finalize during this request. Return rather than
      // unboundedly dispatching subsequent operations within a Function.
      if ("signature" in result)
        return {
          ...result,
          stage: step.name,
          ready: false,
          simulatedAssets: true,
        };
    }
    const pos = await this.position(client);
    const evidence = digest(
      JSON.stringify({
        wallet: proof.wallet,
        vault: String(client.vault),
        share: String(share),
        inventory: pos.inventory.map(String),
        scope: EVALUATION.genesis,
      }),
    );
    const finalReceipt = (
      await this.pool.query(
        "SELECT s.signature FROM c3_eval.service_submissions s WHERE operation_id=$1",
        [unpauseOperation],
      )
    ).rows[0];
    await this.pool.query(
      `INSERT INTO c3_eval.asset_configuration(singleton,genesis,usdc_mint,btc_mint,eth_mint,sol_mint,simulated_assets,mainnet_enabled,provisioning_evidence_hash) VALUES(true,$1,$2,$3,$4,$5,true,false,$6) ON CONFLICT(singleton) DO NOTHING`,
      [
        EVALUATION.genesis,
        ...mints.map(String),
        digest(JSON.stringify(mints.map(String))),
      ],
    );
    const inserted = (
      await this.pool.query(
        round === 1n
          ? `INSERT INTO c3_eval.wallet_vaults(wallet,vault,share_mint,challenge_id,provisioning_signature,provisioning_evidence_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(wallet) DO NOTHING RETURNING wallet`
          : `INSERT INTO c3_eval.evaluation_wallet_rounds(wallet,vault,share_mint,challenge_id,provisioning_signature,provisioning_evidence_hash,round) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(wallet,round) DO NOTHING RETURNING wallet`,
        [
          proof.wallet,
          String(client.vault),
          String(share),
          proof.challengeId,
          finalReceipt.signature,
          evidence,
          ...(round === 1n ? [] : [round.toString()]),
        ],
      )
    ).rowCount;
    return {
      ready: true,
      wallet: proof.wallet,
      vault: String(client.vault),
      shareMint: String(share),
      round: round.toString(),
      newlyEnrolled: !!inserted,
      simulatedAssets: true,
    };
  }
  private async unpauseOperation(
    client: EvaluationClient,
    scope: string,
    challenge: string,
    explicitRecovery: boolean,
    missingAta?: Step,
  ) {
    const name = missingAta?.name ?? "unpause";
    const base = evaluationOperationId(scope, "wallet", name);
    const latest = (
      await this.pool.query(
        "SELECT operation_id,generation FROM c3_eval.evaluation_provision_attempts WHERE base_operation=$1 ORDER BY generation DESC LIMIT 1",
        [base],
      )
    ).rows[0];
    const previousId = latest?.operation_id ?? base;
    const previous = (
      await this.pool.query(
        "SELECT p.last_valid_height,s.signature,r.outcome FROM c3_eval.service_packets p LEFT JOIN c3_eval.service_submissions s USING(operation_id) LEFT JOIN c3_eval.service_receipts r USING(operation_id) WHERE p.operation_id=$1",
        [previousId],
      )
    ).rows[0];
    if (
      !previous ||
      previous.outcome === "effects_verified" ||
      !explicitRecovery
    )
      return previousId;
    check(!previous.outcome, "UNPAUSE_FINALIZED_FAILURE");
    const height = await this.rpc.getBlockHeight("finalized");
    if (height <= Number(previous.last_valid_height)) return previousId;
    const status = previous.signature
      ? (
          await this.rpc.getSignatureStatuses([previous.signature], {
            searchTransactionHistory: true,
          })
        ).value[0]
      : null;
    const transaction = previous.signature
      ? await this.rpc.getTransaction(previous.signature, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        })
      : null;
    check(!status && !transaction, "UNPAUSE_ORIGINAL_RECONCILE_FIRST");
    if (missingAta) {
      const ix = missingAta.instructions[0];
      check(
        missingAta.name.startsWith("vault-ata-") &&
          missingAta.scope === scope &&
          missingAta.signer === EVALUATION.governance &&
          missingAta.instructions.length === 1 &&
          ix?.programId.toBase58() ===
            "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" &&
          ix.keys.length === 6 &&
          ix.data.length === 1 &&
          ix.data[0] === 1 &&
          ix.keys[0]?.pubkey.toBase58() === EVALUATION.governance &&
          ix.keys[2]?.pubkey.equals(client.authority) &&
          ix.keys[3]?.pubkey.toBase58() ===
            missingAta.name.slice("vault-ata-".length) &&
          ix.keys[1]?.pubkey.equals(
            evaluationAta(ix.keys[3]!.pubkey, client.authority),
          ) &&
          ix.keys[4]?.pubkey.equals(SystemProgram.programId) &&
          ix.keys[5]?.pubkey.equals(EVAL_TOKEN),
        "ATA_RECOVERY_SCOPE",
      );
      const target = ix!.keys[1]!.pubkey;
      check(
        !(await this.rpc.getAccountInfo(target, "finalized")),
        "ATA_ORIGINAL_EFFECT_PRESENT",
      );
      // Only a pre-vault setup account may be rebuilt. A funded or initialized
      // vault must use its monetary recovery flow, never this provision path.
      check(
        !(await this.rpc.getAccountInfo(client.vault, "finalized")),
        "ATA_RECOVERY_VAULT_ALREADY_EXISTS",
      );
    } else {
      const pos = await this.position(client);
      check(
        pos.paused &&
          pos.lifecycle === 0 &&
          pos.shares === 0n &&
          pos.deposited === 0n,
        "UNPAUSE_RECOVERY_EMPTY_VAULT",
      );
    }
    const generation = Number(latest?.generation ?? 1) + 1;
    check(generation <= 3, "UNPAUSE_RECOVERY_LIMIT");
    const next = evaluationOperationId(
      scope,
      "wallet",
      name + ":" + generation,
    );
    const evidence = digest(
      JSON.stringify({
        previousId,
        signature: previous.signature ?? null,
        height,
        lastValid: Number(previous.last_valid_height),
        vault: String(client.vault),
        operation: name,
        missingAta:
          missingAta?.instructions[0]?.keys[1]?.pubkey.toBase58() ?? null,
        paused: true,
        lifecycle: 0,
      }),
    );
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='3s'");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,7430))", [
        base,
      ]);
      const current = (
        await c.query(
          "SELECT operation_id FROM c3_eval.evaluation_provision_attempts WHERE base_operation=$1 ORDER BY generation DESC LIMIT 1",
          [base],
        )
      ).rows[0];
      check(
        (current?.operation_id ?? base) === previousId,
        "UNPAUSE_RECOVERY_CAS",
      );
      await c.query(
        "INSERT INTO c3_eval.evaluation_provision_attempts(base_operation,generation,operation_id,predecessor,challenge_id,evidence_hash) VALUES($1,$2,$3,$4,$5,$6)",
        [base, generation, next, previousId, challenge, evidence],
      );
      await c.query("COMMIT");
      return next;
    } catch (error) {
      await c.query("ROLLBACK");
      throw error;
    } finally {
      c.release();
    }
  }
  private decode(name: string, a: OpenAccount) {
    return new BorshCoder(this.idl).accounts.decode(
      name,
      accountBytes(a, EVALUATION.program, undefined, name),
    ) as Record<string, unknown>;
  }
  private async position(client: EvaluationClient) {
    const n = client.accounts(client.intent("deposit"));
    const addresses = [
      client.vault,
      new PublicKey(client.config.shareMint),
      n.owner_shares!,
      n.owner_usdc!,
      n.vault_usdc!,
      n.vault_btc!,
      n.vault_eth!,
      n.vault_wsol!,
      client.intent("deposit"),
      client.intent("redemption"),
    ];
    const values = await this.rpc.getMultipleAccountsInfo(
      addresses,
      "finalized",
    );
    return evaluationPosition(
      client,
      new Map(addresses.map((k, i) => [k.toBase58(), raw(values[i] ?? null)])),
    );
  }
}
