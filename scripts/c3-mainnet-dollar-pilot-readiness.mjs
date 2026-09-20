#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  allocatePilotUsdc,
  estimateBountyUsdc,
  evaluatePilotReadiness,
} from "./lib/c3-mainnet-dollar-pilot.mjs";

const repoDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const configPath = path.join(
  repoDir,
  "config",
  "c3",
  "c3-mainnet-dollar-pilot-candidate.v1.json",
);
const outputPath = path.join(
  repoDir,
  "apps",
  "mobile",
  "dist",
  "generated-results",
  "c3-mainnet-dollar-pilot-readiness.json",
);
const quoteEndpoint = "https://lite-api.jup.ag/swap/v1/quote";

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function rpcCall(rpcUrl, method, params = []) {
  const { response, body } = await requestJson(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
  });
  if (!response.ok || body?.error)
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body.result;
}

async function account(rpcUrl, address, encoding = "base64") {
  return rpcCall(rpcUrl, "getAccountInfo", [
    address,
    { encoding, commitment: "finalized" },
  ]);
}

async function quote(inputMint, outputMint, amount) {
  const url = new URL(quoteEndpoint);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amount.toString());
  url.searchParams.set("slippageBps", "100");
  url.searchParams.set("restrictIntermediateTokens", "true");
  const { response, body } = await requestJson(url);
  return {
    verified:
      response.ok &&
      typeof body?.outAmount === "string" &&
      BigInt(body.outAmount) > 0n,
    httpStatus: response.status,
    inAmount: body?.inAmount ?? null,
    outAmount: body?.outAmount ?? null,
    minimumOutAmount: body?.otherAmountThreshold ?? null,
    priceImpactPct: body?.priceImpactPct ?? null,
    routeLabels: (body?.routePlan ?? []).map(
      (route) => route.swapInfo?.label ?? "unknown",
    ),
    reason: body?.errorCode ?? body?.error ?? null,
  };
}

async function pythEvidence(config) {
  const accessToken = process.env[config.oracle.credentialVariableName];
  if (!accessToken)
    return {
      authenticated: false,
      fresh: false,
      reason: "required credential variable is absent",
    };
  const url = new URL(config.oracle.endpoint);
  for (const asset of [
    config.assets.cbBtc,
    config.assets.portalEth,
    config.assets.wsol,
  ]) {
    url.searchParams.append("ids[]", `0x${asset.oracleFeedId}`);
  }
  url.searchParams.set("parsed", "true");
  const { response, body } = await requestJson(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const publishTimes = (body?.parsed ?? []).map((item) =>
    Number(item?.price?.publish_time ?? 0),
  );
  const now = Math.floor(Date.now() / 1000);
  return {
    authenticated: response.ok,
    fresh:
      response.ok &&
      publishTimes.length === 3 &&
      publishTimes.every(
        (publishTime) =>
          publishTime > 0 &&
          now - publishTime <= config.oracle.maximumAgeSeconds,
      ),
    httpStatus: response.status,
    feedCount: publishTimes.length,
  };
}

async function collectEvidence(config) {
  const rpcUrl = config.network.rpcUrl;
  const evidence = { mints: {}, quotes: {} };
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

  for (const name of ["inputUsdc", "cbBtc", "portalEth", "wsol"]) {
    evidence.mints[name] = await account(
      rpcUrl,
      config.assets[name].mint,
      "jsonParsed",
    ).catch(() => null);
  }

  for (const size of config.pilot.quoteSizesUsdc) {
    const allocations = allocatePilotUsdc(BigInt(size) * 1_000_000n);
    evidence.quotes[String(size)] = {};
    for (const name of ["cbBtc", "portalEth", "wsol"]) {
      evidence.quotes[String(size)][name] = await quote(
        config.assets.inputUsdc.mint,
        config.assets[name].mint,
        allocations[name],
      ).catch((error) => ({ verified: false, reason: error.message }));
      await sleep(2_500);
    }
  }
  evidence.pyth = await pythEvidence(config).catch((error) => ({
    authenticated: false,
    fresh: false,
    reason: error.message,
  }));

  const solQuote = evidence.quotes["1"]?.wsol;
  evidence.economics =
    solQuote?.verified && solQuote.outAmount
      ? {
          estimatedBountyUsdcBaseUnits: estimateBountyUsdc({
            bountyLamports: BigInt(
              config.symmetry.estimatedThreeAssetDepositBountyLamports,
            ),
            solOutputLamports: BigInt(solQuote.outAmount),
            solInputUsdcBaseUnits: 300_000n,
          }).toString(),
        }
      : { estimatedBountyUsdcBaseUnits: null };
  return evidence;
}

function safeEvidence(evidence) {
  return {
    rpcHealth: evidence.rpcHealth,
    quotes: evidence.quotes,
    pyth: evidence.pyth,
    economics: evidence.economics,
  };
}

const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const evidence = await collectEvidence(config);
const result = evaluatePilotReadiness(config, evidence);

console.log("C3 Symmetry Mainnet one-dollar pilot readiness (read-only)");
console.log(`Decision: ${result.decision}`);
for (const check of result.checks)
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
if (evidence.economics.estimatedBountyUsdcBaseUnits) {
  console.log(
    `Estimated fixed three-asset intent bounty: ${Number(evidence.economics.estimatedBountyUsdcBaseUnits) / 1_000_000} USDC equivalent`,
  );
}
console.log(
  "Wallet authorization/signing/submission/deployment: NOT PERFORMED",
);

if (process.argv.includes("--write-json")) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify({ observedAt: new Date().toISOString(), decision: result.decision, checks: result.checks, evidence: safeEvidence(evidence) }, null, 2)}\n`,
    "utf8",
  );
  console.log(`Machine-readable result: ${path.relative(repoDir, outputPath)}`);
}

if (result.decision !== "GO") process.exitCode = 1;
