import { createHash } from "node:crypto";
import { ExplorerError, isRecord, isWirePath, MAX_RESPONSE, type WirePath } from "./protocol.js";

export type CreationKind = "attribute" | "table-part";
export type Caption = Record<"ru-RU" | "en-US", string>;
export interface CreationOption<T> { value: T; caption: Caption }
export type CreateType = { kind: "string"; length: number; fixed: boolean }
  | { kind: "number"; digits: number; fractionDigits: number; nonNegative: boolean }
  | { kind: "boolean" } | { kind: "date"; fractions: "date" | "time" | "dateTime" }
  | { kind: "reference"; object: string };
export interface CreateRequest {
  owner: string; snapshot: string; kind: CreationKind; name: string;
  synonyms: { language: string; content: string }[]; comment: string; types: CreateType[];
}
export interface PreparedCreate {
  request: CreateRequest;
  identity: { uuid: string; table?: { typeId: string; valueId: string }; row?: { typeId: string; valueId: string } };
  expectedOutputSnapshot: string;
}
export interface CreationSchema {
  owner: string; snapshot: string; writable: boolean; kinds: CreationKind[];
  kindOptions: CreationOption<CreationKind>[];
  capabilities: {
    limits: { nameUtf16Max: number; stringLengthMin: number; stringLengthMax: number; stringFixedLengthMin: number; stringFixedLengthMax: number; numberDigitsMin: number; numberDigitsMax: number };
    primitiveTypes: { key: unknown; default: CreateType; caption: Caption }[];
    fieldCaptions: Record<string, Caption>;
    dateFractions: CreationOption<"date" | "time" | "dateTime">[];
    allowedLength: CreationOption<boolean>[]; allowedSign: CreationOption<boolean>[];
  };
  references: { object: string; kind: string; name: string; caption: Caption }[];
  languages: { object: string; code: string; name: string }[];
}
export interface CreationPlan {
  schemaVersion: 1; valid: true; changed: true; objectId: string; source: WirePath;
  snapshot: string; prepared: PreparedCreate;
  changes: { range: { start: number; end: number }; replacement: string }[];
}

function invalid(): never { throw new ExplorerError("protocolInvalid"); }
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const kind = (value: unknown): value is CreationKind => value === "attribute" || value === "table-part";
const caption = (value: unknown): value is Caption => isRecord(value) && text(value["ru-RU"]) && text(value["en-US"]);
const dateFractions = (value: unknown): boolean => ["date", "time", "dateTime"].includes(String(value));
const boolean = (value: unknown): boolean => typeof value === "boolean";

/** Optional capabilities leave existing backend connections fully usable. */
export function creationCapability(hello: unknown): boolean {
  if (!isRecord(hello) || !isRecord(hello.capabilities)) return false;
  const value = hello.capabilities.metadataCreation;
  if (value === undefined) return false;
  if (!isRecord(hello.apiVersion) || hello.apiVersion.major !== 1 || !integer(hello.apiVersion.minor) || hello.apiVersion.minor < 48
    || !isRecord(value) || value.schemaVersion !== 1 || typeof value.enabled !== "boolean" || value.preparedPlans !== true) invalid();
  return value.enabled;
}

/** The adapter checks wire shapes; admissible owners, names and type domains belong to Rust. */
export function createType(value: unknown): value is CreateType {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "string": return integer(value.length) && boolean(value.fixed);
    case "number": return integer(value.digits) && integer(value.fractionDigits) && boolean(value.nonNegative);
    case "boolean": return true;
    case "date": return dateFractions(value.fractions);
    case "reference": return text(value.object);
    default: return false;
  }
}

