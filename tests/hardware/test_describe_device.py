"""describe-device.py turns a pinned EDS or ESI into a deterministic summary. Inputs are the manufacturer files kept in the R5 research tree."""
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/describe-device.py"
VENDOR = ROOT.parent / "docs/2026-11-25-R5~/research/vendor-documents"
FILES = {"eds": VENDOR / "leadshine-2eld2/ELD2-CAN.eds.eds", "esi": VENDOR / "leadshine-eld3/ELD3_V1.10.xml"}


def run(path):
    return subprocess.run([sys.executable, "-I", "-B", str(SCRIPT), str(path)], capture_output=True, check=False)


@pytest.mark.skipif(not VENDOR.exists(), reason="research tree not present")
@pytest.mark.parametrize("kind", ["eds", "esi"])
def test_summary_is_deterministic_and_ordered(kind):
    a, b = run(FILES[kind]), run(FILES[kind])
    assert a.returncode == 0 and a.stdout == b.stdout
    doc = json.loads(a.stdout)
    assert doc["kind"] == kind and len(doc["fileSha256"]) == 64
    keys = [(o["index"], o["subindex"]) for o in doc["objects"]]
    assert keys == sorted(keys) and len(keys) == len(set(keys))
    by = {(o["index"], o["subindex"]): o for o in doc["objects"]}
    assert by[("60FD", 0)]["access"] == "ro" and by[("6040", 0)]["pdoMappable"] is True


@pytest.mark.skipif(not VENDOR.exists(), reason="research tree not present")
def test_eds_mode_mask_comes_from_object_6502():
    assert json.loads(run(FILES["eds"]).stdout)["supportedModes"] == ["pp", "pv", "pt", "hm"]


@pytest.mark.parametrize("name,data", [("cut-eds", b"[FileInfo]\nFileName=x\n"), ("cut-esi", b"<EtherCATInfo><Vendor><Id>1</Id></Vendor><Descriptions"), ("garbage", b"\x00\x01\x02"), ("entity", b"<!DOCTYPE x [<!ENTITY a 'b'>]><x/>")])
def test_unreadable_files_exit_2(tmp_path, name, data):
    p = tmp_path / name
    p.write_bytes(data)
    r = run(p)
    assert r.returncode == 2 and b"DESCRIPTION_UNREADABLE" in r.stderr


def test_missing_file_exits_2(tmp_path):
    assert run(tmp_path / "absent").returncode == 2
