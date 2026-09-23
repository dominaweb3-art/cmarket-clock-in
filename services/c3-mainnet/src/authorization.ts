/** Pure verification of a PostgreSQL authorization. No builder or policy registry. */
import { createHash, timingSafeEqual } from "node:crypto";

import { C3_MAINNET } from "./constants.ts";
import { canonicalize } from "./manifest.ts";

const HASH = /^[a-f0-9]{64}$/;

function sameHash(left: unknown, right: unknown): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    HASH.test(left) &&
    HASH.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"))
  );
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

export type AuthorizationBinding = Readonly<{
  intentId: string;
  idempotencyKey: string;
  configurationHash: string;
  wallet: string;
  operation: string;
  inputAmountBaseUnits: string;
}>;

export function verifyDurableAuthorization(
  canonicalJson: string,
  storedHash: string,
  binding: AuthorizationBinding,
): Readonly<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(canonicalJson) as unknown;
  } catch {
    throw new Error("Durable authorization JSON is corrupt.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Durable authorization is corrupt.");
  const record = value as Record<string, unknown>;
  const { authorizationHash, ...payload } = record;
  const calculatedHash = createHash("sha256")
    .update(canonicalize(payload))
    .digest("hex");
  if (
    canonicalize(record) !== canonicalJson ||
    !sameHash(authorizationHash, storedHash) ||
    !sameHash(calculatedHash, storedHash) ||
    record.schemaVersion !== "c3-authorization/v3" ||
    record.executionCapability !== false ||
    record.cluster !== C3_MAINNET.cluster ||
    record.genesisHash !== C3_MAINNET.genesisHash ||
    record.intentId !== binding.intentId ||
    record.idempotencyKey !== binding.idempotencyKey ||
    record.configurationHash !== binding.configurationHash ||
    record.wallet !== binding.wallet ||
    record.operation !== binding.operation ||
    record.inputAmountBaseUnits !== binding.inputAmountBaseUnits
  )
    throw new Error(
      "Durable authorization fingerprint or intent binding differs; manual review required.",
    );
  const message = record.canonicalV0MessageBase64;
  const messageHash = record.canonicalV0MessageHash;
  if (
    typeof message !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(message) ||
    typeof messageHash !== "string" ||
    !HASH.test(messageHash)
  )
    throw new Error("Durable authorization message is malformed.");
  const bytes = Buffer.from(message, "base64");
  if (
    bytes.toString("base64") !== message ||
    !sameHash(createHash("sha256").update(bytes).digest("hex"), messageHash)
  )
    throw new Error("Durable authorization message hash differs.");
  return freezeJson(record);
}
