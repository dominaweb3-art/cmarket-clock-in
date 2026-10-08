/** Explicit, reviewable projection of the existing durable journals into a
 * private evaluation schema. No copying of intents, credentials or positions.
 * Never run as production bootstrap. This script only emits SQL. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "services/c3-mainnet/pilot-open-local/migrations");
const files = readdirSync(source)
  .filter((f) => /^\d{4}_[a-z_]+\.sql$/.test(f))
  .sort();
if (files.length !== 14) throw Error("EVAL_REVIEW_MIGRATION_RANGE_CHANGED");
const literal = (text) => "'" + text.replaceAll("'", "''") + "'";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const parts = [
  "-- DEVNET evaluation only. Historical journals are reused, not renamed in place.",
];
for (const file of files) {
  const original = readFileSync(resolve(source, file), "utf8");
  if (!original.includes("c3_open")) throw Error("EVAL_SOURCE_SCOPE_CHANGED");
  const projected = original.replaceAll("c3_open", "c3_eval");
  parts.push(`-- Source ${file}; source SHA-256 ${hash(original)}`);
  parts.push(projected);
  parts.push(
    `INSERT INTO c3_eval.schema_migrations(migration_id,checksum_sha256) VALUES(${literal(file)},${literal(hash(projected))});`,
  );
}
parts.push(`
-- Stronger evaluation boundaries; cannot enroll a Mainnet approval here.
ALTER TABLE c3_eval.leg_context_verifications ADD CONSTRAINT eval_non_mainnet_context
 CHECK(scope='ISOLATED_VERIFIED' AND genesis_hash='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
ALTER TABLE c3_eval.keeper_packets ADD CONSTRAINT eval_non_mainnet_keeper
 CHECK(scope='ISOLATED_VERIFIED' AND genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
CREATE UNIQUE INDEX eval_one_lifetime_position_per_wallet ON c3_eval.intents(wallet);
CREATE TABLE c3_eval.release_configuration (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 genesis text NOT NULL CHECK(genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'),
 program text NOT NULL CHECK(program='2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg'),
 router text NOT NULL CHECK(router='F9yXLAA7tvWSCmXnAT8xRqTMHDuwFsgMbDThrde6uHs7'),
 simulated_assets boolean NOT NULL CHECK(simulated_assets),
 mainnet_enabled boolean NOT NULL CHECK(NOT mainnet_enabled)
);
INSERT INTO c3_eval.release_configuration VALUES(true,'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg','F9yXLAA7tvWSCmXnAT8xRqTMHDuwFsgMbDThrde6uHs7',true,false);
CREATE TRIGGER immutable_eval_release BEFORE UPDATE OR DELETE ON c3_eval.release_configuration
 FOR EACH ROW EXECUTE FUNCTION c3_eval.reject_immutable();
REVOKE ALL ON SCHEMA c3_eval FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA c3_eval FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA c3_eval FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA c3_eval REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA c3_eval REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated;
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='c3_eval' LOOP
 EXECUTE format('ALTER TABLE c3_eval.%I ENABLE ROW LEVEL SECURITY',item.tablename);
 END LOOP;
END $$;
`);
process.stdout.write(parts.join("\n"));
