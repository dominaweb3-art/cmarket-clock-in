/** Six independent REAL Jupiter CPI simulations against cloned pools.
 * Not a persistent six-leg purchase: token funding is synthetic on every fork.
 * Never contacts a wallet or submits to any RPC. Only the child local probe simulates.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = fileURLToPath(
  new URL("../../../programs/c3-pilot-vault/results/", import.meta.url),
);
const validator = process.argv[process.argv.indexOf("--validator") + 1];
if (!process.argv.includes("--validator") || !validator)
  throw new Error("C3_SIX_VALIDATOR_REQUIRED");
await mkdir(directory, { recursive: true });
const outcomes: Record<string, unknown>[] = [];
for (const asset of ["btc", "eth", "sol"]) {
  let bought: string | undefined;
  for (const direction of ["buy", "sell"]) {
    if (direction === "sell" && !bought) {
      outcomes.push({
        asset,
        direction,
        decision: "BLOCKED",
        error: "BUY_OUTPUT_UNAVAILABLE",
      });
      continue;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const args = [
        "--experimental-strip-types",
        "pilot-open-local/jupiter-fork-probe.ts",
        "--validator",
        validator,
        "--dexes",
        "Whirlpool",
        "--asset",
        asset,
        "--compact",
      ];
      if (direction === "sell") args.push("--sell", "--amount", bought!);
      const child = spawn(process.execPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });
      const code = await new Promise<number | null>((resolve) =>
        child.once("exit", resolve),
      );
      await writeFile(
        join(directory, `six-${asset}-${direction}-${attempt}.log`),
        output,
      );
      const match = /"evidencePath":\s*"([^"]+)"/.exec(output);
      const evidence = match
        ? (JSON.parse(await readFile(match[1]!, "utf8")) as Record<
            string,
            unknown
          >)
        : null;
      if (code === 0 && evidence?.decision === "ISOLATED_CPI_EXECUTED") {
        if (direction === "buy") bought = String(evidence.destinationAfter);
        outcomes.push({
          asset,
          direction,
          decision: evidence.decision,
          evidencePath: match![1],
          input: evidence.input,
          output: evidence.destinationAfter,
          threshold: evidence.minimum,
          authorizedMinimum: evidence.authorizedMinimum,
          bytes: evidence.serializedBytes,
          adversarial: evidence.adversarial,
        });
        console.log(
          `${asset} ${direction}: ISOLATED_CPI_EXECUTED (not Mainnet acquisition)`,
        );
        break;
      }
      const error =
        /"error":\s*"([^"]+)"/.exec(output)?.[1] ??
        JSON.stringify(evidence?.error ?? "CHILD_FAILED");
      // Rebuild a fresh isolated fork only for freshness/route snapshot churn.
      // Structural errors never trigger an uncontrolled quote/retry loop.
      const retry =
        /QUOTE_EXPIRED_REBUILD_REQUIRED|FRESH_ROUTE_CHANGED|ALT_CONTENTS_CHANGED|JUPITER_STALE_QUOTE/.test(
          error,
        );
      if (!retry || attempt === 2) {
        outcomes.push({
          asset,
          direction,
          decision: "BLOCKED",
          error,
          evidencePath: match?.[1] ?? null,
        });
        console.log(`${asset} ${direction}: BLOCKED ${error}`);
        break;
      }
    }
  }
}
const result = {
  scope: "SIX_INDEPENDENT_CLONED_SIMULATIONS",
  mainnetAssetAcquisition: false,
  durableClosedLoopProven: false,
  outcomes,
};
await writeFile(
  join(directory, "six-jupiter-clone.json"),
  JSON.stringify(result, null, 2),
);
if (outcomes.some((item) => item.decision !== "ISOLATED_CPI_EXECUTED"))
  process.exitCode = 2;
