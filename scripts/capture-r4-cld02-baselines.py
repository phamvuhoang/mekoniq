"""Capture archived worker outputs using the image's locked interpreter. Arguments are the historical tool root and a fresh output directory."""
import json
import platform
import sys
import traceback
from pathlib import Path
from tempfile import TemporaryDirectory

import mujoco
import numpy as np

tool, out = map(Path, sys.argv[1:])
sys.path[:0] = [str(tool), str(tool / "tests")]
import probe_drive as probe
from test_worker_protocol_regression import CASES, capture_responses

status = {}
digests = {}
for case in CASES:
    try:
        with TemporaryDirectory() as bundle:
            data = capture_responses(Path(bundle), case)
        (out / f"{case}.ndjson").write_bytes(data)
        status[case] = "captured"
    except Exception:
        status[case] = "failed"
        traceback.print_exc()

for case, ticks, run in (("mobile", 300, probe.legacy_mobile), ("arm", 300, probe.legacy_arm), ("world", 500, probe.legacy_world)):
    try:
        qpos, qvel, _timing = run(ticks)
        np.savez_compressed(out / f"legacy-{case}.npz", qpos=qpos, qvel=qvel)
        digests[case] = probe.digest(qpos, qvel)
        status[case] = "captured"
    except Exception:
        status[case] = "failed"
        traceback.print_exc()

identity = [platform.system(), platform.machine(), platform.python_version(), mujoco.__version__, np.__version__]
(out / "legacy-digests.json").write_text(json.dumps({"platform": identity, "digests": digests}, indent=2) + "\n")
print(json.dumps({"platform": identity, "cases": status}, indent=2))
sys.exit(int("failed" in status.values()))
