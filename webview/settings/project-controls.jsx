import { createSignal, createUniqueId, For, Match, Show, Switch } from "solid-js";
import { Button } from "../ui/controls.jsx";
import { at } from "./project-draft.mjs";

export const caption = (ru, en) => ({ ru, en });
export const field = (path, type, ru, en, extra) => ({ path: path.split("."), type, label: caption(ru, en), ...extra });

function isCompactInteger(option) {
  return option.type === "integer" && option.min >= 0 && Number.isInteger(option.max) && option.max <= 99;
}

export function SettingsGroup(props) {
  const id = createUniqueId();
  return <section class="settings-group" aria-labelledby={id}>
    <header class="group-heading"><h2 id={id}>
      <span class="settings-icon" data-icon={props.icon ?? "attributes"} aria-hidden="true"/>{props.title}
    </h2>{props.action}</header>
    <div class="settings-controls">{props.children}</div>
  </section>;
}

export const word = (locale, ru, en) => locale === "ru" ? ru : en;
const local = (locale, value) => typeof value === "string" ? value : value?.[locale];

function shown(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value != null && typeof value !== "object") return String(value);
  return "";
}

export function SettingsFields(props) {
  return <For each={props.fields}>{option =>
    <Show when={!option.visibleWhen || option.visibleWhen.values.includes(at(props.model.value(), option.visibleWhen.path))
      || at(props.model.value(), option.path) !== undefined}>
      <Setting model={props.model} option={option} locale={props.locale}/>
    </Show>
  }</For>;
}

function Setting(props) {
  const option = props.option;
  const model = props.model;
  const locale = props.locale;
  const id = "project-setting-" + createUniqueId();
  const key = [...model.path, ...option.path].join(".");
  const value = () => at(model.value(), option.path);
  const update = (replacement) => model.set(option.path, replacement);
  const label = local(locale, option.label);
  const hint = local(locale, option.hint);
  const inherited = () => model.inherited?.(option.path) ?? option.default;
  const effective = () => value() ?? inherited();
  const managed = () => option.managedBy === "eska" || option.managedBy === "format" && model.managedByFormat?.();
  const compact = () => isCompactInteger(option) && !managed();
  const error = () => model.error?.() === key;
  const description = () => [hint && id + "-hint", error() && id + "-error"].filter(Boolean).join(" ") || undefined;
  const defaultText = word(locale, "Наследовать", "Inherit");
  const yes = word(locale, "Включено", "On");
  const no = word(locale, "Выключено", "Off");
  const reset = () => <Show when={value() !== undefined && !option.required && !managed()}>
    <Button quiet class="settings-import" title={defaultText}
      aria-label={defaultText + " · " + label} onClick={() => update(undefined)}>{defaultText}</Button>
  </Show>;
  return <div class={compact() ? "settings-field settings-counter" : "settings-field"} data-setting={key}>
    <Switch>
      <Match when={managed()}>
        <span class="settings-label">{label}</span>
        <span class="settings-hint">{option.managedBy === "eska"
          ? word(locale, "Вычисляется из настроек проекта", "Derived from project settings")
          : word(locale, "Значение берётся из раздела «Форматирование»", "Value comes from Formatting")}</span>
      </Match>
      <Match when={option.type === "boolean"}>
        <div class="settings-property-bar">
          <label class="settings-toggle" for={id}>
            <input type="checkbox" id={id} checked={effective() === true}
              aria-describedby={[id + "-status", description()].filter(Boolean).join(" ")}
              aria-invalid={error() || undefined} onChange={event => update(event.currentTarget.checked)}/>
            <span>{label}</span>
          </label>
          {reset()}
        </div>
        <span class="settings-hint" id={id + "-status"}>{value() === undefined
          ? inherited() === undefined ? defaultText : defaultText + " · " + (inherited() ? yes : no)
          : effective() ? yes : no}</span>
      </Match>
      <Match when={option.type === "enum"}>
        <label class="settings-label" for={id}>{label}</label>
        <select id={id} value={value() ?? ""} aria-invalid={error() || undefined} aria-describedby={description()}
          onChange={event => update(event.currentTarget.value || undefined)}>
          <Show when={!option.required || value() === undefined}>
            <option value="">{defaultText}{inherited() ? " · " + selectionLabel(option, inherited(), locale) : ""}</option>
          </Show>
          <Show when={value() && !option.choices.includes(value())}><option value={value()}>{value()}</option></Show>
          <For each={option.choices}>{choice =>
            <option value={choice}>{selectionLabel(option, choice, locale)}</option>}</For>
        </select>
      </Match>
      <Match when={option.type === "string[]" || option.type === "array" || option.type === "map"}>
        <div class="settings-property-bar">
          <span class="settings-label" id={id}>{label}</span>{reset()}
        </div>
        <Show when={value() === undefined && !option.required}><span class="settings-hint">{defaultText}</span></Show>
        <Collection id={id} option={option} model={model} locale={locale} value={value()} update={update}/>
      </Match>
      <Match when={option.type === "reference"}>
        <Reference id={id} label={label} model={model} option={option} locale={locale} value={value()} update={update}/>
      </Match>
      <Match when={option.type === "object"}>
        <details class="settings-detail">
          <summary>{label}</summary>
          <SettingsFields locale={locale} model={childModel(model, option.path)} fields={option.itemFields}/>
        </details>
      </Match>
      <Match when={["integer", "number", "string"].includes(option.type)}>
        <div class="settings-property-bar"><label class="settings-label" for={id}>{label}</label>{reset()}</div>
        <input id={id} autocomplete="off" spellcheck="false" class="eska-code"
          type={option.type === "string" ? "text" : "number"}
          inputmode={compact() ? "numeric" : undefined}
          min={option.min} max={option.max} step={option.type === "number" ? "any" : undefined}
          aria-invalid={error() || undefined} aria-describedby={description()}
          required={option.required} value={shown(value())}
          placeholder={shown(inherited()) || option.placeholder}
          onInput={event => {
            const input = event.currentTarget;
            if (!input.value && !input.validity.badInput) update(option.required ? "" : undefined);
            else if (option.type === "string") update(input.value);
            else if (Number.isFinite(input.valueAsNumber)) update(input.valueAsNumber);
          }}/>
      </Match>
    </Switch>
    <Show when={hint}><span class="settings-hint" id={id + "-hint"}>{hint}</span></Show>
    <Show when={error()}><span class="settings-field-error" id={id + "-error"}>
      {word(locale, "Проверьте значение поля.", "Check the value of this field.")}
    </span></Show>
  </div>;
}

