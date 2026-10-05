import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import { VAULT_PROGRAM, VAULT_AUTHORITY } from "../src/open-v0-envelope.ts";
import {
  verifyProgramIdentity,
  verifyOwnerWalletProposal,
} from "../scripts/open-release-review.ts";
import { C3_MAINNET_EXECUTION_CAPABILITY } from "../src/constants.ts";
import { APPROVED_OPEN_PRODUCTION_POLICY } from "../src/open-production-policy.ts";

const root = new URL("../../../", import.meta.url);
const read = (p: string) => readFile(new URL(p, root));
const json = async (p: string) => JSON.parse((await read(p)).toString());
const m = await json("submission/c3-mainnet-pilot-candidate.json");
const identities = await json("submission/c3-public-identities.json");
const proposal = await json("submission/c3-owner-inputs.proposed.json");
const directory = m.artifactDirectory + "/";
const [idl, elf, rust, anchor] = await Promise.all([
  read(directory + m.program.idlFile),
  read(directory + m.program.file),
  read("programs/c3-pilot-vault/programs/c3_pilot_vault/src/lib.rs"),
  read("programs/c3-pilot-vault/Anchor.toml"),
]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

test("candidate ID is coherent across source, IDL, ELF, diagnostic PDA and backend archive", () => {
  assert.equal(proposal.programId, identities.programId);
  assert.equal(m.program.declaredLocalUnapprovedId, proposal.programId);
  assert.equal(VAULT_PROGRAM.toBase58(), proposal.programId);
  assert.equal(sha(elf), m.program.sha256);
  assert.equal(sha(idl), m.program.idlSha256);
  assert.equal(
    verifyProgramIdentity(
      proposal.programId,
      idl,
      elf,
      rust.toString(),
      anchor.toString(),
    ).deploymentApproved,
    false,
  );
  assert.equal(
    VAULT_AUTHORITY.toBase58(),
    PublicKey.findProgramAddressSync(
      [Buffer.from("c3-authority-v1")],
      new PublicKey(proposal.programId),
    )[0].toBase58(),
  );
  const packedIdl = execFileSync("tar", [
    "-xOf",
    fileURLToPath(new URL(directory + m.backend.file, root)),
    "package/resources/c3_pilot_vault.json",
  ]);
  assert.equal(sha(packedIdl), m.program.idlSha256);
  assert.equal(JSON.parse(packedIdl.toString()).address, proposal.programId);
  const archive = fileURLToPath(new URL(directory + m.backend.file, root));
  const names = execFileSync("tar", ["-tzf", archive])
    .toString()
    .trim()
    .split("\n");
  assert.equal(
    names.filter((v) =>
      /^package\/pilot-open-local\/migrations\/[0-9]+.*\.sql$/.test(v),
    ).length,
    14,
  );
  assert.ok(names.includes("package/dist/open-owner-enrollment.js"));
  assert.ok(
    !names.some(
      (v) =>
        /\/(?:tests|research)\//.test(v) || /\.env|keypair|\.apk|\.so$/.test(v),
    ),
  );
  const packedProof = execFileSync("tar", [
    "-xOf",
    archive,
    "package/dist/open-owner-enrollment.js",
  ]).toString();
  assert.match(packedProof, /readOpenEnrollmentAccounts/);
  assert.match(packedProof, /enrollmentRequestMessage/);
  assert.match(packedProof, /C3_OWNER_ENROLLMENT_REQUEST_SIGNATURE_REQUIRED/);
  assert.match(packedProof, /C3_OWNER_ENROLLMENT_RPC_LIMIT/);
  assert.ok(
    JSON.parse(idl.toString()).instructions.every(
      (v: { name: string }) => !/mock|probe/.test(v.name),
    ),
  );
  for (const marker of [
    "MOCK_LOCAL_ONLY",
    "local_jupiter_probe",
    "c3-ordered-fork-v1",
  ])
    assert.equal(elf.includes(Buffer.from(marker)), false);
});

test("old or substituted identity cannot pass current package review", () => {
  const old = "AFVCPVUExRgftDsE88NUewCnFyG3gRpEmkUiAdzs5qhb";
  assert.equal(elf.includes(Buffer.from(new PublicKey(old).toBytes())), false);
  for (const args of [
    [old, idl, elf, rust.toString(), anchor.toString()],
    [
      proposal.programId,
      Buffer.from(JSON.stringify({ address: old })),
      elf,
      rust.toString(),
      anchor.toString(),
    ],
    [
      proposal.programId,
      idl,
      new Uint8Array(16),
      rust.toString(),
      anchor.toString(),
    ],
    [
      proposal.programId,
      idl,
      elf,
      rust.toString().replace(proposal.programId, old),
      anchor.toString(),
    ],
    [
      proposal.programId,
      idl,
      elf,
      rust.toString(),
      anchor.toString().replace(proposal.programId, old),
    ],
  ] as const)
    assert.throws(
      () => verifyProgramIdentity(args[0], args[1], args[2], args[3], args[4]),
      /IDENTITY_MISMATCH/,
    );
});

test("IDL economics are unchanged; prior local-cycle evidence is not relabelled", async () => {
  const priorIdl = await json(
    m.preservedPreviousArtifactDirectory + "/c3_pilot_vault-disabled.idl.json",
  );
  const current = JSON.parse(idl.toString());
  function normalize(v: unknown, id: string): unknown {
    if (v === id) return "PROGRAM_ID";
    if (Array.isArray(v)) {
      if (
        JSON.stringify(v) === JSON.stringify([...new PublicKey(id).toBytes()])
      )
        return "PROGRAM_BYTES";
      return v.map((item) => normalize(item, id));
    }
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([key, value]) => [key, normalize(value, id)]),
      );
    return v;
  }
  assert.deepEqual(
    normalize(current, current.address),
    normalize(priorIdl, priorIdl.address),
  );
  assert.equal(m.localCycleEvidence.programId, priorIdl.address);
  assert.equal(m.localCycleEvidence.mainnetAcquisition, false);
  assert.notEqual(priorIdl.address, current.address);
  const priorApk = await read(
    m.preservedPreviousArtifactDirectory + "/" + m.apk.file,
  );
  assert.equal(sha(priorApk), m.apk.sha256);
  assert.equal(sha(await read(directory + m.apk.file)), m.apk.sha256);
});

