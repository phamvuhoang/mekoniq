# Task brief B08

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/02-r2b-cell-and-web.md

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

## Task B08 — A/B có phạm vi và semantic study đa engine

**Files:**

- Create `source/packages/contracts/schemas/semantic-study-v1.schema.json`.
- Create `source/packages/lab-runtime/src/v2/simulation3d/{physics-comparison,semantic-study}.ts`, `source/scripts/compare-simulations.mjs`.
- Modify `lab/src/reports/compare.ts` để hiển thị tab study riêng; giữ `source/.../comparison.ts` compatibility logic.
- Test `source/tests/unit/semantic-study.test.ts`, `physics-comparison.test.ts`, `source/tests/integration/cross-engine-fd01.test.ts`, `lab/tests/unit/semantic-study-view.test.ts`.

**Interfaces:** `buildSemanticStudy(inputs:SemanticStudyInput):SemanticStudyV1`; `SemanticStudyInput` có `equivalence` (model/world/task/commonProjection refs), `runs` (report+artifact refs), `invariantPolicy`. `comparePhysicsRuns(a,b)` trả availability/reasons/window/population/deltas theo spec. CLI: `node scripts/compare-simulations.mjs --study STUDY_INPUT_JSON --out NEW_REPORT_JSON`.

- [ ] Negative tests khác world/frame/goal bindings/input digest bị `INPUTS_NOT_EQUIVALENT`; `compareRuns` cũ cross-backend vẫn `delta:null`; IR-SIM contact `unsupported`, không 0.
- [ ] Compile common empty-load Serve geometric projection cho IR-SIM/Webots/MuJoCo, noise off, confirmations deterministic; mỗi engine report mang đúng scene/model identities. Không tái dùng report legacy khác fixture.
- [ ] So invariant causal relations source (arrival→confirmation→served, cancel/unknown), goal/corridor và differences. Không assert byte/event total order hoặc trace equal giữa engines.
- [ ] A/B physics chỉ cùng engine/control/model, thay một load/speed/friction profile explicit; performance không xếp hạng từ một run/side. Population <3 không p50/p95 “thống kê”.
- [ ] UI ghi đúng mục nào comparable/unsupported và giải thích khác biệt; link về replay tick/run. Không headline “engine chính xác hơn” khi chưa có measured ground truth.
- [ ] Chạy X01 thật khi các engines có sẵn; thiếu Webots GUI ghi not_run/blocker, không âm thầm đổi thành double; commit `feat: compare physics experiments within explicit evidence scopes`; re-pin.

```ts
const study = buildSemanticStudy(mismatchedWorldInput);
expect(study.status).toBe('incomparable');
expect(study.reasonCodes).toContain('INPUTS_NOT_EQUIVALENT');
expect(Object.hasOwn(study,'winner')).toBe(false);
```

`mismatchedWorldInput` là fixture JSON mới ở `source/tests/fixtures/simulation-study/mismatched-world.json`; task tạo đủ hai report refs với common-projection hash khác, không dùng undocumented helper.

```sh
perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/semantic-study.test.ts tests/unit/physics-comparison.test.ts
perl -e 'alarm 1200; exec @ARGV' pnpm exec vitest run tests/integration/cross-engine-fd01.test.ts
```


B02b controller integration discovered measured-velocity slew limiting stalls the finite-actuator AMR at static friction; mobile now uses a separately admitted/versioned previous-sent-command ramp while preserving actual stop/arrival checks. For X01 equivalence, inspect actual B02b controller policy identity. A common registered comparison policy may select the same ramp on all three new study inputs through an additive server-owned option, leaving legacy defaults unchanged; do not silently claim identical controller inputs if one uses a different mode. Physics A/B still requires same control identity. Refer to B02b report for final API and measured diagnosis.

## Speed-input identity preflight

Current source MOBILE_CONTROLLER_POLICY identifies grid algorithm/ramp behavior and does not contain a numeric speed cap. Actual speed is constrained by NavigationPolicy.parameters.maxLinearMps/maxAngularRadps, wheel limits and the project's entitySpeedLimitMps; projectNavigationModel bakes effective limits into its kinematics/digest. A registered speed experiment must bind those actual applied inputs and new run/scene/policy/projection identity. Do not fake a physics-profile change or change the controller algorithm version when the algorithm is unchanged; retain the canonical physical model-file identity when mechanics are unchanged. Report every derived identity that changed.

B08 consumer must compare declared speed experiments using explicit allowed input differences and unchanged mechanical/controller-algorithm invariants. It must never broadly ignore all policy/model differences: if the observed changed fields exceed the registered experiment declaration, return incomparable/changed inputs, not a causal speed effect. Final B04a registry/API determines the exact admitted fields; explain them in its report.

B04a identity clarification: compiled physical-model.inputs binds current project/world/assembly and compileNavigationScene enforces equality. Speed-only changes can therefore alter compiled physical model, rebound load and navigation projection digests without altering mechanics. Preserve this provenance. The stable physical invariant is canonical fixture bytes plus verified mechanical fields, with only registered input-provenance/policy differences allowed. Compare against B04a registry/report; never ignore arbitrary model differences or require stale current-input provenance for file equality.

## Concrete B04a derived-reference handoff
B04a records exact all7 compiled identities in its report and .superpowers/sdd/01-r2b-mobility/evidence-B04a/registered-input-identities.json. At source a3a50a3, PAYLOAD_SPEED_DIFFERENCES is a descriptive list with no runtime comparator consumer. It names changed policy.id/hash, but omits spelling out derived navigation.navigationPolicyRef.id/hash and some mirrored scene/file-ref paths. Controller accepted this as a documented B08 consumer obligation to avoid rerecording the B04 campaign just for unused metadata. Before implementing comparison, make the actual bounded field whitelist exhaustive with positive slow/fast/default pairs and negatives that alter adjacent geometry/contact/controller fields. Match complete normalized verified documents, including references; never ignore whole navigation/scene/policy subtrees. Include this contract completion in B08 review diff and tests.

Final B04a material/metric limitation: lower default geom sliding parameter0.3 is masked by floor0.8/cup0.6 at equal-priority dynamic contacts; high0.9 can change effective friction. Preserve this as observed/no-effect explanation, not proof of lower effective floor friction. B03 stopDistance begins at the first actual zero plant target after controller ramp; it excludes browser reaction and preceding ramp-down distance. Do not present it as total cancel-to-stop distance. See final B04a report and pinned MuJoCo3.17 contact rules https://mujoco.readthedocs.io/en/3.17.0/modeling.html#contact-parameters .
