// A stand-in for the `vscode` module, enough to load the extension in vitest and see what it registers.
// Uri is VS Code's own implementation (vscode-uri); everything else records calls or does nothing.
import { URI, Utils } from 'vscode-uri';

export const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
export const registeredSchemes: string[] = [];
export const createdViews: string[] = [];

const disposable = () => ({ dispose() {} });

/** Anything: callable, constructible, every property another stub. */
function anything(): any {
  const fn = function () {
    return anything();
  };
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      if (prop === 'dispose') return () => undefined;
      if (prop === Symbol.toPrimitive) return () => '';
      return anything();
    },
    set: () => true,
    apply: () => anything(),
    construct: () => anything(),
  });
}

export class Uri {
  static from(components: { scheme: string; path?: string; query?: string; authority?: string; fragment?: string }) {
    return URI.from(components);
  }
  static file(path: string) {
    return URI.file(path);
  }
  static parse(value: string) {
    return URI.parse(value);
  }
  static joinPath(base: URI, ...segments: string[]) {
    return Utils.joinPath(base, ...segments);
  }
}

export class EventEmitter<T> {
  private listeners = new Set<(e: T) => void>();
  event = (listener: (e: T) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(e: T) {
    for (const l of this.listeners) l(e);
  }
  dispose() {
    this.listeners.clear();
  }
}

export class Range {
  constructor(
    readonly startLine: number,
    readonly startCharacter: number,
    readonly endLine: number,
    readonly endCharacter: number,
  ) {}
}

export class MarkdownString {
  supportThemeIcons = false;
  supportHtml = false;
  constructor(public value = '') {}
}

export class ThemeColor {
  constructor(readonly id: string) {}
}
export class ThemeIcon {
  constructor(readonly id: string) {}
}
export class FileDecoration {
  constructor(
    readonly badge?: string,
    readonly tooltip?: string,
    readonly color?: ThemeColor,
  ) {}
}
export class TreeItem {
  label?: string;
  resourceUri?: URI;
  constructor(labelOrUri: string | URI, readonly collapsibleState?: number) {
    if (typeof labelOrUri === 'string') this.label = labelOrUri;
    else this.resourceUri = labelOrUri;
  }
}
export class RelativePattern {
  constructor(
    readonly base: unknown,
    readonly pattern: string,
  ) {}
}
export class TabInputText {
  constructor(readonly uri: URI) {}
}

export const StatusBarAlignment = { Left: 1, Right: 2 };
export const CommentMode = { Editing: 0, Preview: 1 };
export const CommentThreadState = { Unresolved: 0, Resolved: 1 };
export const CommentThreadCollapsibleState = { Collapsed: 0, Expanded: 1 };
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export const QuickPickItemKind = { Separator: -1, Default: 0 };
export const ProgressLocation = { SourceControl: 1, Window: 10, Notification: 15 };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

export const commands = {
  registerCommand(id: string, run: (...args: unknown[]) => unknown) {
    registeredCommands.set(id, run);
    return disposable();
  },
  executeCommand: async () => undefined,
};

export const workspace = {
  workspaceFolders: [] as unknown[],
  textDocuments: [] as unknown[],
  getConfiguration: () => ({ get: () => undefined, update: async () => undefined }),
  onDidChangeConfiguration: disposable,
  registerTextDocumentContentProvider(scheme: string) {
    registeredSchemes.push(scheme);
    return disposable();
  },
  createFileSystemWatcher: () => anything(),
  openTextDocument: async () => anything(),
};

export const window = {
  registerFileDecorationProvider: disposable,
  createStatusBarItem: () => anything(),
  createTreeView(id: string) {
    createdViews.push(id);
    return anything();
  },
  createQuickPick: () => anything(),
  tabGroups: { all: [] as unknown[], onDidChangeTabs: disposable, close: async () => true },
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showInputBox: async () => undefined,
  showOpenDialog: async () => undefined,
  showTextDocument: async () => anything(),
  withProgress: async (_o: unknown, task: () => Promise<unknown>) => task(),
  activeTextEditor: undefined,
};

export const comments = { createCommentController: () => anything() };
export const extensions = { getExtension: () => undefined };
