import { isRecord } from "./protocol.js";
import { message, type MessageKey } from "./messages.js";

const phases: Record<string, MessageKey> = {
  check_structure: "operationCheckStructure", prepare_analyzer: "operationPrepareAnalyzer", analyze_modules: "operationAnalyzeModules",
  inspect: "operationInspect", import: "runtimeImporting", apply: "runtimeApplying", remove: "operationRemove",
  verify: "operationVerify", prepare_base: "operationPrepareBase", create_infobase: "operationCreateInfobase",
  prepare_sources: "operationPrepareSources", publish_artifact: "operationPublishArtifact",
  build: "operationBuild", unpack: "operationUnpack", patch: "operationPatch",
};
const steps: Record<string, MessageKey> = {
  update_database: "operationUpdateDatabase", validate_metadata: "operationValidateMetadata",
  process_database_structure: "operationDatabaseStructure", collect_service_information: "operationCollectService",
  dynamic_restructuring_changed: "operationDynamicRestructuring", accept_changes: "operationAcceptChanges",
  generation_created: "operationGenerationCreated", read_configuration: "operationReadConfiguration",
  import_configuration: "operationImportConfiguration", database_updated: "operationDatabaseUpdated",
  build_help_index: "operationBuildHelpIndex", help_index_built: "operationHelpIndexBuilt",
  object_added: "operationObjectAdded", object_modified: "operationObjectModified", object_restructuring: "operationObjectRestructuring",
};
const commands: Record<string, MessageKey> = {
  read_generation: "operationReadGeneration", checksum_main: "operationChecksumMain", checksum_database: "operationChecksumDatabase",
  list_extensions: "operationListExtensions", export_configuration: "operationExportConfiguration", save_configuration: "operationSaveConfiguration",
  read_extension_info: "operationReadExtensionInfo",
};
const objectTypes = new Set([
  "Catalog", "Справочник", "Document", "Документ", "InformationRegister", "РегистрСведений",
  "AccumulationRegister", "РегистрНакопления", "AccountingRegister", "РегистрБухгалтерии", "CalculationRegister", "РегистрРасчета",
  "Constant", "Константа", "Enum", "Перечисление", "ChartOfAccounts", "ПланСчетов", "ChartOfCharacteristicTypes", "ПланВидовХарактеристик",
  "ChartOfCalculationTypes", "ПланВидовРасчета", "ExchangePlan", "ПланОбмена", "BusinessProcess", "БизнесПроцесс",
  "Task", "Задача", "DocumentJournal", "ЖурналДокументов", "Sequence", "Последовательность",
]);

/** A clock describes waiting, never infers progress in the platform or database. */
export class OperationProgress {
  private readonly started: number;
  private stageStarted: number;
  private lastDatabaseChange: number | undefined;
  private modules: { processed: number; total: number } | undefined;
  private lastAnalyzerActivity: number | undefined;
  private objectsSeen: number | undefined;
  private nativeLines: number | undefined;
  private lastEvent: number | undefined;
  private caption = "";
  private phase: string | undefined;
  private historyCaption = "";
  private component = "";
  private readonly timer: ReturnType<typeof setInterval>;
  private disposed = false;

  constructor(private readonly language: string, private readonly report: (message: string) => void,
    private readonly now: () => number = () => performance.now(),
    private readonly history?: (line: string) => void) {
    this.started = this.now();
    this.stageStarted = this.started;
    this.timer = setInterval(() => this.render(), 1000);
    this.timer.unref?.();
    this.render();
  }

