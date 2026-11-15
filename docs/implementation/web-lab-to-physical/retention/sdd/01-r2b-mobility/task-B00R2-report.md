# B00R2 implementation report

Status: implemented and committed; awaiting the controller’s independent diff/provenance review. No R2b qualification or human acceptance is claimed. Both feature worktrees are clean. One engineering implementer; no helpers/reviewers dispatched.

## Bases, frozen refs and final heads

| Repository | Reviewed feature BASE | Prior frozen upstream | Imported frozen upstream | Final HEAD |
| --- | --- | --- | --- | --- |
| source | `3c917ceee6a92c6b087f0bd37baaa4e0740d44a8` | `4f893ac6fb75dff414a3ee42a726defb7935c734` | `11d25b47a18adafb88ac21adc249499109996bc5` | `d0f30749c0ddb474f0844c68be63a6f0fa4b1933` |
| lab | `538ba452c81005010a479f337aab0edbad6e5159` | `a6ec316fb3ac2f71afff25e6fa77e931f4439e00` | `a7449541e118d01f65af0ad1466e0c963a173f3c` | `176bf348b6a839037473cc6d87413093ed17ff54` |

Existing worktrees only: `/Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/{source,lab}`, branch `codex/web-lab-to-physical`. No fetch, main checkout/merge, original-checkout mutation, push, deployment, secret inspection, cloud call, native/engine/browser/Docker execution or robot route. Read-only Git objects and recorded-data guards only.

Commits:

- Source merge `d0f30749c0ddb474f0844c68be63a6f0fa4b1933` (`chore: merge frozen R2a qualification and cloud guards`), parents the exact Source BASE and frozen head above.
- Lab frozen merge `3a085654ab10f44f30af44e566804108cef67f25` (`chore: merge frozen R2a regression evidence`), parents the exact Lab BASE and frozen head above.
- Lab re-pin `176bf348b6a839037473cc6d87413093ed17ff54` (`chore: pin source runtime d0f3074`), parent the Lab frozen merge.

## Bounded upstream and content audit

Confirmed before merging with deterministic `git diff --no-renames` over the exact prior/frozen refs: Source has 8,841 paths: 4,465 added, 4,371 deleted, 5 modified. Of these, 8,820 are docs, 16 artifact guide paths, and 5 platform script/test/deploy paths. Lab has 229 docs paths: 116 added and 113 deleted. There is no upstream `packages/` or `robotics/` delta, and neither repository has a path edited both by this frozen delta and the existing feature work. Both `git merge --no-ff --no-commit <frozen>` operations applied cleanly. **Conflicts: none. Resolutions: none.**

Explicit platform review inputs (all exact frozen blobs):

- `scripts/cloud-run-qualification.mjs`: stored-byte/checksum guard, binds exact R2a qualification SHA and original source/Lab/schema/artifact identity; requires recorded revision/image/health, terminal jobs, no plant stop/attention, stream through cursor and archived runs; never invokes cloud/deploy.
- `scripts/test-runner.mjs`: only adds the `cloud-run` acceptance alias, retaining all existing suite/software-only/load behavior. No competing B04/B09 change exists at this path.
- `tests/unit/cloud-run-qualification.test.ts`: pure in-memory fixtures and semantic/hash tampering checks.
- `tests/acceptance/cloud-run.acceptance.test.ts`: reads the explicitly selected retained directories, applies original qualification and Cloud Run guards; no producer script is executed.
- `deploy/lab-runtime/mekoniq.env.example`: historical R2a project/origin/secret-reference and image digest example, retained unchanged; it is not a current R2b image identity or authorization.

Explicit historical guide review surface:

