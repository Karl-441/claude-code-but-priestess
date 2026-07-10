const VSCODE_WS_ORIGIN = "vscode-webview://prts";

function isAllowedWsOrigin(value) {
  const origin = String(value || "").toLowerCase();
  if (!origin) return false;
  if (origin.startsWith("vscode-webview://")) return true;
  if (origin === "file://") return true;
  if (origin.startsWith("http://127.0.0.1:")) return true;
  if (origin.startsWith("http://localhost:")) return true;
  return false;
}

module.exports = { VSCODE_WS_ORIGIN, isAllowedWsOrigin };