test("owner address format is valid but never implies control, enrollment or other authority", async () => {
  const owner = await json("submission/c3-owner-wallet.proposed.json");
  const key = new PublicKey(owner.wallet);
  assert.equal(key.toBase58(), owner.wallet);
  assert.equal(key.toBytes().length, 32);
  assert.equal(PublicKey.isOnCurve(key.toBytes()), true);
  assert.equal(proposal.wallet, owner.wallet);
  assert.equal(owner.enrolled, false);
  assert.equal(owner.mwaControlProof, "UNVERIFIED");
  assert.equal(owner.approvedWallet, null);
  assert.equal(owner.otherRolesAssigned, false);
  assert.equal(proposal.upgradeAuthority, null);
  assert.equal(proposal.governance.address, null);
  assert.notEqual(proposal.deploymentPayer, owner.wallet);
  assert.equal(proposal.initialSolCeiling, null);
  assert.equal(proposal.monthlyUsdCeiling, null);
  assert.equal(m.policy.approvedWallet, null);
  assert.equal(C3_MAINNET_EXECUTION_CAPABILITY, false);
  assert.equal(APPROVED_OPEN_PRODUCTION_POLICY, null);
  assert.equal(m.gates.deploymentAuthorized, false);
  assert.equal(
    verifyOwnerWalletProposal(proposal.wallet, owner).controlVerified,
    false,
  );
  assert.throws(
    () => verifyOwnerWalletProposal(owner.supersededLocalOwnerCandidate, owner),
    /PROPOSAL_MISMATCH/,
  );
  assert.throws(
    () => verifyOwnerWalletProposal(owner.wallet, { ...owner, enrolled: true }),
    /PROPOSAL_MISMATCH/,
  );
});
