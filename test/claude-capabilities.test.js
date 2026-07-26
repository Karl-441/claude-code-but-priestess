const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isClaudeReasoningEffort,
  parseClaudeEffortLevels
} = require("../src/main/claude-capabilities");

test("Claude help exposes the effort levels accepted by the selected CLI", () => {
  const help = [
    "Options:",
    "  --effort <level>                      Effort level for the current session",
    "                                        (low, medium, high, xhigh, max)",
    "  --model <model>                       Model for the current session"
  ].join("\n");
  assert.deepEqual(
    parseClaudeEffortLevels(help),
    ["low", "medium", "high", "xhigh", "max"]
  );
});

test("Claude effort support stays hidden for an older CLI without the flag", () => {
  assert.deepEqual(parseClaudeEffortLevels("Options:\n  --model <model>"), []);
  assert.equal(isClaudeReasoningEffort("xhigh"), true);
  assert.equal(isClaudeReasoningEffort("ultra"), false);
});
