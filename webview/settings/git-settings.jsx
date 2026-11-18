import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Button } from "../ui/controls.jsx";
import { appendGitRules, gitRules, missingGitDefaults, updateGitRule, validGitPattern } from "./git-rules.mjs";

const copy = {
  en: {
    ignoreHint: "Use Git patterns. Start with ! to include a path again, or with a backslash for a literal ! or #.",
    attributesHint: "To use spaces in a pattern, enclose it in double quotes. New rules apply when files are added to Git. They do not convert files already tracked or rewrite history.",
    sharedHint: "Other attributes on this line will stay with the original pattern.",
    pattern: "Pattern", apply: "Apply", remove: "Remove", add: "Add rule",
    defaults: "ESKA default rules", addDefault: "Add", noRules: "No rules.",
    invalid: "Enter a valid Git pattern on one line.",
  },
  ru: {
    ignoreHint: "Используйте шаблоны Git. Символ ! в начале отменяет исключение пути. Для буквальных ! и # начните с обратной косой черты.",
    attributesHint: "Шаблон с пробелами заключите в двойные кавычки. Новые правила действуют при добавлении файлов в Git. Для уже отслеживаемых файлов они не выполняют перенос в LFS и не переписывают историю.",
    sharedHint: "Остальные атрибуты этой строки сохранятся с исходным шаблоном.",
    pattern: "Шаблон", apply: "Применить", remove: "Удалить", add: "Добавить правило",
    defaults: "Стандартные правила ESKA", addDefault: "Добавить", noRules: "Правил пока нет.",
    invalid: "Введите допустимый шаблон Git в одной строке.",
  },
};

function applyOnEnter(event, apply) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.stopPropagation();
  apply();
}

function RuleRow(props) {
  const [value, setValue] = createSignal("");
  createEffect(() => props.rule()?.pattern, pattern => {
    setValue(pattern ?? "");
  });
  const changed = () => value() !== props.rule()?.pattern;
  const valid = () => validGitPattern(props.file, value());
  function apply() {
    if (changed() && valid()) props.onUpdate(value());
  }

  return <Show when={props.rule()}>
    <div class="settings-field">
      <input class="eska-code" type="text" value={value()} spellcheck="false" autocomplete="off"
        aria-label={props.labels.pattern + " " + props.rule().pattern}
        aria-invalid={changed() && !valid() ? "true" : undefined}
        onInput={event => setValue(event.currentTarget.value)} onKeyDown={event => applyOnEnter(event, apply)}/>
      <div class="settings-actions">
        <Show when={changed()}><Button quiet disabled={!valid()} onClick={apply}>{props.labels.apply}</Button></Show>
        <Button quiet onClick={() => props.onUpdate(null)}
          aria-label={props.labels.remove + " " + props.rule().pattern}>{props.labels.remove}</Button>
      </div>
      <Show when={changed() && !valid()}><span class="settings-field-error">{props.labels.invalid}</span></Show>
      <Show when={props.rule().shared}><span class="settings-hint">{props.labels.sharedHint}</span></Show>
    </div>
  </Show>;
}

export function GitFileEditor(props) {
  const [newPattern, setNewPattern] = createSignal("");
  const labels = () => copy[props.locale] ?? copy.en;
  const rules = createMemo(() => new Map(gitRules(props.file, props.value).map(rule => [rule.index, rule])));
  const indices = createMemo(() => [...rules().keys()]);
  const defaults = createMemo(() => missingGitDefaults(props.file, props.value, props.defaults));
  const valid = () => validGitPattern(props.file, newPattern());

  function addRule() {
    if (!valid()) return;
    props.onChange(appendGitRules(props.file, props.value, [newPattern()]));
    setNewPattern("");
  }

  return <div class="settings-controls">
    <p class="settings-hint">{props.file === "attributes" ? labels().attributesHint : labels().ignoreHint}</p>
    <Show when={indices().length} fallback={<span class="settings-hint">{labels().noRules}</span>}>
      <For each={indices()}>{index => <RuleRow file={props.file} labels={labels()}
        rule={() => rules().get(index)}
        onUpdate={pattern => props.onChange(updateGitRule(props.file, props.value, index, pattern))}/>}</For>
    </Show>
    <div class="settings-field">
      <input class="eska-code" type="text" value={newPattern()} spellcheck="false" autocomplete="off"
        aria-label={labels().add} aria-invalid={newPattern() && !valid() ? "true" : undefined}
        onInput={event => setNewPattern(event.currentTarget.value)} onKeyDown={event => applyOnEnter(event, addRule)}/>
      <Show when={newPattern() && !valid()}><span class="settings-field-error">{labels().invalid}</span></Show>
      <div><Button quiet disabled={!valid()} onClick={addRule}>{labels().add}</Button></div>
    </div>
    <Show when={defaults().length}>
      <details>
        <summary>{labels().defaults}</summary>
        <ul>
          <For each={defaults()}>{pattern => <li class="settings-toggle">
            <code>{pattern}</code>
            <Button quiet aria-label={labels().addDefault + " " + pattern}
              onClick={() => props.onChange(appendGitRules(props.file, props.value, [pattern]))}>{labels().addDefault}</Button>
          </li>}</For>
        </ul>
      </details>
    </Show>
  </div>;
}
