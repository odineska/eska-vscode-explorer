#!/usr/bin/env python3
"""Verify the actual VSIX payload, not only the packaging ignore rules."""
import argparse
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile


MIB = 1024 * 1024
SIZE_LIMITS = {'archive': 5 * MIB, 'installed': 10 * MIB, 'javascript': 7 * MIB // 2}
SETTINGS_BUNDLE = 'out/project-settings.js'


def contributes_command(manifest, command):
    return any(entry.get('command') == command
               for entry in manifest.get('contributes', {}).get('commands', []))


def check_sizes(archive, entries):
    """Budget the download, installed files and executable JS independently."""
    installed = [entry for entry in entries if entry.filename.startswith('extension/') and not entry.is_dir()]
    sizes = {
        'archive': archive.stat().st_size,
        'installed': sum(entry.file_size for entry in installed),
        'javascript': sum(entry.file_size for entry in installed
                          if entry.filename.startswith('extension/out/') and entry.filename.endswith('.js')),
    }
    for name, size in sizes.items():
        assert size <= SIZE_LIMITS[name], f'VSIX {name} size {size} bytes exceeds budget {SIZE_LIMITS[name]} bytes'
    return sizes


def form_runtime_assets(root, manifest):
    """Require every emitted form asset without accepting stale or unreferenced font files."""
    if not contributes_command(manifest, 'eska.explorer.previewForm'):
        return []
    outputs = set(json.loads((root / 'out/query-designer-meta.json').read_text(encoding='utf-8'))['outputs'])
    if contributes_command(manifest, 'eska.explorer.configureProject'):
        outputs.discard(SETTINGS_BUNDLE)
    entrypoints = {'out/query-designer.js', 'out/form-preview.js'}
    required = entrypoints | {'out/form-preview.css'}
    assert required <= outputs, 'Missing form browser output metadata'
    fonts = outputs - required
    assert all(re.fullmatch(r'out/form-fonts/[A-Za-z0-9_-]+\.(?:ttf|wasm)', name) for name in fonts), 'Unexpected form browser output'
    assert any(name.endswith('.ttf') for name in fonts), 'Missing form font output'
    assert any(name.endswith('.wasm') for name in fonts), 'Missing form rasterizer output'
    for name in outputs:
        assert (root / name).is_file(), f'Missing bundled browser asset: {name}'
    return sorted(outputs - {'out/query-designer.js'})


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
        required = ['package.json', 'package.nls.json', 'package.nls.ru.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'resources/icons/support/LICENSE', 'resources/icons/support/NOTICE.md', 'out/extension.js', 'out/query-designer.js', 'docs/setup.md', 'docs/setup.ru.md']
        if manifest.get('icon'):
            required.append(manifest['icon'])
        required += [path.relative_to(root).as_posix() for pattern in ['out/THIRD-PARTY-NOTICES.txt', 'resources/analyzer-notices/*', 'resources/language/*', 'resources/icons/**/*.svg', 'resources/properties/*.css', 'resources/properties/*.js', 'resources/properties/*.mjs', 'resources/rename/*.css', 'resources/rename/*.js', 'resources/shared/*.css', 'resources/query/*.css'] for path in root.glob(pattern)]
        required += form_runtime_assets(root, manifest)
        if contributes_command(manifest, 'eska.explorer.configureProject'):
            required += [SETTINGS_BUNDLE, 'resources/settings/settings.css']
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
        sizes = check_sizes(archive, package.infolist())
    summary = '; '.join(f'{name} {size / MIB:.2f} MiB' for name, size in sizes.items())
    print(f'VSIX verified: {manifest["publisher"]}.{manifest["name"]}@{manifest["version"]}; {len(names)} files; {summary}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--source', type=Path, help='Source tree whose manifest and file bytes must match the archive')
    arguments = parser.parse_args()
    check(arguments.archive, arguments.source)
