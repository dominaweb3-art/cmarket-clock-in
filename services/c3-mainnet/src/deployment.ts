import { createHash } from "node:crypto";

import { canonicalize, type C3DeploymentManifest } from "./manifest.ts";

export const C3_DEPLOYMENT_ORDER = Object.freeze([
  "verify_three_squads_members",
  "create_squads_2_of_3",
  "configure_timelock",
  "configure_responsibilities_and_spending_limits",
  "verify_treasury_vault_address",
  "verify_program_authorities",
  "initialize_symmetry_c3_vault",
  "derive_or_initialize_c3_share_mint",
  "apply_immutable_4000_3000_3000_target",
  "register_approved_assets",
  "register_oracle_feeds",
  "register_route_programs",
  "configure_keeper_limits",
  "configure_pilot_limits",
  "configure_pause_authority",
  "propose_seed_capital",
  "perform_independent_review",
  "collect_two_approved_signatures",
  "reconcile_every_resulting_account",
]);

export type DeploymentBundle = Readonly<{
  schemaVersion: "c3-deployment-bundle/v1";
  executionCapability: false;
  configurationHash: string;
  steps: readonly Readonly<{
    order: number;
    id: string;
    status: "blocked";
    unsignedPackageFingerprint: null;
  }>[];
  bundleFingerprint: string;
}>;

export function createDeterministicDeploymentBundle(
  manifest: C3DeploymentManifest,
): DeploymentBundle {
  const steps = C3_DEPLOYMENT_ORDER.map((id, index) =>
    Object.freeze({
      order: index + 1,
      id,
      status: "blocked" as const,
      unsignedPackageFingerprint: null,
    }),
  );
  const payload = {
    schemaVersion: "c3-deployment-bundle/v1",
    executionCapability: false,
    configurationHash: manifest.immutableConfigurationHash,
    steps,
  } as const;
  return Object.freeze({
    ...payload,
    steps: Object.freeze(steps),
    bundleFingerprint: createHash("sha256")
      .update(canonicalize(payload))
      .digest("hex"),
  });
}
