#!/usr/bin/env python3
"""Inspect an exported image without running its entrypoint or any payments."""
import hashlib
import json
import sys
import tarfile

with tarfile.open(sys.argv[1]) as archive:
    names = set(archive.getnames())
    for forbidden in ('app/frontend', 'app/web/node_modules', 'app/web/dist-preview', 'app/scripts', 'app/artifacts'):
        assert not any(n == forbidden or n.startswith(forbidden + '/') for n in names), forbidden
    def read(name):
        return archive.extractfile(name).read()
    base = 'usr/share/doc/cshell/'
    for name in ('LICENSE', 'THIRD_PARTY_NOTICES.md', 'HISTORY-LICENSE.md', 'web-third-party.md'):
        assert read(base + name), name
    for prefix in ('app/web/dist/legal/npm/', base + 'rust/'):
        inventory = json.loads(read(prefix + 'inventory.json'))
        assert not inventory['unresolved'], inventory['unresolved']
        assert read(prefix + 'THIRD_PARTY_NOTICES.txt')
        for package in inventory['packages']:
            assert package['license'] and package['notices'], package['name']
            for notice in package['notices']:
                assert hashlib.sha256(read(prefix + notice['text'])).hexdigest() == notice['sha256']
    dist = 'app/web/dist/'
    manifest = json.loads(read(dist + 'release-manifest.json'))
    expected = {dist + f['path'] for f in manifest['files']} | {dist + 'release-manifest.json'}
    actual = {n for n in names if n.startswith(dist) and archive.getmember(n).isfile()}
    assert actual == expected, actual ^ expected
    for file in manifest['files']:
        assert hashlib.sha256(read(dist + file['path'])).hexdigest() == file['sha256']
    print('Image artifact/notices verified; base-system licenses remain under /usr/share/doc.')
