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
    cases = ET.parse(path).findall(".//testcase")
    required = {"test_the_legacy_path_gives_the_three_recorded_digests"}
    required.update(f"test_worker_responses_match_the_pre_fix_wire_bytes[{case}]" for case in ("mobile-no-drive", "mobile-cil", "arm-no-drive"))
    missing = required - {case.attrib["name"] for case in cases}
    if missing:
        sys.exit("missing native comparison: " + ", ".join(sorted(missing)))
    for case in cases:
        if case.find("skipped") is not None:
            sys.exit(f"native worker suite skipped {case.attrib['name']}")


if sys.argv[1:] == ["guest"]:
    check_guest()
elif len(sys.argv) == 3 and sys.argv[1] == "receipt":
    check_receipt(sys.argv[2])
else:
    sys.exit("usage: check-r4-cld02.py guest | receipt FILE")
