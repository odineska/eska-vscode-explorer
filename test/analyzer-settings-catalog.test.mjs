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
  assert.equal(analyzerCatalogForVersion('0.4.3'), undefined);
});
