import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluationErrorCode } from "../src/evaluation-errors.ts";
test("native protocol failures are not falsely reported as user cancellation", () => {
  assert.equal(
    evaluationErrorCode({
      code: "JSON_RPC_ERROR",
      userInfo: { jsonRpcErrorCode: -2 },
    }),
    "EVAL_MWA_INVALID_PAYLOAD",
  );
  assert.equal(evaluationErrorCode({ code: -3 }), "EVAL_MWA_NOT_SIGNED");
  assert.equal(
    evaluationErrorCode({ code: "ERROR_SESSION_TIMEOUT" }),
    "EVAL_MWA_SESSION_TIMEOUT",
  );
  assert.equal(
    evaluationErrorCode(Error("EVAL_MESSAGE_REJECTED")),
    "EVAL_MESSAGE_REJECTED",
  );
  assert.equal(
    evaluationErrorCode(new TypeError("secret native details")),
    "EVAL_RUNTIME_TYPE_ERROR",
  );
  assert.equal(
    evaluationErrorCode(Error("secret native details")),
    "EVAL_UNEXPECTED_ERROR",
  );
  assert.equal(evaluationErrorCode(null), "EVAL_UNEXPECTED_ERROR");
  assert.equal(
    evaluationErrorCode(
      Error("fetch failed: java.net.SocketException: private endpoint reset"),
    ),
    "EVAL_NETWORK_REQUEST_FAILED",
  );
  assert.equal(
    evaluationErrorCode(
      Error("fetch failed: SSLHandshakeException private endpoint"),
    ),
    "EVAL_NETWORK_TLS_ERROR",
  );
  assert.equal(
    evaluationErrorCode(
      Error("fetch failed: Unable to resolve host private endpoint"),
    ),
    "EVAL_NETWORK_DNS_ERROR",
  );
  assert.equal(
    evaluationErrorCode(new SyntaxError("private response body")),
    "EVAL_RESPONSE_PARSE_ERROR",
  );
  assert.equal(
    evaluationErrorCode({ message: "Network request failed" }),
    "EVAL_NETWORK_REQUEST_FAILED",
  );
  assert.equal(
    evaluationErrorCode({ message: "operation aborted" }),
    "EVAL_REQUEST_TIMEOUT",
  );
  assert.equal(
    evaluationErrorCode("EVAL_MESSAGE_REJECTED"),
    "EVAL_MESSAGE_REJECTED",
  );
});
