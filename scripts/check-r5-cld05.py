"""CLD05 (R5): admission of the MuJoCo tool-root pytest run inside the linux/amd64 image on a native x86-64 host.

The roster is reviewed source-side (scripts/native-sim/r5-cld05-pytest-roster.txt; regenerate with
`pytest --collect-only -q tests` in robotics/simulation-mujoco when the worker suite intentionally changes).
Only the two comparisons against pre-fix bytes captured on Darwin arm64 may skip on x86-64: R4 CLD02 covered them with
baselines captured on the native host; R5 does not repeat that capture. Every other case must pass.
Prints {"tests", "passed", "skipped"} on success.
"""
from collections import Counter
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

ARM64_ONLY = ("tests/test_worker_protocol_regression.py::test_worker_responses_match_the_pre_fix_wire_bytes",
              "tests/test_drive_engine.py::test_the_legacy_path_gives_the_three_recorded_digests")


def check_receipt(xml, collection, source, image):
    invocation = collection.get("invocationId")
    if (collection.get("schemaVersion") != 1 or collection.get("sourceCommit") != source
            or collection.get("imageId") != image or not re.fullmatch("[a-f0-9]{32}", invocation or "")):
        sys.exit("CLD05 collection identity mismatch")
    roster = (Path(__file__).parent / "native-sim/r5-cld05-pytest-roster.txt").read_text().splitlines()
    selected = collection.get("nodeIds")
    if not isinstance(selected, list) or not selected or Counter(selected) != Counter(roster):
        sys.exit("CLD05 pytest collection differs from the reviewed MuJoCo tool-root roster")
    root = ET.fromstring(xml)
    suites = root.findall("testsuite")
    if root.tag != "testsuites" or len(suites) != 1 or len(root.findall(".//testsuite")) != 1:
        sys.exit("expected one CLD05 pytest suite")
    suite = suites[0]
    for key, value in {"cld02Source": source, "cld02Image": image, "cld02Invocation": invocation}.items():
        if [p.get("value") for p in suite.findall("properties/property") if p.get("name") == key] != [value]:
            sys.exit("CLD05 JUnit identity mismatch: " + key)
    cases = suite.findall("testcase")
    if len(cases) != len(root.findall(".//testcase")):
        sys.exit("unexpected CLD05 JUnit testcase location")
    completed, skipped = [], []
    for case in cases:
        node = case.get("classname", "").replace(".", "/") + ".py::" + case.get("name", "")
        completed.append(node)
        if case.find("error") is not None or case.find("failure") is not None:
            sys.exit("CLD05 tool-root test failed: " + node)
        if case.find("skipped") is not None:
            if not node.startswith(ARM64_ONLY):
                sys.exit("CLD05 tool-root test skipped outside the arm64-only comparisons: " + node)
            skipped.append(node)
    if (suite.get("errors") != "0" or suite.get("failures") != "0" or suite.get("skipped") != str(len(skipped))
            or suite.get("tests") != str(len(cases))):
        sys.exit("CLD05 suite totals disagree")
    if Counter(completed) != Counter(selected):
        sys.exit("CLD05 JUnit cases differ from the collected suite")
    print(json.dumps({"tests": len(cases), "passed": len(cases) - len(skipped), "skipped": sorted(skipped)}))


if sys.argv[1:] == ["receipt", "-"]:
    args = json.load(sys.stdin)
    check_receipt(args["xml"], args["collection"], args["sourceCommit"], args["imageId"])
elif len(sys.argv) == 5 and sys.argv[1] == "receipt":
    files = Path(sys.argv[2])
    check_receipt((files / "full.xml").read_bytes(), json.loads((files / "collection.json").read_bytes()), *sys.argv[3:])
else:
    sys.exit("usage: check-r5-cld05.py receipt PYTEST_DIR SOURCE IMAGE | receipt -")
