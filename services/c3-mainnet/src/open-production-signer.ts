/** Immutable production entry; approval precedes all DB/HSM access. */
import type { Pool } from "pg";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import {
  VerifiedOpenRecordSigner,
  type IsolatedEd25519Provider,
} from "./open-record-signer.ts";
import { C3_MAINNET } from "./constants.ts";
export {
  verifiedGenerationDeadline,
  type IsolatedEd25519Provider,
} from "./open-record-signer.ts";
export class OpenProductionRecordSigner {
  private readonly pool: Pool;
  private readonly provider: IsolatedEd25519Provider;
  constructor(pool: Pool, provider: IsolatedEd25519Provider) {
    this.pool = pool;
    this.provider = provider;
  }
  async signRecord(quoteId: string, expectedHash: string): Promise<Uint8Array> {
    const policy = requireOpenProductionPolicy();
    return new VerifiedOpenRecordSigner(
      this.pool,
      this.provider,
      policy,
      C3_MAINNET.genesisHash,
      "MAINNET_REVIEWED",
    ).signRecord(quoteId, expectedHash);
  }
}
