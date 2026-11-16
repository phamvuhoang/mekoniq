# Task brief L06

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/03-r3-linux-readiness.md

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

## Task L06 — Qualification theo profile và bàn giao có thể tái lập

**Dependency:** L00/L05; thu thêm mỗi native branch đã thực hiện. Không bắt nhánh xArm phải chờ PUMA hoặc ngược lại.

**Files:** Modify `source/scripts/{record-sim-extension,sim-extension-qualification}.mjs`, `source/tests/unit/sim-extension-qualification.test.ts`; create `source/docs/operations/native-profile-case-matrix.md`. Evidence mới ở `source/docs/implementation/evidence/sim-extension/r3-<profile>-candidate-NN/` sau clean recording.

**Interfaces:** recorder extension `--release r3 --handoff DIR --native-records DIR --profile PROFILE --scope SCOPE --out NEW_DIR`; đây là flags cần implement, chưa có ở baseline. Allowed scope enum theo profile: `prepared`, `motion`, `contact`, `terminal`, `full`. Matrix quyết định required cases; không nhận danh sách pass tùy ý để hạ yêu cầu.

- [ ] Negative tests: doctor-only; fake evidence vào native; một architecture thay architecture khác; PUMA đóng xArm; motion đóng contact; missing raw bag/controller traces; gate tested trong khi case required skipped; sidecar hash sai. Tất cả phải từ chối qualification phạm vi đó.
- [ ] Recorder đọc inventory/inputs/artifacts rồi recompute verdict; record luôn `accepted:false`. `prepared` không có G-NATIVE tested; native subset ghi capabilities đã kiểm và cases còn missing.
- [ ] Mỗi host giữ exact source/schema/input identity chung và tool/engine/OS riêng. Không ép hashes thư viện giữa hai ISA giống nhau; không suy performance portable từ một CPU.
- [ ] Ghi hướng dẫn người nhận: install/verify profile → doctor → case commands → verify → replay/export → reviewer. Bao gồm cleanup/rollback thuộc run của mình, không kill service unrelated.
- [ ] Chạy required checks cho code thay đổi và guard qualification; collect ở directory mới ngoài tree. Sau review record mới đưa evidence vào repo; không rewrite historical evidence để giảm blockers.
- [ ] Bàn giao bảng ba mức R3.0/R3.1/R3.2, kết quả theo từng profile, known failures và next action cụ thể. Người có trách nhiệm quyết định acceptance bằng sidecar đúng hash/scope.

**Exit:** người khác xác định được việc nào đã kiểm trên host nào, việc nào mới prepared và phần nào còn chờ phần cứng. Không ghi “R3 physical done” từ software-only evidence.

## Final recording sequence (existing controller ruling made explicit)
Implement and independently review B10 qualification tooling first, then L06 profile tooling; perform their focused tests and any required source/Lab export pins. Defer expensive final candidate recording until BOTH tooling changes and all L00–L05 runtime/schema changes are reviewed. At that final clean source/Lab tuple run the required CI/recording chain, including prepared-only R3 records where hosts are absent. This is a code/review phase followed by a recording/handoff phase, not permission to mark either parent task complete early. A later code/closure change invalidates reuse at the newer tuple; preserve old records rather than rewriting identity. Documentation/evidence commits outside closures can record the built-from tuple separately.

Decision snapshot now includes the existing sequencing ruling (previously spelled with lowercase ruling and missed by the Ruling:-only extraction); final raw decision capture must include both forms. Counts are snapshots, not fixed requirements.

## Qualification core compatibility preflight
At the current baseline, scripts/irsim-qualification.mjs checkQualification permits top-level accepted:true when acceptedBy/acceptedAt strings exist, for historical record compatibility. R2a inputsR2a adds its own strict accepted:false check. New R2b/R3 tables must likewise reject accepted:true even with fabricated reviewer fields; do not rely solely on the shared core check and do not rewrite historical IR-SIM/R1 semantics. Human acceptance remains a separate hash/profile/scope-bound sidecar. Recompute required case coverage from actual artifacts and immutable table definitions, not a caller-supplied reduced suite/case list or summary booleans.

Dependency clarification R83: B10 tooling now owns the executable current-R2b payload/cell native campaign adapter, distinct from L01 historical R2a probe. Read its final reviewed interfaces before completing profile tooling. Keep historical/current subject and observer tuples separate, and actual no-host/image runs not_run; profile summaries cannot turn prepared tooling into native qualification.

