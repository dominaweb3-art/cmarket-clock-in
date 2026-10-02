/** Bounded read-only intake for economic reconciliation. No agreement alone
 * can issue shares, release USDC, or mark an operation confirmed. */
import { readIndependentOpenEvidence } from "./open-rpc-quorum.ts";
import type { ReviewedRpcProvider } from "./pilot-rpc-evidence.ts";
type Pair = Readonly<{
  status: "AGREED_UNVERIFIED_EFFECTS";
  primary: unknown;
  secondary: unknown;
}>;
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw Error("C3_ECONOMIC_EVIDENCE_SHAPE");
  return v as Record<string, unknown>;
};
export async function collectFinalizedOpenEconomicEvidence(
  providers: readonly ReviewedRpcProvider[],
  signature: string,
  accounts: readonly string[],
  minimumSlot: number,
  fetcher: typeof fetch = fetch,
) {
  if (
    !/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature) ||
    accounts.length < 1 ||
    accounts.length > 64 ||
    new Set(accounts).size !== accounts.length ||
    !accounts.every((k) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(k)) ||
    !Number.isSafeInteger(minimumSlot) ||
    minimumSlot < 1
  )
    throw Error("C3_ECONOMIC_REQUEST_INVALID");
  const statuses = (await readIndependentOpenEvidence(
    providers,
    "getSignatureStatuses",
    [[signature], { searchTransactionHistory: true }],
    fetcher,
  )) as Pair;
  let finalizedSlot: number | undefined;
  for (const response of [statuses.primary, statuses.secondary]) {
    const value = object(response).value;
    if (!Array.isArray(value) || value.length !== 1)
      throw Error("C3_ECONOMIC_STATUS_MISSING");
    const status = object(value[0]);
    if (
      status.confirmationStatus !== "finalized" ||
      status.err !== null ||
      !Number.isSafeInteger(status.slot) ||
      Number(status.slot) < minimumSlot
    )
      throw Error("C3_ECONOMIC_FINALITY_REQUIRED");
    if (finalizedSlot !== undefined && finalizedSlot !== status.slot)
      throw Error("C3_ECONOMIC_SLOT_DISAGREEMENT");
    finalizedSlot = Number(status.slot);
  }
  const transaction = (await readIndependentOpenEvidence(
    providers,
    "getTransaction",
    [
      signature,
      {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
        encoding: "json",
      },
    ],
    fetcher,
  )) as Pair;
  for (const response of [transaction.primary, transaction.secondary]) {
    const tx = object(response),
      meta = object(tx.meta),
      body = object(tx.transaction);
    if (
      tx.slot !== finalizedSlot ||
      meta.err !== null ||
      !Array.isArray(body.signatures) ||
      body.signatures[0] !== signature ||
      !Array.isArray(meta.innerInstructions) ||
      !Array.isArray(meta.preTokenBalances) ||
      !Array.isArray(meta.postTokenBalances)
    )
      throw Error("C3_ECONOMIC_TRANSACTION_INCOMPLETE");
  }
  const snapshots = (await readIndependentOpenEvidence(
    providers,
    "getMultipleAccounts",
    [
      accounts,
      {
        commitment: "finalized",
        encoding: "base64",
        minContextSlot: finalizedSlot,
      },
    ],
    fetcher,
  )) as Pair;
  for (const response of [snapshots.primary, snapshots.secondary]) {
    const snapshot = object(response),
      context = object(snapshot.context);
    if (
      !Number.isSafeInteger(context.slot) ||
      Number(context.slot) < finalizedSlot! ||
      !Array.isArray(snapshot.value) ||
      snapshot.value.length !== accounts.length ||
      snapshot.value.some((v: unknown) => v === null)
    )
      throw Error("C3_ECONOMIC_SNAPSHOT_INCOMPLETE");
    for (const v of snapshot.value) {
      const a = object(v);
      if (
        typeof a.owner !== "string" ||
        !Array.isArray(a.data) ||
        a.data.length !== 2 ||
        a.data[1] !== "base64" ||
        typeof a.data[0] !== "string" ||
        !Number.isSafeInteger(a.lamports) ||
        Number(a.lamports) < 0 ||
        typeof a.executable !== "boolean"
      )
        throw Error("C3_ECONOMIC_ACCOUNT_INCOMPLETE");
    }
  }
  return Object.freeze({
    status: "FINALIZED_QUORUM_REQUIRES_SEMANTIC_VERIFICATION" as const,
    signature,
    slot: finalizedSlot!,
    accounts: Object.freeze([...accounts]),
    statuses,
    transaction,
    snapshots,
  });
}
