/** Official public Mainnet RPC, READ ONLY. No wallet, secret, transaction,
 * blockhash, signing, submission or deploy command is constructed here. */
import { readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const binary = join(root, "target/pilot-candidate-disabled/c3_pilot_vault.so");
const idlFile = join(root, "target/idl/c3_pilot_vault.json");
const idl = JSON.parse(readFileSync(idlFile, "utf8"));
const rpc = "https://api.mainnet-beta.solana.com";
let sequence = 0;
async function read(method, params = []) {
  if (
    ![
      "getGenesisHash",
      "getMinimumBalanceForRentExemption",
      "getVersion",
    ].includes(method)
  )
    throw new Error("READ_ONLY_METHOD_REQUIRED");
  const id = ++sequence;
  const r = await fetch(rpc, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`PUBLIC_RPC_HTTP_${r.status}`);
  const j = await r.json();
  if (j.error || j.id !== id || j.result === undefined)
    throw new Error("PUBLIC_RPC_UNAVAILABLE");
  return j.result;
}
const defs = new Map(idl.types.map((t) => [t.name, t.type]));
function size(type) {
  if (typeof type === "string") {
    const n = {
      bool: 1,
      u8: 1,
      i8: 1,
      u16: 2,
      i16: 2,
      u32: 4,
      i32: 4,
      u64: 8,
      i64: 8,
      u128: 16,
      i128: 16,
      pubkey: 32,
    }[type];
    if (!n) throw new Error("UNBOUNDED_IDL_TYPE");
    return n;
  }
  if (type.array) return size(type.array[0]) * type.array[1];
  if (type.defined) {
    const d = defs.get(type.defined.name);
    if (!d || d.kind !== "struct") throw new Error("UNSUPPORTED_IDL_TYPE");
    return d.fields.reduce((n, f) => n + size(f.type), 0);
  }
  throw new Error("UNBOUNDED_IDL_TYPE");
}
const genesis = await read("getGenesisHash");
if (genesis !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")
  throw new Error("WRONG_NETWORK");
const bytes = statSync(binary).size;
// Upgradeable loader exact metadata: program=36, buffer=37, programdata=45.
// --max-len equal to binary size, NOT the CLI's possible larger allocation.
const allocations = [
  ["program", 36, 1],
  ["programData", 45 + bytes, 1],
  ["transientDeploymentBuffer", 37 + bytes, 1],
  ["legacyVaultTokenAccounts", 165, 4],
  ["nonTransferableShareMint", 170, 1],
  ["nonTransferableShareAta", 174, 1],
  ...[
    "VaultConfig",
    "DepositIntent",
    "RedemptionIntent",
    "SettlementPlan",
    "RouteProgramRegistry",
    "QuoteAuthorityPolicy",
    "SwapLegAuthorization",
    "QuoteReceipt",
  ].map((name) => {
    const d = defs.get(name);
    if (!d || d.kind !== "struct") throw new Error(`IDL_TYPE_MISSING_${name}`);
    return [
      name,
      8 + d.fields.reduce((n, f) => n + size(f.type), 0),
      ["SettlementPlan"].includes(name)
        ? 2
        : ["SwapLegAuthorization", "QuoteReceipt"].includes(name)
          ? 6
          : 1,
    ];
  }),
];
const rents = new Map();
for (const [, length] of allocations)
  if (!rents.has(length))
    rents.set(
      length,
      await read("getMinimumBalanceForRentExemption", [
        length,
        { commitment: "finalized" },
      ]),
    );
const accounts = allocations.map(([kind, length, count]) => ({
  kind,
  bytes: length,
  count,
  lamportsPerAccount: rents.get(length),
  totalLamports: count * rents.get(length),
}));
const persistent = accounts
  .filter((a) => a.kind !== "transientDeploymentBuffer")
  .reduce((n, a) => n + a.totalLamports, 0);
const buffer = accounts.find(
  (a) => a.kind === "transientDeploymentBuffer",
).totalLamports;
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const result = {
  version: "c3-pilot-costs/v1",
  timestamp: new Date().toISOString(),
  rpc: "official-public-mainnet",
  genesisVerified: true,
  binaryBytes: bytes,
  binaryHash: sha(binary),
  idlHash: sha(idlFile),
  artifactScope: "DISABLED_NOT_DEPLOYABLE",
  accounts,
  persistentRentLamports: persistent,
  transientPeakRentLamports: persistent + buffer,
  depositUsdcBaseUnits: 1000000,
  networkFees: "NOT_MEASURED: exact deploy messages/approved payer absent",
  priorityFees: "NOT_MEASURED: exact compute/fee cap approval absent",
  swapFees: "NOT_FIXED: fresh exact routes required",
  deploymentBudgetStatus: "INCOMPLETE_NOT_APPROVED",
  excluded: [
    "existing owner USDC ATA if missing",
    "SOL payer reserve",
    "RPC/database/HSM operating costs",
    "upgrade headroom",
    "future recovery/quote attempts",
  ],
};
mkdirSync(join(root, "results"), { recursive: true });
const output = join(root, "results/mainnet-pilot-costs.json");
writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(
  JSON.stringify({
    timestamp: result.timestamp,
    binaryBytes: bytes,
    persistentRentSOL: persistent / 1e9,
    transientPeakRentSOL: (persistent + buffer) / 1e9,
    depositUSDC: 1,
    budget: "INCOMPLETE",
    report: output,
  }),
);
