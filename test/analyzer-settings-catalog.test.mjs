import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzerCatalogForVersion,
  analyzerCatalogVersions, diagnosticSeverityField
} from '../webview/settings/analyzer-catalog.mjs';

test('analyzer settings catalogs preserve supported project keys and rule parameter paths', () => {
  for (const version of analyzerCatalogVersions) {
    const { analyzerGroups, diagnosticCatalog } = analyzerCatalogForVersion(version);
    const fields = analyzerGroups.flatMap(group => group.fields);
    const paths = fields.map(field => field.path.join('.'));
    assert.equal(new Set(paths).size, fields.length);
    assert.equal(new Set(diagnosticCatalog.map(rule => rule.id)).size, diagnosticCatalog.length);

    for (const rule of diagnosticCatalog) {
      assert.equal(typeof rule.defaultEnabled, 'boolean');
      assert.ok(rule.label.ru && rule.label.en);
      assert.ok(rule.parameters.every(parameter => parameter.path.length === 1));
      assert.equal(new Set(rule.parameters.map(parameter => parameter.path[0])).size, rule.parameters.length);
    }

    const fieldsByPath = new Map(fields.map(field => [field.path.join('.'), field]));
    assert.equal(fieldsByPath.get('source.root').managedBy, 'eska');
    assert.equal(fieldsByPath.get('formatting.use_tabs').managedBy, 'format');
    const lineLength = diagnosticCatalog.find(rule => rule.id === 'LineLength');
    assert.equal(lineLength.parameters.find(parameter => parameter.path[0] === 'maxLineLength').managedBy, 'format');
    assert.equal(fieldsByPath.has('source.exclude'), version !== '0.2.67');
  }
});

test('analyzer catalog gates settings that differ between confirmed releases', () => {
  const ruleFor = (version, id) => analyzerCatalogForVersion(version).diagnosticCatalog.find(rule => rule.id === id);
  assert.equal(ruleFor('0.4.0', 'FieldsFromJoinsWithoutIsNull').defaultEnabled, false);
  assert.equal(ruleFor('0.4.1', 'FieldsFromJoinsWithoutIsNull').defaultEnabled, false);
  assert.equal(ruleFor('0.4.2', 'FieldsFromJoinsWithoutIsNull').defaultEnabled, true);
  assert.deepEqual(ruleFor('0.2.67', 'DeprecatedPlatformApi').parameters, []);
  assert.equal(ruleFor('0.4.1', 'CalculationRegisterVirtualTableWithoutRecorder'), undefined);
  assert.deepEqual(ruleFor('0.4.2', 'CalculationRegisterVirtualTableWithoutRecorder').parameters[0].path,
    ['onlyInModulesWritingRegister']);
  assert.equal(analyzerCatalogForVersion('0.4.8'), undefined);
});


test('published 0.4.3–0.4.6 diagnostic additions preserve every historical catalog', () => {
  const additions = {
    '0.4.3': ['OrdinaryFormDialogUnread'],
    '0.4.4': ['BuiltinFunctionNameAsDeclaration', 'LocalCallWithQueryInCycle', 'PossiblyUndefinedValue',
      'UnknownQueryFunction', 'UnavailableAliasInQuery'],
    '0.4.5': ['ObjectModifiedInOnWrite', 'RegisterRecorderFieldInQuery'],
    '0.4.6': ['QueryOrderByDocumentDate', 'QueryConditionWithoutIndex']
  };
  for (const [introduced, ids] of Object.entries(additions)) {
    for (const version of analyzerCatalogVersions) {
      const rules = analyzerCatalogForVersion(version).diagnosticCatalog;
      for (const id of ids) {
        const rule = rules.find(rule => rule.id === id);
        assert.equal(Boolean(rule), analyzerCatalogVersions.indexOf(version) >= analyzerCatalogVersions.indexOf(introduced), `${version}: ${id}`);
        if (rule) {
          assert.equal(rule.defaultEnabled, true);
          assert.deepEqual(rule.parameters, []);
        }
      }
    }
  }
  for (let index = analyzerCatalogVersions.indexOf('0.4.3'); index < analyzerCatalogVersions.length; index++) {
    const before = analyzerCatalogForVersion(analyzerCatalogVersions[index - 1]).diagnosticCatalog;
    const after = analyzerCatalogForVersion(analyzerCatalogVersions[index]).diagnosticCatalog;
    assert.ok(before.every(rule => after.some(next => next.id === rule.id)), 'no published diagnostics removed');
  }
});


test('effective severity controls are gated at 0.4.4 and edit only their canonical leaf', async () => {
  const { withValue, manifestEdits } = await import('../webview/settings/project-draft.mjs');
  for (const version of analyzerCatalogVersions) {
    assert.equal(analyzerCatalogForVersion(version).severityOverrides,
      analyzerCatalogVersions.indexOf(version) >= analyzerCatalogVersions.indexOf('0.4.4'));
  }
  const option = diagnosticSeverityField('QueryOrderByDocumentDate');
  assert.deepEqual(option.path, ['diagnostics', 'metadataOverrides', 'QueryOrderByDocumentDate', 'lspSeverity']);
  assert.deepEqual(option.choices, ['error', 'warning', 'information', 'hint']);
  const before = { diagnostics: { parameters: { QueryOrderByDocumentDate: false },
    metadataOverrides: { QueryOrderByDocumentDate: { tags: ['sql'], future: 'keep' },
      FutureRule: { lspSeverity: 'information' } } }, futureSection: { keep: true } };
  const after = withValue(before, option.path, 'hint');
  assert.deepEqual(manifestEdits(before, after), [{ path: option.path, value: 'hint' }]);
  const reset = withValue(after, option.path, undefined);
  assert.deepEqual(reset, before);
  assert.equal(after.diagnostics.parameters.QueryOrderByDocumentDate, false);
  assert.deepEqual(before.diagnostics.metadataOverrides.QueryOrderByDocumentDate, { tags: ['sql'], future: 'keep' });
});


test('0.4.7 settings match published defaults without changing previous catalogs', () => {
  const current = analyzerCatalogForVersion('0.4.7');
  const previous = analyzerCatalogForVersion('0.4.6');
  const additions = current.diagnosticCatalog.filter(rule => !previous.diagnosticCatalog.some(old => old.id === rule.id));
  assert.deepEqual(Object.fromEntries(additions.map(rule => [rule.id, rule.defaultEnabled])), {
    AtClientAtServerFormMethod: true,
    PostingWhileDataExchangeLoading: true,
    UnboundFormEventHandler: true,
    FormEventHandlerDirective: true,
    StructureKeyIsNotIdentifier: true,
    MultilingualStringHasEmptyTranslation: true,
    FormDataHasNoMetadataMethod: true,
    ValueIsFilledOfBoolean: true,
    TypeNameComparedAsText: false,
  });
  assert.ok(additions.every(rule => rule.parameters.length === 0));
  for (const version of analyzerCatalogVersions) {
    const option = analyzerCatalogForVersion(version).analyzerGroups.flatMap(group => group.fields)
      .find(field => field.path.join('.') === 'features.map_key_types');
    assert.equal(Boolean(option), version === '0.4.7', version);
    if (option) assert.equal(option.default, true);
  }
});
