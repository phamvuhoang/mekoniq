"""Index retained reviews for final documentation; does not infer verdicts."""
from pathlib import Path
import hashlib
import json

workspace = Path(__file__).resolve().parent.parent
plans = ['README', '01-r2b-mobility', '02-r2b-cell-and-web', '03-r3-linux-readiness']
records = []
for plan in plans:
    for path in sorted((workspace / plan).glob('task-*review*.md')):
        content = path.read_bytes()
        text = content.decode()
        records.append({
            'path': path.relative_to(workspace).as_posix(),
            'bytes': len(content),
            'sha256': hashlib.sha256(content).hexdigest(),
            'findingNavigation': [
                {'line': number, 'text': line}
                for number, line in enumerate(text.splitlines(), 1)
                if line.startswith('#') and any(word in line.lower() for word in ['finding', 'minor', 'important', 'critical', 'assessment', 'verdict', 'scope', 'cannot'])
            ],
        })
output = {
    'schema': 'controller-review-retention-index/1',
    'scope': plans,
    'purpose': 'Content identities and navigation only. Read full reviews and progress-ledger dispositions; headings are not verdict extraction or a substitute for final triage.',
    'retentionRequirement': 'Version all applicable full review reports, implementer reports, decisions and deferred dispositions before SDD cleanup. Regenerate after subsequent tasks. Preserve old evidence identities and exact Git range/argv/hash for large reproducible diff packages.',
    'reviews': records,
    'legacyLedgerOnly': [
        {'ledger': '01-r2b-mobility/progress.md', 'line': number, 'text': line}
        for number, line in enumerate((workspace / '01-r2b-mobility/progress.md').read_text().splitlines(), 1)
        if line.startswith('Task B00: complete (') or line.startswith('Task B01: complete.')
    ],
    'legacyLedgerOnlyLimit': 'B00/B01 independent-review verdicts survive in these ledger entries. No standalone full review report for those two tasks was found in the current scoped review-file inventory. Preserve the original records; do not fabricate a retrospective report or claim this index recreates one. Final whole-branch review covers their net feature changes.',
}
target = workspace / 'README/root-review-retention-index.json'
target.write_text(json.dumps(output, indent=2) + '\n')
print(json.dumps({'reviews': len(records), 'reviewBytes': sum(row['bytes'] for row in records), 'output': str(target)}))
