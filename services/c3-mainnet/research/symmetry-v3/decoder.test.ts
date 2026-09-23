import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { C3_MAINNET } from "../../src/constants.ts";
import { decodeBase58, encodeBase58 } from "../../src/solana.ts";
import {
  canonicalJson,
  decodePublicFixture,
  type PublicFixture,
} from "./decoder.ts";
import { reconcileObservedCandidate } from "./reconcile.ts";

// Deliberate malformed JSON mutations need unchecked dynamic fields in test code only.
/* eslint-disable @typescript-eslint/no-explicit-any */
type MutableFixture = { -readonly [K in keyof PublicFixture]: any };

const stageNames = [
  "usdcDeposit",
  "shareMint",
  "shareBurn",
  "usdcRedeem",
] as const;
type Stage = (typeof stageNames)[number];
const fixture = (stage: Stage): PublicFixture =>
  JSON.parse(
    readFileSync(new URL(`fixtures/${stage}.json`, import.meta.url), "utf8"),
  );
const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const expected = (f: PublicFixture) => ({
  cluster: "mainnet-beta" as const,
  signature: f.signature,
  symmetryProgram: C3_MAINNET.symmetryProgram,
});
const decode = (f: PublicFixture) => decodePublicFixture(f, expected(f));
const copy = (f: PublicFixture): MutableFixture =>
  structuredClone(f) as MutableFixture;
function reseal(f: MutableFixture) {
  f.secondaryResponse = structuredClone(f.response);
  f.responseHash = sha(canonicalJson(f.response));
  f.secondaryResponseHash = sha(canonicalJson(f.secondaryResponse));
  f.rawTransactionHash = sha(Buffer.from(f.response.transaction[0], "base64"));
}
const decoded = () =>
  Object.fromEntries(
    stageNames.map((stage) => [stage, decode(fixture(stage))]),
  ) as Record<Stage, ReturnType<typeof decode>>;

for (const stage of stageNames)
  test(`${stage}: signed v0 wire, both RPC hashes, finality, indexes and effects`, () => {
    const tx = decode(fixture(stage));
    assert.equal(tx.version, 0);
    assert.equal(tx.lookupTables.length, 0);
    assert.ok(tx.outerInstructions.length > 0);
    assert.ok(tx.innerInstructions.length > 0);
    assert.ok(tx.wireBytes <= 1232);
    assert.match(tx.fingerprint, /^[a-f0-9]{64}$/);
  });
test("four observed sample stages reconcile; C3 USDC-only remains unverified", () => {
  const result = reconcileObservedCandidate(decoded());
  assert.equal(result.classification, "PARTIALLY_VERIFIED_SAMPLE");
  assert.equal(result.c3UsdcOnlyRedemption, "UNVERIFIED");
  assert.ok(result.missing.length >= 6);
});
test("research manifest schema and evidence hashes reproduce from committed fixtures", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../../../../config/c3/symmetry-v3-observed-transactions.v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, "research");
  assert.equal(manifest.cluster, "mainnet-beta");
  assert.equal(manifest.programId, C3_MAINNET.symmetryProgram);
  assert.equal(manifest.decision, "NO_GO_EXTERNAL_EVIDENCE_REQUIRED");
  assert.equal(manifest.officialDiscriminatorsVerified, false);
  assert.equal(manifest.productionPolicyConfigured, false);
  assert.equal(manifest.transactions.length, 4);
  assert.equal(manifest.observedSymmetryInstructions.length, 10);
  assert.deepEqual(manifest.unclassifiedObservedPrograms, [
    "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95",
  ]);
  for (const row of manifest.transactions) {
    const f = fixture(row.stage as Stage);
    const tx = decode(f);
    assert.equal(row.signature, f.signature);
    assert.equal(row.primaryResponseSha256, sha(canonicalJson(f.response)));
    assert.equal(
      row.secondaryResponseSha256,
      sha(canonicalJson(f.secondaryResponse)),
    );
    assert.equal(
      row.rawTransactionSha256,
      sha(Buffer.from((f.response as any).transaction[0], "base64")),
    );
    assert.equal(row.messageSha256, tx.messageHash);
    assert.equal(row.evidenceFingerprint, tx.fingerprint);
  }
});

