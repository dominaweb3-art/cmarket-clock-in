/** Actual disposable PostgreSQL; ephemeral cryptographic identities, no wallet
 * or blockchain submission. Transport is an assertion-only local callback. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import pg from "pg";
import {
  Connection,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  applyOpenLocalMigration,
  OpenLocalSettlementRepository,
} from "./orchestrator.ts";
import {
  OpenOwnerJournal,
  submitProductionOwnerPacket,
} from "../src/open-owner-journal.ts";
import {
  closeExpiredLocalOwnerRequest,
  ownerStateImage,
} from "./owner-expiry.ts";
import { encodeBase58 } from "../src/solana.ts";
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw Error("DISPOSABLE_DB_REQUIRED");
const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest();
test("owner session / submission / expiry durability with real PostgreSQL", async (t) => {
  t.after(() => pool.end());
  const c = await pool.connect();
  try {
    await applyOpenLocalMigration(c);
  } finally {
    c.release();
  }
  const db = await OpenLocalSettlementRepository.fromVerifiedPool(pool),
    owner = Keypair.generate(),
    vault = Keypair.generate().publicKey,
    intentId = randomUUID();
  await db.createDraft({
    intentId,
    wallet: owner.publicKey.toBase58(),
    vault: vault.toBase58(),
    shareMint: Keypair.generate().publicKey.toBase58(),
    depositPlan: Keypair.generate().publicKey.toBase58(),
    configurationHash: "b".repeat(64),
    idempotencyHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 600000),
  });
  const journal = new OpenOwnerJournal(pool, "https://cmarket.example.org"),
    challenge = await journal.challenge(intentId),
    ownerPrivate = generateKeyPairSync("ed25519");
  const ownerKey = (await import("node:crypto")).createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(owner.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  await assert.rejects(
    () =>
      journal.authenticate(
        challenge.challengeId,
        Buffer.from(challenge.message),
        sign(null, Buffer.from(challenge.message), ownerPrivate.privateKey),
      ),
    /AUTH_REJECTED/,
  );
  const token = await journal.authenticate(
    challenge.challengeId,
    Buffer.from(challenge.message),
    sign(null, Buffer.from(challenge.message), ownerKey),
  );
  await t.test(
    "nonce replay, audience tamper and expired challenge rejected",
    async () => {
      await assert.rejects(() =>
        journal.authenticate(
          challenge.challengeId,
          Buffer.from(challenge.message),
          sign(null, Buffer.from(challenge.message), ownerKey),
        ),
      );
      const next = await journal.challenge(intentId),
        tamper = Buffer.from(
          next.message.replace("cmarket.example.org", "attacker.example.org"),
        );
      await assert.rejects(
        () =>
          journal.authenticate(
            next.challengeId,
            tamper,
            sign(null, tamper, ownerKey),
          ),
        /AUTH_REJECTED/,
      );
    },
  );
  const requestId = randomUUID(),
    blockhash = Keypair.generate().publicKey.toBase58(),
    tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          new TransactionInstruction({
            programId: vault,
            keys: [],
            data: Buffer.from([1]),
          }),
        ],
      }).compileToV0Message(),
    );
  tx.sign([owner]);
  await pool.query(
    "INSERT INTO c3_open.owner_requests(request_id,intent_id,action,expected_db_revision,expected_chain_revision,message_hash,blockhash,last_valid_height,expires_at) VALUES($1,$2,'deposit',1,0,$3,$4,100,$5)",
    [
      requestId,
      intentId,
      hash(tx.message.serialize()),
      blockhash,
      new Date(Date.now() + 60000),
    ],
  );
  await journal.bindRequest(token, requestId);
  let sends = 0;
  await t.test(
    "sessions cannot cross audiences; explicit reauthentication preserves prior binding",
    async () => {
      await assert.rejects(
        () =>
          new OpenOwnerJournal(pool, "https://other.example.org").bindRequest(
            token,
            requestId,
          ),
        /SESSION_REJECTED/,
      );
      const renewed = await journal.challenge(intentId),
        token2 = await journal.authenticate(
          renewed.challengeId,
          Buffer.from(renewed.message),
          sign(null, Buffer.from(renewed.message), ownerKey),
        );
      await journal.bindRequest(token2, requestId);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM c3_open.owner_request_sessions WHERE request_id=$1",
            [requestId],
          )
        ).rows[0].n,
        2,
      );
    },
  );
  await t.test(
    "concurrent submission commits the signature before one transport call",
    async () => {
      const send = async () => {
        sends++;
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM c3_open.owner_submissions WHERE request_id=$1",
              [requestId],
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int n FROM c3_open.owner_send_attempts WHERE request_id=$1",
              [requestId],
            )
          ).rows[0].n,
          1,
        );
        throw Error("lost response");
      };
      const result = await Promise.all([
        journal.submitOnce(token, requestId, tx.serialize(), send),
        journal.submitOnce(token, requestId, tx.serialize(), send),
      ]);
      assert.equal(sends, 1);
      assert.ok(result.every((r) => r.status === "uncertain"));
      assert.equal(
        (
          await pool.query(
            "SELECT state FROM c3_open.intents WHERE intent_id=$1",
            [intentId],
          )
        ).rows[0].state,
        "draft",
      );
    },
  );
  await t.test(
    "restart cannot resend or substitute session/transaction",
    async () => {
      await new OpenOwnerJournal(
        pool,
        "https://cmarket.example.org",
      ).submitOnce(token, requestId, tx.serialize(), async () => {
        sends++;
        return "bad";
      });
      assert.equal(sends, 1);
      await assert.rejects(
        () =>
          journal.submitOnce(
            "0".repeat(64),
            requestId,
            tx.serialize(),
            async () => {
              throw Error("unexpected");
            },
          ),
        /SESSION_REJECTED/,
      );
      const altered = VersionedTransaction.deserialize(tx.serialize());
      altered.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
      altered.sign([owner]);
      await assert.rejects(
        () =>
          journal.submitOnce(
            token,
            requestId,
            altered.serialize(),
            async () => {
              throw Error("unexpected");
            },
          ),
        /SIGNED_BINDING/,
      );
      await assert.rejects(
        () =>
          submitProductionOwnerPacket(
            pool,
            "https://cmarket.example.org",
            token,
            requestId,
            tx.serialize(),
            (async () => {
              throw Error("unexpected");
            }) as typeof fetch,
          ),
        /NOT_APPROVED/,
      );
    },
  );
  await t.test(
    "dead-blockhash + unchanged finalized state required for cancellation",
    async () => {
      const rpc = new Connection("http://127.0.0.1:8899");
      rpc.getGenesisHash = async () => "isolated";
      let valid = true,
        changed = false;
      rpc.getMultipleAccountsInfoAndContext = async () => ({
        context: { slot: 123 },
        value: [
          {
            owner: vault,
            executable: false,
            data: Buffer.from([changed ? 2 : 1]),
            lamports: 1,
            rentEpoch: 0,
          },
          null,
        ],
      });
      rpc.getBlockHeight = async () => 101;
      rpc.isBlockhashValid = async () => ({
        context: { slot: 123 },
        value: valid,
      });
      const expired = randomUUID(),
        accounts = [vault.toBase58(), Keypair.generate().publicKey.toBase58()],
        image = await ownerStateImage(rpc, accounts);
      await pool.query(
        "INSERT INTO c3_open.owner_requests(request_id,intent_id,action,expected_db_revision,expected_chain_revision,message_hash,blockhash,last_valid_height,expires_at) VALUES($1,$2,'claim',1,0,$3,$4,100,clock_timestamp()-interval '1 second')",
        [expired, intentId, hash(tx.message.serialize()), blockhash],
      );
      await pool.query(
        "INSERT INTO c3_open.owner_expiry_barriers(request_id,accounts,state_hash) VALUES($1,$2,$3)",
        [expired, accounts, image.hash],
      );
      await assert.rejects(
        () =>
          closeExpiredLocalOwnerRequest(
            pool,
            rpc,
            intentId,
            owner.publicKey.toBase58(),
            expired,
            true,
          ),
        /RECONCILE_REQUIRED/,
      );
      valid = false;
      changed = true;
      await assert.rejects(
        () =>
          closeExpiredLocalOwnerRequest(
            pool,
            rpc,
            intentId,
            owner.publicKey.toBase58(),
            expired,
            true,
          ),
        /RECONCILE_REQUIRED/,
      );
      changed = false;
      await assert.rejects(
        () =>
          closeExpiredLocalOwnerRequest(
            pool,
            rpc,
            intentId,
            vault.toBase58(),
            expired,
            true,
          ),
        /CONTEXT/,
      );
      // A read captured BEFORE invalidity could miss a transaction that just landed.
      let invalidityObserved = false;
      rpc.isBlockhashValid = async () => {
        invalidityObserved = true;
        return { context: { slot: 123 }, value: false };
      };
      rpc.getMultipleAccountsInfoAndContext = async (_accounts, options) => {
        assert.ok(invalidityObserved);
        assert.equal(
          (options as { minContextSlot?: number }).minContextSlot,
          123,
        );
        return {
          context: { slot: 123 },
          value: [
            {
              owner: vault,
              executable: false,
              data: Buffer.from([1]),
              lamports: 1,
              rentEpoch: 0,
            },
            null,
          ],
        };
      };
      await Promise.all([
        closeExpiredLocalOwnerRequest(
          pool,
          rpc,
          intentId,
          owner.publicKey.toBase58(),
          expired,
          true,
        ),
        closeExpiredLocalOwnerRequest(
          pool,
          rpc,
          intentId,
          owner.publicKey.toBase58(),
          expired,
          true,
        ),
      ]);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM c3_open.owner_request_outcomes WHERE request_id=$1",
            [expired],
          )
        ).rows[0].n,
        1,
      );
      await assert.rejects(
        () =>
          pool.query(
            "INSERT INTO c3_open.owner_message_receipts(request_id,slot,evidence_hash) VALUES($1,123,$2)",
            [expired, hash(tx.message.serialize())],
          ),
        /CONTRADICTORY_FINALITY/,
      );
      await assert.rejects(
        () => journal.bindRequest(token, expired),
        /REQUEST_STALE/,
      );
      const recoveryChallenge = await journal.challenge(intentId),
        recoveryToken = await journal.authenticate(
          recoveryChallenge.challengeId,
          Buffer.from(recoveryChallenge.message),
          sign(null, Buffer.from(recoveryChallenge.message), ownerKey),
        );
      await assert.rejects(
        () => journal.authorizeRequest(recoveryToken, expired),
        /SESSION_BINDING/,
      );
      await journal.bindRecovery(recoveryToken, expired);
      assert.equal(
        (await journal.authorizeRequest(recoveryToken, expired)).intentId,
        intentId,
      );
      await assert.rejects(
        () =>
          journal.submitOnce(
            recoveryToken,
            expired,
            tx.serialize(),
            async () => {
              throw Error("unexpected send");
            },
          ),
        /REQUEST_STALE|TERMINAL_REQUEST/,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM c3_open.owner_submissions WHERE request_id=$1",
            [requestId],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(encodeBase58(tx.signatures[0]!).length > 64, true);
    },
  );
});
