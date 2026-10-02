/** Real disposable PG and ephemeral test owner; no wallet or chain broadcast. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  Connection,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  applyOpenLocalMigration,
  OpenLocalSettlementRepository,
} from "./orchestrator.ts";
import {
  recordLocalOwnerSignature,
  recordLocalFinalizedOwnerMessage,
} from "./owner-operations.ts";
import {
  VAULT_PROGRAM,
  VAULT_AUTHORITY,
} from "./jupiter-vault-cpi-inspection.ts";
import { encodeBase58 } from "../src/solana.ts";
import { createIsolatedOwnerServer } from "./owner-server.ts";
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw Error("DISPOSABLE_DB_REQUIRED");
const pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
const idl = JSON.parse(
  readFileSync(
    new URL(
      "../../../programs/c3-pilot-vault/target/idl/c3_pilot_vault.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Idl;
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest();
test("owner request journal cryptography, concurrent receipts, restart, tamper and no economic promotion", async (t) => {
  t.after(() => pool.end());
  const client = await pool.connect();
  try {
    await applyOpenLocalMigration(client);
  } finally {
    client.release();
  }
  const db = await OpenLocalSettlementRepository.fromVerifiedPool(pool),
    owner = Keypair.generate(),
    vault = Keypair.generate().publicKey;
  const scope = {
    intentId: randomUUID(),
    wallet: owner.publicKey.toBase58(),
    vault: vault.toBase58(),
    expectedDbRevision: 1n,
    expectedChainRevision: 0n,
    idempotencyHash: "a".repeat(64),
  };
  await db.createDraft({
    intentId: scope.intentId,
    wallet: scope.wallet,
    vault: scope.vault,
    shareMint: Keypair.generate().publicKey.toBase58(),
    depositPlan: Keypair.generate().publicKey.toBase58(),
    configurationHash: "b".repeat(64),
    idempotencyHash: scope.idempotencyHash,
    expiresAt: new Date(Date.now() + 600000),
  });
  const rpc = new Connection("http://127.0.0.1:8899");
  rpc.getGenesisHash = async () => "isolated-fixture-genesis";
  const blockhash = Keypair.generate().publicKey.toBase58(),
    tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: owner.publicKey,
        recentBlockhash: blockhash,
        instructions: [
          new TransactionInstruction({
            programId: VAULT_PROGRAM,
            keys: [{ pubkey: vault, isSigner: false, isWritable: true }],
            data: Buffer.from([1]),
          }),
        ],
      }).compileToV0Message(),
    );
  const requestId = randomUUID();
  await pool.query(
    "INSERT INTO c3_open.owner_requests(request_id,intent_id,action,expected_db_revision,expected_chain_revision,message_hash,blockhash,last_valid_height,expires_at) VALUES($1,$2,'deposit',1,0,$3,$4,100,$5)",
    [
      requestId,
      scope.intentId,
      hash(tx.message.serialize()),
      blockhash,
      new Date(Date.now() + 60000),
    ],
  );
  await t.test(
    "unsigned and altered packets cannot create a receipt",
    async () => {
      await assert.rejects(
        () =>
          recordLocalOwnerSignature(
            pool,
            rpc,
            idl,
            scope,
            requestId,
            tx.serialize(),
          ),
        /SIGNATURE/,
      );
      const other = VersionedTransaction.deserialize(tx.serialize());
      other.signatures[0]!.fill(9);
      await assert.rejects(
        () =>
          recordLocalOwnerSignature(
            pool,
            rpc,
            idl,
            scope,
            requestId,
            other.serialize(),
          ),
        /SIGNATURE/,
      );
    },
  );
  tx.sign([owner]);
  const signed = tx.serialize(),
    signature = encodeBase58(tx.signatures[0]!);
  await t.test("two concurrent identical receipts are idempotent", async () => {
    const result = await Promise.all([
      recordLocalOwnerSignature(pool, rpc, idl, scope, requestId, signed),
      recordLocalOwnerSignature(pool, rpc, idl, scope, requestId, signed),
    ]);
    assert.deepEqual(result, [signature, signature]);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM c3_open.owner_submissions WHERE request_id=$1",
          [requestId],
        )
      ).rows[0].n,
      1,
    );
  });
  await t.test(
    "message substitution rejected even with an owner signature",
    async () => {
      const b = VersionedTransaction.deserialize(signed);
      b.message.recentBlockhash = Keypair.generate().publicKey.toBase58();
      b.sign([owner]);
      await assert.rejects(
        () =>
          recordLocalOwnerSignature(
            pool,
            rpc,
            idl,
            scope,
            requestId,
            b.serialize(),
          ),
        /MESSAGE_BINDING/,
      );
    },
  );
  await t.test(
    "restart retains public receipt and immutable rows",
    async () => {
      const second = new pg.Pool({ connectionString: url.toString() });
      try {
        assert.equal(
          (
            await second.query(
              "SELECT signature FROM c3_open.owner_submissions WHERE request_id=$1",
              [requestId],
            )
          ).rows[0].signature,
          signature,
        );
        await assert.rejects(
          () =>
            second.query(
              "UPDATE c3_open.owner_requests SET message_hash=$2 WHERE request_id=$1",
              [requestId, Buffer.alloc(32)],
            ),
          /IMMUTABLE/,
        );
        await assert.rejects(
          () =>
            second.query(
              "DELETE FROM c3_open.owner_submissions WHERE request_id=$1",
              [requestId],
            ),
          /IMMUTABLE/,
        );
      } finally {
        await second.end();
      }
    },
  );
  await t.test(
    "a finalized exact message does not issue shares or confirm economics",
    async () => {
      rpc.getSignatureStatuses = async () => ({
        context: { slot: 10 },
        value: [
          {
            slot: 10,
            confirmations: null,
            err: null,
            confirmationStatus: "finalized",
          },
        ],
      });
      rpc.getTransaction = (async () => ({
        slot: 10,
        meta: {
          err: null,
          fee: 5000,
          preBalances: [],
          postBalances: [],
          innerInstructions: [],
          preTokenBalances: [],
          postTokenBalances: [],
        },
        transaction: { message: tx.message, signatures: [signature] },
      })) as Connection["getTransaction"];
      const r = await recordLocalFinalizedOwnerMessage(
        pool,
        rpc,
        idl,
        scope,
        requestId,
      );
      assert.equal(r.status, "FINALIZED_MESSAGE_REQUIRES_EFFECTS");
      assert.equal((await db.read(scope.intentId))!.state, "draft");
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS n FROM c3_open.owner_effect_receipts",
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "HTTP position reads mint and ATA at one finalized context and never invents NAV",
    async () => {
      const mint = (
        await pool.query(
          "SELECT share_mint FROM c3_open.intents WHERE intent_id=$1",
          [scope.intentId],
        )
      ).rows[0].share_mint;
      const token = Keypair.generate().publicKey; // overwritten below with official Token-2022
      const tokenProgram = new (await import("@solana/web3.js")).PublicKey(
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      );
      const shareMint = new (await import("@solana/web3.js")).PublicKey(mint);
      const ata = Buffer.alloc(165);
      shareMint.toBuffer().copy(ata, 0);
      owner.publicKey.toBuffer().copy(ata, 32);
      ata.writeBigUInt64LE(1000000n, 64);
      ata[108] = 1;
      const m = Buffer.alloc(82);
      m.writeUInt32LE(1, 0);
      VAULT_AUTHORITY.toBuffer().copy(m, 4);
      m.writeBigUInt64LE(1000000n, 36);
      m[44] = 6;
      m[45] = 1;
      const def = idl.types!.find((t) => t.name === "VaultConfig")!.type;
      assert.equal(def.kind, "struct");
      if (def.kind !== "struct" || !def.fields)
        throw Error("CFG_FIXTURE_SCHEMA");
      const fields = Object.fromEntries(
        def.fields.map((f) => {
          if (typeof f !== "object" || !("name" in f) || !("type" in f))
            throw Error("CFG_FIXTURE_FIELD");
          return [
            f.name,
            f.type === "pubkey"
              ? owner.publicKey
              : f.type === "u64"
                ? new BN(0)
                : f.type === "bool"
                  ? false
                  : typeof f.type === "object" && "array" in f.type
                    ? Array(64).fill(0)
                    : 0,
          ];
        }),
      );
      Object.assign(fields, {
        schema_version: 1,
        share_mint: shareMint,
        allowlisted_owner: owner.publicKey,
        btc_bps: 4000,
        eth_bps: 3000,
        sol_bps: 3000,
      });
      let cfgData = await new BorshCoder(idl).accounts.encode(
        "VaultConfig",
        fields,
      );
      let malformed = false;
      rpc.getMultipleAccountsInfoAndContext = (async () => ({
        context: { slot: 12 },
        value: [
          {
            data: ata,
            owner: tokenProgram,
            executable: false,
            lamports: 1,
            rentEpoch: 0,
          },
          {
            data: m,
            owner: malformed ? token : tokenProgram,
            executable: false,
            lamports: 1,
            rentEpoch: 0,
          },
          {
            data: cfgData,
            owner: VAULT_PROGRAM,
            executable: false,
            lamports: 1,
            rentEpoch: 0,
          },
        ],
      })) as Connection["getMultipleAccountsInfoAndContext"];
      const server = createIsolatedOwnerServer(pool, rpc, idl, scope.intentId);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      try {
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        const endpoint = "http://127.0.0.1:" + address.port;
        const good = await fetch(endpoint + "/v1/c3/owner/position");
        assert.equal(good.status, 200);
        assert.deepEqual(await good.json(), {
          wallet: scope.wallet,
          shareMint: mint,
          shareUnits: "1000000",
          shareDecimals: 6,
          slot: 12,
          scope: "LOCAL_CLONE",
          nav: null,
        });
        malformed = true;
        assert.equal(
          (await fetch(endpoint + "/v1/c3/owner/position")).status,
          409,
        );
        malformed = false;
        m[44] = 9;
        assert.equal(
          (await fetch(endpoint + "/v1/c3/owner/position")).status,
          409,
        );
        m[44] = 6;
        ata[108] = 0;
        assert.equal(
          (await fetch(endpoint + "/v1/c3/owner/position")).status,
          409,
        );
        ata[108] = 1;
        m.writeBigUInt64LE(999999n, 36);
        assert.equal(
          (await fetch(endpoint + "/v1/c3/owner/position")).status,
          409,
        );
        m.writeBigUInt64LE(1000000n, 36);
        const coder = new BorshCoder(idl);
        for (const bad of [
          { allowlisted_owner: Keypair.generate().publicKey },
          { share_mint: Keypair.generate().publicKey },
          { schema_version: 0 },
          { btc_bps: 4001 },
        ]) {
          cfgData = await coder.accounts.encode("VaultConfig", {
            ...fields,
            ...bad,
          });
          assert.equal(
            (await fetch(endpoint + "/v1/c3/owner/position")).status,
            409,
          );
        }
        cfgData = await coder.accounts.encode("VaultConfig", fields);
        assert.equal(
          (await fetch(endpoint + "/v1/c3/owner/position")).status,
          200,
        );
      } finally {
        await new Promise<void>((r, reject) =>
          server.close((e) => (e ? reject(e) : r())),
        );
      }
    },
  );
  // No private keys, packets or wallet tokens stored in any owner journal table.
  const cols = (
    await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='c3_open' AND table_name LIKE 'owner_%'",
    )
  ).rows;
  assert.ok(
    cols.every(
      (r) => !/(payload|packet|secret|private|token)/.test(r.column_name),
    ),
  );
});
