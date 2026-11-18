import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js";
import {
  analyzerCatalogForVersion, analyzerCatalogVersion
} from "./analyzer-catalog.mjs";
import { at, withValue } from "./project-draft.mjs";
import { childModel, SettingsFields, SettingsGroup, word } from "./project-controls.jsx";

const policyPath = ["tools", "bsl-analyzer"];
const diagnosticsPath = ["diagnostics", "parameters"];
const isTable = value => value !== null && typeof value === "object" && !Array.isArray(value);

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

  return <details class="settings-detail" data-setting={key}>
    <summary class="settings-property-bar">
      <span>{rule.label[props.locale] ?? rule.label.en} <code>{rule.id}</code></span>
      <span class="settings-hint">{mode()
        ? stateText(mode() === "on")
        : word(props.locale, "По умолчанию", "Default") + " · " + stateText(rule.defaultEnabled)}</span>
    </summary>
    <div class="settings-controls">
      <div class="settings-field">
        <label class="settings-label" for={id}>{word(props.locale, "Состояние правила", "Rule state")}</label>
        <select id={id} value={mode()} aria-label={rule.id + " · " + word(props.locale, "Состояние правила", "Rule state")}
          onChange={event => setMode(event.currentTarget.value)}>
          <option value="">{word(props.locale, "По умолчанию", "Default")} · {stateText(rule.defaultEnabled)}</option>
          <option value="on">{stateText(true)}</option>
          <option value="off">{stateText(false)}</option>
        </select>
      </div>
      <Show when={rule.parameters.length > 0 && mode() !== "off"} fallback={
        <Show when={rule.parameters.length > 0 && mode() === "off"}>
          <span class="settings-hint">{word(props.locale,
            "Включите правило, чтобы редактировать параметры. При сохранении выключенного правила параметры удаляются.",
            "Enable the rule to edit its parameters. Saving the rule as off removes its parameters.")}</span>
        </Show>
      }>
        <Show when={!mode()}><span class="settings-hint">{word(props.locale,
          "Изменение параметра включает правило. При сохранении состояния по умолчанию переопределения удаляются.",
          "Editing a parameter enables the rule. Saving the default state removes overrides.")}</span></Show>
        <SettingsFields locale={props.locale} model={parameters} fields={rule.parameters}/>
      </Show>
    </div>
  </details>;
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
  const rules = createMemo(() => {
    const words = search().trim().toLowerCase().split(/\s+/u);
    return catalog().diagnosticCatalog.filter(rule => {
      const searchable = [rule.id, rule.label.ru, rule.label.en].join(" ").toLowerCase();
      return words.every(term => searchable.includes(term));
    });
  });

  return <>
    <SettingsGroup title={word(props.locale, "BSL Analyzer", "BSL Analyzer")}>
      <Show when={matched()} fallback={
        <p class="settings-hint">{word(props.locale,
          `Используется каталог версии ${analyzerCatalogVersion}. Остальные поля сохраняются. Конфигурацию проверяет установленный BSL Analyzer.`,
          `Showing the ${analyzerCatalogVersion} catalog. Other fields are preserved. The installed BSL Analyzer checks the configuration.`)}</p>
      }>
        <p class="settings-hint">{word(props.locale, "Версия каталога", "Catalog version")} {props.version}</p>
      </Show>
      <For each={catalog().analyzerGroups}>{group =>
        <details class="settings-detail" data-analyzer-group={group.id}>
          <summary>{group.label[props.locale] ?? group.label.en}</summary>
          <div class="settings-controls">
            <SettingsFields locale={props.locale} model={policy} fields={group.fields}/>
          </div>
        </details>
      }</For>
    </SettingsGroup>
    <SettingsGroup title={word(props.locale, "Правила диагностики", "Diagnostic rules")}>
      <div class="settings-field">
        <label class="settings-label" for={searchId}>{word(props.locale, "Поиск по названию или коду", "Search by name or code")}</label>
        <input id={searchId} type="search" data-setting="analyzer.rule-search"
          value={search()} onInput={event => setSearch(event.currentTarget.value)}/>
      </div>
      <Show when={rules().length} fallback={
        <p class="settings-hint">{word(props.locale, "Правила не найдены.", "No matching rules.")}</p>
      }>
        <For each={rules()}>{rule => <DiagnosticRule rule={rule} model={policy} locale={props.locale} stashedParameters={stashedParameters}/>}</For>
      </Show>
    </SettingsGroup>
  </>;
}