- `artifacts/README.md` — `M`, mode `100644`, blob `9ab1ade28feee9c3fcfc3512d2d8ad1c1144d911`.
- `artifacts/mekoniq-r2a-demo-guide.html` — `A`, mode `100644`, blob `484f39a5354302cf13f3db8c21fbcdec95d36585`.
- `artifacts/src/r2a-demo-guide/README.md` — `A`, mode `100644`, blob `9ecc79ae117874eebfe1d95dc191a2d71dd9ef6d`.
- `artifacts/src/r2a-demo-guide/app.js` — `A`, mode `100644`, blob `ea300af6e32a5c34e789ef2eeeb2882b4a53fc4a`.
- `artifacts/src/r2a-demo-guide/build-manifest.json` — `A`, mode `100644`, blob `ba9ad37ec49077f819085b2c038592e3f0bc4617`.
- `artifacts/src/r2a-demo-guide/build.py` — `A`, mode `100644`, blob `194d7a79b216d34e2e41526127a4d87f0909910f`.
- `artifacts/src/r2a-demo-guide/desktop-preview.png` — `A`, mode `100644`, blob `a491ef0dd1c2519bccf8850bf4337be40f9983a4`.
- `artifacts/src/r2a-demo-guide/facts.json` — `A`, mode `100644`, blob `a089a28fb8732bfb021c7c8ad89973a52865d8f9`.
- `artifacts/src/r2a-demo-guide/images/arm.png` — `A`, mode `100644`, blob `3b507f394f603fd575b59d8d40420a1372a1091d`.
- `artifacts/src/r2a-demo-guide/images/joints.png` — `A`, mode `100644`, blob `7d2d5aeffc4daa69a38ee7c66de4f39cee3eacf5`.
- `artifacts/src/r2a-demo-guide/images/replay.png` — `A`, mode `100644`, blob `979b14a41fe80fc1ff9395499b6e93ce86787052`.
- `artifacts/src/r2a-demo-guide/images/watch.png` — `A`, mode `100644`, blob `930b6d92e86f403011ef81fc850bd18020ac66c3`.
- `artifacts/src/r2a-demo-guide/mobile-preview.png` — `A`, mode `100644`, blob `4d11f6a54306a676845021c31be53d7e9480b4e1`.
- `artifacts/src/r2a-demo-guide/style.css` — `A`, mode `100644`, blob `2ac11bb021e897eab86a8f06ba9b806cbb734b24`.
- `artifacts/src/r2a-demo-guide/verification.json` — `A`, mode `100644`, blob `57b75ff6c88c85ec5ad7d9937132c5b08d60aeed`.
- `artifacts/src/r2a-demo-guide/verify.cjs` — `A`, mode `100644`, blob `51d2e04203ad0682bd6a5587cbc326358963f8f0`.

Manually inspected JS interaction code, Python builder flow, CSS, verifier, guide README, build/facts identity bindings and generated HTML/static checks. JS changes only the offline guide (language/localStorage, route tabs/keyboard focus, copy fallback, checklist, lightbox, print); it has no runtime/cloud calls. Builder uses `tr(vi,ja,en)`, embeds images/CSS/JS, checks image hashes and runs `bash -n` for displayed command syntax; it was parsed, not executed. CSS retains responsive, print, no-JS and reduced-motion rules. Verifier’s `--static` path checks artifact/input/original screenshot hashes, translations, recorded production identities, links, offline dependencies and displayed command syntax, and exits before browser launch. Its new static receipt was moved into task evidence; historical `verification.json`, previews, sources, facts and generated HTML were never rewritten. Browser verification is an inherited record, not a new run.

Other modified upstream docs reviewed: `docs/operations/lab-runtime-cloud-run.md` (historical R2a operations/deployment/guard scope) and `docs/superpowers/plans/2026-11-12-realistic-arm-web-ui/04-qualification.md` (historical completion and supplemental cloud guard). Neither is execution authorization.

## Exact Git-object provenance, deletions and mismatches

Machine-readable inventories retain path, mode, kind, blob/object ID for prior upstream, frozen upstream, reviewed feature BASE and final HEAD, including missing/deleted paths and feature-only paths. No rename inference is used. `inventory.py` deterministically regenerates them from the fixed refs.

- `evidence-B00R2/source-inventory-before.json`, `source-inventory-after.json`
- `evidence-B00R2/lab-inventory-before.json`, `lab-inventory-after.json`
- `evidence-B00R2/provenance-summary.json`, `inventory-after-summary.jsonl`

Incoming Source deletions: candidate-08 (1,604 paths), r1-candidate-06 (2,589), r11-candidate-03 (25), r2a-candidate-01 (153). They are inherited deletions, retained in Git history. Lab replaces the 113-path historical `regression/` with 113-path `regression-02/` and adds 3 mock-acceptance-02 files. Full per-path deletions and blob IDs are in the inventories. No candidate was edited to bypass a gate.

