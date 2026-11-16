import { ExplorerError, isRecord, isWirePath, type WirePath } from "./protocol.js";
import type { PropertyKey } from "./properties.js";
import type { Caption } from "./metadata-creation-protocol.js";

export type ObjectOperation = "create" | "copy" | "delete";
export type ObjectRequest = { operation: "create"; kind: string; name: string; parent: string | null; template: string | null; propertyValues: Record<string, string>; propertyReferences: Record<string, string[]>; propertyTypes: Record<string, PropertyKey[]> }
  | { operation: "copy"; source: string; name: string; parent: string | null; propertyValues: Record<string, string>; propertyReferences: Record<string, string[]>; propertyTypes: Record<string, PropertyKey[]> }
  | { operation: "delete"; object: string; force: boolean }
  | { operation: "create-module"; owner: string; role: string };
export type InitialField = { property: string; kind: "types"; multiple: true; options: { key: PropertyKey; caption: Caption; metadataKind?: string }[] }
  | { property: string; kind: "references"; multiple: boolean; options: { value: string; caption: Caption; metadataKind?: string }[] }
  | { property: string; kind: "values"; multiple: false; options: { value: string; caption: Caption }[] };
export interface ObjectSchema {
  schemaVersion: 1; parent: string | null; kinds: string[];
  kindOptions: { key: string; value: string; caption: Caption }[];
  operations: ObjectOperation[];
  moduleOptions?: { role: string; caption: Caption }[];
  selectedKind?: string; initialFields?: InitialField[]; uniqueProperties: Record<string, string[]>;
  requiredProperties: Record<string, string[]>; referenceProperties: Record<string, string[]>; typeProperties: Record<string, string[]>; propertyCaptions: Record<string, Caption>;
}
export interface PreparedObject { request: ObjectRequest; sourceSnapshot: string; identities: Record<string, string>; expectedOutputSnapshot: string }
export interface FileSnapshot { bytes: number; snapshot: string }
export interface ObjectFile { path: WirePath; action: "create" | "update" | "delete"; before: FileSnapshot | null; after: FileSnapshot | null }
export interface ObjectReference { path: WirePath; range: { start: number; end: number }; reason: string; confirmed: boolean }
export interface ObjectPlan {
  schemaVersion: 1; valid: true; changed: boolean; operation: ObjectRequest["operation"]; objectId: string | null;
  prepared: PreparedObject; files: ObjectFile[];
  directories: { path: string; before: boolean; after: boolean }[];
  references: ObjectReference[];
  inputs: WirePath[];
}

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const optional = (value: unknown): boolean => value === null || text(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const caption = (value: unknown): boolean => isRecord(value) && text(value["ru-RU"]) && text(value["en-US"]);
const snapshot = (value: unknown): boolean => value === null || isRecord(value) && integer(value.bytes) && hash(value.snapshot);
const values = (value: unknown): boolean => isRecord(value) && Object.values(value).every(item => typeof item === "string");
const key = (value: unknown): boolean => isRecord(value) && text(value.name) && (value.namespace === null || text(value.namespace));
const types = (value: unknown): boolean => isRecord(value) && Object.values(value).every(item => Array.isArray(item) && item.every(key));
const lists = (value: unknown): boolean => isRecord(value) && Object.values(value).every(item => Array.isArray(item) && item.every(text));
function invalid(): never { throw new ExplorerError("protocolInvalid"); }

/** Optional authoring capabilities do not prevent connection to an older read-only feature set. */
export function objectCapability(hello: unknown, key: "metadataObjects" | "formAuthoring" = "metadataObjects"): boolean {
  if (!isRecord(hello) || !isRecord(hello.capabilities)) return false;
  const value = hello.capabilities[key];
  if (value === undefined) return false;
  if (!isRecord(hello.apiVersion) || hello.apiVersion.major !== 1 || !integer(hello.apiVersion.minor) || hello.apiVersion.minor < 49
    || !isRecord(value) || value.schemaVersion !== 1 || typeof value.enabled !== "boolean" || value.preparedPlans !== true) invalid();
  return value.enabled;
}

export function objectSchema(value: unknown, parent: string | null, kind?: string): ObjectSchema {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.parent !== parent || !Array.isArray(value.kinds) || !value.kinds.every(text)
    || !Array.isArray(value.kindOptions) || !value.kindOptions.every(option => isRecord(option) && text(option.key)
      && text(option.value) && value.kinds instanceof Array && value.kinds.includes(option.value) && caption(option.caption))
    || !Array.isArray(value.operations) || !value.operations.every(operation => ["create", "copy", "delete"].includes(String(operation)))
    || !lists(value.uniqueProperties) || !lists(value.requiredProperties) || !lists(value.referenceProperties) || !lists(value.typeProperties) || !isRecord(value.propertyCaptions) || !Object.values(value.propertyCaptions).every(caption)) invalid();
  if (value.moduleOptions !== undefined && (!Array.isArray(value.moduleOptions) || !value.moduleOptions.every(option => isRecord(option) && text(option.role) && caption(option.caption)))) invalid();
  if (kind === undefined ? value.selectedKind !== undefined || value.initialFields !== undefined
    : value.selectedKind !== kind || !value.kinds.includes(kind) || !Array.isArray(value.initialFields) || !value.initialFields.every(initialField)) invalid();
  return value as unknown as ObjectSchema;
}

