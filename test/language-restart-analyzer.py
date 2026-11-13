"""Keep the real analyzer's CLI probes and control only the fixture's LSP peer."""

import json
import os
import signal
import subprocess
import sys
from pathlib import Path


analyzer = os.environ["ESKA_TEST_ANALYZER_BINARY"]
directory = Path(__file__).parent
mode = (directory / "analyzer-mode").read_text()
if sys.argv[1:2] != ["lsp"] or mode == "real":
    os.execv(analyzer, [analyzer, *sys.argv[1:]])


def send(**message):
    body = json.dumps({"jsonrpc": "2.0", **message}).encode()
    sys.stdout.buffer.write(f"Content-Length: {len(body)}\r\n\r\n".encode() + body)
    sys.stdout.buffer.flush()


def receive():
    length = None
    while line := sys.stdin.buffer.readline():
        if not line.strip():
            return json.loads(sys.stdin.buffer.read(length))
        name, _, value = line.partition(b":")
        if name.lower() == b"content-length":
            length = int(value)
    return None


def diagnostic(code):
    if document_uri:
        send(method="textDocument/publishDiagnostics", params={
            "uri": document_uri,
            "diagnostics": [{"code": code, "message": code, "severity": 1, "range": {
                "start": {"line": 0, "character": 0}, "end": {"line": 0, "character": 1},
            }}],
        })


document_uri = None
signal.signal(signal.SIGTERM, lambda *_: diagnostic("late-analyzer"))
(directory / f"analyzer-pid-{mode}").write_text(str(os.getpid()))
version = subprocess.check_output([analyzer, "--version"], text=True).split()[-1]
while message := receive():
    method = message.get("method")
    if method == "initialize" and mode != "initialize-hang":
        send(id=message["id"], result={
            "capabilities": {"textDocumentSync": 1},
            "serverInfo": {"name": "bsl-analyzer", "version": version},
        })
    elif method == "initialized":
        send(id="create-progress", method="window/workDoneProgress/create", params={"token": "controlled"})
    elif message.get("id") == "create-progress":
        send(method="$/progress", params={
            "token": "controlled", "value": {"kind": "begin", "title": "ESKA controlled Analyze"},
        })
    elif method == "textDocument/didOpen":
        document_uri = message["params"]["textDocument"]["uri"]
        diagnostic("stale-analyzer")
    elif method == "shutdown":
        diagnostic("late-analyzer")