**All inherited historical evidence and all 16 guide paths match the exact frozen mode/object, with all incoming deletions absent as frozen.** Every upstream path is accounted for; the only intentional mismatch and all feature-only changes are listed below. No unlisted mismatch exists.

| Repository/path | Frozen/prior provenance | Final provenance | Explanation |
| --- | --- | --- | --- |
| source/docs/implementation/README.md | frozen `100644 e2d58e682eea3e17b449605dca22dc0c84861659` | final `100644 e20309c6d7a69ea92121723eee677bcc362c43f1` | Deliberate additive README reconciliation: retained R2a records vs active B00–B09 R2b, authoritative current pin, null image, WEB05 not_run, no current cloud/native claim. No evidence content changed. |
| lab/README.md | feature BASE `100644 3afafd31fa8a366412d1b7dc2cadecde4d67c1b3` | final `100644 aced292e394370ecf5a2328f5fe2094f7683b4e0` | Additive R2a/R2b identity/authority/status note. |
| lab/config/source-runtime.lock.json | feature BASE `100644 933ff48e2b1ddf927220712665c096faa9447152` | final `100644 6528ccd7806dbeaeb78c3327f276e457bdbc6b40` | Current Source commit/artifact pin only; schema/protocol/tools unchanged. |
| lab/src/shared/engineering.ts | feature BASE `100644 862836905c2d96229e8f1e8caf496b72ac7d3c7c` | final `100644 b663dcfe7ebe153ff3c9c49b17da8cefdf0fd474` | Generated provenance header commit only; generated body byte-identical. |
| lab/src/shared/navigation2d.ts | feature BASE `100644 32addf5faadd3f64ddec8bc3c873868f293d275e` | final `100644 ffa1345b3d0e6db90ebc1611a19c89506e8c8761` | Generated provenance header commit only; generated body byte-identical. |

All other feature-only paths remain exactly the reviewed feature BASE blobs/modes. Source `git diff --no-renames <BASE> HEAD -- packages robotics apps integrations` is empty, as is Lab legacy `config/simulation-compatibility.json`. Thus B09 data-root lease before provider preparation, writer/epoch ownership, run-ID cold-reclaim reservation and retained-state validation remain unchanged, as do all B00–B09 runtime/schema/UI behaviors. No campaign repeat is needed for an unchanged seam.

Complete original-base patches are retained, including binary changes (`--binary --full-index --no-renames`):

- `evidence-B00R2/source-original-base.diff`: 530,076,779 bytes, SHA-256 `4b5433d2559e2ba17dc733930d55dd411fbaf9098a334a50831b67a8d2b661e2`.
- `evidence-B00R2/lab-original-base.diff`: 25,888,473 bytes, SHA-256 `70a10f742aa34cc3e7873605398dd81ff2c087707c3ffd4b87ac6873c485c1d6`.
- `evidence-B00R2/source-platform-original-base.diff`: 19,798 bytes, SHA-256 `5193e53d24b9b5813baaafd025f35438fb16a23e9c490cc5bfbb9d60e71f2a0c`.
- `evidence-B00R2/source-guide-original-base.diff`: 1,243,191 bytes, SHA-256 `94773db2b8432843b27c5c66dd015803a6ee8b7eac22fbd6e9190d89722dc34a`.
- `evidence-B00R2/source-runtime-original-base.diff`: 0 bytes, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `evidence-B00R2/lab-pin.diff`: 2,624 bytes, SHA-256 `82beceead93ffa3bc68d41eff40129eef58aa8f1ffcd5b00b921fa57b2eab47d`.

These are review inputs alongside exact Git objects, not replacement evidence. Source full patch is approximately 530 MB; the separate platform and editable-guide patches keep code review bounded without excluding the full original-base patch.

## Fresh verification and exact commands

Node `v24.22.2`, pnpm `10.32.1`. `run.py` prepends `/Users/hoangpham/.nvm/versions/node/v24.22.2/bin` to PATH and sets `PYTHONDONTWRITEBYTECODE=1`, `PYTEST_ADDOPTS=-p no:cacheprovider`. Each entry below has exact argv/cwd/environment/exit status in `<label>.command.json` and unabridged output in `<label>.log`. Long runs use the shown Perl alarm. No pytest/engine/native/browser campaign was run.

