/** Focused disposable PostgreSQL regression; synthetic evidence, no RPC/send.
 * Run explicitly: node --experimental-strip-types --test tests/open-keeper-postgres.integration.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import { VersionedTransaction } from "@solana/web3.js";
import { applyReviewedOpenSchema } from "../src/open-owner-schema.ts";
import { isolatedKeeperJournal } from "../src/open-keeper-journal.ts";
import { keeperFixture } from "./open-keeper-journal.test.ts";
import { openAddresses } from "../src/open-state-semantics.ts";
import { encodeBase58 } from "../src/solana.ts";
import { VerifiedSettlementJournal } from "../src/open-settlement-journal.ts";
import { keeperExpiryFixture } from "./open-keeper-expiry.test.ts";

test("immutable keeper journal, concurrent one-shot send, atomic receipts and reciprocal pending barrier (real PG)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "c3-keeper-pg-")),
    data = join(root, "data"),
    socket = join(root, "socket"),
    bin = "/opt/homebrew/opt/postgresql@16/bin",
    db = "c3_test_" + randomBytes(6).toString("hex");
  mkdirSync(socket);
  const run = (command: string, args: string[]) => {
    const result = spawnSync(join(bin, command), args, { encoding: "utf8" });
    assert.equal(
      result.status,
      0,
      "disposable PostgreSQL " + command + " failed",
    );
  };
  const port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      assert.ok(a && typeof a !== "string");
      s.close(() => resolve(a.port));
    });
  });
  run("initdb", [
    "-D",
    data,
    "--auth-local=trust",
    "--auth-host=reject",
    "--no-instructions",
  ]);
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    join(root, "postgres.log"),
    "-o",
    `-c listen_addresses='' -p ${port} -k ${socket}`,
    "-w",
    "start",
  ]);
  const pool = new pg.Pool({
    host: socket,
    port,
    database: db,
    user: db,
    max: 4,
  });
  t.after(async () => {
    await pool.end();
    run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    // Exact directory created above, never an existing database/workspace.
    rmSync(root, { recursive: true });
  });
  const admin = new pg.Client({
    host: socket,
    port,
    database: "postgres",
    user: userInfo().username,
  });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE ${db} LOGIN`);
    await admin.query(`CREATE DATABASE ${db} OWNER ${db}`);
  } finally {
    await admin.end();
  }
  await applyReviewedOpenSchema(pool);
  const f = await keeperFixture(
      "create_buy_plan",
      0,
      Math.floor(Date.now() / 1000),
    ),
    intentId = f.manifest.intentId;
  await pool.query(
    "INSERT INTO c3_open.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,state,db_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,1000000,'funded',12,clock_timestamp()+interval '1 hour')",
    [
      intentId,
      f.policy.wallet,
      f.policy.vault,
      f.policy.shareMint,
      f.manifest.plan,
      f.policy.configurationHash,
    ],
  );
  await pool.query(
    "INSERT INTO c3_open.legs(intent_id,ordinal) SELECT $1,n FROM generate_series(0,5) n",
    [intentId],
  );
  let observations = 0;
  const journal = isolatedKeeperJournal(
    pool,
    f.policy,
    f.rpc,
    f.compiler,
    f.manifest.genesis,
    {
      collect: async () => {
        observations++;
        return f.evidence;
      },
    },
  );
  const prepared = await journal.prepare(intentId, "create_buy_plan");
  assert.deepEqual(Buffer.from(prepared.packet), Buffer.from(f.unsigned));
  await assert.rejects(
    new VerifiedSettlementJournal(pool).lease(
      {
        intentId,
        wallet: f.policy.wallet,
        vault: f.policy.vault,
        expectedDbRevision: 12n,
        expectedChainRevision: 0n,
        idempotencyHash: "ab".repeat(32),
      },
      0,
      randomUUID(),
    ),
    /C3_OPEN_KEEPER_RECONCILE_PENDING/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT db_revision FROM c3_open.intents WHERE intent_id=$1",
        [intentId],
      )
    ).rows[0].db_revision,
    "12",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT state FROM c3_open.legs WHERE intent_id=$1 AND ordinal=0",
        [intentId],
      )
    ).rows[0].state,
    "pending",
  );
  await assert.rejects(
    journal.prepare(intentId, "create_buy_plan"),
    /C3_KEEPER_RECONCILE_PENDING/,
  );
  for (const table of [
    "owner_requests",
    "renewal_requests",
    "leg_context_verifications",
  ]) {
    await assert.rejects(
      pool.query(`INSERT INTO c3_open.${table}(intent_id) VALUES($1)`, [
        intentId,
      ]),
      /C3_KEEPER_RECONCILE_PENDING/,
    );
  }
  for (const sql of [
    "UPDATE c3_open.keeper_packets SET action='record_buy' WHERE request_id=$1",
    "DELETE FROM c3_open.keeper_packets WHERE request_id=$1",
  ])
    await assert.rejects(
      pool.query(sql, [prepared.requestId]),
      /C3_KEEPER_APPEND_ONLY/,
    );
  const signed = VersionedTransaction.deserialize(prepared.packet);
  signed.sign([f.keeper]);
  assert.equal(
    await journal.recordSignedPacket(prepared.requestId, signed.serialize()),
    f.signature,
  );
  assert.equal(
    await journal.recordSignedPacket(prepared.requestId, signed.serialize()),
    f.signature,
  );
  const racing = await Promise.allSettled([
    journal.claimSendAttempt(prepared.requestId),
    journal.claimSendAttempt(prepared.requestId),
  ]);
  assert.equal(
    racing.filter((r) => r.status === "fulfilled" && r.value).length,
    1,
  );
  for (const r of racing)
    if (r.status === "rejected") assert.equal(r.reason.code, "40001");
  assert.equal(await journal.claimSendAttempt(prepared.requestId), false);
  for (const table of ["keeper_signatures", "keeper_send_attempts"])
    await assert.rejects(
      pool.query(`DELETE FROM c3_open.${table} WHERE request_id=$1`, [
        prepared.requestId,
      ]),
      /C3_KEEPER_APPEND_ONLY/,
    );
  const restarted = isolatedKeeperJournal(
    pool,
    f.policy,
    f.rpc,
    f.compiler,
    f.manifest.genesis,
    {
      collect: async () => {
        observations++;
        return f.evidence;
      },
    },
  );
  const saved = await restarted.recover(prepared.requestId);
  assert.equal(saved.signature, f.signature);
  assert.equal(saved.sendAttempted, true);
  assert.equal(saved.disposition.state, "SEND_ATTEMPTED_RECONCILE_ONLY");
  assert.equal(saved.disposition.barrierReleased, false);
  assert.deepEqual(
    Buffer.from(saved.signedPacket!),
    Buffer.from(signed.serialize()),
  );
  const rejected = isolatedKeeperJournal(
    pool,
    f.policy,
    f.rpc,
    f.compiler,
    f.manifest.genesis,
    {
      collect: async () => {
        const e = structuredClone(f.evidence);
        e.statuses.secondary.value[0]!.confirmationStatus = "confirmed";
        return e;
      },
    },
  );
  await assert.rejects(
    rejected.reconcile(prepared.requestId),
    /C3_KEEPER_FINALITY/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT db_revision FROM c3_open.intents WHERE intent_id=$1",
        [intentId],
      )
    ).rows[0].db_revision,
    "12",
  );
  assert.equal(
    (await restarted.reconcile(prepared.requestId)).status,
    "reconciled",
  );
  const before = observations;
  assert.equal(
    (await restarted.reconcile(prepared.requestId)).status,
    "already_reconciled",
  );
  assert.equal(observations, before);
  const state = (
    await pool.query(
      "SELECT state,db_revision,chain_revision FROM c3_open.intents WHERE intent_id=$1",
      [intentId],
    )
  ).rows[0];
  assert.deepEqual(state, {
    state: "funded",
    db_revision: "13",
    chain_revision: "0",
  });
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM c3_open.events WHERE intent_id=$1",
        [intentId],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM c3_open.outbox")).rows[0]
      .n,
    1,
  );
  await assert.rejects(
    pool.query(
      "DELETE FROM c3_open.keeper_effect_receipts WHERE request_id=$1",
      [prepared.requestId],
    ),
    /C3_KEEPER_APPEND_ONLY/,
  );
  // Barrier released ONLY by the proven receipt, not by the send attempt.
  await assert.rejects(
    pool.query("INSERT INTO c3_open.owner_requests(intent_id) VALUES($1)", [
      intentId,
    ]),
    (error) => (error as { code: string }).code === "23502",
  );
  // Real PG CAS for BOTH record transitions. These signed public fixtures are
  // not three swaps or economic C3 inventory; their purpose is journal atomicity.
  for (const action of ["record_buy", "record_sell"] as const) {
    const r = await keeperFixture(action),
      selling = action === "record_sell",
      a = openAddresses({ ...r.policy, program: r.policy.programId });
    await pool.query(
      "INSERT INTO c3_open.intents(intent_id,wallet,vault,share_mint,deposit_plan,redemption_plan,configuration_hash,deposit_amount,state,db_revision,chain_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,1000000,$8,12,3,clock_timestamp()+interval '1 hour')",
      [
        r.manifest.intentId,
        r.policy.wallet,
        r.policy.vault,
        r.policy.shareMint,
        a.depositPlan,
        selling ? a.redemptionPlan : null,
        r.policy.configurationHash,
        selling ? "selling" : "buying",
      ],
    );
    for (let ordinal = 0; ordinal < 6; ordinal++) {
      const leg = ordinal % 3,
        inputAmount =
          ordinal < 3 ? [400000, 300000, 300000][leg] : [11, 22, 33][leg],
        outputAmount = ordinal < 3 ? [11, 22, 33][leg] : 300000;
      await pool.query(
        "INSERT INTO c3_open.legs(intent_id,ordinal,state,chain_revision,route_hash,instruction_hash,authorization_hash,minimum_output,quote_expires_at,submitted_signature,evidence_hash,observed_effects) VALUES($1,$2,'confirmed',3,$3,$3,$3,1,clock_timestamp()+interval '1 hour',$4,$3,$5)",
        [
          r.manifest.intentId,
          ordinal,
          "a".repeat(64),
          encodeBase58(Buffer.alloc(64, ordinal + (selling ? 20 : 10))),
          {
            inputAmount: String(inputAmount),
            outputAmount: String(outputAmount),
          },
        ],
      );
    }
    const records = isolatedKeeperJournal(
        pool,
        r.policy,
        r.rpc,
        r.compiler,
        r.manifest.genesis,
        { collect: async () => r.evidence },
      ),
      request = await records.prepare(r.manifest.intentId, action),
      packet = VersionedTransaction.deserialize(request.packet);
    packet.sign([r.keeper]);
    await records.recordSignedPacket(request.requestId, packet.serialize());
    assert.equal(
      (await records.reconcile(request.requestId)).status,
      "reconciled",
    );
    const row = (
      await pool.query(
        "SELECT state,db_revision,chain_revision FROM c3_open.intents WHERE intent_id=$1",
        [r.manifest.intentId],
      )
    ).rows[0];
    assert.deepEqual(row, {
      state: selling ? "claimable" : "buying",
      db_revision: "13",
      chain_revision: "3",
    });
    assert.equal(
      (await records.reconcile(request.requestId)).status,
      "already_reconciled",
    );
  }
  // Expired uncertain packet closes only with read-only non-execution proof.
  // All signature/send records survive and new preparation needs the new CAS.
  const expired = await keeperExpiryFixture(Math.floor(Date.now() / 1000));
  const eid = expired.manifest.intentId;
  await pool.query(
    "INSERT INTO c3_open.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,state,db_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,1000000,'funded',12,clock_timestamp()+interval '1 hour')",
    [
      eid,
      expired.policy.wallet,
      expired.policy.vault,
      expired.policy.shareMint,
      expired.manifest.plan,
      expired.policy.configurationHash,
    ],
  );
  let closing = false;
  const expiryRpc = {
    read: async (method: string, params: unknown[]) =>
      closing
        ? expired.rpc.read(method)
        : expired.compilerRpc.read(method, params),
  };
  const ej = isolatedKeeperJournal(
    pool,
    expired.policy,
    expiryRpc,
    expired.compiler,
    expired.manifest.genesis,
    { collect: async () => expired.evidence },
  );
  const ep = await ej.prepare(eid, "create_buy_plan");
  await ej.recordSignedPacket(ep.requestId, expired.packet);
  assert.equal(await ej.claimSendAttempt(ep.requestId), true);
  closing = true;
  const closures = await Promise.allSettled([
    ej.closeExpired(ep.requestId),
    ej.closeExpired(ep.requestId),
  ]);
  assert.equal(
    closures.filter(
      (r) => r.status === "fulfilled" && r.value.status === "closed_unexecuted",
    ).length,
    1,
  );
  for (const r of closures)
    if (r.status === "rejected")
      assert.ok(
        r.reason.code === "40001" ||
          r.reason.message === "C3_KEEPER_TERMINAL_CONFLICT",
      );
  assert.equal((await ej.closeExpired(ep.requestId)).status, "already_closed");
  const recovered = await ej.recover(ep.requestId);
  assert.equal(recovered.signature, expired.signature);
  assert.equal(recovered.sendAttempted, true);
  assert.equal(recovered.disposition.barrierReleased, true);
  assert.equal(await ej.claimSendAttempt(ep.requestId), false);
  await assert.rejects(ej.reconcile(ep.requestId), /CLOSED_UNEXECUTED/);
  await assert.rejects(
    pool.query(
      "DELETE FROM c3_open.keeper_request_outcomes WHERE request_id=$1",
      [ep.requestId],
    ),
    /APPEND_ONLY/,
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO c3_open.keeper_effect_receipts(request_id,signature,finalized_slot,evidence_hash) VALUES($1,$2,999,$3)",
      [ep.requestId, expired.signature, Buffer.alloc(32, 1)],
    ),
    /TERMINAL_CONFLICT/,
  );
  const preserved = (
    await pool.query(
      "SELECT state,db_revision,chain_revision,deposit_amount FROM c3_open.intents WHERE intent_id=$1",
      [eid],
    )
  ).rows[0];
  assert.deepEqual(preserved, {
    state: "funded",
    db_revision: "13",
    chain_revision: "0",
    deposit_amount: "1000000",
  });
  closing = false;
  // Fixture reports old revision; real new compile must read the latest row.
  const next = await ej.prepare(eid, "create_buy_plan");
  assert.notEqual(next.requestId, ep.requestId);
  assert.equal(next.manifest.dbRevision, "13");
  // Deterministic races across the NETWORK/DB boundary. Synthetic contradictory
  // observations test exclusivity only; they never prove Solana finality.
  for (const mode of [
    "close-first",
    "reconcile-first",
    "late-signature",
  ] as const) {
    await t.test(mode, async () => {
      const race = await keeperExpiryFixture(Math.floor(Date.now() / 1000));
      const rid = race.manifest.intentId;
      await pool.query(
        "INSERT INTO c3_open.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,state,db_revision,expires_at) VALUES($1,$2,$3,$4,$5,$6,1000000,'funded',12,clock_timestamp()+interval '1 hour')",
        [
          rid,
          race.policy.wallet,
          race.policy.vault,
          race.policy.shareMint,
          race.manifest.plan,
          race.policy.configurationHash,
        ],
      );
      let expiredReads = false;
      let held = false;
      let arrive!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pause = async () => {
        held = true;
        arrive();
        await gate;
      };
      const port = {
        read: async (method: string, params: unknown[]) => {
          if (!expiredReads) return race.compilerRpc.read(method, params);
          if (
            mode !== "close-first" &&
            method === "getMultipleAccounts" &&
            !held
          )
            await pause();
          return race.rpc.read(method);
        },
      };
      const j = isolatedKeeperJournal(
        pool,
        race.policy,
        port,
        race.compiler,
        race.manifest.genesis,
        {
          collect: async () => {
            if (mode === "close-first" && !held) await pause();
            return race.evidence;
          },
        },
      );
      const packet = await j.prepare(rid, "create_buy_plan");
      if (mode !== "late-signature")
        await j.recordSignedPacket(packet.requestId, race.packet);
      expiredReads = true;
      const losing =
        mode === "close-first"
          ? j.reconcile(packet.requestId)
          : j.closeExpired(packet.requestId);
      // Attach the rejection handler BEFORE unblocking to avoid unhandled errors.
      const observed = losing.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await reached;
      try {
        if (mode === "close-first")
          assert.equal(
            (await j.closeExpired(packet.requestId)).status,
            "closed_unexecuted",
          );
        else if (mode === "reconcile-first")
          assert.equal(
            (await j.reconcile(packet.requestId)).status,
            "reconciled",
          );
        else
          assert.equal(
            await j.recordSignedPacket(packet.requestId, race.packet),
            race.signature,
          );
      } finally {
        release();
      }
      const result = await observed;
      assert.ok(
        "error" in result,
        "stale pre-lock observation must not commit",
      );
      assert.match(
        String((result as { error: Error }).error.message),
        /CAS|TERMINAL_CONFLICT|SIGNATURE_RACE/,
      );
      const counts = (
        await pool.query(
          "SELECT (SELECT count(*)::int FROM c3_open.keeper_effect_receipts WHERE request_id=$1) AS receipts,(SELECT count(*)::int FROM c3_open.keeper_request_outcomes WHERE request_id=$1) AS outcomes,(SELECT count(*)::int FROM c3_open.keeper_signatures WHERE request_id=$1) AS signatures",
          [packet.requestId],
        )
      ).rows[0];
      assert.deepEqual(counts, {
        receipts: mode === "reconcile-first" ? 1 : 0,
        outcomes: mode === "close-first" ? 1 : 0,
        signatures: 1,
      });
      assert.equal(
        (await j.recover(packet.requestId)).signature,
        race.signature,
      );
    });
  }
});
