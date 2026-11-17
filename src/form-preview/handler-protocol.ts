import { ExplorerError, isRecord } from "../protocol.js";
import { parseHandlerSource, parseLocation, type FormHandlerSource, type Location } from "./protocol.js";

export type EventTarget = { kind: "root" } | { kind: "element"; id: number } | { kind: "command"; name: string };
export interface HandlerEditSource extends FormHandlerSource { name: string; exists: boolean; bound: boolean }
export interface HandlerEditPlan extends HandlerEditSource, Location {
  version: string; outputSnapshot: string; change: { range: { start: number; end: number }; text: string } | null;
}
export function eventTarget(value: unknown): EventTarget | undefined {
  if (!isRecord(value)) return;
  if (value.kind === "root") return { kind: "root" };
  if (value.kind === "element" && typeof value.id === "number" && Number.isSafeInteger(value.id)) return { kind: "element", id: value.id };
  if (value.kind === "command" && typeof value.name === "string" && value.name.length > 0 && value.name.length <= 256) return { kind: "command", name: value.name };
}
export function parseHandlerEditSource(value: unknown): HandlerEditSource {
  parseHandlerSource(value);
  if (!isRecord(value) || typeof value.name !== "string" || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(value.name) || typeof value.exists !== "boolean" || typeof value.bound !== "boolean") throw new ExplorerError("protocolInvalid");
  return value as unknown as HandlerEditSource;
}
export function parseHandlerEditPlan(value: unknown): HandlerEditPlan {
  parseHandlerEditSource(value); parseLocation(value);
  if (!isRecord(value) || typeof value.version !== "string" || typeof value.outputSnapshot !== "string" || !/^[a-f0-9]{64}$/.test(value.outputSnapshot)
    || value.change !== null && (!isRecord(value.change) || !isRecord(value.change.range) || !Number.isSafeInteger(value.change.range.start)
      || Number(value.change.range.start) < 0 || value.change.range.end !== value.change.range.start || typeof value.change.text !== "string")) throw new ExplorerError("protocolInvalid");
  return value as unknown as HandlerEditPlan;
}
