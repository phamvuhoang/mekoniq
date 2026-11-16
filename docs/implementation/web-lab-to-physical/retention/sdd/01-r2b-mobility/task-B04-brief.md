# Task brief B04

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/01-r2b-mobility.md

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

## Task B04 — Vertical slice tải trên Lab và campaign đầu tiên

**Files:**

- Create `source/robotics/simulation-mujoco/campaigns/payload-v1.json`, `source/scripts/lab-mujoco.mjs`, `source/packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts`.
- Create `lab/src/twin/payload.ts`, `lab/src/reports/physics.ts`; modify `lab/src/{scenarios/catalog,scenarios/support,twin/model,viewer/twin3d,ui/report-panel}.ts`, launcher/export wiring sau pin.
- Test `source/tests/integration/mujoco-payload-campaign.test.ts`, `lab/tests/unit/payload-view.test.ts`, `lab/tests/e2e/mujoco-payload.spec.ts`.

**Interfaces:** campaign command mới `node scripts/lab-mujoco.mjs run --campaign payload-v1 --out DIR`, `verify --input DIR`; `payload-campaign.ts` export `verifyPayloadCampaign(root:string):Promise<PayloadCampaignVerdict>` với `{expectedRuns:number,completedCases:number,missingArtifacts:string[],faultCases:{id:string,detected:boolean,falseServed:boolean}[],issues:string[]}`. CLI verify và test dùng cùng hàm đọc này. Renderer đọc `LoadObservation`/actual AMR, không tính physics. Preset ID `mujoco-payload`, default center load và 1×.

- [ ] Viết browser test preset → run → cốc chuyển động theo plant → dừng → report → replay. Dùng fixtures có tray quay để bắt lỗi gắn cốc vào world hay chassis bằng animation.
- [ ] Implement selector/capability/readiness và timeline metrics đơn giản trong panel R2a; profile đổi tạo new run identity. Giữ mock/IR-SIM/Webots/R2a presets.
- [ ] Viết campaign 18 runs theo case matrix, mỗi run có artifact và source journal. Fixture fault là server-owned test case; không nhận runtime path/code từ browser.
- [ ] Recorder/verify từ chối missing run, skip không giải thích, wrong seed/profile, outcome không đúng expected fault. Dùng exit 0 cho all case assertions đúng, 1 cho fail, 2 cho prerequisite thiếu.
- [ ] Chạy browser spec bằng launcher cho provider mới, ba ngôn ngữ; chụp live và replay cùng tick/object. Ghi limitations not_calibrated/localization ground_truth.
- [ ] Commit source/campaign, re-pin, rồi Lab UI commit; tạo candidate incremental R2b.1 theo B10 khi muốn bàn giao sớm, không gắn nhãn full R2b.

Ví dụ harness assertion trong test campaign (harness API được tạo ở task này):

```ts
// verifyPayloadCampaign(root:string) đọc manifest/chunks, không khởi động engine.
const result = await verifyPayloadCampaign(recordedDirectory);
expect(result.expectedRuns).toBe(18);
expect(result.completedCases).toBe(18);
expect(result.missingArtifacts).toEqual([]);
expect(result.faultCases.every(c => c.detected && !c.falseServed)).toBe(true);
```

`recordedDirectory` là `mkdtemp` của integration test sau chạy fixture campaign; không trỏ historical evidence để kiểm code mới.

```sh
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-payload-campaign.test.ts
# Cwd lab; launcher MuJoCo hiện có được mở để chọn preset mobile tại task này.
perl -e 'alarm 600; exec @ARGV' pnpm test:mujoco-e2e -- mujoco-payload.spec.ts
```

**Exit:** một AMR có payload chạy thật trên Lab, report/replay tương ứng; lỗi vật lý quan sát được; full cell vẫn chưa tuyên bố có.

