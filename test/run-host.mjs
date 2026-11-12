import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, readFile, writeFile, cp, mkdir, symlink } from "node:fs/promises";
import { resolve, join, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createTreeProject } from "./fixture.mjs";
import { verifyRuntime } from "./installed-runtime.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const suite = resolve(repository, process.argv[2] ?? "test/extension-host.cjs");
const binary = process.env.ESKA_TEST_BINARY;
if (!binary || !isAbsolute(binary)) throw new Error("Set ESKA_TEST_BINARY to an absolute path to an IDE-enabled backend.");
const globalBinary = process.env.ESKA_HOST_GLOBAL_BINARY ?? binary;
const backend = process.env.ESKA_TEST_BACKEND ?? "project";
const locale = process.env.ESKA_HOST_LOCALE;
if (locale && !["ru", "en"].includes(locale)) throw new Error("ESKA_HOST_LOCALE must be ru or en.");
if (!["project", "legacy"].includes(backend)) throw new Error("ESKA_TEST_BACKEND must be project or legacy.");
if (!isAbsolute(globalBinary)) throw new Error("ESKA_HOST_GLOBAL_BINARY must be absolute.");
const playground = process.env.ESKA_TEST_ROOT ?? resolve(repository, "../eska-playground");
if (!isAbsolute(playground)) throw new Error("ESKA_TEST_ROOT must be absolute.");
// VS Code's Uri.fsPath lowercases drive letters; keep native fixture expectations in that form.
const root = (await mkdtemp(join(playground, "explorer-host-"))).replace(/^[A-Z]:/, drive => drive.toLowerCase());
const driverStarted = performance.now();
const receipt = {schemaVersion:1,suite:basename(suite),locale,runs:[],timings:{}};
const saveReceipt = async () => { if (process.env.ESKA_HOST_RECEIPT) await writeFile(process.env.ESKA_HOST_RECEIPT,JSON.stringify(receipt,null,2)+'\n'); };
try {
  await mkdir(join(root, "profile", "User"), { recursive: true });
  await writeFile(join(root, "profile", "User", "settings.json"), JSON.stringify({
    "workbench.startupEditor": "none", "onboarding.enabled": false,
    "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false, "update.mode": "none",
  }));
  const fixture = await createTreeProject(join(root, "project"), ["language-reference-host.cjs", "language-library-host.cjs", "language-add-host.cjs"].includes(basename(suite)) ? "processing" : process.env.ESKA_HOST_PROJECT_TYPE ?? "configuration");
  if (basename(suite) === "debug-http-host.cjs") {
    const native = JSON.parse(process.env.ESKA_HOST_HTTP_FIXTURE);
    const source = join(fixture.root, "src");
    await rm(source, { recursive: true });
    await cp(native.source, source, { recursive: true });
    const state = join(fixture.root, ".eska");
    await mkdir(state, { recursive: true });
    await cp(native.settings, join(state, "settings_local.toml"));
    if (native.scenario === "epf-server" || native.scenario === "epf-server-reload") {
      const base = join(root, "base");
      await mkdir(base);
      await cp(native.configuration, join(base, "src"), { recursive: true });
      await writeFile(join(base, "eska.toml"), "[project]\nname='base'\ntype='configuration'\n");
      await writeFile(join(root, "eska.toml"),
        '[workspace.members.debug]\nconfiguration="base"\nexternal_objects=["project"]\n');
    }
    if (native.scenario === "extensions") {
      const members = native.extensions.map(directory => basename(directory));
      await Promise.all(native.extensions.map((directory, index) => cp(directory, join(root, members[index]), { recursive: true })));
      await writeFile(join(fixture.root, "eska.toml"), "[project]\nname='base'\ntype='configuration'\n");
      const extensions = members.map(name => "{ path = " + JSON.stringify(name) + " }").join(", ");
      await writeFile(join(root, "eska.toml"), '[workspace.members.debug]\nconfiguration="project"\nextensions=[' + extensions + ']\n');
    }
  }
  if (["query-layout-host.cjs", "query-compact-performance-host.cjs"].includes(basename(suite))) {
    fixture.query = await (await import("./query-fixture.mjs")).createQuerySource(fixture);
    const fields = Array.from({ length: 48 }, (_, index) => `${index} AS КолонкаРезультата${index}WithLongEnglishName`).join(',\r\n|');
    await writeFile(fixture.module, `\ufeffПроцедура Test()\r\nQ = "SELECT ${fields}\r\n|FROM (SELECT 1 AS NestedValue) AS Child";\r\nКонецПроцедуры\r\n`);
  }
  if (["form-preview-host.cjs", "form-multiple-windows-host.cjs", "form-lifecycle-host.cjs", "form-reconnect-host.cjs", "form-restore-host.cjs", "form-detached-space-host.cjs", "form-property-catalogue-host.cjs"].includes(basename(suite))) fixture.form = await (await import("./form-fixture.mjs")).createFormSource(fixture);
  if (basename(suite) === "form-inspectors-host.cjs") fixture.form = await (await import("./form-fixture.mjs")).createFormInspectorSource(fixture);
  if (basename(suite) === "form-inspector-navigation-host.cjs") fixture.form = await (await import("./form-fixture.mjs")).createInspectorNavigationSource(fixture);
  if (basename(suite) === "form-handlers-host.cjs") fixture.form = await (await import("./form-fixture.mjs")).createFormHandlerSource(fixture);
  if (basename(suite) === "form-renderer-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createFormGallery(fixture);
  if (basename(suite) === "form-states-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createStateGallery(fixture);
  if (basename(suite) === "form-united-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createUnitedGallery(fixture);
  if (basename(suite) === "form-column-widths-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createColumnWidthGallery(fixture, locale ?? "en");
  if (basename(suite) === "form-numeric-labels-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createNumericLabelGallery(fixture, locale ?? "en");
  if (basename(suite) === "form-through-align-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createThroughAlignGallery(fixture);
  if (basename(suite) === "form-palette-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createPaletteGallery(fixture);
  if (basename(suite) === "form-style-host.cjs") fixture.form = await (await import("./form-fixture.mjs")).createStyleFormSource(fixture);
  if (basename(suite) === "form-style-palette-host.cjs") fixture.formPalette = await (await import("./form-fixture.mjs")).createStylePaletteGallery(fixture);
  if (basename(suite) === "form-style-color-roles-host.cjs") fixture.form = await (await import("./form-fixture.mjs")).createStyleColorRolesSource(fixture);
  if (basename(suite) === "form-tab-borders-host.cjs") fixture.tabBorders = await (await import("./form-fixture.mjs")).createTabBordersGallery(fixture);
  if (basename(suite) === "form-input-borders-host.cjs") fixture.inputBorders = await (await import("./form-fixture.mjs")).createInputBordersGallery(fixture);
  if (basename(suite) === "form-input-dimensions-host.cjs") fixture.inputDimensions = await (await import("./form-fixture.mjs")).createInputBordersGallery(fixture);
  if (basename(suite) === "form-input-stretch-host.cjs") fixture.inputStretch = await (await import("./form-fixture.mjs")).createInputBordersGallery(fixture);
  if (basename(suite) === "form-input-dates-host.cjs") fixture.inputDates = await (await import("./form-fixture.mjs")).createInputBordersGallery(fixture, { recordedTimeFormat: true });
  if (basename(suite) === "form-input-fonts-host.cjs") fixture.inputFonts = await (await import("./form-fixture.mjs")).createInputBordersGallery(fixture);
  if (basename(suite) === "form-frame-corners-host.cjs") fixture.frameCorners = await (await import("./form-fixture.mjs")).createFrameCornersGallery(fixture);
  if (basename(suite) === "form-font-roles-host.cjs") fixture.formFonts = await (await import("./form-fixture.mjs")).createFontRolesGallery(fixture);
  if (["form-primary-buttons-host.cjs", "form-button-borders-host.cjs"].includes(basename(suite))) fixture.primaryButtons = await (await import("./form-fixture.mjs")).createPrimaryButtonGallery(fixture);
  if (basename(suite) === "form-primary-appearance-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createPrimaryAppearanceGallery(fixture);
  if (basename(suite) === "form-table-viewport-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createTableViewportGallery(fixture);
  if (["form-unbound-buttons-host.cjs", "form-text-inputs-host.cjs", "form-number-inputs-host.cjs", "form-radio-layout-host.cjs", "form-decorations-host.cjs", "form-command-overflow-host.cjs", "form-command-bars-host.cjs", "form-group-visibility-host.cjs", "form-group-spacing-host.cjs", "form-input-choice-host.cjs", "form-usual-buttons-host.cjs", "form-button-metrics-host.cjs", "form-button-captions-host.cjs", "form-button-colors-host.cjs", "form-tab-titles-host.cjs", "form-window-titles-host.cjs", "form-standard-pictures-host.cjs", "form-text-document-host.cjs", "form-geographical-host.cjs", "form-graphical-host.cjs", "form-formatted-host.cjs", "form-html-host.cjs", "form-pdf-host.cjs", "form-spreadsheet-host.cjs", "form-calendar-host.cjs", "form-period-host.cjs", "form-planner-host.cjs", "form-dendrogram-host.cjs", "form-gantt-host.cjs", "form-chart-host.cjs"].includes(basename(suite))) fixture.formGallery = await (await import("./form-fixture.mjs")).createMeasuredFormGallery(fixture);
  if (["form-responsive-host.cjs", "form-body-scroll-host.cjs"].includes(basename(suite))) fixture.formGallery = await (await import("./form-fixture.mjs")).createResponsiveFormGallery(fixture);
  if (basename(suite) === "form-groups-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createGroupGallery(fixture);
  if (basename(suite) === "form-button-rows-host.cjs") fixture.buttonRows = await (await import("./form-fixture.mjs")).createButtonRowsSource(fixture);
  if (basename(suite) === "form-button-links-host.cjs") fixture.buttonTypes = await (await import("./form-fixture.mjs")).createButtonLinksSource(fixture);
  if (basename(suite) === "form-button-types-host.cjs") fixture.buttonTypes = await (await import("./form-fixture.mjs")).createButtonTypesSource(fixture);
  if (basename(suite) === "form-picture-composition-host.cjs") fixture.pictureComposition = await (await import("./form-fixture.mjs")).createPictureCompositionSource(fixture);
  if (basename(suite) === "form-style-composition-host.cjs") fixture.styleComposition = await (await import("./form-fixture.mjs")).createStyleCompositionSource(fixture);
  if (basename(suite) === "form-owners-host.cjs") fixture.formOwners = await (await import("./form-fixture.mjs")).createOwnerFormSource(fixture);
  if (basename(suite) === "form-composition-host.cjs") fixture.formComposition = await (await import("./form-fixture.mjs")).createCompositionFormSource(fixture);
  if (basename(suite) === "form-activity-host.cjs") fixture.formActivity = await (await import("./form-fixture.mjs")).createFormActivitySource(fixture);
  if (basename(suite) === "form-table-pixels-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createTablePixelsGallery(fixture);
  if (basename(suite) === "form-table-height-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createTableHeightGallery(fixture);
  if (basename(suite) === "form-standalone-additions-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createStandaloneAdditionGallery(fixture);
  if (basename(suite) === "form-command-palette-host.cjs") {
    const { formGallery, ...palette } = await (await import("./form-fixture.mjs")).createCommandPaletteGallery(fixture);
    fixture.formGallery = formGallery;
    fixture.commandPalette = palette;
  }
  if (basename(suite) === "form-table-palette-host.cjs") {
    const { formGallery, profiles, captions } = await (await import("./form-fixture.mjs")).createTablePaletteGallery(fixture);
    fixture.formGallery = formGallery;
    fixture.tablePalette = { profiles, captions };
  }
  if (basename(suite) === "form-reference-widths-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createReferenceWidthGallery(fixture);
  if (basename(suite) === "form-reference-buttons-host.cjs") fixture.referenceButtons = await (await import("./form-fixture.mjs")).createReferenceButtonGallery(fixture);
  if (basename(suite) === "form-choice-pictures-host.cjs") fixture.choicePictures = await (await import("./form-fixture.mjs")).createChoicePictureGallery(fixture);
  if (basename(suite) === "form-tables-host.cjs") fixture.formGallery = await (await import("./form-fixture.mjs")).createTableGallery(fixture);
  if (basename(suite) === "form-pictures-host.cjs") fixture.form = await (await import("./form-fixture.mjs")).createPictureFormSource(fixture);
  if (basename(suite) === "form-dependencies-host.cjs") fixture.form = await (await import("./form-fixture.mjs")).createDependencyFormSource(fixture);
  if (basename(suite) === "project-activity-host.cjs") fixture.activity = await (await import("./activity-fixture.mjs")).createActivitySource(fixture, root);
  if (basename(suite) === "project-groups-host.cjs") fixture.grouping = await (await import("./fixture.mjs")).createProjectGroupingSource(fixture);
  if (basename(suite) === "formatting-host.cjs") {
    if (process.env.ESKA_TEST_LANGUAGE === "1") fixture.languageSource = await (await import("./language-fixture.mjs")).createLanguageSource(fixture);
    fixture.query = await (await import("./query-fixture.mjs")).createQuerySource(fixture);
    await writeFile(fixture.module, '\ufeff// owner 😀\r\nПроцедура Test()\r\nЗначение=1;\r\nТекст="выбрать 1 как А,2 как Б";\r\nКонецПроцедуры\r\n');
  }
  if (basename(suite) === "formatting-readonly-host.cjs") {
    await mkdir(join(fixture.source, "Ext"), { recursive: true });
    await writeFile(join(fixture.source, "Ext", "ParentConfigurations.bin"), "{6,0,0,0,0,0}");
    await writeFile(fixture.module, "Procedure Test()\nValue=1;\nOther=2;\nEndProcedure\n");
  }
  if (basename(suite) === "language-reference-host.cjs") {
    fixture.reference = await (await import("./language-fixture.mjs")).createReferenceSource(fixture, root);
  }
  if (["language-library-host.cjs", "language-add-host.cjs"].includes(basename(suite))) {
    fixture.library = await (await import("./language-fixture.mjs")).createLibrarySource(fixture, root);
    if (basename(suite) === "language-add-host.cjs") {
      await writeFile(join(fixture.root, "eska.toml"), "[project]\ntype='processing'\n[tools.bsl-analyzer.diagnostics.parameters]\nLineLength=false\n");
    }
    if (process.env.ESKA_HOST_LIBRARY_MISSING === "1") await rm(fixture.library.config);
    if (process.env.ESKA_HOST_LIBRARY_MISSING === "directory") await rm(fixture.library.configDir, { recursive: true });
  }
  if (["query-advanced-host.cjs", "query-package-host.cjs", "query-having-host.cjs", "query-total-sections-host.cjs", "query-dcs-host.cjs"].includes(basename(suite))) {
    await (await import("./query-advanced-fixture.mjs")).addQueryRegister(fixture);
    fixture.query = await (await import("./query-fixture.mjs")).createQuerySource(fixture);
    await writeFile(fixture.module, '\ufeff// owner 😀\r\nQ = "SELECT 1\r\n|AS Value";\r\nOther = 42;\r\n');
  }
  if (basename(suite) === "query-dcs-host.cjs") {
    await writeFile(fixture.module, '\ufeff// owner 😀\r\nQ = "SELECT T.Ref AS Value FROM Catalog.Товары AS T";\r\nOther = 42;\r\n');
  }
  if (["query-tabs-host.cjs", "query-session-host.cjs", "query-bsl-host.cjs", "query-bsl-restore-host.cjs", "query-bsl-windows-host.cjs", "query-modal-host.cjs", "query-modal-normal-host.cjs", "query-modal-restore-host.cjs", "query-builder-host.cjs"].includes(basename(suite))) fixture.query = await (await import("./query-fixture.mjs")).createQuerySource(fixture);
  if (["query-bsl-host.cjs", "query-bsl-restore-host.cjs", "query-bsl-windows-host.cjs", "query-modal-host.cjs", "query-modal-normal-host.cjs", "query-modal-restore-host.cjs", "query-builder-host.cjs"].includes(basename(suite))) {
    await writeFile(fixture.module, '\ufeff// owner 😀\r\nQ = "SELECT 1\r\n|AS Value";\r\nOther = 42;\r\nSecond = "SELECT 9";\r\nComputed = "SELECT " + "1";\r\n');
  }
  if (basename(suite) === "query-language-context-host.cjs") fixture.applications = await (await import("./query-language-fixture.mjs")).createQueryLanguageContexts(fixture);
  if (basename(suite) === "query-language-host.cjs") fixture.languageSource = await (await import("./query-language-fixture.mjs")).createQueryLanguageSource(fixture);
  if (["query-constructor-host.cjs", "query-items-host.cjs", "query-predicates-host.cjs", "query-union-matrix-host.cjs", "query-package-tree-host.cjs", "query-modifiers-host.cjs", "query-text-host.cjs"].includes(basename(suite))) {
    fixture.query = await (await import("./query-fixture.mjs")).createQuerySource(fixture);
    await writeFile(fixture.module, '\ufeff// owner 😀\r\nПроцедура Test()\r\nQ = "SELECT 1 AS A,\r\n|// field B 😀\r\n|2 AS B";\r\nOther = 42;\r\nКонецПроцедуры\r\n');
    const schema = await readFile(fixture.query.schemaPath, "utf8");
    const querySchema=schema.replace('<query><!--keep--><![CDATA[SELECT 1;\r\n// пакет 😀\r\nSELECT 77]]></query>', '<query>SELECT Lo<!--source 😀-->ng</query>');
    await writeFile(fixture.query.schemaPath,basename(suite)==='query-constructor-host.cjs'?querySchema.replace('<other>before</other>','<other>prior input 😀</other>'):querySchema);

  }
  // These scenarios exercise language lifecycle, not concurrent mutation of XML during workspace/open.
  if (["language-host.cjs", "language-cancellation-host.cjs", "language-restart-host.cjs", "bundle-update-host.cjs", "inlay-alignment-host.cjs"].includes(basename(suite))) {
    const source = await import("./language-fixture.mjs");
    fixture.languageSource = basename(suite) === "inlay-alignment-host.cjs" ? await source.createInlaySource(fixture) : await source.createLanguageSource(fixture);
  }
  // Reload tests need a stable root descriptor before workspaceContains can activate the extension.
  if (process.env.ESKA_HOST_CONFLICT_RELOAD) await (await import("./language-fixture.mjs")).createLanguageSource(fixture);
  if (process.env.ESKA_HOST_LANGUAGE_PARITY) await (await import("./language-fixture.mjs")).createLanguageParitySource(fixture);
  else if (process.env.ESKA_HOST_LANGUAGE_MUTATION) await (await import("./language-fixture.mjs")).createLanguageMutationSource(fixture);
  else if (process.env.ESKA_HOST_LANGUAGE_EDITS) await (await import("./language-fixture.mjs")).createLanguageSupportSource(fixture);
  if (process.env.ESKA_HOST_LANGUAGE_REFRESH) await (await import("./language-fixture.mjs")).createLanguageSource(fixture);
  const bin = join(root, "bin");
  await mkdir(bin);
  const component = backend === "legacy" ? "eska" : "eska-project";
  const executableName = process.platform === "win32" ? `${component}.exe` : component;
  if (process.platform === "win32") await cp(globalBinary, join(bin, executableName));
  else await symlink(globalBinary, join(bin, executableName));
  await mkdir(join(fixture.root, ".vscode"), { recursive: true });
  // Prevent the first-run welcome page from taking focus during native formatting/menu assertions.
  const nativeUiSettings = ["formatting-readonly-host.cjs", "tool-status-host.cjs", "language-host.cjs"].includes(basename(suite)) ? { "workbench.startupEditor": "none" } : {};
  // Configure the binary before activation: a later settings notification deliberately disconnects.
  // The general explorer suite separately exercises discovery through the isolated PATH.
  const explicitBinary = process.env.ESKA_HOST_GLOBAL_BINARY || basename(suite) !== "extension-host.cjs";
  await writeFile(join(fixture.root, ".vscode/settings.json"), JSON.stringify({ ...nativeUiSettings, "eska.explorer.checkForUpdates": false, "eska.explorer.checkForAnalyzerUpdates": false, "eska.explorer.checkForFormatterUpdates": false, ...(process.env.ESKA_TEST_FMT_BINARY ? { "eska.explorer.formatterExecutable": process.env.ESKA_TEST_FMT_BINARY } : {}), "eska.explorer.languageFeatures": process.env.ESKA_TEST_LANGUAGE === "1", "eska.explorer.analyzerExecutable": fixture.activity?.analyzer ?? process.env.ESKA_TEST_ANALYZER_BINARY ?? join(root, "missing-analyzer"), "eska.explorer.backend": backend,
    ...(explicitBinary ? { "eska.explorer.executable": binary } : {}),
    ...(process.env.ESKA_HOST_SUPPORT_DISABLED ? { "eska.explorer.supportPolicy": false } : {}) }));
  const executable = process.env.VSCODE_EXECUTABLE ?? "code";
  // Windows Code.exe launches the workbench; extension installation belongs to its Node CLI.
  const cli = process.env.VSCODE_CLI_JS;
  if (cli && !isAbsolute(cli)) throw new Error("VSCODE_CLI_JS must be absolute.");
  const run = promisify(execFile);
  const installTimeout = process.platform === "win32" ? 300000 : 120000;
  const runCli = async (args, options) => {
    try {
      return await run(executable, [...(cli ? [cli] : []), '--disable-telemetry', ...args], {
        ...options, windowsHide: true,
        ...(cli ? { env: { ...process.env, ...options?.env, ELECTRON_RUN_AS_NODE: "1" } } : {}),
      });
    } catch(error) {
      throw Object.assign(error,{category:'harness',context:{exitCode:error.code,signal:error.signal,killed:error.killed,stdout:error.stdout,stderr:error.stderr},code:'host_cli_failed'});
    }
  };
  let extensionPath = repository;
  if (process.env.ESKA_HOST_LANGUAGE_PACK_DIRECTORY) {
    const source = process.env.ESKA_HOST_LANGUAGE_PACK_DIRECTORY;
    if (!isAbsolute(source)) throw new Error("ESKA_HOST_LANGUAGE_PACK_DIRECTORY must be absolute.");
    const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    await cp(source, join(root, "extensions", `${manifest.publisher}.${manifest.name}-${manifest.version}`.toLowerCase()), { recursive: true });
  }
  if (process.env.ESKA_HOST_LANGUAGE_PACK_VSIX) {
    const languagePack = process.env.ESKA_HOST_LANGUAGE_PACK_VSIX;
    if (!isAbsolute(languagePack)) throw new Error("ESKA_HOST_LANGUAGE_PACK_VSIX must be absolute.");
    await runCli([`--user-data-dir=${join(root, "profile")}`, `--extensions-dir=${join(root, "extensions")}`,
      "--install-extension", languagePack, "--force"], { timeout: installTimeout });
  }
  const conflictFixture = process.env.ESKA_HOST_CONFLICT_FIXTURE ? await (await import("./conflict-fixture.mjs")).createConflictFixture(root) : undefined;
  if (conflictFixture && process.env.ESKA_HOST_CONFLICT_FIXTURE === "initial") {
    await cp(conflictFixture.folder, join(root, "extensions", "elishevkirill.bsl-analyzer-lsp-0.0.1"), { recursive: true });
  }
  if (process.env.ESKA_BSL_EXTENSION) {
    if (!isAbsolute(process.env.ESKA_BSL_EXTENSION) || !isAbsolute(process.env.ESKA_BSL_BINARY ?? "")) {
      throw new Error("ESKA_BSL_EXTENSION and ESKA_BSL_BINARY must be absolute.");
    }
    const analyzer = JSON.parse(await readFile(join(process.env.ESKA_BSL_EXTENSION, "package.json"), "utf8"));
    await cp(process.env.ESKA_BSL_EXTENSION, join(root, "extensions", `${analyzer.publisher}.${analyzer.name}-${analyzer.version}`), { recursive: true });
    await mkdir(join(fixture.root, ".vscode"), { recursive: true });
    await writeFile(join(fixture.root, ".vscode", "settings.json"), JSON.stringify({
      "eska.explorer.checkForUpdates": false, "eska.explorer.checkForAnalyzerUpdates": false, "eska.explorer.checkForFormatterUpdates": false, ...(process.env.ESKA_TEST_FMT_BINARY ? { "eska.explorer.formatterExecutable": process.env.ESKA_TEST_FMT_BINARY } : {}), "eska.explorer.languageFeatures": process.env.ESKA_TEST_LANGUAGE === "1", "eska.explorer.analyzerExecutable": fixture.activity?.analyzer ?? process.env.ESKA_TEST_ANALYZER_BINARY ?? join(root, "missing-analyzer"), "eska.explorer.backend": backend,
      "bsl-analyzer-lsp.server.path": process.env.ESKA_BSL_BINARY,
      "[bsl]": { "editor.defaultFormatter": `${analyzer.publisher}.${analyzer.name}` },
      ...(process.env.ESKA_HOST_SUPPORT_DISABLED ? { "eska.explorer.supportPolicy": false } : {})
    }));
    if (!process.env.ESKA_BSL_DISABLED) await writeFile(join(fixture.root, "bsl-analyzer.toml"), '[source]\nroot = "src"\n');
  }
  if (process.env.ESKA_TEST_VSIX) {
    if (!isAbsolute(process.env.ESKA_TEST_VSIX)) throw new Error("ESKA_TEST_VSIX must be absolute.");
    const installStarted = performance.now();
    const directories = [`--user-data-dir=${join(root, "profile")}`, `--extensions-dir=${join(root, "extensions")}`];
    await runCli([...directories, "--install-extension", process.env.ESKA_TEST_VSIX], { timeout: installTimeout });
    const { stdout } = await runCli([...directories, "--list-extensions", "--show-versions"], { timeout: 30000 });
    const installed = stdout.split(/\r?\n/).find(line => line.startsWith("1c-tooling.eska-explorer@"));
    if (!installed) throw new Error(`VSIX was not installed: ${stdout}`);
    extensionPath = join(root, "extensions", installed.replace("@", "-"));
    receipt.timings.installCliMs = performance.now() - installStarted;
    const verificationStarted = performance.now();
    receipt.runtimeAssets = await verifyRuntime(process.env.ESKA_TEST_VSIX,{checkout:repository,installed:extensionPath,forms:basename(suite).startsWith('form-')});
    receipt.timings.runtimeVerificationMs = performance.now() - verificationStarted;
    console.log(JSON.stringify({installedVsix:process.env.ESKA_TEST_VSIX,runtimeFiles:receipt.runtimeAssets.files.length,runtimeManifestSha256:receipt.runtimeAssets.manifestSha256}));
    // Test mode exposes the provider only for acceptance. All runtime files come from the installed VSIX.
  }
  let workspace = fixture.root;
  let secondFixture;
  if (process.env.ESKA_HOST_MULTI_ROOT) {
    secondFixture = await createTreeProject(join(root, "second"));
    workspace = join(root, "support.code-workspace");
    await writeFile(workspace, JSON.stringify({ folders: [{ path: fixture.root }, { path: secondFixture.root }], settings: { "eska.explorer.checkForUpdates": false, "eska.explorer.checkForAnalyzerUpdates": false, "eska.explorer.checkForFormatterUpdates": false, ...(process.env.ESKA_TEST_FMT_BINARY ? { "eska.explorer.formatterExecutable": process.env.ESKA_TEST_FMT_BINARY } : {}), "eska.explorer.languageFeatures": process.env.ESKA_TEST_LANGUAGE === "1", "eska.explorer.analyzerExecutable": fixture.activity?.analyzer ?? process.env.ESKA_TEST_ANALYZER_BINARY ?? join(root, "missing-analyzer"), "eska.explorer.backend": backend } }));
  }
  if (process.env.ESKA_PERF_PROJECT) {
    if (!isAbsolute(process.env.ESKA_PERF_PROJECT)) throw new Error("ESKA_PERF_PROJECT must be absolute.");
    workspace = join(root, "performance.code-workspace");
    await writeFile(workspace, JSON.stringify({ folders: [{ path: process.env.ESKA_PERF_PROJECT }], settings: { "eska.explorer.checkForUpdates": false, "eska.explorer.checkForAnalyzerUpdates": false, "eska.explorer.checkForFormatterUpdates": false, ...(process.env.ESKA_TEST_FMT_BINARY ? { "eska.explorer.formatterExecutable": process.env.ESKA_TEST_FMT_BINARY } : {}), "eska.explorer.languageFeatures": process.env.ESKA_TEST_LANGUAGE === "1", "eska.explorer.analyzerExecutable": fixture.activity?.analyzer ?? process.env.ESKA_TEST_ANALYZER_BINARY ?? join(root, "missing-analyzer"), "eska.explorer.backend": backend, "eska.explorer.executable": binary,
      ...(process.env.ESKA_HOST_SUPPORT_DISABLED ? { "eska.explorer.supportPolicy": false } : {}) } }));
  }
  // A second process reuses the same profile and workspace to test restored editors.
  // Validate the actual host locale, including normal startup probes, before the suite runs.
  const hostSuite = join(root, "locale-suite.cjs");
  await writeFile(hostSuite, `exports.run = async function () {
    const vscode = require('vscode');
    const assert = require('node:assert/strict');
    const expected = process.env.ESKA_HOST_LOCALE;
    if (expected) assert.equal(vscode.env.language.split('-')[0], expected, 'native host locale');
    const bodyStarted = performance.now();
    await require(${JSON.stringify(suite)}).run();
    const suiteBodyMs = performance.now() - bodyStarted;
    const fs = require('node:fs/promises'), file = ${JSON.stringify(join(fixture.root, "host-result.json"))};
    const result = JSON.parse(await fs.readFile(file, 'utf8'));
    await fs.writeFile(file, JSON.stringify({ ...result, locale: vscode.env.language, hostDriver:{suiteBodyMs} }));
  };\n`);
  const hostArguments = [`--extensionTestsPath=${hostSuite}`];
  let languageWarmup;
  if (process.env.ESKA_HOST_LANGUAGE_PACK_VSIX || process.env.ESKA_HOST_LANGUAGE_PACK_DIRECTORY) {
    // A fresh profile registers installed language packs during its first normal startup.
    // Passing --locale before that registration still resolves to English.
    languageWarmup = join(root, "language-pack-registration");
    await mkdir(languageWarmup);
    await writeFile(join(languageWarmup, "package.json"), JSON.stringify({ name: "language-pack-registration", publisher: "eska-test",
      version: "0.0.1", engines: { vscode: "^1.109.0" }, main: "./extension.cjs", activationEvents: ["onStartupFinished"] }));
    await writeFile(join(languageWarmup, "extension.cjs"), `const vscode = require('vscode');
exports.activate = async function () {
  await require('node:fs/promises').writeFile(${JSON.stringify(join(fixture.root, "host-result.json"))},
    JSON.stringify({ passed: true, suite: 'language-pack-registration', locale: vscode.env.language }));
  await vscode.commands.executeCommand('workbench.action.closeWindow');
};\n`);
  }
  let installedStartupProbe = false;
  if (process.env.ESKA_HOST_RESTART || process.env.ESKA_HOST_NORMAL) {
    // VS Code deliberately skips editor restoration in extension-test mode. Run the
    // same assertions from a disposable startup extension in a normal development host.
    const probe = join(root, "restore-probe");
    await mkdir(probe);
    await writeFile(join(probe, "package.json"), JSON.stringify({ name: "restore-probe", publisher: "eska-test",
      version: "0.0.1", engines: { vscode: "^1.109.0" }, main: "./extension.cjs", activationEvents: ["onStartupFinished"] }));
    await writeFile(join(probe, "extension.cjs"), `const vscode = require('vscode');
exports.activate = async function () {
  if (process.env.ESKA_HOST_RUN === '-1') return;
  try { await require(${JSON.stringify(hostSuite)}).run(); }
  catch (error) {
    const fs = require('node:fs/promises'), file = ${JSON.stringify(join(fixture.root, "host-result.json"))};
    let reported;
    try { reported = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
    // Keep the suite's precise failure evidence, including UI state and completed assertions.
    if (reported?.passed !== false) await fs.writeFile(file, JSON.stringify({ passed: false, error: String(error.stack ?? error) }));
  }
  await vscode.commands.executeCommand('workbench.action.closeWindow');
};\n`);
    if (process.env.ESKA_TEST_VSIX) {
      // Development hosts suppress native hot-exit backups; a real installed startup probe preserves the normal lifecycle.
      const probeVsix = join(root, "restore-probe.vsix");
      await writeFile(join(probe, "README.md"), "# Private ESKA acceptance probe\n");
      await run(process.execPath, [join(repository, "node_modules/@vscode/vsce/vsce"), "package", "--no-dependencies",
        "--allow-missing-repository", "--skip-license", "--out", probeVsix], { cwd: probe });
      await runCli([`--user-data-dir=${join(root, "profile")}`, `--extensions-dir=${join(root, "extensions")}`,
        "--install-extension", probeVsix, "--force"], { timeout: installTimeout });
      hostArguments.splice(0, 1);
      installedStartupProbe = true;
    } else hostArguments.splice(0, 1, `--extensionDevelopmentPath=${probe}`);
  }
  let languageAttempts = 0;
  const runs = process.env.ESKA_HOST_CONFLICT_RELOAD ? 3 : process.env.ESKA_HOST_RESTART || process.env.ESKA_HOST_QUERY_RESTART || process.env.ESKA_HOST_ACTIVITY_RESTART ? 2 : 1;
  receipt.timings.preHostMs = performance.now() - driverStarted;
  for (let run = languageWarmup ? -1 : 0; run < runs; run++) {
    const hostStarted = performance.now();
    await rm(join(fixture.root, "host-result.json"), { force: true });
    const child = spawn(executable, ["--verbose", "--skip-welcome", "--skip-release-notes", ...(locale ? [`--locale=${locale}`] : []), ...(process.env.ESKA_HOST_DEBUG_PORT ? [`--remote-debugging-port=${process.env.ESKA_HOST_DEBUG_PORT}`] : []),
      ...(installedStartupProbe && run !== -1 ? [] : [`--extensionDevelopmentPath=${extensionPath}`]), ...(run === -1 ? [`--extensionDevelopmentPath=${languageWarmup}`] : hostArguments),
      `--user-data-dir=${join(root, "profile")}`, `--extensions-dir=${join(root, "extensions")}`,
      "--disable-workspace-trust", ...(process.env.ESKA_BSL_EXTENSION || process.env.ESKA_HOST_ENABLE_EXTENSIONS || languageWarmup || installedStartupProbe ? [] : ["--disable-extensions"]),
      ...(process.env.ESKA_BSL_DISABLED || process.env.ESKA_HOST_CONFLICT_RELOAD && run === 1 ? ["--disable-extension=elishevkirill.bsl-analyzer-lsp"] : []), ...(process.platform === "win32" && process.env.ESKA_HOST_DEBUG_PORT ? ["--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--disable-features=CalculateNativeWinOcclusion"] : []), "--disable-gpu", "--new-window", workspace],
    { env: { ...process.env, PATH: bin + (process.platform === "win32" ? ";" : ":") + (process.env.PATH ?? ""), ESKA_HOST_RUN: String(run),
      ...(conflictFixture ? { ESKA_HOST_CONFLICT_VSIX: conflictFixture.vsix } : {}),
      ...(fixture.library ? { ESKA_CONFIG_DIR: fixture.library.configDir } : {}),
      ...(fixture.activity ? { ESKA_CONFIG_DIR: fixture.activity.configDir } : {}),
      ...(fixture.formActivity ? { ESKA_CONFIG_DIR: fixture.formActivity.configDir } : {}),
      ESKA_HOST_FIXTURE: JSON.stringify(fixture), ESKA_HOST_SECOND_FIXTURE: JSON.stringify(secondFixture) }, stdio: ["ignore", "pipe", "pipe"] });
    const attempt = {index:run,phase:run === -1 ? 'language-registration' : 'suite',startedAt:new Date().toISOString(),pid:child.pid};
    receipt.runs.push(attempt);await saveReceipt();
    let output = "";
    const fullLog = process.env.ESKA_HOST_FULL_LOG ? createWriteStream(process.env.ESKA_HOST_FULL_LOG) : undefined;
    /** Retain bounded diagnostic output; host startup can be verbose. */
    const capture = (data) => { fullLog?.write(data); output = (output + data.toString()).slice(-32000); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    // Windows crash reporters can inherit these pipes after the workbench exits.
    // The owned workbench process and its result file determine suite completion.
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    attempt.hostMs=performance.now()-hostStarted;attempt.exitCode=code;
    child.stdout.destroy();
    child.stderr.destroy();
    if (fullLog) await new Promise(resolve => fullLog.end(resolve));
    if (process.env.ESKA_HOST_LOG) await writeFile(process.env.ESKA_HOST_LOG, output);
    // Preserve suite evidence even when the extension test runner exits unsuccessfully.
    if (code !== 0) {
      const result = await readFile(join(fixture.root, "host-result.json"), "utf8").catch(() => "");
      if (result && process.env.ESKA_HOST_FULL_LOG) await writeFile(`${process.env.ESKA_HOST_FULL_LOG}.result.json`, result);
      throw new Error(`Extension host exited ${code}\n${result}\n${output}`);
    }
    try {
      const result = JSON.parse(await readFile(join(fixture.root, "host-result.json"), "utf8"));
      attempt.result=result;
      if (result.passed !== true) {
        if (process.env.ESKA_HOST_FULL_LOG) await writeFile(`${process.env.ESKA_HOST_FULL_LOG}.result.json`, JSON.stringify(result, null, 2) + "\n");
        throw new Error(`Acceptance result did not pass: ${result.error ?? "unknown failure"}`);
      }
      for (const pid of result.shutdownPids ?? []) {
        try { process.kill(pid, 0); }
        catch (error) { if (error.code === "ESRCH") continue; throw error; }
        // Only a PID recorded by this fixture is eligible for cleanup after a failed shutdown check.
        process.kill(pid, "SIGKILL");
        throw new Error(`Backend ${pid} survived native host shutdown`);
      }
      await saveReceipt();
      console.log(JSON.stringify(result));
      // Registration may finish after the first startup; repeat only this read-only locale probe.
      if (run === -1 && locale && result.locale?.split('-')[0] !== locale) {
        if (++languageAttempts >= 3) throw new Error(`Language pack did not register ${locale}`);
        run--;
      }
    }
    catch (error) { throw new Error(`Extension host did not report success: ${error.message}\n${output}`); }
  }
  receipt.passed = true;
} catch (error) {
  receipt.passed = false;
  receipt.failure = {category:error.category ?? 'unclassified',code:error.code ?? 'suite_failed',message:String(error.stack ?? error),context:error.context};
  throw error;
} finally {
  const cleanupStarted = performance.now();
  try {
    await rm(root, { recursive: true, force: true, maxRetries: process.platform === "win32" ? 20 : 0, retryDelay: 250 });
  } catch(error) {
    receipt.passed=false;receipt.cleanupFailure={category:'harness',code:'fixture_cleanup_failed',message:String(error.message)};
    throw error;
  } finally {
    receipt.timings.cleanupMs = performance.now() - cleanupStarted;
    receipt.timings.totalMs = performance.now() - driverStarted;
    await saveReceipt();
  }
}
