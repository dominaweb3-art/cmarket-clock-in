/** Disposable loopback QA viewer. No synthetic customer positions or writes via HTTP. */
import pg from "pg";
import { openValidatorJournal } from "./validator-bridge.ts";
import { createReadServer } from "./read-server.ts";
const journal = await openValidatorJournal();
await journal.close();
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: "-c default_transaction_read_only=on",
  max: 2,
});
const server = createReadServer(pool);
server.listen(8787, "127.0.0.1", () =>
  console.log(
    "LOCAL_QA_READ_BACKEND_READY:8787; EMPTY_JOURNAL; MAINNET_DISABLED",
  ),
);
// A finite QA session; exit triggers disposal by the PostgreSQL parent runner.
const timer = setTimeout(() => server.close(), 15 * 60_000);
server.on("close", () => {
  clearTimeout(timer);
  void pool.end();
});
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => server.close());
