/** Separate zero-value Devnet deployment identities. Never reads default or
 * Mainnet wallets; never prints key material; existing identities are reused. */
import { execFileSync } from "node:child_process";
import { mkdir, chmod, access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const directory = resolve(root, "artifacts/c3-devnet-evaluation/private");
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
const roles = [
  "deployer",
  "program",
  "router",
  "keeper",
  "quotes",
  "mint-authority",
];
const publicKeys = {};
for (const role of roles) {
  const file = resolve(directory, `${role}.json`);
  let exists = true;
  try {
    await access(file);
  } catch {
    exists = false;
  }
  if (!exists)
    execFileSync(
      "solana-keygen",
      ["new", "--no-bip39-passphrase", "--silent", "--outfile", file],
      { stdio: "ignore" },
    );
  await chmod(file, 0o600);
  publicKeys[role] = execFileSync("solana-keygen", ["pubkey", file], {
    encoding: "utf8",
  }).trim();
}
const report = {
  cluster: "devnet",
  genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  roles: publicKeys,
  realFundsAllowed: false,
};
await writeFile(
  resolve(directory, "../public-identities.json"),
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(JSON.stringify(report));
