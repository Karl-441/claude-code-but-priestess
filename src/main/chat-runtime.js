const os = require("node:os");

function normalizeCwd(value, fallback = os.homedir()) {
  const requested = String(value || "").trim();
  if (requested) return requested;
  const safeFallback = String(fallback || "").trim();
  return safeFallback || process.cwd();
}

function resolveResumeSessionId(provider, sessionPlan, customSessionIds) {
  // Passing a custom map means the caller owns an isolated session namespace
  // (the VS Code bridge). Never fall back to the popover's module-level ids.
  if (customSessionIds !== null && customSessionIds !== undefined) {
    const value = customSessionIds[provider];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }
  const planned = sessionPlan?.resumeSessionId;
  return typeof planned === "string" && planned.trim() ? planned.trim() : null;
}

function appendImageArgs(args, screenshotPath, attachmentArgs) {
  if (screenshotPath) args.push("-i", screenshotPath);
  if (Array.isArray(attachmentArgs)) args.push(...attachmentArgs);
}

function buildCodexExecArgs({
  cwd,
  mode = "companion",
  resumeSessionId = null,
  model = "",
  reasoningEffort = "",
  screenshotPath = null,
  attachmentArgs = [],
  memoryDir = ""
}) {
  const isAgent = mode === "agent";
  const isMaintenance = mode === "maintenance";
  const effectiveCwd = normalizeCwd(isMaintenance ? memoryDir : cwd);
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--skip-git-repo-check",
    "-C",
    effectiveCwd
  ];

  if (model) args.push("--model", model);
  if (reasoningEffort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
  }
  if (isAgent) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    // Persona and memory are already injected by PRTS. Do not add the memory
    // directory as a writable root for normal read-only conversations.
    args.push("-s", isMaintenance ? "workspace-write" : "read-only");
  }

  if (resumeSessionId) {
    // -C/-s are parent `codex exec` options and must precede `resume`.
    // Image flags are accepted by the resume subcommand and stay after it.
    args.push("resume");
    appendImageArgs(args, screenshotPath, attachmentArgs);
    args.push(resumeSessionId, "-");
  } else {
    appendImageArgs(args, screenshotPath, attachmentArgs);
    args.push("-");
  }

  return { args, cwd: effectiveCwd, resumed: Boolean(resumeSessionId) };
}

// Downscaled copies of one turn's images share a directory, so naming them
// after the original alone lets two attachments picked from different folders
// collide — the second write silently replaces the first and the backend is
// handed the same picture twice. The position in the turn disambiguates them.
function attachmentTempName(originalPath, index) {
  const base = String(originalPath || "").split(/[\\/]/).pop() || "image";
  return `${String(index).padStart(2, "0")}-${base.replace(/\.[^.]+$/, "")}.png`;
}

module.exports = {
  attachmentTempName,
  buildCodexExecArgs,
  normalizeCwd,
  resolveResumeSessionId
};