| Evidence label | Exact command (cwd recorded beside log) | Result |
| --- | --- | --- |
| `toolchain` | `node --version` | exit 0; passed |
| `pnpm-version` | `pnpm --version` | exit 0; passed |
| `cloudguard-unit` | `perl -e 'alarm 120; exec @ARGV' pnpm test:unit -- tests/unit/cloud-run-qualification.test.ts` | exit 0; 24/24 passed |
| `cloudguard-acceptance` | `env LAB_CLOUD_EVIDENCE_DIR=docs/implementation/evidence/cloud-run/mekoniq-2026-11-14 LAB_SIMEXT_EVIDENCE_DIR=docs/implementation/evidence/sim-extension/r2a-candidate-02 perl -e 'alarm 120; exec @ARGV' pnpm test:acceptance -- cloud-run` | exit 0; 1/1 passed; original R2a unchanged, accepted:false |
| `source-typecheck` | `perl -e 'alarm 180; exec @ARGV' pnpm typecheck` | exit 0; route types generated + tsc passed |
| `source-changed-lint` | `perl -e 'alarm 120; exec @ARGV' pnpm exec eslint scripts/cloud-run-qualification.mjs scripts/test-runner.mjs tests/acceptance/cloud-run.acceptance.test.ts tests/unit/cloud-run-qualification.test.ts` | exit 0; changed platform scripts/tests lint passed |
| `guide-static` | `perl -e 'alarm 60; exec @ARGV' node artifacts/src/r2a-demo-guide/verify.cjs --static` | exit 0; passed:true; static checks only |
| `guide-js-syntax` | `node --check artifacts/src/r2a-demo-guide/app.js` | exit 0; passed |
| `guide-verifier-syntax` | `node --check artifacts/src/r2a-demo-guide/verify.cjs` | exit 0; passed |
| `guide-builder-syntax` | `python3 -B -c 'import ast,pathlib; ast.parse(pathlib.Path("artifacts/src/r2a-demo-guide/build.py").read_text()); print("builder AST parses; not executed")'` | exit 0; passed |
| `source-whitespace-focused-final` | `git diff --cached --no-renames --check -- scripts tests deploy artifacts docs/implementation/README.md` | exit 0; passed |
| `source-export` | `perl -e 'alarm 120; exec @ARGV' node scripts/export-lab-runtime.mjs /tmp/mekoniq-b00r2-5hng4re0/runtime` | exit 0; clean export, dirty:false |
| `lab-import` | `perl -e 'alarm 120; exec @ARGV' node scripts/import-runtime.mjs /tmp/mekoniq-b00r2-5hng4re0/runtime` | exit 0; passed |
| `lab-sync` | `node scripts/sync-engineering-contracts.mjs` | exit 0; engineering/navigation/Serve sync; only two provenance headers changed |
| `lab-check-source` | `perl -e 'alarm 120; exec @ARGV' pnpm check:source` | exit 0; verified exact current commit/schema/protocol |
| `lab-typecheck` | `perl -e 'alarm 120; exec @ARGV' pnpm typecheck` | exit 0; passed |
| `lab-pin-whitespace` | `git diff --no-renames --check` | exit 0; passed |
| `export-audit` | `python3 -B .superpowers/sdd/01-r2b-mobility/evidence-B00R2/export-audit.py` | exit 0; normalized bundle/schema/native/portable identities equal B09 |

Whitespace caveat: full Source `git diff --cached --no-renames --check` returned 2 with 198 inherited whitespace findings across 12 log paths. Lab frozen-import check returned 2 with 1 finding in 1 inherited log. `source-whitespace-summary.json` / `lab-whitespace-summary.json` enumerate every affected path and prove each index blob equals frozen upstream. Their full outputs are retained. Do not normalize these checksum-bound historical bytes. Focused changed-code/artifact/README checks and Lab pin whitespace checks passed. An initial default-rename whitespace check also emitted the Git rename-limit warning; the subsequent deterministic no-renames checks supersede it. No production code/test/type failure occurred. A local export-audit draft initially read the minimal Lab lock as though it contained the full manifest; corrected audit reads the archived manifest, then passes all assertions without any repository change.

Mutation command log:

