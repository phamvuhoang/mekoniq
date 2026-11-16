# Task brief B00R2 — frozen R2a cloud evidence and qualification baseline refresh

Sequence: after B09 and before L00/final qualification, one engineering implementer only. Do not dispatch until the active task is reviewed and trees clean.

## Global Constraints

- Chỉ bắt đầu implementation phụ thuộc R2a sau B00; không sửa spec/plan/code R2a trong lần soạn tài liệu này.
- Node 24.22.2; pnpm 10.32.1; portable workers Python 3.11; `PYTHONDONTWRITEBYTECODE=1` khi chạy pytest. Python ROS dùng bản của profile distro, không ép rclpy vào venv portable.
- Nền vật lý là engine pin của R2a đã bàn giao; snapshot nghiên cứu là `mujoco==3.17.0`. Không tự nâng lock ở B02.
- Một logical tick 20 ms; 10 substeps × 2 ms là baseline MuJoCo; tốc độ UI chỉ thay pacing.
- Source là authority mission/journal/custody, Lab chỉ simulation/replay. Không thêm Lab→hardware route.
- Một active world MuJoCo/runtime; một ACK đang bay; lost ACK → unknown, không resend hoặc respawn tiếp tục cùng run.
- New fields optional/versioned; mock BV01 golden, IR-SIM chunks, Webots bytes, archive readers và R2a behaviors giữ theo baseline.
- Geometry/units SI và frame đúng contract; dynamics `not_calibrated`; vendor files có commit/sha256/license/NOTICE.
- UI dùng `tr(vi,ja,en)`, giữ a11y/reduced-motion/2D/no-runtime path; không thêm framework/browser engine.
- Không sửa `trial/`, `web/`, cổng 1880/1884, runtime data hoặc evidence lịch sử để vượt gate.
- Mỗi mutation ở đúng repo; source runtime/schema/tool commit → export sạch → Lab re-pin commit. Không Git ở workspace root.
- Candidate tự động luôn `accepted:false`; human sidecar gắn hash/profile; skip là not_run.
- Task chuẩn bị không deploy, provision host trả phí, ký commissioning thật hoặc chạy robot. Các hành động đó cần đích/phạm vi người dùng giao khi thực thi.

## Execution context
All source/ and lab/ paths are relative to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/. Never edit original main checkouts. Read specs at /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical. User authorized implementation on new worktrees on 2026-11-14; original doc-only wording refers to authoring, not current authorization. No push/deploy/native hardware execution. Use Node 24.22.2 and PYTEST_ADDOPTS="-p no:cacheprovider" with PYTHONDONTWRITEBYTECODE=1 for workers.

## Requirements

Frozen upstream source `11d25b47a18adafb88ac21adc249499109996bc5`, Lab `a7449541e118d01f65af0ad1466e0c963a173f3c`. Existing feature branch already merged source4f893ac/Laba6ec316 in B00R. Merge only these frozen heads into the existing codex/web-lab-to-physical worktrees; never merge to main, push, fetch/move source checkout, or modify original recorded evidence. This inherits upstream's superseded-candidate removal in Git history, not rewriting candidates in place.

Read upstream delta through bounded file groups; docs/evidence delta is thousands of files, so do not print full git log --stat. Root compared production groups and found only these non-doc additions: scripts/cloud-run-qualification.mjs, scripts/test-runner.mjs, tests/acceptance/cloud-run.acceptance.test.ts, tests/unit/cloud-run-qualification.test.ts and deploy/lab-runtime/mekoniq.env.example. No packages/robotics runtime change in that upstream range. Confirm this before merging. Keep current B00–B09 runtime/schema/UI changes and pins on conflict; reconcile README as historicalR2a plus activeR2b, no false completedR2b claim.

R2a runtime pin remains4f893ac6fb75dff414a3ee42a726defb7935c734. CloudRun supplement binds exact R2a record SHA; HTTP MJ-BV01 completed4800/served2 and productionChrome completed4810/served2. All acceptedfalse/not_calibrated. These are retained historical records, not evidence of newly builtR2b image. Original qualificationG-CLOUD1blocked_external remains historical, supplementguard records tested. Do not execute smoke.mjs/browser-smoke, readsecrets, callcloud or infer authorization from historical deploymentrecords. No deployment is part of this task.

Run cloudguard focused unit suite and read-only acceptance against the inheritedexactR2a/cloud directories; retain commands/results. Merge resolves source/test-runner additions with any B04/B09changes. No engine/native/browser/full-suite repeat unless a concrete changed seam requires it; exactretainedCloudRun data guards are pure. Check gitdiff whitespace/types as appropriate.

Commit source merge/resolutions, export clean to unique/tmp, import/sync/check:source/typecheck Lab, and commit Lab pin after its frozenupstreammerge. Preserve legacycompatibilityrecord semantics; do not treat historical cloud/platform metadata as current source runtime identity. Source export data keeps transientrecords/secrets excluded.

Report task-B00R2-report.md in this directory: source/Lab BASE+HEAD, frozen commits, merge conflicts/resolutions, unchangedruntime source check, exactcommands/results, export/pin identities, historicalvsnew claim scope, limits/self-review. Controller supplies independent diff review before marking complete. No subagents.

## Root review-packaging inventory clarification
`root-B00R2-upstream-inventory-no-renames.json` is the deterministic frozen upstream file-group inventory. The earlier phrase “only these non-doc additions” refers to platform scripts/tests/deploy; the no-renames inventory also has 16 artifact demo-guide paths, including editable JS/Python/CSS/verifier sources, generated HTML and image/facts/verification assets. Include these as a bounded historical-guide import review surface; do not silently exclude executable presentation sources. No packages/robotics runtime delta. First default-rename inventory emitted a rename-limit warning and is retained separately; use the no-renames inventory for exact counts and keep every import tied to frozen commits. No cloud or native execution occurred in this inventory.

For review of the large frozen import, retain a machine-readable Git tree inventory (path, mode, blob/object ID) tying inherited historical evidence to the exact frozen upstream. Account for incoming deletions/renames with deterministic no-renames paths, and identify any path that also had feature edits or merge conflict resolutions. A bounded summary must not hide mismatches: list them explicitly and explain provenance. This is read-only Git-object integrity, not reopening SQLite, rerunning cloud/native physics or inheriting acceptance for R2b. Keep editable demo-guide source and platform guard/test changes as explicit code-review inputs alongside full original-base packages.

## Controller ruling77 — bounded frozen-import review
Ruling: review B00R2 as a frozen-history import with complete original-base diff packages retained, a full path/mode/blob inventory checked against the frozen upstream, and bounded explicit code/guide/README/guard/pin review packages. Do not manually reread thousands of unchanged historical tick records merely because Git imports them; their exact inherited bytes/deletions and identity-binding manifests/guards must be verified instead. Every executable presentation source, platform change, conflict resolution, feature overlap or historical blob mismatch remains an explicit review input; directory-based filtering alone is insufficient. No new feature/evidence content may be silently omitted. Cost if wrong: an inherited record's old semantic defect may not be rediscovered during this import review; exact upstream equality and retained guard checks establish provenance only, never new R2b qualification or human acceptance. The final branch review still covers all net feature changes and newly produced evidence separately.
