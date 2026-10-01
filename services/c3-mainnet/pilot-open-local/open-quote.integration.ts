/** Disposable PG, ephemeral Ed25519 key, SYNTHETIC builder. Not real C3 execution. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { PublicKey } from "@solana/web3.js";
import {
  applyOpenLocalMigration,
  OpenLocalSettlementRepository,
} from "./orchestrator.ts";
import {
  OpenQuoteAuthority,
  openQuoteContext,
  type StoredQuoteContext,
  type OpenQuoteBuilder,
} from "./open-quote.ts";
import { quoteContextHash } from "../src/quote-seal.ts";
import { createReadServer } from "./read-server.ts";
import { IsolatedOpenTestSigner } from "./isolated-test-signer.ts";
const url = new URL(process.env.DATABASE_URL!);
if (
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw new Error("DISPOSABLE_DB_REQUIRED");
const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
const signer = await IsolatedOpenTestSigner.start();
const authority = Buffer.from(signer.publicKey);
const addr = (i: number) => new PublicKey(Buffer.alloc(32, i)).toBase58(),
  hash = (s: string) => createHash("sha256").update(s).digest("hex");
const material = (size = 1232) => ({
  authorizationNonce: randomBytes(32),
  quotedOutput: 474n,
  jupiterThreshold: 470n,
  slippageBps: 100,
  routeHash: randomBytes(32),
  instructionHash: randomBytes(32),
  accountMetasHash: randomBytes(32),
  altCount: 0,
  altContentsHash: Buffer.alloc(32),
  builderTimestamp: BigInt(Math.floor(Date.now() / 1000)),
  builderSlot: 100n,
  expiresAt: BigInt(Math.floor(Date.now() / 1000)) + 25n,
  expiresSlot: 200n,
  unsignedPacketBytes: size,
});
const builder: OpenQuoteBuilder = {
  validateAndBuild: async (c) => {
    assert.equal(c.inputAmount, "400000");
    return material();
  },
};
async function fixture() {
  const id = randomUUID(),
    wallet = addr(2),
    vault = addr(3),
    plan = new PublicKey(randomBytes(32)).toBase58();
  // Terminal older test intentions do not block a fresh isolated fixture wallet.
  await pool.query(
    "UPDATE c3_open.intents SET state='cancelled',db_revision=db_revision+1 WHERE wallet=$1 AND state='funded'",
    [wallet],
  );
  const db = await OpenLocalSettlementRepository.fromVerifiedPool(pool);
  await db.createDraft({
    intentId: id,
    wallet,
    vault,
    shareMint: addr(4),
    depositPlan: plan,
    configurationHash: hash("config"),
    expiresAt: new Date(Date.now() + 600000),
    idempotencyHash: hash(randomUUID()),
  });
  await pool.query(
    "UPDATE c3_open.intents SET state='funded',db_revision=2 WHERE intent_id=$1",
    [id],
  );
  const ctx: StoredQuoteContext = {
    keeper: addr(7),
    governance: addr(8),
    policy: addr(9),
    reviewedPrograms: [],
    genesisHash: hash("local"),
    vault,
    configVersion: "1",
    registry: addr(6),
    registryRevision: "1",
    registryHash: hash("registry"),
    plan,
    planRevision: "0",
    intent: addr(7),
    wallet,
    leg: 0,
    direction: 1,
    inputMint: addr(8),
    outputMint: addr(9),
    source: addr(5),
    destination: addr(6),
    routerProgram: addr(7),
    policyRevision: "1",
    inputAmount: "400000",
    authority: authority.toString("hex"),
    maxSlippageBps: 100,
    maxQuoteAgeSeconds: 30,
    planExpiresAt: String(Math.floor(Date.now() / 1000) + 600),
    configurationHash: hash("config"),
  };
  await pool.query(
    "INSERT INTO c3_open.quote_contexts(intent_id,ordinal,intent_revision,context,context_hash,scope) VALUES($1,0,2,$2,$3,'LOCAL_MOCK')",
    [id, ctx, quoteContextHash(openQuoteContext(ctx))],
  );
  return { id, ctx };
}
test("forward namespace migration and durable signer binding", async (t) => {
  t.after(() => signer.close());
  t.after(() => pool.end());
  const c = await pool.connect();
  try {
    assert.equal(await applyOpenLocalMigration(c), "applied");
    assert.equal(await applyOpenLocalMigration(c), "already_applied");
  } finally {
    c.release();
  }
  assert.equal(
    (await pool.query("SELECT to_regclass('c3.c3_pilot_intents') AS old"))
      .rows[0].old,
    null,
    "must not duplicate historical intents",
  );
  const f = await fixture(),
    service = new OpenQuoteAuthority(pool, builder);
  const quoteId = await service.prepare(f.id, 0, 2n);
  const before = (
    await pool.query(
      "SELECT * FROM c3_open.quote_authorizations WHERE quote_id=$1",
      [Buffer.from(quoteId, "hex")],
    )
  ).rows[0];
  assert.equal(before.state, "prepared");
  assert.equal(before.canonical_payload.readBigUInt64LE(131), 470n);
  const substituted = Buffer.from(before.canonical_payload);
  substituted[121]! ^= 1;
  await assert.rejects(
    () => signer.signCanonicalBytes(substituted),
    /PERSISTED_BYTES_MISMATCH/,
  );
  await assert.rejects(
    () => signer.signCanonicalBytes(Buffer.alloc(300)),
    /NOT_SIGNABLE/,
  );
  let callbacks = 0;
  await assert.rejects(
    () =>
      service.signPersisted(quoteId, {
        publicKey: randomBytes(32),
        signCanonicalBytes: async () => {
          callbacks++;
          return Buffer.alloc(64);
        },
      }),
    /PERSISTED_TAMPERING/,
  );
  assert.equal(callbacks, 0);
  const restarted = new OpenQuoteAuthority(pool, builder);
  const signed = await restarted.signPersisted(quoteId, signer);
  assert.equal(signed.signature.length, 64);
  assert.deepEqual(
    (await new OpenQuoteAuthority(pool, builder).signPersisted(quoteId, signer))
      .signature,
    signed.signature,
  );
  const repository = await OpenLocalSettlementRepository.fromVerifiedPool(pool);
  const bound = await fixture(),
    worker = randomUUID();
  const scope = (revision: bigint) => ({
    intentId: bound.id,
    wallet: bound.ctx.wallet,
    vault: bound.ctx.vault,
    expectedDbRevision: revision,
    expectedChainRevision: 0n,
    idempotencyHash: hash(randomUUID()),
  });
  const leased = await repository.lease(scope(2n), 0, worker);
  await pool.query(
    `INSERT INTO c3_open.quote_contexts(intent_id,ordinal,intent_revision,context,context_hash,scope)
    SELECT intent_id,ordinal,$2,context,context_hash,scope FROM c3_open.quote_contexts WHERE intent_id=$1 AND intent_revision=2`,
    [bound.id, leased.dbRevision.toString()],
  );
  const boundId = await service.prepare(bound.id, 0, leased.dbRevision),
    boundSeal = await service.signPersisted(boundId, signer);
  const details = {
    routeHash: boundSeal.payload.subarray(139, 171).toString("hex"),
    instructionHash: boundSeal.payload.subarray(171, 203).toString("hex"),
    authorizationHash: hashBytes(boundSeal.payload),
    inputMint: bound.ctx.inputMint,
    outputMint: bound.ctx.outputMint,
    source: bound.ctx.source,
    destination: bound.ctx.destination,
    inputAmount: 400000n,
    minimumOutput: 470n,
    quoteExpiresAt: new Date(
      Number(boundSeal.payload.readBigInt64LE(284)) * 1000,
    ),
    expectedEffects: { scope: "SYNTHETIC_ONLY" },
  };
  for (const tamper of [
    { authorizationHash: hash("substitute") },
    { inputAmount: 400001n },
    { minimumOutput: 469n },
    { inputMint: addr(11) },
    { outputMint: addr(12) },
    { source: addr(13) },
    { destination: addr(14) },
    { routeHash: hash("route") },
    { instructionHash: hash("instruction") },
  ])
    await assert.rejects(
      () =>
        repository.prepare(scope(leased.dbRevision), 0, worker, {
          ...details,
          ...tamper,
        }),
      /SIGNED_OPEN_SEAL_REQUIRED|OPEN_SEAL_PREPARATION_MISMATCH/,
    );
  await repository.prepare(scope(leased.dbRevision), 0, worker, details);
  for (const sql of [
    'UPDATE c3_open.quote_contexts SET context=context || \'{"wallet":"forged"}\' WHERE intent_id=$1',
    "UPDATE c3_open.quote_authorizations SET canonical_payload=repeat('a',300)::bytea,revision=revision+1 WHERE intent_id=$1",
    "UPDATE c3_open.quote_authorizations SET evidence='{}',revision=revision+1 WHERE intent_id=$1",
    "UPDATE c3_open.quote_authorizations SET signature=repeat('a',64)::bytea,revision=revision+1 WHERE intent_id=$1",
  ])
    await assert.rejects(() => pool.query(sql, [f.id]), /IMMUTABLE/);
  const parallel = await fixture();
  const requests = await Promise.allSettled([
    service.prepare(parallel.id, 0, 2n),
    service.prepare(parallel.id, 0, 2n),
  ]);
  assert.equal(requests.filter((r) => r.status === "fulfilled").length, 1);
  const oversized = await fixture();
  await assert.rejects(
    () =>
      new OpenQuoteAuthority(pool, {
        validateAndBuild: async () => material(1233),
      }).prepare(oversized.id, 0, 2n),
    /TRANSACTION_SIZE/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM c3_open.quote_authorizations WHERE intent_id=$1",
        [oversized.id],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(() => service.prepare(oversized.id, 0, 1n), /CAS/);
  await assert.rejects(
    () =>
      new OpenQuoteAuthority(pool, {
        validateAndBuild: async () => ({ ...material(), expiresAt: 0n }),
      }).prepare(oversized.id, 0, 2n),
    /FRESHNESS/,
  );
  for (const malformed of [
    {
      ...material(),
      builderTimestamp: BigInt(Math.floor(Date.now() / 1000)) + 5n,
    },
    { ...material(), expiresAt: BigInt(Math.floor(Date.now() / 1000)) + 31n },
    { ...material(), slippageBps: 101 },
    { ...material(), slippageBps: 0 },
  ])
    await assert.rejects(
      () =>
        new OpenQuoteAuthority(pool, {
          validateAndBuild: async () => malformed,
        }).prepare(oversized.id, 0, 2n),
      /FRESHNESS_OR_POLICY/,
    );
  const invalid = await service.prepare(oversized.id, 0, 2n);
  await assert.rejects(
    () =>
      service.signPersisted(invalid, {
        publicKey: authority,
        signCanonicalBytes: async () => Buffer.alloc(64),
      }),
    /INVALID_SIGNATURE/,
  );
  // A syntactically valid, corrupted DB signature never becomes confirmed.
  await pool.query(
    "UPDATE c3_open.quote_authorizations SET state='signed',signature=$2,revision=revision+1 WHERE quote_id=$1",
    [Buffer.from(invalid, "hex"), Buffer.alloc(64)],
  );
  await assert.rejects(
    () => service.signPersisted(invalid, signer),
    /INVALID_SIGNATURE/,
  );
  const server = createReadServer(pool);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const root = `http://127.0.0.1:${address.port}`;
    const status = (await (
      await fetch(`${root}/v1/c3/status?wallet=${f.ctx.wallet}`)
    ).json()) as {
      position: unknown;
      evidenceScope: string;
      mainnetExecutionEnabled: boolean;
    };
    assert.equal(status.position, null);
    assert.equal(status.evidenceScope, "LOCAL_SIMULATION");
    assert.equal(status.mainnetExecutionEnabled, false);
    assert.equal(
      (
        await fetch(`${root}/v1/c3/status?wallet=${f.ctx.wallet}`, {
          method: "POST",
        })
      ).status,
      400,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
function hashBytes(b: Uint8Array) {
  return createHash("sha256").update(b).digest("hex");
}
