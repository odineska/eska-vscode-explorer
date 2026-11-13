"""Verify the form renderer's generated CSS, font and WASM payload before publication."""
import json
import unittest

import release_test


class FormPayloadTests(unittest.TestCase):
    def setUp(self):
        release_test.ReleaseTests.setUp(self)
        self.module = release_test.load('check-vsix')
        self.source = self.root / 'source'
        manifest = {'name': 'eska-explorer', 'publisher': '1c-tooling', 'version': '0.0.1',
                    'main': './out/extension.js',
                    'contributes': {'commands': [{'command': 'eska.explorer.previewForm'},
                                                 {'command': 'eska.explorer.configureProject'}]}}
        self.files = {'package.json': json.dumps(manifest), 'package.nls.json': '{}', 'package.nls.ru.json': '{}',
                      'README.md': 'README', 'CHANGELOG.md': 'Changes', 'LICENSE': 'License',
                      'docs/setup.md': 'Connection instructions', 'docs/setup.ru.md': 'Подключение',
                      'resources/icons/support/LICENSE': 'Icon license', 'resources/icons/support/NOTICE.md': 'Icon notices',
                      'out/extension.js': 'extension runtime', 'out/query-designer.js': 'query runtime',
                      'out/project-settings.js': 'settings runtime',
                      'resources/settings/settings.css': 'settings styles',
                      'out/form-preview.js': 'form runtime', 'out/form-preview.css': 'form styles',
                      'out/form-fonts/LiberationSans-Regular-ABC.ttf': 'font bytes',
                      'out/form-fonts/font-raster-DEF.wasm': 'rasterizer bytes'}
        for name, content in self.files.items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding='utf-8')
        self.outputs = {name: {} for name in self.files if name.startswith('out/') and name != 'out/extension.js'}
        self.metadata = self.source / 'out/query-designer-meta.json'
        self.write_metadata(self.outputs)
        self.archive = self.root / 'release.vsix'

    def write_metadata(self, outputs):
        self.metadata.write_text(json.dumps({'outputs': outputs}), encoding='utf-8')

    def package(self, **options):
        release_test.VsixPayloadTests.package(self, **options)

    def test_current_form_outputs_are_verified_against_build_bytes(self):
        self.package()
        self.module.check(self.archive, self.source)

    def test_missing_or_changed_form_bundle_style_font_and_wasm_stop_publication(self):
        for name in ['out/form-preview.js', 'out/form-preview.css', 'out/form-fonts/LiberationSans-Regular-ABC.ttf',
                     'out/form-fonts/font-raster-DEF.wasm']:
            with self.subTest(asset=name, failure='missing'):
                self.package(removed=name)
                with self.assertRaisesRegex(AssertionError, 'missing archive files:'):
                    self.module.check(self.archive, self.source)
            with self.subTest(asset=name, failure='changed'):
                self.package(changed={name: 'changed bytes'})
                with self.assertRaisesRegex(AssertionError, name):
                    self.module.check(self.archive, self.source)

    def test_stale_unreferenced_fonts_are_rejected_even_if_present_in_source(self):
        name = 'out/form-fonts/obsolete-OLD.ttf'
        (self.source / name).write_text('stale font', encoding='utf-8')
        self.package(extra={name: 'stale font'})
        with self.assertRaisesRegex(AssertionError, 'Unexpected archive files:.*obsolete-old.ttf'):
            self.module.check(self.archive, self.source)

    def test_declared_forms_require_complete_browser_output_metadata(self):
        self.package()
        for name in self.outputs.keys() - {'out/project-settings.js'}:
            with self.subTest(output=name):
                self.write_metadata({key: value for key, value in self.outputs.items() if key != name})
                with self.assertRaisesRegex(AssertionError, 'Missing form'):
                    self.module.check(self.archive, self.source)

    def test_project_settings_require_the_exact_bundle_and_styles(self):
        for name in ['out/project-settings.js', 'resources/settings/settings.css']:
            with self.subTest(asset=name, failure='missing'):
                self.package(removed=name)
                with self.assertRaisesRegex(AssertionError, 'missing archive files:.*' + name):
                    self.module.check(self.archive, self.source)
            with self.subTest(asset=name, failure='changed'):
                self.package(changed={name: 'changed bytes'})
                with self.assertRaisesRegex(AssertionError, name):
                    self.module.check(self.archive, self.source)
        self.package(extra={'resources/settings/unreferenced.css': 'unreferenced style'})
        with self.assertRaisesRegex(AssertionError, 'Unexpected archive files:.*unreferenced.css'):
            self.module.check(self.archive, self.source)

    def test_metadata_cannot_escape_the_form_font_directory(self):
        self.write_metadata({**self.outputs, 'out/form-fonts/../extension.js': {}})
        self.package()
        with self.assertRaisesRegex(AssertionError, 'Unexpected form browser output'):
            self.module.check(self.archive, self.source)

    def test_missing_build_asset_stops_before_archive_acceptance(self):
        (self.source / 'out/form-fonts/font-raster-DEF.wasm').unlink()
        self.package()
        with self.assertRaisesRegex(AssertionError, 'Missing bundled browser asset:'):
            self.module.check(self.archive, self.source)

    def test_source_files_remain_forbidden_with_form_assets(self):
        self.package(extra={'src/form-preview.jsx': 'source must not ship'})
        with self.assertRaisesRegex(AssertionError, 'Unexpected archive files:.*src/form-preview.jsx'):
            self.module.check(self.archive, self.source)


if __name__ == '__main__':
    unittest.main()
