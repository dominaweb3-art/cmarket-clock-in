/** Test-only process boundary for disposable PostgreSQL restart verification. */
import { PostgresC3Repository } from "../src/postgres.ts";
import { authorizationFixture, fixtureSignature } from "./fixtures.ts";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (
  !url ||
  url.hostname !== "127.0.0.1" ||
  !/^c3_test_[a-f0-9]{12}$/.test(url.pathname.slice(1)) ||
  url.pathname.slice(1) !== process.env.C3_DISPOSABLE_TEST_DATABASE
)
  throw new Error("Disposable PostgreSQL test environment required.");

const repository = await PostgresC3Repository.fromServerEnvironment();
try {
  if (process.argv[2] === "write") {
    const authorization = authorizationFixture();
    await repository.createIntent({
      intentId: authorization.intentId,
      idempotencyKey: authorization.idempotencyKey,
      configurationVersion: authorization.configurationVersion,
      configurationHash: authorization.configurationHash,
      wallet: authorization.wallet,
      operation: authorization.operation,
      inputAmountBaseUnits: BigInt(authorization.inputAmountBaseUnits),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await repository.transition(authorization.intentId, 1n, "awaiting_wallet");
    await repository.createAuthorization(authorization.intentId, 2n);
    await repository.transition(
      authorization.intentId,
      3n,
      "intent_submitted",
      {
        submittedSignature: fixtureSignature,
      },
    );
    process.stdout.write(
      JSON.stringify({
        intentId: authorization.intentId,
        authorizationHash: authorization.authorizationHash,
      }),
    );
  } else if (process.argv[2] === "read") {
    const intentId = process.argv[3];
    const intent = await repository.readIntent(intentId);
    const authorization = await repository.readAuthorization(intentId);
    if (
      intent?.state !== "intent_submitted" ||
      intent.submittedSignature !== fixtureSignature ||
      intent.authorizationHash !== authorization.authorizationHash
    )
      throw new Error("Process-restart state mismatch.");
    process.stdout.write(
      JSON.stringify({
        state: intent.state,
        signaturePreserved: true,
        authorizationVerified: true,
      }),
    );
  } else {
    throw new Error("Unknown disposable process test mode.");
  }
} finally {
  await repository.close();
}
