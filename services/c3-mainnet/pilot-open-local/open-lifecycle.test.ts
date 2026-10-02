import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyLifecycleInner } from "./open-lifecycle.ts";
import { C3_MAINNET as c } from "../src/constants.ts";
const named = new Map([
  ["owner_usdc", "user"],
  ["usdc_mint", c.usdcMint],
  ["vault_usdc", "vault"],
  ["owner", "owner"],
]);
const data = Buffer.alloc(10);
data[0] = 12;
data.writeBigUInt64LE(1_000_000n, 1);
data[9] = 6;
test("lifecycle exact TransferChecked effects, no hidden approve/close/burn/extra debit", () => {
  const good: { program: string; accounts: string[]; data: Buffer } = {
    program: c.tokenProgram,
    accounts: ["user", c.usdcMint, "vault", "owner"],
    data,
  };
  verifyLifecycleInner("deposit_usdc", [good], named, 1_000_000n);
  for (const mode of [
    "amount",
    "decimals",
    "program",
    "owner",
    "destination",
    "extra",
    "missing",
    "approve",
    "close",
    "burn",
  ]) {
    const bad = {
      ...good,
      data: Buffer.from(data),
      accounts: [...good.accounts],
    };
    if (mode === "amount") bad.data.writeBigUInt64LE(1_000_001n, 1);
    if (mode === "decimals") bad.data[9] = 9;
    if (mode === "program") bad.program = c.jupiterProgram;
    if (mode === "owner") bad.accounts[3] = "hostile";
    if (mode === "destination") bad.accounts[2] = "hostile";
    if (["approve", "close", "burn"].includes(mode))
      bad.data[0] = (
        { approve: 4, close: 9, burn: 8 } as Record<string, number>
      )[mode]!;
    assert.throws(
      () =>
        verifyLifecycleInner(
          "deposit_usdc",
          mode === "extra" ? [good, bad] : mode === "missing" ? [] : [bad],
          named,
          1_000_000n,
        ),
      /C3_LIFECYCLE_/,
    );
  }
});
