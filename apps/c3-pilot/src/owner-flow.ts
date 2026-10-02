/** UI operation state; no timer, retry, custody or wallet implementation. */
export type OwnerAction =
  | "deposit"
  | "issue_shares"
  | "request_redemption"
  | "lock_shares"
  | "renew"
  | "claim";
export type OwnerFlowState =
  | "idle"
  | "preparing"
  | "review"
  | "authorizing"
  | "signed"
  | "uncertain"
  | "finalized"
  | "rejected";
export class OwnerFlow {
  private state: OwnerFlowState = "idle";
  private signature: string | null = null;
  private requestId: string | null = null;
  private messageHash: string | null = null;
  get snapshot() {
    return Object.freeze({ state: this.state, signature: this.signature });
  }
  start(requestId: string, messageHash: string) {
    if (!["idle", "rejected"].includes(this.state))
      throw Error("C3_OPERATION_ALREADY_PENDING");
    if (
      !/^[a-f0-9-]{36}$/.test(requestId) ||
      !/^[a-f0-9]{64}$/.test(messageHash)
    )
      throw Error("C3_OPERATION_IDENTITY");
    this.requestId = requestId;
    this.messageHash = messageHash;
    this.state = "preparing";
  }
  review() {
    if (this.state !== "preparing") throw Error("C3_OPERATION_STATE");
    this.state = "review";
  }
  authorize() {
    if (this.state !== "review") throw Error("C3_EXPLICIT_REVIEW_REQUIRED");
    this.state = "authorizing";
  }
  signed(signature: string) {
    if (
      this.state !== "authorizing" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature)
    )
      throw Error("C3_OPERATION_STATE");
    this.signature = signature;
    this.state = "signed";
  }
  /** State update only, after cryptographic/journal verification upstream.
   * Does not invoke a wallet or classify uncertain submission as finalized. */
  recordLateVerifiedSignature(
    requestId: string,
    messageHash: string,
    signature: string,
  ) {
    if (
      this.state !== "uncertain" ||
      requestId !== this.requestId ||
      messageHash !== this.messageHash ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature) ||
      (this.signature !== null && signature !== this.signature)
    )
      throw Error("C3_OPERATION_RECONCILE_REQUIRED");
    this.signature = signature;
  }
  interrupted() {
    if (!["authorizing", "signed", "uncertain"].includes(this.state))
      throw Error("C3_OPERATION_STATE");
    this.state = "uncertain";
  }
  reject() {
    if (
      !["preparing", "review", "authorizing"].includes(this.state) ||
      this.signature
    )
      throw Error("C3_OPERATION_RECONCILE_REQUIRED");
    this.state = "rejected";
  }
  finalized(signature: string) {
    if (
      !["signed", "uncertain"].includes(this.state) ||
      typeof signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature) ||
      this.signature === null ||
      signature !== this.signature
    )
      throw Error("C3_OPERATION_RECONCILE_REQUIRED");
    this.state = "finalized";
  }
}
