import { ExplorerError, isRecord, isToken, isWirePath, type WirePath } from "../protocol.js";
import type { PropertyField, PropertyKey } from "../properties.js";
import { picturePreview, type PicturePreview } from "../picture.js";

export const MAX_FORM_DEPENDENCIES = 1024;

export interface FormLimits { maxSessions: number; maxOverlayBytes: number; maxInlineBytes: number; handlerNavigation?: boolean }
export interface FormInput { root: WirePath; path: WirePath; version: string; text: string }
export interface FormInputSource { id: string; root: WirePath; path: WirePath }
export interface FormPreparation { contextFingerprint: string; application: string | null; limitedContext: boolean; roots: WirePath[]; forms: FormInputSource[] }
export interface ElementIdentity { source: string; part: "current"; key: { kind: "root" } | { kind: "xml"; value: string } }
export interface Origin { source: string; range: { start: number; end: number } }
export interface FormProperty extends PropertyField { origin: Origin; range: { start: number; end: number } }
export type FormText = { kind: "literal"; items: { language: string; content: string }[] } | { kind: "name"; text: string } | { kind: "standard"; key: string };
export interface Font { face: string | null; points: number; weight: number; italic: boolean; underline: boolean; strikeout: boolean }
export interface Color { kind: "rgb" | "role" | "web" | "system"; value: string }
export interface Presentation {
  markIncomplete?: boolean;
  footerText?: FormText | null;
  picture: { kind: "standard"; name: string } | { kind: "common"; source: string } | { kind: "missing"; reference: string } | null;
  titleLocation: "Left" | "Right" | "Top" | "Bottom" | "None"; displayed: boolean; grouping: "Vertical" | "Horizontal" | "HorizontalIfPossible"; caption: FormText; tooltip: FormText | null; font: Font; titleFont: Font; foreground: Color; background: Color; border: Color; titleColor: Color;
  valueType: { kind: string; length: number | null; digits: number | null; fraction: number | null; dateParts: string | null; types: PropertyKey[] };
  binding: Origin | null; choices: FormText[]; autoCommands: string[];
  autoCommandItems?: { key: string; caption: FormText; primary: boolean; origin: Origin | null }[];
}
export interface FormNode { identity: ElementIdentity; origin: Origin; kind: string | null; name: string | null; xmlName: PropertyKey; properties: FormProperty[]; presentation: Presentation; children: FormNode[]; auxiliary: FormNode[] }
export interface FormDefinition { name: string | null; origin: Origin; properties: FormProperty[] }
export interface FormDependency { id: string; root: WirePath; path: WirePath; snapshot: string; version: string | null; member: string | null; role: "form" | "metadata" | "picture" }
export interface FormHandler { owner: { kind: "element"; identity: ElementIdentity } | { kind: "command"; name: string }; event: string; name: string; origin: Origin }
export interface FormHandlerSource { source: string; root: WirePath; path: WirePath; revision: string }
export interface FormModel { root: FormNode; assets: { id: string; picture: Extract<PicturePreview, { status: "ready" }> }[]; handlers?: FormHandler[]; attributes: FormDefinition[]; commands: FormDefinition[]; parameters: FormDefinition[]; diagnostics: { composition: unknown[]; appearance: unknown[] } }
export interface FormSnapshot {
  formSessionId: string; revision: string; contextFingerprint: string; application: string | null; profile: "taxi-8.3.27";
  limitedContext: boolean; modelComplete: boolean; status: "ready" | "stale"; lastError: unknown; dependencies: FormDependency[]; model: FormModel;
}
export interface Location { source: string; snapshot: string; root: WirePath; path: WirePath; range: { start: number; end: number } }
export type FormTarget = { kind: "element" | "binding"; identity: ElementIdentity } | { kind: "property"; identity: ElementIdentity; property: PropertyKey }
  | { kind: "definition"; section: "attributes" | "commands" | "parameters"; name: string };

