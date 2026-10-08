/** Bundle reviewed code + public IDL, never .env, identities or signing keys. */
import { build } from "esbuild";
import { readFileSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const idl = fileURLToPath(
  new URL(
    "../../../artifacts/c3-devnet-evaluation/c3_pilot_vault.json",
    import.meta.url,
  ),
);
const parsed = JSON.parse(readFileSync(idl, "utf8"));
if (parsed.address !== "2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg")
  throw Error("EVAL_IDL_WRONG_PROGRAM");
mkdirSync(root + "resources", { recursive: true });
copyFileSync(idl, root + "resources/c3_pilot_vault.json");
const output = root + "api/evaluation.mjs";
const result = await build({
  entryPoints: [root + "server/evaluation-entry.ts"],
  outfile: output,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  external: ["pg"],
  treeShaking: true,
  sourcemap: false,
  metafile: true,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});
const bundle = readFileSync(output, "utf8");
// web3.js itself contains a generic clusterApiUrl table. It is not our transport:
// our service pins the official Devnet URL and verifies its genesis before I/O.
// Production assets/genesis, policy execution and local harness MUST be absent.
const forbidden = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  "submitProductionOwnerPacket",
  "requireOpenProductionPolicy",
  "pilot-open-local",
  "bigint-buffer",
  "@solana/spl-token",
];
if (
  forbidden.some((value) => bundle.includes(value)) ||
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(bundle)
)
  throw Error("EVAL_BUNDLE_ISOLATION_FAILED");
const reports = fileURLToPath(
  new URL("../../../artifacts/c3-devnet-evaluation/", import.meta.url),
);
mkdirSync(reports, { recursive: true });
writeFileSync(
  reports + "server-metafile.json",
  JSON.stringify(result.metafile),
);
console.log(
  "EVAL_SERVER_BUNDLE_READY; MAINNET_POLICY_ASSETS_AND_LOCAL_HARNESS_EXCLUDED; NO_KEYS_EMBEDDED",
);
