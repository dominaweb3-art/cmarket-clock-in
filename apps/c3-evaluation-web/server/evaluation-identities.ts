/** Evaluation-only server bootstrap. Secrets are injected at runtime, never
 * loaded from a repository path, returned over HTTP or included in an APK.
 * These operational identities do not authorize or sign for a wallet owner. */
import {
  createPrivateKey,
  createPublicKey,
  sign,
  type KeyObject,
} from "node:crypto";
import { decodeBase58 } from "../../../services/c3-mainnet/src/solana.ts";
import type { Pool } from "pg";
import { EVALUATION } from "../../../services/c3-mainnet/src/evaluation-scope.ts";
import { EVALUATION_MINT_AUTHORITY } from "../../../services/c3-mainnet/src/evaluation-provisioning.ts";
import { StoredEvaluationQuoteSigner } from "../../../services/c3-mainnet/src/evaluation-stored-signer.ts";
import type { EvaluationPacketSigner } from "../../../services/c3-mainnet/src/evaluation-service-journal.ts";

function key(name: string, expected: string): KeyObject {
  const value = process.env[name];
  if (!value || value.length > 500) throw Error("EVAL_SERVER_IDENTITY_MISSING");
  let bytes: number[];
  try {
    bytes = JSON.parse(value);
  } catch {
    throw Error("EVAL_SERVER_IDENTITY_INVALID");
  }
  if (
    !Array.isArray(bytes) ||
    bytes.length !== 64 ||
    bytes.some((v) => !Number.isInteger(v) || v < 0 || v > 255)
  )
    throw Error("EVAL_SERVER_IDENTITY_INVALID");
  const secret = Buffer.from(bytes);
  try {
    const privateKey = createPrivateKey({
      format: "der",
      type: "pkcs8",
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        secret.subarray(0, 32),
      ]),
    });
    const publicBytes = Buffer.from(
      createPublicKey(privateKey).export({ format: "der", type: "spki" }),
    ).subarray(-32);
    if (
      !publicBytes.equals(Buffer.from(decodeBase58(expected))) ||
      !publicBytes.equals(secret.subarray(32))
    )
      throw Error("EVAL_SERVER_IDENTITY_INVALID");
    return privateKey;
  } finally {
    secret.fill(0);
    bytes.fill(0);
  }
}
function packetSigner(name: string, address: string): EvaluationPacketSigner {
  const privateKey = key(name, address);
  return Object.freeze({
    publicKey: address,
    signMessage: async (message: Uint8Array) => sign(null, message, privateKey),
  });
}
export function evaluationIdentities(pool: Pool) {
  return Object.freeze({
    governance: packetSigner("C3_EVAL_GOVERNANCE_KEY", EVALUATION.governance),
    keeper: packetSigner("C3_EVAL_KEEPER_KEY", EVALUATION.keeper),
    mint: packetSigner("C3_EVAL_MINT_KEY", EVALUATION_MINT_AUTHORITY),
    quotes: new StoredEvaluationQuoteSigner(
      pool,
      key("C3_EVAL_QUOTES_KEY", EVALUATION.quotes),
    ),
  });
}
