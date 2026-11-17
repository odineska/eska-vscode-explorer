import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formCapabilities } from '../out/form-preview/protocol.js';
import { eventTarget, parseHandlerEditPlan } from '../out/form-preview/handler-protocol.js';

test('handler authoring requires its negotiated API capability', () => {
  const formPreview = { inputPreparation: true, pictures: true, schemaVersion: 1, profile: 'taxi-8.3.27', readOnly: true, executesBsl: false,
    uploads: 'queryBuffers', maxSessions: 16, maxOverlayBytes: 8388608, maxInlineBytes: 131072, handlerNavigation: true, handlerAuthoring: true };
  const limits = minor => formCapabilities({ apiVersion: { major: 1, minor }, capabilities: { formPreview } });
  assert.equal(limits(53).handlerAuthoring, undefined);
  assert.equal(limits(54).handlerAuthoring, true);
  assert.equal(limits(54).handlerNavigation, true);
});

test('handler edit transport accepts only safe targets and insertion plans', () => {
  assert.deepEqual(eventTarget({ kind: 'root' }), { kind: 'root' });
  assert.deepEqual(eventTarget({ kind: 'element', id: -1 }), { kind: 'element', id: -1 });
  assert.deepEqual(eventTarget({ kind: 'command', name: 'Команда' }), { kind: 'command', name: 'Команда' });
  for (const value of [{ kind: 'element', id: 2 ** 54 }, { kind: 'command', name: '' }, { kind: 'attribute', name: 'A' }]) assert.equal(eventTarget(value), undefined);
  const plan = { source: 'a'.repeat(64), root: { value: '/source', encoding: 'utf-8' }, path: { value: 'CommonForms/Form/Ext/Form/Module.bsl', encoding: 'utf-8' },
    revision: '1', name: 'ПолеПриИзменении', exists: true, bound: false, snapshot: 'b'.repeat(64), outputSnapshot: 'c'.repeat(64), version: '7', range: { start: 64, end: 94 },
    change: { range: { start: 12, end: 12 }, text: '\nПроцедура ПолеПриИзменении(Элемент)\nКонецПроцедуры\n' } };
  assert.deepEqual(parseHandlerEditPlan(plan), plan);
  assert.equal(parseHandlerEditPlan({ ...plan, change: null }).change, null);
  for (const patch of [{ name: 'CommonModule.Handler' }, { bound: undefined }, { outputSnapshot: 'bad' }, { change: { ...plan.change, range: { start: 12, end: 14 } } }])
    assert.throws(() => parseHandlerEditPlan({ ...plan, ...patch }), { code: 'protocolInvalid' });
});
