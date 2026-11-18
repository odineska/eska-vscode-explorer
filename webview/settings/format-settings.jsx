import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch, untrack } from "solid-js";
import { Button } from "../ui/controls.jsx";
import { caption, childModel, field, SettingsFields, SettingsGroup, word } from "./project-controls.jsx";
import { at, manifestEdits } from "./project-draft.mjs";

const optionNames = {
  indent_style: caption("Символ отступа", "Indent character"),
  indent_width: caption("Ширина отступа", "Indent width"),
  tab_width: caption("Ширина табуляции", "Tab width"),
  continuation_indent_width: caption("Добавочный отступ продолжения", "Continuation indent"),
  column_limit: caption("Ограничение длины строки", "Line length limit"),
  keyword_case: caption("Регистр ключевых слов", "Keyword case"),
  space_after_comma: caption("Пробел после запятой", "Space after comma"),
  space_around_operators: caption("Пробелы вокруг операторов", "Spaces around operators"),
  space_inside_parentheses: caption("Пробелы внутри скобок", "Spaces inside parentheses"),
  space_before_call_parenthesis: caption("Пробел перед скобкой вызова", "Space before call parenthesis"),
  wrap_arguments: caption("Перенос аргументов", "Argument wrapping"),
  wrap_binary: caption("Перенос бинарных выражений", "Binary expression wrapping"),
  break_before_binary_operators: caption("Перенос перед бинарным оператором", "Line break before binary operator"),
  max_empty_lines: caption("Максимум пустых строк подряд", "Maximum consecutive blank lines"),
  trim_trailing_whitespace: caption("Удалять хвостовые пробелы", "Trim trailing whitespace"),
  insert_final_newline: caption("Перевод строки в конце файла", "Final newline"),
  comments: caption("Отступы комментариев", "Comment indentation"),
  align_assignments: caption("Выравнивать присваивания", "Align assignments"),
  separate_object_initialization: caption("Отделять инициализацию объекта", "Separate object initialization"),
  align_call_arguments: caption("Выравнивать запятые соседних вызовов", "Align commas in adjacent calls"),
  closing_parenthesis_on_new_line: caption("Закрывающая скобка на новой строке", "Closing parenthesis on a new line"),
  preserve_existing_line_breaks: caption("Сохранять существующие переносы", "Keep existing line breaks"),
  indent_multiline_strings: caption("Выравнивать многострочные строки", "Align multiline strings"),
  blank_lines_between_methods: caption("Пустых строк между методами", "Blank lines between methods"),
  blank_lines_inside_methods: caption("Пустых строк на границах метода", "Blank lines inside method boundaries"),
  blank_lines_around_blocks: caption("Пустых строк вокруг блоков", "Blank lines around blocks"),
  blank_lines_inside_multistatement_blocks: caption("Пустых строк в блоках с несколькими операциями", "Blank lines inside multi-statement blocks"),
  blank_lines_before_return: caption("Пустых строк перед возвратом", "Blank lines before return"),
  blank_lines_around_multiline_statements: caption("Пустых строк вокруг многострочных инструкций", "Blank lines around multiline statements"),
  blank_lines_between_object_groups: caption("Пустых строк между группами операций объекта", "Blank lines between object operation groups"),
  select_items: caption("Перенос полей выборки", "Select field wrapping"),
  condition_items: caption("Перенос условий", "Condition wrapping"),
  group_items: caption("Перенос группировок и итогов", "Grouping and totals wrapping"),
  order_items: caption("Перенос полей сортировки", "Sort field wrapping"),
  blank_lines_between_queries: caption("Пустых строк между запросами", "Blank lines between queries"),
  clause_newlines: caption("Секции запроса с новой строки", "Query clauses on new lines"),
  align_aliases: caption("Выравнивать псевдонимы", "Align aliases"),
};

const choices = {
  tab: caption("Табуляция", "Tabs"),
  space: caption("Пробелы", "Spaces"),
  canonical: caption("Канонический", "Canonical"),
  upper: caption("Верхний", "Uppercase"),
  lower: caption("Нижний", "Lowercase"),
  preserve: caption("Сохранять", "Preserve"),
  fit: caption("По длине строки", "Fit to line length"),
  one_per_line: caption("По одному на строку", "One per line"),
  indent_only: caption("Менять только отступ", "Adjust indentation only"),
};

const scopes = [
  ["common", caption("Общие", "Common")],
  ["bsl", caption("BSL", "BSL")],
  ["sdbl", caption("Запросы", "Queries")],
  ["advanced", caption("Профили и исключения", "Profiles and exceptions")],
];
const profileLabels = { eska: caption("ESKA", "ESKA"), "1c": caption("1С", "1C") };