```sh
git -C <source-worktree> merge --no-ff --no-commit 11d25b47a18adafb88ac21adc249499109996bc5
git -C <lab-worktree> merge --no-ff --no-commit a7449541e118d01f65af0ad1466e0c963a173f3c
git -C <source-worktree> add docs/implementation/README.md
git -C <source-worktree> commit -m 'chore: merge frozen R2a qualification and cloud guards'
git -C <lab-worktree> add README.md
git -C <lab-worktree> commit -m 'chore: merge frozen R2a regression evidence'
# clean Source export -> Lab import/sync/check/typecheck commands are exact above
git -C <lab-worktree> add config/source-runtime.lock.json src/shared/engineering.ts src/shared/navigation2d.ts
git -C <lab-worktree> commit -m 'chore: pin source runtime d0f3074'
```

`source-merge.log`, `lab-merge.log`, `source-commit.log`, `lab-merge-commit.log`, `lab-pin-commit.log` retain outputs. `final-state.json` records clean status, exact heads, frozen ancestry, empty conflicts/runtime diff, unchanged legacy compatibility and header-only generated edits.

## Export, current pin and historical identity

Clean export: `/tmp/mekoniq-b00r2-5hng4re0/runtime`. It contains only manifest, bundled runtime and 56 schema files; no transient records, data roots, credentials, evidence producer state or secrets. `export-integrity.json` lists every exported path.

- Current Source commit: `d0f30749c0ddb474f0844c68be63a6f0fa4b1933`.
- Artifact SHA-256: `dd30b291d0211de31dcee2a5a3e659b355e6501677d9fce08abed3788eb857b7` (recomputed from runtime bytes).
- Schema hash: `53af7456cbdfec26685f902484865f8a43d64edcf63624f41f37701db2ccb8a9` (unchanged).
- Portable tools digest: `a9887059ec3cb0ccbb88e2082ef5132625678fdf622ea0d6bd615162a14017f9` (unchanged).
- Native tools digest: `ab7de1fed27fc4cc09b75b6e4899479d16dc578cbf9b3224bf24d332b4e8d396` (unchanged; files only, no native execution).
- Previous B09 artifact: `18967bcf397be1e1d43ca86fae2cdae3558be90772981c9c112b071ff54aabae`. Substituting the embedded current Source commit back to the B09 commit makes the runtime bytes exactly equal to that previous artifact. The new artifact identity is due solely to the embedded commit ID.
- Lab import verified the clean manifest, installed the artifact and retained the previous pin in ignored rollback state. Current lock schema/protocol/tools did not change; two generated files changed only their Source commit comment.

Retained R2a qualification SHA-256: `5db76df9886b96df37e1a335d285b42b3e9f8dd5d21ef2df542a1a5fa82a84ad`, identical to deployment’s qualification binding. Historical runtime stays `4f893ac6fb75dff414a3ee42a726defb7935c734`; recorded Lab stays `a6ec316fb3ac2f71afff25e6fa77e931f4439e00`. The original G-CLOUD1 remains `blocked_external`, accepted:false, CL01 not_run in that legacy format. Supplemental guard validates its own immutable Cloud Run directory, with final `cl01-attempt-03` HTTP MJ-BV01 completed tick 4800, served 2, wallMs 71313. Retained production Chrome completed tick 4810, served 2, wallMs 78411. These are historical producer results; this task only checks stored records. All acceptance remains false; plant remains not_calibrated. `retained-record-scope.json` captures the selected identity/result fields.

## Limits and self-review

- R2b image remains **null/unbuilt**, WEB05 **not_run** per R76. No inference from historical R2a deployment image or host metadata to current runtime identity, nativeReady, R2b image availability, performance, commissioning or acceptance.
- No new HTTP smoke, production browser run, cloud authorization, deploy, native workload, Docker attempt, engine run or full suite. Focused pure guards and type/static checks cover the actual imported code boundary.
- Full inventory equality replaces rereading/replaying thousands of raw tick files; no SQLite databases were reopened. Inventory mismatches are fully listed above. Incoming historical deletions preserve superseded records in Git history.
- Root supplies independent review of full original-base packages, categorized code, guide sources, README mismatch and pin changes before marking task complete. Worktrees and report are preserved for that review. No push or merge to main.

All retained evidence-file SHA-256 values and byte sizes are indexed in `evidence-B00R2/checksums.json`. Task report/working evidence live under ignored `.superpowers/` by the established workflow; implementation commits remain clean.
