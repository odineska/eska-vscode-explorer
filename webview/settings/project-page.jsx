import { createMemo, For, Match, Show, Switch } from "solid-js";
import { Button } from "../ui/controls.jsx";
import { AnalyzerSettings } from "./analyzer-settings.jsx";
import { FormatSettings } from "./format-settings.jsx";
import { GitFileEditor } from "./git-settings.jsx";
import { gitRules } from "./git-rules.mjs";
import { caption, field, SettingsFields, SettingsGroup, word } from "./project-controls.jsx";

export const settingsSections = [
  ["run", caption("Запуск и отладка", "Run and Debug")],
  ["general", caption("Проект и сборка", "Project and Build")],
  ["format", caption("Форматирование", "Formatting")],
  ["analyzer", caption("Анализ BSL", "BSL Analysis")],
  ["check", caption("Проверки", "Checks")],
  ["git", caption("Git", "Git")],
];
const filenames = { manifest: "eska.toml", ignore: ".gitignore", attributes: ".gitattributes" };
const scopes = ["InfoBase", "DataSeparation"];
const scopeLabels = { InfoBase: caption("Информационная база", "Infobase"), DataSeparation: caption("Область данных", "Data area") };
const projectFields = [
  field("project.name", "string", "Имя проекта", "Project name"),
  field("project.type", "enum", "Тип проекта", "Project type", {
    required: true, choices: ["configuration", "extension", "processing", "report"],
    choiceLabels: {
      configuration: caption("Конфигурация", "Configuration"),
      extension: caption("Расширение", "Extension"),
      processing: caption("Обработка", "Data processor"),
      report: caption("Отчёт", "Report"),
    },
  }),
  field("project.source", "string", "Каталог исходников", "Source directory", { default: "src" }),
];
const buildVersion = field("build.platform_version", "string", "Версия платформы для сборки", "Build platform version",
  { placeholder: "8.3.27.2342" });
const buildDirectory = field("build.artifacts_directory", "string", "Каталог артефактов", "Artifact directory", { default: "build" });
const targetVersion = (path) => field(path, "string", "Целевая версия платформы для анализа", "Target platform version for analysis",
  { placeholder: "8.3.27" });
const extensionScope = (path) => field(path, "enum", "Область установки расширения", "Extension scope",
  { choices: scopes, choiceLabels: scopeLabels, default: "InfoBase" });
const workspaceFields = [
  field("workspace.members", "map", "Приложения", "Applications", {
    itemFields: [
      field("configuration", "reference", "Основная конфигурация", "Base configuration", { allowProject: true }),
      field("extensions", "array", "Расширения", "Extensions", {
        initialEntry: () => ({ path: "" }),
        itemFields: [
          field("path", "string", "Каталог проекта", "Project directory", { required: true }),
          extensionScope("scope"),
          field("depends_on", "string[]", "Зависимости по именам проектов", "Dependencies by project name"),
        ],
      }),
      field("external_objects", "string[]", "Каталоги внешних обработок и отчётов", "External processor and report directories"),
      targetVersion("target_platform_version"),
    ],
  }),
];
const checkFields = [
  ["max_errors", "Максимум ошибок", "Maximum errors", 0],
  ["max_warnings", "Максимум предупреждений", "Maximum warnings"],
  ["max_information", "Максимум сообщений", "Maximum information messages"],
  ["max_hints", "Максимум подсказок", "Maximum hints"],
].map(([key, ru, en, limit]) => field("tools.eska-check." + key, "integer", ru, en, { default: limit, min: 0, max: Number.MAX_SAFE_INTEGER }));

function ProjectAndBuild(props) {
  const { locale, model } = props;
  const workspace = () => !!model.value().workspace;
  const analysisFields = createMemo(() => {
    if (workspace()) return [field("analysis.default_application", "enum", "Приложение по умолчанию", "Default application", {
      choices: Object.keys(model.value().workspace.members ?? {}),
    })];
    if (props.member) return [];
    const type = model.value().project?.type;
    return [
      targetVersion("analysis.target_platform_version"),
      ...(type === "configuration" ? [] : [field("analysis.configuration", "reference", "Основная конфигурация для анализа", "Base configuration for analysis")]),
      ...(type === "extension" ? [extensionScope("analysis.extension_scope")] : []),
    ];
  });
  return <div class="settings-columns">
    <div class="settings-column">
      <SettingsGroup title={workspace() ? word(locale, "Состав workspace", "Workspace composition") : word(locale, "Проект", "Project")} icon="configuration">
        <SettingsFields locale={locale} model={model} fields={workspace() ? workspaceFields : projectFields}/>
        <Show when={!workspace() && model.value().project}>
          <span class="settings-hint">{word(locale, "Формат исходников", "Source format")} · Designer XML</span>
        </Show>
      </SettingsGroup>
    </div>
    <div class="settings-column">
      <SettingsGroup title={word(locale, "Сборка", "Build")} icon="configuration">
        <SettingsFields locale={locale} model={model} fields={props.member ? [buildVersion] : [buildVersion, buildDirectory]}/>
      </SettingsGroup>
      <Show when={analysisFields().length}>
        <SettingsGroup title={word(locale, "Контекст анализа", "Analysis context")} icon="attributes">
          <SettingsFields locale={locale} model={model} fields={analysisFields()}/>
        </SettingsGroup>
      </Show>
    </div>
  </div>;
}

