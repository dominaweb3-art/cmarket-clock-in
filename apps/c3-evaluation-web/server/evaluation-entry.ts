import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Idl } from "@coral-xyz/anchor";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  EvaluationAuth,
  EVALUATION_ORIGIN,
} from "../../../services/c3-mainnet/src/evaluation-auth.ts";
import { EvaluationOwnerService } from "../../../services/c3-mainnet/src/evaluation-owner-service.ts";
import { assertEvaluationDatabase } from "../../../services/c3-mainnet/src/evaluation-scope.ts";
import type { EvaluationOwnerAction } from "../../../services/c3-mainnet/src/evaluation-client.ts";
import { EvaluationProvisionService } from "../../../services/c3-mainnet/src/evaluation-provision-service.ts";
import { EvaluationSettlementService } from "../../../services/c3-mainnet/src/evaluation-settlement-service.ts";
import { evaluationIdentities } from "./evaluation-identities.ts";
import { database } from "./database.mjs";
type Request = IncomingMessage & { body?: unknown };
type Response = ServerResponse & {
  status: (n: number) => Response;
  json: (v: unknown) => void;
};
const check = (v: unknown, code: string): void => {
  if (!v) throw Error(code);
};
const exactKeys = (body: Record<string, unknown>, allowed: string[]) =>
  check(
    Object.keys(body).every((k) => allowed.includes(k)),
    "EVAL_UNEXPECTED_CLIENT_FIELD",
  );
const bytes = (v: unknown, maximum: number) => {
  check(typeof v === "string" && v.length <= maximum * 2, "EVAL_PAYLOAD_SHAPE");
  const b = Buffer.from(v as string, "base64");
  check(
    b.length <= maximum && b.toString("base64") === v,
    "EVAL_PAYLOAD_SHAPE",
  );
  return b;
};
export default async function handler(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  try {
    check(
      !req.headers.origin || req.headers.origin === EVALUATION_ORIGIN,
      "EVAL_ORIGIN",
    );
    check(
      req.headers["content-type"]?.startsWith("application/json") &&
        Number(req.headers["content-length"] ?? 0) <= 8192 &&
        req.body &&
        typeof req.body === "object" &&
        !Array.isArray(req.body),
      "EVAL_BODY",
    );
    const body = req.body as Record<string, unknown>;
    check(
      JSON.stringify(body).length <= 8192 && typeof body.operation === "string",
      "EVAL_BODY",
    );
    const pool = database();
    await assertEvaluationDatabase(pool);
    const auth = new EvaluationAuth(pool);
    if (body.operation === "challenge") {
      exactKeys(body, ["operation", "wallet"]);
      check(typeof body.wallet === "string", "EVAL_WALLET");
      return res.status(200).json(await auth.challenge(body.wallet as string));
    }
    if (body.operation === "authenticate") {
      exactKeys(body, ["operation", "challengeId", "message", "signature"]);
      check(
        typeof body.challengeId === "string" &&
          typeof body.message === "string" &&
          body.message.length <= 1200,
        "EVAL_AUTH_SHAPE",
      );
      return res
        .status(200)
        .json(
          await auth.authenticate(
            body.challengeId as string,
            Buffer.from(body.message as string, "utf8"),
            bytes(body.signature, 64),
          ),
        );
    }
    const bearer = req.headers.authorization;
    check(
      typeof bearer === "string" && /^Bearer [a-f0-9]{64}$/.test(bearer),
      "EVAL_SESSION_REQUIRED",
    );
    const token = bearer!.slice(7);
    const idl = JSON.parse(
      readFileSync(
        join(process.cwd(), "resources/c3_pilot_vault.json"),
        "utf8",
      ),
    ) as Idl;
    const service = new EvaluationOwnerService(pool, idl);
    if (
      body.operation === "provision" ||
      body.operation === "advance" ||
      body.operation === "recover_initial_plan"
    ) {
      exactKeys(body, ["operation"]);
      await auth.authorize(token);
      const identities = evaluationIdentities(pool);
      return res
        .status(200)
        .json(
          body.operation === "provision"
            ? await new EvaluationProvisionService(
                pool,
                idl,
                identities,
              ).advance(token)
            : body.operation === "recover_initial_plan"
              ? await new EvaluationSettlementService(
                  pool,
                  idl,
                  identities,
                ).recoverInitialPlan(token)
              : await new EvaluationSettlementService(
                  pool,
                  idl,
                  identities,
                ).advance(token),
        );
    }
    if (body.operation === "position") {
      exactKeys(body, ["operation"]);
      return res.status(200).json(await service.position(token));
    }
    if (body.operation === "prepare") {
      exactKeys(body, ["operation", "action"]);
      check(
        [
          "deposit",
          "issue_shares",
          "request_redemption",
          "claim",
          "renew_plan",
          "recover_deposit_plan",
        ].includes(String(body.action)),
        "EVAL_ACTION",
      );
      return res
        .status(200)
        .json(
          await service.prepare(token, body.action as EvaluationOwnerAction),
        );
    }
    if (body.operation === "submit") {
      exactKeys(body, ["operation", "requestId", "packet"]);
      check(typeof body.requestId === "string", "EVAL_REQUEST");
      return res
        .status(200)
        .json(
          await service.submit(
            token,
            body.requestId as string,
            bytes(body.packet, 1232),
          ),
        );
    }
    if (body.operation === "reconcile") {
      exactKeys(body, ["operation", "requestId"]);
      check(typeof body.requestId === "string", "EVAL_REQUEST");
      return res
        .status(200)
        .json(await service.reconcile(token, body.requestId as string));
    }
    if (body.operation === "close_expired") {
      exactKeys(body, ["operation", "requestId"]);
      check(typeof body.requestId === "string", "EVAL_REQUEST");
      return res
        .status(200)
        .json(await service.closeExpired(token, body.requestId as string));
    }
    throw Error("EVAL_OPERATION");
  } catch (error) {
    // Never return raw PG/RPC errors, URLs, headers, secrets or signed payloads.
    const message = error instanceof Error ? error.message : "";
    // Operational diagnosis contains only allowlisted classifications, never
    // error text, SQL parameters, session credentials, wallets or payloads.
    const sqlState =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[0-9A-Z]{5}$/.test(error.code)
        ? error.code
        : undefined;
    console.error(
      JSON.stringify({
        event: "EVAL_SAFE_FAILURE",
        sqlState,
        kind:
          error instanceof TypeError
            ? "TYPE"
            : error instanceof RangeError
              ? "RANGE"
              : "OTHER",
        code: /^[A-Z][A-Z0-9_]{2,90}$/.test(message)
          ? message
          : "EVAL_REQUEST_BLOCKED",
      }),
    );
    const code = /^[A-Z][A-Z0-9_]{2,90}$/.test(message)
      ? message
      : sqlState
        ? `EVAL_DATABASE_${sqlState}`
        : /\b429\b/.test(message)
          ? "EVAL_RPC_RATE_LIMIT"
          : "EVAL_REQUEST_BLOCKED";
    const status = code.includes("RATE_LIMIT")
      ? 429
      : code.includes("SESSION") || code.includes("AUTH")
        ? 401
        : 409;
    return res.status(status).json({
      error: code,
      cluster: "solana:devnet",
      simulatedAssets: true,
      mainnetEnabled: false,
    });
  }
}
