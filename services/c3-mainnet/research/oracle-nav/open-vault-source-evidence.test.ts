import assert from "node:assert/strict";
import { test } from "node:test";
import { C3_MAINNET } from "../../src/constants.ts";
import { inspectCatalog, inspectMint } from "./open-vault-source-evidence.ts";
test("symbols cannot certify exact wrapped-asset pricing or oracle independence", () => {
  const r = inspectCatalog([
    { id: "a".repeat(64), attributes: { symbol: "Crypto.CBBTC/USD" } },
    { id: "b".repeat(64), attributes: { symbol: "Crypto.WETH/USD" } },
  ]);
  assert.equal(r.status, "CATALOG_ONLY_NOT_EXACT_MINT_EVIDENCE");
  assert.equal(r.portalNamedFeedFound, false);
  assert.equal(r.economicSourcesVerified, 0);
  assert.throws(() =>
    inspectCatalog([{ id: "wrong", attributes: { symbol: "Crypto.SOL/USD" } }]),
  );
});
test("mint discovery rejects missing / wrong owner / decimals / malformed bytes; WSOL supply zero is valid", () => {
  const bytes = Buffer.alloc(82);
  bytes[44] = 9;
  bytes[45] = 1;
  const raw = {
    owner: C3_MAINNET.tokenProgram,
    executable: false,
    data: [bytes.toString("base64"), "base64"],
  };
  assert.equal(inspectMint(raw, 9).supplyBaseUnits, "0");
  for (const bad of [
    null,
    { ...raw, owner: C3_MAINNET.systemProgram },
    { ...raw, executable: true },
    { ...raw, data: [Buffer.alloc(81).toString("base64"), "base64"] },
  ])
    assert.throws(() => inspectMint(bad, 9));
  assert.throws(() => inspectMint(raw, 6));
});
