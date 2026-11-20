"""Full NDJSON responses from the real worker, captured on Darwin arm64 with MuJoCo 3.17.0."""
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path
from uuid import UUID

import pytest

from mujoco_worker.protocol import load_validators
from scene_fixture import BLOBS, SCHEMAS

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(__file__).with_name("data") / "worker-protocol-darwin-arm64"
CASES = ("mobile-no-drive", "mobile-cil", "arm-no-drive")
RESPONSE_OVERRIDE = os.environ.get("MUJOCO_PROTOCOL_RESPONSE_DIR")


def capture_responses(bundle_root, case):
    run_id = f"protocol-{case}"
    if case == "mobile-cil":
        shutil.copytree(DATA / "mobile-no-drive", bundle_root, dirs_exist_ok=True)
    shutil.copytree(DATA / case, bundle_root, dirs_exist_ok=True)
    if case == "arm-no-drive":
        shutil.copytree(BLOBS, bundle_root / "blobs")
    raw_requests = (DATA / f"{case}.requests.ndjson").read_bytes()
    requests = list(map(json.loads, raw_requests.splitlines()))
    assert [request["op"] for request in requests] == ["create", "start", *["step"] * 40, "getState"]
    exchange = subprocess.run(
        [sys.executable, "-B", "-m", "mujoco_worker", "--run-id", run_id, "--bundle-root", str(bundle_root),
         "--schema-dir", str(SCHEMAS), "--lock-digest", "b" * 64],
        cwd=ROOT, input=raw_requests,
        capture_output=True, timeout=30,
    )
    assert exchange.returncode == 0, exchange.stderr.decode()
    rows = list(map(json.loads, exchange.stdout.splitlines()))
    assert len(rows) == len(requests)
    _, response_validator = load_validators(SCHEMAS)
    boot_id = rows[0]["bootId"]
    assert UUID(boot_id).version == 4
    for request, response in zip(requests, rows, strict=True):
        assert response["ok"] and response["requestId"] == request["requestId"], response
        assert response["bootId"] == boot_id
        if "bootId" in response["result"]:
            assert response["result"]["bootId"] == boot_id
        response_validator.validate(response)

    # Preserve every wire byte except the value of the per-process bootId key.
    # Request IDs and run IDs are deterministic inputs, so they are kept verbatim.
    return re.sub(rb'("bootId":")' + boot_id.encode() + rb'(")',
                  rb'\g<1>00000000-0000-4000-8000-000000000000\g<2>', exchange.stdout)


@pytest.mark.skipif(RESPONSE_OVERRIDE is None and (platform.system(), platform.machine()) != ("Darwin", "arm64"),
                    reason="set MUJOCO_PROTOCOL_RESPONSE_DIR to a pre-fix corpus captured on this platform")
@pytest.mark.parametrize("case", CASES)
def test_worker_responses_match_the_pre_fix_wire_bytes(tmp_path, case):
    response_dir = DATA if RESPONSE_OVERRIDE is None else Path(RESPONSE_OVERRIDE)
    assert capture_responses(tmp_path, case) == (response_dir / f"{case}.ndjson").read_bytes()