L01 checker reproduction constraint: public L01 readback now requires the exact clean checker Source commit plus full audited tool graph. A later unrelated code, test or documentation commit is not automatically a compatible reader pin. Preserve observer/checker identity separately from the subject and evidence-publication commit. Final handoff/reproduction must identify how to invoke the recorded clean checker revision (for example an isolated checkout of that exact commit) when publication adds later docs; do not retag old records or weaken the reader to make HEAD accept them. Final prepared records should be generated only after the reviewed tooling tuple is fixed, as already sequenced above.

Verification receipt discipline: preserve each check's own exit status, command, Source identity and output. Run the check as the sole shell command, or capture/return its exit status explicitly before any cat/diff/cleanup command. A successful trailing command is not proof the preceding lint/typecheck/test succeeded; an empty log alone is not a success receipt. Use fresh output filenames for corrective reruns, retaining prior attempts.

L03 review boundary (R88): native X1/X2/X3 qualification remains incomplete even when prepared code is reviewed. Current L03 restart probe means same-run reopen refusal after cancel, not actual controller-restart evidence. Its direct FollowJointTrajectory probe is not collision-planned motion, and G2 contact is not observed rather than demonstrated unsupported. Matrix/readers must keep these scopes distinct and require actual assigned-host artifacts before native gates; no protocol-double/preflight/document substitution. See L03 review1 finding R1-05 and its recorded scope disposition.

L04 reviewed boundary (prepared code approved after fix1): `runLinuxcncAlg04` distinguishes `numericVerdict` from overall verdict. Numerical FK parity on independently supplied actual-angle inputs is not observed controller accuracy. Native controller clock/synchrony, comparable Cartesian/DH/TCP endpoints, continuous motion, atomic command fencing and actual terminal/GUI/package/security qualification remain incomplete/not_run; do not turn a numeric subset pass or a native_capture JSON label into ALG04/DEP-CNC/SEC tested. L04 staging now excludes caller sim.var and uses six verified byte snapshots, with generated run state outside immutable closure. R89 binds controller scripts/packaging in nativeTools; closure membership does not prove installed package/source/trust provenance. Preserve exact old Mac preflight identities and final prepared tuple separately.

L05 prepared-code handoff is reviewed at Source9fdf4f3/Labb4a9d34: PHYS-PREP-01 PASS/APPROVE, nofindings. assessTargetDossier only checks structure/reference completeness, never live admission, reference authenticity or real signature/calibration. Both arm branches remain selectable later; existing Python ES256/JCSauthority and SDK/VDA refusals unchanged. Matrix must preserve this distinction. B10 current-adapter per-case timeout policy R90 is separate from historical L01; use the final reviewed B10 interfaces and exact new closure, never infer actual execution from prepared orchestration.

## Reviewed B10 tooling handoff — authoritative predecessor

B10 prepared-tooling gate passed full review plus scoped fix1 review at Source `ac9b44dc1bf01bce2406b6f91ac3e141c043c739` / Lab `47343f930b712dd6ac64ed7cd874de3c0aca2188`. Read `02-r2b-cell-and-web/task-B10-report.md` and both B10 reviews; review2 resolves I1–I4 with no new findings. Parent B10 is not complete: final execution follows L06.

Reviewed APIs: `scripts/sim-extension-r2b.mjs` defines closed full/mobility tables. `scripts/r2b-readback.mjs` exports mandatory public `verifyR2bDirectory(root)`, recorder-construction `assessR2bDirectory(root,m)` and recomputed `collectR2bArtifactDispositions(root,m)`. The historical sync `checkQualification` always requires artifact readback for R2b. New R3 public paths must likewise recompute applicable actual artifacts rather than admitting a structure-only result. Preserve historical semantics and strict new-record `accepted:false`/separate sidecar.

The complete B10 producer/reader fixes bind every declared retained input, actual performance observations/windows/actions, a closed browser case and clean Source/Lab/runtime/build identity, and one WEB05 command/HTTP lifecycle with replay binding. `scripts/browser-evidence-readback.mjs:verifyBrowserArtifacts` and `scripts/web05-readback.mjs:verifyWeb05Artifacts` are the reviewed web boundaries. Do not make a weaker parallel guard when a profile consumes these results. The original completed report and later read-only recovered captured report are distinct observations with bound run/source/horizon/served/business-event continuity; recovery metadata may change. Actual browser/WEB05 execution remains not_run.

