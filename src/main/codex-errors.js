function nestedErrorText(value, depth = 0) {
  if (value == null || depth > 5) return "";

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const nested = nestedErrorText(JSON.parse(text), depth + 1);
        if (nested) return nested;
      } catch {
        /* keep the original text */
      }
    }
    return text;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => nestedErrorText(item, depth + 1))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value !== "object") return String(value);

  for (const key of ["message", "error", "reason", "detail", "details"]) {
    const text = nestedErrorText(value[key], depth + 1);
    if (text) return text;
  }
  return "";
}

function codexEventErrorText(event) {
  if (!event || typeof event !== "object") return "";

  const type = String(event.type || "");
  const item = event.item || event.event?.item || null;
  const itemType = String(item?.type || "");
  const isError =
    type.includes("error") ||
    type.endsWith(".failed") ||
    itemType.includes("error");
  if (!isError) return "";

  return (
    nestedErrorText(event.error) ||
    nestedErrorText(item?.error) ||
    nestedErrorText(item?.message) ||
    nestedErrorText(event.message) ||
    nestedErrorText(event.reason)
  );
}

function isCodexModelMetadataWarning(text) {
  return /model metadata\b.*\bnot found/i.test(String(text || ""));
}

function withoutCodexModelMetadataWarnings(text) {
  return String(text || "").replace(
    /model metadata\b[^\r\n]{0,240}?\bnot found\b(?:\.\s*defaulting to fallback metadata\.?)?/gi,
    ""
  );
}

function isCodexModelUnavailableError(text) {
  const message = withoutCodexModelMetadataWarnings(text);
  if (!message.trim()) return false;
  return (
    /\b(?:model_not_found|unsupported_model)\b/i.test(message) ||
    /\bmodel\b.{0,180}\b(?:is not supported|is not available|does not exist|unknown|not found)\b/is.test(message)
  );
}

function isCodexReasoningEffortUnavailableError(text) {
  const message = String(text || "");
  if (!message) return false;
  const mentionsEffort =
    /\bmodel_reasoning_effort\b/i.test(message) ||
    /\breasoning[._ ](?:effort|level)\b/i.test(message) ||
    /\bReasoningEffortParam\b/i.test(message);
  const rejectsValue =
    /\b(?:invalid|invalid_enum_value|unsupported|not supported|not available|unknown|expected|supported values)\b/i.test(message);
  return mentionsEffort && rejectsValue;
}

function classifyCodexRejection(text) {
  if (isCodexReasoningEffortUnavailableError(text)) return "reasoning";
  if (isCodexModelUnavailableError(text)) return "model";
  return "";
}

module.exports = {
  classifyCodexRejection,
  codexEventErrorText,
  isCodexModelMetadataWarning,
  isCodexModelUnavailableError,
  isCodexReasoningEffortUnavailableError
};
