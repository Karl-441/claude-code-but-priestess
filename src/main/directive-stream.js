const DIRECTIVE_RE = /\[\[\s*(?:mood\s*[:：]\s*([^\]]*?)|skill\s*[:：]\s*([a-z_]+)(?:\s+([^\]]*?))?|observe\s*[:：]\s*([^\]]*?)|remember\s*[:：]\s*([^\]]*?)|silent)\s*\]\]/gi;
const LENIENT_MOOD_STREAM_RE = /\[\[\s*mood\s*[:：]\s*([a-zA-Z]+)\s*\](?=[^\]])[ \t]?/gi;
const LENIENT_MOOD_FINAL_RE = /\[\[\s*mood\s*[:：]\s*([a-zA-Z]+)\s*\](?!\])[ \t]?/gi;
const DIRECTIVE_PREFIXES = ["[[mood:", "[[skill:", "[[observe:", "[[remember:", "[[silent]]"];
const DIRECTIVE_PARTIAL_MAX = 240;

function couldStartDirective(tail) {
  const normalized = String(tail || "")
    .replace(/\s+/g, "")
    .replaceAll("：", ":")
    .toLowerCase();
  return DIRECTIVE_PREFIXES.some((prefix) =>
    normalized.length <= prefix.length
      ? prefix.startsWith(normalized)
      : normalized.startsWith(prefix)
  );
}

function capturedDirective(full, mood, skillName, skillArg, observe, remember) {
  if (mood !== undefined) return { type: "mood", value: mood, raw: full };
  if (skillName) return { type: "skill", name: skillName, arg: skillArg || "", raw: full };
  if (observe !== undefined) return { type: "observe", value: observe, raw: full };
  if (remember !== undefined) return { type: "remember", value: remember, raw: full };
  return { type: "silent", raw: full };
}

function consumeDirectiveChunk(state, text, onDirective) {
  const target = state || {};
  const notify = typeof onDirective === "function" ? onDirective : () => {};
  const buffered = String(target.tail || "") + String(text || "");
  const visible = buffered
    .replace(DIRECTIVE_RE, (full, mood, skillName, skillArg, observe, remember) => {
      notify(capturedDirective(full, mood, skillName, skillArg, observe, remember));
      return "";
    })
    .replace(LENIENT_MOOD_STREAM_RE, (full, mood) => {
      notify({ type: "mood", value: mood, raw: full });
      return "";
    });

  const lastOpen = visible.lastIndexOf("[[");
  if (lastOpen !== -1 && !visible.slice(lastOpen).includes("]]")) {
    const tail = visible.slice(lastOpen);
    if (couldStartDirective(tail) && tail.length < DIRECTIVE_PARTIAL_MAX) {
      target.tail = tail;
      return visible.slice(0, lastOpen);
    }
  }
  if (visible.endsWith("[")) {
    target.tail = "[";
    return visible.slice(0, -1);
  }
  target.tail = "";
  return visible;
}

function cleanDirectiveText(text) {
  if (!text) return "";
  return String(text)
    .replace(DIRECTIVE_RE, "")
    .replace(LENIENT_MOOD_FINAL_RE, "")
    .replace(/\[?\[\s*(?:mood|skill|observe|remember|silent)\b[^\]]*$/i, "")
    .trim();
}

module.exports = {
  cleanDirectiveText,
  consumeDirectiveChunk
};
