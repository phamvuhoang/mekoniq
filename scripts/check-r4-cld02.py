"""Admission checks for the production image interpreter and its completed pytest run."""
from collections import Counter
import hashlib
import importlib.metadata
import json
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


def check_receipt(xml, collection, source, image):
    invocation = collection.get("invocationId")
    if (collection.get("schemaVersion") != 1 or collection.get("sourceCommit") != source
            or collection.get("imageId") != image or not re.fullmatch("[a-f0-9]{32}", invocation or "")):
        sys.exit("native collection identity mismatch")
    # This reviewed source-side roster is independent of both files in the receipt.
    # Regenerate it with `pytest --collect-only -q tests` in robotics/simulation-mujoco
    # when the contractual worker suite or its parametrization intentionally changes.
    roster = (Path(__file__).parent / "native-sim/r4-cld02-pytest-roster.txt").read_text().splitlines()
    selected = collection.get("nodeIds")
    if not isinstance(selected, list) or Counter(selected) != Counter(roster):
        sys.exit("native pytest collection differs from the full worker roster")
    root = ET.fromstring(xml)
    suites = root.findall("testsuite")
    if root.tag != "testsuites" or len(suites) != 1 or len(root.findall(".//testsuite")) != 1:
        sys.exit("expected one native pytest suite")
    suite = suites[0]
    expected_properties = {"cld02Source": source, "cld02Image": image, "cld02Invocation": invocation}
    for key, value in expected_properties.items():
        actual = [p.get("value") for p in suite.findall("properties/property") if p.get("name") == key]
        if actual != [value]:
            sys.exit("native JUnit collection identity mismatch: " + key)
    cases = suite.findall("testcase")
    if len(cases) != len(root.findall(".//testcase")):
        sys.exit("unexpected native JUnit testcase location")
    completed = []
    for case in cases:
        for tag in ("skipped", "error", "failure"):
            if case.find(tag) is not None:
                sys.exit(f"native worker suite {tag}: {case.get('name')}")
        module = case.get("classname", "").replace(".", "/")
        completed.append(f"{module}.py::{case.get('name')}")
    if any(suite.get(k) != "0" for k in ("errors", "failures", "skipped")) or suite.get("tests") != str(len(cases)):
        sys.exit("native worker suite totals disagree")
    if Counter(completed) != Counter(selected):
        sys.exit("native JUnit cases differ from the collected worker suite")


if sys.argv[1:] == ["guest"]:
    check_guest()
elif sys.argv[1:] == ["receipt", "-"]:
    # Readback already bounded, inventoried and hash-checked these bytes.
    args = json.load(sys.stdin)
    check_receipt(args["xml"], args["collection"], args["sourceCommit"], args["imageId"])
elif len(sys.argv) == 5 and sys.argv[1] == "receipt":
    files = Path(sys.argv[2])
    check_receipt((files / "full.xml").read_bytes(), json.loads((files / "collection.json").read_bytes()), *sys.argv[3:])
else:
    sys.exit("usage: check-r4-cld02.py guest | receipt PYTEST_DIR SOURCE IMAGE | receipt -")
