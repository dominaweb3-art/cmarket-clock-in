/** Disposable local PostgreSQL 16 integration runner; never uses an existing cluster. */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import pg from "pg";

const binaryDirectory =
  process.env.C3_TEST_PG_BIN ?? "/opt/homebrew/opt/postgresql@16/bin";
const root = mkdtempSync(join(tmpdir(), "c3-m41-postgres-"));
const data = join(root, "data");
const socket = join(root, "socket");
const log = join(root, "postgres.log");
const suffix = randomBytes(6).toString("hex");
const role = `c3_test_${suffix}`;
const database = `c3_test_${suffix}`;
const password = randomBytes(32).toString("hex");
let started = false;
const testFile = process.argv.includes("--open-owner-enrollment")
  ? "pilot-open-local/owner-enrollment.integration.ts"
  : process.argv.includes("--open-owner-compiler")
    ? "pilot-open-local/owner-compiler.integration.ts"
    : process.argv.includes("--open-owner-protocol")
      ? "pilot-open-local/owner-protocol.integration.ts"
      : process.argv.includes("--open-owner")
        ? "pilot-open-local/owner-journal.integration.ts"
        : process.argv.includes("--open-generations")
          ? "pilot-open-local/plan-generations.integration.ts"
          : process.argv.includes("--open-jupiter-recovery")
            ? "pilot-open-local/open-jupiter-recovery.integration.ts"
            : process.argv.includes("--open-quote")
              ? "pilot-open-local/open-quote.integration.ts"
              : process.argv.includes("--open-local")
                ? "pilot-open-local/orchestrator.integration.ts"
                : "tests/postgres-live.integration.ts";
const withVault = process.argv.includes("--open-local-cpi");
const withReadServer = process.argv.includes("--open-read-server");
const withJupiterCycle = process.argv.includes("--open-jupiter-cycle");

function run(binary, args, env = process.env) {
  const result = spawnSync(join(binaryDirectory, binary), args, {
    env,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0)
    throw new Error(`Disposable PostgreSQL ${binary} failed.`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

try {
  mkdirSync(socket);
  run("initdb", [
    "-D",
    data,
    "--auth-local=trust",
    "--auth-host=scram-sha-256",
    "--no-instructions",
  ]);
  const port = await freePort();
  run("pg_ctl", [
    "-D",
    data,
    "-l",
    log,
    "-o",
    `-c listen_addresses=127.0.0.1 -p ${port} -k ${socket}`,
    "-w",
    "start",
  ]);
  started = true;
  const admin = new pg.Client({
    host: socket,
    port,
    database: "postgres",
    user: userInfo().username,
  });
  await admin.connect();
  try {
    // role/database identifiers are generated from hex, not external input.
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    await admin.query(`CREATE DATABASE ${database} OWNER ${role}`);
  } finally {
    await admin.end();
  }
  const url = new URL(`postgresql://127.0.0.1:${port}/${database}`);
  url.username = role;
  url.password = password;
  const result = spawnSync(
    process.execPath,
    withVault
      ? ["scripts/run-local.mjs"]
      : withJupiterCycle
        ? [
            "--experimental-strip-types",
            "tests/jupiter-cycle.ts",
            ...(process.argv.includes("--renew-plan") ? ["--renew-plan"] : []),
            ...(process.argv.includes("--resolve-minimum")
              ? ["--resolve-minimum"]
              : []),
            ...(process.argv.includes("--app-control")
              ? ["--app-control"]
              : []),
          ]
        : withReadServer
          ? ["--experimental-strip-types", "pilot-open-local/read-server-qa.ts"]
          : ["--experimental-strip-types", "--test", testFile],
    {
      cwd:
        withVault || withJupiterCycle
          ? new URL("../../../programs/c3-pilot-vault/", import.meta.url)
          : new URL("..", import.meta.url),
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        C3_DISPOSABLE_TEST_DATABASE: database,
      },
      encoding: "utf8",
      stdio: "inherit",
    },
  );
  if (result.status !== 0) process.exitCode = 1;
} catch (error) {
  process.exitCode = 1;
  console.error(
    error instanceof Error
      ? error.message
      : "Disposable PostgreSQL test failed.",
  );
} finally {
  if (started && existsSync(join(data, "postmaster.pid"))) {
    try {
      run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    } catch {
      console.error(
        "Temporary PostgreSQL stop failed; investigate the temporary cluster before cleanup.",
      );
      process.exitCode = 1;
    }
  }
  if (
    !existsSync(join(data, "postmaster.pid")) &&
    root.startsWith(join(tmpdir(), "c3-m41-postgres-"))
  ) {
    rmSync(root, { recursive: true, force: true });
  }
}
