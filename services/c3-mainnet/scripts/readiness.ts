import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  C3_MAINNET_EXECUTION_CAPABILITY,
  assertExecutionDisabled,
} from "../src/constants.ts";
import { inspectCredentialPresence } from "../src/credentials.ts";
import { createDeterministicDeploymentBundle } from "../src/deployment.ts";
import { squadsRegistryStatus } from "../src/governance.ts";
import {
  validateDeploymentManifest,
  type C3DeploymentManifest,
} from "../src/manifest.ts";
import { vaultSnapshotPolicyRegistryStatus } from "../src/accounting.ts";
import {
  authorizationContextRepositoryStatus,
  operationPolicyRegistryStatus,
} from "../src/builder.ts";
import { rpcProviderRegistryStatus } from "../src/reconciliation.ts";
import { symmetryAdapterRegistryStatus } from "../src/symmetry.ts";

type Category =
  | "INTERNAL_SECURITY_READY"
  | "EXTERNAL_CONFIGURATION_MISSING"
  | "DEPLOYMENT_NOT_AUTHORIZED";
type Check = Readonly<{
  category: Category;
  id: string;
  pass: boolean;
  detail: string;
}>;

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  await readFile(
    path.join(serviceRoot, "config", "deployment-manifest.proposed.json"),
    "utf8",
  ),
) as C3DeploymentManifest;
const mode = process.argv[2];
if (!mode || !["builder", "keeper", "deployment"].includes(mode))
  throw new Error("Readiness mode must be builder, keeper, or deployment.");

assertExecutionDisabled();
const validation = validateDeploymentManifest(manifest);
const credentials = inspectCredentialPresence(process.env);
const policy = operationPolicyRegistryStatus();
const authorizationRepository = authorizationContextRepositoryStatus();
const snapshotPolicies = vaultSnapshotPolicyRegistryStatus();
const rpc = rpcProviderRegistryStatus();
const squads = squadsRegistryStatus();
const symmetry = symmetryAdapterRegistryStatus();
const checks: Check[] = [];
const add = (category: Category, id: string, pass: boolean, detail: string) =>
  checks.push(Object.freeze({ category, id, pass, detail }));

add(
  "INTERNAL_SECURITY_READY",
  "proposed-manifest-valid",
  validation.valid,
  validation.valid
    ? "strict proposed manifest hash is valid"
    : validation.issues.join("; "),
);
add(
  "INTERNAL_SECURITY_READY",
  "execution-fails-closed",
  C3_MAINNET_EXECUTION_CAPABILITY === false &&
    manifest.executionCapability === false,
  "source-controlled Mainnet execution capability is false",
);
add(
  "INTERNAL_SECURITY_READY",
  "sealed-operation-registry",
  policy.executionCapability === false && policy.policyIdentifiers.length > 0,
  "builder resolves policy identifiers from a source-controlled registry",
);
add(
  "EXTERNAL_CONFIGURATION_MISSING",
  "durable-authorization-context-repository",
  authorizationRepository.productionReady,
  "a PostgreSQL foundation exists, but the sealed builder authorization context is still in memory and PostgreSQL integration is unvalidated",
);

if (mode === "builder" || mode === "deployment") {
  add(
    "EXTERNAL_CONFIGURATION_MISSING",
    "reviewed-symmetry-adapter",
    symmetry.productionReady,
    symmetry.reason,
  );
  add(
    "EXTERNAL_CONFIGURATION_MISSING",
    "jupiter-server-credential",
    credentials.jupiter,
    "isolated server credential is not configured",
  );
}

if (mode === "keeper" || mode === "deployment") {
  add(
    "EXTERNAL_CONFIGURATION_MISSING",
    "sealed-vault-snapshot-policy",
    snapshotPolicies.productionReady &&
      snapshotPolicies.configuredPolicyIds.length > 0,
    "no reviewed vault snapshot policy is registered",
  );
  add(
    "EXTERNAL_CONFIGURATION_MISSING",
    "sealed-independent-rpc-registry",
    rpc.productionReady && rpc.configuredRegistryIds.length > 0,
    "two reviewed independent HTTPS providers are not registered",
  );
  add(
    "EXTERNAL_CONFIGURATION_MISSING",
    "pyth-server-credential",
    credentials.pyth,
    "isolated server credential is not configured",
  );
  add(
    "EXTERNAL_CONFIGURATION_MISSING",
    "durable-cas-repository",
    false,
    "the PostgreSQL CAS foundation is not integrated with the keeper or validated against disposable PostgreSQL",
  );
}

if (mode === "deployment") {
  add(
    "EXTERNAL_CONFIGURATION_MISSING",
    "official-squads-deployment",
    squads.enabled,
    squads.reason,
  );
  const bundle = createDeterministicDeploymentBundle(manifest);
  add(
    "INTERNAL_SECURITY_READY",
    "deterministic-unsigned-deployment-bundle",
    /^[a-f0-9]{64}$/.test(bundle.bundleFingerprint) &&
      bundle.steps.length === 19,
    "unsigned deployment ordering is deterministic",
  );
}

add(
  "DEPLOYMENT_NOT_AUTHORIZED",
  "manifest-remains-proposed",
  false,
  "no trusted Security, Governance, or deployment lifecycle transition exists",
);

const internalFailures = checks.filter(
  (check) => check.category === "INTERNAL_SECURITY_READY" && !check.pass,
);
const externalFailures = checks.filter(
  (check) => check.category === "EXTERNAL_CONFIGURATION_MISSING" && !check.pass,
);
const authorizationFailures = checks.filter(
  (check) => check.category === "DEPLOYMENT_NOT_AUTHORIZED" && !check.pass,
);

console.log(
  `INTERNAL_SECURITY_READY: ${internalFailures.length === 0 ? "YES" : "NO"}`,
);
console.log(
  `EXTERNAL_CONFIGURATION_MISSING: ${externalFailures.length > 0 ? "YES" : "NO"}`,
);
console.log(
  `DEPLOYMENT_NOT_AUTHORIZED: ${authorizationFailures.length > 0 ? "YES" : "NO"}`,
);
for (const check of checks)
  console.log(
    `${check.pass ? "PASS" : "FAIL"} ${check.category}/${check.id}: ${check.detail}`,
  );
console.log("Secrets printed: NO");
console.log(
  "Wallet authorization/signing/submission/deployment: NOT PERFORMED",
);
if (
  internalFailures.length > 0 ||
  externalFailures.length > 0 ||
  authorizationFailures.length > 0
)
  process.exitCode = 1;