Current native CLI `scripts/native-sim/r2b-campaign.mjs` preserves subject/checker/image identities and current payload/cell scope. R90 uses the separately bounded current case helper; L01 historical R2a profile/helper/checker remains separate. R91 binds the generated campaign package through OCI labels; R92 permits absent RepoDigests only with the verified local platform/config/rootfs/label association. No Docker/native execution has qualified it. Missing host/image cannot excuse missing preparation code, but remains explicit not_run/nativeReady:false.

Predecessor identities: runtime `7abb257e264d913bfc3f7a472ddf6a7368c3e5e11527fab26c8f049a51c18aac`; schema `c2bdaca0b5ce9b03ee52a8c497719f4ea83b2cbb0e23c4e18365099fd163fa12` (58); native closure `35aebff4ba065eae48c088a91c94fd7a08af6fd723560e0fdb68cbdc112cce0b` (226); portable closure `778c336cd3bcffa975cbea2967915f27fd5f94124ec986e75f2dac031d55df93` (238); checker graph `60908085adb83e314a9c2de95882ac934fdbf50d9235557a8da6343593c7454f`. Exact export/package are under `02-r2b-cell-and-web/evidence-B10/fix1/export-final2` and `package-final2`. Root audit `root-B10-r1-handoff.json` and file indexes preserve all prior bytes. Do not relabel prior execution at the new L06 tuple.

Retained test setup now requires all three digest-bound inputs. Existing prepared corpus: `/tmp/b10-fix1-inputs/inputs.json`, SHA256 `30351aae82c52171d3744d07446fc13341850da7eda155976de586493498a56f`. Configure both MEKONIQ_RETAINED_INPUTS and MEKONIQ_RETAINED_INPUTS_SHA256 if an affected test consumes it; use the documented acquisition recipe for a new corpus. Commissioning tests require the explicit existing interpreter when applicable. Preserve every own-exit/argv/env/log and tested-byte receipt.

The existing ignored SDD directory holds generated exported bundles that unqualified ESLint discovers. Use the exact narrow workspace lint invocation `pnpm exec eslint . --ignore-pattern '.superpowers/**'` when checking the entire authored Source tree here; preserve generated evidence and historical script bytes. Do not hide product lint failures or claim the earlier unqualified `pnpm lint` invocation passed. Default Lab tsconfig omits scripts, so typecheck affected standalone scripts explicitly if you change them.

## Scope clarification of R88 during L06 implementation

L06 owns complete directory-level admission and artifact readback adapters for supported observations, reusing existing L02/L03/L04/B10 assessors with exact subject/profile/host/checker identities and closed required cases. An absent L02 directory wrapper is a locally actionable qualification-tooling requirement, not an excuse to omit that boundary.

This task does not add a new native controller-planning/restart/contact collector phase. Preserve the reviewed L03/L04 limitations and refuse a scope whose required observations are unavailable or whose collector/verifier is not sufficient. Keep required cases in the fixed matrix; distinguish no assigned host from missing/insufficient observation tooling. Do not label a code/collector gap only blocked_external or imply assigning a Linux host automatically supplies it. List concrete missing observations/tooling and next actions. Doctor-only, generic pass records, numeric subsets and reopen refusal cannot replace the missing evidence. This is clarification of existing R88 and L06 scope, not a native gate waiver or permission to skip supported directory readers.

L06 concrete inherited verification limits: root read all 2,659 bytes of `robotics/simulation/bridge/engineering_bag.py`. Offline inspection selects topic names and message timestamps for counts/coverage, without decoding TF payloads or correlating command UUIDs to bag feedback. Copy verification hashes message payload bytes but does not establish their semantics. L06 must keep coverage observations separate from those unverified semantics and refuse any required scope that depends on the missing checks. Agent also reports no complete per-profile DEP-SEC-01 artifact producer/reader; doctor JSON, Docker flags and portable security tests cannot make that host case tested. Record named observation/tooling gaps and next actions separately from absent-host prerequisites. No new native collection phase is added here; supported L06 admission/directory adapters remain required.
