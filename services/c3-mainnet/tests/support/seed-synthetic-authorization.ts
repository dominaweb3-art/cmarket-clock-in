/** Disposable PostgreSQL fixture only. Never included in the production build. */
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

import { canonicalize } from "../../src/manifest.ts";
import type { C3AuthorizationManifest } from "./synthetic-builder.ts";

export async function seedSyntheticAuthorization(
  record: C3AuthorizationManifest,
  expectedRevision = 2n,
): Promise<string> {
  const raw = process.env.DATABASE_URL;
  const url = raw ? new URL(raw) : null;
  const database = process.env.C3_DISPOSABLE_TEST_DATABASE;
  if (
    !url ||
    url.hostname !== "127.0.0.1" ||
    !/^c3_test_[a-f0-9]{12}$/.test(database ?? "") ||
    url.pathname.slice(1) !== database ||
    url.username !== database
  )
    throw new Error("Disposable PostgreSQL test environment required.");
  const client = new pg.Client({
    connectionString: raw,
    options: "-c search_path=c3,pg_catalog,pg_temp",
  });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const { rows } = await client.query<{
      revision: string;
      state: string;
      authorization_hash: string | null;
      idempotency_key: string;
      configuration_hash: string;
      wallet: string;
      operation: string;
      input_amount: string;
    }>(
      "SELECT revision,state,authorization_hash,idempotency_key,configuration_hash,wallet,operation,input_amount FROM c3_intents WHERE intent_id=$1 FOR UPDATE",
      [record.intentId],
    );
    const row = rows[0];
    if (
      !row ||
      BigInt(row.revision) !== expectedRevision ||
      row.state !== "awaiting_wallet" ||
      row.authorization_hash !== null ||
      row.idempotency_key !== record.idempotencyKey ||
      row.configuration_hash !== record.configurationHash ||
      row.wallet !== record.wallet ||
      row.operation !== record.operation ||
      row.input_amount !== record.inputAmountBaseUnits
    )
      throw new Error("Synthetic fixture does not bind durable intent.");
    const { authorizationHash, ...payload } = record;
    if (
      createHash("sha256").update(canonicalize(payload)).digest("hex") !==
      authorizationHash
    )
      throw new Error("Synthetic fixture authorization hash is invalid.");
    const authorizationId = randomUUID();
    await client.query(
      "INSERT INTO c3_authorizations (authorization_id,intent_id,intent_revision,authorization_hash,canonical_json) VALUES ($1,$2,$3,$4,$5)",
      [
        authorizationId,
        record.intentId,
        expectedRevision.toString(),
        authorizationHash,
        canonicalize(record),
      ],
    );
    const update = await client.query(
      "UPDATE c3_intents SET authorization_id=$1,authorization_hash=$2,revision=revision+1,updated_at=clock_timestamp() WHERE intent_id=$3 AND revision=$4 AND state='awaiting_wallet' AND authorization_id IS NULL",
      [
        authorizationId,
        authorizationHash,
        record.intentId,
        expectedRevision.toString(),
      ],
    );
    if (update.rowCount !== 1)
      throw new Error("Synthetic fixture compare-and-swap conflict.");
    const metadata = {
      intentId: record.intentId,
      revision: (expectedRevision + 1n).toString(),
      fingerprint: authorizationHash,
    };
    const eventHash = createHash("sha256")
      .update(
        canonicalize({
          intentId: record.intentId,
          eventType: "authorization_created",
          metadata,
        }),
      )
      .digest("hex");
    await client.query(
      "INSERT INTO c3_outbox_events (event_id,intent_id,idempotency_key,event_type,payload) VALUES ($1,$2,$3,'authorization_created',$4::jsonb)",
      [randomUUID(), record.intentId, eventHash, JSON.stringify(metadata)],
    );
    await client.query(
      "INSERT INTO c3_audit_log (audit_id,intent_id,event_type,event_hash,actor_kind,safe_metadata) VALUES ($1,$2,'authorization_created',$3,'system',$4::jsonb)",
      [randomUUID(), record.intentId, eventHash, JSON.stringify(metadata)],
    );
    await client.query("COMMIT");
    return authorizationId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
