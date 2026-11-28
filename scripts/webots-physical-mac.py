"""Run the Webots cases the hosted macOS VMs cannot (tests/fixtures/ci/macos-engines.json, physicalMac) on this physical Mac, and keep a record.

  python3 scripts/webots-physical-mac.py OUTDIR      (Node 24 and pnpm on PATH, .venv-webots provisioned, Webots R2025a, a clean checkout)

Writes junit.xml, vitest.log, summary.txt and record.json (commit, macOS, Webots, result by name). Exit 0 only if every case passed. OUTDIR must not exist.
"""
import datetime
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
from pathlib import Path

if len(sys.argv) != 2 or sys.platform != 'darwin':
    sys.exit(__doc__)
root, out = Path(__file__).resolve().parent.parent, Path(sys.argv[1]).resolve()
manifest_path = root / 'tests/fixtures/ci/macos-engines.json'
home = Path(os.environ.get('MEKONIQ_WEBOTS_HOME', '/Applications/Webots.app'))
exe = home / 'Contents/MacOS/webots'


def run(*argv):
    return subprocess.run(argv, cwd=root, check=True, capture_output=True, text=True).stdout.strip()


commit, dirty = run('git', 'rev-parse', 'HEAD'), run('git', 'status', '--porcelain')
if dirty:
    sys.exit(f'DIRTY_TREE: a record names a commit, so the checkout must be clean\n{dirty}')
webots = run(str(exe), '--version')
cases = json.loads(manifest_path.read_text())['physicalMac']
files = sorted({c.split(' > ')[0] for c in cases})
# vitest matches -t against the suite and test names joined by a space
pattern = '|'.join(re.sub(r'([.*+?^${}()|\[\]\\])', r'\\\1', c.split(' > ', 1)[1].replace(' > ', ' ')) for c in cases)
out.mkdir(parents=True)
command = ['pnpm', 'test:integration', '--', *files, '-t', pattern, '--reporter=default', '--reporter=junit', f'--outputFile.junit={out / "junit.xml"}']
env = {k: v for k, v in os.environ.items() if k != 'MEKONIQ_WEBOTS_NO_LIDAR'} | {'PYTHONDONTWRITEBYTECODE': '1'}
started = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
with (out / 'vitest.log').open('w') as log:
    vitest = subprocess.run(command, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT).returncode
check = subprocess.run([sys.executable, '-I', str(root / 'scripts/ci-junit-summary.py'), str(out / 'junit.xml'), '--expect', str(manifest_path), '--physical-mac'], capture_output=True, text=True)
(out / 'summary.txt').write_text(check.stdout + check.stderr)
record = {'commit': commit, 'startedAt': started, 'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
          'host': {'macOS': run('sw_vers', '-productVersion'), 'build': run('sw_vers', '-buildVersion'), 'arch': platform.machine()},
          'webots': {'version': webots, 'executableSha256': hashlib.sha256(exe.read_bytes()).hexdigest()}, 'node': run('node', '--version'),
          'command': command, 'vitestExit': vitest, 'checkExit': check.returncode, 'cases': cases,
          'treeCleanAfter': not run('git', 'status', '--porcelain')}
(out / 'record.json').write_text(json.dumps(record, indent=2) + '\n')
print(check.stdout + check.stderr + f'vitest exit {vitest}; record in {out}')
sys.exit(vitest or check.returncode)