function initialField(value: unknown): boolean {
  if (!isRecord(value) || !text(value.property) || !Array.isArray(value.options)) return false;
  if (value.kind === "types") return value.multiple === true && value.options.every(option => isRecord(option) && key(option.key) && caption(option.caption));
  if (value.kind === "references" || value.kind === "values") return typeof value.multiple === "boolean"
    && (value.kind !== "values" || value.multiple === false)
    && value.options.every(option => isRecord(option) && text(option.value) && caption(option.caption));
  return false;
}

function request(value: unknown): value is ObjectRequest {
  if (!isRecord(value)) return false;
  if (value.operation === "create-module") return text(value.owner) && text(value.role);
  if (value.operation === "delete") return text(value.object) && typeof value.force === "boolean";
  if (!text(value.name) || !optional(value.parent) || !values(value.propertyValues) || !lists(value.propertyReferences) || !types(value.propertyTypes)) return false;
  return value.operation === "copy" ? text(value.source)
    : value.operation === "create" && text(value.kind) && optional(value.template);
}

/** Only typed requests and backend-issued identities are replayable; display summaries cannot write bytes. */
export function objectPlan(value: unknown): ObjectPlan {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.valid !== true || typeof value.changed !== "boolean"
    || !["create", "copy", "delete", "create-module"].includes(String(value.operation)) || !optional(value.objectId)
    || !isRecord(value.prepared) || !request(value.prepared.request) || value.prepared.request.operation !== value.operation
    || !hash(value.prepared.sourceSnapshot) || !hash(value.prepared.expectedOutputSnapshot) || !values(value.prepared.identities)
    || !Array.isArray(value.files) || value.files.length > 100_000 || !value.files.every(file => isRecord(file) && isWirePath(file.path)
      && snapshot(file.before) && snapshot(file.after) && (file.action === "create" && file.before === null && file.after !== null
        || file.action === "delete" && file.before !== null && file.after === null || file.action === "update" && file.before !== null && file.after !== null))
    || !Array.isArray(value.directories) || !value.directories.every(dir => isRecord(dir) && text(dir.path) && typeof dir.before === "boolean" && typeof dir.after === "boolean")
    || !Array.isArray(value.references) || !value.references.every(reference => isRecord(reference) && isWirePath(reference.path)
      && isRecord(reference.range) && integer(reference.range.start) && integer(reference.range.end) && reference.range.end >= reference.range.start
      && text(reference.reason) && typeof reference.confirmed === "boolean")) invalid();
  if (!Array.isArray(value.inputs) || !value.inputs.every(isWirePath)) invalid();
  return value as unknown as ObjectPlan;
}