const workflow = ["vcs", "workflow"];
const workflowPresets = ["trunk", "git-flow", "github-flow"];
const workflowNames = {
  trunk: caption("Trunk", "Trunk"), "git-flow": caption("Git Flow", "Git Flow"),
  "github-flow": caption("GitHub Flow", "GitHub Flow"), custom: caption("Свой workflow", "Custom workflow"),
};
const workflowFields = [
  field("policy.main_branch", "string", "Основная ветка", "Main branch", { placeholder: "main" }),
  field("policy.base_branch", "string", "Ветка для новых задач", "Base branch for new tasks"),
  field("policy.integration_target", "string", "Ветка интеграции", "Integration branch"),
  field("policy.working_branch", "enum", "Рабочая ветка", "Working branch", {
    choices: ["task-branch"], choiceLabels: { "task-branch": caption("Ветка задачи", "Task branch") },
  }),
  field("policy.task_branch_template", "string", "Шаблон имени ветки задачи", "Task branch name template"),
  field("policy.remote", "string", "Имя Git remote", "Git remote name"),
  field("policy.sync_strategy", "enum", "Синхронизация веток", "Branch synchronization", {
    choices: ["rebase", "merge", "fast-forward-only"],
    choiceLabels: {
      rebase: caption("Перенести коммиты", "Rebase"),
      merge: caption("Слить ветки", "Merge"),
      "fast-forward-only": caption("Только fast-forward", "Fast-forward only"),
    },
  }),
  field("policy.publish", "enum", "Публикация ветки", "Branch publishing", {
    choices: ["push-task-branch", "disabled"],
    choiceLabels: { "push-task-branch": caption("Отправлять ветку задачи", "Push the task branch"), disabled: caption("Отключена", "Disabled") },
  }),
  field("policy.finish", "enum", "Условие завершения задачи", "Task completion requirement", {
    choices: ["require-published", "require-integrated"],
    choiceLabels: {
      "require-published": caption("Ветка опубликована", "Branch is published"),
      "require-integrated": caption("Изменения влиты", "Changes are integrated"),
    },
  }),
  field("policy.delete_local_branch", "boolean", "Удалять локальную ветку после завершения", "Delete local branch on completion"),
];

function Workflow(props) {
  const model = props.model;
  const { locale } = props;
  const value = () => model.value().vcs?.workflow;
  const active = () => value()?.preset ?? "";
  const activeBase = () => active() === "custom" ? value()?.extends : active();
  const defaults = () => {
    if (!workflowPresets.includes(activeBase())) return {};
    const development = activeBase() === "git-flow";
    return { base_branch: development ? "develop" : "main", integration_target: development ? "develop" : "main",
      main_branch: "main", working_branch: "task-branch", task_branch_template: activeBase() === "trunk" ? "task/{task}" : "feature/{task}",
      remote: "origin", sync_strategy: "rebase", publish: "push-task-branch", finish: "require-integrated", delete_local_branch: true };
  };
  return <SettingsGroup title={word(locale, "Рабочий процесс Git", "Git workflow")}>
    <label class="settings-field"><span class="settings-label">{word(locale, "Пресет workflow", "Workflow preset")}</span>
      <select value={active()} data-setting="vcs.workflow.preset" onChange={event => {
        const preset = event.currentTarget.value;
        if (!preset) model.set(["vcs"], undefined);
        else {
          const { extends: base, ...previous } = value() ?? {};
          model.set(workflow, { ...previous, preset, ...(preset === "custom" ? { extends: base ?? (active() || "trunk") } : {}) });
        }
      }}>
        <option value="">{word(locale, "Не настроен", "Not configured")}</option>
        <For each={[...workflowPresets, "custom"]}>{name => <option value={name}>{workflowNames[name][locale]}</option>}</For>
      </select>
    </label>
    <Show when={active()}>
      <Show when={active() === "custom"}>
        <SettingsFields locale={locale} model={model} fields={[field("vcs.workflow.extends", "enum", "На основе", "Based on", {
          choices: workflowPresets, choiceLabels: workflowNames,
        })]}/>
      </Show>
      <div class="settings-option-grid">
        <SettingsFields locale={locale} fields={workflowFields} model={{
          path: workflow, value, set: (path, v) => model.set([...workflow, ...path], v), error: model.error,
          inherited: ([, key]) => defaults()[key],
        }}/>
      </div>
    </Show>
  </SettingsGroup>;
}

