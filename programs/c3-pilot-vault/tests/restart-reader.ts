/** Separate process: prove a submitted local signature survives a worker restart. */
import { openValidatorJournal } from "../../../services/c3-mainnet/pilot-open-local/validator-bridge.ts";

const intentId = process.argv[2];
const ordinal = Number(process.argv[3]);
if (!intentId || !Number.isInteger(ordinal) || ordinal < 0 || ordinal > 5)
  throw new Error("C3_LOCAL_INVALID_RESTART_CHECK");
const journal = await openValidatorJournal();
try {
  const leg = await journal.db.readLeg(intentId, ordinal);
  process.stdout.write(
    JSON.stringify({ state: leg.state, signature: leg.signature }),
  );
} finally {
  await journal.close();
}
