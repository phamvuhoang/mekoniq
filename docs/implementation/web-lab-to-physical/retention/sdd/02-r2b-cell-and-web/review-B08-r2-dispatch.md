You own the scoped B08 fix round2 re-review. Verdict the original Important I1 and inspect the fix diff for new breakage; this is not a repeat full-task or whole-branch review.

Read the task brief: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-brief.md
Read the complete fix report: /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-fix-2-report.md
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


## Finding under verification (verbatim from scoped review2)



The original changed-baseline-profile reproduction is addressed. `packages/lab-runtime/src/v2/simulation3d/semantic-study-profiles.ts:10`–`15` binds the registered profile reference/file, verifies its self-digest, and requires the locked baseline stored-byte SHA256. Lines 16–20 validate the registered empty-load reference, closed load schema/semantics/self-digest, zero population and registered shape. `semantic-study.ts:16` invokes this admission before deriving equivalence. New coherent mutation tests at `tests/unit/semantic-study.test.ts:77` verify generic upstream admission before requiring semantic rejection; the provided retained-X01 readback also proves unchanged valid output.

**Remaining Important admission gap: require the bound document to be a physical model.** At `packages/lab-runtime/src/v2/simulation3d/semantic-study-profiles.ts:22`, `validateNavigationDocument(model).ok` accepts any supported navigation document type. The `RobotPhysicalModelV1` generic cast on line 21 has no runtime effect. The validator dispatches by the supplied `documentType` (`navigation2d/contracts.ts:153`–`164`); a valid `navigation-model-2d` document has the same `robotId`, `inputs` and `modelDigest` fields tested here. Its schema explicitly identifies that different type (`packages/contracts/schemas/navigation-model-2d-v1.schema.json:11`). Consequently the check does not establish that `empty.modelRef` names a validated `robot-physical-model`, as the fix report claims.

I confirmed this with the one allowed focused read-only probe, using actual retained clean-X01 input and the current validator. Command shape was Node24 `node --input-type=module` with `tsImport` of `sealDocument`, `buildSemanticStudy`, `verifiedSimulationInput`, and the existing test `artifact` helper. It read `/tmp/mekoniq-b08-x01-final-709a797-20261115-0110/study-input.json` and made these changes only in memory:

1. Store a clone of the original valid MuJoCo navigation model (document type `navigation-model-2d`) at `physical-model/amr-1.json`, replacing the physical document. Recalculate its stored-byte ref and scene file entry.
2. Rebind and reseal `empty.json.modelRef` to those bytes; update its scene engine reference.
3. Rebind the scene robot navigation model's `physicalModelDigest` to the substituted document's `modelDigest`, reseal the navigation model and its declared artifact copies, then reseal the scene and both scene artifact copies.
4. Recalculate navigation report scene/model/profile references, manifest scene identity and physics manifest scene/profile identity mirrors; recalculate the physics manifest artifact hash and report stored-byte ref. Retain the original common equivalence declaration.

Actual stdout, exit 0:

```text
upstream integrity passed
{"substitutedDocumentType":"navigation-model-2d","status":"complete","reasons":[],"accepted":false}
```

`verifiedSimulationInput` passed before `buildSemanticStudy` returned this result. This does not rely on a stale outer seal. It is an offline input-admission defect: a nonphysical document can supply the claimed physical model binding while the consumer still declares the empty-load/baseline experiment complete. It makes no producer-authenticity or historical-recording claim.

Require `model.documentType === 'robot-physical-model'` before accepting the generic validator result (or use a validator narrowed to that type). Add this coherent replacement/rebinding case as a regression that first passes generic upstream integrity and then returns `INPUTS_NOT_EQUIVALENT` with the model-binding reason. The current eight negatives test changed load-model path/hash, but not a coherent replacement of the referenced document. This remains within ruling73's offline consumer boundary; no native rerun is justified solely by this correction.


