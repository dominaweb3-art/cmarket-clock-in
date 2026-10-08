/** Read-only release inspection: hashes, official syscall registry and exact
 * Devnet rent. No signing, deployment, airdrop, transfer or wallet callback. */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const root = new URL("../", import.meta.url).pathname;
const base = join(root, "artifacts/c3-devnet-evaluation");
const registryUrl =
  "https://raw.githubusercontent.com/anza-xyz/agave/v2.1.0/programs/bpf_loader/src/syscalls/mod.rs";
const response = await fetch(registryUrl, {
  redirect: "error",
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw Error("EVAL_OFFICIAL_SYSCALL_REGISTRY_UNAVAILABLE");
const registry = await response.text();
const known = new Set(
  [...registry.matchAll(/register_function_hashed\(\s*\*b"([^"]+)"/g)].map(
    (x) => x[1],
  ),
);
const readelf =
  "/Users/juantorres/.cache/solana/v1.52/platform-tools/llvm/bin/llvm-readelf";
const digest = (b) => createHash("sha256").update(b).digest("hex");
async function rpc(method, params = []) {
  const r = await fetch("https://api.devnet.solana.com", {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await r.json();
  if (!r.ok || body.error || !Object.hasOwn(body, "result"))
    throw Error("EVAL_READ_ONLY_RPC_UNAVAILABLE");
  return body.result;
}
const genesis = await rpc("getGenesisHash");
if (genesis !== "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG")
  throw Error("EVAL_WRONG_NETWORK");
const artifacts = [];
for (const name of ["c3_pilot_vault", "c3_local_router"]) {
  const path = join(base, "bin", name + ".so"),
    bytes = readFileSync(path);
  const scan = spawnSync(readelf, ["--dyn-symbols", path], {
    encoding: "utf8",
  });
  if (scan.status !== 0) throw Error("EVAL_ELF_INSPECTION_FAILED");
  const undefinedNames = [
    ...scan.stdout.matchAll(/NOTYPE\s+GLOBAL\s+DEFAULT\s+UND\s+(\S+)/g),
  ].map((x) => x[1]);
  const unknown = undefinedNames.filter((name) => !known.has(name));
  if (unknown.length) throw Error("EVAL_UNKNOWN_RUNTIME_SYSCALL");
  artifacts.push({
    name,
    bytes: bytes.length,
    sha256: digest(bytes),
    syscallsRegisteredInOfficialSource: undefinedNames.length,
    programDataRentLamports: await rpc("getMinimumBalanceForRentExemption", [
      bytes.length + 45,
    ]),
    temporaryBufferRentLamports: await rpc(
      "getMinimumBalanceForRentExemption",
      [bytes.length + 37],
    ),
  });
}
const deployer = "6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC";
const balance = (
  await rpc("getBalance", [deployer, { commitment: "finalized" }])
).value;
const idl = readFileSync(join(base, "c3_pilot_vault.json"));
if (JSON.parse(idl).address !== "2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg")
  throw Error("EVAL_IDL_MISMATCH");
const report = {
  checkedAt: new Date().toISOString(),
  cluster: "solana:devnet",
  genesis,
  artifacts,
  idlSha256: digest(idl),
  officialRegistry: registryUrl,
  officialRegistrySha256: digest(registry),
  installedSdkSyscallsFileBytes: statSync(
    "/Users/juantorres/.local/share/solana/install/active_release/bin/sdk/sbf/syscalls.txt",
  ).size,
  deployer,
  balanceLamports: balance,
  programAccountsRentLamports: await rpc(
    "getMinimumBalanceForRentExemption",
    [36],
  ),
  runtimeExecutionVerified: false,
  mainnetEnabled: false,
  monetaryValue: false,
};
writeFileSync(
  join(base, "release-read-only-check.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
