"""Print the counts of a vitest JUnit report with every failed and skipped test by name.

  python scripts/ci-junit-summary.py REPORT [--forbid-skips]

--forbid-skips is for a job whose host has every engine of its tests: there a skip means a test did not run, so it fails the step, as does a missing report.
"""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

report, forbid = Path(sys.argv[1]), '--forbid-skips' in sys.argv[2:]
if not report.is_file():
    print('No integration JUnit report was produced.')
    sys.exit(1 if forbid else 0)
skipped = 0
for suite in ET.parse(report).getroot().iter('testsuite'):
    counts = {key: int(suite.attrib[key]) for key in ('tests', 'failures', 'errors', 'skipped')}
    skipped += counts['skipped']
    print(suite.get('name'), counts)
    for case in suite.findall('testcase'):
        if case.find('failure') is not None or case.find('error') is not None:
            print('  Failed', case.get('name'))
        elif case.find('skipped') is not None:
            print('  Skipped', case.get('name'))
if forbid and skipped:
    print(f'{skipped} test(s) skipped on a host that must run every one of them.')
    sys.exit(1)
