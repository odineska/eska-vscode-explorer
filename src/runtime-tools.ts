import { execFile, type ChildProcess } from "node:child_process";
import { isRecord } from "./protocol.js";

interface RuntimeOptions {
  timeout: number; signal?: AbortSignal | undefined; input?: unknown; onProgress?: ((event: unknown) => void) | undefined;
  maxOutputBytes?: number | undefined;
}

/** Capture a normal tool exit, including reports that use a nonzero status for findings. */
export function runtimeOutput(executable: string, args: string[], options: RuntimeOptions):
  Promise<{ code: number; stdout: string; stderr: string } | undefined> {
  return new Promise(resolve => {
    let child: ChildProcess;
    try {
      child = execFile(executable, args, { signal: options.signal, timeout: options.timeout,
        maxBuffer: options.maxOutputBytes ?? 32 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
        if (options.signal?.aborted || error?.killed || error?.signal || error && typeof error.code !== "number") {
          resolve(undefined);
          return;
        }
        resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
      });
    } catch { resolve(undefined); return; }
    if (options.onProgress && child.stderr) {
      let partial = "";
      child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
        const lines = (partial + chunk).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("{")) {
            try { options.onProgress?.(JSON.parse(line)); } catch { /* stderr can also contain diagnostics */ }
          }
        }
      });
    }
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input === undefined ? undefined : JSON.stringify(options.input));
  });
}

/** Keep local addresses, paths and credentials out of extension logs. */
export async function runtimeJson(executable: string, args: string[], options: RuntimeOptions & {
  resultExitCodes?: readonly number[];
}): Promise<unknown> {
  const output = await runtimeOutput(executable, args, options);
  if (!output) return;
  try {
    const value: unknown = JSON.parse(output.stdout);
    // Domain failures remain useful on nonzero exit; an interrupted/crashed command cannot report success.
    if (output.code === 0 || options.resultExitCodes?.includes(output.code)
      || isRecord(value) && isRecord(value.error) && typeof value.error.code === "string") return value;
  } catch { /* Some older tools report errors as text. */ }
}
