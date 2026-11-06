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


def inventory():
    packages = None
    if platform.system() == 'Linux' and shutil.which('dpkg-query'):
        result = subprocess.run(['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n'], capture_output=True, text=True, timeout=20, check=True)
        packages = [dict(zip(('name', 'version', 'architecture', 'status'), row.split('\t'))) for row in result.stdout.splitlines() if row.endswith('\tinstalled')]
    modules = {}
    for name in ('linuxcnc', 'PyQt5.QtCore', 'PyQt5.Qsci'):
        try:
            spec = importlib.util.find_spec(name)
            modules[name] = file_identity(spec.origin if spec else None)
        except (ModuleNotFoundError, ValueError):
            modules[name] = None
    return {'schemaVersion': 1, 'platform': platform.system(), 'architecture': platform.machine(), 'kernel': platform.release(), 'python': {'version': platform.python_version(), 'executable': file_identity(sys.executable)}, 'packages': packages, 'executables': {name: file_identity(shutil.which(name)) for name in ('linuxcnc', 'halcmd', 'qtvcp')}, 'modules': modules, 'qualification': 'not_run', 'claims': 'inventory only; no controller, GUI, timing or hardware assertion'}


if __name__ == '__main__':
    print(json.dumps(inventory(), indent=2))
