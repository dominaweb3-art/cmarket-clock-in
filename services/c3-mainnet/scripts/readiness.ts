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
import {
  validateDeploymentManifest,
  type C3DeploymentManifest,
} from "../src/manifest.ts";

type Check = Readonly<{ id: string; pass: boolean; detail: string }>;

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
if (!["builder", "keeper", "deployment"].includes(mode ?? ""))
  throw new Error("Readiness mode must be builder, keeper, or deployment.");
assertExecutionDisabled();
const validation = validateDeploymentManifest(manifest);
const credentials = inspectCredentialPresence(process.env);
const root = manifest as Record<string, unknown>;
const approvals = root.approvals as Record<string, unknown>;
const assets = root.assets as Record<string, Record<string, unknown>>;
const routes = root.routes as Record<string, unknown>;
const authorities = root.authorities as Record<string, unknown>;
const squads = root.squads as Record<string, unknown>;
const checks: Check[] = [];
const add = (id: string, pass: boolean, detail: string) =>
  checks.push(Object.freeze({ id, pass, detail }));

add(
  "manifest-schema-and-hash",
  validation.valid,
  validation.valid
    ? "strict manifest and hash are valid"
    : validation.issues.join("; "),
);
add(
  "execution-disabled",
  C3_MAINNET_EXECUTION_CAPABILITY === false &&
    root.executionCapability === false,
  "source-controlled execution capability must be false",
);

if (mode === "builder" || mode === "deployment") {
  add(
    "manifest-verified",
    root.status === "verified" ||
      root.status === "security_approved" ||
      root.status === "governance_approved" ||
      root.status === "deployment_ready",
    "proposed manifest is not execution evidence",
  );
  add(
    "assets-verified",
    Object.values(assets).every((asset) => asset.status === "verified"),
    "all candidate assets need current evidence approval",
  );
  add(
    "route-registry-verified",
    routes.registryStatus === "verified" &&
      approvals.routeRegistryApproved === true,
    "route programs must be independently reviewed",
  );
  add(
    "jupiter-credential-present",
    credentials.jupiter,
    "server-only Jupiter credential must exist in isolated runtime",
  );
  add(
    "instruction-security-approved",
    approvals.securityApproved === true,
    "decoded instruction builder requires independent Security approval",
  );
}

if (mode === "keeper" || mode === "deployment") {
  add(
    "pyth-credential-present",
    credentials.pyth,
    "server-only Pyth credential must exist in isolated runtime",
  );
  add(
    "oracle-evidence-approved",
    approvals.oracleEvidenceApproved === true,
    "oracle feeds and policies need current evidence approval",
  );
  add(
    "independent-rpc-boundary",
    credentials.rpcPrimary &&
      credentials.rpcSecondary &&
      credentials.rpcOperatorsIndependent,
    "two distinct reviewed HTTPS RPC operators are mandatory",
  );
  add(
    "keeper-authority",
    typeof authorities.keeper === "string",
    "least-privileged keeper public authority is unresolved",
  );
}

if (mode === "deployment") {
  const members = squads.memberAddresses;
  add(
    "three-squads-members",
    Array.isArray(members) &&
      members.length === 3 &&
      members.every((member) => typeof member === "string"),
    "three real public member addresses are required",
  );
  add(
    "squads-policy",
    squads.threshold === 2 &&
      squads.spendingLimitsConfigured === true &&
      squads.destinationAllowlistConfigured === true,
    "2-of-3, limits, and destination allowlist are mandatory",
  );
  add(
    "authorities-resolved",
    Object.values(authorities).every(
      (authority) => typeof authority === "string",
    ),
    "vault and separated public authorities are unresolved",
  );
  add(
    "security-approval",
    approvals.securityApproved === true,
    "Security approval is absent",
  );
  add(
    "governance-approval",
    approvals.governanceApproved === true,
    "Governance approval is absent",
  );
  add(
    "seed-capital-review",
    approvals.seedCapitalReviewed === true,
    "seed-capital decision is not reviewed",
  );
  const bundle = createDeterministicDeploymentBundle(manifest);
  add(
    "deterministic-bundle",
    /^[a-f0-9]{64}$/.test(bundle.bundleFingerprint) &&
      bundle.steps.length === 19,
    "deterministic unsigned deployment order must be complete",
  );
}

const blockers = checks.filter((check) => !check.pass);
console.log(
  `C3 Mainnet ${mode} readiness: ${blockers.length === 0 ? "READY-BUT-DISABLED" : "NO-GO"}`,
);
for (const check of checks)
  console.log(`${check.pass ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
if (validation.missingPublicInputs.length > 0)
  console.log(
    `Missing public inputs: ${validation.missingPublicInputs.join(", ")}`,
  );
console.log("Secrets printed: NO");
console.log(
  "Wallet authorization/signing/submission/deployment: NOT PERFORMED",
);
if (blockers.length > 0) process.exitCode = 1;
