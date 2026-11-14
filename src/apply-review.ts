import type * as vscode from "vscode";
import { randomUUID } from "node:crypto";

/** A review owns only its acknowledgement; the backend revalidates the exact plan before writing. */
export class ApplyReview {
  private readonly pending = new Set<() => void>();

  constructor(private readonly api: typeof vscode) {}

  show(title: string, detail: string, accept: string, cancel: string): Promise<boolean> {
    const panel = this.api.window.createWebviewPanel("eska.applyReview", title, this.api.ViewColumn.Active,
      { enableScripts: true, localResourceRoots: [], enableFindWidget: true });
    const nonce = randomUUID();
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'">
      <style nonce="${nonce}">
      *{box-sizing:border-box}body{margin:0;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}
      main{height:100vh;display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:16px;padding:20px;max-width:1200px;margin:auto}
      h1{font-size:18px;font-weight:500;margin:0;overflow-wrap:anywhere}
      pre{margin:0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.7 var(--vscode-editor-font-family);padding:12px;border:1px solid var(--vscode-panel-border)}
      pre:focus{outline:1px solid var(--vscode-focusBorder)}footer{display:flex;gap:12px;flex-wrap:wrap}
      button{border:1px solid transparent;padding:7px 14px;cursor:pointer;color:var(--vscode-button-foreground);background:var(--vscode-button-background);font:inherit}
      button:hover{background:var(--vscode-button-hoverBackground)}button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}
      #cancel{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground)}
      @media(max-height:260px){main{padding:8px;gap:6px}h1{font-size:14px}button{padding:3px 8px}}
      </style></head><body><main id="root"><h1 id="title"></h1><pre id="changes" tabindex="0" role="region"></pre>
      <footer><button id="accept" disabled></button><button id="cancel"></button></footer></main>
      <script nonce="${nonce}">
      const api=acquireVsCodeApi();
      const accept=document.getElementById('accept'), cancel=document.getElementById('cancel'), changes=document.getElementById('changes');
      window.addEventListener('message',event=>{const value=event.data;if(value?.type!=='review')return;
        document.getElementById('title').textContent=value.title;changes.textContent=value.detail;changes.setAttribute('aria-label',value.title);
        accept.textContent=value.accept;cancel.textContent=value.cancel;accept.disabled=false;changes.focus();});
      accept.addEventListener('click',()=>{accept.disabled=true;api.postMessage({type:'accept'});});
      cancel.addEventListener('click',()=>api.postMessage({type:'cancel'}));
      window.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();api.postMessage({type:'cancel'});}});
      api.postMessage({type:'ready'});
      </script></body></html>`;
    return new Promise(resolve => {
      let settled = false;
      const finish = (accepted: boolean): void => {
        if (settled) return;
        settled = true;
        this.pending.delete(abort);
        received.dispose(); closed.dispose();
        panel.dispose(); resolve(accepted);
      };
      const abort = (): void => finish(false);
      const closed = panel.onDidDispose(abort);
      const received = panel.webview.onDidReceiveMessage((value: unknown) => {
        if (!value || typeof value !== "object" || !("type" in value)) return;
        if (value.type === "ready") void panel.webview.postMessage({ type: "review", title, detail, accept, cancel });
        else if (value.type === "accept") finish(true);
        else if (value.type === "cancel") finish(false);
      });
      this.pending.add(abort);
    });
  }

  dispose(): void { for (const abort of [...this.pending]) abort(); }
}
