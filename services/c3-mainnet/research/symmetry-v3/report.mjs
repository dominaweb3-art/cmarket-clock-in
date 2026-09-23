// Deterministic research manifest from committed public fixtures. No network or wallet calls.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decodePublicFixture } from "./decoder.ts";
import { reconcileObservedCandidate } from "./reconcile.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, "../../../..");
const source = JSON.parse(
  readFileSync(
    path.join(
      repo,
      "config/c3/symmetry-v3-production-evidence-candidate.v1.json",
    ),
    "utf8",
  ),
);
const stages = Object.entries(source.publicTransactions);
const decoded = {};
const observations = [];
const allPrograms = new Set();
for (const [stage, signature] of stages) {
  const fixture = JSON.parse(
    readFileSync(path.join(root, "fixtures", `${stage}.json`), "utf8"),
  );
  const tx = decodePublicFixture(fixture, {
    cluster: "mainnet-beta",
    signature,
    symmetryProgram: source.program.id,
  });
  decoded[stage] = tx;
  const instructions = [...tx.outerInstructions, ...tx.innerInstructions];
  for (const ix of instructions) allPrograms.add(ix.programId);
  const symmetry = tx.outerInstructions.filter(
    (ix) => ix.programId === source.program.id,
  );
  const logLabels = tx.logs.filter((line) =>
    line.startsWith("Program log: Instruction: "),
  );
  for (const [position, ix] of symmetry.entries()) {
    observations.push({
      stage,
      signature,
      location: ix.location,
      outerIndex: ix.outerIndex,
      discriminatorHex: ix.discriminatorHex,
      rawInstructionDataSha256: ix.dataSha256,
      rawInstructionDataLength: Buffer.from(ix.dataBase64, "base64").length,
      accountIndexes: ix.accountIndexes,
      accounts: ix.accounts.map((address, index) => {
        const account = tx.staticAccounts.find(
          (item) => item.address === address,
        );
        return {
          address,
          index: ix.accountIndexes[index],
          signer: account?.signer ?? false,
          writable: account?.writable ?? false,
        };
      }),
      observedLog: logLabels[position] ?? null,
      candidateSemanticName:
        logLabels[position]?.replace("Program log: Instruction: ", "") ?? null,
      confidence: "transaction_correlated",
      stageTokenEffects: tx.tokenEffects,
      stageLamportEffects: tx.lamportEffects,
    });
  }
}
const lifecycle = reconcileObservedCandidate(decoded);
const output = {
  schemaVersion: 1,
  classification: "SHARED",
  status: "research",
  cluster: "mainnet-beta",
  programId: source.program.id,
  decision: "NO_GO_EXTERNAL_EVIDENCE_REQUIRED",
  sourceRpcUrls: [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
  ],
  independentProductionQuorumProven: false,
  transactions: stages.map(([stage, signature]) => {
    const f = JSON.parse(
      readFileSync(path.join(root, "fixtures", `${stage}.json`), "utf8"),
    );
    const tx = decoded[stage];
    return {
      stage,
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      retrievedAtUtc: f.retrievedAtUtc,
      primaryResponseSha256: f.responseHash,
      secondaryResponseSha256: f.secondaryResponseHash,
      rawTransactionSha256: f.rawTransactionHash,
      messageSha256: tx.messageHash,
      evidenceFingerprint: tx.fingerprint,
      wireBytes: tx.wireBytes,
      feePayer: tx.feePayer,
      lookupTableCount: tx.lookupTables.length,
      outerInstructionCount: tx.outerInstructions.length,
      innerInstructionCount: tx.innerInstructions.length,
    };
  }),
  observedSymmetryInstructions: observations,
  observedPrograms: [...allPrograms].sort(),
  unclassifiedObservedPrograms: ["L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"],
  sampleLifecycle: lifecycle,
  officialDiscriminatorsVerified: false,
  productionPolicyConfigured: false,
  unresolved: lifecycle.missing,
};
writeFileSync(
  path.join(repo, "config/c3/symmetry-v3-observed-transactions.v1.json"),
  JSON.stringify(output, null, 2) + "\n",
);
process.stdout.write(
  `Research manifest: ${observations.length} observed Symmetry instructions, ${allPrograms.size} programs; C3 USDC-only redemption ${lifecycle.c3UsdcOnlyRedemption}\n`,
);
