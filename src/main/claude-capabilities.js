const CLAUDE_REASONING_EFFORTS = Object.freeze([
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);

function isClaudeReasoningEffort(value) {
  return value === "" || CLAUDE_REASONING_EFFORTS.includes(String(value || ""));
}

function parseClaudeEffortLevels(helpText) {
  const source = String(helpText || "");
  const flagIndex = source.indexOf("--effort <level>");
  if (flagIndex === -1) return [];

  const excerpt = source.slice(flagIndex, flagIndex + 500);
  const choices = excerpt.match(/\(([^()]*)\)/)?.[1] || "";
  return CLAUDE_REASONING_EFFORTS.filter((effort) => (
    new RegExp(`(?:^|[\\s,])${effort}(?:$|[\\s,])`, "i").test(choices)
  ));
}

module.exports = {
  CLAUDE_REASONING_EFFORTS,
  isClaudeReasoningEffort,
  parseClaudeEffortLevels
};
