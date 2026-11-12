# Connect a project to ESKA Explorer

## Install components

Install the VSIX through **Extensions → Install from VSIX…**. Its extension ID is
`1c-tooling.eska-explorer`; the minimum VS Code API version is **1.109.0**.
The project repositories and downloads belong to **odineska**.
[Packaging](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/packaging.md) · [ESKA installation](https://odineska.github.io/eska/).

The default backend is `eska-project serve --stdio`. The tree needs only Explorer
and `eska-project`. Git, the full facade, the 1C platform and Analyzer are optional.
Install a compatible `bsl-analyzer-app` for language services and `eska-fmt` for
formatting. Use **Prepare project, formatter and language components** to check
and prepare these tools. Available assets depend on the selected release and
host architecture. [Component setup](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/component-setup.md).

For a local ESKA checkout, build `cargo build -p eska-project` and select the
resulting executable. The three paths are independent:

```json
{
  "eska.explorer.executable": "/path/to/eska-project",
  "eska.explorer.analyzerExecutable": "/path/to/bsl-analyzer-app",
  "eska.explorer.formatterExecutable": "/path/to/eska-fmt"
}
```

Use absolute paths on the workspace host. Default discovery checks the managed
installation first, then absolute PATH entries. An explicit path has no fallback.
For Remote SSH, WSL and Dev Containers, tools run on the workspace host.
Virtual workspaces, browser-only hosts and untrusted workspaces are unsupported.

## Connect existing Designer XML

When an existing export has no manifest:

```sh
eska-project init ./my-project --source src
eska-project --project-dir ./my-project validate --format json
```

Use `--source .` when XML is at the root. Supported project types are configuration,
extension, processing and report; the root XML normally determines the type.
This init command does not initialize Git, start 1C or generate XML/forms.
Do not run it over an existing manifest. For an external report/data processor,
`eska add ssl_3_1` links BSP; its user-wide installation lives in `~/.eska/lib`.
[Projects and applications](https://odineska.github.io/eska/docs/#workspace).

Open the manifest folder and expand **ESKA: 1C Explorer**. With multiple independent
folders, use **Select Project and Connect**. Restart the connection after changing
the backend executable. Manifest changes are watched automatically.

## Language and formatting

BSL/SDBL syntax highlighting works without Analyzer. Opening BSL starts Explorer's
language client. Set `eska.explorer.languageFeatures = false` to disable that client
while keeping the tree. Resolve conflicts with other BSL extensions explicitly.
[Language service, config and leases](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/language-service.md).

Use Format Document / Format Selection and ESKA as the formatter. Configure style
in `[format]` in `eska.toml`; editor indentation does not override it.
`eska.explorer.formatOnSave` is disabled by default. A missing `eska-fmt` is never
replaced with Analyzer formatting. [All options](https://odineska.github.io/eska/docs/formatting/).

API 1.34 aligns multiline string argument continuations using the editor font
for related parameter labels and transparent offsets. Independent single-line
hints keep their usual appearance. Alignment requires `editor.inlayHints.enabled = "on"`.
Conditional modes, explicit accessibility support and actionable hints use native
rendering. [Alignment details](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/language-service.md#многострочные-аргументы-и-подсказки-параметров).

## Capabilities and workspace activity

The current Metadata API is **1.35**, while the minimum tree contract is **1.12**.
Query sessions, BSL literals, advanced constructor operations, formatting,
alignment and project activity require their respective negotiated capabilities.
An older tree connection does not provide every current feature.
[Capability matrix](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/cli-management.md#версии-пользовательских-возможностей).

Disable unused workspace projects to release their indexes and watchers.
A disabled dependency stays in the semantic context while an active consumer
needs its sources. The single
selected language context stays alive while it has an active consumer; the
show/hide inactive filter affects presentation independently.
[Activity](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/usage.md#активность-подпроектов).

## Run, apply and debug

Open **Project Runtime Settings** from the project tree to save independent local
`test` and `prod` profiles. **Check saved profile** checks the installation and
endpoint reachability. The project settings file belongs in the local Git ignore.

The project settings context menu starts a normal test client or previews the
changes for a test infobase. Apply requires confirmation for the displayed base
and files. The first import and unsupported partial changes require a separate
full-import preview. To update an installed `InfoBase` extension, open the ESKA
workspace root and select the extension project. ESKA uses the main project's
`test` profile. The confirmation identifies the extension by name and UUID.
Changes to existing BSL files can be applied partially.

For HTTP debugging, build the optional Rust executable with
`cargo build --release -p eska-debug` in the ESKA repository. Use **Launch with Debugger** or **Attach
Debugger** in the same menu. A VS Code launch configuration can use
`"type": "eska-debug"`, `"request": "launch"` or `"attach"`, and
`"profile": "test"` or `"prod"`. Set `eska.explorer.debugExecutable` to the path of the resulting executable.
Start the configured external HTTP debug server before attaching or launching.

For an ESKA external processing project, set **Built EPF file** in its local
runtime profile. Keep the build manifest beside the artifact. For attach, set
**Deployed EPF URL for attach** to the exact URL reported by the 1C debugger.
[EPF deployment and source verification](https://github.com/odineska/eska/blob/main/docs/1c-http-debug.md#epf-в-проекте-explorer)
For a file infobase, **Start a local debug server** lets ESKA start and stop
its own server and show the address in Debug Console. The port is optional.
For an existing client, choose its target after attaching. The
**Select 1C Debug Target** command refreshes the list in an active session.
Use **Select 1C Auto-Attach Types** to change which new targets join the
active session automatically. To set the initial types for future sessions,
enable **Customize automatic attachment** in the profile's Project Settings.
An empty custom list allows manual selection only.
In a workspace, breakpoints and stack navigation use the selected project's
application from `eska.toml`, including its configuration and extensions.
Production prompts for a source decision after checking the
configured Git remote. Evaluate can modify infobase data.

## Offline use and troubleshooting

Installed compatible tools work without network access. Disable `checkForUpdates`,
`checkForAnalyzerUpdates` and `checkForFormatterUpdates` to stop background checks.
Clicking the ESKA status item updates all managed components; use **Manage Components**
for individual actions. Connection errors appear in the connection log, language
errors in Output. Legacy `eska ide` must be selected explicitly using
`backend = "legacy"` and an `eska` executable.
[Updates and recovery](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/component-setup.md) · [Backend selection](https://github.com/odineska/eska-vscode-explorer/blob/main/docs/cli-management.md).
