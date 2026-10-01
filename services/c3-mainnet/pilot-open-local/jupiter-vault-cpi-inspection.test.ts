import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
} from "@solana/web3.js";
import { C3_MAINNET } from "../src/constants.ts";
import {
  inspectUnsignedEnvelope,
  inspectVaultCpiEnvelope,
  inspectVaultLookups,
  MEASUREMENT_PAYER,
  unsignedV0Size,
  VAULT_AUTHORITY,
  vaultAta,
} from "./jupiter-vault-cpi-inspection.ts";
import type { RouterBuild, RouterRequest } from "../src/jupiter-v2.ts";
import type { LookupEvidence } from "./jupiter-v0-measure.ts";

test("Mainnet genesis reference matches the official RPC network, not the historical typo", () => {
  assert.equal(
    C3_MAINNET.genesisHash,
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  );
  assert.notEqual(
    C3_MAINNET.genesisHash,
    "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2NZh",
  );
});

const request: RouterRequest = {
  inputMint: C3_MAINNET.usdcMint,
  outputMint: C3_MAINNET.cbBtcMint,
  amount: 400_000n,
  taker: VAULT_AUTHORITY.toBase58(),
  destinationTokenAccount: vaultAta(C3_MAINNET.cbBtcMint),
  slippageBps: 100,
  maxAccounts: 32,
};
function build(): RouterBuild {
  return {
    inputMint: request.inputMint,
    outputMint: request.outputMint,
    inAmount: "400000",
    outAmount: "479",
    otherAmountThreshold: "475",
    swapMode: "ExactIn",
    slippageBps: 100,
    priceImpactPct: "0",
    routePlan: [],
    computeBudgetInstructions: [],
    setupInstructions: [],
    cleanupInstruction: null,
    otherInstructions: [],
    tipInstruction: null,
    swapInstruction: {
      programId: C3_MAINNET.jupiterProgram,
      data: Buffer.from("d19853937cfed8e9", "hex").toString("base64"),
      accounts: [
        { pubkey: request.taker, isSigner: true, isWritable: false },
        {
          pubkey: vaultAta(request.inputMint),
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: vaultAta(request.outputMint),
          isSigner: false,
          isWritable: true,
        },
        {
          pubkey: C3_MAINNET.jupiterProgram,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: C3_MAINNET.jupiterProgram,
          isSigner: false,
          isWritable: false,
        },
      ],
    },
    addressesByLookupTableAddress: {},
    blockhashWithMetadata: {
      blockhash: [...new PublicKey(C3_MAINNET.usdcMint).toBytes()],
      lastValidBlockHeight: 200,
      fetchedAtEpochMs: 100_000,
    },
  };
}
const inspect = (candidate: RouterBuild) =>
  inspectVaultCpiEnvelope({
    build: candidate,
    request,
    lookupEvidence: [],
    currentSlot: 100,
    currentBlockHeight: 100,
    nowMs: 100_000,
  });
