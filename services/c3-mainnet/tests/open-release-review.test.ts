import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  inspectOwnerInputs,
  verifyReviewArtifact,
  releaseReview,
} from "../scripts/open-release-review.ts";
import { encodeBase58 } from "../src/solana.ts";
const template = JSON.parse(
  await readFile(
    new URL(
      "../../../submission/c3-owner-inputs.proposed.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const key = (n: number) => encodeBase58(Buffer.alloc(32, n));
const complete = () => ({
  ...structuredClone(template),
  wallet: key(1),
  deploymentPayer: key(1),
  programId: key(2),
  shareMint: key(3),
  upgradeAuthority: key(5),
  governance: {
    address: key(5),
    members: [key(6), key(7), key(8)],
    threshold: 2,
    timelockSeconds: 86400,
  },
  pauseAuthority: key(9),
  keeper: key(10),
  quoteAuthority: key(11),
  infrastructure: {
    hostingProvider: "digitalocean",
    region: "nyc3",
    httpsOrigin: "https://owner.example.org",
    databaseHa: true,
    rpcOperators: ["quicknode", "alchemy"],
    isolatedSignerOrigin: "https://signer.example.org",
  },
  androidCertificateSha256: "a".repeat(64),
  initialSolCeiling: "10.000000000",
  monthlyUsdCeiling: "200.00",
  consumedNetworkFeeCeilingLamports: "50000000",
  priorityFeeCeilingLamports: "10000",
});
test("missing inputs block; complete decisions never create approval", () => {
  assert.equal(inspectOwnerInputs(template).status, "PUBLIC_INPUTS_MISSING");
  const r = inspectOwnerInputs(complete());
  assert.equal(r.missing.length, 0);
  assert.equal(r.status, "INPUTS_COLLECTED_REVIEW_STILL_REQUIRED");
  assert.equal(r.executionAuthorized, false);
  assert.equal(r.providerIndependenceVerified, false);
  assert.equal(r.budgetApproved, false);
});
test("secret fields, wrong roles, duplicate operators and invalid budgets reject without echo", () => {
  const mutations = [
    (v: ReturnType<typeof complete>) =>
      Object.assign(v, { privateKey: "NEVER_ECHO_ME" }),
    (v: ReturnType<typeof complete>) => {
      v.keeper = v.wallet;
    },
    (v: ReturnType<typeof complete>) => {
      v.upgradeAuthority = v.keeper;
    },
    (v: ReturnType<typeof complete>) => {
      v.infrastructure.rpcOperators = ["quicknode", "quicknode"];
    },
    (v: ReturnType<typeof complete>) => {
      v.infrastructure.httpsOrigin = "https://user:NEVER_ECHO_ME@example.org";
    },
    (v: ReturnType<typeof complete>) => {
      v.infrastructure.httpsOrigin = "http://localhost";
    },
    (v: ReturnType<typeof complete>) => {
      v.infrastructure.httpsOrigin = "https://owner..example.org";
    },
    (v: ReturnType<typeof complete>) => {
      v.infrastructure.isolatedSignerOrigin = v.infrastructure.httpsOrigin;
    },
    (v: ReturnType<typeof complete>) => {
      v.governance.members[2] = v.governance.members[0]!;
    },
    (v: ReturnType<typeof complete>) => {
      v.governance.threshold = 1;
    },
    (v: ReturnType<typeof complete>) => {
      v.initialSolCeiling = "1e9";
    },
    (v: ReturnType<typeof complete>) => {
      v.monthlyUsdCeiling = "0";
    },
    (v: ReturnType<typeof complete>) => {
      v.priorityFeeCeilingLamports = "18446744073709551616";
    },
    (v: ReturnType<typeof complete>) => {
      v.wallet = "11111111111111111111111111111111";
    },
  ];
  for (const mutate of mutations) {
    const v = complete();
    mutate(v);
    assert.throws(() => inspectOwnerInputs(v), {
      message: "C3_RELEASE_PUBLIC_INPUT_INVALID",
    });
  }
});
test("every decision changes the review fingerprint, not execution capability", () => {
  const a = complete(),
    b = complete();
  b.initialSolCeiling = "11";
  assert.notEqual(
    inspectOwnerInputs(a).publicInputsHash,
    inspectOwnerInputs(b).publicInputsHash,
  );
  assert.equal(inspectOwnerInputs(b).executionAuthorized, false);
});
test("artifact drift, traversal and symlink escapes fail before acceptance", async () => {
  const root = await mkdtemp(join(tmpdir(), "c3-public-review-"));
  const inside = join(root, "artifacts");
  await mkdir(inside);
  const bytes = Buffer.from("PUBLIC_TEST_ARTIFACT");
  const digest = createHash("sha256").update(bytes).digest("hex");
  await writeFile(join(inside, "valid.so"), bytes);
  await writeFile(join(root, "outside.so"), bytes);
  await symlink(join(root, "outside.so"), join(inside, "escape.so"));
  assert.deepEqual(
    await verifyReviewArtifact(inside, "valid.so", digest),
    bytes,
  );
  await assert.rejects(
    () => verifyReviewArtifact(inside, "valid.so", "0".repeat(64)),
    /HASH_CHANGED/,
  );
  await assert.rejects(
    () => verifyReviewArtifact(inside, "../outside.so", digest),
    /ARTIFACT_PATH/,
  );
  await assert.rejects(
    () => verifyReviewArtifact(inside, "escape.so", digest),
    /ARTIFACT_PATH/,
  );
});
test("full offline review verifies existing artifacts but never reads secret values or approves", async () => {
  const r = await releaseReview();
  assert.equal(r.artifactsVerified, 5);
  assert.equal(r.executionAuthorized, false);
  assert.equal(r.productionExecutionEnabled, false);
  assert.equal(r.newlyGeneratedProgramRequiresSeparateRebuildReview, false);
  assert.equal(r.finalEnabledReleaseRequiresSeparateRebuildReview, true);
  assert.equal(r.ownerWalletControlVerified, false);
  assert.equal(r.ownerWalletEnrolled, false);
  assert.equal(r.proposedInfrastructureSubtotalUsd, "155.80");
  assert.equal(r.affordability, "UNVERIFIED_CAPS_AND_ALL_IN_COSTS_MISSING");
  assert.ok(r.requiredServerEnvironmentNames.includes("DATABASE_URL"));
  const source = await readFile(
    new URL("../scripts/open-release-review.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /process\.env/);
  assert.equal(source.match(/c3-owner-inputs\.proposed\.json/g)?.length, 1);
  assert.equal(
    r.publicInputsHash,
    inspectOwnerInputs(template).publicInputsHash,
  );
  assert.equal(r.proposedProgramIdMatchesCurrentIdl, true);
});
