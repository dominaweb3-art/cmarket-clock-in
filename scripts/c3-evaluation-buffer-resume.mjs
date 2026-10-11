/** Bounded repair of an existing, authority-owned Devnet deployment buffer.
 * Never deploys/upgrades a program, changes authority, or handles user assets.
 * Official Write ABI: sdk/program/src/bpf_loader_upgradeable.rs and
 * loader_upgradeable_instruction.rs in solana-labs/solana v1.18.26.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  ComputeBudgetProgram,
} = createRequire(
  new URL("../services/c3-mainnet/package.json", import.meta.url),
)("@solana/web3.js");
if (process.argv[2] !== "--authorized-devnet-evaluation")
  throw Error("EXPLICIT_DEVNET_REQUIRED");
const root = new URL("../", import.meta.url);
const binary = readFileSync(
  new URL("artifacts/c3-devnet-variable-purchases/c3_pilot_vault.so", root),
);
assert.equal(
  createHash("sha256").update(binary).digest("hex"),
  "a582571274157d7486e69a8bc89fd36abdc40fb52bf7430f28115343d885a703",
);
const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const buffer = new PublicKey("DCzdNcDWNYti2baXR2kGH1CDSzQv84xJi85J44i8E6J7");
const keyBytes = Uint8Array.from(
  JSON.parse(
    readFileSync(
      new URL("artifacts/c3-devnet-evaluation/private/deployer.json", root),
      "utf8",
    ),
  ),
);
const signer = Keypair.fromSecretKey(Uint8Array.from(keyBytes));
keyBytes.fill(0);
assert.equal(
  String(signer.publicKey),
  "6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC",
);
let next = 0;
const rpc = new Connection("https://api.devnet.solana.com", {
  commitment: "finalized",
  disableRetryOnRateLimit: true,
  fetch: async (url, init) => {
    assert.equal(String(url), "https://api.devnet.solana.com");
    await new Promise((r) =>
      setTimeout(r, Math.max(0, next - performance.now())),
    );
    next = performance.now() + 650;
    const res = await fetch(url, init);
    if (res.status === 429) throw Error("RPC_RATE_LIMIT_STOPPED");
    return res;
  },
});
assert.equal(
  await rpc.getGenesisHash(),
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
);
const raw = await rpc.getAccountInfo(buffer, "finalized");
assert.ok(raw.owner.equals(loader));
assert.equal(raw.data.readUInt32LE(0), 1);
assert.equal(raw.data[4], 1);
assert.ok(raw.data.subarray(5, 37).equals(signer.publicKey.toBuffer()));
assert.equal(raw.data.length, binary.length + 37);
const journalUrl = new URL(
  "artifacts/c3-devnet-variable-purchases/buffer-writes.json",
  root,
);
let journal = [];
try {
  journal = JSON.parse(readFileSync(journalUrl, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
assert.ok(Array.isArray(journal) && journal.length <= 4000);
// Reconcile previous submissions; only finalized expiry closes a missing Write.
const height = await rpc.getBlockHeight("finalized");
for (let i = 0; i < journal.length; i += 128) {
  const entries = journal.slice(i, i + 128);
  const states = (
    await rpc.getSignatureStatuses(
      entries.map((e) => e.signature),
      { searchTransactionHistory: true },
    )
  ).value;
  for (let j = 0; j < entries.length; j++) {
    const state = states[j];
    assert.ok(
      state
        ? state.confirmationStatus === "finalized" && !state.err
        : height > entries[j].lastValidBlockHeight,
      "PREVIOUS_WRITE_REQUIRES_RECONCILIATION",
    );
  }
}
const chunks = [];
for (let offset = 0; offset < binary.length; offset += 950) {
  const bytes = binary.subarray(offset, Math.min(offset + 950, binary.length));
  if (!bytes.equals(raw.data.subarray(37 + offset, 37 + offset + bytes.length)))
    chunks.push({ offset, bytes });
}
assert.ok(chunks.length <= 1100);
console.log(
  JSON.stringify({ missingChunks: chunks.length, scope: "DEVNET_BUFFER_ONLY" }),
);
for (let i = 0; i < chunks.length; i += 24) {
  const latest = await rpc.getLatestBlockhash("confirmed");
  const batch = [];
  for (const chunk of chunks.slice(i, i + 24)) {
    const data = Buffer.alloc(16 + chunk.bytes.length);
    data.writeUInt32LE(1);
    data.writeUInt32LE(chunk.offset, 4);
    data.writeBigUInt64LE(BigInt(chunk.bytes.length), 8);
    chunk.bytes.copy(data, 16);
    const ix = new TransactionInstruction({
      programId: loader,
      keys: [
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: signer.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });
    const tx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 50_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }),
          ix,
        ],
      }).compileToV0Message(),
    );
    tx.sign([signer]);
    assert.ok(tx.serialize().length <= 1232);
    // First Write is simulated on the real cluster; no asset operation exists.
    if (i === 0 && batch.length === 0)
      assert.equal(
        (
          await rpc.simulateTransaction(tx, {
            sigVerify: true,
            commitment: "confirmed",
          })
        ).value.err,
        null,
      );
    const signature = await rpc.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      // RPC rebroadcasts the identical buffer-write packet only; it never
      // constructs a replacement transaction or touches evaluation deposits.
      maxRetries: 10,
    });
    batch.push(signature);
    journal.push({
      offset: chunk.offset,
      signature,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    });
    writeFileSync(journalUrl, JSON.stringify(journal));
  }
  let confirmed = false;
  for (let n = 0; n < 45; n++) {
    const states = (
      await rpc.getSignatureStatuses(batch, { searchTransactionHistory: true })
    ).value;
    if (states.some((s) => s?.err)) throw Error("BUFFER_WRITE_FAILED_STOPPED");
    if (
      states.every(
        (s) =>
          s &&
          (s.confirmationStatus === "confirmed" ||
            s.confirmationStatus === "finalized"),
      )
    ) {
      confirmed = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!confirmed) throw Error("BUFFER_WRITE_UNCERTAIN_NO_AUTOMATIC_RESEND");
  console.log(
    JSON.stringify({
      confirmedWrites: Math.min(i + 24, chunks.length),
      total: chunks.length,
    }),
  );
}
let matched = false;
for (let n = 0; n < 40; n++) {
  const final = await rpc.getAccountInfo(buffer, "finalized");
  if (final.data.subarray(37).equals(binary)) {
    matched = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
assert.ok(matched, "FINALIZED_BUFFER_HASH_MISMATCH");
console.log(
  "FINALIZED_BUFFER_EXACT_BYTES_PASS; PROGRAM_NOT_UPGRADED_BY_THIS_SCRIPT",
);
