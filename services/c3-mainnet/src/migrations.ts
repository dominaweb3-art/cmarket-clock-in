import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";

const MIGRATION_ID = "0001_c3_state";
const MANIFEST_MIGRATION_ID = "0002_c3_manifest_order";
const PILOT_MIGRATION_ID = "0003_c3_owner_pilot";
const BUILDER_MIGRATION_ID = "0004_c3_builder";
const MIGRATION_URL = new URL(
  "../migrations/0001_c3_state.sql",
  import.meta.url,
);
const MANIFEST_MIGRATION_URL = new URL(
  "../migrations/0002_c3_manifest_order.sql",
  import.meta.url,
);
const PILOT_MIGRATION_URL = new URL(
  "../migrations/0003_c3_owner_pilot.sql",
  import.meta.url,
);
const BUILDER_MIGRATION_URL = new URL(
  "../migrations/0004_c3_builder.sql",
  import.meta.url,
);

async function migrationText(
  url = MIGRATION_URL,
): Promise<Readonly<{ sql: string; checksum: string }>> {
  const sql = await readFile(url, "utf8");
  return Object.freeze({
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  });
}

/** Append-only migration for manifest ordering, applied only by an explicit operator/test runner. */
export async function applyC3ManifestOrderingMigration(
  client: PoolClient,
): Promise<"applied" | "already_applied"> {
  const { sql, checksum } = await migrationText(MANIFEST_MIGRATION_URL);
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_advisory_xact_lock(304137, 1)");
    const baseline = await client.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM c3.schema_migrations WHERE migration_id=$1",
      [MIGRATION_ID],
    );
    const original = await migrationText();
    if (baseline.rows[0]?.checksum_sha256 !== original.checksum)
      throw new Error("C3 baseline migration is absent or mismatched.");
    const previous = await client.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM c3.schema_migrations WHERE migration_id=$1",
      [MANIFEST_MIGRATION_ID],
    );
    if (previous.rows.length) {
      if (previous.rows[0]?.checksum_sha256 !== checksum)
        throw new Error("C3 manifest migration checksum mismatch.");
      await client.query("COMMIT");
      return "already_applied";
    }
    await client.query(sql);
    await client.query(
      "INSERT INTO c3.schema_migrations (migration_id,checksum_sha256) VALUES ($1,$2)",
      [MANIFEST_MIGRATION_ID, checksum],
    );
    await client.query("COMMIT");
    return "applied";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Apply only to a new, explicitly approved database. Never auto-migrate at bootstrap. */
