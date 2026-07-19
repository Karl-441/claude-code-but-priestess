import * as vscode from "vscode";

const DEBOUNCE_MS = 300;
const MIN_PREFIX_LENGTH = 3;

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingResolve: ((items: vscode.InlineCompletionItem[]) => void) | null = null;

  constructor(private wsClient: any) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    // Get the text before the cursor (last few lines for context).
    const lineStart = Math.max(0, position.line - 5);
    const prefixRange = new vscode.Range(lineStart, 0, position.line, position.character);
    const prefix = document.getText(prefixRange);

    if (prefix.trim().length < MIN_PREFIX_LENGTH) return [];

    // Cancel any pending request.
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // If a previous request was pending (race condition), swallow it.
    if (this.pendingResolve) {
      this.pendingResolve([]);
      this.pendingResolve = null;
    }

    return new Promise<vscode.InlineCompletionItem[]>((resolve) => {
      this.pendingResolve = resolve;
      this.debounceTimer = setTimeout(async () => {
        this.debounceTimer = null;
        this.pendingResolve = null;
        try {
          if (!this.wsClient?.isConnected()) { resolve([]); return; }
          // Skip if no CLI provider available — don't waste requests.
          const avail = this.wsClient._providerAvailability;
          if (avail && (!avail.activeProvider || avail.activeProvider === "priestess")) {
            resolve([]); return;
          }
          const lang = document.languageId;
          const file = document.fileName.split(/[\\/]/).pop();

          // Send a lightweight completion request.
          const result = await this.wsClient.request("chat:inline-complete", {
            prefix,
            file,
            language: lang,
          });

          if (_token.isCancellationRequested || !result?.text) {
            resolve([]);
            return;
          }

          // Return the completion as ghost text.
          const item = new vscode.InlineCompletionItem(
            result.text,
            new vscode.Range(position, position)
          );
          resolve([item]);
        } catch {
          resolve([]);
        }
      }, DEBOUNCE_MS);
    });
  }

  dispose() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.pendingResolve = null;
  }
}
