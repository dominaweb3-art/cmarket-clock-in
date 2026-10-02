import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PublicKey } from "@solana/web3.js";
import { fixture, addr } from "./open-reconcile.fixture.ts";
import { finalizedPlanFixture } from "./open-plan.fixture.ts";
import {
  verifyFinalizedPlan,
  verifyFinalizedAltBinding,
} from "./open-reconcile.ts";
import { VAULT_PROGRAM } from "./jupiter-vault-cpi-inspection.ts";
import { C3_MAINNET } from "../src/constants.ts";
import { quoteAltContentsHash } from "../src/quote-alt.ts";
import { encodeQuoteSealV1, quoteIdForNonce } from "../src/quote-seal.ts";
import type { StoredQuoteContext } from "./open-quote.ts";
test("source Anchor IDL v2 plan layout binds all six revisions, accounted budgets and actual effects", async () => {
  for (let ordinal = 0; ordinal < 6; ordinal++) {
    const f = fixture(),
      intent = addr(45);
    const context = {
      ...f.e.context,
      configVersion: "1",
      vault: addr(20).toBase58(),
      intent: intent.toBase58(),
      wallet: addr(46).toBase58(),
      plan: PublicKey.findProgramAddressSync(
        [Buffer.from("c3-plan-v1"), intent.toBuffer()],
        VAULT_PROGRAM,
      )[0].toBase58(),
      planRevision: String(ordinal % 3),
      routerProgram: C3_MAINNET.jupiterProgram,
      leg: ordinal % 3,
      direction: ordinal < 3 ? 1 : 2,
      maxSlippageBps: 100,
      planExpiresAt: "1050",
    } as StoredQuoteContext;
    const a = await finalizedPlanFixture(context, f.e.seal, "400000", "476");
    assert.equal(a.data.length, 901);
    assert.equal(
      verifyFinalizedPlan(a, context, "400000", "476", f.e.seal),
      BigInt((ordinal % 3) + 1),
    );
    for (const offset of [
      8,
      9,
      17,
      49,
      81,
      145,
      154,
      160 + (ordinal % 3) * 32,
      256 + (ordinal % 3) * 32,
      352 + (ordinal % 3) * 32,
      448 + (ordinal % 3) * 32,
      544,
      576 + (ordinal % 3) * 32,
      672 + (ordinal % 3) * 8,
      706,
      714,
      715,
      716,
      756 + (ordinal % 3) * 8,
      780 + (ordinal % 3) * 8,
      804 + (ordinal % 3) * 8,
      828,
      860,
      892,
      900,
    ]) {
      const bad = { ...a, data: Buffer.from(a.data) };
      bad.data[offset]! ^= 1;
      assert.throws(
        () => verifyFinalizedPlan(bad, context, "400000", "476", f.e.seal),
        /C3_RECONCILE_/,
        `ordinal ${ordinal}, offset ${offset}`,
      );
    }
    assert.throws(
      () =>
        verifyFinalizedPlan(
          { ...a, owner: addr(47) },
          context,
          "400000",
          "476",
          f.e.seal,
        ),
      /PLAN_OWNER/,
    );
    assert.throws(
      () =>
        verifyFinalizedPlan(
          { ...a, data: a.data.subarray(0, 900) },
          context,
          "400000",
          "476",
          f.e.seal,
        ),
      /PLAN_LAYOUT/,
    );
    const obsolete = { ...a, data: Buffer.alloc(877) };
    a.data.subarray(0, 8).copy(obsolete.data);
    obsolete.data[8] = 1;
    assert.throws(
      () => verifyFinalizedPlan(obsolete, context, "400000", "476", f.e.seal),
      /PLAN_LAYOUT/,
    );
  }
});
test("ALT binding uses canonical codec, raw active table contents and exact count", () => {
  const data = Buffer.alloc(88);
  data.writeUInt32LE(1);
  data.writeBigUInt64LE((1n << 64n) - 1n, 4);
  data.writeBigUInt64LE(50n, 12);
  addr(43).toBuffer().copy(data, 56);
  const accounts = [
    {
      address: addr(42).toBase58(),
      owner: C3_MAINNET.addressLookupTableProgram,
      data,
    },
  ];
  const nonce = createHash("sha256").update("alt nonce").digest(),
    hash = createHash("sha256").update("context").digest();
  const seal = encodeQuoteSealV1({
    contextHash: hash,
    quoteId: quoteIdForNonce(nonce),
    nonce,
    inputAmount: 400000n,
    quotedOutput: 476n,
    slippageBps: 100,
    minimumOutput: 472n,
    routeHash: hash,
    instructionHash: hash,
    accountMetasHash: hash,
    altCount: 1,
    altContentsHash: quoteAltContentsHash(accounts, 101n),
    builderTimestamp: 1000n,
    builderSlot: 100n,
    expiresAt: 1030n,
    expiresSlot: 200n,
  });
  verifyFinalizedAltBinding(accounts, 101n, seal);
  assert.throws(() => verifyFinalizedAltBinding([], 101n, seal), /ALT_COUNT/);
  for (const offset of [4, 12, 21, 56]) {
    const bad = Buffer.from(data);
    bad[offset]! ^= 1;
    assert.throws(
      () =>
        verifyFinalizedAltBinding([{ ...accounts[0]!, data: bad }], 101n, seal),
      /C3_QUOTE_ALT_INVALID|ALT_CHANGED/,
    );
  }
  assert.throws(
    () =>
      verifyFinalizedAltBinding(
        [{ ...accounts[0]!, owner: addr(44).toBase58() }],
        101n,
        seal,
      ),
    /ALT_INVALID/,
  );
});
