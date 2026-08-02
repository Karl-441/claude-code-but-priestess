/**
 * Vibe coding: captures VS Code editor context, diagnostics, workspace info,
 * and activity events.  Sends snapshots to the Electron backend via WebSocket
 * so Priestess can participate in the coding session.
 */

import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorContext {
  activeFile: string | null;
  activeFileLanguage: string | null;
  cursorLine: number;
  cursorColumn: number;
  selection: SelectionSnapshot | null;
}

export interface SelectionSnapshot {
  text: string;
  startLine: number;
  endLine: number;
}

export interface DiagnosticsSnapshot {
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
  totalFilesWithProblems: number;
  details: DiagnosticDetail[];
}

export interface DiagnosticDetail {
  file: string;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  line: number;
  source: string;
}

export interface ActivityEvent {
  kind: "save" | "task-start" | "task-end" | "task-error" | "git-commit" | "git-branch-switch" | "file-open" | "terminal-output";
  detail: string;
  timestamp: number;
  file: string;
}

export interface TerminalEvent {
  kind: "build-error" | "test-fail" | "test-pass" | "lint-warning";
  detail: string;
  source: string; // terminal name
  timestamp: number;
}

// ---------------------------------------------------------------------------
// ContextCapture
// ---------------------------------------------------------------------------

