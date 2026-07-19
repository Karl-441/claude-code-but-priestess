import * as vscode from "vscode";
import { WsClient } from "./src/ws-client";
import { ChatPanelProvider } from "./src/chat-panel";
import { ContextCapture } from "./src/context-capture";
import { InlineCompletionProvider } from "./src/inline-provider";

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

  // Inline completion provider (ghost text) — registered for all languages.
  const inlineProvider = new InlineCompletionProvider(wsClient);
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" }, inlineProvider
    )
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

  // Vibe coding: explain the error at cursor position
  context.subscriptions.push(
    vscode.commands.registerCommand("prts.explainError", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("PRTS: No active editor.");
        return;
      }
      const doc = editor.document;
      const pos = editor.selection.active;
      const line = doc.lineAt(pos.line);
      const file = doc.fileName.split(/[\\/]/).pop();
      const lang = doc.languageId;

      // Find diagnostics at cursor position
      const diags = vscode.languages.getDiagnostics(doc.uri)
        .filter((d) => d.range.contains(pos));
      const diagText = diags.length
        ? diags.map((d) => `[${d.severity === vscode.DiagnosticSeverity.Error ? "error" : "warning"}] ${d.message}`).join("\n")
        : "(no diagnostic at cursor — using the current line for context)";

      const code = line.text.trim() || "(empty line)";
      const prompt =
        `【博士的提问 — 解释错误】\n` +
        `- 文件: ${file} (${lang})\n` +
        `- 位置: 第 ${pos.line + 1} 行\n` +
        `- 诊断:\n${diagText}\n` +
        `- 该行代码:\n\`\`\`${lang}\n${code}\n\`\`\`\n` +
        `\n请解释这个错误的原因，并给出具体的修复方案。`;

      if (wsClient && wsClient.isConnected()) {
        wsClient.send("vscode:selection-to-chat", { text: prompt, context: contextCapture?.getCurrentContext() });
        vscode.commands.executeCommand("workbench.view.extension.prts-sidebar");
      }
    })
  );

  // Vibe coding: review the current file
  context.subscriptions.push(
    vscode.commands.registerCommand("prts.reviewFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("PRTS: No active editor.");
        return;
      }
      const doc = editor.document;
      const file = doc.fileName.split(/[\\/]/).pop();
      const lang = doc.languageId;
      const text = doc.getText();
      // Truncate very large files
      const MAX_LEN = 80_000;
      const truncated = text.length > MAX_LEN
        ? text.slice(0, MAX_LEN) + `\n…(文件共 ${text.length} 字符，已截断前 ${MAX_LEN} 字符)`
        : text;

      const prompt =
        `【博士的请求 — 审查文件】\n` +
        `- 文件: ${file} (${lang})\n` +
        `- 共 ${doc.lineCount} 行，${text.length} 字符\n` +
        `\n请审查这个文件，找出潜在的问题、代码异味、安全隐患和改进建议。\n` +
        `\n\`\`\`${lang}\n${truncated}\n\`\`\``;

      if (wsClient && wsClient.isConnected()) {
        wsClient.send("vscode:selection-to-chat", { text: prompt, context: contextCapture?.getCurrentContext() });
        vscode.commands.executeCommand("workbench.view.extension.prts-sidebar");
      }
    })
  );

  // Vibe coding: summarize recent git changes
  context.subscriptions.push(
    vscode.commands.registerCommand("prts.summarizeChanges", async () => {
      try {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || !folders.length) {
          vscode.window.showWarningMessage("PRTS: No workspace folder open.");
          return;
        }
        const cwd = folders[0].uri.fsPath;
        const { execSync } = require("child_process");
        let gitInfo = "";
        try {
          const log = execSync('git log --oneline -10', { cwd, encoding: "utf8", timeout: 5000 }).trim();
          const diffStat = execSync('git diff --stat HEAD~5..HEAD', { cwd, encoding: "utf8", timeout: 5000 }).trim();
          gitInfo = `最近 10 次 commit:\n${log}\n\n最近 5 次改动的文件:\n${diffStat}`;
        } catch {
          gitInfo = "(无法获取 git 信息——当前工作区可能不是 git 仓库)";
        }

        const prompt =
          `【博士的请求 — 总结近期改动】\n` +
          `${gitInfo}\n` +
          `\n请用简洁的语言总结最近的代码改动，指出潜在的风险区域。`;

        if (wsClient && wsClient.isConnected()) {
          wsClient.send("vscode:selection-to-chat", { text: prompt, context: contextCapture?.getCurrentContext() });
          vscode.commands.executeCommand("workbench.view.extension.prts-sidebar");
        }
      } catch (err) {
        vscode.window.showErrorMessage("PRTS: Failed to summarize changes — " + (err as Error).message);
      }
    })
  );

  // Vibe coding: generate tests for selected code
  context.subscriptions.push(
    vscode.commands.registerCommand("prts.generateTests", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("PRTS: No active editor.");
        return;
      }
      const doc = editor.document;
      const sel = editor.selection;
      const range = sel.isEmpty
        ? new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length)
        : sel;
      const code = doc.getText(range);
      const file = doc.fileName.split(/[\\/]/).pop();
      const lang = doc.languageId;
      // Truncate very large selections
      const MAX_SEL = 20_000;
      const truncated = code.length > MAX_SEL
        ? code.slice(0, MAX_SEL) + `\n…(选中代码共 ${code.length} 字符，已截断)`
        : code;

      // Generate a test scenario prompt based on language
      const testLang = lang === "typescript" || lang === "javascript" ? "Jest" :
        lang === "python" ? "pytest" : lang === "java" ? "JUnit" : "单元测试";
      const prompt =
        `【博士的请求 — 生成测试】\n` +
        `- 文件: ${file} (${lang})\n` +
        `- 测试框架: ${testLang}\n` +
        (sel.isEmpty ? `- 范围: 整个文件 (${doc.lineCount} 行)\n` : `- 范围: L${range.start.line + 1}-L${range.end.line + 1}\n`) +
        `\n请为以下代码生成${testLang}测试，覆盖：\n` +
        `1. 正常路径（happy path）\n` +
        `2. 边界条件（null/undefined、空数组、极值）\n` +
        `3. 错误路径（异常处理）\n` +
        `\n用代码块展示测试代码。\n` +
        `\n\`\`\`${lang}\n${truncated}\n\`\`\``;

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
