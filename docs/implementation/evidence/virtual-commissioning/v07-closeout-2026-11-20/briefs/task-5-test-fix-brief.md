# Task 5 test-only correction (queued; root must release frozen source first)

Only file: source/tests/unit/drive-fixture.test.ts. Full source unit at clean b74755e9 passed1249/1250; the sole failure is its literal13-document count after Task3 added two explicit control profiles. Authentic RED log: /tmp/r4-v07-closeout-record/source-b74755e9/unit.log. Hosted CI independently reports the same sole newly introduced failure.

Replace the count assertion with the following exact expected sorted file inventory (sort the actual names too); retain all digest, assumed-source and not_calibrated assertions, generator byte equality and manifest checks unchanged. Do not rewrite any fixture, generator, historical manifest, numeric tolerance or production module.

```ts
expect(names.sort()).toEqual(["control-oracle-v1.json", "serve-control-legacy-ideal-v1.json", "serve-control-v1.json", "serve-control-v2.json", "serve-drive-coarse-encoder-v1.json", "serve-drive-ideal-v1.json", "serve-drive-latency-v1.json", "serve-drive-nominal-v1.json", "serve-drive-torque-limited-v1.json", "tuning-envelope-v1.json", "xarm6-control-v1.json", "xarm6-drive-coarse-encoder-v1.json", "xarm6-drive-ideal-v1.json", "xarm6-drive-latency-v1.json", "xarm6-drive-nominal-v1.json"]);
```

Use Node24.22.2/pnpm10.32.1. Run the unchanged test first if new evidence is needed, then all7 tests in this file, typecheck and focused lint. Commit only the test file, e.g. `test: cover versioned mobile control profiles in fixture inventory`. This is outside runtime/schema/portable inputs: no Lab repin needed. Root runs final full source unit after this committed correction and retains runtime qualification at immutable b74755e9.

Do not start or edit until root explicitly releases the source recording freeze and confirms that no other implementation agent is editing. No subagents, no push, no deploy. Report exact commit, RED/GREEN logs and source scope at task-5-test-fix-report.md next to this brief.