export class ContextCapture {
  private wsClient: any;
  private currentContext: EditorContext;
  private diagnosticsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private contextDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private diagnosticsSnapshot: DiagnosticsSnapshot | null = null;
  private disposables: vscode.Disposable[] = [];
  private gitWatcher: vscode.Disposable | null = null;

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  constructor(wsClient: any, context: vscode.ExtensionContext) {
    this.wsClient = wsClient;
    this.currentContext = this.emptyContext();

    // Send workspace paths on connect
    this.wsClient.on("connected", () => {
      this.sendWorkspace();
    });

    // ---- Editor context listeners ----

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this.refreshContext(editor);
        this.flushContext();
      })
    );

    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        this.refreshContext(e.textEditor);
        this.debounceContextFlush();
      })
    );

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.sendWorkspace();
      })
    );

    // ---- Diagnostics ----

    this.disposables.push(
      vscode.languages.onDidChangeDiagnostics(() => {
        this.debounceDiagnosticsFlush();
      })
    );

    // ---- Activity ----

    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.sendActivity({
          kind: "save",
          detail: `Saved ${doc.fileName.split(/[\\/]/).pop()}`,
          timestamp: Date.now(),
          file: doc.fileName,
        });
      })
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.sendActivity({
            kind: "file-open",
            detail: `Opened ${editor.document.fileName.split(/[\\/]/).pop()}`,
            timestamp: Date.now(),
            file: editor.document.fileName,
          });
        }
      })
    );

    // ---- Tasks ----

    try {
      this.disposables.push(
        vscode.tasks.onDidStartTask((e) => {
          this.sendActivity({
            kind: "task-start",
            detail: `Task started: ${e.execution.task.name}`,
            timestamp: Date.now(),
            file: e.execution.task.definition?.program || "",
          });
        })
      );
      this.disposables.push(
        // onDidEndTask gives a TaskEndEvent with no process outcome at all;
        // the old code tried to read exitCode from the task *definition*, but
        // that is static JSON from tasks.json and never carries a runtime
        // exit code - so every task end was misreported as "failed".
        // onDidEndTaskProcess exposes the real process exit code, so success
        // (0) and failure (non-zero) are now reported accurately.
        vscode.tasks.onDidEndTaskProcess((e) => {
          this.sendActivity({
            kind: e.exitCode === 0 ? "task-end" : "task-error",
            detail: `Task ${e.execution.task.name} ${e.exitCode === 0 ? "completed" : "failed"}`,
            timestamp: Date.now(),
            file: e.execution.task.definition?.program || "",
          });
        })
      );
    } catch {
      // tasks API unavailable in some VS Code variants
    }

    // ---- Git (optional, best-effort) ----
    this.tryWatchGit(context);

    // ---- Terminal output monitoring ----
    try {
      let terminalBuffer = "";
      let terminalDebounceTimer: ReturnType<typeof setTimeout> | null = null;
      this.disposables.push(
        (vscode.window as any).onDidWriteTerminalData((e: any) => {
          terminalBuffer += String(e.data || "");
          if (terminalDebounceTimer) clearTimeout(terminalDebounceTimer);
          terminalDebounceTimer = setTimeout(() => {
            terminalDebounceTimer = null;
            const txt = terminalBuffer;
            terminalBuffer = "";
            const parsed = this.parseTerminalOutput(txt);
            if (parsed) {
              this.wsClient.send("vscode:terminal-event", parsed);
            }
          }, 500); // debounce: wait 500ms of silence before parsing
        })
      );
    } catch {
      // onDidWriteTerminalData unavailable in some VS Code versions
    }

    // Send initial context
    this.refreshContext(vscode.window.activeTextEditor);
    this.sendWorkspace();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Returns the last captured editor context (for attaching to chat messages). */
  getCurrentContext(): EditorContext {
    return this.currentContext;
  }

  /** Returns the latest diagnostics snapshot (may be null if never captured). */
  getDiagnostics(): DiagnosticsSnapshot | null {
    return this.diagnosticsSnapshot;
  }

  /** Forces an immediate context flush to the Electron backend. */
  flushContext(): void {
    if (!this.wsClient?.isConnected()) return;
    this.wsClient.send("vscode:context", { context: this.currentContext });
  }

  dispose(): void {
    for (const d of this.disposables) {
      try { d.dispose(); } catch (_) { /* ignore */ }
    }
    this.disposables.length = 0;
    if (this.gitWatcher) {
      try { this.gitWatcher.dispose(); } catch (_) { /* ignore */ }
      this.gitWatcher = null;
    }
    if (this.diagnosticsDebounceTimer) {
      clearTimeout(this.diagnosticsDebounceTimer);
      this.diagnosticsDebounceTimer = null;
    }
    if (this.contextDebounceTimer) {
      clearTimeout(this.contextDebounceTimer);
      this.contextDebounceTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Internals — context
  // -----------------------------------------------------------------------

  private emptyContext(): EditorContext {
    return {
      activeFile: null,
      activeFileLanguage: null,
      cursorLine: 0,
      cursorColumn: 0,
      selection: null,
    };
  }

  private refreshContext(editor: vscode.TextEditor | undefined): void {
    if (!editor) {
      this.currentContext = this.emptyContext();
      return;
    }
    const doc = editor.document;
    const sel = editor.selection;
    const selectionText = sel.isEmpty
      ? null
      : doc.getText(sel);

    this.currentContext = {
      activeFile: doc.fileName,
      activeFileLanguage: doc.languageId,
      cursorLine: sel.active.line + 1,
      cursorColumn: sel.active.character + 1,
      selection: selectionText
        ? {
            text: selectionText,
            startLine: sel.start.line + 1,
            endLine: sel.end.line + 1,
          }
        : null,
    };
  }

  private debounceContextFlush(): void {
    if (this.contextDebounceTimer) clearTimeout(this.contextDebounceTimer);
    this.contextDebounceTimer = setTimeout(() => {
      this.contextDebounceTimer = null;
      this.flushContext();
    }, 800);
  }

  // -----------------------------------------------------------------------
  // Internals — diagnostics
  // -----------------------------------------------------------------------

  private captureDiagnostics(): DiagnosticsSnapshot {
    const all = vscode.languages.getDiagnostics();
    const details: DiagnosticDetail[] = [];
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    let hints = 0;

    for (const [uri, diags] of all) {
      for (const d of diags) {
        const severity =
          d.severity === vscode.DiagnosticSeverity.Error ? "error" :
          d.severity === vscode.DiagnosticSeverity.Warning ? "warning" :
          d.severity === vscode.DiagnosticSeverity.Information ? "info" :
          "hint";

        if (severity === "error") errors++;
        else if (severity === "warning") warnings++;
        else if (severity === "info") infos++;
        else hints++;

        details.push({
          file: uri.fsPath,
          severity,
          message: d.message,
          line: d.range.start.line + 1,
          source: d.source || "",
        });
      }
    }

    // Cap details at 50 entries to avoid blowing up WS payload (large projects
    // can produce thousands of diagnostics, potentially exceeding maxPayload).
    const MAX_DETAILS = 50;
    if (details.length > MAX_DETAILS) details.length = MAX_DETAILS;

    return {
      errors,
      warnings,
      infos,
      hints,
      totalFilesWithProblems: all.filter(([_, ds]) => ds.length > 0).length,
      details,
    };
  }

  private debounceDiagnosticsFlush(): void {
    if (this.diagnosticsDebounceTimer) clearTimeout(this.diagnosticsDebounceTimer);
    this.diagnosticsDebounceTimer = setTimeout(() => {
      this.diagnosticsDebounceTimer = null;
      this.diagnosticsSnapshot = this.captureDiagnostics();
      if (!this.wsClient?.isConnected()) return;
      this.wsClient.send("vscode:diagnostics", {
        diagnostics: this.diagnosticsSnapshot,
      });
    }, 2000); // 2s debounce — diagnostics can fire in bursts
  }

  // -----------------------------------------------------------------------
  // Internals — workspace
  // -----------------------------------------------------------------------

  private sendWorkspace(): void {
    if (!this.wsClient?.isConnected()) return;
    const folders = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
    this.wsClient.send("vscode:workspace", {
      workspaceFolders: folders,
      primaryWorkspace: folders[0] || null,
    });
  }

  // -----------------------------------------------------------------------
  // Internals — activity
  // -----------------------------------------------------------------------

  private sendActivity(activity: ActivityEvent): void {
    if (!this.wsClient?.isConnected()) return;
    // Suppress high-frequency saves (only send if > 3s since last save)
    if (activity.kind === "save") {
      this.sendActivityImpl("vscode:activity", { activity });
    } else {
      this.wsClient.send("vscode:activity", { activity });
    }
  }

  private lastSaveTs = 0;
  private sendActivityImpl(type: string, payload: any): void {
    const now = Date.now();
    if (payload.activity?.kind === "save") {
      if (now - this.lastSaveTs < 3000) return;
      this.lastSaveTs = now;
    }
    this.wsClient.send(type, payload);
  }

  // -----------------------------------------------------------------------
  // Internals — terminal output parsing
  // -----------------------------------------------------------------------

  private parseTerminalOutput(text: string): TerminalEvent | null {
    // Detect build/test/lint results from terminal output.
    if (/Build failed|Compilation failed|error TS\d+/.test(text)) {
      const lines = text.split("\n").filter((l: string) => /error|Error|FAIL/i.test(l));
      return {
        kind: "build-error",
        detail: lines.slice(0, 5).join("\n") || "Build/compilation error detected",
        source: "terminal",
        timestamp: Date.now(),
      };
    }
    if (/(\d+)\s+failing|Tests:\s+\d+\s+failed|FAIL\s/.test(text)) {
      const failMatch = text.match(/(\d+)\s+failing/);
      const failCount = failMatch ? parseInt(failMatch[1], 10) : 1;
      return {
        kind: "test-fail",
        detail: `${failCount} test${failCount > 1 ? "s" : ""} failing`,
        source: "terminal",
        timestamp: Date.now(),
      };
    }
    if (/All tests passed|Tests:\s+\d+\s+passed.*0\s+failed/.test(text)) {
      return {
        kind: "test-pass",
        detail: "All tests passed",
        source: "terminal",
        timestamp: Date.now(),
      };
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // Internals — git (best-effort)
  // -----------------------------------------------------------------------

  private tryWatchGit(context: vscode.ExtensionContext): void {
    try {
      // The git extension API is not directly importable — detect at runtime
      const gitExt = vscode.extensions.getExtension("vscode.git");
      if (!gitExt) return;
      Promise.resolve(gitExt.activate()).then((api: any) => {
        if (!api || !api.repositories) return;
        for (const repo of api.repositories) {
          this.gitWatcher = repo.state.onDidChange(() => {
            // Heuristic: detect new commits by monitoring HEAD changes
            this.sendActivity({
              kind: "git-branch-switch",
              detail: `HEAD changed in ${repo.rootUri?.fsPath || "repo"}`,
              timestamp: Date.now(),
              file: repo.rootUri?.fsPath || "",
            });
          });
          break; // watch first repo only
        }
      }, () => { /* git not available */ });
    } catch {
      // Git extension not available — silently ignore
    }
  }
}
