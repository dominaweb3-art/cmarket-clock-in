// Research-only unsigned SDK probe. Install the pinned SDK ONLY in an isolated /tmp prefix.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const prefix = process.env.C3_SYMMETRY_RESEARCH_PREFIX;
if (!prefix || !path.resolve(prefix).startsWith("/tmp/c3-symmetry-")) {
  throw new Error("isolated /tmp C3_SYMMETRY_RESEARCH_PREFIX required");
}
const require = createRequire(path.join(path.resolve(prefix), "package.json"));
const sdkPackage = JSON.parse(
  readFileSync(require.resolve("@symmetry-hq/sdk/package.json"), "utf8"),
);
if (sdkPackage.version !== "1.0.22") throw new Error("SDK version mismatch");
const { SymmetryCore } = require("@symmetry-hq/sdk");
const {
  Connection,
  PublicKey,
  VersionedTransaction,
} = require("@solana/web3.js");
const rpc = new Connection("https://api.mainnet-beta.solana.com", "finalized");
for (const method of [
  "sendTransaction",
  "sendRawTransaction",
  "simulateTransaction",
  "confirmTransaction",
]) {
  rpc[method] = () => {
    throw new Error("read-only probe: transaction action forbidden");
  };
}
const buyer = new PublicKey(Buffer.alloc(32, 7)).toBase58(); // public address only, no secret key
const sdk = new SymmetryCore({ connection: rpc, network: "mainnet" });
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const vaultMint = "9ihGfswnUZ6MysSR3KgmrZ57FXDVAiAQ6sEHwLuWwzJ4"; // known public example; NOT C3
try {
  const sequence = await sdk.buyVaultTx({
    buyer,
    vault_mint: vaultMint,
    contributions: [{ mint: USDC, amount: 1_000_000 }],
    rebalance_slippage_bps: 100,
    per_trade_rebalance_slippage_bps: 100,
    min_bounty_amount: 0,
    max_bounty_amount: 0,
  });
  const batches = sequence.batches.map((batch) =>
    batch.transactions.map((tx) => {
      const wire = Buffer.from(tx.tx_b64, "base64");
      const parsed = VersionedTransaction.deserialize(wire);
      const requiredSigners = parsed.message.staticAccountKeys
        .slice(0, parsed.message.header.numRequiredSignatures)
        .map((key) => key.toBase58());
      const instructions = tx.instructions.map((ix) => {
        const data = Buffer.from(ix.data, "base64");
        return {
          programId: ix.program_id,
          discriminator: data.subarray(0, 8).toString("hex"),
          dataBytes: data.length,
          accounts: ix.accounts,
          usdcDepositBaseUnits:
            ix.program_id === "BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate" &&
            data.subarray(0, 8).toString("hex") === "585c9edb5347efa4"
              ? data.readBigUInt64LE(8).toString()
              : null,
        };
      });
      return {
        wireBytes: wire.length,
        within1232Bytes: wire.length <= 1232,
        messageVersion: tx.message_version,
        feePayer: tx.payer,
        requiredSigners,
        hasRecentBlockhash: Boolean(tx.recent_blockhash),
        hasLastValidBlockHeight: Number.isSafeInteger(
          tx.last_valid_block_height,
        ),
        lookupTables: tx.lookup_tables,
        instructions,
      };
    }),
  );
  const output = {
    researchOnly: true,
    vaultIsC3: false,
    sdkVersion: sdkPackage.version,
    publicExampleVaultMint: vaultMint,
    syntheticBuyer: buyer,
    inputMint: USDC,
    inputBaseUnits: "1000000",
    batches,
    shareDestinationVerified: false,
    usdcRedemptionModeVerified: false,
    productionPolicyApproved: false,
    decision: "BLOCKED",
  };
  console.log(JSON.stringify(output, null, 2)); // no tx_b64, key or private data
} catch (error) {
  // SDK/RPC errors are not authority. Do not print arbitrary provider bodies.
  console.error(
    `Research-only unsigned build blocked: ${error?.name ?? "Error"}`,
  );
  process.exitCode = 2;
}
