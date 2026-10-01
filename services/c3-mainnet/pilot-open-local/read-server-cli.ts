/** Explicit local-only journal viewer. Read-only DB session; never a keeper.
 * C3_OPEN_DATABASE_URL is server-only and is never printed, persisted or sent
 * to Android. No credentials are created by this command.
 */
import pg from "pg";
import { createReadServer } from "./read-server.ts";
if (!process.env.C3_OPEN_DATABASE_URL)
  throw new Error("C3_OPEN_DATABASE_URL_REQUIRED_SERVER_ONLY");
const pool = new pg.Pool({
  connectionString: process.env.C3_OPEN_DATABASE_URL,
  options: "-c default_transaction_read_only=on",
  max: 4,
});
const server = createReadServer(pool);
server.listen(8787, "127.0.0.1", () =>
  console.log(
    "C3_READ_ONLY_LOCAL_BACKEND_READY:8787; LOCAL_SIMULATION; MAINNET_DISABLED",
  ),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    server.close(() => {
      void pool.end();
    });
  });
