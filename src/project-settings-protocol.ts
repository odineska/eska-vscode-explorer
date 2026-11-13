import { isRecord } from "./protocol.js";

export type ProfileName = "test" | "prod";

export type Infobase =
  | { kind: "file"; path: string }
  | { kind: "cluster"; host: string; name: string }
  | { kind: "standalone"; url: string; name: string; admin_pid?: number | null };

export type Runner =
  | { kind: "local"; version?: string | null; ibcmd?: string | null }
  | { kind: "distrobox"; container: string; version?: string | null; ibcmd?: string | null };

export interface Profile {
  infobase: Infobase;
  runner: Runner;
  debug?: {
    url?: string | null;
    managed?: boolean;
    port?: number | null;
    auto_attach_types?: string[] | null;
    external_processing?: { artifact: string; debug_url?: string | null } | null;
  } | null;
  authentication?: { user: string; password_env?: string | null } | null;
}

export type LocalSettings = Record<ProfileName, Profile | null>;

type Operation = { id: string; profile: ProfileName };
export type SettingsRequest = Operation & (
  | { type: "load" }
  | { type: "save"; value: Record<string, unknown> | null }
  | { type: "probe"; value: Record<string, unknown> }
  | { type: "pickInfobase" | "cancelPick" }
);

export type SettingsResponse = Operation & (
  | { type: "settings"; operation: "load" | "save"; settings: LocalSettings; warning?: string }
  | { type: "probe"; ready: boolean; detail: string; field?: string }
  | { type: "infobase"; infobase?: Exclude<Infobase, { kind: "standalone" }>; detail?: string }
  | { type: "error"; operation: "load" | "save"; detail: string; field?: string; requiresReload?: boolean }
);

export function settingsRequest(value: unknown): SettingsRequest | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || !/^[0-9a-f-]{36}$/.test(value.id)
      || value.profile !== "test" && value.profile !== "prod") return;
  const { id, profile } = value;
  switch (value.type) {
    case "load":
    case "pickInfobase":
    case "cancelPick":
      return { type: value.type, id, profile };
    case "save":
      if (value.value === null || isRecord(value.value)) return { type: value.type, id, profile, value: value.value };
      return;
    case "probe":
      if (isRecord(value.value)) return { type: value.type, id, profile, value: value.value };
  }
}
