import assert from "node:assert/strict";
import test from "node:test";
import { classifyModelError } from "../src/model/model-service.js";
import { BridgeError } from "../src/errors.js";

test("DeepSeek errors map to stable product states", () => {
  assert.deepEqual(classifyModelError(new Error("HTTP 401 unauthorized")), {
    status: "auth_error",
    code: "deepseek_auth_error",
    message: "DeepSeek 凭证验证失败。",
    httpStatus: 401,
    retryable: false
  });
  assert.equal(classifyModelError(new Error("insufficient balance")).status, "quota_error");
  assert.equal(classifyModelError(new Error("429 rate limit")).status, "rate_limited");
  assert.equal(classifyModelError(new Error("fetch failed: ECONNRESET")).status, "unavailable");
  assert.equal(classifyModelError(new Error("unexpected provider response")).status, "error");
});

test("DeepSeek model errors preserve a safe actionable message", () => {
  assert.deepEqual(classifyModelError(new BridgeError(400, "model_not_found", "Pi 未找到所选 DeepSeek 模型。", false)), {
    status: "error",
    code: "model_not_found",
    message: "Pi 未找到所选 DeepSeek 模型。",
    httpStatus: 400,
    retryable: false
  });
  assert.deepEqual(classifyModelError(new Error("Model does not exist")), {
    status: "error",
    code: "deepseek_model_unavailable",
    message: "DeepSeek 当前未开放或无法识别所选模型。",
    httpStatus: 400,
    retryable: false
  });
});