function selectionLabel(option, choice, locale) {
  return local(locale, option.choiceLabels?.[choice]) ?? choice;
}

export function childModel(parent, path, extra = {}) {
  return {
    ...parent,
    path: [...parent.path, ...path],
    value: () => at(parent.value(), path),
    set: (key, value) => parent.set([...path, ...key], value),
    inherited: undefined,
    ...extra,
  };
}

function Collection(props) {
  const option = props.option;
  const locale = props.locale;
  const rows = () => Array.isArray(props.value) ? props.value : [];
  const keys = () => props.value && option.type === "map" ? Object.keys(props.value) : [];
  const [name, setName] = createSignal("");
  const removeText = word(locale, "Удалить", "Remove");
  const addText = word(locale, "Добавить", "Add");
  function addKey() {
    if (!name().trim() || keys().includes(name().trim())) return;
    props.update({ ...props.value, [name().trim()]: option.initialEntry?.() ?? {} });
    setName("");
  }
  function addRow() {
    const value = option.type === "string[]" ? "" : option.initialEntry?.() ?? {};
    props.update([...rows(), value]);
  }
  function moveRow(index, delta) {
    const items = [...rows()];
    [items[index], items[index + delta]] = [items[index + delta], items[index]];
    props.update(items);
  }
  return <div class="settings-list" role="group" aria-labelledby={props.id}>
    <Show when={option.type === "map"} fallback={<>
      <For each={rows().map((_, index) => index)}>{index =>
        <div class="settings-list-row">
          <div class="settings-list-content">
            <Show when={option.type === "string[]"} fallback={
              <SettingsFields locale={locale} model={childModel(props.model, [...option.path, index])} fields={option.itemFields}/>
            }>
              <Show when={option.choices?.length} fallback={
                <input class="eska-code" type="text" autocomplete="off" spellcheck="false"
                  aria-label={local(locale, option.label) + " · " + (index + 1)} value={rows()[index]}
                  required onInput={event => props.model.set([...option.path, index], event.currentTarget.value)}/>
              }>
                <select required aria-label={local(locale, option.label) + " · " + (index + 1)}
                  value={rows()[index]} onChange={event => props.model.set([...option.path, index], event.currentTarget.value)}>
                  <option value="">{word(locale, "Выберите значение", "Choose a value")}</option>
                  <Show when={rows()[index] && !option.choices.includes(rows()[index])}>
                    <option value={rows()[index]}>{rows()[index]}</option>
                  </Show>
                  <For each={option.choices}>{choice =>
                    <option value={choice}>{selectionLabel(option, choice, locale)}</option>}</For>
                </select>
              </Show>
            </Show>
          </div>
          <div class="settings-actions">
            <Show when={option.ordered}>
              <Button quiet class="settings-import" disabled={index === 0}
                aria-label={word(locale, "Переместить выше", "Move up")} onClick={() => moveRow(index, -1)}>↑</Button>
              <Button quiet class="settings-import" disabled={index === rows().length - 1}
                aria-label={word(locale, "Переместить ниже", "Move down")} onClick={() => moveRow(index, 1)}>↓</Button>
            </Show>
            <Button quiet class="settings-import" disabled={rows().length <= (option.minItems ?? 0)}
              aria-label={removeText + " · " + (index + 1)}
              onClick={() => props.update(rows().filter((_, i) => i !== index))}>{removeText}</Button>
          </div>
        </div>}</For>
      <Button quiet class="settings-import settings-list-add" aria-label={addText + " · " + local(locale, option.label)}
        onClick={addRow}>{addText}</Button>
    </>}>
      <For each={keys()}>{key =>
        <details class="settings-detail">
          <summary>{key}</summary>
          <SettingsFields locale={locale} model={childModel(props.model, [...option.path, key])} fields={option.itemFields}/>
          <Button quiet class="settings-import settings-list-add" aria-label={removeText + " · " + key}
            onClick={() => props.model.set([...option.path, key], undefined)}>{removeText}</Button>
        </details>}</For>
      <div class="settings-list-row settings-key-input">
        <input class="eska-code" type="text" value={name()} aria-label={word(locale, "Имя", "Name")}
          placeholder={word(locale, "Имя", "Name")} onInput={event => setName(event.currentTarget.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addKey(); } }}/>
        <Button quiet class="settings-import" disabled={!name().trim() || keys().includes(name().trim())}
          onClick={addKey}>{addText}</Button>
      </div>
    </Show>
  </div>;
}

function Reference(props) {
  const { locale, option } = props;
  const mode = () => typeof props.value === "string" ? "project" : props.value
    ? Object.hasOwn(props.value, "library") ? "library" : "source" : "";
  const value = () => mode() === "project" ? props.value : props.value?.[mode()] ?? "";
  function set(mode, text) {
    props.update(mode === "" ? undefined : mode === "project" ? text : { [mode]: text });
  }
  return <>
    <label class="settings-label" for={props.id}>{props.label}</label>
    <select id={props.id} value={mode()} onChange={event => set(event.currentTarget.value, "")}>
      <option value="">{word(locale, "Не выбрана", "None")}</option>
      <Show when={option.allowProject}><option value="project">{word(locale, "Участник workspace", "Workspace member")}</option></Show>
      <option value="source">{word(locale, "Путь к выгрузке XML", "Path to XML export")}</option>
      <option value="library">{word(locale, "Имя библиотеки", "Library name")}</option>
    </select>
    <Show when={mode()}>
      <input type="text" class="eska-code" required value={value()}
        aria-label={props.label} onInput={event => set(mode(), event.currentTarget.value)}/>
    </Show>
  </>;
}
