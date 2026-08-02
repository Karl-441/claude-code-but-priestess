/// <reference types="mocha" />
import * as assert from "assert";
import { ContextCapture } from "../../context-capture";
import { vscodeStub, resetVscodeStub } from "./helpers/vscode-stub";

// ContextCapture depends on vscode listeners (stubbed) and a ws client
// (mocked). The high-value logic here is pure: terminal output parsing,
// editor context snapshots and diagnostics aggregation.

function makeWsMock() {
  const listeners: Record<string, Function> = {};
  const calls: any[] = [];
  return {
    listeners,
    calls,
    on(type: string, cb: Function) { listeners[type] = cb; },
    send(type: string, data?: any) { calls.push({ type, data }); return Promise.resolve(); },
    isConnected() { return true; },
  };
}

function makeInstance() {
  const ws = makeWsMock();
  const cc = new ContextCapture(ws as any, {} as any);
  ws.calls.length = 0; // drop the constructor-time vscode:workspace send
  return { ws, cc };
}

function fakeEditor(overrides?: any) {
  const doc = {
    fileName: "C:\\work\\app.ts",
    languageId: "typescript",
    getText: () => "const x = 1;",
  };
  const selection = {
    isEmpty: false,
    active: { line: 4, character: 7 },
    start: { line: 2, character: 0 },
    end: { line: 4, character: 12 },
  };
  return { document: doc, selection, ...(overrides || {}) };
}

describe("context-capture", () => {
  let inst: ReturnType<typeof makeInstance> | null = null;

  beforeEach(() => resetVscodeStub());
  afterEach(() => {
    if (inst) { try { inst.cc.dispose(); } catch { /* ignore */ } inst = null; }
  });

  describe("parseTerminalOutput", () => {
    it("detects build/compilation failures", () => {
      inst = makeInstance();
      const evt = (inst.cc as any).parseTerminalOutput("Build failed\nsrc/main.ts:12:3 error TS2304");
      assert.ok(evt);
      assert.strictEqual(evt.kind, "build-error");
      assert.ok(evt.detail.includes("error TS2304"));
    });

    it("counts failing tests", () => {
      inst = makeInstance();
      const evt = (inst.cc as any).parseTerminalOutput("  4 failing\n  AssertionError ...");
      assert.ok(evt);
      assert.strictEqual(evt.kind, "test-fail");
      assert.ok(evt.detail.includes("4"), evt.detail);
    });

    it("detects passing tests", () => {
      inst = makeInstance();
      const evt = (inst.cc as any).parseTerminalOutput("  All tests passed");
      assert.ok(evt);
      assert.strictEqual(evt.kind, "test-pass");
    });

    it("ignores unrelated terminal noise", () => {
      inst = makeInstance();
      const evt = (inst.cc as any).parseTerminalOutput("hello world");
      assert.strictEqual(evt, null);
    });
  });

  describe("editor context", () => {
    it("snapshots the active editor with selection", () => {
      inst = makeInstance();
      (inst.cc as any).refreshContext(fakeEditor());
      const ctx = inst.cc.getCurrentContext();
      assert.strictEqual(ctx.activeFile, "C:\\work\\app.ts");
      assert.strictEqual(ctx.activeFileLanguage, "typescript");
      assert.strictEqual(ctx.cursorLine, 5);
      assert.strictEqual(ctx.cursorColumn, 8);
      assert.ok(ctx.selection);
      assert.strictEqual(ctx.selection!.startLine, 3);
      assert.strictEqual(ctx.selection!.endLine, 5);
    });

    it("clears context when no editor is active", () => {
      inst = makeInstance();
      (inst.cc as any).refreshContext(undefined);
      assert.strictEqual(inst.cc.getCurrentContext().activeFile, null);
      assert.strictEqual(inst.cc.getCurrentContext().selection, null);
    });
  });

  describe("diagnostics", () => {
    it("aggregates counts and caps detail entries at 50", () => {
      inst = makeInstance();
      const diags: any[] = [];
      for (let i = 0; i < 60; i++) {
        diags.push({
          severity: i % 2 === 0 ? vscodeStub.DiagnosticSeverity.Error : vscodeStub.DiagnosticSeverity.Warning,
          message: `problem ${i}`,
          range: { start: { line: i } },
          source: "ts",
        });
      }
      vscodeStub.languages._diagnostics = [["file:///a.ts", diags]];
      const snap = (inst.cc as any).captureDiagnostics();
      assert.strictEqual(snap.errors, 30);
      assert.strictEqual(snap.warnings, 30);
      assert.strictEqual(snap.totalFilesWithProblems, 1);
      assert.strictEqual(snap.details.length, 50, "details must be capped to avoid blowing the WS payload");
    });
  });

  describe("activity", () => {
    it("save events are throttled to one per 3 seconds", () => {
      inst = makeInstance();
      const send = (kind: string) =>
        (inst!.cc as any).sendActivity({ kind, detail: "x", timestamp: Date.now(), file: "f.ts" });

      send("save");
      send("save"); // within the throttle window -> dropped
      assert.strictEqual(inst.ws.calls.length, 1);
      assert.strictEqual(inst.ws.calls[0].type, "vscode:activity");
    });

    it("non-save activity is forwarded immediately", () => {
      inst = makeInstance();
      (inst.cc as any).sendActivity({ kind: "file-open", detail: "opened", timestamp: Date.now(), file: "f.ts" });
      assert.strictEqual(inst.ws.calls.length, 1);
      assert.strictEqual(inst.ws.calls[0].data.activity.kind, "file-open");
    });
  });
});