function errorMessage(error, locale) {
  if (!error) return "";
  switch (error.code) {
    case "settings_changed": return word(locale, "Файл изменился. Перечитайте настройки перед сохранением.", "The file changed. Reload settings before saving.");
    case "dirty_editor": return word(locale, "Сохраните или закройте несохранённые правки файла в редакторе.", "Save or close the unsaved edits in the editor.");
    case "unavailable": return word(locale, "Для общих настроек нужна версия eska-project с поддержкой этой формы.", "Shared settings require a version of eska-project that supports this editor.");
    case "invalid_manifest":
    case "invalid_field": return error.field
      ? word(locale, "Проверьте параметр ", "Check the setting ") + error.field
      : word(locale, "Проверьте совместимость настроек, пути исходников и состав приложения.", "Check the option values, source paths, and application composition.");
    case "project_discovery": return word(locale, "В выбранном каталоге не найден eska.toml.", "No eska.toml was found in the selected directory.");
    case "settings_unsafe_path": return word(locale, "Файл настроек должен быть обычным файлом проекта.", "The settings file must be a regular file in the project.");
    case "settings_too_large": return word(locale, "Файл настроек превышает допустимый размер.", "The settings file exceeds the size limit.");
    case "analyzer_validation": {
      switch (error.analyzerCode) {
        case "process_start":
        case "analyzer_version":
        case "analyzer_contract":
          return word(locale, "Выберите совместимый BSL Analyzer для проверки настроек.", "Select a compatible BSL Analyzer to validate the settings.");
        case "context": return word(locale, "Выберите приложение и проверьте состав его исходников.", "Select the application and check its source paths.");
        case "timeout": return word(locale, "BSL Analyzer не успел проверить настройки.", "BSL Analyzer timed out while checking the settings.");
        default: return word(locale, "BSL Analyzer отклонил черновик. Проверьте значения и версию каталога.",
          "BSL Analyzer rejected the draft. Check the values and catalog version.");
      }
    }
    default: return word(locale, "Не удалось обработать настройки проекта.", "Could not process project settings.");
  }
}

function analyzerMessage(result, locale) {
  if (result?.status === "current") return word(locale, "Конфиг BSL Analyzer обновлён.", "BSL Analyzer configuration is up to date.");
  if (result?.status === "error") {
    const code = result.error?.code;
    if (code === "migration_required" || code === "managed_conflict") {
      return word(locale, "Настройки сохранены. Конфиг BSL Analyzer требует проверки ручных правок.",
        "Settings saved. Review manual changes to the BSL Analyzer configuration.");
    }
    if (code === "analyzer_busy" || code === "busy") {
      return word(locale, "Настройки сохранены. Конфиг BSL Analyzer занят другим сеансом.",
        "Settings saved. Another session is using the BSL Analyzer configuration.");
    }
    return word(locale, "Настройки сохранены. Обновить конфиг BSL Analyzer сейчас не удалось.",
      "Settings saved. The BSL Analyzer configuration could not be updated.");
  }
  return "";
}

function Preview(props) {
  return <details class="settings-detail settings-diff" data-settings-preview open>
    <summary>{word(props.locale, "Предпросмотр изменений", "Change preview")} · <code>{props.name}</code></summary>
    <div class="settings-option-grid">
      <div><span class="settings-label">{word(props.locale, "Сейчас", "Current")}</span><pre>{props.preview.before}</pre></div>
      <div><span class="settings-label">{word(props.locale, "После сохранения", "After saving")}</span><pre>{props.preview.after}</pre></div>
    </div>
  </details>;
}

