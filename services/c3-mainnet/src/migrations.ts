import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";

const MIGRATION_ID = "0001_c3_state";
const MIGRATION_URL = new URL(
  "../migrations/0001_c3_state.sql",
  import.meta.url,
);

async function migrationText(): Promise<
  Readonly<{ sql: string; checksum: string }>
> {
  const sql = await readFile(MIGRATION_URL, "utf8");
  return Object.freeze({
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  });
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
  try {
    const result = await pool.query<{ checksum_sha256: string }>(
      "SELECT checksum_sha256 FROM c3.schema_migrations WHERE migration_id=$1",
      [MIGRATION_ID],
    );
    if (
      result.rows.length !== 1 ||
      result.rows[0]?.checksum_sha256 !== checksum
    )
      throw new Error(
        "C3 schema version or checksum mismatch; bootstrap rejected.",
      );
  } catch {
    throw new Error("C3 schema is absent or mismatched; bootstrap rejected.");
  }
}