export async function applyC3SchemaMigration(
  client: PoolClient,
): Promise<"applied" | "already_applied"> {
  const { sql, checksum } = await migrationText();
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_advisory_xact_lock(304137, 1)");
    const exists = await client.query<{ relation: string | null }>(
      "SELECT to_regclass('c3.schema_migrations')::text AS relation",
    );
    if (exists.rows[0]?.relation) {
      const previous = await client.query<{ checksum_sha256: string }>(
        "SELECT checksum_sha256 FROM c3.schema_migrations WHERE migration_id=$1",
        [MIGRATION_ID],
      );
      if (
        previous.rows.length !== 1 ||
        previous.rows[0]?.checksum_sha256 !== checksum
      )
        throw new Error(
          "C3 schema version or checksum mismatch; bootstrap rejected.",
        );
      await client.query("COMMIT");
      return "already_applied";
    }
    if (
      await client
        .query("SELECT to_regnamespace('c3') AS namespace")
        .then((result) => result.rows[0]?.namespace)
    )
      throw new Error("Untracked C3 schema exists; migration rejected.");
    await client.query(sql);
    await client.query(
      `CREATE TABLE c3.schema_migrations (
         migration_id text PRIMARY KEY,
         checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
         applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
       )`,
    );
    await client.query(
      "INSERT INTO c3.schema_migrations (migration_id,checksum_sha256) VALUES ($1,$2)",
      [MIGRATION_ID, checksum],
    );
    await client.query("COMMIT");
    return "applied";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function assertC3SchemaCurrent(pool: Pool): Promise<void> {
  const { checksum } = await migrationText();
  const manifest = await migrationText(MANIFEST_MIGRATION_URL);
  try {
    const result = await pool.query<{
      migration_id: string;
      checksum_sha256: string;
    }>(
      "SELECT migration_id,checksum_sha256 FROM c3.schema_migrations WHERE migration_id IN ($1,$2)",
      [MIGRATION_ID, MANIFEST_MIGRATION_ID],
    );
    if (
      result.rows.length !== 2 ||
      result.rows.find((row) => row.migration_id === MIGRATION_ID)
        ?.checksum_sha256 !== checksum ||
      result.rows.find((row) => row.migration_id === MANIFEST_MIGRATION_ID)
        ?.checksum_sha256 !== manifest.checksum
    )
      throw new Error(
        "C3 schema version or checksum mismatch; bootstrap rejected.",
      );
  } catch {
    throw new Error("C3 schema is absent or mismatched; bootstrap rejected.");
  }
}

/** Explicit, forward-only pilot migration. Existing service bootstrap stays unchanged. */
export async function applyC3PilotMigration(
  client: PoolClient,
): Promise<"applied" | "already_applied"> {
  const pilot = await migrationText(PILOT_MIGRATION_URL);
  const baseline = await migrationText();
  const manifest = await migrationText(MANIFEST_MIGRATION_URL);
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_advisory_xact_lock(304137, 1)");
    const rows = await client.query<{
      migration_id: string;
      checksum_sha256: string;
    }>(
      "SELECT migration_id,checksum_sha256 FROM c3.schema_migrations WHERE migration_id IN ($1,$2,$3)",
      [MIGRATION_ID, MANIFEST_MIGRATION_ID, PILOT_MIGRATION_ID],
    );
    const found = new Map(
      rows.rows.map((row) => [row.migration_id, row.checksum_sha256]),
    );
    if (
      found.get(MIGRATION_ID) !== baseline.checksum ||
      found.get(MANIFEST_MIGRATION_ID) !== manifest.checksum
    )
      throw new Error("C3 prerequisite migration is absent or mismatched.");
    if (found.has(PILOT_MIGRATION_ID)) {
      if (found.get(PILOT_MIGRATION_ID) !== pilot.checksum)
        throw new Error("C3 pilot migration checksum mismatch.");
      await client.query("COMMIT");
      return "already_applied";
    }
    await client.query(pilot.sql);
    await client.query(
      "INSERT INTO c3.schema_migrations (migration_id,checksum_sha256) VALUES ($1,$2)",
      [PILOT_MIGRATION_ID, pilot.checksum],
    );
    await client.query("COMMIT");
    return "applied";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Pilot repository must never start on an untracked or partially migrated schema. */
export async function assertC3PilotSchemaCurrent(pool: Pool): Promise<void> {
  await assertC3SchemaCurrent(pool);
  const { checksum } = await migrationText(PILOT_MIGRATION_URL);
  try {
    const result = await pool.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM c3.schema_migrations WHERE migration_id=$1",
      [PILOT_MIGRATION_ID],
    );
    if (
      result.rows.length !== 1 ||
      result.rows[0]?.checksum_sha256 !== checksum
    )
      throw new Error("C3 pilot migration mismatch.");
  } catch {
    throw new Error(
      "C3 pilot schema is absent or mismatched; bootstrap rejected.",
    );
  }
}

/** Explicit builder schema migration. Never invoked by application bootstrap. */
export async function applyC3BuilderMigration(
  client: PoolClient,
): Promise<"applied" | "already_applied"> {
  const builder = await migrationText(BUILDER_MIGRATION_URL);
  const pilot = await migrationText(PILOT_MIGRATION_URL);
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await client.query("SELECT pg_advisory_xact_lock(304137, 1)");
    const rows = await client.query<{
      migration_id: string;
      checksum_sha256: string;
    }>(
      "SELECT migration_id,checksum_sha256 FROM c3.schema_migrations WHERE migration_id IN ($1,$2)",
      [PILOT_MIGRATION_ID, BUILDER_MIGRATION_ID],
    );
    const found = new Map(
      rows.rows.map((row) => [row.migration_id, row.checksum_sha256]),
    );
    if (found.get(PILOT_MIGRATION_ID) !== pilot.checksum)
      throw new Error("C3 pilot migration is absent or mismatched.");
    if (found.has(BUILDER_MIGRATION_ID)) {
      if (found.get(BUILDER_MIGRATION_ID) !== builder.checksum)
        throw new Error("C3 builder migration checksum mismatch.");
      await client.query("COMMIT");
      return "already_applied";
    }
    await client.query(builder.sql);
    await client.query(
      "INSERT INTO c3.schema_migrations (migration_id,checksum_sha256) VALUES ($1,$2)",
      [BUILDER_MIGRATION_ID, builder.checksum],
    );
    await client.query("COMMIT");
    return "applied";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function assertC3BuilderSchemaCurrent(pool: Pool): Promise<void> {
  await assertC3PilotSchemaCurrent(pool);
  const { checksum } = await migrationText(BUILDER_MIGRATION_URL);
  try {
    const result = await pool.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM c3.schema_migrations WHERE migration_id=$1",
      [BUILDER_MIGRATION_ID],
    );
    if (
      result.rows.length !== 1 ||
      result.rows[0]?.checksum_sha256 !== checksum
    )
      throw new Error("C3 builder migration mismatch.");
  } catch {
    throw new Error(
      "C3 builder schema is absent or mismatched; bootstrap rejected.",
    );
  }
}
