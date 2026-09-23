import { C3_ALLOCATION, C3_MAINNET_EXECUTION_CAPABILITY } from "./constants.ts";

/** Deliberately small read-only package boundary. No builder, evidence or trust API. */
export function getC3ServiceStatus() {
  return Object.freeze({
    allocation: C3_ALLOCATION,
    mainnetExecutionEnabled: C3_MAINNET_EXECUTION_CAPABILITY,
    durablePersistenceValidated: false,
    symmetryAdapterReviewed: false,
  });
}
