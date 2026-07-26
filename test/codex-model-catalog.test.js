const test = require("node:test");
const assert = require("node:assert/strict");

const {
  codexVersionsMatch,
  compatibleReasoningEffort,
  findCatalogModel,
  normalizeCodexVersion,
  parseCodexModelCatalog,
  parseTopLevelTomlString
} = require("../src/main/codex-model-catalog");

const CATALOG = JSON.stringify({
  models: [
    {
      slug: "gpt-older",
      display_name: "Older",
      visibility: "list",
      priority: 5,
      default_reasoning_level: "medium",
      supported_reasoning_levels: [
        { effort: "low" },
        { effort: "medium" },
        { effort: "high" }
      ]
    },
    {
      slug: "gpt-5.6-sol",
      display_name: "GPT-5.6-Sol",
      visibility: "list",
      priority: 1,
      default_reasoning_level: "medium",
      supported_reasoning_levels: [
        { effort: "ultra" },
        { effort: "medium" },
        { effort: "max" },
        { effort: "low" }
      ]
    },
    {
      slug: "hidden-model",
      visibility: "hide",
      supported_reasoning_levels: [{ effort: "high" }]
    }
  ]
});

test("Codex catalog exposes visible models and their current reasoning levels", () => {
  const catalog = parseCodexModelCatalog(`warning\n${CATALOG}`);
  assert.deepEqual(catalog.map((model) => model.slug), ["gpt-5.6-sol", "gpt-older"]);
  assert.deepEqual(
    findCatalogModel(catalog, "gpt-5.6-sol").reasoningEfforts,
    ["low", "medium", "max", "ultra"]
  );
  assert.equal(findCatalogModel(catalog, "hidden-model"), null);
});

test("Codex version normalization compares CLI and cache version strings", () => {
  assert.equal(normalizeCodexVersion("codex-cli 0.144.0-alpha.4"), "0.144.0-alpha.4");
  assert.equal(normalizeCodexVersion("0.142.5"), "0.142.5");
  assert.equal(codexVersionsMatch("0.144.0", "codex-cli 0.144.0-alpha.4"), true);
  assert.equal(codexVersionsMatch("0.144.0-alpha.1", "0.144.0-alpha.4"), false);
  assert.equal(codexVersionsMatch("0.142.5", "codex-cli 0.144.0-alpha.4"), false);
});

test("top-level Codex model config does not read values from profiles", () => {
  const config = [
    'model = "gpt-5.6-sol" # default',
    'model_reasoning_effort = "ultra"',
    "",
    "[profiles.fast]",
    'model = "gpt-older"'
  ].join("\n");
  assert.equal(parseTopLevelTomlString(config, "model"), "gpt-5.6-sol");
  assert.equal(parseTopLevelTomlString(config, "model_reasoning_effort"), "ultra");
});

test("unsupported reasoning effort falls back to the model default", () => {
  const catalog = parseCodexModelCatalog(CATALOG);
  const model = findCatalogModel(catalog, "gpt-older");
  assert.equal(compatibleReasoningEffort(model, "ultra"), "medium");
  assert.equal(compatibleReasoningEffort(model, "high"), "high");
});