  event(event: unknown): void {
    if (this.disposed) return;
    if (!isRecord(event) || event.schema_version !== 1) return;
    if (event.kind !== "operation_progress" && event.kind !== "apply_progress" && event.kind !== "extension_progress") return;
    const phase = typeof event.phase === "string" && Object.hasOwn(phases, event.phase) ? phases[event.phase] : undefined;
    if (!phase) return;
    if (event.kind === "operation_progress" && !["stage", "command", "native", "activity", "heartbeat", "database_file_changed"].includes(String(event.event))) return;
    const named = typeof event.step === "string" ? event.step : "";
    const native = Object.hasOwn(steps, named) ? steps[named] : undefined;
    const command = Object.hasOwn(commands, named) ? commands[named] : undefined;
    if (event.event === "native" && !native || event.event === "command" && !command) return;
    const parts = typeof event.object === "string" ? event.object.split(".") : [];
    const object = parts.length === 2 && objectTypes.has(parts[0]!) && /^[\p{L}_][\p{L}\p{N}_]{0,127}$/u.test(parts[1]!)
      ? String(event.object) : undefined;
    const objectStep = event.step === "object_added" || event.step === "object_modified" || event.step === "object_restructuring";
    if (objectStep && !object) return;
    // Project identifiers cannot carry addresses, paths, terminal controls or arbitrary diagnostics.
    const component = typeof event.component === "string" && /^[\p{L}_][\p{L}\p{N}_.-]{0,127}$/u.test(event.component)
      ? event.component : "";
    if (event.phase !== this.phase || component !== this.component) {
      this.phase = String(event.phase);
      this.component = component;
      this.stageStarted = this.now();
      this.nativeLines = undefined;
      this.objectsSeen = undefined;
      this.modules = undefined;
      this.lastAnalyzerActivity = undefined;
      this.lastEvent = undefined;
      this.lastDatabaseChange = undefined;
      this.caption = message(this.language, phase);
    }
    const step = command ?? native;
    if (step && (event.event === "native" || event.event === "command" || event.event === "heartbeat"))
      this.caption = `${message(this.language, phase)} — ${message(this.language, step, object ?? "")}`;
    else if (event.event === "stage" || event.kind !== "operation_progress") this.caption = message(this.language, phase);
    if (event.phase === "analyze_modules" && typeof event.processed_modules === "number" && typeof event.total_modules === "number"
      && Number.isSafeInteger(event.processed_modules) && Number.isSafeInteger(event.total_modules)
      && event.processed_modules >= 0 && event.total_modules >= event.processed_modules) {
      if (event.processed_modules > (this.modules?.processed ?? 0)) this.lastAnalyzerActivity = this.now();
      this.modules = { processed: event.processed_modules, total: event.total_modules };
    }
    if (typeof event.objects_seen === "number" && Number.isSafeInteger(event.objects_seen) && event.objects_seen >= 0)
      this.objectsSeen = event.objects_seen;
    if (event.event === "native" || event.event === "activity") this.lastEvent = this.now();
    if (typeof event.native_lines === "number" && Number.isSafeInteger(event.native_lines) && event.native_lines >= 0)
      this.nativeLines = event.native_lines;
    if (typeof event.db_change_age_ms === "number" && Number.isFinite(event.db_change_age_ms) && event.db_change_age_ms >= 0)
      this.lastDatabaseChange = this.now() - event.db_change_age_ms;
    else if (event.db_change_age_ms === null) this.lastDatabaseChange = undefined;
    if (typeof event.stage_elapsed_ms === "number" && Number.isFinite(event.stage_elapsed_ms) && event.stage_elapsed_ms >= 0)
      this.stageStarted = this.now() - event.stage_elapsed_ms;
    // Backend quiet time also covers native lines aggregated between heartbeats.
    if (event.kind === "operation_progress" && typeof event.quiet_ms === "number" && Number.isFinite(event.quiet_ms) && event.quiet_ms >= 0)
      this.lastEvent = this.now() - event.quiet_ms;
    else if (event.kind === "operation_progress" && event.quiet_ms === null) this.lastEvent = undefined;
    if (event.event === "database_file_changed" && this.lastDatabaseChange !== undefined)
      this.history?.(`[${duration(this.now() - this.started)}] ${message(this.language, "operationDatabaseChanged", duration(this.now() - this.lastDatabaseChange))}`);
    const caption = this.component ? `${this.component} — ${this.caption}` : this.caption;
    if (caption !== this.historyCaption) {
      this.historyCaption = caption;
      this.history?.(`[${duration(this.now() - this.started)}] ${caption}`);
    }
    this.render();
  }

  update(caption: string): void {
    if (this.disposed) return;
    this.caption = caption;
    this.lastEvent = this.now();
    this.render();
  }

  private render(): void {
    if (this.disposed) return;
    const now = this.now();
    const elapsed = duration(now - this.started);
    const key: MessageKey = this.lastEvent === undefined ? "operationWaiting" : "operationLastMessage";
    const checking = this.phase === "check_structure" || this.phase === "prepare_analyzer" || this.phase === "analyze_modules";
    const activity = checking
      ? message(this.language, this.lastAnalyzerActivity === undefined ? "operationCheckWaiting" : "operationAnalyzerActivity", duration(now - (this.lastAnalyzerActivity ?? this.stageStarted)))
      : message(this.language, key, duration(now - (this.lastEvent ?? this.stageStarted)));
    const moduleCount = this.modules ? message(this.language, "operationModulesProcessed", String(this.modules.processed), String(this.modules.total)) : "";
    const databaseActivity = this.lastDatabaseChange === undefined ? "" : message(this.language, "operationDatabaseChanged", duration(now - this.lastDatabaseChange));
    const stageElapsed = this.phase === undefined ? "" : message(this.language, "operationStageElapsed", duration(now - this.stageStarted));
    this.report([this.component ? `${this.component} — ${this.caption}` : this.caption, message(this.language, "operationElapsed", elapsed), stageElapsed, activity, moduleCount, databaseActivity, this.objectsSeen === undefined ? "" : message(this.language, "operationObjectsSeen", String(this.objectsSeen)), checking || this.nativeLines === undefined ? "" : message(this.language, "operationNativeLines", String(this.nativeLines))].filter(Boolean).join(" · "));
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
  }
}

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const tail = `${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}:${tail}` : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
