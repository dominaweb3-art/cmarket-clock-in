/** Public intent locator only. NOT authentication, enrollment proof or finality.
 * Server challenge/session revalidates the consumed proof and policy binding.
 * Inspect receipts before allowing any wallet callback. No silent replacement. */
import { validateOwnerReceipt } from "./owner-controller.ts";
import type { OwnerEnrollmentScope } from "./owner-enrollment.ts";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function resolveOwnerIntent(
  origin: string,
  scope: OwnerEnrollmentScope,
  storedLocator: string | null,
  storedReceipt: string | null,
  preparing: boolean,
  allowEnrollment: boolean,
  enroll: () => Promise<string>,
  saveLocator: (publicRecord: string) => Promise<void>,
): Promise<string> {
  const receipt =
    storedReceipt === null
      ? null
      : validateOwnerReceipt(storedReceipt, scope.wallet);
  if (
    preparing &&
    receipt &&
    !["finalized", "closed_unexecuted"].includes(receipt.state)
  )
    throw Error("C3_OPERATION_RECONCILE_REQUIRED");
  const binding = { version: "c3-owner-intent/v1", origin, ...scope };
  let located: string | null = null;
  if (storedLocator !== null) {
    if (storedLocator.length > 1600)
      throw Error("C3_OWNER_INTENT_STORAGE_CORRUPT");
    const record = JSON.parse(storedLocator) as Record<string, unknown>;
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      Object.keys(record).sort().join(",") !==
        [...Object.keys(binding), "intentId"].sort().join(",") ||
      !Object.entries(binding).every(([k, v]) => record[k] === v) ||
      typeof record.intentId !== "string" ||
      !uuid.test(record.intentId)
    )
      throw Error("C3_OWNER_INTENT_STORAGE_CORRUPT");
    located = record.intentId;
  }
  if (located && receipt && located !== receipt.intentId)
    throw Error("C3_OWNER_INTENT_STORAGE_CONFLICT");
  // Existing receipts from earlier releases can recover their public locator.
  // No claim of enrollment/admission: server still verifies actual PostgreSQL proof.
  const existing = located ?? receipt?.intentId;
  if (existing) return existing;
  if (!allowEnrollment) throw Error("C3_OWNER_ENROLLMENT_REQUIRED");
  const intentId = await enroll();
  if (!uuid.test(intentId)) throw Error("C3_OWNER_ENROLLMENT_RESPONSE");
  await saveLocator(JSON.stringify({ ...binding, intentId }));
  return intentId;
}