test("PDA is removed only from outer signer set; ordered Jupiter self/duplicate metas are retained", () => {
  const result = inspect(build());
  assert.equal(PublicKey.isOnCurve(VAULT_AUTHORITY.toBytes()), false);
  assert.deepEqual(result.requiredSigners, [MEASUREMENT_PAYER.toBase58()]);
  assert.equal(result.orderedMetas, 5);
  assert.equal(result.duplicateOccurrences, 1);
  assert.deepEqual(result.routerAliasIndexes, [3, 4]);
  assert.equal(result.executable, false);
  assert.equal(result.serialized, true);
  assert.equal(result.discriminatorHex, "d19853937cfed8e9");
});
test("wrong source/destination/signer/context and expired quote cannot produce an inspection", () => {
  const original = build();
  for (const index of [0, 1, 2]) {
    const accounts = original.swapInstruction.accounts.map((meta, i) =>
      i === index ? { ...meta, pubkey: C3_MAINNET.portalEthMint } : meta,
    );
    assert.throws(() =>
      inspect({
        ...original,
        swapInstruction: { ...original.swapInstruction, accounts },
      }),
    );
  }
  assert.throws(() =>
    inspect({ ...original, inputMint: C3_MAINNET.portalEthMint }),
  );
  assert.throws(() =>
    inspect({
      ...original,
      blockhashWithMetadata: {
        ...original.blockhashWithMetadata,
        fetchedAtEpochMs: 69_999,
      },
    }),
  );
  assert.throws(() =>
    inspect({
      ...original,
      blockhashWithMetadata: {
        ...original.blockhashWithMetadata,
        lastValidBlockHeight: 99,
      },
    }),
  );
});
test("ALT evidence rejects changed contents, wrong owner, inactive, warm and missing tables", () => {
  const address = new PublicKey(C3_MAINNET.portalEthMint);
  const key = new PublicKey(C3_MAINNET.cbBtcMint);
  const table = (overrides = {}) =>
    new AddressLookupTableAccount({
      key,
      state: {
        deactivationSlot: (1n << 64n) - 1n,
        lastExtendedSlot: 10,
        lastExtendedSlotStartIndex: 0,
        addresses: [address],
        ...overrides,
      },
    });
  const evidence: LookupEvidence = {
    table: table(),
    owner: AddressLookupTableProgram.programId.toBase58(),
    observedSlot: 20,
  };
  const advertised = { [key.toBase58()]: [address.toBase58()] };
  const valid = inspectVaultLookups(advertised, [evidence], 21);
  assert.equal(valid.tables.length, 1);
  assert.equal(valid.authorities[0], null);
  assert.throws(() => inspectVaultLookups(advertised, [], 21));
  assert.throws(() =>
    inspectVaultLookups(
      advertised,
      [{ ...evidence, owner: C3_MAINNET.tokenProgram }],
      21,
    ),
  );
  assert.throws(() =>
    inspectVaultLookups(
      advertised,
      [
        {
          ...evidence,
          table: table({ addresses: [new PublicKey(C3_MAINNET.usdcMint)] }),
        },
      ],
      21,
    ),
  );
  assert.throws(() =>
    inspectVaultLookups(
      advertised,
      [{ ...evidence, table: table({ deactivationSlot: 15n }) }],
      21,
    ),
  );
  assert.throws(() =>
    inspectVaultLookups(advertised, [{ ...evidence, observedSlot: 10 }], 21),
  );
  assert.throws(() =>
    inspectVaultLookups(advertised, [evidence, evidence], 21),
  );
  const changedAuthority = inspectVaultLookups(
    advertised,
    [
      {
        ...evidence,
        table: table({ authority: new PublicKey(C3_MAINNET.usdcMint) }),
      },
    ],
    21,
  );
  assert.notEqual(valid.contentsHash, changedAuthority.contentsHash);
});
test("complete unsigned v0 envelope accepts 1232 and refuses serialization at 1233", () => {
  const message = (length: number) =>
    new TransactionMessage({
      payerKey: MEASUREMENT_PAYER,
      recentBlockhash: C3_MAINNET.usdcMint,
      instructions: [
        new TransactionInstruction({
          programId: new PublicKey(C3_MAINNET.jupiterProgram),
          keys: [],
          data: Buffer.alloc(length),
        }),
      ],
    }).compileToV0Message();
  let boundary = -1;
  for (let length = 0; length < 1_232; length += 1)
    if (unsignedV0Size(message(length)) === 1_232) {
      boundary = length;
      break;
    }
  assert.ok(boundary >= 0);
  assert.equal(inspectUnsignedEnvelope(message(boundary)).serialized, true);
  const tooLarge = inspectUnsignedEnvelope(message(boundary + 1));
  assert.equal(tooLarge.bytes, 1_233);
  assert.equal(tooLarge.fits, false);
  assert.equal(tooLarge.serialized, false);
  assert.equal(tooLarge.messageHash, null);
});
