#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  evaluateC3DevnetReadiness,
  isConcretePublicKey,
} from "./lib/c3-devnet-readiness.mjs";

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const configPath = path.join(
  repoDir,
  "config",
  "c3",
  "c3-devnet-candidate.v1.json",
);
const outputPath = path.join(
  repoDir,
  "apps",
  "mobile",
  "dist",
  "generated-results",
  "c3-devnet-readiness.json",
);

async function rpcCall(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error)
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body.result;
}

async function account(rpcUrl, address, encoding = "base64") {
  if (!isConcretePublicKey(address)) return null;
  return rpcCall(rpcUrl, "getAccountInfo", [
    address,
    { encoding, commitment: "finalized" },
  ]);
}

async function oracleEvidence(rpcUrl, asset) {
  if (!asset?.oracle) return null;
  const oracleAccount = await account(rpcUrl, asset.oracle.account);
  const latest = new URL("https://hermes.pyth.network/v2/updates/price/latest");
  latest.searchParams.append("ids[]", asset.oracle.feedId);
  latest.searchParams.set("parsed", "true");
  const response = await fetch(latest);
  const body = await response.json().catch(() => null);
  const publishTime = Number(body?.parsed?.[0]?.price?.publish_time ?? 0);
  const ageSeconds =
    publishTime > 0
      ? Math.max(0, Math.floor(Date.now() / 1000) - publishTime)
      : null;
  return {
    account: oracleAccount,
    httpStatus: response.status,
    fresh: response.ok && ageSeconds !== null && ageSeconds <= 60,
    ageSeconds,
  };
}

async function quoteEvidence(inputMint, outputMint, amount) {
  if (!isConcretePublicKey(inputMint) || !isConcretePublicKey(outputMint)) {
    return { verified: false, reason: "missing concrete mint" };
  }
  const url = new URL("https://api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("slippageBps", "100");
  const response = await fetch(url);
  const body = await response.json().catch(() => null);
  return {
    verified:
      response.ok &&
      typeof body?.outAmount === "string" &&
      body.outAmount !== "0",
    httpStatus: response.status,
    reason:
      body?.errorCode ??
      body?.error ??
      (response.ok ? "route returned" : `HTTP ${response.status}`),
  };
}

async function collectEvidence(config) {
  const rpcUrl = config.network.rpcUrl;
  const evidence = { mints: {}, oracles: {}, routes: {} };
  evidence.rpcHealth = await rpcCall(rpcUrl, "getHealth").catch(
    () => "unavailable",
  );
  evidence.program = await account(rpcUrl, config.symmetry.programId).catch(
    () => null,
  );
  evidence.globalConfig = await account(
    rpcUrl,
    config.symmetry.globalConfigPda,
  ).catch(() => null);
  evidence.symmetryUsdc = await account(
    rpcUrl,
    config.symmetry.protocolUsdcMint,
    "jsonParsed",
  ).catch(() => null);

  for (const name of ["inputUsdc", "bitcoin", "ethereum", "solana"]) {
    const asset = config.assets[name];
    evidence.mints[name] = await account(
      rpcUrl,
      asset.mint,
      "jsonParsed",
    ).catch(() => null);
    evidence.oracles[name] = await oracleEvidence(rpcUrl, asset).catch(
      (error) => ({
        account: null,
        fresh: false,
        reason: error.message,
      }),
    );
  }

  const inputMint = config.assets.inputUsdc.mint;
  const purchaseBaseUnits = 5_000_000;
  evidence.routes.bitcoin = await quoteEvidence(
    inputMint,
    config.assets.bitcoin.mint,
    purchaseBaseUnits * 0.4,
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));
  evidence.routes.ethereum = await quoteEvidence(
    inputMint,
    config.assets.ethereum.mint,
    purchaseBaseUnits * 0.3,
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));
  evidence.routes.solana = await quoteEvidence(
    inputMint,
    config.assets.solana.mint,
    purchaseBaseUnits * 0.3,
  );
  return evidence;
}

function sanitizeEvidence(evidence) {
  return {
    rpcHealth: evidence.rpcHealth,
    oracleHttpStatus: Object.fromEntries(
      Object.entries(evidence.oracles).map(([name, item]) => [
        name,
        item?.httpStatus ?? null,
      ]),
    ),
    routes: evidence.routes,
  };
}

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const evidence = await collectEvidence(config);
const result = evaluateC3DevnetReadiness(config, evidence);

console.log("C3 Symmetry V3 Devnet deployment readiness (strictly read-only)");
console.log(`Decision: ${result.decision}`);
for (const check of result.checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
}
console.log(
  "Wallet authorization/signing/submission/deployment: NOT PERFORMED",
);

if (process.argv.includes("--write-json")) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({ observedAt: new Date().toISOString(), decision: result.decision, checks: result.checks, evidence: sanitizeEvidence(evidence) }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Machine-readable result: ${path.relative(repoDir, outputPath)}`);
}

if (result.decision !== "GO") process.exitCode = 1;