const optionGroups = [
  ["dimension", caption("Отступы", "Indentation"), key => key.includes("indent_") || key === "tab_width"],
  ["document-journal", caption("Пустые строки", "Blank lines"), key => key.startsWith("blank_lines_") || key === "max_empty_lines"],
  ["style-item", caption("Выравнивание", "Alignment"), key => key.startsWith("align_") || key === "separate_object_initialization"],
  ["module", caption("Переносы строк", "Line wrapping"), key => key.startsWith("wrap_")
    || ["column_limit", "break_before_binary_operators", "closing_parenthesis_on_new_line", "preserve_existing_line_breaks",
      "select_items", "condition_items", "group_items", "order_items", "clause_newlines"].includes(key)],
  ["attributes", caption("Пробелы", "Spacing"), key => key.startsWith("space_") || key === "trim_trailing_whitespace"],
  ["language", caption("Регистр и оформление", "Case and layout"), () => true],
];

function forScope(schema, scope) {
  const definitions = schema?.$defs?.[scope]?.properties ?? {};
  const keys = new Set([...Object.keys(optionNames), ...Object.keys(definitions)]);
  return [...keys].filter(key => Object.hasOwn(definitions, key)).map(key => {
    const option = definitions[key];
    return {
      path: [key],
      label: optionNames[key] ?? caption(key, key),
      type: option.enum ? "enum" : option.type,
      choices: option.enum,
      choiceLabels: choices,
      min: option.minimum,
      max: option.maximum,
      ...(key === "column_limit" ? { hint: caption("0 снимает ограничение.", "0 removes the limit.") } : {}),
    };
  });
}

function profileValue(name, language, key, configs, presets, visited = new Set()) {
  if (Object.hasOwn(presets, name)) return presets[name][language]?.[key];
  if (visited.has(name) || visited.size >= 32) return;
  visited.add(name);
  const definitions = configs.map(config => at(config, ["profiles", name])).filter(Boolean);
  const latest = definitions.slice().reverse();
  const explicit = latest.find(definition => at(definition, [language, key]) !== undefined)?.[language]?.[key]
    ?? latest.find(definition => at(definition, ["common", key]) !== undefined)?.common?.[key];
  const base = latest.find(definition => definition.based_on)?.based_on ?? "1c";
  return explicit ?? profileValue(base, language, key, configs, presets, visited);
}

function FormattingExample(props) {
  const [example, setExample] = createSignal();
  const [pending, setPending] = createSignal();
  const [error, setError] = createSignal(false);
  let timer, submitted;
  function request(pick = false) {
    clearTimeout(timer);
    submitted = JSON.stringify([props.snapshot.revision, props.model.value()]);
    const id = crypto.randomUUID();
    setPending(id); setError(false);
    props.api?.postMessage({ type: "format-preview", id, revision: props.snapshot.revision,
      edits: manifestEdits(props.snapshot.value, props.model.value()),
      ...(!pick && example()?.source ? { source: example().source } : {}),
    });
  }
  function receive(event) {
    const data = event.data;
    if (data?.type !== "format-preview" || data.id !== pending()) return;
    setPending();
    if (data.error) setError(data.error.code ?? "unavailable");
    else if (!data.cancelled && typeof data.before === "string" && typeof data.after === "string") {
      setExample(data);
      if (submitted !== JSON.stringify([props.snapshot.revision, props.model.value()])) request();
    }
  }
  window.addEventListener("message", receive);
  onCleanup(() => { clearTimeout(timer); window.removeEventListener("message", receive); });
  createEffect(() => [JSON.stringify(props.model.value()), props.snapshot.revision], () => {
    clearTimeout(timer);
    if (untrack(example)?.source) {
      // Invalidate old replies immediately, including while the debounce is pending.
      setPending();
      timer = setTimeout(() => request(), 300);
    }
  });
  return <SettingsGroup title={word(props.locale, "Пример форматирования", "Formatting example")} icon="module">
    <Button type="button" disabled={!!pending()} onClick={() => request(true)}>
      {word(props.locale, "Показать на примере", "Show an example")}
    </Button>
    <Show when={pending()}><p role="status">{word(props.locale, "Обновление примера…", "Updating example…")}</p></Show>
    <Show when={error()}><p role="alert">{error() === "invalid_scope" || error() === "unsupported_source"
      ? word(props.locale, "Выберите BSL-модуль этого проекта или workspace.", "Choose a BSL module from this project or workspace.")
      : error() === "incompatible"
      ? word(props.locale, "Обновите ESKA для предпросмотра настроек форматирования.", "Update ESKA to preview formatting settings.")
      : error() === "source_conflict" || error() === "config_conflict"
      ? word(props.locale, "Исходник или настройки изменились. Повторите просмотр примера.", "Source or settings changed. Show the example again.")
      : word(props.locale, "Не удалось обновить пример. Проверьте модуль, черновик и установленный форматтер.",
        "Could not update the example. Check the module, draft settings and installed formatter.")}</p></Show>
    <Show when={example()}>{value => <>
      <p class="settings-hint">{word(props.locale, "Пример по черновику. Исходник и настройки не изменяются.",
        "Example from the draft. Source and settings stay unchanged.")} <code>{value().source}</code></p>
      <div class="settings-option-grid settings-diff" data-format-preview aria-busy={!!pending()}>
        <div><span class="settings-label">{word(props.locale, "До", "Before")}</span><pre>{value().before}</pre></div>
        <div><span class="settings-label">{word(props.locale, "После", "After")}</span><pre>{value().after}</pre></div>
      </div>
    </>}</Show>
  </SettingsGroup>;
}