## Exact fix inputs
FIX BASES (previous reviewed heads): Source922abb77fbd3315038584b63599032db61d1b665 / Lab0e3edb8dab9ad8678fa62c58fd08178ed3298db1.
HEADS: Source714e37f9b8251663c3d7a3d3e668a0c35ca2d493 / Lab4741edfcda3b421197235c50daed7c09b340bedf (both clean)
DIFFS: Source /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/review-922abb7..714e37f.diff (11292 bytes, 1 commit); Lab /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/lab/.superpowers/sdd/02-r2b-cell-and-web/review-0e3edb8..4741edf.diff (3433 bytes, 1 commit)
HANDOFF GATE: Root read full fix2 report and main append; clean heads verified, original pre-append report prefix preserved. Checked explicit EXIT_CODE=0 logs for51 focused Source/10 Lab, type/lint/contracts and pin/sync; final readback-audit hash b55e0f19caf81fe8c61ec10c1c70ca3678f908053a1dc2d187e03c10f15a8892 matches file. Valid study remains2738b3...;9 coherent mutants rejected, producer709a797 separate from validator714e37f. New identity file under evidence-B08/fix2; native/browser not rerun per R73. First readback child statusnull attempt preserved incomplete; report correctly says exact cause unproven, not a confirmed timeout merely from that status. Final diagnostic readback explicitly succeeded.

Read the complete supplied fix diff once in bounded passes, including all code/test changes. It carries commit/stat/context. Do not regenerate scope or reread changed files unless a required hunk is cut mid-function, naming why; ask root if package missing. Outside-diff code only one focused check per concrete named dependency risk. Judge code/evidence rather than trusting report rationale. No routine test/native/browser/suite reruns: only a specific unresolved doubt permits one focused test with rationale. Never spawn helpers/subagents. Read-only except your ignored report; no product/Git/index/branch mutation or original evidence/SQLite writes.

Verify the remaining physical-model runtime discriminator and fully rebound document-type negative before semantic equivalence. Preserve the previously closed baseline physics/content/self-digest and empty-load population/model/derived bindings. New regressions must demonstrate coherent upstream integrity before semantic rejection, while genuine clean X01 remains valid. Check shared helper semantics for direct fix-introduced regressions, within scope. Existing review1 M1 stale-hash negative-test weakness is deferred in central index; incidental corrections may be noted but unchanged tests are not a new fix loop. Any new breakage from this fix is assessed normally.

## R73 scope ruling
Ruling: B08 fix1 is scoped to offline semantic admission of the registered MuJoCo baseline profile and empty-load content, with fully resealed negative tests and genuine retained clean-X01 readback. Do not repeat native X01 solely for this pure consumer/test fix: the native producer remains Source709a797, while the new validator/export/Lab pin identities are recorded separately and never substituted into old artifacts. Preserve original input/report/recording bytes and write new readback/audit outputs outside that recording. Require focused semantic/physics admission tests, raw actual X01 CLI equality/rejection checks, affected helper tests and clean Source export/Lab pin/type/check/synced-view checks. If producer/compiler/controller/physics/measurement or UI behavior changes, raise the changed boundary for appropriately scoped execution before claiming coverage. Cost if wrong: consumer changes could reject valid old data or affect shared admission semantics; exact actual readback, coherent negative fixtures and independent scoped review guard that risk. Final B10 still records the final all-changes tuple; no new native/performance qualification is claimed in fix1.

Check the actual diff fits that consumer/test boundary and the report preserves producer709a797 versus new validator/export/pin. No retagging, original recording modifications or new native/performance acceptance claim. Read covering command/output evidence and new retained readback/identity mapping. Previous native X01 has one run/engine, nominal cancel/unknown not_run; byte integrity is not producer authenticity or human acceptance.

Write /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/source/.superpowers/sdd/02-r2b-cell-and-web/task-B08-review-3.md. For I1 give ADDRESSED/NOT ADDRESSED with file:line evidence; list new Critical/Important/Minor introduced by fix, separate out-of-scope observations, actual checks/dependency reads and limitations. End with all addressed/no newCriticalImportant or findings remain. Return concise verdict/findings/report path. Root must fill pending fields and read final fix commands/output before dispatch.

R73 continues to apply to this second guard-only correction. Prior original/fix1 reports/identity files remain unchanged. Do not transfer original native results to a different producer tuple; assess the new discriminator and coherent substitution regression normally.
