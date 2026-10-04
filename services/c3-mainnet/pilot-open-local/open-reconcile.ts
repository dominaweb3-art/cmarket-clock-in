/** Loopback test adapter. Production implementation is shared, not imported from here. */
import { Connection } from "@solana/web3.js";
import type { Pool } from "pg";
import { C3_MAINNET as c } from "../src/constants.ts";
import { reconcileVerifiedOpenLeg } from "../src/open-leg-reconciler.ts";
export {
  verifyWhirlpoolCpi,
  verifyJupiterSwapEvent,
  verifyFinalizedPlan,
  verifyFinalizedAltBinding,
  verifyFinalizedEffects,
  type ExecutionExpectation,
} from "../src/open-leg-effects.ts";
export async function reconcilePersistedOpenLeg(
  pool: Pool,
  rpc: Connection,
  intentId: string,
  ordinal: number,
) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(rpc.rpcEndpoint))
    throw Error("C3_RECONCILE_LOCAL_RPC_REQUIRED");
  const genesis = await rpc.getGenesisHash();
  if (genesis === c.genesisHash) throw Error("C3_RECONCILE_MAINNET_FORBIDDEN");
  const row = (
    await pool.query(
      "SELECT v.scope FROM c3_open.all_quote_contexts v JOIN c3_open.legs l USING(intent_id,ordinal) WHERE v.intent_id=$1 AND v.ordinal=$2 ORDER BY v.intent_revision DESC LIMIT 1",
      [intentId, ordinal],
    )
  ).rows[0];
  return reconcileVerifiedOpenLeg(
    pool,
    rpc,
    intentId,
    ordinal,
    row?.scope === "ISOLATED_VERIFIED" ? "ISOLATED_VERIFIED" : "LOCAL_CLONE",
    genesis,
  );
}
