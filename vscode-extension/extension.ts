import * as vscode from "vscode";
import { WsClient } from "./src/ws-client";
import { ChatPanelProvider } from "./src/chat-panel";
import { ContextCapture } from "./src/context-capture";

let wsClient: WsClient | null = null;
let contextCapture: ContextCapture | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log("PRTS: activating…");

  wsClient = new WsClient(context);

  // Vibe coding: capture editor context, diagnostics, workspace, activity
  contextCapture = new ContextCapture(wsClient, context);
  context.subscriptions.push(contextCapture);

  const chatProvider = new ChatPanelProvider(context, wsClient, contextCapture);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("prts.chatView", chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ---- Commands ----

  context.subscriptions.push(
    vscode.commands.registerCommand("prts.openChat", () => {
      vscode.commands.executeCommand("workbench.view.extension.prts-sidebar");
    })
  );

  // Vibe coding: send selection to Priestess
  context.subscriptions.push(
    vscode.commands.registerCommand("prts.sendSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("PRTS: No active editor.");
        return;
      }
      const selection = editor.selection;
      if (selection.isEmpty) {
        vscode.window.showWarningMessage("PRTS: Select some code first.");
        return;
      }
      const text = editor.document.getText(selection);
      const ctx = contextCapture?.getCurrentContext();
      if (wsClient && wsClient.isConnected()) {
        wsClient.send("vscode:selection-to-chat", { text, context: ctx });
        vscode.commands.executeCommand("workbench.view.extension.prts-sidebar");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("prts.newConversation", () => {
      if (wsClient && wsClient.isConnected()) {
        wsClient.send("conversation:new");
        vscode.window.showInformationMessage("PRTS: started a new conversation");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("prts.restoreConversation", () => {
      if (wsClient && wsClient.isConnected()) {
        wsClient.send("conversation:restore");
        vscode.window.showInformationMessage("PRTS: restored previous conversation");
      }
    })
  );

  // Vibe coding: toggle companion ↔ advisor (VS Code extension doesn't need full agent)
  context.subscriptions.push(
    vscode.commands.registerCommand("prts.toggleVibeCoding", async () => {
      if (!wsClient || !wsClient.isConnected()) return;
      try {
        const res: any = await wsClient.send("settings:get");
        const state = res?.state || {};
        const current = state.vibeCodingMode || "companion";
        // Only companion and advisor — agent is the tray app's domain.
        const next = current === "companion" ? "advisor" : "companion";
        await wsClient.send("settings:set", { patch: { vibeCodingMode: next } });
        const labels: Record<string, string> = {
          companion: "💬 陪伴模式（仅聊天）",
          advisor: "👁 顾问模式（只读工具）",
        };
        vscode.window.showInformationMessage(`PRTS: ${labels[next]}`);
      } catch (_) { /* ignore */ }
    })
  );

  // Vibe coding: show current editor context info
  context.subscriptions.push(
    vscode.commands.registerCommand("prts.showContextInfo", () => {
      const ctx = contextCapture?.getCurrentContext();
      if (!ctx?.activeFile) {
        vscode.window.showInformationMessage("PRTS: No active editor.");
        return;
      }
      const file = ctx.activeFile.split(/[\\/]/).pop();
      const lines: string[] = [
        `📄 ${file}`,
        `   语言: ${ctx.activeFileLanguage || "unknown"}`,
        `   光标: L${ctx.cursorLine}:${ctx.cursorColumn}`,
      ];
      if (ctx.selection) {
        lines.push(`   已选中: L${ctx.selection.startLine}-${ctx.selection.endLine} (${ctx.selection.text.length} 字符)`);
      }
      const diag = contextCapture?.getDiagnostics();
      if (diag && diag.errors > 0) {
        lines.push(`   ⚠ 诊断: ${diag.errors} 错误, ${diag.warnings} 警告`);
      }
      vscode.window.showInformationMessage(lines.join("\n"), { modal: true });
    })
  );

  // Vibe coding: suggest a fix for the selected code / current line
  context.subscriptions.push(
    vscode.commands.registerCommand("prts.suggestFix", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("PRTS: No active editor.");
        return;
      }
      const doc = editor.document;
      const sel = editor.selection;
      // Use selection if non-empty, otherwise the current line.
      const range = sel.isEmpty
        ? doc.lineAt(sel.active.line).range
        : sel;
      const code = doc.getText(range);
      const file = doc.fileName.split(/[\\/]/).pop();
      const line = range.start.line + 1;
      const lang = doc.languageId;

      // Find diagnostics at this location
      const diags = vscode.languages.getDiagnostics(doc.uri)
        .filter((d) => d.range.intersection(range));
      const diagLines = diags.length
        ? diags.map((d) => `  - [${d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning"}] L${d.range.start.line + 1}: ${d.message}`).join("\n")
        : "";

      const prompt =
        `【博士的修复请求】\n` +
        `- 文件: ${file} (${lang})\n` +
        `- 位置: 第 ${line} 行\n` +
        (diagLines ? `- 诊断:\n${diagLines}\n` : "") +
        `\n博士选中的代码:\n\`\`\`${lang}\n${code}\n\`\`\`\n` +
        `\n请分析这段代码的问题并给出修复方案。用代码块展示修改后的完整代码。`;

      if (wsClient && wsClient.isConnected()) {
        wsClient.send("vscode:selection-to-chat", { text: prompt, context: contextCapture?.getCurrentContext() });
        vscode.commands.executeCommand("workbench.view.extension.prts-sidebar");
      }
    })
  );

  // ---- Window focus tracking ----

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (wsClient && wsClient.isConnected()) {
        wsClient.send("vscode:focus", { focused: state.focused });
      }
    })
  );

  // ---- Connection lifecycle ----

  let autoSwitchedToAdvisor = false;

  // On first connect: send vscode:active, sync advisor blacklist from VS Code config,
  // and auto-switch to advisor mode if a workspace is open.
  (wsClient as any).on("connected", () => {
    wsClient!.send("vscode:active");
    // Sync the advisor file blacklist from VS Code settings to Electron.
    const blacklist = vscode.workspace.getConfiguration("prts").get<string>("advisorFileBlacklist");
    if (typeof blacklist === "string") {
      wsClient!.send("settings:set", { patch: { advisorFileBlacklist: blacklist } });
    }
    // Auto-switch to advisor once per session when a workspace folder is present.
    if (!autoSwitchedToAdvisor) {
      const folders = vscode.workspace.workspaceFolders;
      if (folders && folders.length > 0) {
        wsClient!.send("settings:get").then((res: any) => {
          const mode = res?.state?.vibeCodingMode || "companion";
          if (mode === "companion") {
            wsClient!.send("settings:set", { patch: { vibeCodingMode: "advisor" } });
            autoSwitchedToAdvisor = true;
          }
        }).catch(() => {});
      }
    }
  });

  // After auth, the server sends conversation:has-previous.
  // Only prompt once per extension session — reconnects shouldn't re-ask.
  let hasPromptedRestore = false;

  (wsClient as any).on("conversation:has-previous", (msg: any) => {
    if (msg.hasPrevious && !hasPromptedRestore) {
      hasPromptedRestore = true;
      vscode.window
        .showInformationMessage(
          "PRTS: You have a previous conversation. Restore it?",
          "Restore",
          "Start Fresh"
        )
        .then((choice) => {
          if (choice === "Restore") {
            wsClient!.send("conversation:restore");
          } else if (choice === "Start Fresh") {
            wsClient!.send("conversation:new");
          }
        });
    }
  });

  console.log("PRTS: activated");
}

export function deactivate() {
  if (contextCapture) {
    contextCapture.dispose();
    contextCapture = null;
  }
  if (wsClient) {
    wsClient.dispose();
    wsClient = null;
  }
}
