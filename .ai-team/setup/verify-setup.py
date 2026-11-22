#!/usr/bin/env python3
"""Verify the installed team without overwriting its deliberately mutable work log."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tomllib


ROOT = Path(__file__).resolve().parents[2]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked_file(relative):
    part = PurePosixPath(relative)
    if part.is_absolute() or '..' in part.parts:
        raise ValueError('Unsafe manifest path: ' + relative)
    path = ROOT / relative
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
        raise ValueError('Missing, linked or escaping installed file: ' + relative)
    return path


def verify(check_plugin=False):
    manifest = json.loads((ROOT / '.ai-team/setup/installation-manifest.json').read_text())
    assert manifest['schema_version'] == 1 and manifest['client'] == 'codex'
    assert len(manifest['immutable_sha256']) == 822
    assert set(manifest['mutable_files']) == {'.ai-team/WORK.md'}
    for relative, expected in manifest['immutable_sha256'].items():
        if digest(checked_file(relative).read_bytes()) != expected:
            raise ValueError('Installed payload changed: ' + relative)
    checked_file('.ai-team/WORK.md').read_text(encoding='utf-8')
    instructions = checked_file('AGENTS.md').read_text()
    begin, end = '<!-- VOXEL_VEDA_AI_TEAM:BEGIN -->', '<!-- VOXEL_VEDA_AI_TEAM:END -->'
    assert instructions.count(begin) == instructions.count(end) == 1
    start, stop = instructions.index(begin), instructions.index(end) + len(end)
    assert start < instructions.index(end)
    assert digest(instructions[start:stop].encode()) == manifest['owned_guidance_sha256']
    roles = []
    for path in sorted((ROOT / '.codex/agents').glob('*.toml')):
        value = tomllib.loads(checked_file(path.relative_to(ROOT).as_posix()).read_text())
        assert set(value) == {'name', 'description', 'developer_instructions'}, path.name
        assert value['name'] == path.stem and all(isinstance(v, str) and v.strip() for v in value.values())
        roles.append(value['name'])
    roster = re.findall(r'^\| `(vv-[^`]+|ecc-[^`]+)` \|', checked_file('.ai-team/ROSTER.md').read_text(), re.M)
    assert len(roles) == len(set(roles)) == len(roster) == 84 and set(roles) == set(roster)
    assert sum(name.startswith('vv-') for name in roles) == 12
    assert sum(name.startswith('ecc-') for name in roles) == 72
    assert len(list((ROOT / '.ai-team/ecc-reference/skills').glob('*/SKILL.md'))) == 328
    result = {'status': 'PASS', 'client': 'codex', 'immutable_payload_files': 822,
              'owned_instruction_block': 'PASS', 'roles': 84, 'ecc_roles': 72,
              'voxel_roles': 12, 'reference_recipes': 328, 'model_overrides': 0,
              'mutable_log_preserved': '.ai-team/WORK.md',
              'native_runtime_discovery': 'Not exercised by this checksum verifier.'}
    if check_plugin:
        process = subprocess.run(['codex', 'plugin', 'list'], cwd=ROOT,
                                 capture_output=True, text=True, timeout=30)
        match = re.search(r'^ecc@ecc\s+installed,\s+enabled\s+(\S+)', process.stdout, re.M)
        if process.returncode or not match:
            raise ValueError('Native Codex plugin list did not confirm ecc@ecc installed and enabled.')
        result['native_plugin'] = {'name': 'ecc@ecc', 'version': match.group(1), 'installed': True,
                                   'enabled': True, 'runtime_or_hook_trust_proven': False}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-plugin', action='store_true', help='Also inspect the actual Codex plugin list.')
    args = parser.parse_args()
    print(json.dumps(verify(args.check_plugin), indent=2))
