#!/usr/bin/env python3
"""Verify the actual VSIX payload, not only the packaging ignore rules."""
import argparse
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile


def form_runtime_assets(root, manifest):
    """Require every emitted form asset without accepting stale or unreferenced font files."""
    commands = manifest.get('contributes', {}).get('commands', [])
    if not any(command.get('command') == 'eska.explorer.previewForm' for command in commands):
        return []
    outputs = set(json.loads((root / 'out/query-designer-meta.json').read_text(encoding='utf-8'))['outputs'])
    entrypoints = {'out/query-designer.js', 'out/form-preview.js'}
    required = entrypoints | {'out/form-preview.css'}
    assert required <= outputs, 'Missing form browser output metadata'
    fonts = outputs - required
    assert all(re.fullmatch(r'out/form-fonts/[A-Za-z0-9_-]+\.(?:ttf|wasm)', name) for name in fonts), 'Unexpected form browser output'
    assert any(name.endswith('.ttf') for name in fonts), 'Missing form font output'
    assert any(name.endswith('.wasm') for name in fonts), 'Missing form rasterizer output'
    for name in outputs:
        assert (root / name).is_file(), f'Missing bundled browser asset: {name}'
    return sorted(outputs - entrypoints)


def check(archive, source=None):
    """Reject missing runtime assets, accidental source/dependency inclusion and mismatched identity."""
    root = (source or Path(__file__).resolve().parents[1]).resolve()
    manifest = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    assert (root / 'out/query-designer.js').is_file(), 'Missing bundled query webview'
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        assert len(names) == len(set(names)), 'Duplicate ZIP entries'
        assert package.testzip() is None, 'Invalid ZIP CRC'
        identity = ET.fromstring(package.read('extension.vsixmanifest')).find('.//{*}Identity')
        assert identity.attrib['Publisher'] == manifest['publisher']
        assert identity.attrib['Id'] == manifest['name']
        assert identity.attrib['Version'] == manifest['version']
        shipped = json.loads(package.read('extension/package.json'))
        assert all(shipped.get(key) == value for key, value in manifest.items()), 'Packaged manifest differs'
        required = ['package.json', 'package.nls.json', 'package.nls.ru.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'resources/icons/support/LICENSE', 'resources/icons/support/NOTICE.md']
        if manifest.get('icon'):
            required.append(manifest['icon'])
        required += [path.relative_to(root).as_posix() for pattern in ['out/*.js', 'out/THIRD-PARTY-NOTICES.txt', 'resources/analyzer-notices/*', 'resources/language/*', 'resources/icons/**/*.svg', 'resources/properties/*.css', 'resources/properties/*.js', 'resources/properties/*.mjs', 'resources/rename/*.css', 'resources/rename/*.js', 'resources/shared/*.css', 'resources/query/*.css', 'docs/*.md', 'docs/images/*.png', 'docs/measurements/*.json'] for path in root.glob(pattern)]
        required += form_runtime_assets(root, manifest)
        # vsce publishes a LICENSE without an extension as LICENSE.txt.
        packaged = {name: 'extension/' + ('LICENSE.txt' if name == 'LICENSE' else name) for name in required}
        expected = set(packaged.values()) | {'extension.vsixmanifest', '[Content_Types].xml'}
        actual = {name.lower() for name in names}
        expected = {name.lower() for name in expected}
        assert actual == expected, (f'Unexpected archive files: {sorted(actual - expected)}; '
                                    f'missing archive files: {sorted(expected - actual)}')
        # vsce may normalize README/CHANGELOG names and augment package.json metadata.
        normalized = {name.lower(): name for name in names}
        for name in required:
            if name != 'package.json':
                assert package.read(normalized[packaged[name].lower()]) == (root / name).read_bytes(), name
        assert package.read('extension/' + manifest['main'].removeprefix('./'))
    print(f'VSIX verified: {manifest["publisher"]}.{manifest["name"]}@{manifest["version"]}; {len(names)} files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--source', type=Path, help='Source tree whose manifest and file bytes must match the archive')
    arguments = parser.parse_args()
    check(arguments.archive, arguments.source)
