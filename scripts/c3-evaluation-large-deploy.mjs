/** Explicit Devnet-only upgrade of the existing evaluation program. No user
 * wallet, Mainnet key, custom RPC, authority change or reusable buffer secret
 * is accepted from a client. Artifacts stay ignored. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
const { Connection, Keypair, PublicKey } = createRequire(
  new URL("../services/c3-mainnet/package.json", import.meta.url),
)("@solana/web3.js");
assert.equal(process.argv[2], "--authorized-devnet-evaluation");
const root = new URL("../", import.meta.url);
const binary = new URL(
  "artifacts/c3-devnet-million-purchases/c3_pilot_vault.so",
  root,
);
const expected =
  "a9940b85a2ab60ea923ac2cfc421cc24eea497a8a8b74b9773043a9574460b44";
assert.equal(
  createHash("sha256").update(readFileSync(binary)).digest("hex"),
  expected,
);
const rpc = new Connection("https://api.devnet.solana.com", "finalized");
assert.equal(
  await rpc.getGenesisHash(),
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
);
const programData = await rpc.getAccountInfo(
  new PublicKey("F3k3zkz4tmEPhD6A43ziufAFRVWvrfgGYxptcEJsyxAh"),
  "finalized",
);
assert.ok(
  programData.owner.equals(
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  ),
);
assert.equal(programData.data.readUInt32LE(0), 3);
assert.equal(programData.data[12], 1);
assert.equal(
  new PublicKey(programData.data.subarray(13, 45)).toBase58(),
  "6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC",
);
const privateDir = new URL(
  "artifacts/c3-devnet-million-purchases/private/",
  root,
);
mkdirSync(privateDir, { recursive: true, mode: 0o700 });
const buffer = new URL("buffer.json", privateDir);
if (!existsSync(buffer)) {
  const key = Keypair.generate();
  writeFileSync(buffer, JSON.stringify([...key.secretKey]), {
    mode: 0o600,
    flag: "wx",
  });
}
// With an explicit file buffer, CLI failures cannot print recovery mnemonic.
const child = spawn(
  "solana",
  [
    "program",
    "deploy",
    binary.pathname,
    "--url",
    "https://api.devnet.solana.com",
    "--program-id",
    "2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg",
    "--keypair",
    new URL("artifacts/c3-devnet-evaluation/private/deployer.json", root)
      .pathname,
    "--buffer",
    buffer.pathname,
    "--use-rpc",
    "--max-sign-attempts",
    "3",
    "--output",
    "json",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let output = "";
child.stdout.on("data", (b) => {
  output += b.toString();
});
child.stderr.on("data", () => {});
const code = await new Promise((resolve) => child.on("exit", resolve));
if (code !== 0)
  throw Error(
    "EVALUATION_UPGRADE_NOT_COMPLETED_VERIFY_BUFFER_AND_ORIGINAL_SIGNATURES",
  );
const result = JSON.parse(output);
assert.equal(result.programId, "2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg");
const finalized = await rpc.getAccountInfo(
  new PublicKey("F3k3zkz4tmEPhD6A43ziufAFRVWvrfgGYxptcEJsyxAh"),
  "finalized",
);
const bytes = readFileSync(binary);
assert.ok(finalized.data.subarray(45, 45 + bytes.length).equals(bytes));
assert.ok(finalized.data.subarray(45 + bytes.length).every((b) => b === 0));
const report = {
  ...result,
  programDataSlot: finalized.data.readBigUInt64LE(4).toString(),
  sha256: expected,
  verifiedBytes: true,
  mainnetEnabled: false,
};
writeFileSync(
  new URL("artifacts/c3-devnet-million-purchases/deployment.json", root),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