const rawMutations: [string, Stage, (f: MutableFixture) => void, boolean][] = [
  [
    "signature",
    "usdcDeposit",
    (f) => {
      f.signature = fixture("shareMint").signature;
    },
    false,
  ],
  [
    "cluster",
    "usdcDeposit",
    (f) => {
      f.cluster = "devnet";
    },
    false,
  ],
  [
    "slot",
    "usdcDeposit",
    (f) => {
      f.response.slot = 0;
    },
    true,
  ],
  [
    "finality",
    "shareMint",
    (f) => {
      f.primaryStatus.confirmationStatus = "confirmed";
    },
    false,
  ],
  [
    "transaction error",
    "shareMint",
    (f) => {
      f.response.meta.err = { InstructionError: [0, "InvalidArgument"] };
    },
    true,
  ],
  [
    "evidence hash",
    "shareMint",
    (f) => {
      f.responseHash = "0".repeat(64);
    },
    false,
  ],
  [
    "RPC disagreement",
    "shareMint",
    (f) => {
      f.secondaryResponse.slot++;
    },
    false,
  ],
  [
    "loaded address",
    "shareMint",
    (f) => {
      f.response.meta.loadedAddresses.writable.push(C3_MAINNET.usdcMint);
    },
    true,
  ],
  [
    "inner account index",
    "usdcRedeem",
    (f) => {
      f.response.meta.innerInstructions[0].instructions[0].accounts[0] = 255;
    },
    true,
  ],
  [
    "inner program ID",
    "usdcRedeem",
    (f) => {
      f.response.meta.innerInstructions[0].instructions[0].programIdIndex = 255;
    },
    true,
  ],
  [
    "inner instruction data",
    "usdcRedeem",
    (f) => {
      f.response.meta.innerInstructions[0].instructions[0].data = "0";
    },
    true,
  ],
  [
    "token mint",
    "usdcRedeem",
    (f) => {
      f.response.meta.postTokenBalances[0].mint = C3_MAINNET.cbBtcMint;
    },
    true,
  ],
  [
    "token owner",
    "usdcRedeem",
    (f) => {
      f.response.meta.postTokenBalances[0].owner = C3_MAINNET.cbBtcMint;
    },
    true,
  ],
  [
    "token program",
    "usdcRedeem",
    (f) => {
      f.response.meta.postTokenBalances[0].programId = C3_MAINNET.systemProgram;
    },
    true,
  ],
  [
    "missing inner instructions",
    "shareMint",
    (f) => {
      delete f.response.meta.innerInstructions;
    },
    true,
  ],
  [
    "missing token balances",
    "shareMint",
    (f) => {
      delete f.response.meta.postTokenBalances;
    },
    true,
  ],
  [
    "missing logs",
    "shareMint",
    (f) => {
      delete f.response.meta.logMessages;
    },
    true,
  ],
  [
    "truncated raw transaction",
    "shareBurn",
    (f) => {
      f.response.transaction[0] = Buffer.from(
        Buffer.from(f.response.transaction[0], "base64").subarray(0, 80),
      ).toString("base64");
    },
    true,
  ],
  [
    "noncanonical shortvec",
    "shareBurn",
    (f) => {
      const wire = Buffer.from(f.response.transaction[0], "base64");
      wire[0] = 0x81;
      wire[1] = 0x00;
      f.response.transaction[0] = wire.toString("base64");
    },
    true,
  ],
  [
    "signed message",
    "shareBurn",
    (f) => {
      const wire = Buffer.from(f.response.transaction[0], "base64");
      wire[80] = wire[80]! ^ 1;
      f.response.transaction[0] = wire.toString("base64");
    },
    true,
  ],
  [
    "outer instruction data",
    "usdcDeposit",
    (f) => {
      const wire = Buffer.from(f.response.transaction[0], "base64");
      const index = wire.indexOf(Buffer.from("7850f57bd495a32f", "hex"));
      assert.ok(index > 0);
      wire[index] = wire[index]! ^ 1;
      f.response.transaction[0] = wire.toString("base64");
    },
    true,
  ],
  [
    "program ID bytes",
    "usdcDeposit",
    (f) => {
      const wire = Buffer.from(f.response.transaction[0], "base64");
      const index = wire.indexOf(
        Buffer.from(decodeBase58(C3_MAINNET.symmetryProgram)),
      );
      assert.ok(index > 0);
      wire[index] = wire[index]! ^ 1;
      f.response.transaction[0] = wire.toString("base64");
    },
    true,
  ],
  [
    "ALT lookup count without historical table",
    "shareMint",
    (f) => {
      const wire = Buffer.from(f.response.transaction[0], "base64");
      wire[wire.length - 1] = 1;
      f.response.transaction[0] = wire.toString("base64");
    },
    true,
  ],
  [
    "oversized wire",
    "shareMint",
    (f) => {
      f.response.transaction[0] = Buffer.alloc(1233).toString("base64");
    },
    true,
  ],
  [
    "extra inner group",
    "shareMint",
    (f) => {
      f.response.meta.innerInstructions.push(
        structuredClone(f.response.meta.innerInstructions[0]),
      );
    },
    true,
  ],
  [
    "unexplained lamport recipient",
    "shareMint",
    (f) => {
      f.response.meta.postBalances[0]++;
    },
    true,
  ],
];
for (const [name, stage, mutate, seal] of rawMutations)
  test(`reject ${name}`, () => {
    const f = copy(fixture(stage));
    mutate(f);
    if (seal) reseal(f);
    assert.throws(() => decode(f));
  });

