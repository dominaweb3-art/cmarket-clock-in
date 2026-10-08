import pg from "pg";
import { readFileSync } from "node:fs";
import { join } from "node:path";
let pool;
export function database() {
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
  pool ??= new pg.Pool({
    connectionString: connection.toString(),
    ssl: {
      rejectUnauthorized: true,
      ca: readFileSync(
        join(process.cwd(), "certs/supabase-prod-ca-2021.crt"),
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