function invalid(): never { throw new ExplorerError("protocolInvalid"); }
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
export function identityKey(value: ElementIdentity): string { return `${value.source}:${value.part}:${value.key.kind === "root" ? "root" : value.key.value}`; }
export function isIdentity(value: unknown): value is ElementIdentity {
  if (!isRecord(value) || !hash(value.source) || value.part !== "current" || !isRecord(value.key)) return false;
  if (value.key.kind === "root") return true;
  if (value.key.kind !== "xml" || typeof value.key.value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value.key.value)) return false;
  const id = BigInt(value.key.value); return id >= -9_223_372_036_854_775_808n && id <= 9_223_372_036_854_775_807n;
}
function origin(value: unknown): boolean { return isRecord(value) && hash(value.source) && range(value.range); }
function range(value: unknown): boolean { return isRecord(value) && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end) && (value.start as number) >= 0 && (value.end as number) >= (value.start as number); }
function key(value: unknown): boolean { return isRecord(value) && typeof value.name === "string" && (value.namespace === null || typeof value.namespace === "string"); }
function caption(value: unknown): boolean { return value === undefined || isRecord(value) && ["ru-RU", "en-US"].every(locale => typeof value[locale] === "string" && (value[locale] as string).trim().length > 0); }
function field(value: unknown, depth = 0): boolean {
  if (!isRecord(value) || !key(value.key) || !caption(value.caption) || !isRecord(value.value) || depth > 64 || !Array.isArray(value.qualifiers)
    || !value.qualifiers.every(qualifier => isRecord(qualifier) && key(qualifier.key) && typeof qualifier.value === "string" && caption(qualifier.caption))) return false;
  const data = value.value;
  if (data.kind === "text") return typeof data.text === "string" && caption(data.caption)
    && (data.scalarType === undefined || data.scalarType === "boolean" && ["true", "false", "1", "0"].includes(data.text.trim()));
  if (data.kind === "localized") return Array.isArray(data.items) && data.items.every(item => isRecord(item) && typeof item.language === "string" && typeof item.content === "string");
  if (data.kind === "record") return Array.isArray(data.fields) && data.fields.every(value => field(value, depth + 1));
  return data.kind === "unsupported" && typeof data.issue === "string";
}
function text(value: unknown): boolean {
  return isRecord(value) && (value.kind === "name" && typeof value.text === "string" || value.kind === "standard" && typeof value.key === "string"
    || value.kind === "literal" && Array.isArray(value.items) && value.items.every(item => isRecord(item) && typeof item.language === "string" && typeof item.content === "string"));
}
function font(value: unknown): boolean { return isRecord(value) && (value.face === null || typeof value.face === "string") && typeof value.points === "number" && Number.isFinite(value.points)
  && value.points > 0 && typeof value.weight === "number" && ["italic", "underline", "strikeout"].every(key => typeof value[key] === "boolean"); }
