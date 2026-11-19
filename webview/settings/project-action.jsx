import { createSignal, onSettled, Show } from "solid-js";
import { Button } from "../ui/controls.jsx";
import { word } from "./project-controls.jsx";

export function ProjectAction(props) {
  const [pending, setPending] = createSignal();
  const [result, setResult] = createSignal();
  const doctor = props.action === "doctor";
  const label = () => doctor ? word(props.locale, "Проверить окружение", "Diagnose Environment")
    : word(props.locale, "Проверить проект", "Check Project");

  onSettled(() => {
    function receive(event) {
      const data = event.data;
      if (data?.type !== "project-action-result" || data.action !== props.action || data.id !== pending()) return;
      setPending();
      setResult(data);
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  });

  function run() {
    if (pending()) return;
    const id = crypto.randomUUID();
    setPending(id);
    setResult();
    props.api.postMessage({ type: "project-action", id, action: props.action });
  }

  return <>
    <div class="settings-check-row">
      <Button type="button" quiet data-project-action={props.action} onClick={run} disabled={!!pending()}>
        <span class="settings-icon" data-icon="check" aria-hidden="true"/>{label()}
      </Button>
      <Show when={pending()}>
        <span class="settings-hint" role="status">{word(props.locale, "Проверяем…", "Checking…")}</span>
      </Show>
    </div>
    <Show when={result()}>{report =>
      <Show when={doctor && !report().error} fallback={
        <p data-project-action-result={props.action} class={report().error ? "settings-warning settings-error" : "settings-hint"}
          role={report().error ? "alert" : "status"}>{report().text}</p>
      }>
        <pre class="settings-command-report" data-project-action-result={props.action} role="status" tabIndex={0}>{report().text}</pre>
      </Show>
    }</Show>
  </>;
}
