import pg from "pg";
import { readFileSync } from "node:fs";

let pool;
function database() {
  const configured = process.env.POSTGRES_URL;
  if (!configured) throw Error("EVAL_DATABASE_CONFIGURATION_MISSING");
  const connection = new URL(configured);
  if (
    !["postgres:", "postgresql:"].includes(connection.protocol) ||
    !connection.hostname.endsWith(".supabase.com")
  )
    throw Error("EVAL_DATABASE_HOST_NOT_REVIEWED");
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"])
    connection.searchParams.delete(key);
  // Verify the provider certificate; do not use rejectUnauthorized:false.
  pool ??= new pg.Pool({
    connectionString: connection.toString(),
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(
        new URL("../certs/supabase-prod-ca-2021.crt", import.meta.url),
        "utf8",
      ),
    },
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    allowExitOnIdle: true,
  });
  return pool;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  const result = {
    mode: "DEVNET_SIMULATED_ASSETS",
    mainnetEnabled: false,
    evaluationReady: false,
    database: "UNVERIFIED",
    devnet: "UNVERIFIED",
  };
  try {
    const { rows } = await database().query(
      "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name='c3_eval') AS present",
    );
    result.database = rows[0]?.present ? "SCHEMA_PRESENT" : "SCHEMA_MISSING";
  } catch {
    result.database = "CONFIGURATION_OR_CONNECTIVITY_BLOCKED";
  }
  try {
    const response = await fetch("https://api.devnet.solana.com", {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash" }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json();
    result.devnet =
      response.ok &&
      body.result === "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
        ? "VERIFIED_DEVNET"
        : "UNAVAILABLE_OR_WRONG_CLUSTER";
  } catch {
    result.devnet = "UNAVAILABLE";
  }
  // Health is not evidence of deployed programs, shares, swaps or physical QA.
  return res.status(200).json(result);
}
