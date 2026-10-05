/** Offline preparation only. No credential reads, wallet, network, transaction
 * construction, signing, submission, service provisioning or approval writes.
 * Human decisions never turn the immutable execution gate into an env flag. */
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { publicKeyBytes } from "../src/solana.ts";
import { canonicalize } from "../src/manifest.ts";
import { C3_MAINNET_EXECUTION_CAPABILITY } from "../src/constants.ts";
import { APPROVED_OPEN_PRODUCTION_POLICY } from "../src/open-production-policy.ts";
import { inspectOpenPilotBudget } from "./open-pilot-budget.ts";

const fail = (): never => {
  throw Error("C3_RELEASE_PUBLIC_INPUT_INVALID");
};
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join() !== [...keys].sort().join()) return fail();
  return o;
}
const TOP = [
  "schema",
  "wallet",
  "deploymentPayer",
  "programId",
  "shareMint",
  "upgradeAuthority",
  "governance",
  "pauseAuthority",
  "keeper",
  "quoteAuthority",
  "operationalKeyGenerationAuthorized",
  "infrastructure",
  "androidCertificateSha256",
  "initialSolCeiling",
  "monthlyUsdCeiling",
  "consumedNetworkFeeCeilingLamports",
  "priorityFeeCeilingLamports",
];
export function inspectOwnerInputs(value: unknown) {
  const input = object(value, TOP),
    missing: string[] = [];
  if (input.schema !== "c3-owner-inputs/v1") return fail();
  const key = (v: unknown, field: string): string | null => {
    if (v === null) {
      missing.push(field);
      return null;
    }
    if (typeof v !== "string" || v.length > 44) return fail();
    try {
      const bytes = publicKeyBytes(v);
      if (bytes.every((b) => b === 0)) return fail();
    } catch {
      return fail();
    }
    return v;
  };
  const keys = new Map<string, string | null>();
  for (const field of [
    "wallet",
    "deploymentPayer",
    "programId",
    "shareMint",
    "upgradeAuthority",
    "pauseAuthority",
    "keeper",
    "quoteAuthority",
  ])
    keys.set(field, key(input[field], field));
  const gov = object(input.governance, [
    "address",
    "members",
    "threshold",
    "timelockSeconds",
  ]);
  const governance = key(gov.address, "governance.address");
  if (
    governance &&
    keys.get("upgradeAuthority") &&
    keys.get("upgradeAuthority") !== governance
  )
    return fail(); // reviewed update authority must be the selected governance vault
  if (!Array.isArray(gov.members) || gov.members.length > 3) return fail();
  if (gov.members.length !== 3) missing.push("governance.threeRealMembers");
  const members = gov.members.map((v) => key(v, "governance.member"));
  if (new Set(members).size !== members.length) return fail();
  if (gov.threshold === null) missing.push("governance.threshold");
  else if (gov.threshold !== 2) return fail();
  if (gov.timelockSeconds === null) missing.push("governance.timelockSeconds");
  else if (
    !Number.isSafeInteger(gov.timelockSeconds) ||
    Number(gov.timelockSeconds) < 86400
  )
    return fail();
  // A repeated identity cannot masquerade as independent custody roles.
  const roles = [
    keys.get("wallet"),
    governance,
    keys.get("keeper"),
    keys.get("quoteAuthority"),
    keys.get("pauseAuthority"),
  ].filter((v) => v !== null);
  if (new Set(roles).size !== roles.length) return fail();
  if (typeof input.operationalKeyGenerationAuthorized !== "boolean")
    return fail();
  // Permission to create operational keys is NOT permission to deploy or spend.
  const infra = object(input.infrastructure, [
    "hostingProvider",
    "region",
    "httpsOrigin",
    "databaseHa",
    "rpcOperators",
    "isolatedSignerOrigin",
  ]);
  for (const field of ["hostingProvider", "region"]) {
    const v = infra[field];
    if (v === null) missing.push("infrastructure." + field);
    else if (typeof v !== "string" || !/^[a-zA-Z0-9-]{2,64}$/.test(v))
      return fail();
  }
  const origin = (v: unknown, field: string) => {
    if (v === null) {
      missing.push(field);
      return null;
    }
    if (typeof v !== "string" || v.length > 254) return fail();
    try {
      const u = new URL(v);
      if (
        u.protocol !== "https:" ||
        u.username ||
        u.password ||
        u.search ||
        u.hash ||
        u.pathname !== "/" ||
        !["", "443"].includes(u.port) ||
        !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname) ||
        u.hostname.endsWith(".localhost") ||
        u.hostname.endsWith(".local") ||
        u.hostname
          .split(".")
          .some(
            (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
          )
      )
        return fail();
      return u.origin;
    } catch {
      return fail();
    }
  };
  const ownerOrigin = origin(infra.httpsOrigin, "infrastructure.httpsOrigin");
  const signerOrigin = origin(
    infra.isolatedSignerOrigin,
    "infrastructure.isolatedSignerOrigin",
  );
  if (ownerOrigin && ownerOrigin === signerOrigin) return fail();
  if (infra.databaseHa === null) missing.push("infrastructure.databaseHa");
  else if (typeof infra.databaseHa !== "boolean") return fail();
  if (!Array.isArray(infra.rpcOperators) || infra.rpcOperators.length > 2)
    return fail();
  if (infra.rpcOperators.length !== 2)
    missing.push("infrastructure.twoIndependentRpcOperators");
  if (
    infra.rpcOperators.some(
      (v) => typeof v !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(v),
    ) ||
    new Set(infra.rpcOperators).size !== infra.rpcOperators.length
  )
    return fail();
  if (input.androidCertificateSha256 === null)
    missing.push("androidCertificateSha256");
  else if (
    typeof input.androidCertificateSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.androidCertificateSha256) ||
    input.androidCertificateSha256 === "0".repeat(64)
  )
    return fail();
  for (const [field, places] of [
    ["initialSolCeiling", 9],
    ["monthlyUsdCeiling", 2],
  ] as const) {
    const v = input[field];
    if (v === null) missing.push(field);
    else if (
      typeof v !== "string" ||
      !new RegExp(`^(0|[1-9][0-9]{0,5})(\\.[0-9]{1,${places}})?$`).test(v) ||
      !/[1-9]/.test(v)
    )
      return fail();
  }
  for (const field of [
    "consumedNetworkFeeCeilingLamports",
    "priorityFeeCeilingLamports",
  ]) {
    const v = input[field];
    if (v === null) missing.push(field);
    else if (
      typeof v !== "string" ||
      !/^(0|[1-9][0-9]{0,18})$/.test(v) ||
      BigInt(v) > 18446744073709551615n
    )
      return fail();
  }
  return Object.freeze({
    status: missing.length
      ? "PUBLIC_INPUTS_MISSING"
      : "INPUTS_COLLECTED_REVIEW_STILL_REQUIRED",
    missing: Object.freeze(missing),
    publicInputsHash: createHash("sha256")
      .update(canonicalize(input))
      .digest("hex"),
    executionAuthorized: false,
    independentlyVerifiedAuthorities: false,
    providerIndependenceVerified: false,
    budgetApproved: false,
  });
}

