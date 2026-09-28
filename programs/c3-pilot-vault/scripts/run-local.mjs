import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

const workspace = resolve(import.meta.dirname, "..");
const wallet = resolve(workspace, "target/local-test-wallet.json");
mkdirSync(dirname(wallet), { recursive: true });
if (!existsSync(wallet)) {
  const created = spawnSync(
    "solana-keygen",
    ["new", "--no-bip39-passphrase", "--silent", "--outfile", wallet],
    {
      cwd: workspace,
      stdio: "ignore",
    },
  );
  if (created.status !== 0)
    throw new Error("Could not create ignored local-validator test wallet");
}
const pinnedAnchor = resolve(homedir(), ".avm/bin/anchor-0.31.1");
const anchor = existsSync(pinnedAnchor) ? pinnedAnchor : "anchor";
const version = spawnSync(anchor, ["--version"], {
  encoding: "utf8",
  timeout: 15_000,
});
if (
  version.status !== 0 ||
  !/^anchor-cli 0\.31\.1\b/.test(version.stdout.trim())
) {
  throw new Error("C3V1 local validator requires Anchor CLI 0.31.1");
}
const result = spawnSync(anchor, ["test", "--", "--features", "local-mock"], {
  cwd: workspace,
  stdio: "inherit",
  env: {
    ...process.env,
    ANCHOR_PROVIDER_URL: "http://127.0.0.1:8899",
    ANCHOR_WALLET: wallet,
  },
});
process.exit(result.status ?? 1);
