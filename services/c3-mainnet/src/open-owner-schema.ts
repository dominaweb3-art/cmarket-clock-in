/** Explicit additive migration/enrollment over c3_open; never a second ledger.
 * SQL files retain historical checksums. Runtime startup does not migrate. */
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { canonicalize } from "./manifest.ts";
import {
  openAddresses,
  verifyOpenConfig,
  verifyOpenShareMint,
  type OpenAccount,
} from "./open-state-semantics.ts";
import type { OpenCompilerPolicy } from "./open-owner-compiler.ts";
import {
  verifyOpenEnrollmentProof,
  type OpenEnrollmentProof,
} from "./open-owner-enrollment.ts";
const hashes = [
  [
    "0001_open_settlement",
    "80ad3db0d9f93db12936e6d9948b9a778b8ee5b979bb1ec24f887745a7a57f34",
  ],
  [
    "0002_open_recovery",
    "8459162d2d22fdd83d28ec74b60ce8a38e83cfe865ca4e54887dafbe1bc1a2a8",
  ],
  [
    "0003_open_quote_authority",
    "a33005d7621d0d55abeb4e134d15b9373870ee7758876ac28118d53f0ced405b",
  ],
  [
    "0004_open_finalized_evidence",
    "66ccb025144d0bb246c4fbcf6722d9a68df515293cc03f81179a4a8cbb0f65af",
  ],
  [
    "0005_open_signing_journal",
    "44a435e0fdef086d3872935b68dc1b1d2b718f2f03a25b88682f42fe1c37faa9",
  ],
  [
    "0006_signing_clock",
    "94c8b59d43b382d1f5b8985c3e6bed21fc39ea6fea61692de789fdd8cb48c79c",
  ],
  [
    "0007_plan_generations",
    "096de13a7047ac4d1636aec80cddde426fcc7c57cc37f0616a4e7dcd35519081",
  ],
  [
    "0008_owner_operations",
    "c9ba85d3c59cfd44b3123ae712f3bd0d8e1fc8de7344f6a6e5e22d2f65d9392c",
  ],
  [
    "0009_owner_protocol",
    "2b1966774cc34949c99203500046d0a519044ff6a4fb3f853367ff208ea9d907",
  ],
  [
    "0010_owner_compiler",
    "a4134b9564db7162ccdafb891708995a5b25a22be0806834837e95c4e491bb07",
  ],
  [
    "0011_verified_leg_contexts",
    "223d7fed4c5664903130ccff3c6a59e362bbcb3c2e180117cbf81d7602dd0cc4",
  ],
  [
    "0012_keeper_journal",
    "5e8848b1705e8f19bdd1df9025eb7ffae96696fa9562e14ecd6ec78f6390f49a",
  ],
  [
    "0013_keeper_outcomes",
    "7e98163222081fa9780127f9d903c55a0b9e91c941ef42bcc088036157a86bfe",
  ],
  [
    "0014_owner_enrollment_proof",
    "4dbce05632b3b73277a36220aa889d873d235771863804b4a0b5c53dce0d220e",
  ],
] as const;
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest("hex");
export async function verifyOpenOwnerSchema(pool: Pool) {
  const rows = (
    await pool.query(
      "SELECT migration_id,checksum_sha256 FROM c3_open.schema_migrations ORDER BY migration_id",
    )
  ).rows;
  if (
    rows.length !== hashes.length ||
    hashes.some(
      ([id, digest]) =>
        !rows.some(
          (r) => r.migration_id === id && r.checksum_sha256 === digest,
        ),
    )
  )
    throw Error("C3_OPEN_SCHEMA_NOT_REVIEWED");
}
export async function applyReviewedOpenSchema(pool: Pool) {
  const files = await Promise.all(
    hashes.map(async ([id, digest]) => {
      const sql = await readFile(
        new URL(`../pilot-open-local/migrations/${id}.sql`, import.meta.url),
      );
      if (hash(sql) !== digest) throw Error("C3_OPEN_MIGRATION_CHECKSUM");
      return { id, digest, sql: sql.toString() };
    }),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(734432991)");
    for (const file of files) {
      const exists = (
        await client.query(
          "SELECT to_regclass('c3_open.schema_migrations') AS table_name",
        )
      ).rows[0].table_name;
      const row = exists
        ? (
            await client.query(
              "SELECT checksum_sha256 FROM c3_open.schema_migrations WHERE migration_id=$1",
              [file.id],
            )
          ).rows[0]
        : null;
      if (row) {
        if (row.checksum_sha256 !== file.digest)
          throw Error("C3_OPEN_MIGRATION_HISTORY_CHANGED");
        continue;
      }
      await client.query(file.sql);
      await client.query(
        "INSERT INTO c3_open.schema_migrations(migration_id,checksum_sha256) VALUES($1,$2)",
        [file.id, file.digest],
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await verifyOpenOwnerSchema(pool);
}
/** Private server enrollment: policy and independently collected public accounts
 * are required. HTTP caller never supplies wallet/configuration/revision. */
export async function enrollOpenOwner(
  pool: Pool,
  policy: OpenCompilerPolicy,
  accounts: Readonly<Record<string, OpenAccount | null>>,
  proof?: OpenEnrollmentProof,
) {
  if (!proof) throw Error("C3_OWNER_MWA_ENROLLMENT_PROOF_REQUIRED");
  const cfg = verifyOpenConfig(policy, accounts[policy.vault]!),
    mint = verifyOpenShareMint(policy, accounts[policy.shareMint]!);
  if (
    cfg.paused ||
    cfg.lifecycle !== 0 ||
    cfg.sharesIssued !== 0n ||
    mint.supply !== 0n
  )
    throw Error("C3_OPEN_ENROLLMENT_NOT_EMPTY");
  const policyHash = hash(canonicalize(policy)),
    client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SELECT pg_advisory_xact_lock(734432992)");
    const verifiedProof = await verifyOpenEnrollmentProof(
      client,
      policy,
      proof,
    );
    const consume = async (intentId: string) =>
      client.query(
        "INSERT INTO c3_open.owner_enrollment_consumptions(challenge_id,intent_id,signature_hash) VALUES($1,$2,$3)",
        [verifiedProof.challengeId, intentId, verifiedProof.signatureHash],
      );
    const prior = (
      await client.query(
        "SELECT i.*,e.policy_hash FROM c3_open.intents i LEFT JOIN c3_open.production_enrollments e USING(intent_id) WHERE i.wallet=$1 ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE OF i",
        [policy.wallet],
      )
    ).rows[0];
    if (prior) {
      if (
        prior.policy_hash !== policyHash ||
        prior.vault !== policy.vault ||
        prior.configuration_hash !== policy.configurationHash
      )
        throw Error("C3_OPEN_ENROLLMENT_CONFLICT");
      await consume(prior.intent_id);
      await client.query("COMMIT");
      return prior.intent_id as string;
    }
    const id = randomUUID();
    await client.query(
      "INSERT INTO c3_open.intents(intent_id,wallet,vault,share_mint,deposit_plan,configuration_hash,deposit_amount,expires_at) VALUES($1,$2,$3,$4,$5,$6,1000000,clock_timestamp()+interval '30 minutes')",
      [
        id,
        policy.wallet,
        policy.vault,
        policy.shareMint,
        openAddresses(policy).depositPlan,
        policy.configurationHash,
      ],
    );
    for (let n = 0; n < 6; n++)
      await client.query(
        "INSERT INTO c3_open.legs(intent_id,ordinal) VALUES($1,$2)",
        [id, n],
      );
    await client.query(
      "INSERT INTO c3_open.production_enrollments(intent_id,policy_hash,configuration_evidence_hash) VALUES($1,$2,$3)",
      [id, policyHash, hash(canonicalize(accounts))],
    );
    await client.query(
      "INSERT INTO c3_open.events(event_id,intent_id,idempotency_hash,db_revision,state) VALUES($1,$2,$3,1,'draft')",
      [randomUUID(), id, hash("enroll:" + id)],
    );
    await consume(id);
    await client.query("COMMIT");
    return id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
