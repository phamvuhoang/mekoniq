"""Print a vitest JUnit report by test name, and check it against a manifest of the cases a job must account for.

  python scripts/ci-junit-summary.py REPORT                                      counts, with every failed and skipped test; always exit 0
  python scripts/ci-junit-summary.py REPORT --expect MANIFEST [--physical-mac]   exit 1 unless every case is as the manifest says

On the hosted macOS VM (--expect): each `required` case passed, each `physicalMac` case is there and skipped, and there is no other case.
On a physical Mac (--physical-mac): each `physicalMac` case passed and nothing failed.
"""
import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

args = argparse.ArgumentParser()
args.add_argument('report', type=Path)
args.add_argument('--expect', type=Path)
args.add_argument('--physical-mac', action='store_true')
a = args.parse_args()
if a.physical_mac and not a.expect:
    args.error('--physical-mac needs --expect')
if not a.report.is_file():
    print('No integration JUnit report was produced.')
    sys.exit(1 if a.expect else 0)

cases = {}  # "file > name" -> the statuses reported under that name
for suite in ET.parse(a.report).getroot().iter('testsuite'):
    if not a.expect:
        print(suite.get('name'), {key: int(suite.attrib[key]) for key in ('tests', 'failures', 'errors', 'skipped')})
    for case in suite.findall('testcase'):
        failed = case.find('failure') is not None or case.find('error') is not None
        status = 'Failed' if failed else 'Skipped' if case.find('skipped') is not None else 'Passed'
        cases.setdefault(f"{suite.get('name')} > {case.get('name')}", []).append(status)
        if not a.expect and status != 'Passed':
            print(' ', status, case.get('name'))
if not a.expect:
    sys.exit(0)

manifest = json.loads(a.expect.read_text())
required, physical = manifest['required'], manifest['physicalMac']
wanted = {name: 'Passed' for name in physical} if a.physical_mac else {**{name: 'Passed' for name in required}, **{name: 'Skipped' for name in physical}}
problems = []
for name, want in wanted.items():
    got = cases.get(name)
    print(f"{'/'.join(got) if got else 'Missing':8} {name}" + (' [physical Mac]' if name in physical else ''))
    if got != [want]:
        problems.append(f"{name}: expected {want}, got {'/'.join(got) if got else 'no such case'}")
for name, got in cases.items():
    if name in wanted:
        continue
    if 'Failed' in got:
        problems.append(f'{name}: Failed')
    elif not a.physical_mac:
        problems.append(f'{name}: not in the manifest')
passed = sum(cases.get(name) == ['Passed'] for name in (physical if a.physical_mac else required))
print(f'{passed}/{len(physical if a.physical_mac else required)} cases this host must run passed.')
if not a.physical_mac:
    print(f'{len(physical)} cases are not run here; they need a physical Mac.')
for problem in problems:
    print('PROBLEM', problem)
sys.exit(1 if problems else 0)
