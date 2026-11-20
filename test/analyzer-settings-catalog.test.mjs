import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzerCatalogForVersion,
  analyzerCatalogVersions
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
  assert.equal(analyzerCatalogForVersion('0.4.7'), undefined);
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
