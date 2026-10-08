/** Production boundary preserved; network-neutral journal lives separately. */
import type { Pool } from "pg";
import { OpenOwnerJournal } from "./open-owner-journal-core.ts";
export { OpenOwnerJournal } from "./open-owner-journal-core.ts";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { readIndependentOpenEvidence } from "./open-rpc-quorum.ts";
import { assertProductionEnrollment } from "./open-owner-trust.ts";
const check = (v: unknown, code: string): void => {
  if (!v) throw Error("C3_OWNER_" + code);
};
/** Immutable production guard executes before any DB/transport side effect. */
export async function submitProductionOwnerPacket(
  pool: Pool,
  origin: string,
  token: string,
  requestId: string,
  packet: Uint8Array,
  fetcher: typeof fetch = fetch,
) {
  const policy = requireOpenProductionPolicy();
  await assertProductionEnrollment(pool, policy, requestId, "request");
  const r = (
    await pool.query(
      "SELECT r.blockhash,r.last_valid_height,i.wallet,i.vault,i.configuration_hash FROM c3_open.owner_requests r JOIN c3_open.intents i USING(intent_id) WHERE r.request_id=$1",
      [requestId],
    )
  ).rows[0];
  check(
    r &&
      r.wallet === policy.wallet &&
      r.vault === policy.vault &&
      r.configuration_hash === policy.configurationHash,
    "PRODUCTION_SCOPE",
  );
  const heights = (await readIndependentOpenEvidence(
    policy.providers,
    "getBlockHeight",
    [{ commitment: "finalized" }],
    fetcher,
  )) as { primary: unknown; secondary: unknown };
  const validity = (await readIndependentOpenEvidence(
    policy.providers,
    "isBlockhashValid",
    [r.blockhash, { commitment: "finalized" }],
    fetcher,
  )) as { primary: unknown; secondary: unknown };
  check(
    [heights.primary, heights.secondary].every(
      (v) =>
        Number.isSafeInteger(v) &&
        Number(v) >= 1 &&
        BigInt(Number(v)) <= BigInt(r.last_valid_height),
    ) &&
      [validity.primary, validity.secondary].every(
        (v) => v && typeof v === "object" && "value" in v && v.value === true,
      ),
    "BLOCKHASH_EXPIRED",
  );
  return new OpenOwnerJournal(pool, origin).submitOnce(
    token,
    requestId,
    packet,
    async (bytes) => {
      // ONE owner-authorized broadcast, no provider failover or implicit RPC retries.
      const response = await fetcher(policy.providers[0]!.endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [
            Buffer.from(bytes).toString("base64"),
            {
              encoding: "base64",
              skipPreflight: false,
              preflightCommitment: "finalized",
              maxRetries: 0,
            },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      });
      const text = await response.text();
      check(response.ok && text.length <= 2000, "SEND_UNCERTAIN");
      const result = JSON.parse(text) as Record<string, unknown>;
      check(
        result.jsonrpc === "2.0" &&
          result.id === 1 &&
          !result.error &&
          typeof result.result === "string",
        "SEND_UNCERTAIN",
      );
      return result.result as string;
    },
  );
}
