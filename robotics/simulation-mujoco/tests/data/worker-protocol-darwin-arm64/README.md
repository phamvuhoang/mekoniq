# Worker protocol corpus

Captured from `faee938d` on macOS 26.5 (Darwin arm64), Python 3.11.15 and MuJoCo 3.17.0. Each response stream includes create, start, 40 steps and getState. The test runs the worker CLI against the recorded requests and scene documents, then compares its NDJSON bytes with the capture. Only the per-process `bootId` value is replaced, under the explicit `bootId` key. No cross-platform byte equivalence is asserted.

Both mobile cases use the center-cup load. The no-drive case uses velocity commands. The CIL case overlays its recorded navigation scene and nominal drive documents on the mobile bundle and sends fresh sequences. The arm uses joint and gripper targets with a cup placement and reuses the repository's content-addressed arm blobs.

## Capture on another platform

Run from the source repository root on the platform under test, with the locked worker Python environment. The fixture commit supplies the original requests and bundle documents. The worker and its schemas come from the pre-fix revision `a93ae08d`, which has the same worker as `faee938d`.

```sh
baseline_dir=$(mktemp -d)
response_dir=$(mktemp -d)
worker_dir=robotics/simulation-mujoco
git archive a93ae08d "$worker_dir/mujoco_worker" \
  "$worker_dir/fixtures/serve-payload-v1" "$worker_dir/fixtures/xarm6-g2-v1/blobs" \
  "$worker_dir/tests/scene_fixture.py" packages/contracts/schemas | tar -x -C "$baseline_dir"
git archive edb11dd9 "$worker_dir/tests/test_worker_protocol_regression.py" \
  "$worker_dir/tests/data/worker-protocol-darwin-arm64" | tar -x -C "$baseline_dir"

PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$baseline_dir/$worker_dir/tests:$baseline_dir/$worker_dir" \
  perl -e 'alarm 90; exec @ARGV' .venv-mujoco/bin/python -B - "$response_dir" <<'PY'
import platform
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import mujoco
from test_worker_protocol_regression import CASES, capture_responses

print(platform.platform(), platform.python_version(), mujoco.__version__)
for case in CASES:
    with TemporaryDirectory() as bundle:
        output = Path(sys.argv[1]) / f"{case}.ndjson"
        output.write_bytes(capture_responses(Path(bundle), case))
        print(output)
PY

PYTHONDONTWRITEBYTECODE=1 MUJOCO_PROTOCOL_RESPONSE_DIR="$response_dir" \
  perl -e 'alarm 90; exec @ARGV' .venv-mujoco/bin/python -B -m pytest -p no:cacheprovider \
  "$worker_dir/tests/test_worker_protocol_regression.py" -q -rs
```

## Native Linux x86-64 qualification

From a clean Source checkout on Linux x86-64 with a local amd64 Docker daemon, Node and pnpm at the repository versions, Git, Perl and jq, the hosted CLD02 job can be reproduced with:

```sh
RUNNER_TEMP=$(mktemp -d)
export RUNNER_TEMP
scripts/r4-cld02.sh
(cd "$RUNNER_TEMP/r4-cld02" && sha256sum -c SHA256SUMS)
```

The job builds the production image and uses its locked Python for both the historical capture and the full current worker suite. The original worker/probe and fixture revisions are recorded in `host.txt` and `baseline-trees.txt`. The output includes the three normalized protocol streams, the three legacy position/velocity traces, their platform-scoped digests in `baseline/legacy-digests.json`, the runtime manifest, image identity, command logs, exit codes and pytest XML. The full suite reads the pre-fix files through `MUJOCO_PROTOCOL_RESPONSE_DIR` and `MUJOCO_LEGACY_DIGEST_FILE`. On Darwin arm64 the legacy test also checks the original three literal digests.
