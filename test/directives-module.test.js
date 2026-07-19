// Tests for the shared directives.js module — verifies the exported regex
// catalogue and utility functions work correctly in isolation.
const { test, equal, isTrue, isFalse } = require("./helper");
const directives = require("../src/main/directives");

// ============================================================
// Regex catalogue
// ============================================================

test("DIRECTIVE_RE matches mood (ASCII colon)", () => {
  // Reset lastIndex — shared regex with 'g' flag accumulates state across tests.
  directives.DIRECTIVE_RE.lastIndex = 0;
  const m = directives.DIRECTIVE_RE.exec("[[mood:smile]]");
  isTrue(m !== null, "match found");
  if (m) equal(m[1], "smile");
});

test("DIRECTIVE_RE matches mood (full-width colon)", () => {
  directives.DIRECTIVE_RE.lastIndex = 0;
  const m = directives.DIRECTIVE_RE.exec("[[mood：calm]]");
  isTrue(m !== null, "full-width colon match");
  if (m) equal(m[1], "calm");
});

test("DIRECTIVE_RE matches skill with arg", () => {
  directives.DIRECTIVE_RE.lastIndex = 0;
  const m = directives.DIRECTIVE_RE.exec("[[skill:play_music Eclipse]]");
  isTrue(m !== null, "skill match");
  if (m) {
    equal(m[2], "play_music", "skill name");
    equal(m[3], "Eclipse", "skill arg");
  }
});

test("DIRECTIVE_RE matches skill without arg", () => {
  directives.DIRECTIVE_RE.lastIndex = 0;
  const m = directives.DIRECTIVE_RE.exec("[[skill:note]]");
  isTrue(m !== null, "skill without arg");
  if (m) equal(m[2], "note");
});

test("DIRECTIVE_RE matches remember", () => {
  directives.DIRECTIVE_RE.lastIndex = 0;
  const m = directives.DIRECTIVE_RE.exec("[[remember:博士在用 React]]");
  isTrue(m !== null, "remember match");
  if (m) equal(m[5], "博士在用 React");
});

test("DIRECTIVE_RE matches observe", () => {
  directives.DIRECTIVE_RE.lastIndex = 0;
  const m = directives.DIRECTIVE_RE.exec("[[observe:他在编码]]");
  isTrue(m !== null, "observe match");
  if (m) equal(m[4], "他在编码");
});

test("DIRECTIVE_RE matches silent", () => {
  directives.DIRECTIVE_RE.lastIndex = 0;
  isTrue(directives.DIRECTIVE_RE.test("[[silent]]"), "silent match");
  directives.DIRECTIVE_RE.lastIndex = 0;
  isTrue(directives.DIRECTIVE_RE.test("[[ silent ]]"), "silent with spaces");
});

// ============================================================
// normalizeMood
// ============================================================

test("normalizeMood maps aliases", () => {
  equal(directives.normalizeMood("happy"), "smile");
  equal(directives.normalizeMood("threaten"), "threat");
  equal(directives.normalizeMood("cry"), "sad");
  equal(directives.normalizeMood("smile"), "smile");
  equal(directives.normalizeMood("HAPPY"), "smile", "case insensitive");
  equal(directives.normalizeMood(""), "");
});

// ============================================================
// stripDirectiveTags (side-effect-free final cleanup)
// ============================================================

test("stripDirectiveTags removes all directive types", () => {
  const input = "[[mood:smile]] 博士你好 [[skill:play_music Eclipse]] [[remember:test]] [[observe:coding]] [[silent]] 再见";
  const out = directives.stripDirectiveTags(input);
  isFalse(/\[\[mood/.test(out), "mood stripped");
  isFalse(/\[\[skill/.test(out), "skill stripped");
  isFalse(/\[\[remember/.test(out), "remember stripped");
  isFalse(/\[\[silent/.test(out), "silent stripped");
  isTrue(out.includes("博士你好"), "visible text preserved");
  isTrue(out.includes("再见"), "visible text preserved");
});

test("stripDirectiveTags handles trailing partial", () => {
  equal(directives.stripDirectiveTags("博士你好 [[mood:ha"), "博士你好");
  equal(directives.stripDirectiveTags(""), "");
});

test("stripDirectiveTags handles lenient mood head", () => {
  const out = directives.stripDirectiveTags("mood:smile 博士你好");
  isFalse(out.includes("mood"), "lenient head stripped");
  isTrue(out.includes("博士你好"), "text preserved");
});

// ============================================================
// consumeDirectives (streaming redaction)
// ============================================================

test("consumeDirectives strips complete tags from stream", () => {
  let sawMood = null;
  // onDirective handles full [[mood:X]] tags via DIRECTIVE_RE. emitMood handles
  // lenient single-bracket [[mood:x] tags via LENIENT_MOOD_STREAM_RE only.
  const result = directives.consumeDirectives(
    "博士你好 [[mood:smile]]", "",
    () => "", // just strip complete directives
    (m) => { sawMood = m; } // only fires for lenient tags
  );
  equal(result.tail, "", "no trailing partial");
  isFalse(/\[\[mood/.test(result.text), "mood tag stripped");
  isTrue(result.text.includes("博士你好"), "text preserved");
  // sawMood stays null — the mood was a strict DIRECTIVE_RE match, not lenient.
  equal(sawMood, null, "emitMood not called for strict [[mood:smile]] tag");
});

test("consumeDirectives holds back cross-chunk partial", () => {
  const result = directives.consumeDirectives(
    "博士你好 [[mood:", "", () => "", null
  );
  equal(result.tail, "[[mood:", "partial held back");
  isTrue(result.text.includes("博士你好"), "text preserved");
  isFalse(result.text.includes("[[mood"), "partial not leaked");
});

test("consumeDirectives reconstructs cross-chunk tag", () => {
  // First chunk left "[[mood:" in the tail
  const result = directives.consumeDirectives(
    "smile]] 今天不错", "[[mood:", () => "", null
  );
  equal(result.tail, "", "tag completed, tail cleared");
  isFalse(/\[\[mood/.test(result.text), "reconstructed tag stripped");
  isTrue(result.text.includes("今天不错"), "text preserved");
});

test("consumeDirectives handles lone [ at end", () => {
  const result = directives.consumeDirectives(
    "博士你好 [", "", () => "", null
  );
  equal(result.tail, "[", "lone bracket held back");
  isTrue(result.text.includes("博士你好"), "text preserved");
});

// ============================================================
// DIRECTIVE_PREFIXES completeness
// ============================================================

test("DIRECTIVE_PREFIXES covers all 5 types", () => {
  equal(directives.DIRECTIVE_PREFIXES.length, 5, "exactly 5 prefix types");
  isTrue(directives.DIRECTIVE_PREFIXES.includes("[[mood:"), "mood prefix");
  isTrue(directives.DIRECTIVE_PREFIXES.includes("[[skill:"), "skill prefix");
  isTrue(directives.DIRECTIVE_PREFIXES.includes("[[observe:"), "observe prefix");
  isTrue(directives.DIRECTIVE_PREFIXES.includes("[[remember:"), "remember prefix");
  isTrue(directives.DIRECTIVE_PREFIXES.includes("[[silent]]"), "silent prefix");
});
