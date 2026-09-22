import type { C3AuthorizationManifest } from "./builder.ts";
import {
  assertIntentTransition,
  assertVerifiedSettlementEvidence,
  type IntentState,
  type VerifiedSettlementEvidence,
} from "./reconciliation.ts";

export type PersistedIntent = Readonly<{
  schemaVersion: "c3-intent/v2";
  intentId: string;
  idempotencyKey: string;
  configurationHash: string;
  wallet: string;
  operation: string;
  inputAmountBaseUnits: string;
  state: IntentState;
  revision: number;
  createdAtUnix: number;
  updatedAtUnix: number;
  expiresAtUnix: number;
  recoveryAttempts: number;
  authorizationManifest?: C3AuthorizationManifest;
  submittedSignature?: string;
  settledEffectsHash?: string;
  partialCompletionHash?: string;
  manualReviewReason?: string;
}>;

export type IntentTransitionPatch = Readonly<{
  authorizationManifest?: C3AuthorizationManifest;
  submittedSignature?: string;
  verifiedSettlement?: VerifiedSettlementEvidence;
  partialCompletionHash?: string;
  manualReviewReason?: string;
}>;

export interface IntentRepository {
  readonly durable: boolean;
  create(record: PersistedIntent): void;
  transition(
    intentId: string,
    expectedRevision: number,
    expectedState: IntentState,
    nextState: IntentState,
    updatedAtUnix: number,
    patch?: IntentTransitionPatch,
  ): PersistedIntent;
  read(intentId: string, nowUnix: number): PersistedIntent | undefined;
}

const HASH = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
const PUBLIC_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const INTEGER = /^(0|[1-9]\d*)$/;

export function validatePersistedIntent(value: PersistedIntent): void {
  if (value.schemaVersion !== "c3-intent/v2")
    throw new Error("Unsupported intent schema.");
  if (
    !/^c3-[a-f0-9]{32,64}$/.test(value.intentId) ||
    !HASH.test(value.idempotencyKey) ||
    !HASH.test(value.configurationHash)
  )
    throw new Error("Persisted intent identity is malformed.");
  if (
    !PUBLIC_KEY.test(value.wallet) ||
    !INTEGER.test(value.inputAmountBaseUnits) ||
    BigInt(value.inputAmountBaseUnits) <= 0n
  )
    throw new Error("Persisted wallet or amount is malformed.");
  if (
    !value.operation ||
    !Number.isInteger(value.revision) ||
    value.revision < 1 ||
    value.updatedAtUnix < value.createdAtUnix ||
    value.expiresAtUnix <= value.createdAtUnix
  )
    throw new Error("Persisted intent lifecycle fields are invalid.");
  if (
    !Number.isInteger(value.recoveryAttempts) ||
    value.recoveryAttempts < 0 ||
    value.recoveryAttempts > 3
  )
    throw new Error("Recovery attempts are invalid.");
  for (const fingerprint of [
    value.settledEffectsHash,
    value.partialCompletionHash,
  ])
    if (fingerprint !== undefined && !HASH.test(fingerprint))
      throw new Error("Persisted evidence hash is malformed.");
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
    [
      "intent_submitted",
      "keeper_pending",
      "partially_completed",
      "settled",
    ].includes(value.state) &&
    !value.submittedSignature
  )
    throw new Error("Submitted state lacks immutable signature.");
  if (value.state === "partially_completed" && !value.partialCompletionHash)
    throw new Error("Partial completion lacks immutable evidence.");
  if (value.state === "settled" && !value.settledEffectsHash)
    throw new Error("Settled state lacks independently reconciled effects.");
  if (value.state === "manual_review" && !value.manualReviewReason)
    throw new Error("Manual review lacks a reason.");
}

function same(value: unknown): string {
  return JSON.stringify(value);
}

export class InMemoryIntentRepository implements IntentRepository {
  readonly durable = false;
  readonly #records = new Map<string, PersistedIntent>();
  readonly #idempotency = new Map<string, string>();
  readonly #quarantine = new Map<string, string>();

  static hydrate(
    records: readonly PersistedIntent[],
  ): InMemoryIntentRepository {
    const repository = new InMemoryIntentRepository();
    for (const record of records) {
      try {
        validatePersistedIntent(record);
        if (
          repository.#records.has(record.intentId) ||
          repository.#idempotency.has(record.idempotencyKey)
        )
          throw new Error("Duplicate hydrated intent identity.");
        repository.#records.set(record.intentId, structuredClone(record));
        repository.#idempotency.set(record.idempotencyKey, record.intentId);
      } catch (error) {
        repository.#quarantine.set(
          record.intentId || "unknown",
          error instanceof Error ? error.message : "corrupt record",
        );
      }
    }
    if (repository.#quarantine.size > 0)
      throw new Error("Corrupt persisted intents were quarantined.");
    return repository;
  }

  create(record: PersistedIntent): void {
    validatePersistedIntent(record);
    if (record.state !== "draft" || record.revision !== 1)
      throw new Error("New intents must begin in draft at revision one.");
    if (
      this.#records.has(record.intentId) ||
      this.#idempotency.has(record.idempotencyKey)
    )
      throw new Error("Duplicate C3 intent or idempotency key.");
    this.#records.set(record.intentId, structuredClone(record));
    this.#idempotency.set(record.idempotencyKey, record.intentId);
  }