function options(value: unknown, valid: (input: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length > 0 && value.length < 128
    && value.every(option => isRecord(option) && valid(option.value) && caption(option.caption));
}

export function creationSchema(value: unknown, owner: string): CreationSchema {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.owner !== owner || !hash(value.snapshot)
    || typeof value.writable !== "boolean" || !Array.isArray(value.kinds) || !value.kinds.every(kind)
    || !options(value.kindOptions, kind) || !isRecord(value.capabilities)) invalid();
  const caps = value.capabilities;
  if (!isRecord(caps.limits) || ![caps.limits.nameUtf16Max, caps.limits.stringLengthMax, caps.limits.stringFixedLengthMax, caps.limits.numberDigitsMax]
    .every(count => integer(count) && count > 0)
    || ![caps.limits.stringLengthMin, caps.limits.stringFixedLengthMin, caps.limits.numberDigitsMin].every(integer)
    || !Array.isArray(caps.primitiveTypes) || caps.primitiveTypes.length > 64
    || !caps.primitiveTypes.every(choice => isRecord(choice) && createType(choice.default) && caption(choice.caption))
    || !isRecord(caps.fieldCaptions) || !["name", "synonym", "comment", "type", "length", "fixed", "digits", "fractionDigits", "nonNegative", "fractions"]
      .every(field => caption(caps.fieldCaptions && (caps.fieldCaptions as Record<string, unknown>)[field]))
    || !options(caps.dateFractions, dateFractions) || !options(caps.allowedLength, boolean) || !options(caps.allowedSign, boolean)
    || !Array.isArray(value.references) || !value.references.every(reference => isRecord(reference) && text(reference.object)
      && text(reference.kind) && text(reference.name) && caption(reference.caption))
    || !Array.isArray(value.languages) || !value.languages.every(language => isRecord(language) && text(language.object) && text(language.code) && text(language.name))) invalid();
  return value as unknown as CreationSchema;
}

function request(value: unknown): value is CreateRequest {
  return isRecord(value) && text(value.owner) && hash(value.snapshot) && kind(value.kind) && text(value.name)
    && typeof value.comment === "string" && Array.isArray(value.types) && value.types.length < 1024 && value.types.every(createType)
    && Array.isArray(value.synonyms) && value.synonyms.length <= 128 && value.synonyms.every(synonym => isRecord(synonym)
      && text(synonym.language) && typeof synonym.content === "string");
}

export function creationPlan(value: unknown): CreationPlan {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.valid !== true || value.changed !== true || !text(value.objectId)
    || !isWirePath(value.source) || !hash(value.snapshot) || !isRecord(value.prepared) || !request(value.prepared.request)
    || value.prepared.request.snapshot !== value.snapshot || !hash(value.prepared.expectedOutputSnapshot) || !isRecord(value.prepared.identity)
    || !text(value.prepared.identity.uuid) || !Array.isArray(value.changes) || value.changes.length === 0 || value.changes.length > 4096) invalid();
  let end = 0, bytes = 0;
  for (const change of value.changes) {
    if (!isRecord(change) || !isRecord(change.range) || !integer(change.range.start) || !integer(change.range.end)
      || change.range.start < end || change.range.end < change.range.start || typeof change.replacement !== "string") invalid();
    end = change.range.end; bytes += Buffer.byteLength(change.replacement);
    if (bytes > MAX_RESPONSE) throw new ExplorerError("resourceLimit");
  }
  return value as unknown as CreationPlan;
}

/** Render the backend's exact byte replacements; no XML serializer or domain rule exists in this client. */
export function creationPreview(bytes: Buffer, plan: CreationPlan): { before: string; after: string } {
  if (bytes.length > MAX_RESPONSE || createHash("sha256").update(bytes).digest("hex") !== plan.snapshot) throw new ExplorerError("sourceChanged");
  const chunks: Buffer[] = []; let start = 0, length = bytes.length;
  for (const change of plan.changes) {
    if (change.range.end > bytes.length) invalid();
    const inserted = Buffer.from(change.replacement);
    length += inserted.length - (change.range.end - change.range.start);
    if (length > MAX_RESPONSE) throw new ExplorerError("resourceLimit");
    chunks.push(bytes.subarray(start, change.range.start), inserted); start = change.range.end;
  }
  chunks.push(bytes.subarray(start));
  const updated = Buffer.concat(chunks);
  if (createHash("sha256").update(updated).digest("hex") !== plan.prepared.expectedOutputSnapshot) invalid();
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return { before: decoder.decode(bytes).replace(/^\uFEFF/, ""), after: decoder.decode(updated).replace(/^\uFEFF/, "") };
  } catch { return invalid(); }
}