## Lab preflight findings
- Current viewer/twin3d.ts draws AMRs as a generic cylinder; this would leave a payload floating in space above an invisible tray. New payload preset must render the admitted Serve physical geometry/tray at actual base pose, from synced/pinned model input with digest agreement. Keep legacy drawings untouched. A small payload.ts model adapter is preferable to modifying model.ts's shared asset compiler, which has a source/Lab parity test. Use link transforms in canonical base frame, then map-to-three transform exactly once.
- Current observed cup path already exists: TwinSample observed.positionM/quaternionXyzw -> entity.plant -> TwinPoses.cups; reuse for mobile payload but do not fabricate business cup ownership from support contact. Free load can exist without a coffee ledger entry; expose a simulation payload entity with explicit provenance.
- Twin3d uses xarmLayout.cup dimensions for all plant cups today. New payload view must use the admitted load geometry (and hash), not quietly latest xArm dimensions even when numerically equal.
- Lab sync-engineering-contracts currently syncs schemas and explicit fixture lists (Serve/Webots/xArm). Add new payload schemas/fixtures through that script, not manual generated edits.
- Some arm inspector labels treat any physics_sim other than providerId=mujoco_arm as Webots. For new mobile/cell labels use explicit provider/engine identities, preserve old labels.
- Browser report import has permissive top-level structure. Explicitly validate new physics evidence and telemetry pose fields consumed by UI; do not call unvalidated extra JSON trusted. Missing old-report physics stays unavailable.
- Preserve replay gaps and per-cursor visibility: a later final physics summary must not leak as a metric measured at an earlier tick. Scrubbing backward hides not-yet-created payloads and future faults.

Additional concrete UI targets: src/reports/metrics.ts currently titles every navigation evidence block "Navigation evidence (IR-SIM 2D)" and appends planar-only limitations. Update explicit engine wording for the new provider when modifying report UI, leaving actual IR-SIM limitations true. src/twin/pose3d.ts/placeBody and viewer/twin3d.ts/TwinPoses are existing map-Z-up to Three-Y-up boundaries; keep canonical model transforms in map/base coordinates and convert once. Reuse existing tests for report XSS/import validation and backward replay visibility.
Source B03 owns durable reader/report producer; this B04 task owns browser physics schema registration/validation and display, including old reports with no optional block. This cross-task boundary does not permit a new UI to trust arbitrary imported physics JSON.

Mobile telemetry boundary: navigation2d/runner.ts has its own record() and entities(), currently only emits AMRs; it does not use scenario-runner/projectSamples() used by R2a coffee. B04 must extend the new mobile path to emit real free payload entity/pose samples from committed snapshot.physics/props and admitted load geometry for the existing Lab plant-cup pipeline. Do not assume the old arm pipeline automatically exposes payloads. Use physics_sim provenance and original run/boot/tick/sequence, no invented business ownership. Legacy navigation entities/telemetry stay unchanged. B02b is handling the AMR telemetry origin identity override; read its report first.

## Registered experiment/profile admission risk
B02b compiler intentionally pins baseline physics byte SHA9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3 and center load; worker session's closed measurementLock currently requires probeId=b02a-locked. B04's required empty/offset/speed/friction cases need an explicit additive server-owned experiment registry/selector; this task may modify compiler/profile admission and targeted worker tests to support those registered inputs. Do not set b02a-locked on changed numerical values or weaken admission to arbitrary browser paths/profile JSON. Retain baseline profile/probe bytes. Each changed physics variant gets a new frozen identity and its own bounded finite/repeat probe evidence before campaign interpretation; same solver/clock pin remains. Record variant provenance, raw profile digest and own measurement/probe id honestly. Speed-only changes belong to controller policy and run identity, not a fake physics hash change. Review B02b final report/source for its actual selector seam.

B02b Lab pin compatibility commit5770521 added engineVersionOf explicit MuJoCo branch, while temporarily keeping NAVIGATION_PROVIDERS=['irsim_2d','webots_3d']; tests/unit/navigation2d-report.test.ts asserts mobile evidence stays unsupported at that intermediate stage. B04 now owns full admission: update that temporary test to assert correctly validated MuJoCo identity, metrics and rendering, plus unknown-engine refusal. Do not preserve temporary unsupported UI after building the required mobile preset. Lab RunReport in src/scenarios/controls.ts is still an interim handwritten mirror of source report.ts, so add optional physics block and its closed import validation intentionally; generated shared schemas alone do not update this interface.

PhysicsEvidence profile identities are the exact admitted profile file-byte SHA256s from the engine refs (not profile.digest or numericalInputsDigest). B03 brief/report documents this contract ruling. Campaign/reader/browser comparisons must use the same identities; still validate each profile document digest separately.
