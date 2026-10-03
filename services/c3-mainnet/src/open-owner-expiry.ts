/** Finalized two-operator cancellation barrier; never cancel an uncertain
 * operation from wall-clock expiry alone. No resend or signature deletion. */
import { createHash, createPublicKey, verify } from "node:crypto";
import type { Pool } from "pg";
import type { ReviewedRpcProvider } from "./pilot-rpc-evidence.ts";
import { readIndependentOpenEvidence } from "./open-rpc-quorum.ts";
import { canonicalize } from "./manifest.ts";
import {
  publicKeyBytes,
  decodeVersionedMessage,
  decodeBase58,
} from "./solana.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import {
  assertProductionEnrollment,
  approvedOwnerCompilerPolicy,
} from "./open-owner-trust.ts";
import { openAddresses } from "./open-state-semantics.ts";
const check = (v: unknown): void => {
  if (!v) throw Error("C3_OWNER_EXPIRY_RECONCILE_REQUIRED");
};
type Pair = { primary: unknown; secondary: unknown };
const object = (v: unknown): Record<string, unknown> => {
  check(v && typeof v === "object" && !Array.isArray(v));
  return v as Record<string, unknown>;
};
export async function collectExpiredOwnerBarrier(
  providers: readonly ReviewedRpcProvider[],
  blockhash: string,
  lastValid: string,
  accounts: readonly string[],
  signature: string | null,
  fetcher: typeof fetch = fetch,
  failedContext?: Readonly<{ wallet: string; messageHash: Buffer }>,
  vacantIntent?: string,
) {
  publicKeyBytes(blockhash);
  check(
    /^[1-9][0-9]{0,18}$/.test(lastValid) &&
      accounts.length >= 2 &&
      accounts.length <= 64 &&
      new Set(accounts).size === accounts.length,
  );
  accounts.forEach(publicKeyBytes);
  const heights = (await readIndependentOpenEvidence(
    providers,
    "getBlockHeight",
    [{ commitment: "finalized" }],
    fetcher,
  )) as Pair;
  check(
    [heights.primary, heights.secondary].every(
      (v) => Number.isSafeInteger(v) && BigInt(Number(v)) > BigInt(lastValid),
    ),
  );
  const validity = (await readIndependentOpenEvidence(
    providers,
    "isBlockhashValid",
    [blockhash, { commitment: "finalized" }],
    fetcher,
  )) as Pair;
  let slot = 1;
  for (const value of [validity.primary, validity.secondary]) {
    const v = object(value),
      ctx = object(v.context);
    check(
      v.value === false &&
        Number.isSafeInteger(ctx.slot) &&
        Number(ctx.slot) >= 1,
    );
    slot = Math.max(slot, Number(ctx.slot));
  }
  // Account read must occur AFTER invalidity, at/after both observed contexts.
  const snapshots = (await readIndependentOpenEvidence(
    providers,
    "getMultipleAccounts",
    [
      accounts,
      { encoding: "base64", commitment: "finalized", minContextSlot: slot },
    ],
    fetcher,
  )) as Pair;
  const images = [];
  for (const response of [snapshots.primary, snapshots.secondary]) {
    const r = object(response),
      ctx = object(r.context);
    check(
      Number.isSafeInteger(ctx.slot) &&
        Number(ctx.slot) >= slot &&
        Array.isArray(r.value) &&
        r.value.length === accounts.length,
    );
    const values = r.value as unknown[];
    images.push(
      values.map((v, i) => {
        if (v === null) return { address: accounts[i], value: null };
        const a = object(v);
        check(
          typeof a.owner === "string" &&
            a.executable === false &&
            Array.isArray(a.data) &&
            a.data[1] === "base64" &&
            typeof a.data[0] === "string",
        );
        const data = a.data as string[];
        publicKeyBytes(a.owner as string);
        check(Buffer.from(data[0]!, "base64").toString("base64") === data[0]);
        if (
          accounts[i] === vacantIntent &&
          a.owner === "11111111111111111111111111111111" &&
          data[0] === ""
        )
          return { address: accounts[i], value: null };
        return {
          address: accounts[i],
          value: { owner: a.owner, executable: a.executable, data: data[0] },
        };
      }),
    );
  }
  check(canonicalize(images[0]) === canonicalize(images[1]));
  let failedEvidence: unknown = null;
  if (signature) {
    check(/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature));
    const statuses = (await readIndependentOpenEvidence(
      providers,
      "getSignatureStatuses",
      [[signature], { searchTransactionHistory: true }],
      fetcher,
    )) as Pair;
    for (const r of [statuses.primary, statuses.secondary]) {
      const value = object(r).value;
      check(Array.isArray(value) && value.length === 1);
      const entries = value as unknown[];
      if (entries[0] !== null) {
        const status = object(entries[0]);
        check(
          failedContext &&
            status.confirmationStatus === "finalized" &&
            status.err !== null &&
            status.err !== undefined &&
            Number.isSafeInteger(status.slot) &&
            Number(status.slot) > 0,
        );
      }
    }
    if ((object(statuses.primary).value as unknown[])[0] !== null) {
      const wire = (await readIndependentOpenEvidence(
        providers,
        "getTransaction",
        [
          signature,
          {
            commitment: "finalized",
            encoding: "base64",
            maxSupportedTransactionVersion: 0,
          },
        ],
        fetcher,
      )) as Pair;
      for (const value of [wire.primary, wire.secondary]) {
        const tx = object(value),
          meta = object(tx.meta);
        check(Array.isArray(tx.transaction) && tx.transaction[1] === "base64");
        const encoded = tx.transaction as string[],
          packet = Buffer.from(encoded[0]!, "base64"),
          message = packet.subarray(65);
        check(
          packet.toString("base64") === encoded[0] &&
            packet.length <= 1232 &&
            packet[0] === 1 &&
            packet
              .subarray(1, 65)
              .equals(Buffer.from(decodeBase58(signature))) &&
            createHash("sha256")
              .update(message)
              .digest()
              .equals(failedContext!.messageHash),
        );
        const decoded = decodeVersionedMessage(message.toString("base64"), []);
        check(
          decoded.requiredSignatures === 1 &&
            decoded.staticAccounts[0]?.address === failedContext!.wallet &&
            verify(
              null,
              message,
              createPublicKey({
                key: Buffer.concat([
                  Buffer.from("302a300506032b6570032100", "hex"),
                  Buffer.from(publicKeyBytes(failedContext!.wallet)),
                ]),
                format: "der",
                type: "spki",
              }),
              packet.subarray(1, 65),
            ),
        );
        const status = object((object(statuses.primary).value as unknown[])[0]);
        check(
          tx.slot === status.slot &&
            canonicalize(meta.err) === canonicalize(status.err) &&
            Array.isArray(meta.preTokenBalances) &&
            Array.isArray(meta.postTokenBalances) &&
            canonicalize(meta.preTokenBalances) ===
              canonicalize(meta.postTokenBalances) &&
            Number.isSafeInteger(meta.fee) &&
            Number(meta.fee) > 0 &&
            Array.isArray(meta.preBalances) &&
            Array.isArray(meta.postBalances),
        );
        const pre = meta.preBalances as number[],
          post = meta.postBalances as number[];
        check(
          pre.length === decoded.staticAccounts.length &&
            post.length === pre.length &&
            pre.every(
              (v, i) =>
                Number.isSafeInteger(v) &&
                v >= 0 &&
                Number.isSafeInteger(post[i]) &&
                post[i]! >= 0 &&
                v - post[i]! === (i === 0 ? meta.fee : 0),
            ),
        );
      }
      failedEvidence = { statuses, wire };
    }
  }
  return {
    stateHash: createHash("sha256").update(canonicalize(images[0])).digest(),
    evidenceHash: createHash("sha256")
      .update(
        canonicalize({
          heights,
          validity,
          snapshots,
          signature,
          failedEvidence,
        }),
      )
      .digest(),
    failed: failedEvidence !== null,
    slot,
  };
}
export async function closeExpiredProductionOwnerRequest(
  pool: Pool,
  requestId: string,
  cancelled: boolean,
  fetcher: typeof fetch = fetch,
) {
  const policy = requireOpenProductionPolicy();
  await assertProductionEnrollment(pool, policy, requestId, "request");
  const r = (
    await pool.query(
      "SELECT r.*,b.accounts,b.state_hash,i.wallet,i.vault,i.configuration_hash,s.signature,a.manifest FROM c3_open.owner_requests r JOIN c3_open.owner_expiry_barriers b USING(request_id) JOIN c3_open.owner_authorization_manifests a USING(request_id) JOIN c3_open.intents i USING(intent_id) LEFT JOIN c3_open.owner_submissions s USING(request_id) WHERE r.request_id=$1",
      [requestId],
    )
  ).rows[0];
  check(
    r &&
      r.wallet === policy.wallet &&
      r.vault === policy.vault &&
      r.configuration_hash === policy.configurationHash,
  );
  const prior = (
    await pool.query(
      "SELECT evidence_hash FROM c3_open.owner_request_outcomes WHERE request_id=$1",
      [requestId],
    )
  ).rows[0];
  if (prior) return { requestId, state: "closed_unexecuted" as const };
  const proof = await collectExpiredOwnerBarrier(
    policy.providers,
    r.blockhash,
    r.last_valid_height,
    r.accounts,
    r.signature ?? null,
    fetcher,
    { wallet: r.wallet, messageHash: r.message_hash },
    r.action === "deposit"
      ? openAddresses(approvedOwnerCompilerPolicy(policy)).deposit
      : r.action === "request_redemption"
        ? openAddresses(approvedOwnerCompilerPolicy(policy)).redemption
        : undefined,
  );
  check(proof.stateHash.equals(r.state_hash));
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const current = (
      await c.query(
        "SELECT *,clock_timestamp() AS now FROM c3_open.intents WHERE intent_id=$1 FOR UPDATE",
        [r.intent_id],
      )
    ).rows[0];
    check(
      current &&
        current.wallet === policy.wallet &&
        current.db_revision === r.expected_db_revision &&
        current.chain_revision === r.expected_chain_revision &&
        (proof.failed || r.expires_at <= current.now),
    );
    check(
      !(
        await c.query(
          "SELECT 1 FROM c3_open.owner_message_receipts WHERE request_id=$1",
          [requestId],
        )
      ).rowCount,
    );
    await c.query(
      "INSERT INTO c3_open.owner_request_outcomes(request_id,outcome,evidence_hash) VALUES($1,$2,$3) ON CONFLICT(request_id) DO NOTHING",
      [
        requestId,
        proof.failed
          ? "failed_finalized"
          : cancelled
            ? "cancelled_unexecuted"
            : "expired_unexecuted",
        proof.evidenceHash,
      ],
    );
    if (r.action === "renew_plan" && r.signature)
      await c.query(
        "INSERT INTO c3_open.renewal_outcomes(request_id,disposition,finalized_slot,db_revision,evidence,evidence_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(request_id) DO NOTHING",
        [
          requestId,
          proof.failed ? "failed_finalized" : "expired_unexecuted",
          proof.slot,
          (BigInt(current.db_revision) + 1n).toString(),
          { ownerOutcomeHash: proof.evidenceHash.toString("hex") },
          proof.evidenceHash,
        ],
      );
    await c.query(
      "UPDATE c3_open.intents SET db_revision=db_revision+1,updated_at=clock_timestamp() WHERE intent_id=$1",
      [r.intent_id],
    );
    await c.query("COMMIT");
    return { requestId, state: "closed_unexecuted" as const };
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
