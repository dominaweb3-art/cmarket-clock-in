import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { C3_MAINNET as c } from "../../src/constants.ts";
import {
  decodeOrcaMarketPool,
  decimalE12,
  divergenceBpsCeil,
  inspectGeckoPools,
  contrastMarketRatio,
} from "./exact-market-evidence.ts";
import {
  evaluateVerifiedOpenNav,
  type VerifiedOpenNavPoint,
} from "../../src/open-nav-collector.ts";

const owner = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
function fixture() {
  const b = Buffer.alloc(653);
  createHash("sha256").update("account:Whirlpool").digest().copy(b, 0, 0, 8);
  Buffer.alloc(32, 9).copy(b, 8);
  b.writeUInt16LE(64, 41);
  b.writeUInt16LE(64, 43);
  b.writeUInt16LE(3000, 45);
  b.writeBigUInt64LE(1000n, 49);
  b.writeBigUInt64LE(1n, 73); // sqrt=2^64, exact base-unit ratio 1
  new PublicKey(c.cbBtcMint).toBuffer().copy(b, 101);
  new PublicKey(c.usdcMint).toBuffer().copy(b, 181);
  Buffer.alloc(32, 10).copy(b, 133);
  Buffer.alloc(32, 11).copy(b, 213);
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("whirlpool"),
      b.subarray(8, 40),
      b.subarray(101, 133),
      b.subarray(181, 213),
      b.subarray(43, 45),
    ],
    new PublicKey(owner),
  );
  b[40] = bump;
  return {
    b,
    address: pda.toBase58(),
    raw: () => ({
      owner,
      executable: false,
      data: [b.toString("base64"), "base64"],
    }),
  };
}
test("exact Orca market ratios use bigint and never become NAV evidence", () => {
  const f = fixture(),
    d = decodeOrcaMarketPool(f.address, f.raw(), "cbBTC", "USDC");
  assert.equal(d.priceQuoteE12, "100000000000000");
  assert.equal(d.confidence, null);
  assert.equal(d.lastTradeTime, null);
  assert.equal(
    evaluateVerifiedOpenNav(d as unknown as VerifiedOpenNavPoint).status,
    "UNAVAILABLE",
  );
  assert.equal(decimalE12("0.999875000000999"), 999875000000n);
  // Actual GeckoTerminal decimal precision, bounded then floored (not floats).
  assert.equal(
    decimalE12("0.998668480407641148387094900321189461409155"),
    998668480407n,
  );
  assert.throws(() => decimalE12("0." + "1".repeat(61)));
  assert.equal(divergenceBpsCeil(10001n, 10000n), "1");
  for (const v of [null, 1, "1e8", "-1", "NaN", "0", "1.0x", "0.0000000000001"])
    assert.throws(() => decimalE12(v));
});
test("wrong mint, PDA, owner, encoding, discriminator and range fail closed", () => {
  const f = fixture();
  assert.throws(
    () => decodeOrcaMarketPool(c.usdcMint, f.raw(), "cbBTC", "USDC"),
    /POOL_PDA/,
  );
  assert.throws(
    () => decodeOrcaMarketPool(f.address, f.raw(), "PortalETH", "USDC"),
    /EXACT_MINT/,
  );
  assert.throws(
    () =>
      decodeOrcaMarketPool(
        f.address,
        { ...f.raw(), owner: c.tokenProgram },
        "cbBTC",
        "USDC",
      ),
    /ACCOUNT/,
  );
  assert.throws(
    () =>
      decodeOrcaMarketPool(
        f.address,
        { ...f.raw(), data: ["a", "base64"] },
        "cbBTC",
        "USDC",
      ),
    /LAYOUT/,
  );
  f.b[0] = f.b[0]! ^ 1;
  assert.throws(
    () => decodeOrcaMarketPool(f.address, f.raw(), "cbBTC", "USDC"),
    /DISCRIMINATOR/,
  );
  const other = fixture();
  other.b.fill(0, 65, 81);
  assert.throws(
    () => decodeOrcaMarketPool(other.address, other.raw(), "cbBTC", "USDC"),
    /POOL_RANGE/,
  );
});
test("quoted-token direction cannot price USDC with the base token price", () => {
  const response = {
    data: [
      {
        attributes: {
          address: c.usdcMint,
          base_token_price_usd: "90000",
          quote_token_price_usd: "0.9998",
        },
        relationships: {
          base_token: { data: { id: "solana_" + c.cbBtcMint } },
          quote_token: { data: { id: "solana_" + c.usdcMint } },
        },
      },
    ],
  };
  const [d] = inspectGeckoPools(response, "USDC");
  assert.equal(d!.marketPriceUsdE12, "999800000000");
  assert.equal(d!.eligibleForNav, false);
  response.data[0]!.attributes.quote_token_price_usd =
    null as unknown as string;
  assert.equal(inspectGeckoPools(response, "USDC")[0]!.marketPriceUsdE12, null);
  response.data[0]!.attributes.quote_token_price_usd = "NaN";
  assert.equal(inspectGeckoPools(response, "USDC")[0]!.marketPriceUsdE12, null);
  response.data[0]!.relationships.quote_token.data.id =
    "solana_" + c.wrappedSolMint;
  assert.throws(() => inspectGeckoPools(response, "USDC"), /MARKET_MINT/);
});
test("Orca fee bounds match pinned official implementation", () => {
  const f = fixture();
  f.b.writeUInt16LE(2500, 47);
  f.b.writeUInt16LE(60000, 45);
  assert.doesNotThrow(() =>
    decodeOrcaMarketPool(f.address, f.raw(), "cbBTC", "USDC"),
  );
  f.b.writeUInt16LE(2501, 47);
  assert.throws(
    () => decodeOrcaMarketPool(f.address, f.raw(), "cbBTC", "USDC"),
    /POOL_RANGE/,
  );
  f.b.writeUInt16LE(2500, 47);
  f.b.writeUInt16LE(60001, 45);
  assert.throws(
    () => decodeOrcaMarketPool(f.address, f.raw(), "cbBTC", "USDC"),
    /POOL_RANGE/,
  );
});
test("market contrast cannot assume stablecoin parity or source independence", () => {
  const d = contrastMarketRatio(
    "2000000000000",
    "1000000000000",
    "500000000000",
  );
  assert.equal(d.status, "DIAGNOSTIC_SHARED_MARKET_NOT_INDEPENDENT");
  assert.equal(d.divergenceBpsCeil, "0");
  assert.equal(d.eligibleForNav, false);
  assert.equal(d.exceedsCandidate100BpsLimit, false);
  assert.equal(
    contrastMarketRatio("1020000000000", "1000000000000", "1000000000000")
      .exceedsCandidate100BpsLimit,
    true,
  );
  assert.equal(d.observationAgeVerified, false);
  assert.equal(
    contrastMarketRatio("2000000000000", null, "500000000000").status,
    "UNAVAILABLE",
  );
  assert.throws(() =>
    contrastMarketRatio("2000000000000", "1000000000000", "0"),
  );
});
