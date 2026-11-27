const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');
const { connectWorkbench } = require('./query-constructor-dom.cjs');
const { projectProgress } = require('../out/project-command.js');

exports.run = async () => {
  const { root } = JSON.parse(process.env.ESKA_HOST_FIXTURE);
  const until = async (check, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { const result = await check(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(label);
  };
  const workbench = await connectWorkbench(until);
  let release, live;
  const owner = new AbortController();
  const pending = projectProgress('ESKA operation progress acceptance', async (_signal, progress) => {
    live = progress;
    progress.event({schema_version:1,kind:'operation_progress',phase:'apply',event:'native',step:'object_restructuring',object:'Catalog.NativeGoods',quiet_ms:3600000,objects_seen:5});
    await new Promise(resolve => { release = resolve; });
  }, owner.signal);
  try {
    await until(() => live, 'live operation created');
    await vscode.commands.executeCommand('notifications.showList');
    const notices = () => workbench.evaluate("document.querySelector('.notifications-center')?.innerText || ''");
    const first = await until(async () => { const value = await notices(); return value.includes('Catalog.NativeGoods') && value.includes('1:00:') ? value : false; }, 'native restructuring and hour-long silence rendered');
    assert.match(first, /restructuring|реструктурирует/);
    live.event({schema_version:1,kind:'operation_progress',phase:'verify',event:'command',step:'checksum_main',quiet_ms:null});
    live.event({schema_version:1,kind:'operation_progress',phase:'verify',event:'heartbeat',step:'checksum_main',quiet_ms:null,stage_elapsed_ms:3600000});
    const verification = await until(async () => { const value = await notices(); return /main configuration checksum|контрольной суммы основной конфигурации/.test(value) && value.includes('1:00:00') ? value : false; }, 'checksum command remains visible during silence');
    assert.ok(!verification.includes('Catalog.NativeGoods'), 'previous native object cleared');
    live.event({schema_version:1,kind:'operation_progress',phase:'analyze_modules',event:'stage',processed_modules:3,total_modules:7});
    const checked = await until(async () => { const value = await notices(); return /3 (?:of|из) 7/.test(value) ? value : false; }, 'real analyzer count rendered');
    assert.ok(!checked.includes('Catalog.NativeGoods'), 'previous phase object cleared');
    release();
    await pending;
    await fs.writeFile(path.join(root, 'host-result.json'), JSON.stringify({passed:true,suite:'operation-progress',locale:vscode.env.language,nativeRestructuring:true,longSilence:true,moduleCounters:true,commandStep:true}));
  } finally { release?.(); owner.abort(); await pending; workbench.close(); }
};
