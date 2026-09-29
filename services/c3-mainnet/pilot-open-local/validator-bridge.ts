/** Disposable PostgreSQL adapter for the isolated validator test only. */
import pg from "pg";

import {
  applyOpenLocalMigration,
  OpenLocalSettlementRepository,
} from "./orchestrator.ts";

export async function openValidatorJournal(): Promise<{
  pool: pg.Pool;
  db: OpenLocalSettlementRepository;
  close: () => Promise<void>;
}> {
  const url = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : null;
  if (
    !url ||
    url.hostname !== "127.0.0.1" ||
    !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
    url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE ||
    url.username !== process.env.C3_DISPOSABLE_TEST_DATABASE
  )
    throw new Error("C3_OPEN_DISPOSABLE_DATABASE_REQUIRED");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  try {
    const client = await pool.connect();
    try {
      await applyOpenLocalMigration(client);
    } finally {
      client.release();
    }
    const db = await OpenLocalSettlementRepository.fromVerifiedPool(pool);
    return { pool, db, close: () => pool.end() };
  } catch (error) {
    await pool.end();
    throw error;
  }
}