test("reject inconsistent USDC destination even when both RPC metadata copies are resealed", () => {
  const f = copy(fixture("usdcRedeem"));
  const transfer = f.response.meta.innerInstructions[0].instructions[0];
  transfer.accounts[2] = 0;
  reseal(f);
  assert.throws(() =>
    reconcileObservedCandidate({ ...decoded(), usdcRedeem: decode(f) }),
  );
});
test("reject inconsistent token balance after RPC metadata copies are resealed", () => {
  const f = copy(fixture("usdcRedeem"));
  const row = f.response.meta.postTokenBalances.find(
    (item: any) =>
      item.owner === "8RZ4GrQDsctRGrW4tDZcYZRqFAW23eWkrVcJQ1DH7GyX",
  );
  row.uiTokenAmount.amount = "999999999";
  reseal(f);
  assert.throws(() =>
    reconcileObservedCandidate({ ...decoded(), usdcRedeem: decode(f) }),
  );
});
test("reject changed inner amount and source with valid base58 and resealed RPC copies", () => {
  for (const field of ["amount", "source"] as const) {
    const f = copy(fixture("usdcRedeem"));
    const ix = f.response.meta.innerInstructions[0].instructions[0];
    if (field === "amount") {
      const bytes = Buffer.from(decodeBase58(ix.data));
      bytes.writeBigUInt64LE(19_000_000n, 1);
      ix.data = encodeBase58(bytes);
    } else ix.accounts[0] = 0;
    reseal(f);
    assert.throws(() =>
      reconcileObservedCandidate({ ...decoded(), usdcRedeem: decode(f) }),
    );
  }
});
test("standard system, WSOL and ATA operations are identified without claiming settlement", () => {
  const deposit = decode(fixture("usdcDeposit"));
  assert.ok(
    deposit.outerInstructions.some(
      (ix) =>
        ix.systemOperation === "transfer" && ix.systemTransferLamports !== null,
    ),
  );
  assert.ok(
    deposit.outerInstructions.some((ix) => ix.tokenOperation === "syncNative"),
  );
  const redeem = decode(fixture("usdcRedeem"));
  assert.ok(
    redeem.outerInstructions.some(
      (ix) => ix.associatedTokenOperation === "createIdempotent",
    ),
  );
});
test("reject altered burn amount, source, and share mint", () => {
  for (const field of ["tokenAmount", "tokenSource", "accounts"] as const) {
    const tx = decoded();
    const i = tx.shareBurn.innerInstructions.findIndex(
      (ix) => ix.tokenOperation === "burnChecked",
    );
    const original = tx.shareBurn.innerInstructions[i]!;
    const changed =
      field === "accounts"
        ? {
            ...original,
            accounts: [
              original.accounts[0]!,
              C3_MAINNET.cbBtcMint,
              ...original.accounts.slice(2),
            ],
          }
        : {
            ...original,
            [field]: field === "tokenAmount" ? "21" : C3_MAINNET.cbBtcMint,
          };
    tx.shareBurn = {
      ...tx.shareBurn,
      innerInstructions: tx.shareBurn.innerInstructions.map((ix, index) =>
        index === i ? changed : ix,
      ),
    };
    assert.throws(() => reconcileObservedCandidate(tx));
  }
});
test("reject duplicate stage, stage ordering, and unknown observed discriminator", () => {
  const baseline = decoded();
  assert.throws(() =>
    reconcileObservedCandidate({
      ...baseline,
      shareMint: baseline.usdcDeposit,
    }),
  );
  assert.throws(() =>
    reconcileObservedCandidate({
      ...baseline,
      shareMint: { ...baseline.shareMint, slot: baseline.usdcDeposit.slot },
    }),
  );
  const changed = {
    ...baseline.shareMint,
    outerInstructions: baseline.shareMint.outerInstructions.map((ix) =>
      ix.programId === C3_MAINNET.symmetryProgram
        ? { ...ix, discriminatorHex: "ffffffffffffffff" }
        : ix,
    ),
  };
  assert.throws(() =>
    reconcileObservedCandidate({ ...baseline, shareMint: changed }),
  );
});
test("reject log correlation, missing owner evidence, extra user debit and third-party recipient", () => {
  const baseline = decoded();
  assert.throws(() =>
    reconcileObservedCandidate({
      ...baseline,
      shareMint: { ...baseline.shareMint, logs: [] },
    }),
  );
  const owner = {
    ...baseline.usdcRedeem,
    tokenEffects: baseline.usdcRedeem.tokenEffects.map((row) =>
      row.account === "4PzfY9AeVRmFxVzF7r3UfyufywKNLUX7tSkZqZuooxzZ"
        ? { ...row, owner: C3_MAINNET.cbBtcMint }
        : row,
    ),
  };
  assert.throws(() =>
    reconcileObservedCandidate({ ...baseline, usdcRedeem: owner }),
  );
  const debit = {
    ...baseline.usdcRedeem,
    tokenEffects: baseline.usdcRedeem.tokenEffects.map((row) =>
      row.account === "4PzfY9AeVRmFxVzF7r3UfyufywKNLUX7tSkZqZuooxzZ"
        ? { ...row, delta: "-1" }
        : row,
    ),
  };
  assert.throws(() =>
    reconcileObservedCandidate({ ...baseline, usdcRedeem: debit }),
  );
  const thirdParty = {
    ...baseline.usdcRedeem,
    innerInstructions: baseline.usdcRedeem.innerInstructions.map((ix) =>
      ix.tokenOperation === "transferChecked"
        ? { ...ix, tokenDestination: C3_MAINNET.cbBtcMint }
        : ix,
    ),
  };
  assert.throws(() =>
    reconcileObservedCandidate({ ...baseline, usdcRedeem: thirdParty }),
  );
  const extraEffect = {
    ...baseline.usdcRedeem,
    tokenEffects: [
      ...baseline.usdcRedeem.tokenEffects,
      {
        account: C3_MAINNET.cbBtcMint,
        owner: C3_MAINNET.portalEthMint,
        mint: C3_MAINNET.usdcMint,
        decimals: 6,
        pre: "0",
        post: "1",
        delta: "1",
        incompleteSide: false,
      },
    ],
  };
  assert.throws(() =>
    reconcileObservedCandidate({ ...baseline, usdcRedeem: extraEffect }),
  );
});
