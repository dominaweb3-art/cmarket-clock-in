/** Non-economic DEVICE QA only. Not owner authentication / C3 authorization.
 * No server, storage, transaction, RPC, private key or Mainnet capability.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
export const DEVICE_QA_CHAIN = "solana:devnet" as const;
type Data = {
  bytes: Uint8Array;
  wallet: Uint8Array;
  created: number;
  until: number;
  startedMonotonic: number;
  lastWall: number;
  used: boolean;
};
const reviews = new WeakMap<object, Data>();
const consumed = new WeakMap<object, Data>();
let sequence = 0;
export type DeviceQaReview = Readonly<{ text: string }>;
export function createDeviceQaReview(wallet: Uint8Array): DeviceQaReview {
  if (wallet.length !== 32) throw Error("C3_DEVICE_QA_WALLET");
  const created = Date.now();
  const startedMonotonic = performance.now();
  if (!Number.isSafeInteger(created) || !Number.isFinite(startedMonotonic))
    throw Error("C3_DEVICE_QA_CLOCK");
  const text = [
    "C Market DEVICE QA ONLY v1",
    "Network: solana:devnet",
    "Purpose: test explicit MWA message signing on this device.",
    "NO transaction, transfer, token approval, login, C3 shares or Mainnet authorization.",
    `Public key (hex): ${bytesToHex(wallet)}`,
    `Created: ${new Date(created).toISOString()}`,
    `Expires: ${new Date(created + 120000).toISOString()}`,
    // This sequence is NOT an authentication nonce. Domain cannot enter owner auth.
    `QA sequence: ${++sequence}`,
  ].join("\n");
  const review = Object.freeze({ text });
  reviews.set(review, {
    bytes: new TextEncoder().encode(text),
    wallet: new Uint8Array(wallet),
    created,
    until: created + 120000,
    startedMonotonic,
    lastWall: created,
    used: false,
  });
  return review;
}
export function consumeDeviceQaReview(review: DeviceQaReview) {
  const r = reviews.get(review);
  if (!r || r.used) throw Error("C3_DEVICE_QA_EXPIRED_OR_CONSUMED");
  checkClock(r);
  r.used = true; // Before any await / wallet invocation. Never reset on rejection.
  const packet = Object.freeze({
    bytes: r.bytes.slice(),
    wallet: r.wallet.slice(),
    created: r.created,
    expires: r.until,
  });
  consumed.set(packet, r);
  return packet;
}
function checkClock(r: Data) {
  const wall = Date.now(),
    elapsed = performance.now() - r.startedMonotonic;
  if (
    !Number.isSafeInteger(wall) ||
    !Number.isFinite(elapsed) ||
    elapsed < 0 ||
    elapsed >= 120000 ||
    wall < r.created ||
    wall < r.lastWall ||
    wall >= r.until ||
    Math.abs(wall - r.created - elapsed) > 2000
  )
    throw Error("C3_DEVICE_QA_CLOCK_OR_EXPIRY");
  r.lastWall = wall;
}
export function assertDeviceQaFresh(
  expected: ReturnType<typeof consumeDeviceQaReview>,
) {
  const r = consumed.get(expected);
  if (!r) throw Error("C3_DEVICE_QA_CONTEXT");
  checkClock(r);
}
export function verifyDeviceQaReply(
  expected: ReturnType<typeof consumeDeviceQaReview>,
  signed: Uint8Array,
) {
  assertDeviceQaFresh(expected);
  const r = consumed.get(expected)!;
  if (
    signed.length !== r.bytes.length + 64 ||
    !r.bytes.every((b, i) => signed[i] === b) ||
    !ed25519.verify(signed.subarray(r.bytes.length), r.bytes, r.wallet, {
      zip215: false,
    })
  )
    throw Error("C3_DEVICE_QA_SIGNATURE_INVALID");
  // Signature and wallet remain memory-only. Digest is message evidence, not a tx.
  return Object.freeze({
    status: "VERIFIED_NON_ECONOMIC_MESSAGE" as const,
    messageSha256: bytesToHex(sha256(r.bytes)),
    chain: DEVICE_QA_CHAIN,
  });
}
