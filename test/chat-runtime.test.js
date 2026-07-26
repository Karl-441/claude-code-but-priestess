const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildCodexExecArgs,
  normalizeCwd,
  resolveResumeSessionId
} = require("../src/main/chat-runtime");

test("session plans can force a fresh main-window session", () => {
  assert.equal(
    resolveResumeSessionId("codex", { resumeSessionId: null }, null),
    null
  );
  assert.equal(
    resolveResumeSessionId("codex", { resumeSessionId: "main-session" }, null),
    "main-session"
  );
});

test("custom session maps stay isolated from the main window", () => {
  assert.equal(
    resolveResumeSessionId(
      "codex",
      { resumeSessionId: "main-session" },
      { codex: "vscode-session" }
    ),
    "vscode-session"
  );
  assert.equal(
    resolveResumeSessionId(
      "claude",
      { resumeSessionId: "main-session" },
      {}
    ),
    null
  );
});

test("resumed Codex invocations put parent options before resume", () => {
  const invocation = buildCodexExecArgs({
    cwd: "/workspace",
    mode: "advisor",
    resumeSessionId: "00000000-0000-0000-0000-000000000000",
    model: "gpt-test",
    reasoningEffort: "ultra",
    screenshotPath: "/tmp/screen.png",
    attachmentArgs: ["-i", "/tmp/photo.png"],
    memoryDir: "/memory"
  });

  const resumeIndex = invocation.args.indexOf("resume");
  assert.ok(resumeIndex > 0);
  assert.ok(invocation.args.indexOf("-C") < resumeIndex);
  assert.ok(invocation.args.indexOf("-s") < resumeIndex);
  assert.ok(invocation.args.indexOf("--model") < resumeIndex);
  assert.ok(invocation.args.indexOf("-c") < resumeIndex);
  assert.equal(
    invocation.args[invocation.args.indexOf("-c") + 1],
    'model_reasoning_effort="ultra"'
  );
  assert.ok(invocation.args.indexOf("-i") > resumeIndex);
  assert.equal(invocation.args.includes("--add-dir"), false);
  assert.equal(invocation.resumed, true);
});

test("fresh Codex invocations never receive an empty cwd", () => {
  const invocation = buildCodexExecArgs({
    cwd: "",
    mode: "companion",
    memoryDir: "/memory"
  });
  const cwdIndex = invocation.args.indexOf("-C");
  assert.notEqual(invocation.args[cwdIndex + 1], "");
  assert.equal(invocation.args.includes("resume"), false);
  assert.equal(invocation.resumed, false);
  assert.equal(normalizeCwd("", "/safe/home"), "/safe/home");
});

test("maintenance confines its writable workspace to the memory directory", () => {
  const invocation = buildCodexExecArgs({
    cwd: "/project",
    mode: "maintenance",
    memoryDir: "/memory"
  });
  const cwdIndex = invocation.args.indexOf("-C");
  const sandboxIndex = invocation.args.indexOf("-s");
  assert.equal(invocation.args[cwdIndex + 1], "/memory");
  assert.equal(invocation.args[sandboxIndex + 1], "workspace-write");
  assert.equal(invocation.args.includes("--add-dir"), false);
});
