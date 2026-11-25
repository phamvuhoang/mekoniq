# Evidence identity and literal reference remediation

Completed 2026-11-05. Test/evidence tooling only; no production behavior changes or commits. Frozen for independent review and root repinning.

## Literal reference resolution

The source-only reference regression reproduced exactly five failures: the three ARM05 expanded fault titles and two SYS03 expanded reorder/delay titles were absent as literal strings. The arm suite now registers four explicit titles against a shared custody/stop helper. Reorder and delay register two explicit titles against their shared observation helper. All original assertions and arm timeouts remain in place. A unit test applies the source-only title-resolution rule to every literal source reference in the acceptance table and specifically requires those five references.

## Recording and acceptance identity

The recorder and acceptance guard share `source/tests/support/regression-identity.ts`, loaded directly by the Node 24 recorder. The source repository must be fully clean and its exact HEAD must match. Lab code must also be clean; its code identity is the hash of tracked tree entries after excluding this explicit evidence/documentation allowlist:

- `docs/**`
- `README.md`
- `config/simulation-compatibility.json`

`config/source-runtime.lock.json` remains code and changes invalidate evidence. Staged, unstaged and untracked files are checked. A regression exposed the subtle staged-change/working-tree-restored case; inspecting both index and worktree fixed that hole.

The recorder captures identity before replacing old output, before and after every command, and at completion. Code dirtiness or either HEAD changing during the recording aborts it. The manifest stores start/end identities and command checkpoints. It states that these are sampled checks, not continuous filesystem monitoring; a change restored entirely between checkpoints is not claimed to be detectable.

Acceptance checks the recorded clean flags, revision linkage, all checkpoints and the presence of before/after checkpoints for every command. It independently recomputes recorded tree hashes and compares them with the current repositories. Later Lab HEAD changes are permitted only when the excluded documentation/evidence paths account for the tree difference; committed or dirty Lab code changes fail. Source remains exact-HEAD and fully clean even for documentation edits.

The recorder accepts `LAB_PYTHON` as an absolute executable path or one relative to source, preserving `.venv/bin/python` as its default. Missing Python still records `source-pytest` as not run. Host metadata records the selected executable and its actual `--version` output. Root owns environment installation and will use `.lab/plan01-python312/bin/python`.

## Validation

- Source focused suites: `lab-regression-identity`, `lab-evidence-literal-refs`, `lab-v2-arm-faults`, `lab-v2-software-gaps` — **23 tests passed**, 4 files, 42.84 s.
- Identity cases cover dirty source/Lab code, dirty index despite restored worktree, clean mid-run revision change, sampled temporary code changes, allowed documentation outputs and later documentation commits, current committed Lab code staleness, runtime lock changes, exact source HEAD/cleanliness, recorded dirty Lab state and missing checkpoints.
- Source `pnpm typecheck` — passed after correcting the manifest command intersection type.
- Targeted ESLint on all changed source files — passed.
- Native Node 24 import of the shared TypeScript helper — passed.
- `node --check lab/scripts/record-regression.mjs` — passed after the Python override addition.
- Both repositories' `git diff --check` — passed.

The full recorder and stored-result acceptance are intentionally left to root after code commits and repinning. No regression export was started or overwritten in this task. The measurement acceptance branch and browser/performance tests remain owned by `fix_lab`; its debugger-paused SYS01 wording was preserved.
