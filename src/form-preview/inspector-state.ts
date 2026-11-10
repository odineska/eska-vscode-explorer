import { isRecord } from "../protocol.js";
import { isIdentity, type ElementIdentity } from "./protocol.js";

export interface InspectorUi {
  upper: number;
  left: number;
  right: number;
  compactRight: number;
  dataWidth: number;
  zoom: number;
  tab: "attributes" | "commands" | "parameters";
  treeTab: "elements" | "commandInterface";
  compactPane: "elements" | "data";
  search: string;
  inspectedData: string;
  folded: Record<string, boolean>;
  dataFolded: Record<string, boolean>;
}
export interface InspectorState { ui: InspectorUi; selection?: ElementIdentity }

export function defaultInspectorUi(): InspectorUi {
  return { upper: 230, left: 30, right: 66, compactRight: 56, dataWidth: 48, zoom: 100, tab: "attributes",
    treeTab: "elements", compactPane: "elements", search: "", inspectedData: "", folded: {}, dataFolded: {} };
}

function folds(value: unknown, data: boolean): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const valid: [string, boolean][] = [];
  let bytes = 0;
  for (const [key, state] of Object.entries(value)) {
    if (typeof state !== "boolean" || !data && !state || !(data ? key.startsWith("attributes:") && key.length <= 2048 : /^[a-f0-9]{64}:current:(?:root|-?\d{1,20})$/.test(key))) continue;
    bytes += key.length + 12;
    if (bytes > 128_000) break;
    valid.push([key, state]);
  }
  return Object.fromEntries(valid);
}

/** Keep workspace storage bounded and independent of the model, revision and file contents. */
export function parseInspectorState(value: unknown): InspectorState | undefined {
  if (!isRecord(value) || !isRecord(value.ui)) return undefined;
  const input = value.ui, ui = defaultInspectorUi();
  for (const key of ["left", "right", "compactRight", "dataWidth", "upper"] as const) {
    const number = input[key];
    const maximum = key === "upper" ? 8192 : 100;
    if (typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= maximum) ui[key] = number;
  }
  if (typeof input.zoom === "number" && [50, 75, 100, 125, 150, 200].includes(input.zoom)) ui.zoom = input.zoom;
  if (input.tab === "commands" || input.tab === "parameters") ui.tab = input.tab;
  if (input.treeTab === "commandInterface") ui.treeTab = input.treeTab;
  if (input.compactPane === "data") ui.compactPane = input.compactPane;
  if (typeof input.search === "string") ui.search = input.search.slice(0, 512);
  if (typeof input.inspectedData === "string" && /^(attributes|commands|parameters):/.test(input.inspectedData)
    && input.inspectedData.length <= 2048) ui.inspectedData = input.inspectedData;
  ui.folded = folds(input.folded, false);
  ui.dataFolded = folds(input.dataFolded, true);
  return { ui, ...(isIdentity(value.selection) ? { selection: value.selection } : {}) };
}
