// Shared directive parsing — extracted from chat.js so that both chat.js and
// vscode-chat.js can use the same regexes and handling logic without divergence.
// Currently used by chat.js; vscode-chat.js uses its own copies (to be migrated).

const persona = require("./persona");

// ---- Regex catalogue ----

const DIRECTIVE_RE = /\[\[\s*(?:mood\s*[:：]\s*([^\]]*?)|skill\s*[:：]\s*([a-z_]+)(?:\s+([^\]]*?))?|observe\s*[:：]\s*([^\]]*?)|remember\s*[:：]\s*([^\]]*?)|silent)\s*\]\]/gi;
const LENIENT_MOOD_HEAD_RE = /^\s*[\[（(]{0,2}\s*mood\s*[:：]\s*([a-zA-Z]+)\s*[\]）)]{0,2}[,，.。:：\s]*/i;
const LENIENT_MOOD_STREAM_RE = /\[\[\s*mood\s*[:：]\s*([a-zA-Z]+)\s*\](?=[^\]])[ \t]?/gi;
const LENIENT_MOOD_FINAL_RE = /\[\[\s*mood\s*[:：]\s*([a-zA-Z]+)\s*\](?!\])[ \t]?/gi;
const DIRECTIVE_PREFIXES = ["[[mood:", "[[skill:", "[[observe:", "[[remember:", "[[silent]]"];
const DIRECTIVE_PARTIAL_MAX = 240;

// ---- Mood normalisation ----

function normalizeMood(raw) {
  const mood = String(raw || "").trim().toLowerCase();
  if (mood === "happy") return "smile";
  if (mood === "threaten") return "threat";
  if (mood === "cry") return "sad";
  return mood;
}

// ---- Streaming consumer (chat.js pattern) ----
// Consumes incoming text, strips complete directive tags, and holds back
// trailing partial tags that might complete in the next chunk.

function consumeDirectives(text, tailBuffer, onDirective, emitMood) {
  const combined = tailBuffer + text;
  let out = combined.replace(DIRECTIVE_RE, onDirective);
  out = out.replace(LENIENT_MOOD_STREAM_RE, (_m, mood) => {
    if (emitMood) emitMood(normalizeMood(mood));
    return "";
  });

  // Check for trailing partial directive
  const lastOpen = out.lastIndexOf("[[");
  if (lastOpen !== -1 && !out.slice(lastOpen).includes("]]")) {
    const tail = out.slice(lastOpen);
    const norm = tail.replace(/\s+/g, "").toLowerCase();
    if (DIRECTIVE_PREFIXES.some((prefix) =>
      norm.length <= prefix.length ? prefix.startsWith(norm) : norm.startsWith(prefix)
    )) {
      if (tail.length < DIRECTIVE_PARTIAL_MAX) {
        return { text: out.slice(0, lastOpen), tail: tail };
      }
    }
  }

  // Lone "[" at end of chunk — might become "[[" in the next chunk
  if (out.endsWith("[")) {
    return { text: out.slice(0, -1), tail: "[" };
  }

  return { text: out, tail: "" };
}

// ---- Finalize safety net ----
// Strips ALL directive tags from completed text (side-effect-free version).

function stripDirectiveTags(text) {
  if (!text) return text;
  let out = String(text);
  const head = out.match(LENIENT_MOOD_HEAD_RE);
  if (head) {
    out = out.slice(head[0].length);
  }
  out = out
    .replace(DIRECTIVE_RE, "")
    .replace(LENIENT_MOOD_FINAL_RE, "")
    .replace(/\[?\[\s*(?:mood|skill|observe|remember|silent)\b[^\]]*$/i, "")
    .trim();
  return out;
}

// ---- Per-turn directive handler (chat.js pattern) ----
// Handles a single matched directive: mood → emitMood, skill → runSkill,
// observe → recordObservation, remember → appendMemoryEntry, silent → saw flag.

function handleDirective(full, mood, skillName, skillArg, observe, remember,
  { emitMood, skillsEnabled, silentTurnKind, runSkill, recordObservation }
) {
  if (mood !== undefined) {
    if (emitMood) emitMood(normalizeMood(mood));
  } else if (skillName) {
    if (skillsEnabled && !silentTurnKind) {
      runSkill(full, skillName, skillArg);
    }
  } else if (observe !== undefined) {
    if (recordObservation && silentTurnKind !== "maintenance") {
      recordObservation(observe);
    }
  } else if (remember !== undefined) {
    const text = (remember || "").trim();
    if (text) persona.appendMemoryEntry(text);
  } else {
    return { sawSilent: true };
  }
  return { sawSilent: false };
}

module.exports = {
  DIRECTIVE_RE,
  LENIENT_MOOD_HEAD_RE,
  LENIENT_MOOD_STREAM_RE,
  LENIENT_MOOD_FINAL_RE,
  DIRECTIVE_PREFIXES,
  DIRECTIVE_PARTIAL_MAX,
  normalizeMood,
  consumeDirectives,
  stripDirectiveTags,
  handleDirective,
};
