import type { C3AuthorizationManifest } from "./builder.ts";
import type { IntentState, RpcProviderEvidence } from "./reconciliation.ts";

export type PersistedIntent = Readonly<{
  schemaVersion: "c3-intent/v1";
  intentId: string;
  idempotencyKey: string;
  configurationHash: string;
  wallet: string;
  state: IntentState;
  revision: number;
  createdAtUnix: number;
  updatedAtUnix: number;
  expiresAtUnix: number;
  authorizationManifest?: C3AuthorizationManifest;
  quoteEvidenceFingerprint?: string;
  oracleEvidenceFingerprint?: string;
  unsignedTransactionFingerprint?: string;
  submittedSignature?: string;
  confirmationEvidence?: readonly RpcProviderEvidence[];
  manualReviewReason?: string;
}>;

const HASH = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validatePersistedIntent(value: PersistedIntent): void {
  if (value.schemaVersion !== "c3-intent/v1")
    throw new Error("Unsupported intent schema.");
  if (
    !/^c3-[a-f0-9]{32,64}$/.test(value.intentId) ||
    !HASH.test(value.idempotencyKey) ||
    !HASH.test(value.configurationHash)
  )
    throw new Error("Persisted intent identity is malformed.");
  if (!PUBLIC_KEY.test(value.wallet))
    throw new Error("Persisted wallet is malformed.");
  if (
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    value.updatedAtUnix < value.createdAtUnix ||
    value.expiresAtUnix <= value.createdAtUnix
  )
    throw new Error("Persisted intent timestamps/revision are invalid.");
  for (const fingerprint of [
    value.quoteEvidenceFingerprint,
    value.oracleEvidenceFingerprint,
    value.unsignedTransactionFingerprint,
  ])
    if (fingerprint !== undefined && !HASH.test(fingerprint))
      throw new Error("Persisted evidence fingerprint is malformed.");
  if (
    value.submittedSignature !== undefined &&
    !SIGNATURE.test(value.submittedSignature)
  )
    throw new Error("Submitted signature is malformed.");
  if (
    [
      "intent_submitted",
      "keeper_pending",
      "partially_completed",
      "settled",
    ].includes(value.state) &&
    !value.authorizationManifest
  )
    throw new Error("Submitted state lacks immutable authorization manifest.");
  if (
    value.state === "settled" &&
    (!value.submittedSignature || value.confirmationEvidence?.length !== 2)
  )
    throw new Error("Settled state lacks signature or two-provider evidence.");
  if (value.state === "manual_review" && !value.manualReviewReason)
    throw new Error("Manual review lacks a reason.");
}

export class InMemoryIntentRepository {
  readonly #records = new Map<string, PersistedIntent>();
  readonly #idempotency = new Map<string, string>();

  create(record: PersistedIntent): void {
    validatePersistedIntent(record);
    if (
      this.#records.has(record.intentId) ||
      this.#idempotency.has(record.idempotencyKey)
    )
      throw new Error("Duplicate C3 intent or idempotency key.");
    this.#records.set(record.intentId, structuredClone(record));
    this.#idempotency.set(record.idempotencyKey, record.intentId);
  }

  update(record: PersistedIntent): void {
    validatePersistedIntent(record);
    const current = this.#records.get(record.intentId);
    if (!current || record.revision !== current.revision + 1)
      throw new Error("Stale or missing persisted intent revision.");
    if (
      record.idempotencyKey !== current.idempotencyKey ||
      record.configurationHash !== current.configurationHash ||
      record.wallet !== current.wallet ||
      record.createdAtUnix !== current.createdAtUnix ||
      record.expiresAtUnix !== current.expiresAtUnix
    )
      throw new Error("Immutable intent fields changed.");
    if (
      current.submittedSignature &&
      record.submittedSignature !== current.submittedSignature
    )
      throw new Error("Submitted signature cannot be changed or deleted.");
    this.#records.set(record.intentId, structuredClone(record));
  }

  read(intentId: string): PersistedIntent | undefined {
    const record = this.#records.get(intentId);
    return record ? structuredClone(record) : undefined;
  }
}
