import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { inspectOpenPilotBudget } from "../scripts/open-pilot-budget.ts";

const directory = new URL(
  "../../../artifacts/c3-pilot-candidate/2026-10-03-production-factory-disabled/",
  import.meta.url,
);
const [text, binary, idl] = await Promise.all([
  readFile(new URL("public-rent-estimate.json", directory), "utf8"),
  readFile(new URL("c3_pilot_vault-disabled.so", directory)),
  readFile(new URL("c3_pilot_vault-disabled.idl.json", directory)),
]);
const input = () => JSON.parse(text);
test("public artifact budget is reproducible, itemized and never approval", () => {
  const r = inspectOpenPilotBudget(input(), binary, idl);
  assert.equal(r.status, "INCOMPLETE_NOT_APPROVED");
  assert.equal(r.capital.persistentSol, "3.584366720");
  assert.equal(r.capital.recoverableBufferSol, "3.520587320");
  assert.equal(r.capital.measuredPeakSol, "7.104954040");
  assert.equal(r.capital.proposedKnownPeakSol, "7.286983440");
  assert.equal(r.infrastructure.monthlyPublishedSubtotalUsd, "110.80");
  assert.equal(r.budgetApproved, false);
  assert.ok(r.infrastructure.missingCosts.length > 0);
  assert.equal(r.totalBudget.allInTotalUsd, null);
  assert.equal(
    r.totalBudget.status,
    "UNPRICED_COMPONENTS_BLOCK_FINAL_APPROVAL",
  );
  assert.ok(r.totalBudget.recurringFormulaUsd.includes("110.80 +"));
});
test("changed binary/IDL, mixed snapshots, duplicate rows and unsafe arithmetic reject", () => {
  for (const change of [
    (r: ReturnType<typeof input>) => {
      r.binaryHash = "0".repeat(64);
    },
    (r: ReturnType<typeof input>) => {
      r.idlHash = "0".repeat(64);
    },
    (r: ReturnType<typeof input>) => {
      r.persistentRentLamports++;
    },
    (r: ReturnType<typeof input>) => {
      r.accounts.push(r.accounts[0]);
    },
    (r: ReturnType<typeof input>) => {
      r.accounts[0].count = -1;
    },
    (r: ReturnType<typeof input>) => {
      r.accounts[0].count = Number.MAX_SAFE_INTEGER + 1;
    },
    (r: ReturnType<typeof input>) => {
      r.accounts[0].totalLamports++;
    },
    (r: ReturnType<typeof input>) => {
      r.artifactScope = "MAINNET_REVIEWED";
    },
    (r: ReturnType<typeof input>) => {
      r.timestamp = "invalid";
      r.accounts.forEach(
        (a: {
          lamportsPerAccount: number;
          totalLamports: number;
          count: number;
        }) => {
          a.lamportsPerAccount = 1;
          a.totalLamports = a.count;
        },
      );
      r.persistentRentLamports = r.accounts
        .filter((a: { kind: string }) => a.kind !== "transientDeploymentBuffer")
        .reduce((n: number, a: { count: number }) => n + a.count, 0);
      r.transientPeakRentLamports = r.persistentRentLamports + 1;
    },
  ]) {
    const r = input();
    change(r);
    assert.throws(() => inspectOpenPilotBudget(r, binary, idl));
  }
  assert.throws(() => inspectOpenPilotBudget(input(), binary.subarray(1), idl));
  assert.throws(() => inspectOpenPilotBudget(input(), binary, idl.subarray(1)));
});

test("minimum-resolution artifact has its own pinned costs; historical artifacts cannot mix", async () => {
  const current = new URL(
    "../../../artifacts/c3-pilot-candidate/2026-10-05-explicit-minimum-recovery-disabled/",
    import.meta.url,
  );
  const [rent, elf, currentIdl] = await Promise.all([
    readFile(new URL("public-rent-estimate.json", current), "utf8"),
    readFile(new URL("c3_pilot_vault-disabled.so", current)),
    readFile(new URL("c3_pilot_vault-disabled.idl.json", current)),
  ]);
  const result = inspectOpenPilotBudget(JSON.parse(rent), elf, currentIdl);
  assert.equal(result.historicalArtifact, true);
  assert.equal(
    inspectOpenPilotBudget(input(), binary, idl).historicalArtifact,
    true,
  );
  assert.equal(result.capital.persistentSol, "3.414654080");
  assert.equal(result.capital.recoverableBufferSol, "3.350874680");
  assert.equal(result.capital.measuredPeakSol, "6.765528760");
  assert.equal(result.capital.proposedKnownPeakSol, "6.947558160");
  assert.ok(result.totalBudget.upfrontKnownPeak.startsWith("6.947558160 SOL"));
  assert.equal(result.infrastructure.haPairPublishedSubtotalUsd, "155.80");
  assert.equal(result.totalBudget.allInTotalUsd, null);
  assert.throws(() =>
    inspectOpenPilotBudget(JSON.parse(rent), binary, currentIdl),
  );
  assert.throws(() => inspectOpenPilotBudget(JSON.parse(rent), elf, idl));
});

test("identity-aligned artifact has new hash pins; unchanged rent never means approval", async () => {
  const current = new URL(
    "../../../artifacts/c3-pilot-candidate/2026-10-05-program-identity-aligned-disabled/",
    import.meta.url,
  );
  const [rent, elf, currentIdl] = await Promise.all([
    readFile(new URL("public-rent-estimate.json", current), "utf8"),
    readFile(new URL("c3_pilot_vault-disabled.so", current)),
    readFile(new URL("c3_pilot_vault-disabled.idl.json", current)),
  ]);
  const r = inspectOpenPilotBudget(JSON.parse(rent), elf, currentIdl);
  assert.equal(r.historicalArtifact, false);
  assert.equal(r.capital.persistentSol, "3.414654080");
  assert.equal(r.capital.recoverableBufferSol, "3.350874680");
  assert.equal(r.capital.measuredPeakSol, "6.765528760");
  assert.equal(r.totalBudget.allInTotalUsd, null);
  assert.equal(r.budgetApproved, false);
  assert.throws(() => inspectOpenPilotBudget(input(), elf, currentIdl));
});
