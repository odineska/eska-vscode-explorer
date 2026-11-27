import { isRecord } from "./protocol.js";

export const GIT_EXTENSION = "vscode.git";
export const GIGACODE_EXTENSION = "gigacode.gigacode-vscode";
export const GIGACODE_GENERATE = "gigacode.new.generateCommitMessage";

export interface ToolbarCommand {
  id: string;
  title: string;
  icon?: string;
  extension: typeof GIT_EXTENSION | typeof GIGACODE_EXTENSION;
}
export interface ToolbarMenu {
  title: string;
  items: ToolbarItem[];
}
export type ToolbarItem = ToolbarCommand | ToolbarMenu;
export interface Toolbar {
  inline: ToolbarCommand[];
  overflow: ToolbarItem[];
}

type Context = (key: string) => unknown;
type Condition = (context: Context) => boolean;
interface Declaration {
  definitions: Map<unknown, Record<string, unknown>>;
  titles: Map<unknown, string | undefined>;
  menus: Map<string, Record<string, unknown>[]>;
  rawMenus: Record<string, unknown>;
  conditions: Map<unknown, Condition>;
}
const declarations = new WeakMap<object, Declaration>();
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(isRecord) : [];
const group = (item: Record<string, unknown>): string[] => typeof item.group === "string" ? item.group.split("@", 2) : [""];

/** Compile only the boolean/equality subset used by the installed SCM menus. */
function condition(expression: unknown): Condition {
  if (expression === undefined || expression === "true") return () => true;
  if (typeof expression !== "string") return () => false;
  const alternatives = expression.split(/\s+\|\|\s+/).map(alternative =>
    alternative.split(/\s+&&\s+/).map(term =>
      /^(!)?([\w.]+)(?:\s*(==|!=)\s*([\w.-]+))?$/.exec(term.trim())));
  return context => alternatives.some(terms => terms.every(term => {
    if (!term) return false;
    const [, negate, key, operator, expected] = term;
    const actual = context(key!);
    if (actual === undefined) return false;
    if (operator) return operator === "==" ? String(actual) === expected : String(actual) !== expected;
    return negate ? !actual : Boolean(actual);
  }));
}

function caption(value: unknown): string | undefined {
  const title = typeof value === "string" ? value : isRecord(value) ? value.value : undefined;
  return typeof title === "string" && title.length && !title.startsWith("%") ? title : undefined;
}

function declaration(manifest: object & Record<string, unknown>): Declaration | undefined {
  const cached = declarations.get(manifest);
  if (cached) return cached;
  if (!isRecord(manifest.contributes) || !isRecord(manifest.contributes.menus)) return;
  const { menus, commands, submenus } = manifest.contributes;
  const result: Declaration = {
    definitions: new Map(records(commands).map(command => [command.command, command])),
    titles: new Map(records(submenus).map(menu => [menu.id, caption(menu.label)])),
    menus: new Map(),
    rawMenus: menus,
    conditions: new Map(),
  };
  declarations.set(manifest, result);
  return result;
}

export function toolbarFromManifest(manifest: unknown, extension: ToolbarCommand["extension"], context: Context,
  fallbackTitle: (id: string) => string | undefined, supports: (id: string) => boolean = () => true): Toolbar {
  const result: Toolbar = { inline: [], overflow: [] };
  const data = isRecord(manifest) ? declaration(manifest) : undefined;
  if (!data) return result;
  const eligible = (id: string) => (extension === GIT_EXTENSION ? id.startsWith("git.") : id === GIGACODE_GENERATE) && supports(id);
  const matches = (expression: unknown) => {
    let compiled = data.conditions.get(expression);
    if (!compiled) { compiled = condition(expression); data.conditions.set(expression, compiled); }
    return compiled(context);
  };
  const entries = (name: string) => {
    let sorted = data.menus.get(name);
    if (!sorted) {
      sorted = records(data.rawMenus[name]).slice().sort((a, b) => {
        const [left, leftOrder] = group(a), [right, rightOrder] = group(b);
        if (left !== right) return left === "navigation" ? -1 : right === "navigation" ? 1 : left!.localeCompare(right!);
        return (Number(leftOrder) || 0) - (Number(rightOrder) || 0);
      });
      data.menus.set(name, sorted);
    }
    return sorted;
  };
  const inlineIds = new Set<string>();
  const read = (name: string, ancestors: ReadonlySet<string>): ToolbarItem[] => {
    if (ancestors.has(name)) return [];
    const path = new Set(ancestors).add(name);
    const items: ToolbarItem[] = [];
    const ids = new Set<string>();
    const submenuIds = new Set<string>();
    for (const item of entries(name)) {
      if (!matches(item.when)) continue;
      if (typeof item.command === "string" && eligible(item.command)) {
        const definition = data.definitions.get(item.command);
        if (!definition || !matches(definition.enablement)) continue;
        const title = caption(definition.shortTitle) ?? caption(definition.title) ?? fallbackTitle(item.command);
        if (!title) continue;
        const icon = typeof definition.icon === "string" ? /^\$\(([\w-]+)\)$/.exec(definition.icon)?.[1] : undefined;
        const command = { id: item.command, title, ...(icon ? { icon } : {}), extension };
        if ((name === "scm/title" || name === "scm/input") && group(item)[0] === "navigation") {
          if (!inlineIds.has(command.id)) { inlineIds.add(command.id); result.inline.push(command); }
        } else if (!ids.has(command.id)) { ids.add(command.id); items.push(command); }
      } else if (typeof item.submenu === "string" && extension === GIT_EXTENSION && !submenuIds.has(item.submenu)) {
        const title = data.titles.get(item.submenu);
        const children = read(item.submenu, path);
        if (title && children.length) { submenuIds.add(item.submenu); items.push({ title, items: children }); }
      }
    }
    return items;
  };
  result.overflow = read("scm/title", new Set());
  if (extension === GIGACODE_EXTENSION) result.overflow.push(...read("scm/input", new Set()));
  return result;
}

export function findToolbarCommand(items: readonly ToolbarItem[], id: string): ToolbarCommand | undefined {
  for (const item of items) {
    const command = "items" in item ? findToolbarCommand(item.items, id) : item.id === id ? item : undefined;
    if (command) return command;
  }
  return undefined;
}
