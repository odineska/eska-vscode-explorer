import { execFile } from "node:child_process";
import { isRecord } from "./protocol.js";

/** Keep local addresses, paths and credentials out of extension logs. */
export function runtimeJson(executable: string, args: string[], options: {
  timeout: number; signal?: AbortSignal | undefined; input?: unknown; onProgress?: ((event: unknown) => void) | undefined;
}): Promise<unknown> {
  return new Promise(resolve => {
    const child = execFile(executable, args, { signal: options.signal, timeout: options.timeout,
      maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (options.signal?.aborted || error?.killed || error?.signal) { resolve(undefined); return; }
      try {
        const value: unknown = JSON.parse(stdout);
        // Domain failures remain useful on nonzero exit; an interrupted/crashed command cannot report success.
        resolve(!error || typeof error.code === "number" && isRecord(value) && isRecord(value.error)
          && typeof value.error.code === "string" ? value : undefined);
      } catch { resolve(undefined); }
    });
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
