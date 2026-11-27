import { isRecord } from "./protocol.js";

export interface HistoryCommit {
  id: string; parents: string[]; subject: string;
  author: { name: string; email: string };
  authored_at: { seconds: number; offset: number };
  refs: { name: string; kind: string }[];
}
export interface HistoryPage { commits: HistoryCommit[]; next_cursor: string | null }

const objectId = (value: unknown): value is string => typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const refKinds = new Set(["head", "local", "remote", "tag"]);

function isCommit(value: unknown): value is HistoryCommit {
  if (!isRecord(value) || !objectId(value.id) || typeof value.subject !== "string" || !Array.isArray(value.parents)
    || !value.parents.every(objectId) || !isRecord(value.author) || !isRecord(value.authored_at)) return false;
  return typeof value.author.name === "string" && typeof value.author.email === "string"
    && Number.isSafeInteger(value.authored_at.seconds) && Number.isSafeInteger(value.authored_at.offset)
    && Array.isArray(value.refs) && value.refs.every(ref => isRecord(ref) && typeof ref.name === "string"
      && typeof ref.kind === "string" && refKinds.has(ref.kind));
}

export function parseHistoryPage(value: Record<string, unknown>): HistoryPage {
  const { commits, next_cursor } = value;
  if (!Array.isArray(commits) || commits.length > 200 || !commits.every(isCommit)
    || !(next_cursor === null || typeof next_cursor === "string" && next_cursor.length > 0 && next_cursor.length <= 256 && commits.length > 0)) {
    throw new Error("Invalid SCM history page");
  }
  return { commits, next_cursor };
}
