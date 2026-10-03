/** Connected lifecycle protocol. Dependencies are interfaces, not capability
 * overrides; the production factory uses the immutable gate and MWA adapter.
 * Durable local storage contains only IDs/hashes/signatures, never payloads. */
import {
  freezeOwnerReview,
  inspectOwnerTransaction,
} from "./owner-transaction-review.ts";
import {
  ownerTemplates,
  type OwnerPolicy,
  type MoneyAction,
} from "./owner-policy.ts";
import { sha256 } from "@noble/hashes/sha2.js";
export const ownerMessageHash = (bytes: Uint8Array) =>
  Array.from(sha256(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
export type OwnerReceipt = Readonly<{
  version: "c3-owner/v1";
  intentId: string;
  requestId: string;
  wallet: string;
  messageHash: string;
  action: MoneyAction;
  signature: string | null;
  state:
    | "review"
    | "authorizing"
    | "signed"
    | "uncertain"
    | "finalized"
    | "closed_unexecuted";
}>;
export type PreparedOwnerOperation = Readonly<{
  intentId: string;
  requestId: string;
  wallet: string;
  messageHash: string;
  action: MoneyAction;
  expiry: number;
  packet: Uint8Array;
}>;
export type OwnerBackend = Readonly<{
  reauthenticate?: (requestId?: string) => Promise<void>;
  prepare: (
    intentId: string,
    action: MoneyAction,
  ) => Promise<PreparedOwnerOperation>;
  recordSignature: (
    requestId: string,
    signed: Uint8Array,
  ) => Promise<{ signature: string }>;
  status: (requestId: string) => Promise<{
    requestId: string;
    messageHash: string;
    signature: string | null;
    state: "uncertain" | "finalized" | "signed" | "closed_unexecuted";
    economicEvidenceHash?: string;
    evidenceScope?: "LOCAL_CLONE" | "MAINNET_INDEPENDENT_RPC";
  }>;
  closeExpired?: (
    requestId: string,
    cancelled: boolean,
  ) => Promise<{ requestId: string; state: "closed_unexecuted" }>;
}>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sig = /^[1-9A-HJ-NP-Za-km-z]{64,96}$/;
export function validateOwnerReceipt(
  value: string,
  wallet: string,
): OwnerReceipt {
  if (value.length > 1200) throw Error("C3_OWNER_STORAGE_CORRUPT");
  const r = JSON.parse(value) as OwnerReceipt;
  if (
    !r ||
    typeof r !== "object" ||
    Object.keys(r).sort().join(",") !==
      "action,intentId,messageHash,requestId,signature,state,version,wallet" ||
    r.version !== "c3-owner/v1" ||
    r.wallet !== wallet ||
    !uuid.test(r.intentId) ||
    !uuid.test(r.requestId) ||
    !/^[a-f0-9]{64}$/.test(r.messageHash) ||
    !["deposit", "issue_shares", "request_redemption", "claim"].includes(
      r.action,
    ) ||
    ![
      "review",
      "authorizing",
      "signed",
      "uncertain",
      "finalized",
      "closed_unexecuted",
    ].includes(r.state) ||
    !(
      r.signature === null ||
      (typeof r.signature === "string" && sig.test(r.signature))
    ) ||
    (["signed", "finalized"].includes(r.state) && r.signature === null)
  )
    throw Error("C3_OWNER_STORAGE_CORRUPT");
  return Object.freeze({ ...r });
}
export function parseOwnerReceipt(value: string, wallet: string): OwnerReceipt {
  const r = validateOwnerReceipt(value, wallet);
  return Object.freeze({
    ...r,
    state: ["authorizing", "finalized", "closed_unexecuted"].includes(r.state)
      ? "uncertain"
      : r.state,
  });
}
export class OwnerController {
  private busy = false;
  private receipt: OwnerReceipt | null = null;
  private prepared: PreparedOwnerOperation | null = null;
  private readonly deps: Readonly<{
    gate: () => void;
    wallet: string;
    policy: OwnerPolicy;
    backend: OwnerBackend;
    save: (r: OwnerReceipt) => Promise<void>;
    sign: (
      bytes: Uint8Array,
      templates: ReturnType<typeof ownerTemplates>,
    ) => Promise<Uint8Array>;
    signature: (bytes: Uint8Array) => string;
    now: () => number;
    evidenceScope?: "LOCAL_CLONE" | "MAINNET_INDEPENDENT_RPC";
  }>;
  constructor(deps: OwnerController["deps"]) {
    this.deps = deps;
  }
  get snapshot() {
    return this.receipt;
  }
  /** User-selected sign-in; never called by restart, status or timeout recovery. */
  async reauthenticate() {
    this.deps.gate();
    if (this.busy || !this.deps.backend.reauthenticate)
      throw Error("C3_OWNER_REAUTH_REQUIRED");
    this.busy = true;
    try {
      await this.deps.backend.reauthenticate(this.receipt?.requestId);
    } finally {
      this.busy = false;
    }
  }
  async restore(value: string) {
    if (this.busy) throw Error("C3_OPERATION_ALREADY_PENDING");
    this.receipt = parseOwnerReceipt(value, this.deps.wallet);
    this.prepared = null;
  }
  private async store(r: OwnerReceipt) {
    const checked = validateOwnerReceipt(JSON.stringify(r), this.deps.wallet);
    await this.deps.save(checked);
    this.receipt = checked;
  }
  async prepare(intentId: string, action: MoneyAction) {
    this.deps.gate();
    if (
      this.busy ||
      (this.receipt &&
        !["finalized", "closed_unexecuted"].includes(this.receipt.state))
    )
      throw Error("C3_OPERATION_RECONCILE_REQUIRED");
    this.busy = true;
    try {
      const p = await this.deps.backend.prepare(intentId, action);
      // Reject replay BEFORE persisting anything: old signature/evidence survives.
      if (
        this.receipt?.state === "closed_unexecuted" &&
        p.requestId === this.receipt.requestId
      )
        throw Error("C3_OWNER_GENERATION_REPLAY");
      if (
        p.intentId !== intentId ||
        p.action !== action ||
        p.wallet !== this.deps.wallet
      )
        throw Error("C3_OWNER_RESPONSE_BINDING");
      const templates = ownerTemplates(
        this.deps.policy,
        action,
        p.expiry,
        this.deps.now(),
      );
      const frozen = freezeOwnerReview(
        p.packet,
        this.deps.policy.wallet,
        templates,
      );
      if (ownerMessageHash(frozen.review.message) !== p.messageHash)
        throw Error("C3_OWNER_MESSAGE_HASH_MISMATCH");
      const receipt = parseOwnerReceipt(
        JSON.stringify({
          version: "c3-owner/v1",
          intentId,
          requestId: p.requestId,
          wallet: p.wallet,
          messageHash: p.messageHash,
          action,
          signature: null,
          state: "review",
        }),
        this.deps.wallet,
      );
      await this.store(receipt);
      this.prepared = { ...p, packet: frozen.bytes };
      return frozen.review;
    } finally {
      this.busy = false;
    }
  }
  /** Only an explicit Review -> Approve event calls this method. */
  async approve() {
    this.deps.gate();
    if (this.busy || this.receipt?.state !== "review" || !this.prepared)
      throw Error("C3_EXPLICIT_REVIEW_REQUIRED");
    this.busy = true;
    try {
      const p = this.prepared,
        templates = ownerTemplates(
          this.deps.policy,
          p.action,
          p.expiry,
          this.deps.now(),
        );
      const frozen = freezeOwnerReview(
        p.packet,
        this.deps.policy.wallet,
        templates,
      );
      await this.store({ ...this.receipt, state: "authorizing" }); // storage failure -> no wallet
      const signed = await this.deps.sign(frozen.bytes, templates);
      const after = inspectOwnerTransaction(
        signed,
        this.deps.policy.wallet,
        templates,
        true,
      );
      if (
        after.message.length !== frozen.review.message.length ||
        !after.message.every((v, i) => v === frozen.review.message[i])
      )
        throw Error("C3_WALLET_MESSAGE_CHANGED");
      const signature = this.deps.signature(signed);
      if (!sig.test(signature)) throw Error("C3_OWNER_SIGNATURE_INVALID");
      await this.store({ ...this.receipt!, signature, state: "signed" });
      const result = await this.deps.backend.recordSignature(
        p.requestId,
        signed,
      );
      if (result.signature !== signature)
        throw Error("C3_OWNER_RECEIPT_MISMATCH");
      // No automatic broadcast, quote, retry or promotion in this controller.
      return signature;
    } catch (error) {
      // Cancellation and timeout can hide a signed result. Never mark retryable.
      if (
        this.receipt &&
        ["authorizing", "signed"].includes(this.receipt.state)
      ) {
        this.receipt = Object.freeze({ ...this.receipt, state: "uncertain" });
        await this.deps.save(this.receipt);
      }
      throw error;
    } finally {
      this.prepared = null;
      this.busy = false;
    }
  }
  /** Explicit refresh is read-only. Restart never invokes the wallet/backend
   * mutation. Even a server-confirmed message alone cannot claim economic success. */
  async recover() {
    if (this.busy || !this.receipt) throw Error("C3_OWNER_RECOVERY_REQUIRED");
    this.busy = true;
    try {
      const r = await this.deps.backend.status(this.receipt.requestId);
      if (
        r.requestId !== this.receipt.requestId ||
        r.messageHash !== this.receipt.messageHash ||
        !["signed", "uncertain", "finalized", "closed_unexecuted"].includes(
          r.state,
        ) ||
        !(
          r.signature === null ||
          (typeof r.signature === "string" && sig.test(r.signature))
        ) ||
        (["signed", "finalized"].includes(r.state) && r.signature === null) ||
        (this.receipt.signature !== null &&
          r.signature !== this.receipt.signature &&
          !(r.state === "closed_unexecuted" && r.signature === null)) ||
        ((r.state === "finalized" || r.state === "closed_unexecuted") &&
          ((r.state === "finalized" && r.signature === null) ||
            !/^[a-f0-9]{64}$/.test(r.economicEvidenceHash ?? "") ||
            r.evidenceScope !==
              (this.deps.evidenceScope ?? "MAINNET_INDEPENDENT_RPC")))
      )
        throw Error("C3_OWNER_RECOVERY_BINDING");
      await this.store({
        ...this.receipt,
        signature: r.signature ?? this.receipt.signature,
        state: r.state,
      });
    } finally {
      this.busy = false;
    }
  }
  /** Explicit cancellation request does NOT erase a signature or make a request
   * retryable. Only the server's dead-blockhash/economic barrier can close it. */
  async closeExpired(cancelled = true) {
    this.deps.gate();
    if (
      this.busy ||
      !this.receipt ||
      this.receipt.state === "finalized" ||
      !this.deps.backend.closeExpired
    )
      throw Error("C3_OWNER_RECOVERY_REQUIRED");
    this.busy = true;
    try {
      const result = await this.deps.backend.closeExpired(
        this.receipt.requestId,
        cancelled,
      );
      if (
        result.requestId !== this.receipt.requestId ||
        result.state !== "closed_unexecuted"
      )
        throw Error("C3_OWNER_RECOVERY_BINDING");
      // Destroy only volatile packet, preserve the durable public receipt and
      // signature. Independent status refresh is mandatory before replacement.
      this.prepared = null;
      await this.store({ ...this.receipt, state: "uncertain" });
    } finally {
      this.busy = false;
    }
  }
  async renewExpiredRequest() {
    this.deps.gate();
    await this.recover();
    const old = this.receipt;
    if (old?.state !== "closed_unexecuted")
      throw Error("C3_OWNER_RECOVERY_REQUIRED");
    await this.prepare(old.intentId, old.action);
  }
}
