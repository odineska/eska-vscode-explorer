import * as vscode from "vscode";
import { uniqueNamesGenerator, adjectives, animals, colors, NumberDictionary } from "@joaomoreno/unique-names-generator";
import { sanitizeBranchName, type BranchRef, type BranchAction } from "./scm-branch-model.js";
type Text = (key: string, ...values: string[]) => string;
interface Item extends vscode.QuickPickItem { ref?: BranchRef; action?: "create" | "from" | "detached" | "commit" }
export async function pickBranchAction(refs: BranchRef[], root: vscode.Uri, text: Text, active: () => boolean): Promise<BranchAction | undefined> {
  const config = vscode.workspace.getConfiguration("git", root);
  const pickRef = async (from: boolean, detached = false): Promise<BranchRef | undefined> => {
    const selected = await vscode.window.showQuickPick<Item>([
      ...(from ? [{ label: "HEAD", ref: { name: "HEAD", kind: "head" as const } }] : []),
      ...refs.filter(ref => !detached || ref.kind !== "tag" && types.includes(ref.kind)).map(ref => ({ label: ref.name, description: text(ref.kind), ref })),
      { label: text("commit"), action: "commit" },
    ], { placeHolder: text(from ? "from" : "detached") });
    if (!selected || !active()) return;
    if (selected.ref) return selected.ref;
    const sha = await vscode.window.showInputBox({ prompt: text("sha"), validateInput: value => /^[a-f\d]{7,64}$/i.test(value) ? undefined : text("invalid") });
    if (sha && active()) return { name: sha, kind: "commit" };
    return;
  };
  const checkoutType = config.get<string | string[]>("checkoutType", "all");
  const types = !checkoutType.length || checkoutType === "all" ? ["local", "remote", "tags"] : typeof checkoutType === "string" ? [checkoutType] : checkoutType;
  const commands: Item[] = [
    { label: `$(plus) ${text("create")}`, action: "create", alwaysShow: true }, { label: `$(plus) ${text("createFrom")}`, action: "from", alwaysShow: true }, { label: `$(debug-disconnect) ${text("checkoutDetached")}`, action: "detached", alwaysShow: true },
  ];
  const picks: Item[] = refs.filter(ref => types.includes(ref.kind === "tag" ? "tags" : ref.kind)).map(ref => ({ label: ref.name, description: text(ref.kind), ref }));
  const quickPick = vscode.window.createQuickPick<Item>();
  quickPick.matchOnDetail = false; quickPick.placeholder = text("checkout");
  const update = (): void => { quickPick.items = !quickPick.value ? [...commands, ...picks] : !picks.length ? commands : [...picks, { label: "", kind: vscode.QuickPickItemKind.Separator }, ...commands]; };
  update();
  const pickSubscriptions: vscode.Disposable[] = [];
  const picked = await new Promise<Item | undefined>(resolve => {
    pickSubscriptions.push(quickPick.onDidHide(() => resolve(undefined)), quickPick.onDidAccept(() => resolve(quickPick.activeItems[0])), quickPick.onDidChangeValue(update));
    quickPick.show();
  });
  const defaultName = quickPick.value;
  pickSubscriptions.forEach(item => item.dispose()); quickPick.dispose();
  if (!picked || !active()) return;
  if (picked.ref) return { target: picked.ref };
  if (picked.action === "detached") { const target = await pickRef(false, true); return target ? { target, detached: true } : undefined; }
  const target = picked.action === "from" ? await pickRef(true) : { name: "HEAD", kind: "head" as const };
  if (!target || !active()) return;
  const prefix = config.get<string>("branchPrefix", ""), whitespace = config.get<string>("branchWhitespaceChar", "-");
  const pattern = config.get<string>("branchValidationRegex", ".*");
  const validate = (value: string): string | vscode.InputBoxValidationMessage | undefined => {
      const name = sanitizeBranchName(value, whitespace);
      if (!name || name === "@" || name.startsWith("/") || name.endsWith("/") || name.includes("//") || /[\x00-\x20\x7f~^:?*\[\\]/.test(name) || name.includes("..") || name.includes("@{") || name.split("/").some(part => part.startsWith(".") || part.endsWith(".lock"))) return text("invalid");
      if (refs.some(ref => ref.kind === "local" && ref.name === name)) return text("exists", name);
      try { if (!new RegExp(pattern).test(name)) return text("regex", pattern); } catch { return text("regex", pattern); }
      return value === name ? undefined : { message: text("sanitized", name), severity: vscode.InputBoxValidationSeverity.Info };
  };
  if (defaultName) {
    const result = validate(defaultName);
    if (typeof result === "string") { await vscode.window.showErrorMessage(result); return; }
    return { target, branch: sanitizeBranchName(defaultName, whitespace) };
  }
  const randomEnabled = config.get<boolean>("branchRandomName.enable", false);
  const generate = (): string => {
    const dictionaries: string[][] = [];
    for (const dictionary of config.get<string[]>("branchRandomName.dictionary", ["adjectives", "animals"])) {
      switch (dictionary.toLowerCase()) {
        case "adjectives": dictionaries.push(adjectives); break;
        case "animals": dictionaries.push(animals); break;
        case "colors": dictionaries.push(colors); break;
        case "numbers": dictionaries.push(NumberDictionary.generate({ length: 3 })); break;
      }
    }
    if (!dictionaries.length) return "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const name = uniqueNamesGenerator({ dictionaries, length: dictionaries.length, separator: whitespace });
      if (!refs.some(ref => ref.kind === "local" && ref.name === name)) return name;
    }
    return "";
  };
  const input = vscode.window.createInputBox();
  input.prompt = text("name"); input.ignoreFocusOut = true;
  input.buttons = randomEnabled ? [{ iconPath: new vscode.ThemeIcon("refresh"), tooltip: text("regenerate") }] : [];
  const reset = (): void => {
    input.value = prefix + (randomEnabled ? generate() : ""); input.valueSelection = [prefix.length, input.value.length]; input.validationMessage = validate(input.value);
  };
  reset();
  const subscriptions: vscode.Disposable[] = [];
  const name = await new Promise<string | undefined>(resolve => {
    subscriptions.push(input.onDidHide(() => resolve(undefined)), input.onDidAccept(() => {
      const result = validate(input.value);
      if (typeof result !== "string" && result?.severity !== vscode.InputBoxValidationSeverity.Error) resolve(input.value);
    }), input.onDidChangeValue(value => { input.validationMessage = validate(value); }), input.onDidTriggerButton(reset));
    input.show();
  });
  subscriptions.forEach(item => item.dispose()); input.dispose();
  if (name === undefined || !active()) return;
  return { target, branch: sanitizeBranchName(name, whitespace) };
}
