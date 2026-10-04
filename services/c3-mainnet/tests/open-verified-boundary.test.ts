import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import type { Pool } from "pg";
import type { Connection } from "@solana/web3.js";
import { C3_MAINNET as c } from "../src/constants.ts";
import { VerifiedOpenRecordSigner } from "../src/open-record-signer.ts";
import { VerifiedSettlementJournal } from "../src/open-settlement-journal.ts";
import {
  isolatedLegFactory,
  captureProductionLeg,
  type SettlementServerPolicy,
} from "../src/open-leg-factory.ts";
import { prepareProductionVerifiedLeg } from "../src/open-leg-authorization.ts";
import { productionQuorumConnection } from "../src/open-quorum-connection.ts";
import { verifyProductionVaultArtifact } from "../src/open-vault-artifact.ts";
import { reconcileVerifiedOpenLeg } from "../src/open-leg-reconciler.ts";
import { prepareProductionNextSettlement } from "../src/open-settlement-service.ts";
test("production source imports no clone, fixture or pilot-open-local implementation", () => {
  const directory = new URL("../src/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) =>
    name.endsWith(".ts"),
  )) {
    const source = readFileSync(new URL(file, directory), "utf8");
    // Reviewed additive SQL resources may retain historical paths. Functional
    // imports (including dynamic imports/requires) must never depend on tests.
    const imports = [
      ...source.matchAll(
        /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()(["'])([^"']+)\1/g,
      ),
    ];
    for (const entry of imports)
      assert.doesNotMatch(
        entry[2]!,
        /pilot-open-local|tests\/|clone-bank|isolated-test-signer/,
        file,
      );
    assert.doesNotMatch(source, /\bKeypair\.generate\s*\(/, file);
  }
});
test("all Mainnet record/factory/reconciliation entrypoints gate before caller ports", async () => {
  let calls = 0;
  const forbidden = async () => {
    calls++;
    throw Error("UNEXPECTED_IO");
  };
  const pool = { query: forbidden, connect: forbidden } as unknown as Pool;
  const provider = {
    publicKey: new Uint8Array(32),
    signIdempotently: forbidden,
    lookupSignature: forbidden,
  };
  const fake = {} as SettlementServerPolicy;
  assert.throws(
    () =>
      new VerifiedOpenRecordSigner(
        pool,
        provider,
        fake,
        c.genesisHash,
        "MAINNET_REVIEWED",
      ),
    /NOT_APPROVED/,
  );
  assert.throws(
    () =>
      new VerifiedOpenRecordSigner(
        pool,
        provider,
        fake,
        c.genesisHash,
        "ISOLATED_VERIFIED",
      ),
    /REJECTED/,
  );
  assert.throws(
    () => isolatedLegFactory(pool, fake, { read: forbidden }, c.genesisHash),
    /ISOLATED_MAINNET_FORBIDDEN/,
  );
  assert.throws(
    () => productionQuorumConnection(forbidden as typeof fetch),
    /NOT_APPROVED/,
  );
  await assert.rejects(
    () => verifyProductionVaultArtifact({ read: forbidden }),
    /NOT_APPROVED/,
  );
  await assert.rejects(
    () => captureProductionLeg(pool, "a", 0, 0n),
    /NOT_APPROVED/,
  );
  await assert.rejects(
    () =>
      prepareProductionVerifiedLeg(pool, provider, {
        intentId: "a",
        ordinal: 0,
        expectedRevision: 0n,
      }),
    /NOT_APPROVED/,
  );
  await assert.rejects(
    () =>
      new VerifiedSettlementJournal(pool).reconcile(
        {
          intentId: "a",
          wallet: "a",
          vault: "a",
          expectedDbRevision: 0n,
          expectedChainRevision: 0n,
          idempotencyHash: "a",
        },
        0,
        {} as Connection,
        "MAINNET_REVIEWED",
        c.genesisHash,
      ),
    /NOT_APPROVED/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () =>
      reconcileVerifiedOpenLeg(
        pool,
        {} as Connection,
        "a",
        0,
        "MAINNET_REVIEWED",
        c.genesisHash,
      ),
    /NOT_APPROVED/,
  );
  await assert.rejects(
    () =>
      reconcileVerifiedOpenLeg(
        pool,
        {} as Connection,
        "a",
        0,
        "ISOLATED_VERIFIED",
        c.genesisHash,
      ),
    /PRODUCTION_SCOPE/,
  );
  await assert.rejects(
    () => prepareProductionNextSettlement(pool, provider, "a", 0n),
    /NOT_APPROVED/,
  );
  assert.equal(calls, 0);
});