export async function verifyReviewArtifact(
  directory: string,
  name: string,
  digest: string,
) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(digest))
    throw Error("C3_RELEASE_ARTIFACT_PATH");
  const canonicalDirectory = await realpath(directory);
  const p = await realpath(resolve(canonicalDirectory, name));
  if (!p.startsWith(canonicalDirectory + sep))
    throw Error("C3_RELEASE_ARTIFACT_PATH");
  const b = await readFile(p);
  if (createHash("sha256").update(b).digest("hex") !== digest)
    throw Error("C3_RELEASE_ARTIFACT_HASH_CHANGED");
  return b;
}
export async function releaseReview() {
  if (C3_MAINNET_EXECUTION_CAPABILITY || APPROVED_OPEN_PRODUCTION_POLICY)
    throw Error("C3_RELEASE_REVIEW_DISABLED_ARTIFACT_REQUIRED");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const branch = execFileSync("git", ["branch", "--show-current"], {
    cwd: root,
  })
    .toString()
    .trim();
  if (branch !== "feature/c3-open-pilot-vault")
    throw Error("C3_RELEASE_REVIEW_WORKSPACE_MISMATCH");
  const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root })
    .toString()
    .trim();
  const publicInputs = JSON.parse(
    await readFile(
      resolve(root, "submission/c3-owner-inputs.proposed.json"),
      "utf8",
    ),
  );
  const inputs = inspectOwnerInputs(publicInputs);
  const m = JSON.parse(
    await readFile(
      resolve(root, "submission/c3-mainnet-pilot-candidate.json"),
      "utf8",
    ),
  );
  const directory = await realpath(resolve(root, m.artifactDirectory));
  const allowedRoot = await realpath(
    resolve(root, "artifacts/c3-pilot-candidate"),
  );
  if (!directory.startsWith(allowedRoot + sep))
    throw Error("C3_RELEASE_ARTIFACT_PATH");
  const expected = [
    ["c3_pilot_vault-disabled.so", m.program.sha256],
    ["c3_pilot_vault-disabled.idl.json", m.program.idlSha256],
    ["c-market-c3-mainnet-candidate-0.1.0-disabled-delivery.apk", m.apk.sha256],
    ["cmarket-c3-mainnet-services-0.1.0.tgz", m.backend.sha256],
    ["public-rent-estimate.json", m.costEvidence.sha256],
  ];
  const files = new Map<string, Buffer>();
  for (const [name, digest] of expected) {
    files.set(name, await verifyReviewArtifact(directory, name, digest));
  }
  const budget = inspectOpenPilotBudget(
    JSON.parse(files.get("public-rent-estimate.json")!.toString()),
    files.get("c3_pilot_vault-disabled.so")!,
    files.get("c3_pilot_vault-disabled.idl.json")!,
  );
  return {
    sourceHead,
    branch,
    artifactsVerified: 5,
    ...inputs,
    knownCapital: budget.capital,
    deploymentBlockers: [
      "PUBLIC_AUTHORITY_ONCHAIN_VERIFICATION",
      "INDEPENDENT_RPC_ENROLLMENT",
      "ISOLATED_SIGNER_PROVISIONING",
      "HTTPS_DATABASE_TLS_AND_RESTORE_VERIFICATION",
      "COMPLETE_COST_AND_SPENDING_CAP_REVIEW",
      "SECURITY_GOVERNANCE_AND_OWNER_PACKAGE_APPROVAL",
      "REVIEWED_ENABLED_BINARY_AND_APK_HASHES",
      "PHYSICAL_MWA_ACCEPTANCE",
    ],
    requiredServerEnvironmentNames: JSON.parse(
      await readFile(
        resolve(root, "services/c3-mainnet/server-environment.example.json"),
        "utf8",
      ),
    ).variables.map((v: { name: string }) => v.name),
    proposedProgramIdMatchesCurrentIdl:
      JSON.parse(files.get("c3_pilot_vault-disabled.idl.json")!.toString())
        .address === publicInputs.programId,
    newlyGeneratedProgramRequiresSeparateRebuildReview: true,
    noSecretsReadOrPrinted: true,
    productionExecutionEnabled: false,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  releaseReview()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exitCode = 2; // even complete owner input cannot approve deployment
    })
    .catch(() => {
      console.error("C3_RELEASE_REVIEW_FAILED_NO_VALUES_PRINTED");
      process.exitCode = 2;
    });
}
