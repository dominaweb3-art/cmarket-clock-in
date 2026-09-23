// Read-only, credential-free public evidence collection. No wallet or transaction APIs.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(
    path.resolve(
      root,
      "../../../../config/c3/symmetry-v3-production-evidence-candidate.v1.json",
    ),
    "utf8",
  ),
);
const sources = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
];
const sorted = (value) =>
  value && typeof value === "object"
    ? Array.isArray(value)
      ? value.map(sorted)
      : Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted(value[key])]),
        )
    : value;
const digest = (value) =>
  createHash("sha256")
    .update(
      value instanceof Uint8Array
        ? value
        : typeof value === "string"
          ? value
          : JSON.stringify(sorted(value)),
    )
    .digest("hex");
async function rpc(endpoint, method, params) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `${method} returned HTTP ${response.status} at public source`,
    );
  const json = await response.json();
  if (json.error)
    throw new Error(
      `${method} RPC error ${json.error.code}: ${json.error.message}`,
    );
  return json.result;
}
const fixtures = [];
for (const [stage, signature] of Object.entries(manifest.publicTransactions)) {
  const [primary, secondary] = await Promise.all(
    sources.map((endpoint) =>
      rpc(endpoint, "getTransaction", [
        signature,
        {
          encoding: "base64",
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
          rewards: true,
        },
      ]),
    ),
  );
  if (!primary || !secondary || digest(primary) !== digest(secondary))
    throw new Error(`Public RPC transaction disagreement: ${stage}`);
  const [primaryStatus, secondaryStatus] = await Promise.all(
    sources.map((endpoint) =>
      rpc(endpoint, "getSignatureStatuses", [
        [signature],
        { searchTransactionHistory: true },
      ]),
    ),
  );
  const status1 = primaryStatus?.value?.[0];
  const status2 = secondaryStatus?.value?.[0];
  if (
    !status1 ||
    !status2 ||
    status1.confirmationStatus !== "finalized" ||
    status2.confirmationStatus !== "finalized" ||
    status1.err ||
    status2.err
  )
    throw new Error(`Missing finalized status: ${stage}`);
  const wire = primary.transaction;
  if (!Array.isArray(wire) || wire[1] !== "base64")
    throw new Error(`Missing raw transaction: ${stage}`);
  const bytes = Buffer.from(wire[0], "base64");
  const fixture = {
    schemaVersion: 1,
    cluster: "mainnet-beta",
    signature,
    source: sources[0],
    secondarySource: sources[1],
    retrievedAtUtc: new Date().toISOString(),
    response: primary,
    secondaryResponse: secondary,
    primaryStatus: status1,
    secondaryStatus: status2,
    secondaryResponseHash: digest(secondary),
    responseHash: digest(primary),
    rawTransactionHash: digest(bytes),
  };
  const target = path.join(root, "fixtures", `${stage}.json`);
  mkdirSync(path.dirname(target), { recursive: true });
  if (existsSync(target)) {
    const existing = JSON.parse(readFileSync(target, "utf8"));
    if (
      existing.signature !== signature ||
      existing.responseHash !== fixture.responseHash ||
      existing.secondaryResponseHash !== fixture.secondaryResponseHash ||
      existing.rawTransactionHash !== fixture.rawTransactionHash
    )
      throw new Error(
        `Existing public fixture differs; refusing overwrite: ${stage}`,
      );
  } else {
    writeFileSync(target, JSON.stringify(fixture, null, 2) + "\n", {
      flag: "wx",
    });
  }
  fixtures.push({
    stage,
    signature,
    slot: primary.slot,
    responseHash: fixture.responseHash,
    rawTransactionHash: fixture.rawTransactionHash,
    retrievedAtUtc: fixture.retrievedAtUtc,
  });
  process.stdout.write(
    `${stage}: finalized slot ${primary.slot}, both public sources agree\n`,
  );
}
process.stdout.write(JSON.stringify(fixtures, null, 2) + "\n");
