const REASONING_EFFORT_ORDER = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra"
]);

function isReasoningEffort(value) {
  return value === "" || /^[a-z][a-z0-9_-]{0,31}$/.test(String(value || ""));
}

function reasoningEffortRank(value) {
  const index = REASONING_EFFORT_ORDER.indexOf(value);
  return index === -1 ? REASONING_EFFORT_ORDER.length : index;
}

function normalizeReasoningEfforts(value) {
  if (!Array.isArray(value)) return [];
  const efforts = value
    .map((entry) => typeof entry === "string" ? entry : entry?.effort)
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter((entry) => entry && isReasoningEffort(entry));
  return Array.from(new Set(efforts)).sort((left, right) => {
    const rankDiff = reasoningEffortRank(left) - reasoningEffortRank(right);
    return rankDiff || left.localeCompare(right);
  });
}

function jsonCandidates(stdout) {
  const raw = String(stdout || "").trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.includes("\"models\""));
  return Array.from(new Set([raw, ...lines]));
}

function parseCodexModelCatalog(stdout) {
  for (const candidate of jsonCandidates(stdout)) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed.models)) continue;
      return parsed.models
        .map((model, index) => ({ model, index }))
        .filter(({ model }) => model && model.visibility === "list" && model.slug)
        .sort((left, right) => {
          const leftPriority = Number.isFinite(Number(left.model.priority))
            ? Number(left.model.priority)
            : left.index;
          const rightPriority = Number.isFinite(Number(right.model.priority))
            ? Number(right.model.priority)
            : right.index;
          return leftPriority - rightPriority || left.index - right.index;
        })
        .map(({ model }) => ({
          slug: String(model.slug),
          displayName: String(model.display_name || model.slug),
          defaultReasoningEffort: String(model.default_reasoning_level || "").trim().toLowerCase(),
          reasoningEfforts: normalizeReasoningEfforts(model.supported_reasoning_levels)
        }));
    } catch {
      /* try the next JSON candidate */
    }
  }
  return null;
}

function normalizeCodexVersion(value) {
  const match = String(value || "").match(/\b(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : "";
}

function codexVersionsMatch(left, right) {
  const leftVersion = normalizeCodexVersion(left);
  const rightVersion = normalizeCodexVersion(right);
  if (!leftVersion || !rightVersion) return false;
  // Some bundled alpha CLIs report an alpha suffix from `--version` while
  // their model cache records only the matching major.minor.patch client.
  if (leftVersion.includes("-") && rightVersion.includes("-")) {
    return leftVersion === rightVersion;
  }
  return leftVersion.split("-")[0] === rightVersion.split("-")[0];
}

function findCatalogModel(catalog, slug) {
  const target = String(slug || "").trim();
  if (!target || !Array.isArray(catalog)) return null;
  return catalog.find((model) => model.slug === target) || null;
}

function compatibleReasoningEffort(model, requested) {
  const effort = String(requested || "").trim().toLowerCase();
  const supported = Array.isArray(model?.reasoningEfforts) ? model.reasoningEfforts : [];
  if (!effort || !supported.length || supported.includes(effort)) return effort;
  if (supported.includes(model.defaultReasoningEffort)) return model.defaultReasoningEffort;
  if (supported.includes("medium")) return "medium";
  return supported[0] || "";
}

function parseTopLevelTomlString(source, key) {
  const escapedKey = String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escapedKey) return "";
  const assignment = new RegExp(`^\\s*${escapedKey}\\s*=\\s*(.+?)\\s*$`);
  for (const line of String(source || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Once a TOML table starts, later assignments belong to that table rather
    // than the root config that supplies Codex's ordinary defaults.
    if (trimmed.startsWith("[")) break;
    const match = line.match(assignment);
    if (!match) continue;
    const value = match[1].trim();
    const doubleQuoted = value.match(/^("(?:\\.|[^"\\])*")\s*(?:#.*)?$/);
    if (doubleQuoted) {
      try { return JSON.parse(doubleQuoted[1]); } catch { return ""; }
    }
    const singleQuoted = value.match(/^'([^']*)'\s*(?:#.*)?$/);
    if (singleQuoted) return singleQuoted[1];
    const bare = value.match(/^([A-Za-z0-9_.-]+)\s*(?:#.*)?$/);
    if (bare) return bare[1];
    return "";
  }
  return "";
}

module.exports = {
  REASONING_EFFORT_ORDER,
  codexVersionsMatch,
  compatibleReasoningEffort,
  findCatalogModel,
  isReasoningEffort,
  normalizeCodexVersion,
  parseCodexModelCatalog,
  parseTopLevelTomlString
};
