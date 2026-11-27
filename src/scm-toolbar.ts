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

function matches(expression: unknown, context: Context): boolean {
  if (expression === undefined || expression === "true") return true;
  if (typeof expression !== "string") return false;
  // Unknown context keys fail closed. The SCM menu's current conditions use
  // boolean flags, equality and logical conjunctions/disjunctions.
  return expression.split(/\s+\|\|\s+/).some(alternative => alternative.split(/\s+&&\s+/).every(term => {
    const condition = /^(!)?([\w.]+)(?:\s*(==|!=)\s*([\w.-]+))?$/.exec(term.trim());
    if (!condition) return false;
    const [, negate, key, operator, expected] = condition;
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

const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(isRecord) : [];

export function toolbarFromManifest(manifest: unknown, extension: ToolbarCommand["extension"], context: Context,
  fallbackTitle: (id: string) => string | undefined): Toolbar {
  const result: Toolbar = { inline: [], overflow: [] };
  if (!isRecord(manifest) || !isRecord(manifest.contributes) || !isRecord(manifest.contributes.menus)) return result;
  const { menus, commands, submenus } = manifest.contributes;
  const definitions = new Map(records(commands).map(command => [command.command, command]));
  const titles = new Map(records(submenus).map(menu => [menu.id, caption(menu.label)]));
  const eligible = (id: string) => extension === GIT_EXTENSION ? id.startsWith("git.") : id === GIGACODE_GENERATE;
  const group = (item: Record<string, unknown>) => typeof item.group === "string" ? item.group.split("@", 2) : [""];
  const entries = (name: string) => records(menus[name]).slice().sort((a, b) => {
    const [left, leftOrder] = group(a), [right, rightOrder] = group(b);
    if (left !== right) return left === "navigation" ? -1 : right === "navigation" ? 1 : left!.localeCompare(right!);
    return (Number(leftOrder) || 0) - (Number(rightOrder) || 0);
  });
  const read = (name: string, ancestors: ReadonlySet<string>): ToolbarItem[] => {
    if (ancestors.has(name)) return [];
    const path = new Set(ancestors).add(name);
    const items: ToolbarItem[] = [];
    for (const item of entries(name)) {
      if (!matches(item.when, context)) continue;
      if (typeof item.command === "string" && eligible(item.command)) {
        const definition = definitions.get(item.command);
        if (!definition || !matches(definition.enablement, context)) continue;
        const title = caption(definition.shortTitle) ?? caption(definition.title) ?? fallbackTitle(item.command);
        if (!title) continue;
        const icon = typeof definition.icon === "string" ? /^\$\(([\w-]+)\)$/.exec(definition.icon)?.[1] : undefined;
        const command = { id: item.command, title, ...(icon ? { icon } : {}), extension };
        if ((name === "scm/title" || name === "scm/input") && group(item)[0] === "navigation") {
          if (!result.inline.some(other => other.id === command.id)) result.inline.push(command);
        } else items.push(command);
      } else if (typeof item.submenu === "string" && extension === GIT_EXTENSION) {
        const title = titles.get(item.submenu);
        const children = read(item.submenu, path);
        if (title && children.length) items.push({ title, items: children });
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
