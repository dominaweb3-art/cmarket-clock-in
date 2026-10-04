import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { verifyWhirlpoolOracle } from "../src/open-whirlpool-oracle.ts";
test("adaptive fee oracle requires exact pool PDA, owner, discriminator and length", () => {
  const owner = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
    pool = new PublicKey("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"),
    address = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle"), pool.toBuffer()],
      owner,
    )[0],
    data = Buffer.alloc(254);
  Buffer.from("8bc283b38cb3e5f4", "hex").copy(data);
  pool.toBuffer().copy(data, 8);
  verifyWhirlpoolOracle(address, pool, owner, data, false);
  verifyWhirlpoolOracle(
    address,
    pool,
    PublicKey.default,
    Buffer.alloc(0),
    false,
  );
  assert.throws(() =>
    verifyWhirlpoolOracle(
      pool,
      pool,
      PublicKey.default,
      Buffer.alloc(0),
      false,
    ),
  );
  assert.throws(() =>
    verifyWhirlpoolOracle(
      address,
      pool,
      PublicKey.default,
      Buffer.alloc(1),
      false,
    ),
  );
  for (const size of [0, 8, 253, 255])
    assert.throws(() =>
      verifyWhirlpoolOracle(address, pool, owner, Buffer.alloc(size), false),
    );
  assert.throws(() => verifyWhirlpoolOracle(address, pool, owner, data, true));
  assert.throws(() => verifyWhirlpoolOracle(pool, pool, owner, data, false));
  assert.throws(() => verifyWhirlpoolOracle(address, pool, pool, data, false));
  for (const offset of [0, 8, 39]) {
    const b = Buffer.from(data);
    b[offset] = b[offset]! ^ 1;
    assert.throws(() => verifyWhirlpoolOracle(address, pool, owner, b, false));
  }
});
