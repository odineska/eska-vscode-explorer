import type * as VSCode from "vscode";

const stringBody = '(?:[^"]|"")*';
const closeQuote = '"(?!")';
const pipe = String.raw`[ \t]*\|`;
const codeTokens = `(?:[^"'/]|/(?!/)|'[^']*'|"${stringBody}${closeQuote})*`;
// A line can resume code after closing a continued literal. Slashes inside its body are text.
const code = `^(?:${pipe}${stringBody}${closeQuote}|(?!${pipe}))${codeTokens}`;

export const bslContinuationRules = [
  { beforeText: new RegExp(`${code}//`), appendText: "// " },
  { beforeText: new RegExp(`${code}"${stringBody}$|^${pipe}${stringBody}$`), appendText: "|" },
];

export function registerBslEnterRules(vscode: typeof VSCode): VSCode.Disposable {
  const install = () => vscode.languages.setLanguageConfiguration("bsl", {
    onEnterRules: bslContinuationRules.map(({ beforeText, appendText }) => ({
      beforeText, action: { indentAction: vscode.IndentAction.None, appendText },
    })),
  });
  let rules = install();
  let disposed = false;
  let otherPath: string | undefined;

  const synchronize = () => {
    const extension = vscode.extensions.getExtension("1c-syntax.language-1c-bsl");
    const path = extension?.extensionPath;
    if (path === otherPath) return;
    otherPath = path;
    if (!extension) return;
    // This extension registers its own onEnterRules during BSL activation. Publish only our
    // onEnterRules afterwards so the chosen grammar, brackets and indentation remain available.
    const preferExplorerRules = () => {
      if (disposed || otherPath !== path) return;
      const previous = rules;
      rules = install();
      previous.dispose();
    };
    void extension.activate().then(preferExplorerRules, preferExplorerRules);
  };
  const opened = vscode.workspace.onDidOpenTextDocument(document => {
    if (document.languageId === "bsl") synchronize();
  });
  const extensionsChanged = () => {
    if (vscode.workspace.textDocuments.some(document => document.languageId === "bsl")) synchronize();
  };
  const extensions = vscode.extensions.onDidChange(extensionsChanged);
  extensionsChanged();

  return { dispose() { disposed = true; opened.dispose(); extensions.dispose(); rules.dispose(); } };
}
