import assert from "node:assert/strict";
import test from "node:test";
import { evaluationContextFixture } from "./evaluation-leg-context.test.ts";
import { evaluationPlanRecovery } from "../src/evaluation-plan-recovery.ts";
test("finalized plan metadata selects renewal at exact expiry and binds partial progress", async () => {
  for (const direction of [1, 2] as const)
    for (const leg of [0, 1, 2]) {
      const f = await evaluationContextFixture(direction, leg),
        raw = f.accounts.get(String(f.planAddress))!;
      const bytes = Buffer.from(raw.data[0]!, "base64"),
        expires = Number(bytes.readBigInt64LE(706));
      const result = evaluationPlanRecovery(
        f.c,
        direction,
        String(leg),
        expires,
        raw,
      );
      assert.equal(result.state, "expired");
      assert.equal(result.executedBitmap, [0, 1, 3][leg]);
      assert.equal(
        evaluationPlanRecovery(f.c, direction, String(leg), expires - 1, raw)
          .state,
        "ready",
      );
      assert.equal(
        evaluationPlanRecovery(f.c, direction, String(leg), expires + 1, raw)
          .state,
        "expired",
      );
      assert.equal(
        evaluationPlanRecovery(f.c, direction, String(leg), expires, null)
          .state,
        "missing",
      );
      assert.throws(
        () =>
          evaluationPlanRecovery(f.c, direction, String(leg + 1), expires, raw),
        /EVAL_RECOVERY_PLAN_EVIDENCE/,
      );
      assert.throws(
        () =>
          evaluationPlanRecovery(
            f.c,
            direction === 1 ? 2 : 1,
            String(leg),
            expires,
            raw,
          ),
        /EVAL_RECOVERY_PLAN_EVIDENCE/,
      );
      for (const offset of [9, 17, 49, 81, 113, 713]) {
        const changed = Buffer.from(bytes);
        changed[offset] = changed[offset]! ^ 255;
        assert.throws(() =>
          evaluationPlanRecovery(f.c, direction, String(leg), expires, {
            ...raw,
            data: [changed.toString("base64"), "base64"],
          }),
        );
      }
      assert.throws(() =>
        evaluationPlanRecovery(f.c, direction, String(leg), expires, {
          ...raw,
          owner: "11111111111111111111111111111111",
        }),
      );
    }
});
