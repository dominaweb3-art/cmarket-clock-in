/** Owner-only renewal reconciliation. The SAME pure verifier is exercised by
 * isolated evidence tests; production collection always requires two reviewed
 * operators and source approval. Never signs, sends or refreshes a request. */
import { createHash, createPublicKey, verify, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { canonicalize } from "./manifest.ts";
import {
  decodeBase58,
  decodeVersionedMessage,
  publicKeyBytes,
} from "./solana.ts";
import { accountBytes, type OpenAccount } from "./open-state-semantics.ts";
import { collectFinalizedOpenEconomicEvidence } from "./open-economic-quorum.ts";
import { readIndependentOpenEvidence } from "./open-rpc-quorum.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { assertProductionEnrollment } from "./open-owner-trust.ts";
import { renewalPostimage } from "./open-minimum-resolution.ts";
const demand = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_OWNER_RENEWAL_" + code);
};
const hash = (v: Uint8Array | string) =>
  createHash("sha256").update(v).digest();
export function verifyOwnerRenewalEvidence(
  request: {
    wallet: string;
    program: string;
    plan: string;
    signature: string;
    messageHash: Buffer;
    preState: Buffer;
    revision: string;
    expiry: string;
    observedSlot: number;
  },
  wire: unknown,
  transaction: unknown,
  snapshot: unknown,
) {
  const w = wire as { slot: number; meta: unknown; transaction: string[] },
    t = transaction as {
      slot: number;
      meta: {
        err: unknown;
        fee: number;
        innerInstructions: { instructions: unknown[] }[];
        preTokenBalances: unknown[];
        postTokenBalances: unknown[];
        preBalances: number[];
        postBalances: number[];
      };
      transaction: { signatures: string[] };
    },
    s = snapshot as { context: { slot: number }; value: OpenAccount[] };
  demand(
    w &&
      t &&
      s &&
      Number.isSafeInteger(t.slot) &&
      t.slot >= request.observedSlot &&
      w.slot === t.slot &&
      canonicalize(w.meta) === canonicalize(t.meta) &&
      w.transaction?.[1] === "base64",
    "TRANSACTION",
  );
  const packet = Buffer.from(w.transaction[0]!, "base64"),
    message = packet.subarray(65),
    meta = t.meta;
  demand(
    packet.length <= 1232 &&
      packet[0] === 1 &&
      packet.toString("base64") === w.transaction[0] &&
      hash(message).equals(request.messageHash) &&
      packet
        .subarray(1, 65)
        .equals(Buffer.from(decodeBase58(request.signature))) &&
      t.transaction.signatures.length === 1 &&
      t.transaction.signatures[0] === request.signature,
    "EXACT_MESSAGE",
  );
  const decoded = decodeVersionedMessage(message.toString("base64"), []);
  demand(
    decoded.requiredSignatures === 1 &&
      decoded.staticAccounts[0]?.address === request.wallet &&
      decoded.instructions.length === 1 &&
      decoded.instructions[0]?.programId === request.program,
    "SIGNER",
  );
  demand(
    verify(
      null,
      message,
      createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(publicKeyBytes(request.wallet)),
        ]),
        format: "der",
        type: "spki",
      }),
      packet.subarray(1, 65),
    ),
    "SIGNATURE",
  );
  demand(
    meta.err === null &&
      Array.isArray(meta.innerInstructions) &&
      meta.innerInstructions.every((g) => g.instructions.length === 0) &&
      meta.preTokenBalances?.length === 0 &&
      meta.postTokenBalances?.length === 0,
    "UNEXPECTED_CPI",
  );
  demand(
    Number.isSafeInteger(meta.fee) &&
      meta.fee > 0 &&
      meta.fee <= 100000 &&
      meta.preBalances?.length === decoded.staticAccounts.length &&
      meta.postBalances?.length === meta.preBalances.length &&
      meta.preBalances.every(
        (v, i) =>
          Number.isSafeInteger(v) &&
          v >= 0 &&
          Number.isSafeInteger(meta.postBalances[i]) &&
          meta.postBalances[i]! >= 0 &&
          v - meta.postBalances[i]! === (i === 0 ? meta.fee : 0),
      ),
    "LAMPORT_EFFECTS",
  );
  demand(
    Number.isSafeInteger(s.context?.slot) &&
      s.context.slot >= t.slot &&
      s.value?.length === 1,
    "SNAPSHOT",
  );
  const before = request.preState,
    after = accountBytes(s.value[0], request.program, 901, "SettlementPlan"),
    revision = BigInt(request.revision),
    expiry = BigInt(request.expiry);
  demand(
    before.length === 901 &&
      before.readBigUInt64LE(716) === revision &&
      revision < (1n << 64n) - 1n &&
      [0, 1, 3].includes(before[714]!) &&
      expiry > before.readBigInt64LE(706),
    "PREIMAGE",
  );
  const expected = renewalPostimage(
    before,
    Buffer.from(decoded.instructions[0]!.dataBase64, "base64"),
    revision,
    expiry,
  );
  demand(expected.equals(after), "INVENTORY_OR_HISTORY_CHANGED");
  return {
    slot: t.slot,
    postState: after,
    evidenceHash: hash(canonicalize({ wire, transaction, snapshot })),
    revision: (revision + 1n).toString(),
  };
}
export async function reconcileProductionOwnerRenewal(
  pool: Pool,
  requestId: string,
  fetcher: typeof fetch = fetch,
) {
  const policy = requireOpenProductionPolicy();
  await assertProductionEnrollment(pool, policy, requestId, "request");
  const r = (
    await pool.query(
      `SELECT r.*,s.signature,i.wallet,i.vault,i.configuration_hash,a.manifest,a.manifest_hash FROM c3_open.renewal_requests r JOIN c3_open.owner_submissions s USING(request_id) JOIN c3_open.intents i USING(intent_id) JOIN c3_open.owner_authorization_manifests a USING(request_id) WHERE request_id=$1`,
      [requestId],
    )
  ).rows[0];
  demand(
    r &&
      r.wallet === policy.wallet &&
      r.vault === policy.vault &&
      r.configuration_hash === policy.configurationHash &&
      hash(canonicalize(r.manifest)).equals(r.manifest_hash) &&
      r.manifest.messageHash === r.message_hash.toString("hex") &&
      r.manifest.action === "renew_plan" &&
      r.manifest.plan === r.plan,
    "SCOPE",
  );
  const prior = (
    await pool.query(
      "SELECT renewal_signature,evidence_hash FROM c3_open.plan_generations WHERE request_id=$1",
      [requestId],
    )
  ).rows[0];
  if (prior) {
    demand(prior.renewal_signature === r.signature, "RESULT_CONFLICT");
    return {
      status: "already_reconciled",
      evidenceHash: prior.evidence_hash.toString("hex"),
    };
  }
  const collected = await collectFinalizedOpenEconomicEvidence(
    policy.providers,
    r.signature,
    [r.plan],
    Number(r.observed_slot),
    fetcher,
  );
  const wire = (await readIndependentOpenEvidence(
    policy.providers,
    "getTransaction",
    [
      r.signature,
      {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
        encoding: "base64",
      },
    ],
    fetcher,
  )) as { primary: unknown; secondary: unknown };
  const input = {
    wallet: r.wallet,
    program: policy.programId,
    plan: r.plan,
    signature: r.signature,
    messageHash: r.message_hash,
    preState: r.pre_state,
    revision: r.expected_chain_revision,
    expiry: r.expires_at,
    observedSlot: Number(r.observed_slot),
  };
  const proof = verifyOwnerRenewalEvidence(
    input,
    wire.primary,
    collected.transaction.primary,
    collected.snapshots.primary,
  );
  verifyOwnerRenewalEvidence(
    input,
    wire.secondary,
    collected.transaction.secondary,
    collected.snapshots.secondary,
  );
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    const current = (
      await c.query(
        "SELECT * FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
        [r.intent_id],
      )
    ).rows[0];
    const cached = (
      await c.query(
        "SELECT renewal_signature FROM c3_open.plan_generations WHERE request_id=$1",
        [requestId],
      )
    ).rows[0];
    if (cached) {
      demand(cached.renewal_signature === r.signature, "RESULT_CONFLICT");
      await c.query("COMMIT");
      return { status: "already_reconciled" };
    }
    demand(
      current.db_revision === r.expected_db_revision &&
        current.chain_revision === r.expected_chain_revision,
      "CAS",
    );
    demand(
      !(
        await c.query(
          "SELECT 1 FROM c3_open.owner_request_outcomes WHERE request_id=$1 UNION ALL SELECT 1 FROM c3_open.renewal_outcomes WHERE request_id=$1",
          [requestId],
        )
      ).rowCount,
      "CLOSED_REQUEST",
    );
    demand(
      !(
        await c.query(
          "SELECT 1 FROM c3_open.legs WHERE intent_id=$1 AND state IN ('signed','submitted','uncertain','manual_review','reconciliation_required') UNION ALL SELECT 1 FROM c3_open.signing_requests s JOIN c3_open.quote_authorizations q USING(quote_id) WHERE q.intent_id=$1 AND s.state<>'result'",
          [r.intent_id],
        )
      ).rowCount,
      "RECONCILE_FIRST",
    );
    const start = r.pre_state[145] === 1 ? 0 : 3,
      legs = (
        await c.query(
          "SELECT * FROM c3_open.legs WHERE intent_id=$1 ORDER BY ordinal FOR UPDATE",
          [r.intent_id],
        )
      ).rows;
    demand(
      legs.length === 6 &&
        legs
          .slice(start, start + 3)
          .every(
            (l, n) =>
              (l.state === "confirmed") === !!(r.pre_state[714] & (1 << n)) &&
              (l.state === "confirmed" ||
                (["pending", "leased", "prepared"].includes(l.state) &&
                  !l.submitted_signature)),
          ),
      "PROGRESS",
    );
    const generation = (
      BigInt(
        (
          await c.query(
            "SELECT COALESCE(max(generation),0)::text n FROM c3_open.plan_generations WHERE intent_id=$1 AND plan=$2",
            [r.intent_id, r.plan],
          )
        ).rows[0].n,
      ) + 1n
    ).toString();
    await c.query(
      "INSERT INTO c3_open.plan_generations(intent_id,plan,generation,base_revision,request_id,renewal_signature,finalized_slot,post_state,evidence_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,to_timestamp($10))",
      [
        r.intent_id,
        r.plan,
        generation,
        proof.revision,
        requestId,
        r.signature,
        proof.slot,
        proof.postState,
        proof.evidenceHash,
        r.expires_at,
      ],
    );
    await c.query(
      "UPDATE c3_open.intents SET chain_revision=$2,db_revision=db_revision+1,updated_at=clock_timestamp() WHERE intent_id=$1",
      [r.intent_id, proof.revision],
    );
    for (const l of legs.slice(start, start + 3)) {
      if (l.state === "confirmed") continue;
      await c.query(
        "INSERT INTO c3_open.leg_attempt_history SELECT intent_id,ordinal,$3,$4,to_jsonb(l) FROM c3_open.legs l WHERE intent_id=$1 AND ordinal=$2",
        [r.intent_id, l.ordinal, generation, r.plan],
      );
      await c.query(
        "UPDATE c3_open.legs SET state='pending',route_hash=NULL,instruction_hash=NULL,authorization_hash=NULL,input_mint=NULL,output_mint=NULL,source_account=NULL,destination_account=NULL,input_amount=NULL,minimum_output=NULL,quote_expires_at=NULL,expected_effects=NULL,lease_owner=NULL,lease_expires_at=NULL,reason_code=NULL,updated_at=clock_timestamp() WHERE intent_id=$1 AND ordinal=$2",
        [r.intent_id, l.ordinal],
      );
      await c.query(
        "UPDATE c3_open.quote_authorizations SET state='manual_review',revision=revision+1 WHERE intent_id=$1 AND ordinal=$2 AND state IN ('prepared','signed')",
        [r.intent_id, l.ordinal],
      );
    }
    await c.query(
      "INSERT INTO c3_open.owner_message_receipts(request_id,slot,evidence_hash) VALUES($1,$2,$3)",
      [requestId, proof.slot, proof.evidenceHash],
    );
    const eventId = randomUUID();
    await c.query(
      "INSERT INTO c3_open.events(event_id,intent_id,idempotency_hash,db_revision,state,evidence_hash,safe_reason) VALUES($1,$2,$3,$4,$5,$6,'OWNER_PLAN_RENEWED')",
      [
        eventId,
        r.intent_id,
        hash("owner-renewal:" + requestId).toString("hex"),
        (BigInt(current.db_revision) + 1n).toString(),
        current.state,
        proof.evidenceHash.toString("hex"),
      ],
    );
    await c.query("INSERT INTO c3_open.outbox(event_id) VALUES($1)", [eventId]);
    await c.query("COMMIT");
    return {
      status: "renewal_effects_reconciled",
      evidenceHash: proof.evidenceHash.toString("hex"),
    };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
