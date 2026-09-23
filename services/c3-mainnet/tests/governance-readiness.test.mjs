import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  loadCandidate,
  missingReadinessInputs,
  validateGovernanceCandidate,
  AUTHORITY_IDS,
  TIMELOCK_ACTIONS,
  PILOT_LIMITS,
} from "../scripts/governance-policy.mjs";

const mutate = (change) => {
  const value = structuredClone(loadCandidate());
  change(value);
  return value;
};
const rejects = (change, pattern) =>
  assert.throws(() => validateGovernanceCandidate(mutate(change)), pattern);

test("candidate and JSON schema parse, are disabled, and enumerate every policy dimension", () => {
  const candidate = loadCandidate();
  const schema = JSON.parse(
    readFileSync(
      new URL(
        "../../../config/c3/c3-governance-candidate.schema.v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(validateGovernanceCandidate(candidate), true);
  assert.equal(schema.properties.status.const, "candidate_disabled");
  assert.equal(schema.properties.mainnetExecutionEnabled.const, false);
  assert.equal(schema.properties.squads.properties.threshold.const, 2);
  assert.deepEqual(
    schema.properties.pilot.properties.limits.required.sort(),
    [...PILOT_LIMITS].sort(),
  );
  assert.deepEqual(
    candidate.authorities.map((item) => item.id).sort(),
    [...AUTHORITY_IDS].sort(),
  );
  assert.deepEqual(
    candidate.timelocks.map((item) => item.action).sort(),
    [...TIMELOCK_ACTIONS].sort(),
  );
  assert.equal(candidate.squads.spendingLimitsEnabled, false);
  assert.equal(
    candidate.timelockImplementation,
    "unverified_global_lock_cannot_enforce_per_action_matrix",
  );
});

test("readiness command gives expected NO-GO and complete missing-input list", () => {
  const missing = missingReadinessInputs(loadCandidate());
  assert.deepEqual(missing, [
    "three distinct member public addresses",
    "Project Manager approval",
    "Security approval",
    "official Symmetry authority mapping",
    "verified Squads deployment",
    "approved and enforceable timelocks",
    "approved pilot limits",
    "approved fee policy",
    "vault and share mint",
    "deployment evidence",
  ]);
  const run = spawnSync("node", ["scripts/governance-readiness.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.match(run.stdout, /NO-GO/);
  for (const item of missing) assert.ok(run.stdout.includes(item));
});

test("member count, duplicate and fake keys fail closed", () => {
  rejects((v) => v.squads.members.pop(), /exactly three/);
  rejects((v) => {
    v.squads.members[0].status = "configured";
    v.squads.members[0].address = "NotARealPublicKey";
  }, /valid 32-byte/);
  rejects((v) => {
    for (const m of v.squads.members) {
      m.status = "configured";
      m.address = "11111111111111111111111111111111";
    }
  }, /duplicate/);
  rejects((v) => {
    v.squads.members[0].status = "configured";
    v.squads.members[0].address = "11111111111111111111111111111111";
  }, /all three/);
  const candidate = mutate((v) => {
    const keys = [
      "11111111111111111111111111111111",
      "So11111111111111111111111111111111111111112",
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    ];
    v.squads.members.forEach((member, index) => {
      member.status = "configured";
      member.address = keys[index];
    });
  });
  assert.equal(validateGovernanceCandidate(candidate), true);
  assert.ok(
    !missingReadinessInputs(candidate).includes(
      "three distinct member public addresses",
    ),
  );
});

test("threshold, member bypass, destination and unknown authority fail closed", () => {
  rejects((v) => {
    v.squads.threshold = 1;
  }, /threshold/);
  rejects((v) => {
    v.squads.spendingLimitsEnabled = true;
  }, /spendingLimitsEnabled/);
  rejects((v) => {
    v.squads.configurationAuthority = "single_member";
  }, /configurationAuthority/);
  rejects((v) => {
    v.authorities[0].permittedDestinations.push(
      "11111111111111111111111111111111",
    );
  }, /destinations/);
  rejects((v) => v.authorities.pop(), /incomplete/);
  rejects((v) => {
    v.authorities[0].symmetryMappingStatus = "verified";
  }, /symmetryMappingStatus/);
  rejects((v) => {
    v.authorities.find((entry) => entry.id === "treasury").timelockClass =
      "emergency_pause";
  }, /timelockClass/);
});

test("allocation and pilot completeness are immutable candidate values", () => {
  rejects((v) => {
    v.allocationBps.BTC = 3999;
  }, /allocationBps.BTC/);
  rejects((v) => {
    v.pilot.limits.minimumSupervisedPurchase.recommendation = 0;
  }, /recommendation/);
  rejects((v) => {
    delete v.pilot.limits.maximumAggregateTvl;
  }, /missing or unexpected/);
  rejects((v) => {
    v.pilot.limits.maximumSlippage.status = "approved";
  }, /status/);
  rejects((v) => {
    v.pilot.limits.maximumAggregateTvl.recommendation = 1000;
  }, /recommendation/);
  rejects((v) => {
    v.pilot.allowlistedWallets.push("11111111111111111111111111111111");
  }, /allowlist/);
});

test("timelock matrix is complete; unpause cannot be immediate or approved", () => {
  rejects((v) => v.timelocks.pop(), /incomplete/);
  rejects((v) => {
    v.timelocks.find(
      (t) => t.action === "emergency_unpause",
    ).candidateDelaySeconds = 0;
  }, /unpause/);
  rejects((v) => {
    v.timelocks[0].status = "approved";
  }, /status/);
  rejects((v) => {
    v.timelocks.find(
      (t) => t.action === "treasury_transfer",
    ).candidateDelaySeconds = 0;
  }, /candidateDelaySeconds/);
  rejects((v) => {
    v.timelockImplementation = "native_per_action";
  }, /timelockImplementation/);
});

test("fee, deployment, fake evidence, secret fields and transaction payloads fail closed", () => {
  rejects((v) => {
    v.fees.collectionEnabled = true;
  }, /collectionEnabled/);
  rejects((v) => {
    v.fees.approvalReferences.security = "unverified-approval";
  }, /approvalReferences/);
  rejects((v) => {
    v.deployment.approved = true;
  }, /approved/);
  rejects((v) => {
    v.deployment.vaultDeploymentSignature = "fabricated";
  }, /vaultDeploymentSignature/);
  rejects((v) => {
    v.mainnetExecutionEnabled = true;
  }, /mainnetExecutionEnabled/);
  rejects((v) => {
    v.privateKey = "synthetic-test-value";
  }, /prohibited/);
  rejects((v) => {
    v.pilot.transactionPayload = "synthetic-test-value";
  }, /prohibited/);
  rejects((v) => {
    v.authorities[0].responsibility =
      "-----BEGIN PRIVATE KEY----- synthetic test only";
  }, /private material/);
  rejects((v) => {
    v.unexpected = true;
  }, /missing or unexpected/);
});

test("candidate remains outside service exports and mobile imports", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(pkg.exports), ["."]);
  assert.deepEqual(pkg.files, ["dist", "migrations"]);
  const build = JSON.parse(
    readFileSync(new URL("../tsconfig.build.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(build.include, ["src/**/*.ts"]);
  const mobile = new URL("../../../apps/mobile/", import.meta.url);
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (["node_modules", ".expo", "android", "dist"].includes(entry.name))
        return [];
      const next = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      return entry.isDirectory()
        ? walk(next)
        : /\.[cm]?[jt]sx?$/.test(entry.name)
          ? [next]
          : [];
    });
  for (const file of walk(mobile))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /c3-governance-candidate|governance-policy\.mjs/,
    );
  for (const file of walk(new URL("../src/", import.meta.url)))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /c3-governance-candidate|governance-policy\.mjs/,
    );
});