export function FormatSettings(props) {
  const locale = props.locale;
  const [scope, setScope] = createSignal("bsl");
  const format = childModel(props.model, ["format"]);
  const parent = () => props.metadata?.formatInherited;
  const profileNames = createMemo(() => [...new Set([
    "eska", "1c", ...Object.keys(parent()?.profiles ?? {}), ...Object.keys(format.value()?.profiles ?? {}),
  ])]);
  const selected = () => format.value()?.profile ?? parent()?.profile ?? "eska";
  const selectedFields = createMemo(() => [field("profile", "enum", "Базовый пресет", "Base preset", {
    choices: profileNames(), choiceLabels: profileLabels,
    default: parent()?.profile ?? "eska",
  })]);
  const advanced = createMemo(() => {
    const languageFields = scopes.slice(0, 3).map(([id, label]) => ({
      path: [id], label, type: "object", itemFields: forScope(props.metadata?.formatSchema, id),
    }));
    return [
      field("exclude", "string[]", "Исключить из форматирования", "Exclude from formatting"),
      field("profiles", "map", "Командные профили", "Team profiles", {
        itemFields: [
          field("based_on", "enum", "На основе", "Based on", { choices: profileNames(), choiceLabels: profileLabels, default: "1c" }),
          ...languageFields,
        ],
      }),
      field("overrides", "array", "Переопределения по файлам", "Overrides by file", {
        ordered: true,
        initialEntry: () => ({ include: [""] }),
        itemFields: [
          field("include", "string[]", "Включить пути", "Include paths", { required: true, minItems: 1 }),
          field("exclude", "string[]", "Исключить пути", "Exclude paths"),
          ...languageFields,
        ],
        hint: caption("Правила применяются по порядку. Последнее совпавшее правило переопределяет заданные в нём параметры.",
          "Rules apply in order. The last matching rule wins for each option it sets."),
      }),
    ];
  });
  function inherited(language, [key]) {
    const presets = props.metadata?.formatPresets ?? {};
    const config = format.value();
    const lower = lang => at(parent(), [lang, key]) ?? at(parent(), ["common", key])
      ?? profileValue(selected(), lang, key, [parent(), config], presets);
    if (language !== "common") return at(config, ["common", key]) ?? lower(language);
    const bsl = lower("bsl");
    return Object.is(bsl, lower("sdbl")) ? bsl : undefined;
  }
  const groups = createMemo(() => {
    const options = forScope(props.metadata?.formatSchema, scope());
    const groups = optionGroups.map(([icon, label]) => ({ icon, label, fields: [] }));
    for (const option of options) {
      const index = optionGroups.findIndex(([, , includes]) => includes(option.path[0]));
      groups[index].fields.push(option);
    }
    return groups.filter(group => group.fields.length);
  });
  const style = createMemo(() => {
    const language = scope();
    return childModel(format, [language], { inherited: path => inherited(language, path) });
  });
  return <>
    <FormattingExample {...props}/>
    <SettingsGroup title={word(locale, "Стиль форматирования", "Formatting style")} icon="configuration">
      <SettingsFields model={format} fields={selectedFields()} locale={locale}/>
      <nav class="settings-profiles" aria-label={word(locale, "Область форматирования", "Formatting scope")}>
        <For each={scopes}>{([id, label]) => <Button quiet class="settings-profile" data-format-scope={id}
          aria-pressed={String(scope() === id)} onClick={() => setScope(id)}>{label[locale]}</Button>}</For>
      </nav>
    </SettingsGroup>
    <Switch>
      <Match when={scope() === "advanced"}>
        <SettingsGroup title={word(locale, "Профили и исключения", "Profiles and exceptions")} icon="attributes">
          <SettingsFields model={format} fields={advanced()} locale={locale}/>
        </SettingsGroup>
      </Match>
      <Match when={scope()}>
        <For each={groups()}>{group =>
          <SettingsGroup title={group.label[locale]} icon={group.icon}>
            <div class="settings-option-grid settings-grouped-fields">
              <SettingsFields model={style()} fields={group.fields} locale={locale}/>
            </div>
          </SettingsGroup>
        }</For>
      </Match>
    </Switch>
  </>;
}
