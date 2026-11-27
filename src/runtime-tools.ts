import { spawn, type ChildProcess } from "node:child_process";
import { isRecord } from "./protocol.js";

interface RuntimeOptions {
  timeout: number; signal?: AbortSignal | undefined; input?: unknown; onProgress?: ((event: unknown) => void) | undefined;
  maxOutputBytes?: number | undefined; env?: NodeJS.ProcessEnv;
}

/** Capture a normal tool exit, including reports that use a nonzero status for findings. */
export function runtimeOutput(executable: string, args: string[], options: RuntimeOptions):
  Promise<{ code: number; stdout: string; stderr: string } | undefined> {
  return new Promise(resolve => {
    let child: ChildProcess;
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let stderrBytes = 0;
    let failed = false;
    const limit = options.maxOutputBytes ?? 32 * 1024 * 1024;
    const reader = options.onProgress ? new RuntimeProgressReader(options.onProgress) : undefined;
    try {
      child = spawn(executable, args, { signal: options.signal, timeout: options.timeout,
        windowsHide: true, shell: false, stdio: "pipe",
        ...(options.env || options.onProgress ? { env: { ...process.env, ...options.env, ...(options.onProgress ? { ESKA_OPERATION_PROGRESS: "1" } : {}) } } : {}) });
    } catch { resolve(undefined); return; }
    child.on("error", () => { failed = true; });
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > limit) { failed = true; child.kill(); }
      else stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      reader?.write(chunk);
      // Diagnostic output is only retained as a bounded tail; long live streams never kill the operation.
      if (options.onProgress) stderr = (stderr + chunk).slice(-16 * 1024);
      else {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > limit) { failed = true; child.kill(); }
        else stderr += chunk;
      }
    });
    child.on("close", (code, signal) => {
      reader?.end();
      resolve(failed || options.signal?.aborted || signal || code === null ? undefined : { code, stdout, stderr });
    });
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

/** Bound incomplete diagnostic lines independently of the process output budget. */
export class RuntimeProgressReader {
  private partial = "";
  private dropping = false;
  constructor(private readonly emit: (event: unknown) => void, private readonly limit = 16 * 1024) {}

  write(chunk: string): void {
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== "\n") continue;
      this.append(chunk.slice(start, index));
      this.flush();
      start = index + 1;
    }
    this.append(chunk.slice(start));
  }

  end(): void { this.flush(); }

  private append(value: string): void {
    if (this.dropping) return;
    if (this.partial.length + value.length > this.limit) {
      this.partial = "";
      this.dropping = true;
    } else this.partial += value;
  }

  private flush(): void {
    const line = this.partial;
    const dropped = this.dropping;
    this.partial = "";
    this.dropping = false;
    if (dropped || !line.startsWith("{")) return;
    try { this.emit(JSON.parse(line)); } catch { /* Diagnostics and unsupported lines are not progress. */ }
  }
}
