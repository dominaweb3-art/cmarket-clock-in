/** Reproducible direct-TLS service entry. No dotenv, credentials generation,
 * automatic migration/enrollment, fallback signer or deployment. */
import { readFile } from "node:fs/promises";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { requireOpenProductionPolicy } from "./open-production-policy.ts";
import { createProductionOwnerHttpsServer } from "./open-owner-http-server.ts";
import {
  verifyOpenOwnerSchema,
  applyReviewedOpenSchema,
  enrollOpenOwner,
} from "./open-owner-schema.ts";
import { productionOwnerRpc } from "./open-owner-service.ts";
import type { OpenCompilerPolicy } from "./open-owner-compiler.ts";
import type { OpenAccount } from "./open-state-semantics.ts";
export async function ownerServiceEntry(command: string) {
  const policy = requireOpenProductionPolicy(); // before reading ANY secret/config
  if (!["check", "migrate", "enroll", "start"].includes(command))
    throw Error("C3_OWNER_START_COMMAND");
  const origin = process.env.C3_OWNER_HTTPS_ORIGIN;
  const address = process.env.DATABASE_URL;
  if (!origin || !address || !process.env.C3_DATABASE_CA_FILE)
    throw Error("C3_OWNER_SERVER_CONFIGURATION_REQUIRED");
  const url = new URL(address);
  if (
    url.protocol !== "postgresql:" ||
    !url.username ||
    !url.password ||
    url.search ||
    url.hash ||
    !/^\/[a-zA-Z0-9_]+$/.test(url.pathname)
  )
    throw Error("C3_OWNER_DATABASE_TLS_REQUIRED");
  const ca = await readFile(process.env.C3_DATABASE_CA_FILE);
  const pool = new pg.Pool({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
    ssl: { ca: ca.toString(), rejectUnauthorized: true },
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  let listening = false;
  try {
    if (command === "migrate") {
      await applyReviewedOpenSchema(pool);
      return;
    }
    await verifyOpenOwnerSchema(pool);
    if (command === "check") return;
    if (command === "enroll") {
      const rpc = productionOwnerRpc(),
        response = (await rpc.read("getMultipleAccounts", [
          [policy.vault, policy.shareMint],
          { commitment: "finalized", encoding: "base64" },
        ])) as { context: { slot: number }; value: OpenAccount[] };
      if (
        !Number.isSafeInteger(response.context?.slot) ||
        response.context.slot < 1 ||
        response.value?.length !== 2
      )
        throw Error("C3_OWNER_ENROLLMENT_EVIDENCE");
      const compiler: OpenCompilerPolicy = {
        version: "c3-owner-compiler/v1",
        program: policy.programId,
        vault: policy.vault,
        wallet: policy.wallet,
        shareMint: policy.shareMint,
        governance: policy.governance,
        keeper: policy.keeper,
        maxSlippageBps: policy.maxSlippageBps,
        idlHash: policy.idlHash,
        configurationHash: policy.configurationHash,
        registryRevision: policy.registryRevision,
        quotePolicyRevision: policy.quotePolicyRevision,
      };
      await enrollOpenOwner(pool, compiler, {
        [policy.vault]: response.value[0]!,
        [policy.shareMint]: response.value[1]!,
      });
      return;
    }
    if (
      !process.env.C3_OWNER_TLS_KEY_FILE ||
      !process.env.C3_OWNER_TLS_CERT_FILE
    )
      throw Error("C3_OWNER_TLS_MATERIAL_REQUIRED");
    const key = await readFile(process.env.C3_OWNER_TLS_KEY_FILE),
      cert = await readFile(process.env.C3_OWNER_TLS_CERT_FILE);
    const port = Number(process.env.C3_OWNER_HTTPS_PORT || 8443);
    if (!Number.isInteger(port) || port < 1024 || port > 65535)
      throw Error("C3_OWNER_HTTPS_PORT_REQUIRED");
    const server = await createProductionOwnerHttpsServer(pool, origin, {
      key,
      cert,
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", resolve);
    });
    listening = true;
    const stop = () =>
      server.close(() => {
        void pool.end();
      });
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } finally {
    if (!listening) await pool.end();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  ownerServiceEntry(process.argv[2] ?? "check").catch((e) => {
    console.error(
      e instanceof Error && /^C3_[A-Z0-9_]+$/.test(e.message)
        ? e.message
        : "C3_OWNER_START_FAILED",
    );
    process.exitCode = 2;
  });
