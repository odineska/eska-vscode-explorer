const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const vscode = require("vscode");
const { connectWorkbench } = require("./query-constructor-dom.cjs");

exports.run = async function () {
  const { root } = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const native = JSON.parse(process.env.ESKA_HOST_HTTP_FIXTURE);
  const labels = vscode.env.language.startsWith("ru") ? {
    extension: "Расширение",
    installation: "Установить расширение",
    installPreview: "Установить это расширение Designer XML",
    removal: "Удалить расширение",
    removalWarning: "Данные расширения могут быть безвозвратно потеряны.",
    missingExtension: "Расширение Two отсутствует в тестовой базе.",
    application: "Обновить приложение debug в тестовой базе?",
    upToDate: "Без изменений",
    partialImport: "Частичный импорт",
    fullImport: "Полный импорт",
    dependencies: "Зависимости: Two",
    applied: "Применено",
    failed: "Ошибка обновления",
    notStarted: "Не начато",
    fullExtension: "Заменить выбранное расширение в тестовой базе",
    partial: "Применить перечисленные изменения Designer XML к тестовой базе?",
    review: "Просмотреть полный импорт",
    apply: "Применить к test",
    applyAndDebug: "Применить и запустить с отладкой",
    cancel: "Отмена",
    companion: "Сопутствующий файл",
    rename: "Переименован Общая форма",
    roleAdded: "Добавлен Роль",
    roleRenamed: "Переименован Роль",
    roleRemoved: "Удалён Роль",
    moduleAdded: "Добавлен Общий модуль",
    moduleRenamed: "Переименован Общий модуль",
    moduleRemoved: "Удалён Общий модуль",
    pictureAdded: "Добавлен Общая картинка",
    pictureRenamed: "Переименован Общая картинка",
    pictureRemoved: "Удалён Общая картинка",
    removed: "Удалён Общая форма",
    conflict: "изменились и сохранённые исходники, и поколение тестовой базы",
  } : {
    extension: "Extension",
    installation: "Install Extension",
    installPreview: "Install this Designer XML extension",
    removal: "Remove Extension",
    removalWarning: "Data owned by the extension may be lost permanently.",
    missingExtension: "Extension Two is not installed in the test infobase.",
    application: "Update the application debug in the test infobase?",
    upToDate: "Up to date",
    partialImport: "Partial import",
    fullImport: "Full import",
    dependencies: "Dependencies: Two",
    applied: "Applied",
    failed: "Update failed",
    notStarted: "Not started",
    fullExtension: "Replace the selected test extension",
    partial: "Apply the listed Designer XML changes to the test infobase?",
    review: "Review Full Import",
    apply: "Apply to Test",
    applyAndDebug: "Apply and Launch with Debugging",
    cancel: "Cancel",
    companion: "Companion file",
    rename: "Renamed Common form",
    roleAdded: "Added Role",
    roleRenamed: "Renamed Role",
    roleRemoved: "Removed Role",
    moduleAdded: "Added Common module",
    moduleRenamed: "Renamed Common module",
    moduleRemoved: "Removed Common module",
    pictureAdded: "Added Common picture",
    pictureRenamed: "Renamed Common picture",
    pictureRemoved: "Removed Common picture",
    removed: "Removed Common form",
    conflict: "Both the saved sources and the test database generation changed",
  };
  const until = async (check, label) => {
    const deadline = Date.now() + (native.scenario === "apply-application-debug" ? 60000 : 15000);
    while (Date.now() < deadline) {
      const result = await check();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(label);
  };
  const extension = vscode.extensions.all.find(item => item.packageJSON.name === "eska-explorer");
  await extension.activate();
  await vscode.commands.executeCommand("eska.explorer.restart");
  await vscode.workspace.getConfiguration("window").update("dialogStyle", "custom", vscode.ConfigurationTarget.Global);
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root));
  const config = vscode.workspace.getConfiguration("eska.explorer", folder.uri);
  await config.update("buildExecutable", native.build, vscode.ConfigurationTarget.Workspace);
  await config.update("debugExecutable", native.binary, vscode.ConfigurationTarget.Workspace);
  const state = path.join(root, ".eska");
  await fs.mkdir(state, { recursive: true });
  await fs.copyFile(native.settings, path.join(state, "settings_local.toml"));
  const source = path.join(root, "src");
  await fs.rm(source, { recursive: true });
  await fs.cp(native.source, source, { recursive: true });

  const workbench = await connectWorkbench(until);
  const click = (label, ...expectedText) => until(() => workbench.evaluate(`(() => {
    const box = document.querySelector('.monaco-dialog-box');
    if (!box || !${JSON.stringify(expectedText)}.every(text => box.textContent.includes(text))) return false;
    const button = [...box.querySelectorAll('button, .monaco-button')]
      .find(item => ${JSON.stringify(label)} === null || item.textContent.replaceAll('&', '').trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`), label);
  const command = () => vscode.commands.executeCommand("eska.explorer.applyTest");
  const snapshot = async () => {
    const [name] = (await fs.readdir(state)).filter(name => name.startsWith("apply-") && name.endsWith(".json"));
    assert.ok(name);
    return fs.readFile(path.join(state, name), "utf8");
  };
  try {
    if (native.scenario === "apply-application-debug") {
      const execute = debug => vscode.commands.executeCommand(
        debug ? "eska.explorer.applyApplicationAndDebugTest" : "eska.explorer.applyApplicationTest");
      const choose = async () => {
        const point = await until(() => workbench.evaluate(`(() => {
          const row = [...document.querySelectorAll('.quick-input-list .monaco-list-row')]
            .find(item => item.offsetHeight && item.querySelector('.label-name')?.textContent === "debug");
          if (!row) return false;
          const rect = row.getBoundingClientRect();
          return [rect.x + rect.width / 2, rect.y + rect.height / 2];
        })()`), "the checked application choices are visible");
        await workbench.click(...point);
      };
      const ordered = async (...text) => {
        await until(() => workbench.evaluate(`(() => {
          const body = document.querySelector('.monaco-dialog-box')?.textContent ?? "";
          let last = -1;
          return ${JSON.stringify(text)}.every(value => {
            last = body.indexOf(value, last + 1);
            return last >= 0;
          });
        })()`), text.join(", "));
      };
      if (process.env.ESKA_HOST_EXPECT_ABSENT_EXTENSION === "1") {
        const preview = execute(false);
        await choose();
        await preview;
        await until(() => workbench.evaluate(`[...document.querySelectorAll('.notification-list-item')].some(
          item => item.textContent.includes(${JSON.stringify(labels.missingExtension)}))`), "the absent extension is named in the notification");
        await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
          passed: true, suite: "runtime-apply", vscode: vscode.version, locale: vscode.env.language,
          absent_extension: "Two",
        }));
        return;
      }
      const initialize = execute(false);
      await choose();
      await click(labels.review, "base", "ext-two", "ext-one");
      await ordered(`base — ${labels.fullImport}`, `ext-two — ${labels.fullImport}`, `ext-one — ${labels.fullImport}`);
      await click(labels.apply, labels.application);
      await initialize;
      const one = path.join(path.dirname(root), path.basename(native.extensions[0]), "src", "Ext", "ManagedApplicationModule.bsl");
      const two = path.join(path.dirname(root), path.basename(native.extensions[1]), "src", "Ext", "ManagedApplicationModule.bsl");
      for (const [module, before, after] of [
        [path.join(source, "Ext", "ManagedApplicationModule.bsl"), "A = 41", "A = 61"],
        [two, "Значение = 222", "Значение = 444"],
        [one, "Значение = 111", "Значение = 333"],
      ]) {
        const text = await fs.readFile(module, "utf8");
        assert.ok(text.includes(before));
        await fs.writeFile(module, text.replace(before, after));
      }

      const executable = path.resolve(native.source, "../..", "platform", "ibcmd");
      const original = await fs.readFile(executable, "utf8");
      assert.ok(original.startsWith("#!/bin/sh\n"));
      const failing = original.replace("#!/bin/sh\n", `#!/bin/sh
case "$1:$2:$3" in
  infobase:config:apply)
    for arg in "$@"; do
      if test "$arg" = "--extension=Two"; then exit 11; fi
    done ;;
esac
`);
      let starts = 0;
      const tracker = vscode.debug.onDidStartDebugSession(session => {
        if (session.type === "eska-debug") starts++;
      });
      try {
        await fs.writeFile(executable, failing);
        const failed = execute(true);
        await choose();
        await ordered(`base — ${labels.partialImport}`, `ext-two — ${labels.partialImport}`, `ext-one — ${labels.partialImport}`);
        await click(labels.applyAndDebug, labels.application, labels.dependencies, "Ext/ManagedApplicationModule.bsl");
        await ordered(`base — ${labels.applied}`, `ext-two — ${labels.failed}`, `ext-one — ${labels.notStarted}`);
        await click(null, `ext-one — ${labels.notStarted}`);
        await failed;
        assert.equal(starts, 0);
      } finally {
        tracker.dispose();
        await fs.writeFile(executable, original);
      }

      await verifyUpdatedDebugSession(folder, one, until, { line: 4, expression: "Значение", expected: "333", start: async () => {
        const recovery = execute(true);
        await choose();
        await click(labels.review, "base", "ext-two", "ext-one");
        await ordered(`base — ${labels.upToDate}`, `ext-two — ${labels.fullImport}`, `ext-one — ${labels.partialImport}`);
        await click(labels.applyAndDebug, labels.application, labels.dependencies);
        await recovery;
      } });
      await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
        passed: true, suite: "runtime-apply", vscode: vscode.version, locale: vscode.env.language,
        application_apply: true, dependency_order: true, partial_failure: true, recovery: true, evaluate: "333",
      }));
      return;
    }
    if (native.scenario === "apply-extension-debug") {
      const borrowedPicture = process.env.ESKA_HOST_BORROWED_PICTURE === "1";
      const name = path.basename(native.extensions[borrowedPicture ? 1 : 0]);
      const member = path.join(path.dirname(root), name);
      const selected = labels.extension + (borrowedPicture ? " ASecond (" : " One (");
      const choose = async () => {
        const point = await until(() => workbench.evaluate(`(() => {
          const row = [...document.querySelectorAll('.quick-input-list .monaco-list-row')]
            .find(item => item.offsetHeight && item.querySelector('.label-name')?.textContent === ${JSON.stringify(name)});
          if (!row) return false;
          const rect = row.getBoundingClientRect();
          return [rect.x + rect.width / 2, rect.y + rect.height / 2];
        })()`), "extension available in project picker");
        await workbench.click(...point);
      };
      const initialize = command();
      await choose();
      await click(labels.review, "");
      await click(labels.apply, labels.fullExtension, selected, "Configuration.xml");
      await initialize;

      const source = path.join(member, "src");
      if (process.env.ESKA_HOST_EXTENSION_REMOVE === "1" || process.env.ESKA_HOST_EXTENSION_INSTALL === "1") {
        const removal = () => vscode.commands.executeCommand("eska.explorer.removeExtensionTest");
        const baseline = await snapshot();
        const cancellation = removal();
        await choose();
        await click(labels.cancel, labels.removalWarning, selected, "8.3.27.2342");
        await cancellation;
        assert.equal(await snapshot(), baseline);
        const removing = removal();
        await choose();
        await click(labels.removal, labels.removalWarning, selected, "8.3.27.2342");
        await removing;
        const files = await fs.readdir(state);
        assert.equal(files.some(name => name.startsWith("apply-") && /\.(?:json|pending)$/u.test(name)), false);
        const inspect = spawnSync(native.build, ["--project-dir", member, "extension", "remove", "--format", "json"], { encoding: "utf8" });
        assert.equal(inspect.status, 1, inspect.stderr);
        assert.deepEqual(JSON.parse(inspect.stdout).error, { code: "extension_not_installed", extension: "One" });
        if (process.env.ESKA_HOST_EXTENSION_INSTALL === "1") {
          const install = () => vscode.commands.executeCommand("eska.explorer.installExtensionTest");
          const cancelledInstall = install();
          await choose();
          await click(labels.cancel, labels.installPreview, selected, "Configuration.xml", "Ext/ManagedApplicationModule.bsl");
          await cancelledInstall;
          const missing = spawnSync(native.build, ["--project-dir", member, "extension", "remove", "--format", "json"], { encoding: "utf8" });
          assert.deepEqual(JSON.parse(missing.stdout).error, { code: "extension_not_installed", extension: "One" });
          const installing = install();
          await choose();
          await click(labels.installation, labels.installPreview, selected, "Configuration.xml", "Ext/ManagedApplicationModule.bsl");
          await installing;
          const current = JSON.parse(execFileSync(native.build, ["--project-dir", member, "apply", "--format", "json"]));
          assert.equal(current.plan.mode, "unchanged");
          await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
            passed: true, suite: "runtime-apply", vscode: vscode.version, locale: vscode.env.language,
            extension_removal: true, extension_installation: true, cancel_preserved_baseline: true,
          }));
          return;
        }
        await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
          passed: true, suite: "runtime-apply", vscode: vscode.version, locale: vscode.env.language,
          extension_removal: true, cancel_preserved_baseline: true,
        }));
        return;
      }
      if (borrowedPicture) {
        const descriptor = "CommonPictures/ProbeIcon.xml";
        const packagePath = "CommonPictures/ProbeIcon/Ext/Picture.xml";
        const svg = "CommonPictures/ProbeIcon/Ext/Picture/Picture.svg";
        const png = "CommonPictures/ProbeIcon/Ext/Picture/Picture.png";
        const pngBytes = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAQUlEQVR4nGOU6xFhoCVgoqnpoxaMWjBqAX0sYMEqajNnHzGaj6Q4EVQz9INo1IJRC0YtGLVg1IIhYQHjaOOXEAAA2JUEvXdAEQgAAAAASUVORK5CYII=",
          "base64",
        );
        const original = await fs.readFile(path.join(source, descriptor), "utf8");
        const originalPackage = await fs.readFile(path.join(source, packagePath));
        const originalSvg = await fs.readFile(path.join(source, svg), "utf8");
        const partial = async (...details) => {
          const updating = command();
          await choose();
          await click(labels.apply, labels.partial, selected, ...details);
          await updating;
        };
        assert.ok(originalSvg.includes("#2050EE"));
        await fs.writeFile(path.join(source, svg), originalSvg.replace("#2050EE", "#A820E0"));
        await partial(svg, `${labels.companion}  ${packagePath}`);
        await fs.unlink(path.join(source, svg));
        await fs.writeFile(path.join(source, png), pngBytes);
        await fs.writeFile(path.join(source, packagePath),
          originalPackage.toString("utf8").replace("Picture.svg", "Picture.png"));
        await partial(svg, png, packagePath);
        await fs.unlink(path.join(source, png));
        await fs.unlink(path.join(source, packagePath));
        await partial(png, packagePath, `${labels.companion}  ${descriptor}`);
        const inherited = original.replace(/<InternalInfo>[\s\S]*?<\/InternalInfo>/u, "<InternalInfo/>");
        assert.notEqual(inherited, original);
        await fs.writeFile(path.join(source, descriptor), inherited);
        await partial(descriptor);
        await fs.writeFile(path.join(source, descriptor), original);
        await fs.writeFile(path.join(source, packagePath), originalPackage);
        await fs.writeFile(path.join(source, svg), originalSvg);
        await partial(descriptor, packagePath, svg);

        const final = JSON.parse(execFileSync(native.build, ["--project-dir", member, "apply", "--format", "json"]));
        assert.equal(final.plan.mode, "unchanged");
        await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
          passed: true, suite: "runtime-apply", vscode: vscode.version, locale: vscode.env.language,
          borrowed_picture: ["replace", "switch-format", "clear", "inherit", "restore"],
        }));
        return;
      }
      const configurationPath = path.join(source, "Configuration.xml");
      const configuration = await fs.readFile(configurationPath, "utf8");
      const addedName = "One_ProbeRole";
      const renamedName = "One_RenamedRole";
      const defaultRolePath = "Roles/One_DefaultRole.xml";
      const rolePathFor = name => `Roles/${name}.xml`;
      const roleElement = name => `<Role>${name}</Role>`;
      const defaultElement = roleElement("One_DefaultRole");
      assert.ok(configuration.includes(defaultElement));
      const defaultRole = await fs.readFile(path.join(source, defaultRolePath), "utf8");
      const applyStructure = async (group, ...paths) => {
        const applying = command();
        await choose();
        await click(labels.apply, labels.partial, selected, group, "Configuration.xml", ...paths);
        await applying;
      };
      const addedConfiguration = configuration.replace(defaultElement, defaultElement + roleElement(addedName));
      const addedRole = defaultRole.replace(/(<Role uuid=")[0-9a-f-]+"/i, (_, prefix) => `${prefix}3ac47fa0-81b3-499e-8292-8c8af7d5dd24"`)
        .replaceAll("One_DefaultRole", addedName);
      await fs.writeFile(configurationPath, addedConfiguration);
      await fs.writeFile(path.join(source, rolePathFor(addedName)), addedRole);
      await applyStructure(`${labels.roleAdded} ${addedName}`, rolePathFor(addedName));
      await fs.writeFile(configurationPath, addedConfiguration.replace(roleElement(addedName), roleElement(renamedName)));
      await fs.writeFile(path.join(source, rolePathFor(renamedName)), addedRole.replaceAll(addedName, renamedName));
      await fs.unlink(path.join(source, rolePathFor(addedName)));
      await applyStructure(`${labels.roleRenamed} ${addedName} → ${renamedName}`, rolePathFor(renamedName));
      await fs.writeFile(configurationPath, configuration);
      await fs.unlink(path.join(source, rolePathFor(renamedName)));
      await applyStructure(`${labels.roleRemoved} ${renamedName}`, defaultRolePath);

      const pictureName = "One_ProbeIcon";
      const renamedPicture = "One_RenamedIcon";
      const pictureRoot = name => `CommonPictures/${name}`;
      const pictureElement = name => `<CommonPicture>${name}</CommonPicture>`;
      const pictureDescriptor = name => `${pictureRoot(name)}.xml`;
      const picturePackage = name => `${pictureRoot(name)}/Ext/Picture.xml`;
      const pictureSvg = name => `${pictureRoot(name)}/Ext/Picture/Picture.svg`;
      const withPicture = configuration.replace(defaultElement, defaultElement + pictureElement(pictureName));
      const descriptorXml = `<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.20">
<CommonPicture uuid="a0b2c3de-0c11-41bb-bccf-58e477f4a3ef"><Properties><Name>${pictureName}</Name>
<Synonym/><Comment/><AvailabilityForChoice>false</AvailabilityForChoice><AvailabilityForAppearance>false</AvailabilityForAppearance>
</Properties></CommonPicture></MetaDataObject>`;
      const packageXml = `<ExtPicture xmlns="http://v8.1c.ru/8.3/xcf/extrnprops" xmlns:xr="http://v8.1c.ru/8.3/xcf/readable" version="2.20">
<Picture><xr:Abs>Picture.svg</xr:Abs><xr:LoadTransparent>false</xr:LoadTransparent></Picture></ExtPicture>`;
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#E02020"/></svg>';
      await fs.writeFile(configurationPath, withPicture);
      await fs.mkdir(path.dirname(path.join(source, pictureSvg(pictureName))), { recursive: true });
      await fs.writeFile(path.join(source, pictureDescriptor(pictureName)), descriptorXml);
      await fs.writeFile(path.join(source, picturePackage(pictureName)), packageXml);
      await fs.writeFile(path.join(source, pictureSvg(pictureName)), svg);
      await applyStructure(`${labels.pictureAdded} ${pictureName}`, pictureDescriptor(pictureName), picturePackage(pictureName), pictureSvg(pictureName));

      await fs.writeFile(path.join(source, pictureSvg(pictureName)), svg.replace("#E02020", "#104090"));
      const applyPicture = command();
      await choose();
      await click(labels.apply, labels.partial, selected, pictureSvg(pictureName),
        `${labels.companion}  ${picturePackage(pictureName)}`);
      await applyPicture;

      await fs.writeFile(configurationPath, withPicture.replace(pictureElement(pictureName), pictureElement(renamedPicture)));
      await fs.rename(path.join(source, pictureRoot(pictureName)), path.join(source, pictureRoot(renamedPicture)));
      await fs.writeFile(path.join(source, pictureDescriptor(renamedPicture)), descriptorXml.replace(pictureName, renamedPicture));
      await fs.unlink(path.join(source, pictureDescriptor(pictureName)));
      await applyStructure(`${labels.pictureRenamed} ${pictureName} → ${renamedPicture}`, pictureDescriptor(renamedPicture), pictureSvg(renamedPicture));

      await fs.writeFile(configurationPath, configuration);
      await fs.rm(path.join(source, pictureRoot(renamedPicture)), { recursive: true });
      await fs.unlink(path.join(source, pictureDescriptor(renamedPicture)));
      await applyStructure(`${labels.pictureRemoved} ${renamedPicture}`, defaultRolePath);

      const module = path.join(source, "Ext", "ManagedApplicationModule.bsl");
      const original = await fs.readFile(module, "utf8");
      assert.ok(original.includes("Значение = 111"));
      const firstCommon = "One_ProbeCommon";
      const renamedCommon = "One_RenamedCommon";
      const commonDirectory = name => `CommonModules/${name}`;
      const commonXml = name => `${commonDirectory(name)}.xml`;
      const commonBsl = name => `${commonDirectory(name)}/Ext/Module.bsl`;
      const commonElement = name => `<CommonModule>${name}</CommonModule>`;
      const commonDescriptor = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject xmlns="http://v8.1c.ru/8.3/MDClasses" version="2.20">
<CommonModule uuid="9ce6fcbb-d41a-4828-aa8b-4bbc9ce78d7a"><Properties><Name>${firstCommon}</Name>
<Synonym/><Comment/><Global>false</Global><ClientManagedApplication>true</ClientManagedApplication>
<Server>false</Server><ExternalConnection>false</ExternalConnection>
<ClientOrdinaryApplication>false</ClientOrdinaryApplication><ServerCall>false</ServerCall>
<Privileged>false</Privileged><ReturnValuesReuse>DontUse</ReturnValuesReuse>
</Properties></CommonModule></MetaDataObject>`;
      const withCommon = configuration.replace(defaultElement, defaultElement + commonElement(firstCommon));
      await fs.writeFile(configurationPath, withCommon);
      await fs.mkdir(path.dirname(path.join(source, commonBsl(firstCommon))), { recursive: true });
      await fs.writeFile(path.join(source, commonXml(firstCommon)), commonDescriptor);
      await fs.writeFile(path.join(source, commonBsl(firstCommon)), "Функция Значение() Экспорт\n    Возврат 719;\nКонецФункции\n");
      await applyStructure(`${labels.moduleAdded} ${firstCommon}`, commonXml(firstCommon), commonBsl(firstCommon));

      await fs.writeFile(configurationPath, withCommon.replace(commonElement(firstCommon), commonElement(renamedCommon)));
      await fs.rename(path.join(source, commonDirectory(firstCommon)), path.join(source, commonDirectory(renamedCommon)));
      await fs.writeFile(path.join(source, commonXml(renamedCommon)), commonDescriptor.replace(firstCommon, renamedCommon));
      await fs.unlink(path.join(source, commonXml(firstCommon)));
      await fs.writeFile(module, original.replace("Значение = 111", `Значение = ${renamedCommon}.Значение()`));
      await verifyUpdatedDebugSession(folder, module, until, { line: 4, expression: "Значение", expected: "719", start: async () => {
        const applying = vscode.commands.executeCommand("eska.explorer.applyAndDebugTest");
        await choose();
        await click(labels.applyAndDebug, labels.partial, selected,
          `${labels.moduleRenamed} ${firstCommon} → ${renamedCommon}`, commonXml(renamedCommon), commonBsl(renamedCommon));
        await applying;
      } });

      await fs.writeFile(configurationPath, configuration);
      await fs.writeFile(module, original);
      await fs.rm(path.join(source, commonDirectory(renamedCommon)), { recursive: true });
      await fs.unlink(path.join(source, commonXml(renamedCommon)));
      await applyStructure(`${labels.moduleRemoved} ${renamedCommon}`, defaultRolePath);
      const initial = await snapshot();
      await fs.writeFile(module, original.replace("Значение = 111", "Значение = 333"));
      const rolePath = "Roles/One_DefaultRole.xml";
      const role = path.join(member, "src", rolePath);
      const descriptor = await fs.readFile(role, "utf8");
      assert.ok(descriptor.includes("<Comment/>"));
      await fs.writeFile(role, descriptor.replace("<Comment/>", "<Comment>ESKA apply and debug</Comment>"));
      const compose = () => vscode.commands.executeCommand("eska.explorer.applyAndDebugTest");
      const details = [labels.partial, selected, "Ext/ManagedApplicationModule.bsl", rolePath];
      let starts = 0;
      const registration = vscode.debug.onDidStartDebugSession(session => {
        if (session.type === "eska-debug") starts++;
      });
      try {
        const cancelled = compose();
        await choose();
        await click(labels.cancel, ...details);
        await cancelled;
        assert.equal(starts, 0);
        assert.equal(await snapshot(), initial);

        const stale = compose();
        await choose();
        await until(() => workbench.evaluate(`document.querySelector('.monaco-dialog-box')?.textContent.includes(${JSON.stringify(labels.applyAndDebug)})`),
          "composite confirmation is visible");
        await fs.writeFile(module, original.replace("Значение = 111", "Значение = 334"));
        await click(labels.applyAndDebug, ...details);
        await stale;
        assert.equal(starts, 0);
        assert.equal(await snapshot(), initial);

        await fs.writeFile(module, original.replace("Значение = 111", "Значение = 333"));
        await verifyUpdatedDebugSession(folder, module, until, { line: 4, expression: "Значение", expected: "333", start: async () => {
          const applying = compose();
          await choose();
          await click(labels.applyAndDebug, ...details);
          await applying;
        } });
        assert.notEqual(await snapshot(), initial);
      } finally {
        registration.dispose();
      }
      await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
        passed: true, suite: "runtime-apply", vscode: vscode.version, locale: vscode.env.language,
        extension_apply: true, role_xml: true, structural_role: true, common_picture_bundle: true, structural_common_module: true, common_module_evaluate: "719", debug_after_apply: true, composite_cancelled: true, composite_stale: true, evaluate: "333",
      }));
      return;
    }
    const initialize = command();
    await click(labels.review, "");
    await click(labels.apply, "Configuration.xml");
    await initialize;
    const initial = await snapshot();
    const module = path.join(root, "src", "Ext", "ManagedApplicationModule.bsl");
    const contents = await fs.readFile(module, "utf8");
    await fs.writeFile(module, contents.replace("A = 41", "A = 47"));
    const structural = native.scenario === "apply-structural-debug";
    if (structural) {
      const main = path.join(source, "Configuration.xml");
      const original = await fs.readFile(main, "utf8");
      const entry = "<CommonForm>ProbeButtons</CommonForm>";
      assert.ok(original.includes(entry));
      await fs.writeFile(main, original.replace(entry, "<CommonForm>RenamedProbe</CommonForm>"));
      const directory = path.join(source, "CommonForms");
      const descriptor = await fs.readFile(path.join(directory, "ProbeButtons.xml"), "utf8");
      await fs.writeFile(path.join(directory, "RenamedProbe.xml"), descriptor.replaceAll("ProbeButtons", "RenamedProbe"));
      await fs.unlink(path.join(directory, "ProbeButtons.xml"));
      await fs.rename(path.join(directory, "ProbeButtons"), path.join(directory, "RenamedProbe"));
      const renamed = command();
      await click(labels.apply, labels.rename, "ProbeButtons → RenamedProbe");
      await renamed;
      const afterRename = await snapshot();
      assert.notEqual(afterRename, initial);
      await fs.writeFile(main, original.replace(entry, ""));
      await fs.unlink(path.join(directory, "RenamedProbe.xml"));
      await fs.rm(path.join(directory, "RenamedProbe"), { recursive: true });
      const removed = command();
      await click(labels.apply, labels.removed, "RenamedProbe", labels.companion, "Languages/Русский.xml");
      await removed;
      assert.notEqual(await snapshot(), afterRename);
    } else {
      const catalog = native.scenario === "apply-catalog-debug";
      const descriptorPath = catalog ? "Catalogs/ProbeOwner.xml" : "Languages/Русский.xml";
      const descriptorFile = path.join(source, descriptorPath);
      const descriptor = await fs.readFile(descriptorFile, "utf8");
      const edited = descriptor.replace("<Comment/>", "<Comment>ESKA apply and debug</Comment>");
      assert.notEqual(edited, descriptor);
      await fs.writeFile(descriptorFile, edited);
      const incremental = command();
      const companion = catalog ? [labels.companion, "Catalogs/ProbeOwner/Forms/ProbeObject/Ext/Form.xml"] : [];
      await click(labels.apply, descriptorPath, ...companion);
      await incremental;
    }
    const applied = await snapshot();
    assert.notEqual(applied, initial);
    await verifyUpdatedDebugSession(folder, module, until);
    const other = await fs.mkdtemp(path.join(state, "external-"));
    await fs.mkdir(path.join(other, ".eska"));
    await fs.copyFile(native.settings, path.join(other, ".eska", "settings_local.toml"));
    await fs.cp(source, path.join(other, "src"), { recursive: true });
    await fs.writeFile(path.join(other, "eska.toml"), "[project]\ntype = 'configuration'\n");
    await fs.writeFile(path.join(other, "src", "Ext", "ManagedApplicationModule.bsl"), contents.replace("A = 41", "A = 49"));
    const apply = (...args) => JSON.parse(execFileSync(native.build,
      ["--lang", "en-US", "apply", "--format", "json", "--initialize", ...args],
      { cwd: other, timeout: 30000, encoding: "utf8" }));
    const external = apply();
    assert.equal(apply("--confirm", external.plan.confirmation).status, "applied");
    await fs.writeFile(module, contents.replace("A = 41", "A = 48"));

    const blocked = command();
    await click(labels.cancel, labels.conflict);
    await blocked;
    assert.equal(await snapshot(), applied);
  } finally {
    workbench.close();
  }
  await fs.writeFile(path.join(root, "host-result.json"), JSON.stringify({
    passed: true, suite: "runtime-apply", vscode: vscode.version, initialize: true, incremental: true, both_changed: true, xml_descriptor: true, debug_after_apply: true,
  }));
};


async function verifyUpdatedDebugSession(folder, module, until, { line = 3, expression = "A", expected = "47", projectDir = folder.uri.fsPath, start } = {}) {
  const uri = vscode.Uri.file(module);
  const point = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(line - 1, 0)));
  let session;
  let threadId;
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("eska-debug", {
    createDebugAdapterTracker(active) {
      session = active;
      return { onDidSendMessage(message) {
        if (message.event === "stopped") threadId = message.body.threadId;
      } };
    },
  });
  vscode.debug.addBreakpoints([point]);
  try {
    if (start) await start();
    else assert.equal(await vscode.debug.startDebugging(folder, {
      name: "ESKA debug after apply", type: "eska-debug", request: "launch", profile: "test",
      projectDir,
    }), true);
    await until(() => threadId, "updated configuration reached its breakpoint");
    const { stackFrames: [frame] } = await session.customRequest("stackTrace", { threadId });
    assert.equal(frame.source.path, uri.fsPath);
    const result = await session.customRequest("evaluate", { frameId: frame.id, expression });
    assert.equal(result.result, expected);
  } finally {
    if (session) await vscode.debug.stopDebugging(session);
    tracker.dispose();
    vscode.debug.removeBreakpoints([point]);
  }
}
