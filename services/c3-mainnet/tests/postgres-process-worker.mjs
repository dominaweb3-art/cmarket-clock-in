/** Test-only process boundary for disposable PostgreSQL restart verification. */
import { PostgresC3Repository } from "../src/postgres.ts";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { authorizationFixture, fixtureSignature } from "./fixtures.ts";
import { seedSyntheticAuthorization } from "./support/seed-synthetic-authorization.ts";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (
  !url ||
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw new Error("Disposable PostgreSQL test environment required.");

const repository = await PostgresC3Repository.fromServerEnvironment();
try {
  if (process.argv[2] === "write") {
    const authorization = authorizationFixture();
    await repository.createIntent({
      intentId: authorization.intentId,
      idempotencyKey: authorization.idempotencyKey,
      configurationVersion: authorization.configurationVersion,
      configurationHash: authorization.configurationHash,
      wallet: authorization.wallet,
      operation: authorization.operation,
      inputAmountBaseUnits: BigInt(authorization.inputAmountBaseUnits),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.transition(authorization.intentId, 1n, "awaiting_wallet");
    await seedSyntheticAuthorization(authorization);
    await repository.transition(
      authorization.intentId,
      3n,
      "intent_submitted",
      {
        submittedSignature: fixtureSignature,
      },
    );
    process.stdout.write(
      JSON.stringify({
        intentId: authorization.intentId,
        authorizationHash: authorization.authorizationHash,
      }),
    );
  } else if (process.argv[2] === "durable-write") {
    const authorization = authorizationFixture();
    await repository.createIntent({
      intentId: authorization.intentId,
      idempotencyKey: authorization.idempotencyKey,
      configurationVersion: authorization.configurationVersion,
      configurationHash: authorization.configurationHash,
      wallet: authorization.wallet,
      operation: authorization.operation,
      inputAmountBaseUnits: BigInt(authorization.inputAmountBaseUnits),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.transition(authorization.intentId, 1n, "awaiting_wallet");
    await seedSyntheticAuthorization(authorization);
    const context = await repository.inspectDurableBuilderContext(
      authorization.intentId,
    );
    if (context.authorizationHash !== authorization.authorizationHash)
      throw new Error("Durable builder context differs from authorization.");
    await repository.recordSubmittedSignature(
      authorization.intentId,
      3n,
      fixtureSignature,
    );
    process.stdout.write(JSON.stringify({ intentId: authorization.intentId }));
  } else if (process.argv[2] === "durable-recover") {
    const intentId = process.argv[3];
    const authorization = await repository.readAuthorization(intentId);
    const context = await repository.inspectDurableBuilderContext(intentId);
    const prior = await repository.readIntent(intentId);
    if (
      prior?.state !== "intent_submitted" ||
      prior.submittedSignature !== fixtureSignature ||
      context.authorizationHash !== authorization.authorizationHash
    )
      throw new Error("Durable submitted state was not recovered.");
    const recovered = await repository.requireSubmissionReconciliation(
      intentId,
      4n,
    );
    const repeated = await repository.requireSubmissionReconciliation(
      intentId,
      4n,
    );
    if (
      recovered.state !== "manual_review" ||
      recovered.manualReviewReason !== "reconciliation_required" ||
      recovered.submittedSignature !== fixtureSignature ||
      recovered.revision !== repeated.revision
    )
      throw new Error(
        "Durable recovery did not preserve signature or idempotency.",
      );
    process.stdout.write(
      JSON.stringify({
        intentId,
        revision: recovered.revision.toString(),
        signaturePreserved: true,
        idempotent: true,
      }),
    );
  } else if (process.argv[2] === "read") {
    const intentId = process.argv[3];
    const intent = await repository.readIntent(intentId);
    const authorization = await repository.readAuthorization(intentId);
    if (
      intent?.state !== "intent_submitted" ||
      intent.submittedSignature !== fixtureSignature ||
      intent.authorizationHash !== authorization.authorizationHash
    )
      throw new Error("Process-restart state mismatch.");
    process.stdout.write(
      JSON.stringify({
        state: intent.state,
        signaturePreserved: true,
        authorizationVerified: true,
      }),
    );
  } else if (process.argv[2] === "snapshot-write") {
    const record = authorizationFixture();
    const intent = await repository.createIntent({
      intentId: record.intentId,
      idempotencyKey: randomBytes(32).toString("hex"),
      configurationVersion: record.configurationVersion,
      configurationHash: record.configurationHash,
      wallet: record.wallet,
      operation: "deposit_intent",
      inputAmountBaseUnits: 1_000_000n,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const snapshotId = randomUUID();
    const evidenceId = randomUUID();
    const nav = "10000000000000000000";
    const supply = "1000000";
    const snapshotHash = sha256(`${intent.intentId}:${nav}:${supply}`);
    const fingerprint = sha256(
      `${intent.intentId}:${snapshotHash}:${nav}:${supply}`,
    );
    const client = new pg.Client(process.env.DATABASE_URL);
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO c3.c3_evidence (evidence_id,intent_id,evidence_kind,fingerprint) VALUES ($1,$2,'vault_snapshot',$3)",
        [evidenceId, intent.intentId, fingerprint],
      );
      await client.query(
        "INSERT INTO c3.c3_reconciled_snapshots (snapshot_id,intent_id,snapshot_hash,evidence_id,nav_base_units,share_supply_base_units) VALUES ($1,$2,$3,$4,$5,$6)",
        [snapshotId, intent.intentId, snapshotHash, evidenceId, nav, supply],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
    process.stdout.write(JSON.stringify({ snapshotId }));
  } else if (process.argv[2] === "snapshot-read") {
    const client = new pg.Client(process.env.DATABASE_URL);
    await client.connect();
    try {
      const result = await client.query(
        "SELECT s.intent_id,s.snapshot_hash,s.nav_base_units,s.share_supply_base_units,e.intent_id AS evidence_intent,e.evidence_kind,e.fingerprint FROM c3.c3_reconciled_snapshots s JOIN c3.c3_evidence e ON e.evidence_id=s.evidence_id WHERE s.snapshot_id=$1",
        [process.argv[3]],
      );
      const row = result.rows[0];
      if (
        !row ||
        row.evidence_intent !== row.intent_id ||
        row.evidence_kind !== "vault_snapshot" ||
        row.snapshot_hash !==
          sha256(
            `${row.intent_id}:${row.nav_base_units}:${row.share_supply_base_units}`,
          ) ||
        row.fingerprint !==
          sha256(
            `${row.intent_id}:${row.snapshot_hash}:${row.nav_base_units}:${row.share_supply_base_units}`,
          )
      )
        throw new Error("Snapshot provenance reference is corrupt.");
      process.stdout.write(
        JSON.stringify({
          linkedEvidenceVerified: true,
          numericValuesPreserved:
            row.nav_base_units === "10000000000000000000" &&
            row.share_supply_base_units === "1000000",
        }),
      );
    } finally {
      await client.end();
    }
  } else {
    throw new Error("Unknown disposable process test mode.");
  }
} finally {
  await repository.close();
}