export function ProjectPage(props) {
  const { locale, controller } = props;
  const read = () => controller.read(props.file);
  const dirty = () => controller.dirty(props.file);
  const available = () => dirty() && !read().pending && !read().conflict;
  const gitDefaults = () => gitRules(props.file, read().snapshot?.metadata?.gitTemplate ?? "").map(rule => rule.pattern);
  let form;
  const model = { path: [], value: () => read().draft, set: controller.set, error: () => read().error?.field };
  function perform(operation) {
    if (!available()) return;
    const invalid = form.querySelector("input:invalid, select:invalid");
    for (let details = invalid?.closest("details"); details; details = details.parentElement?.closest("details")) details.open = true;
    if (form.reportValidity()) controller.request(props.file, operation);
  }
  return <div onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
      event.preventDefault();
      perform("save");
    }
  }}>
    <Show when={props.section === "git"}>
      <nav class="settings-profiles" aria-label={word(locale, "Настройки Git", "Git settings")}>
        <For each={props.member ? ["ignore", "attributes"] : ["manifest", "ignore", "attributes"]}>{file =>
          <Button quiet class="settings-profile" data-git-file={file} aria-pressed={String(props.file === file)}
            onClick={() => props.openGitFile(file)}>
            {file === "manifest" ? word(locale, "Рабочий процесс", "Workflow") : file === "ignore" ? ".gitignore" : "Git LFS"}
            <Show when={controller.dirty(file)}><span class="settings-dirty-dot is-dirty" aria-hidden="true"/></Show>
          </Button>}</For>
      </nav>
    </Show>
    <Show when={read().error}><p class="settings-warning settings-error" role="alert">{errorMessage(read().error, locale)}</p></Show>
    <Show when={read().pending?.operation === "show"}>
      <p class="settings-load" role="status">{word(locale, "Читаем настройки…", "Loading settings…")}</p>
    </Show>
    <Show when={read().conflict}><p class="settings-warning" role="alert">
      {word(locale, "Файл изменился на диске. Перечитайте его, чтобы сохранить совместимые правки, или сбросьте черновик.",
        "The file changed on disk. Reload to keep compatible edits, or discard the draft.")}
    </p></Show>
    <Show when={read().snapshot}>
      <form ref={form} onSubmit={event => { event.preventDefault(); perform("save"); }}>
        <fieldset class="settings-fields" disabled={!!read().pending || read().conflict}>
          <Switch>
            <Match when={props.file !== "manifest"}>
              <SettingsGroup title={filenames[props.file]}>
                <For each={[props.file]}>{file =>
                  <GitFileEditor file={file} value={read().draft} locale={locale} defaults={gitDefaults()}
                    onChange={value => controller.edit(file, value)}/>
                }</For>
              </SettingsGroup>
            </Match>
            <Match when={props.section === "general"}><ProjectAndBuild locale={locale} model={model} member={props.member}/></Match>
            <Match when={props.section === "format"}><FormatSettings locale={locale} model={model} metadata={read().snapshot.metadata} snapshot={read().snapshot} api={props.api}/></Match>
            <Match when={props.section === "analyzer"}><AnalyzerSettings locale={locale} model={model} version={read().snapshot.metadata?.analyzerVersion}/></Match>
            <Match when={props.section === "check"}>
              <SettingsGroup title={word(locale, "Пороги проверки BSL", "BSL check thresholds")} icon="check">
                <p class="settings-hint">{word(locale, "Пустое поле оставляет значение по умолчанию. Число 0 запрещает сообщения этого уровня.",
                  "An empty field inherits the default. Zero allows no messages of that severity.")}</p>
                <div class="settings-option-grid"><SettingsFields locale={locale} fields={checkFields} model={model}/></div>
              </SettingsGroup>
            </Match>
            <Match when={props.section === "git"}><Workflow locale={locale} model={model}/></Match>
          </Switch>
        </fieldset>
        <Show when={read().preview}>{preview => <Preview name={filenames[props.file]} preview={preview()} locale={locale}/>}</Show>
        <Show when={analyzerMessage(read().analyzer, locale)}>{status =>
          <p class="settings-hint" role="status">{status()}</p>}
        </Show>
        <footer class="settings-footer">
          <p class="settings-save-status" role="status" data-status={dirty() ? "dirty" : "idle"}>
            <code>{filenames[props.file]}</code>
            <Switch>
              <Match when={read().pending?.operation === "save"}>{word(locale, "Сохраняем…", "Saving…")}</Match>
              <Match when={read().pending?.operation === "preview"}>{word(locale, "Проверяем черновик…", "Checking draft…")}</Match>
              <Match when={dirty()}>{word(locale, "Есть несохранённые изменения", "Unsaved changes")}</Match>
              <Match when={read().saved}>{word(locale, "Настройки сохранены", "Settings saved")}</Match>
            </Switch>
          </p>
          <div class="settings-actions">
            <Button quiet disabled={!dirty() || !!read().pending} data-settings-action="discard"
              onClick={() => controller.discard(props.file)}>{word(locale, "Сбросить", "Discard")}</Button>
            <Button disabled={!available()} data-settings-action="preview" onClick={() => perform("preview")}>
              {word(locale, "Предпросмотр", "Preview")}
            </Button>
            <Button primary type="submit" disabled={!available()} data-settings-action="save">
              {word(locale, "Сохранить", "Save")}
            </Button>
          </div>
        </footer>
      </form>
    </Show>
  </div>;
}
