import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import {
  analyzerCatalogForVersion, analyzerCatalogVersion, diagnosticSeverityField
} from "./analyzer-catalog.mjs";
import { at, withValue } from "./project-draft.mjs";
import { childModel, SettingsFields, SettingsGroup, word } from "./project-controls.jsx";

const policyPath = ["tools", "bsl-analyzer"];
const diagnosticsPath = ["diagnostics", "parameters"];
const isTable = value => value !== null && typeof value === "object" && !Array.isArray(value);
const groupIcons = {
  source: "configuration", platform_help: "language", analysis: "service",
  diagnostics_baseline: "check", editor: "form", search: "storage",
  search_workspace: "modules", search_reference: "common-templates",
};

function isFormatConfigured(format) {
  if (!isTable(format)) return false;
  return Object.entries(format).some(([key, value]) =>
    ["profile", "profile_version", "exclude"].includes(key) ||
    (Array.isArray(value) ? value.length > 0 : isTable(value) && Object.keys(value).length > 0));
}

function DiagnosticRule(props) {
  const id = createUniqueId();
  const rule = props.rule;
  const path = [...diagnosticsPath, rule.id];
  const key = [...props.model.path, ...path].join(".");
  const value = () => at(props.model.value(), path);
  const mode = () => value() === false ? "off" : value() === true || isTable(value()) ? "on" : "";

  function setMode(next) {
    if (isTable(value())) props.stashedParameters.set(rule.id, value());
    props.model.set(path, next === "on" ? props.stashedParameters.get(rule.id) ?? true : next === "off" ? false : undefined);
  }

  const parameters = childModel(props.model, path, {
    set: (parameter, replacement) => {
      const current = value();
      const table = isTable(current) ? current : {};
      props.model.set(path, withValue(table, parameter, replacement));
    }
  });

  const stateText = (enabled) => enabled
    ? word(props.locale, "Включено", "On")
    : word(props.locale, "Выключено", "Off");

  return <article class="settings-analyzer-rule" data-setting={key}>
    <div class="settings-analyzer-rule-header">
      <label class="settings-label" for={id}>{rule.label[props.locale] ?? rule.label.en} <code>{rule.id}</code></label>
      <div class="settings-field">
        <select id={id} value={mode()} aria-label={rule.id + " · " + word(props.locale, "Состояние правила", "Rule state")}
          onChange={event => setMode(event.currentTarget.value)}>
          <option value="">{word(props.locale, "По умолчанию", "Default")} · {stateText(rule.defaultEnabled)}</option>
          <option value="on">{stateText(true)}</option>
          <option value="off">{stateText(false)}</option>
        </select>
      </div>
    </div>
    <Show when={props.severityOverrides}>
      <SettingsFields locale={props.locale} model={props.model} fields={[diagnosticSeverityField(rule.id)]}/>
    </Show>
    <Show when={rule.parameters.length > 0 && mode() !== "off"}>
      <div class="settings-option-grid settings-grouped-fields">
        <SettingsFields locale={props.locale} model={parameters} fields={rule.parameters}/>
      </div>
    </Show>
  </article>;
}

function fieldTerms(field) {
  return [field.path.join("."), field.label.ru, field.label.en];
}

export function AnalyzerSettings(props) {
  const [search, setSearch] = createSignal("");
  const stashedParameters = new Map();
  const searchId = createUniqueId();
  const matched = createMemo(() => analyzerCatalogForVersion(props.version));
  const catalog = () => matched() ?? analyzerCatalogForVersion(analyzerCatalogVersion);
  const policy = childModel(props.model, policyPath, {
    managedByFormat: () => isFormatConfigured(at(props.model.value(), ["format"]))
  });
  const terms = createMemo(() => search().trim().toLowerCase().split(/\s+/u).filter(Boolean));
  function matches(parts) {
    const searchable = parts.join(" ").toLowerCase();
    return terms().every(term => searchable.includes(term));
  }
  const groups = createMemo(() => {
    if (!terms().length) return catalog().analyzerGroups;
    return catalog().analyzerGroups.flatMap(group => {
      const name = [group.id, group.label.ru, group.label.en];
      if (matches(name)) return [group];
      const fields = group.fields.filter(field => matches([...name, ...fieldTerms(field)]));
      return fields.length ? [{ ...group, fields }] : [];
    });
  });
  const rules = createMemo(() => catalog().diagnosticCatalog.filter(rule =>
    matches([rule.id, rule.label.ru, rule.label.en, ...rule.parameters.flatMap(fieldTerms)])));

  return <>
    <SettingsGroup title={word(props.locale, "BSL Analyzer", "BSL Analyzer")}>
      <Show when={matched()} fallback={
        <p class="settings-hint">{word(props.locale,
          `Используется каталог версии ${analyzerCatalogVersion}. Остальные поля сохраняются. Конфигурацию проверяет установленный BSL Analyzer.`,
          `Showing the ${analyzerCatalogVersion} catalog. Other fields are preserved. The installed BSL Analyzer checks the configuration.`)}</p>
      }>
        <p class="settings-hint">{word(props.locale, "Версия каталога", "Catalog version")} {props.version}</p>
      </Show>
      <div class="settings-field">
        <label class="settings-label" for={searchId}>{word(props.locale, "Поиск по настройкам и диагностикам", "Search settings and diagnostic rules")}</label>
        <input id={searchId} type="search" data-setting="analyzer.rule-search"
          value={search()} onInput={event => setSearch(event.currentTarget.value)}/>
      </div>
      <Show when={!groups().length && !rules().length}>
        <p class="settings-hint">{word(props.locale, "Настройки и правила не найдены.", "No matching settings or rules.")}</p>
      </Show>
    </SettingsGroup>
    <For each={groups()}>{group =>
      <div data-analyzer-group={group.id}>
        <SettingsGroup title={group.label[props.locale] ?? group.label.en} icon={groupIcons[group.id] ?? "attributes"}>
          <div class="settings-option-grid settings-grouped-fields">
            <SettingsFields locale={props.locale} model={policy} fields={group.fields}/>
          </div>
        </SettingsGroup>
      </div>
    }</For>
    <Show when={rules().length}>
      <SettingsGroup title={word(props.locale, "Правила диагностики", "Diagnostic rules")} icon="check">
        <p class="settings-hint">{word(props.locale,
          "Изменение параметра включает правило. Выключение или сброс правила удаляет его параметры. Настройка уровня хранится отдельно.",
          "Editing a parameter enables its rule. Turning a rule off or resetting it removes its parameters. The severity setting is stored separately.")}</p>
        <For each={rules()}>{rule => <DiagnosticRule rule={rule} model={policy} locale={props.locale} severityOverrides={catalog().severityOverrides} stashedParameters={stashedParameters}/>}</For>
      </SettingsGroup>
    </Show>
  </>;
}
