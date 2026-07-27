const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyCodexRejection,
  codexEventErrorText,
  isCodexModelMetadataWarning,
  isCodexModelUnavailableError,
  isCodexReasoningEffortUnavailableError
} = require("../src/main/codex-errors");

test("nested Codex turn.failed events expose model rejections", () => {
  const event = {
    type: "turn.failed",
    error: {
      message: JSON.stringify({
        type: "error",
        status: 400,
        error: {
          type: "invalid_request_error",
          message: "The 'gpt-new' model is not supported for this account."
        }
      })
    }
  };

  const message = codexEventErrorText(event);
  assert.equal(message, "The 'gpt-new' model is not supported for this account.");
  assert.equal(classifyCodexRejection(message), "model");
  assert.equal(isCodexModelUnavailableError(message), true);
  assert.equal(isCodexReasoningEffortUnavailableError(message), false);
});

test("invalid Codex reasoning effort is not misclassified as a model rejection", () => {
  const event = {
    type: "item.completed",
    item: {
      type: "error",
      error: {
        message:
          "[ReasoningEffortParam] [reasoning.effort] [invalid_enum_value] " +
          "Invalid value: 'extreme'. Supported values are: 'low', 'medium', and 'high'."
      }
    }
  };

  const message = codexEventErrorText(event);
  assert.equal(classifyCodexRejection(message), "reasoning");
  assert.equal(isCodexReasoningEffortUnavailableError(message), true);
  assert.equal(isCodexModelUnavailableError(message), false);
});

test("Codex metadata fallback warnings do not trigger a model fallback", () => {
  const event = {
    type: "item.completed",
    item: {
      type: "error",
      message: "Model metadata for `gpt-new` not found. Defaulting to fallback metadata."
    }
  };

  const message = codexEventErrorText(event);
  assert.equal(isCodexModelMetadataWarning(message), true);
  assert.equal(isCodexModelUnavailableError(message), false);
  assert.equal(classifyCodexRejection(message), "");
  assert.equal(
    classifyCodexRejection(`${message} The model 'gpt-bad' is not available.`),
    "model"
  );
});

test("unrecognized Codex errors remain unclassified", () => {
  const message = codexEventErrorText({
    type: "turn.failed",
    error: { message: "The transport closed before the response completed." }
  });

  assert.match(message, /transport closed/i);
  assert.equal(classifyCodexRejection(message), "");
});
