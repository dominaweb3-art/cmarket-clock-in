/** Disposable PG + SYNTHETIC finalized RPC evidence. This tests the durable
 * reconciliation boundary, NOT actual Jupiter execution or Mainnet settlement.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  applyOpenLocalMigration,
  OpenLocalSettlementRepository,
  type OpenSnapshot,
} from "./orchestrator.ts";
import {
  OpenQuoteAuthority,
  openQuoteContext,
  type StoredQuoteContext,
} from "./open-quote.ts";
import { IsolatedOpenTestSigner } from "./isolated-test-signer.ts";
import { quoteContextHash } from "../src/quote-seal.ts";
import { fixture, addr } from "./open-reconcile.fixture.ts";
import { finalizedPlanFixture } from "./open-plan.fixture.ts";
import { VAULT_PROGRAM } from "./jupiter-vault-cpi-inspection.ts";
import { C3_MAINNET } from "../src/constants.ts";
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw new Error("DISPOSABLE_DB_REQUIRED");
const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
const hash = (b: Uint8Array | string) =>
  createHash("sha256").update(b).digest("hex");
const scope = (s: OpenSnapshot) => ({
  intentId: s.intentId,
  wallet: s.wallet,
  vault: s.vault,
  expectedDbRevision: s.dbRevision,
  expectedChainRevision: s.chainRevision,
  idempotencyHash: hash(randomUUID()),
});
test(
  "cloned evidence cannot downgrade to mock; restart, uncertain recovery and CAS preserve signature",
  { timeout: 30000 },
  async (t) => {
    const signer = await IsolatedOpenTestSigner.start();
    t.after(() => signer.close());
    t.after(() => pool.end());
    const client = await pool.connect();
    try {
      await applyOpenLocalMigration(client);
    } finally {
      client.release();
    }
    const db = await OpenLocalSettlementRepository.fromVerifiedPool(pool);
    assert.equal(
      (db as unknown as Record<string, unknown>).commitLocalLeg,
      undefined,
      "verification cannot be bypassed through a JS-visible commit hook",
    );
    async function prepared(withUnusedAlt = false) {
      const data = Buffer.alloc(88);
      data.writeUInt32LE(1);
      data.writeBigUInt64LE((1n << 64n) - 1n, 4);
      data.writeBigUInt64LE(50n, 12);
      addr(43).toBuffer().copy(data, 56);
      const alt = withUnusedAlt
        ? {
            address: addr(42).toBase58(),
            owner: C3_MAINNET.addressLookupTableProgram,
            data,
          }
        : undefined;
      const f = fixture(alt),
        id = randomUUID(),
        worker = randomUUID(),
        wallet = f.e.context.wallet,
        vault = f.e.context.vault,
        intent = new PublicKey(f.e.context.intent);
      const plan = PublicKey.findProgramAddressSync(
        [Buffer.from("c3-plan-v1"), intent.toBuffer()],
        VAULT_PROGRAM,
      )[0].toBase58();
      let s = await db.createDraft({
        intentId: id,
        wallet,
        vault,
        shareMint: addr(24).toBase58(),
        depositPlan: plan,
        configurationHash: hash("synthetic config"),
        expiresAt: new Date(Date.now() + 600000),
        idempotencyHash: hash(randomUUID()),
      });
      // Explicit test setup; a production deposit verifier is NOT bypassed here.
      await pool.query(
        "UPDATE c3_open.intents SET state='funded',db_revision=db_revision+1 WHERE intent_id=$1",
        [id],
      );
      s = (await db.read(id))!;
      s = await db.lease(scope(s), 0, worker);
      const context: StoredQuoteContext = {
        ...f.e.context,
        vault,
        intent: intent.toBase58(),
        wallet,
        keeper: f.e.context.keeper,
        governance: addr(25).toBase58(),
        policy: f.e.context.policy,
        reviewedPrograms: [
          C3_MAINNET.jupiterProgram,
          "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
        ],
        genesisHash: addr(41).toBuffer().toString("hex"),
        configVersion: "1",
        registry: f.e.context.registry,
        registryRevision: "1",
        registryHash: hash("registry"),
        plan,
        planRevision: "0",
        leg: 0,
        direction: 1,
        routerProgram: C3_MAINNET.jupiterProgram,
        policyRevision: "1",
        authority: Buffer.from(signer.publicKey).toString("hex"),
        maxSlippageBps: 100,
        maxQuoteAgeSeconds: 30,
        planExpiresAt: String(Math.floor(Date.now() / 1000) + 100),
        configurationHash: hash("synthetic config"),
      };
      await pool.query(
        "INSERT INTO c3_open.quote_contexts(intent_id,ordinal,intent_revision,context,context_hash,scope) VALUES($1,0,$2,$3,$4,'LOCAL_CLONE')",
        [
          id,
          s.dbRevision.toString(),
          context,
          quoteContextHash(openQuoteContext(context)),
        ],
      );
      const authority = new OpenQuoteAuthority(pool, {
        validateAndBuild: async () => ({
          authorizationNonce: f.e.seal.subarray(81, 113),
          quotedOutput: 476n,
          jupiterThreshold: 472n,
          slippageBps: 100,
          routeHash: f.e.seal.subarray(139, 171),
          instructionHash: f.e.seal.subarray(171, 203),
          accountMetasHash: f.e.seal.subarray(203, 235),
          altCount: f.e.seal[235]!,
          altContentsHash: f.e.seal.subarray(236, 268),
          builderTimestamp: BigInt(Math.floor(Date.now() / 1000)),
          builderSlot: 100n,
          expiresAt: BigInt(Math.floor(Date.now() / 1000)) + 25n,
          expiresSlot: 200n,
          unsignedPacketBytes: 1232,
          executionMessageHash: f.e.messageHash,
          effectManifest: {
            pool: f.e.pool,
            poolInput: f.e.poolInput,
            poolOutput: f.e.poolOutput,
          },
        }),
      });
      const qid = await authority.prepare(id, 0, s.dbRevision),
        q = await authority.signPersisted(qid, signer);
      s = await db.prepare(scope(s), 0, worker, {
        routeHash: q.payload.subarray(139, 171).toString("hex"),
        instructionHash: q.payload.subarray(171, 203).toString("hex"),
        authorizationHash: hash(q.payload),
        inputMint: context.inputMint,
        outputMint: context.outputMint,
        source: context.source,
        destination: context.destination,
        inputAmount: 400000n,
        minimumOutput: 472n,
        quoteExpiresAt: new Date(Number(q.payload.readBigInt64LE(284)) * 1000),
        expectedEffects: { notTrusted: true },
      });
      s = await db.recordSignature(
        scope(s),
        0,
        worker,
        f.e.signature,
        hash(q.payload),
      );
      s = await db.markSubmitted(scope(s), 0, worker, f.e.signature);
      f.tx.blockTime = Number(q.payload.readBigInt64LE(268)) + 1;
      const account = await finalizedPlanFixture(
        context,
        q.payload,
        "400000",
        "476",
      );
      const rpc = new Connection("http://127.0.0.1:18999");
      // No network request, signing, sending or transaction simulation in this fixture.
      rpc.getGenesisHash = async () => addr(41).toBase58();
      rpc.getSignatureStatuses = async () => ({
        context: { slot: 101 },
        value: [
          {
            slot: 101,
            confirmations: null,
            err: null,
            confirmationStatus: "finalized",
          },
        ],
      });
      Object.defineProperty(rpc, "getTransaction", { value: async () => f.tx });
      rpc.getMultipleAccountsInfo = async (names) =>
        names.map((k) => {
          assert.ok(alt && k.toBase58() === alt.address);
          return {
            data: alt.data,
            owner: new PublicKey(alt.owner),
            executable: false,
            lamports: 10000000,
            rentEpoch: 0,
          };
        });
      rpc.getAccountInfoAndContext = async () => ({
        context: { slot: 101 },
        value: account,
      });
      return { f, id, s, rpc, qid };
    }
    const a = await prepared();
    await assert.rejects(
      () =>
        db.recordLocalConfirmedLeg(scope(a.s), 0, {
          source: "MOCK_LOCAL_ONLY",
          plan: a.s.depositPlan,
          signature: a.f.e.signature,
          evidenceHash: hash("forged"),
          chainRevision: 1n,
          observedEffects: { notTrusted: true },
        }),
      /CLONED_LEG_REQUIRES_RPC_VERIFICATION/,
    );
    a.f.post[4]!.uiTokenAmount.amount = "99";
    await assert.rejects(
      () => db.reconcileLocalJupiterLeg(scope(a.s), 0, a.rpc),
      /UNEXPECTED_VAULT_TOKEN_EFFECT/,
    );
    assert.equal((await db.readLeg(a.id, 0)).state, "submitted");
    a.f.post[4]!.uiTokenAmount.amount = "100";
    a.s = await db.uncertain(scope(a.s), 0, "INTERRUPTED_TEST");
    const restarted =
      await OpenLocalSettlementRepository.fromVerifiedPool(pool);
    assert.equal((await restarted.readLeg(a.id, 0)).signature, a.f.e.signature);
    await assert.rejects(
      () => restarted.lease(scope(a.s), 0, randomUUID()),
      /INVALID_STATE|SIGNATURE_REQUIRES_MANUAL_REVIEW/,
    );
    a.s = await restarted.beginReconciliation(scope(a.s), 0);
    a.s = await restarted.reconcileLocalJupiterLeg(scope(a.s), 0, a.rpc);
    assert.equal(a.s.chainRevision, 1n);
    assert.equal((await restarted.readLeg(a.id, 0)).state, "confirmed");
    const quote = (
      await pool.query(
        "SELECT state FROM c3_open.quote_authorizations WHERE quote_id=$1",
        [Buffer.from(a.qid, "hex")],
      )
    ).rows[0];
    assert.equal(quote.state, "consumed");
    await assert.rejects(
      () => restarted.reconcileLocalJupiterLeg(scope(a.s), 0, a.rpc),
      /DURABLE_EVIDENCE_MISSING/,
    );
    const b = await prepared();
    const requests = await Promise.allSettled([
      db.reconcileLocalJupiterLeg(scope(b.s), 0, b.rpc),
      db.reconcileLocalJupiterLeg(scope(b.s), 0, b.rpc),
    ]);
    assert.equal(requests.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await db.readLeg(b.id, 0)).signature, b.f.e.signature);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM c3_open.events WHERE intent_id=$1 AND state='confirmed'",
          [b.id],
        )
      ).rows[0].n,
      1,
    );
    const unused = await prepared(true);
    assert.equal(unused.f.tx.transaction.message.addressTableLookups.length, 0);
    const beforeUnused = unused.s.dbRevision;
    unused.s = await db.reconcileLocalJupiterLeg(
      scope(unused.s),
      0,
      unused.rpc,
    );
    assert.equal(unused.s.dbRevision, beforeUnused + 1n);
    assert.equal((await db.readLeg(unused.id, 0)).state, "confirmed");
  },
);