  transition(
    intentId: string,
    expectedRevision: number,
    expectedState: IntentState,
    nextState: IntentState,
    updatedAtUnix: number,
    patch: IntentTransitionPatch = {},
  ): PersistedIntent {
    const current = this.#records.get(intentId);
    if (
      !current ||
      current.revision !== expectedRevision ||
      current.state !== expectedState
    )
      throw new Error("Atomic compare-and-swap conflict.");
    assertIntentTransition(expectedState, nextState);
    if (
      !Number.isSafeInteger(updatedAtUnix) ||
      updatedAtUnix < current.updatedAtUnix
    )
      throw new Error("Transition timestamp is stale.");
    const allowedPatchKeys = new Set([
      "authorizationManifest",
      "submittedSignature",
      "verifiedSettlement",
      "partialCompletionHash",
      "manualReviewReason",
    ]);
    if (Object.keys(patch).some((key) => !allowedPatchKeys.has(key)))
      throw new Error(
        "Transition patch attempted to mutate an immutable field.",
      );
    if (nextState === "settled") {
      if (!patch.verifiedSettlement || !current.submittedSignature)
        throw new Error(
          "Settled transition requires verified reconciliation evidence.",
        );
      assertVerifiedSettlementEvidence(
        patch.verifiedSettlement,
        current.submittedSignature,
      );
    } else if (patch.verifiedSettlement) {
      throw new Error(
        "Settlement evidence is only valid for the settled transition.",
      );
    }
    const terminal = ["settled", "manual_review", "cancelled", "expired"];
    if (terminal.includes(current.state))
      throw new Error("Terminal or quarantined intent cannot transition.");
    const expired = updatedAtUnix >= current.expiresAtUnix;
    const expiryTransitionAllowed =
      (["draft", "awaiting_wallet"].includes(current.state) &&
        nextState === "expired") ||
      (current.submittedSignature !== undefined &&
        nextState === "manual_review");
    if (expired && !expiryTransitionAllowed)
      throw new Error("Expired intent cannot advance or retry.");
    const recoveryTransition =
      current.state === "failed_recoverable" && nextState === "keeper_pending";
    if (recoveryTransition) {
      if (current.recoveryAttempts >= 3)
        throw new Error("Recovery attempt budget is exhausted.");
      if (updatedAtUnix >= current.createdAtUnix + 86_400)
        throw new Error("Recovery window exceeds 24 hours.");
    }
    const { verifiedSettlement, ...storedPatch } = patch;
    const candidate: PersistedIntent = {
      ...current,
      ...storedPatch,
      ...(verifiedSettlement
        ? { settledEffectsHash: verifiedSettlement.effectsFingerprint }
        : {}),
      state: nextState,
      revision: current.revision + 1,
      updatedAtUnix,
      recoveryAttempts: recoveryTransition
        ? current.recoveryAttempts + 1
        : current.recoveryAttempts,
    };
    if (
      current.authorizationManifest &&
      same(candidate.authorizationManifest) !==
        same(current.authorizationManifest)
    )
      throw new Error("Authorization manifest cannot be changed or deleted.");
    if (
      current.submittedSignature &&
      candidate.submittedSignature !== current.submittedSignature
    )
      throw new Error("Submitted signature cannot be changed or deleted.");
    if (
      current.settledEffectsHash &&
      candidate.settledEffectsHash !== current.settledEffectsHash
    )
      throw new Error("Settled effects cannot be changed or deleted.");
    if (
      current.partialCompletionHash &&
      candidate.partialCompletionHash !== current.partialCompletionHash
    )
      throw new Error(
        "Partial completion evidence cannot be changed or deleted.",
      );
    if (
      candidate.idempotencyKey !== current.idempotencyKey ||
      candidate.configurationHash !== current.configurationHash ||
      candidate.wallet !== current.wallet ||
      candidate.operation !== current.operation ||
      candidate.inputAmountBaseUnits !== current.inputAmountBaseUnits ||
      candidate.createdAtUnix !== current.createdAtUnix ||
      candidate.expiresAtUnix !== current.expiresAtUnix
    )
      throw new Error("Immutable intent fields changed.");
    if (
      candidate.recoveryAttempts !==
      current.recoveryAttempts + (recoveryTransition ? 1 : 0)
    )
      throw new Error("Recovery attempts must be incremented atomically.");
    validatePersistedIntent(candidate);
    this.#records.set(intentId, structuredClone(candidate));
    return structuredClone(candidate);
  }

  read(intentId: string, nowUnix: number): PersistedIntent | undefined {
    const record = this.#records.get(intentId);
    if (!record) return undefined;
    try {
      validatePersistedIntent(record);
    } catch (error) {
      this.#records.delete(intentId);
      this.#quarantine.set(
        intentId,
        error instanceof Error ? error.message : "corrupt record",
      );
      throw new Error("Corrupt persisted intent was quarantined.");
    }
    if (!Number.isSafeInteger(nowUnix) || nowUnix < record.createdAtUnix)
      throw new Error("Intent read time is invalid.");
    if (
      nowUnix >= record.expiresAtUnix &&
      !["settled", "manual_review", "cancelled", "expired"].includes(
        record.state,
      )
    )
      throw new Error(
        "Expired intent requires an explicit terminal transition.",
      );
    if (record.recoveryAttempts >= 3 && record.state === "failed_recoverable")
      throw new Error("Recovery attempt budget is exhausted.");
    return structuredClone(record);
  }

  quarantineCount(): number {
    return this.#quarantine.size;
  }
}

export function assertProductionRepository(repository: IntentRepository): void {
  if (!repository.durable)
    throw new Error(
      "Production readiness requires a durable transactional CAS repository.",
    );
}
