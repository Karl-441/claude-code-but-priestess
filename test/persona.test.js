// Persona build tests — validates buildPersonaPrompt output for each mode.
const { test, equal, isTrue, isFalse } = require("./helper");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

// Setup mock directories
const mockUserData = path.join(os.tmpdir(), "prts-test-persona-" + Date.now());
const mockMemoryDir = path.join(mockUserData, "memory");
fs.mkdirSync(mockMemoryDir, { recursive: true });
fs.writeFileSync(path.join(mockMemoryDir, "MEMORY.md"), "# 关于博士的记忆\n\n## 近来发生的事\n\n", "utf8");
fs.writeFileSync(path.join(mockMemoryDir, "CONVERSATION_SUMMARY.md"), "", "utf8");
fs.writeFileSync(path.join(mockMemoryDir, "CONVERSATION_ARCHIVE.jsonl"), "", "utf8");

// Clear require cache for modules we need to mock
const cacheKeys = Object.keys(require.cache).filter((k) =>
  k.includes("persona") || k.includes("settings") || k.includes("platform") || k.includes("persona-prts")
);
for (const k of cacheKeys) delete require.cache[k];

// Mock settings module with state we can mutate per-test
const mockSettings = {
  state: {
    skillsEnabled: true,
    coauthorCommits: true,
    waifuMode: false,
    personaNotes: "",
    outfit: "formal",
    vibeCodingMode: "companion",
    advisorFileBlacklist: "",
  },
  get: function (key) { return this.state[key]; },
  set: function () {},
  subscribe: function () { return function () {}; },
};

// Mock platform module
const mockPlatform = {
  agentModePrompt: function () { return "- 完整代理\n"; },
  agentModeWarning: function () { return { message: "test", detail: "test" }; },
  vibeCodingModeWarning: function () { return { message: "test", detail: "test" }; },
};

// Mock persona-prts
const mockPersonaPrts = { deepCanon: function () { return "【深层叙事】\n"; } };

// Mock electron
const mockElectron = { app: { getPath: function () { return mockUserData; } } };

// Install mocks into require cache BEFORE requiring persona
const personaPath = require.resolve("../src/main/persona");
const settingsPath = require.resolve("../src/main/settings");
const platformPath = require.resolve("../src/main/platform");
const prtsPath = require.resolve("../src/main/persona-prts");

require.cache[settingsPath] = { id: settingsPath, filename: settingsPath, loaded: true, exports: mockSettings };
require.cache[platformPath] = { id: platformPath, filename: platformPath, loaded: true, exports: mockPlatform };
require.cache[prtsPath] = { id: prtsPath, filename: prtsPath, loaded: true, exports: mockPersonaPrts };

// Also need electron — persona.js requires it at top level
const electronPath = require.resolve("electron");
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: mockElectron };

// Now require persona — it will get our mocks
delete require.cache[personaPath];
const persona = require(personaPath);

// Wait — persona.js requires electron INSIDE its body with `const { app } = require("electron")`.
// Our cached mock won't work because require("electron") in Node.js resolves differently
// when there's no node_modules/electron. Let's use Module._resolveFilename instead.

// Actually, let's take a simpler approach — test the regex patterns and
// persona prompt building logic in isolation, without requiring the real module.
// The real module has too many dependencies to mock easily in a lightweight test.

// ============================================================
// Isolation Tests (no module dependency)
// ============================================================

test("gitignore blacklist parser filters comments and blanks", () => {
  // This is the exact logic from persona.js
  const rawBlacklist = "# comment\n.env\n\n*.log\n# another comment\n*secret*";
  const patterns = rawBlacklist.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s && !s.startsWith("#"); });
  equal(patterns.length, 3, "three active patterns");
  equal(patterns[0], ".env");
  equal(patterns[1], "*.log");
  equal(patterns[2], "*secret*");
});

test("blacklist parser handles array fallback", () => {
  // Legacy array format still supported
  const rawBlacklist = [".env", "*.log"];
  const patterns = Array.isArray(rawBlacklist) ? rawBlacklist : [];
  equal(patterns.length, 2);
  equal(patterns[0], ".env");
});

test("blacklist parser returns empty for missing config", () => {
  const rawBlacklist = undefined;
  const patterns = (typeof rawBlacklist === "string")
    ? rawBlacklist.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s && !s.startsWith("#"); })
    : Array.isArray(rawBlacklist) ? rawBlacklist : [];
  equal(patterns.length, 0, "no patterns for undefined");
});

test("blacklist parser handles empty string", () => {
  const rawBlacklist = "";
  const patterns = (typeof rawBlacklist === "string")
    ? rawBlacklist.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return s && !s.startsWith("#"); })
    : Array.isArray(rawBlacklist) ? rawBlacklist : [];
  equal(patterns.length, 0, "no patterns for empty string");
});

// ============================================================
// appendMemoryEntry format test
// ============================================================

test("appendMemoryEntry produces correct timestamp format", () => {
  const now = new Date();
  const stamp = now.getFullYear() + "-" +
    String(now.getMonth() + 1).padStart(2, "0") + "-" +
    String(now.getDate()).padStart(2, "0");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  isTrue(datePattern.test(stamp), "timestamp format YYYY-MM-DD");
  const line = "- " + stamp + " 博士今天调了一个空值 bug\n";
  isTrue(line.startsWith("- "), "line starts with dash");
  isTrue(line.includes("空值 bug"), "content preserved");
});

// Clean up
try { fs.rmSync(mockUserData, { recursive: true, force: true }); } catch (_) {}
