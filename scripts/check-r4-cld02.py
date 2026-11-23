"""Admission checks for the production image interpreter and its completed pytest run."""
import hashlib
import importlib.metadata
import platform
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def check_guest():
    print(platform.platform(), sys.version, sys.executable)
    if sys.flags.optimize:
        sys.exit("PYTHON_OPTIMIZATION_ENABLED: baseline and worker assertions must execute")
    if (platform.system(), platform.machine()) != ("Linux", "x86_64"):
        sys.exit("NATIVE_ARCH_REQUIRED: expected a Linux x86_64 guest")
    if sys.implementation.name != "cpython" or sys.version_info[:2] != (3, 11):
        sys.exit("PYTHON_VERSION_MISMATCH: expected CPython 3.11")
    lock = Path("/app/robotics/simulation-mujoco/requirements.lock").read_bytes()
    print("mujoco requirements.lock sha256", hashlib.sha256(lock).hexdigest())
    for package, locked in re.findall(r"^(\S+)==(\S+)", lock.decode(), re.MULTILINE):
        installed = importlib.metadata.version(package)
        print(package, installed, "locked", locked)
        if installed != locked:
            sys.exit(f"LOCKED_VERSION_MISMATCH: {package} installed {installed}, expected {locked}")


def check_receipt(path):
    tree = ET.parse(sys.stdin.buffer if path == "-" else path)
    suites = tree.findall(".//testsuite")
    if not suites:
        sys.exit("empty native suite")
    completed = set()
    for suite in suites:
        cases = suite.findall("testcase")
        for case in cases:
            name = case.attrib.get("name", "")
            for tag in ("skipped", "error", "failure"):
                if case.find(tag) is not None:
                    sys.exit(f"native worker suite {tag}: {name}")
            completed.add((case.get("classname", "").split(".")[-1], name))
        if any(suite.get(k) != "0" for k in ("errors", "failures", "skipped")) or suite.get("tests") != str(len(cases)):
            sys.exit("native worker suite totals disagree")
    required = {("test_drive_engine", "test_the_legacy_path_gives_the_three_recorded_digests")}
    for case in ("mobile-no-drive", "mobile-cil", "arm-no-drive"):
        required.add(("test_worker_protocol_regression", f"test_worker_responses_match_the_pre_fix_wire_bytes[{case}]"))
    missing = required - completed
    if missing:
        sys.exit("missing native comparison: " + ", ".join(sorted(name for _, name in missing)))


if sys.argv[1:] == ["guest"]:
    check_guest()
elif len(sys.argv) == 3 and sys.argv[1] == "receipt":
    check_receipt(sys.argv[2])
else:
    sys.exit("usage: check-r4-cld02.py guest | receipt FILE")
