/** Server-only adapter for the existing append-only journals. No Mainnet guard
 * is changed. Callers cannot choose a schema, chain or program. */
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import type { Pool } from "pg";

export const EVALUATION = Object.freeze({
  genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  program: "2rZgxofn8kTsahAHPiaLTw7FZcw4MxzLK9cKowZ5HPcg",
  router: "F9yXLAA7tvWSCmXnAT8xRqTMHDuwFsgMbDThrde6uHs7",
  governance: "6zjEHckd2nM4bMYwnisS2quE1Zw8VYZTqhwWjM6mtQC",
  keeper: "AKjLi6aSrQLTTnRSzshCEhXfjxhRM6fTdDGvi6suNTk7",
  quotes: "BzaghA843f8Zep96V5mgT7snttFcL8RtvqDRHetgoiRQ",
  cluster: "solana:devnet",
  simulatedAssets: true,
  mainnetEnabled: false,
  // Devnet-only release: exact deployed bytes and 19 hosted provisioning
  // effects verified on 2026-10-09; focused custody/renewal/effect tests pass.
  // This permits test-token acceptance, not a claim of completed physical QA
  // or Mainnet capability. Never selected through an environment value.
  lifecycleReady: true,
  amount: 1_000_000n,
  weights: Object.freeze([4000, 3000, 3000]),
});

export function evaluationPdas(wallet: string) {
  const owner = new PublicKey(wallet);
  if (!PublicKey.isOnCurve(owner.toBytes()))
    throw Error("EVAL_WALLET_NOT_ON_CURVE");
  const program = new PublicKey(EVALUATION.program);
  const derive = (name: string) =>
    PublicKey.findProgramAddressSync(
      [
        createHash("sha256")
          .update(Buffer.from(name))
          .update(owner.toBytes())
          .digest(),
      ],
      program,
    )[0];
  return Object.freeze({
    vault: derive("c3-vault-v1"),
    authority: derive("c3-authority-v1"),
  });
}

/** Only existing journal-qualified SQL is relocated. Query objects/prepared
 * statements and every other custody schema are rejected, not rewritten. */
export function evaluationJournalSql(sql: unknown): string {
  if (
    typeof sql !== "string" ||
    /\bc3\.|\bc3_eval\.|\b(public|auth|storage)\./i.test(sql)
  )
    throw Error("EVAL_JOURNAL_QUERY_SCOPE");
  return sql.replaceAll("c3_open.", "c3_eval.");
}

/** The physical PG client, transactions, CAS and immutable triggers are reused;
 * this adapter is not an in-memory journal or permission to enroll production. */
export function evaluationJournalPool(pool: Pool): Pool {
  const wrap = (target: object): object =>
    new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property);
        if (property === "query")
          return (sql: unknown, ...args: unknown[]) =>
            value.call(object, evaluationJournalSql(sql), ...args);
        if (property === "connect")
          return async () => wrap(await value.call(object));
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
  return wrap(pool) as Pool;
}

export async function assertEvaluationDatabase(pool: Pool) {
  const { rows } = await pool.query(
    "SELECT genesis,program,router,simulated_assets,mainnet_enabled FROM c3_eval.release_configuration WHERE singleton=true",
  );
  const r = rows[0];
  if (
    rows.length !== 1 ||
    r.genesis !== EVALUATION.genesis ||
    r.program !== EVALUATION.program ||
    r.router !== EVALUATION.router ||
    r.simulated_assets !== true ||
    r.mainnet_enabled !== false
  )
    throw Error("EVAL_DATABASE_RELEASE_SCOPE");
}
