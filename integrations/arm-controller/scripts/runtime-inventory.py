#!/usr/bin/env python3
"""Read-only resolved runtime inventory; presence is not controller/GUI qualification."""
import hashlib
import importlib.util
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def file_identity(path):
    if not path:
        return None
    file = Path(path).resolve()
    if not file.is_file():
        return None
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return {'path': str(file), 'sha256': digest.hexdigest()}


def parse_packages(output):
    keys = ('name', 'version', 'architecture', 'status', 'sourcePackage', 'sourceVersion')
    rows = [row.split('\t') for row in output.splitlines()]
    return [dict(zip(keys, row)) for row in rows if len(row) == len(keys) and row[3] == 'installed']


def inventory():
    packages, package_query = None, None
    if platform.system() == 'Linux' and shutil.which('dpkg-query'):
        argv = ['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Status}\t${source:Package}\t${source:Version}\n']
        result = subprocess.run(argv, capture_output=True, text=True, timeout=20, check=False)
        package_query = {'argv': argv, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr,
                         'stdoutSha256': hashlib.sha256(result.stdout.encode()).hexdigest()}
        if result.returncode == 0:
            packages = parse_packages(result.stdout)
    origins = [Path('/etc/apt/sources.list')]
    sources_dir = Path('/etc/apt/sources.list.d')
    if sources_dir.is_dir():
        origins.extend(sorted(p for p in sources_dir.iterdir() if p.suffix in ('.list', '.sources')))
    modules = {}
    for name in ('linuxcnc', 'PyQt5.QtCore', 'PyQt5.Qsci'):
        try:
            spec = importlib.util.find_spec(name)
            modules[name] = file_identity(spec.origin if spec else None)
        except (ModuleNotFoundError, ValueError):
            modules[name] = None
    return {'schemaVersion': 1, 'platform': platform.system(), 'architecture': platform.machine(), 'kernel': platform.release(), 'python': {'version': platform.python_version(), 'executable': file_identity(sys.executable)}, 'packages': packages, 'packageQuery': package_query, 'osRelease': file_identity('/etc/os-release'), 'aptSourceFiles': [identity for p in origins if (identity := file_identity(p))], 'installation': {'kind': 'native_apt' if packages is not None else None, 'resolved': False, 'reason': 'INVENTORY_ONLY_PACKAGE_ARCHIVES_SOURCE_ARTIFACTS_AND_TRUST_NOT_VERIFIED'}, 'executables': {name: file_identity(shutil.which(name)) for name in ('linuxcnc', 'halcmd', 'qtvcp')}, 'modules': modules, 'qualification': 'not_run', 'claims': 'inventory only; no controller, GUI, timing or hardware assertion'}


if __name__ == '__main__':
    print(json.dumps(inventory(), indent=2))
