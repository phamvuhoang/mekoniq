You own the scoped B08 fix round1 re-review. Verdict the original Important I1 and inspect the fix diff for new breakage; this is not a repeat full-task or whole-branch review.

Read the task brief: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-brief.md
Read the complete fix report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-fix-1-report.md
Read the main report fix append: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-report.md

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


## Finding under verification (verbatim)
### Important I1 — Semantic study accepts a changed baseline physical input under the same name

**Location:** `source/packages/lab-runtime/src/v2/simulation3d/semantic-study.ts:18` (with the common projection assembled at lines 19–21).

The MuJoCo check only requires `loadProfileRef.id === 'empty'` and `physicsProfileRef.id === 'serve-drive-contact-v1'`. It never validates the referenced load's contents/empty population or the locked baseline physics bytes. `verifiedSimulationInput` verifies the declared file bytes and scene references, but does not establish those profile semantics. Neither reference/content participates in the returned common projection. The stricter registered-profile checks in `verifiedPhysicsInputs` are used only by physics A/B, not this path.

**Confirmed reproduction:** a read-only, in-memory probe loaded the retained clean X01 `study-input.json`, changed MuJoCo `drive-contact-profile.json` `contact.sliding` from 0.6 to 0.99, resealed its `digest`, recalculated its stored-byte hash/size, updated its scene file/ref, resealed the scene, and updated the scene/report identity mirrors. The unmodified IR-SIM/Webots inputs and original declared equivalence remained. `buildSemanticStudy` returned:

```json
{"status":"complete","reasons":[],"accepted":false}
```

The altered profile SHA256 was `ae053bc32b769d4e6d090286487a5eca5c3f9e5e89bc8d6f476b49a6215b069b`; the accepted common projection remained `58cd652a07fd4592503545ae10834780910c9bcd9e429e9de5670aa7b831d1d2`. An initial version without resealing the profile was also accepted. This is an input-admission defect, not a claim that hashes authenticate a producer or that the original recording used that modified profile.

**Impact:** altered material/actuator/numerical settings, or a nonempty/malformed load retaining the admitted name, can be presented as the registered common empty-load/baseline study. The UI then says inputs are equivalent and differences are engine observations even though the consumer did not enforce its declared experiment scope. This misses the task's verified common-input requirement and the report's explicit claim that empty load and baseline registered physics are required. It is not plan-mandated.

**Suggested fix:** verify the closed admitted MuJoCo profile content and self-digest against the registered baseline, and verify the empty-load document/model binding and empty population (including all derived references), before deriving semantic equivalence. Reuse narrowly applicable existing admission helpers or add a shared closed validator; do not simply add a mutable profile name to the common hash. Add fully resealed adjacent-input regressions that reach semantic admission and return `INPUTS_NOT_EQUIVALENT`, preserving the valid clean X01 readback. No native rerun is needed merely to prove rejection of offline altered inputs; any producer change would need its own appropriately scoped evidence.


## Exact fix inputs
FIX BASES (previous reviewed heads): Source709a797fa791727d0a8c830e935e0d80192843b0 / Lab3a904c21bb5805c1f6a4fa3d3bd096873d53ba41.
HEADS: Source922abb77fbd3315038584b63599032db61d1b665 / Lab0e3edb8dab9ad8678fa62c58fd08178ed3298db1 (clean)
DIFFS: Source /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/review-709a797..922abb7.diff (15697 bytes, 1 commit); Lab /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/02-r2b-cell-and-web/review-3a904c2..0e3edb8.diff (3433 bytes, 1 commit)
HANDOFF GATE: Root read full fix report and main append, checked clean final heads, RED8/GREEN50 Source and10 Lab logs, type/check/sync and new final identity/readback audit. Original report25862B prefix hash preserved (7f4c47abf18c2785f7ca640fcf617b879013150dd10e6e65e1d6ab981fc26d1d). Valid study hash remains2738b3ab02c44cad745c53f47ef962d2d89c9f8cb7de90bfe9c69dada42b2412; original native producer709a797 distinct from new validator922abb7. Original211-file audit is non-SQLite byte hashes plus SQLite metadata, not SQLite byte-content proof. No new native/browser execution claimed. Report contains exact commands/results and new evidence paths.

Read the complete supplied fix diff once in bounded passes, including all code/test changes. It carries commit/stat/context. Do not regenerate scope or reread changed files unless a required hunk is cut mid-function, naming why; ask root if package missing. Outside-diff code only one focused check per concrete named dependency risk. Judge code/evidence rather than trusting report rationale. No routine test/native/browser/suite reruns: only a specific unresolved doubt permits one focused test with rationale. Never spawn helpers/subagents. Read-only except your ignored report; no product/Git/index/branch mutation or original evidence/SQLite writes.

Verify closed baseline physics content/self-digest and empty-load population/model/derived bindings before semantic equivalence, not merely names or a caller-resealed common hash. New regressions must demonstrate coherent upstream integrity before semantic rejection, while genuine clean X01 remains valid. Check shared helper semantics for direct fix-introduced regressions, within scope. Existing review1 M1 stale-hash negative-test weakness is deferred in central index; incidental corrections may be noted but unchanged tests are not a new fix loop. Any new breakage from this fix is assessed normally.

## R73 scope ruling
Ruling: B08 fix1 is scoped to offline semantic admission of the registered MuJoCo baseline profile and empty-load content, with fully resealed negative tests and genuine retained clean-X01 readback. Do not repeat native X01 solely for this pure consumer/test fix: the native producer remains Source709a797, while the new validator/export/Lab pin identities are recorded separately and never substituted into old artifacts. Preserve original input/report/recording bytes and write new readback/audit outputs outside that recording. Require focused semantic/physics admission tests, raw actual X01 CLI equality/rejection checks, affected helper tests and clean Source export/Lab pin/type/check/synced-view checks. If producer/compiler/controller/physics/measurement or UI behavior changes, raise the changed boundary for appropriately scoped execution before claiming coverage. Cost if wrong: consumer changes could reject valid old data or affect shared admission semantics; exact actual readback, coherent negative fixtures and independent scoped review guard that risk. Final B10 still records the final all-changes tuple; no new native/performance qualification is claimed in fix1.

Check the actual diff fits that consumer/test boundary and the report preserves producer709a797 versus new validator/export/pin. No retagging, original recording modifications or new native/performance acceptance claim. Read covering command/output evidence and new retained readback/identity mapping. Previous native X01 has one run/engine, nominal cancel/unknown not_run; byte integrity is not producer authenticity or human acceptance.

Write /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-review-2.md. For I1 give ADDRESSED/NOT ADDRESSED with file:line evidence; list new Critical/Important/Minor introduced by fix, separate out-of-scope observations, actual checks/dependency reads and limitations. End with all addressed/no newCriticalImportant or findings remain. Return concise verdict/findings/report path. Root must fill pending fields and read final fix commands/output before dispatch.