function color(value: unknown): boolean { return isRecord(value) && ["rgb", "role", "web", "system"].includes(String(value.kind)) && typeof value.value === "string"; }
function presentation(value: unknown): boolean {
  return isRecord(value) && (value.picture === null || isRecord(value.picture) && (value.picture.kind === "standard" && typeof value.picture.name === "string" || value.picture.kind === "common" && hash(value.picture.source) || value.picture.kind === "missing" && typeof value.picture.reference === "string"))
    && (value.markIncomplete === undefined || typeof value.markIncomplete === "boolean")
    && (value.footerText === undefined || value.footerText === null || text(value.footerText))
    && typeof value.displayed === "boolean" && ["Left", "Right", "Top", "Bottom", "None"].includes(String(value.titleLocation)) && ["Vertical", "Horizontal", "HorizontalIfPossible"].includes(String(value.grouping)) && text(value.caption) && (value.tooltip === null || text(value.tooltip)) && font(value.font) && font(value.titleFont)
    && ["foreground", "background", "border", "titleColor"].every(key => color(value[key])) && isRecord(value.valueType) && typeof value.valueType.kind === "string"
    && (value.binding === null || origin(value.binding)) && Array.isArray(value.choices) && value.choices.every(text) && Array.isArray(value.autoCommands) && value.autoCommands.every(value => typeof value === "string")
    && (value.autoCommandItems === undefined || Array.isArray(value.autoCommandItems) && value.autoCommandItems.length <= 16_384 && value.autoCommandItems.every(item => isRecord(item) && typeof item.key === "string" && text(item.caption) && typeof item.primary === "boolean" && (item.origin === null || origin(item.origin))));
}
export function formCapabilities(value: unknown): FormLimits | undefined {
  if (!isRecord(value) || !isRecord(value.capabilities) || value.capabilities.formPreview === undefined) return undefined;
  const data = value.capabilities.formPreview;
  if (isRecord(value.apiVersion) && value.apiVersion.major === 1 && typeof value.apiVersion.minor === "number" && value.apiVersion.minor < 38) return undefined;
  if (!isRecord(data) || !isRecord(value.apiVersion) || value.apiVersion.major !== 1 || typeof value.apiVersion.minor !== "number" || value.apiVersion.minor < 38
    || data.schemaVersion !== 1 || data.profile !== "taxi-8.3.27" || data.readOnly !== true || data.executesBsl !== false || data.pictures !== true || data.inputPreparation !== true || data.uploads !== "queryBuffers") invalid();
  if (!["maxSessions", "maxOverlayBytes", "maxInlineBytes"].every(key => typeof data[key] === "number" && Number.isSafeInteger(data[key]) && (data[key] as number) > 0)) invalid();
  return { maxSessions: Math.min(data.maxSessions as number, 16), maxOverlayBytes: Math.min(data.maxOverlayBytes as number, 8_388_608), maxInlineBytes: Math.min(data.maxInlineBytes as number, 131_072),
    ...(value.apiVersion.minor >= 39 && data.handlerNavigation === true ? { handlerNavigation: true } : {}) };
}
export function parseFormPreparation(value: unknown): FormPreparation {
  if (!isRecord(value) || !hash(value.contextFingerprint) || !(value.application === null || typeof value.application === "string") || typeof value.limitedContext !== "boolean"
    || !Array.isArray(value.roots) || !value.roots.length || value.roots.length > MAX_FORM_DEPENDENCIES || !value.roots.every(isWirePath)
    || !Array.isArray(value.forms) || !value.forms.length || value.forms.length > MAX_FORM_DEPENDENCIES) invalid();
  const roots = new Set(value.roots.map(root => JSON.stringify(root))), ids = new Set<string>();
  for (const input of value.forms) {
    if (!isRecord(input) || !hash(input.id) || ids.has(input.id) || !isWirePath(input.root) || !isWirePath(input.path) || !roots.has(JSON.stringify(input.root))) invalid();
    ids.add(input.id);
  }
  return value as unknown as FormPreparation;
}
export function parseFormSnapshot(value: unknown): FormSnapshot {
  if (!isRecord(value) || typeof value.formSessionId !== "string" || !value.formSessionId || !isToken(value.revision) || !hash(value.contextFingerprint)
    || !(value.application === null || typeof value.application === "string") || value.profile !== "taxi-8.3.27" || typeof value.limitedContext !== "boolean"
    || typeof value.modelComplete !== "boolean" || !["ready", "stale"].includes(String(value.status)) || !Array.isArray(value.dependencies) || value.dependencies.length > MAX_FORM_DEPENDENCIES || !isRecord(value.model)) invalid();
  const ids = new Set<string>();
  for (const dependency of value.dependencies) {
    if (!isRecord(dependency) || !hash(dependency.id) || ids.has(dependency.id) || !isWirePath(dependency.root) || !isWirePath(dependency.path) || !hash(dependency.snapshot)
      || !(dependency.version === null || typeof dependency.version === "string") || !["form", "metadata", "picture"].includes(String(dependency.role))) invalid();
    ids.add(dependency.id);
  }
  if (!Array.isArray(value.model.assets) || value.model.assets.length > 256) invalid();
  const assets = new Set<string>();
  for (const asset of value.model.assets) {
    if (!isRecord(asset) || !hash(asset.id) || !value.dependencies.some(input => isRecord(input) && input.id === asset.id && input.role === "metadata") || assets.has(asset.id) || picturePreview(asset.picture)?.status !== "ready") invalid();
    assets.add(asset.id);
  }
  let nodes = 0; const identities = new Set<string>();
  function node(value: unknown, depth: number): void {
    if (++nodes > 16_384 || depth > 64 || !isRecord(value) || !isIdentity(value.identity) || identities.has(identityKey(value.identity)) || !ids.has(value.identity.source)
      || !origin(value.origin) || !key(value.xmlName) || !(value.kind === null || typeof value.kind === "string") || !(value.name === null || typeof value.name === "string")
      || !Array.isArray(value.properties) || !value.properties.every(value => isRecord(value) && origin(value.origin) && field(value)) || !presentation(value.presentation)
      || !Array.isArray(value.children) || !Array.isArray(value.auxiliary)) invalid();
    identities.add(identityKey(value.identity)); value.children.forEach(value => node(value, depth + 1)); value.auxiliary.forEach(value => node(value, depth + 1));
    if (isRecord(value.presentation) && isRecord(value.presentation.picture) && value.presentation.picture.kind === "common" && !assets.has(String(value.presentation.picture.source))) invalid();
  }
  node(value.model.root, 0);
  if (value.model.handlers !== undefined && (!Array.isArray(value.model.handlers) || value.model.handlers.length > 16_384 || !value.model.handlers.every(handler =>
    isRecord(handler) && isRecord(handler.owner) && typeof handler.event === "string" && typeof handler.name === "string" && origin(handler.origin) && ids.has((handler.origin as unknown as Origin).source)
    && (handler.owner.kind === "element" && isIdentity(handler.owner.identity) && identities.has(identityKey(handler.owner.identity))
      || handler.owner.kind === "command" && typeof handler.owner.name === "string")))) invalid();
  for (const name of ["attributes", "commands", "parameters"]) if (!Array.isArray(value.model[name]) || !(value.model[name] as unknown[]).every(value => isRecord(value)
    && (value.name === null || typeof value.name === "string") && origin(value.origin) && Array.isArray(value.properties) && value.properties.every(value => isRecord(value) && origin(value.origin) && field(value)))) invalid();
  const commands = value.model.commands as unknown[];
  if (Array.isArray(value.model.handlers)) for (const handler of value.model.handlers) {
    if (isRecord(handler) && isRecord(handler.owner) && handler.owner.kind === "command") {
      const name = handler.owner.name;
      if (!commands.some(command => isRecord(command) && command.name === name)) invalid();
    }
  }
  if (!isRecord(value.model.diagnostics) || !Array.isArray(value.model.diagnostics.composition) || !Array.isArray(value.model.diagnostics.appearance)) invalid();
  return value as unknown as FormSnapshot;
}
export function parseLocation(value: unknown): Location {
  if (!isRecord(value) || !hash(value.source) || !hash(value.snapshot) || !isWirePath(value.root) || !isWirePath(value.path) || !range(value.range)) invalid();
  return value as unknown as Location;
}

export function parseHandlerSource(value: unknown): FormHandlerSource {
  if (!isRecord(value) || !hash(value.source) || !isWirePath(value.root) || !isWirePath(value.path) || !isToken(value.revision)) invalid();
  return value as unknown as FormHandlerSource;
}
