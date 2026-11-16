# Task brief B07

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

## Task B07 — Trải nghiệm web và replay không cần runtime

**Files:**

- Create `source/packages/contracts/schemas/web-replay-package-v1.schema.json`, `source/scripts/export-web-replay.mjs`.
- Create `lab/src/reports/replay-package.ts`, `lab/src/twin/story-camera.ts`; modify `lab/src/{reports/replay,reports/report-shape,twin/sample-buffer,viewer/twin3d,ui/run-bar,ui/problems,ui/report-panel,scenarios/catalog}.ts` và CSS/i18n cạnh mã hiện có.
- Create `lab/public/replays/catalog.json` và gói demo nhỏ sau khi có recording mới; không dùng trace tổng hợp làm replay “đã chạy”.
- Test `lab/tests/unit/replay-package.test.ts`, `story-camera.test.ts`, `lab/tests/e2e/{mujoco-cell,replay-offline,payload-story}.spec.ts`; source test `tests/security/web-replay-export.test.ts`.

**Interfaces:** exporter `node scripts/export-web-replay.mjs --input RUN_DIR --out NEW_DIR`; `openReplayPackage(manifest,readAsset)` validate schema/hash/coverage và trả reader không có runtime transport. `storyCameraTransition(state,event)` thuần; event `manual-orbit` tắt auto-follow, `enable-follow` bật lại. Catalogue chỉ chứa relative package URLs và digest, không token/runtime URLs.

- [ ] Test mở replay trước pairing với toàn bộ runtime HTTP/WebSocket bị chặn vẫn xem được; mọi action mutation trong replay bị từ chối. Hash sai/path escape/script/unknown fields không được hiển thị như trusted report.
- [ ] Export report/scene/asset/NOTICE/event/chunks, strip credentials/internal endpoints và giới hạn dung lượng. Round-trip so pose/phase/metrics với source artifact; thiếu chunk hiển thị gap và null metric.
- [ ] Thêm “Xem mẫu”, “Chạy thử”, “Thử một thay đổi” trong UI R2a; phase từ source events, camera theo phase optional; manual move hủy follow; preset stress có tên rõ.
- [ ] Cell renderer dùng actual sample/replay; reset buffer khi đổi run/boot/revision, không extrapolate qua gap. Vector contact hiển thị only-with-data; geometry/material không dựng lại trên mỗi tick.
- [ ] Import/export package offline; saved evidence không bị đổi khi project edit; changed inputs tạo run mới, không live mutate. Một mẫu displayed-decimated ghi rõ không đủ raw evidence để qualification.
- [ ] Browser test VI/JA/EN, 390/1024/1440 px, reduced motion/2D fallback, axe zero serious/critical, no-scroll theo R2a. Performance đo tiêu chí spec 3 phút với build production và host metadata; fail không được tính là pass do ảnh đẹp.
- [ ] Commit source exporter/contract rồi pin, commit Lab UX và replay catalogue; không publish replay hoặc đẩy main trong task này.

Kiểm transport-deny trong Playwright:

```ts
const mutations:string[] = [];
await page.route('**/lab/v2/**', async route => {
  if (route.request().method() !== 'GET') mutations.push(route.request().url());
  await route.abort();
});
await page.goto('/?replay=coffee-delivery-demo');
await page.getByRole('button',{name:'Phát bản ghi'}).click();
await expect(page.getByText('Bản ghi mô phỏng',{exact:true})).toBeVisible();
expect(mutations).toEqual([]);
```

URL/query và nhãn trên là mới được tạo trong B07, không phải route hiện có. Catalogue resolve replay ID locally, không lấy arbitrary URL từ query để fetch file private.

```sh
# Cwd lab
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/replay-package.test.ts tests/unit/story-camera.test.ts
perl -e 'alarm 600; exec @ARGV' pnpm test:mujoco-e2e -- mujoco-cell.spec.ts
perl -e 'alarm 600; exec @ARGV' pnpm exec playwright test tests/e2e/replay-offline.spec.ts tests/e2e/payload-story.spec.ts
```


## Lab preflight findings
- Existing reports/replay.ts rebuilds source journal state per cursor and filters telemetry; physics data must follow the same cursor/coverage discipline. Final run summaries are not earlier cursor measurements. No interpolation across recorded gaps or boot/revision changes.
- Existing viewer/twin3d.ts caches xArm mesh geometry by model constant; replay package assets must be keyed/checked by immutable model digest. On mismatch use an explicit proxy rather than current catalog mesh. Cell rendering must omit old static tray if world has mobile receiver support; do not remove nozzle stand.
- Existing preset.view only supports arm_cell and current homeRegion; extend optional view/camera inputs for mobile/cell through actual model bounds. Preserve manual orbit and reduced-motion behavior. Use UI/UX skill at task start for design implementation; adhere to existing visual language, no new UI framework.

- Offline entry must be integrated before normal page probing in src/app.ts/main.ts and TwinWorkspace mount(), not only inside replay-package.ts. app health probe and workspace auto-probe/SSE currently run from normal page initialization. Use a read-only local replay route/state that does not initiate pairing, ownership or step operations; do not rely only on disabled buttons. Existing workspace archived/live view epochs protect against late async responses and should remain.
- Existing workspace engineeringPreset only recognizes IRSIM_PROFILE/WEBOTS_PROFILE and static arm source-note says tray stays fixed while robot leaves. New payload/cell path must extend the actual profile allowlist and use accurate per-composition notes, not show the R2a fixed-tray explanation for the mobile world.

## Live export transport seam
Current v2 gateway only exposes run actions/report/events/telemetry/reclaim/archive; there is no run-artifact download endpoint. Do not implement a browser export that silently omits physics/interaction chunks or assumes filesystem access. CLI export from trusted RUN_DIR is required; if UI live export needs source artifacts, add a bounded run-owner-scoped replay export/read endpoint using the verified report/manifest allowlist (not arbitrary paths/URLs), preserving private-other-session404 and read-only reclaim semantics. Reuse exporter/reader rather than divergent browser trust rules; test cross-session denial, symlink/traversal and missing chunks. Recorded report-only/decimated copies must be declared with raw evidence link/reason and cannot become qualification data. Name this gateway seam in review; B09 writer work consumes the same owner boundary.

## Browser replay resource limits and provenance preflight
Existing Lab importNavigationEvidence/importControllerBundle bound total selected file bytes and validate manifest hashes, but do not inflate/decode physics chunks. Reusing their file-size check alone is insufficient for new compressed replay. Enforce finite compressed, decompressed, per-line/sample-count and total decoded budgets before materializing large data; reject oversized metadata, duplicated paths/chunks and decompression expansion without freezing the tab. The 25 MiB package/performance target is not a bound on decoded memory. Prefer bounded incremental reads, release obsolete buffers when replay/run changes, and test a small compressed high-expansion input plus cancellation during loading. Exact sensible browser budgets belong in the new versioned format/reader and report.

A digest-valid imported package proves internal integrity, not who produced it or release acceptance; keep imported provenance and qualification scope explicit as existing verification.ts does. Model assets must resolve only through admitted package/catalogue resource entries with verified digests; a mesh's nested external texture/buffer URL must not bypass the no-runtime/no-arbitrary-URL rule. Current known vendor assets or explicit proxy fallback are sufficient; arbitrary uploaded executable/custom asset formats are outside scope.

## Interactive stress preset boundary and truthful title
At B04a, cup-fall is a server-only registered launch perturbation payload-cup-forward-impulse-v1, with a measured physical force at tick501; it is not a natural turn-induced fall. B04b can prove visible fault replay from its real artifacts. For B07's interactive stress experience, provide a narrow registered scenario/experiment selection through source admission (reuse B06's applicable field if implemented), bind it into immutable run inputs, and preserve arm/other-provider refusal. Never expose browser force vectors or test-only physicsOverride. Source changes require tests/commit/export/pin.

The title must describe actual causality: if the retained case uses an external impulse, use “Cốc rơi do tác động” / equivalent JA/EN and show the scheduled disturbance in Details/events. Do not title that case “Cốc trượt khi vào cua” as though turning alone caused it. A genuine registered turn/slip experiment can use the latter title only after actual evidence proves it. This is a truthful UI adaptation of the three story presets, not removal of the stress experience.

## Export horizon and non-mutating readback preflight
B04a found that Node DatabaseSync({readOnly:true}) may create WAL/SHM sidecars on a WAL-mode archive. Reuse its corrected isolated reader if SQLite evidence is ever consumed; “readOnly” alone does not prove filesystem immutability. Replay export should normally consume captured report/events and immutable named chunks, without opening the source database.

For a live gateway export, capture one committed report/manifest horizon in the run's serialization boundary and export only those immutable references. Do not race a later physics/manifest.json against an earlier report or include future chunks/events. If a mutable manifest is needed, serialize the captured admitted version with its exact matching identity/hash. This preserves tick consistency while the live run continues; missing/changed artifacts must refuse or yield an explicitly incomplete package, never be silently relabelled. Test a step concurrent with export and verify the resulting package is internally one horizon.

## Existing performance harness scope
Lab scripts/measure-twin-ui.mjs is explicitly a synthetic 10Hz visual-telemetry workload served by Vite development server; record-regression invokes it for60000ms. Its existing pass is useful renderer regression but cannot close R2b's production-build, actual-cell, at-least180000ms-after-warmup WEB04 target. Add or extend a clearly separate actual-workload capture without relabelling the old benchmark. Record active/drawing sample counts, not only idle requestAnimationFrame intervals; include exact run IDs/horizons and whether the measurement spans successive real runs or live plus replay. Do not pad an ended run with idle time and call it three minutes of active cell performance.

Worker+IPC p95 needs per-step monotonic wall timing around the real worker request/ACK boundary (a bounded instrumentation seam or harness wrapper is sufficient); simTimeNs and HTTP batch-average wall time are not this metric. Capture pause-to-last-committed-tick separately at1x with the observed network path. Preserve engine clock/default behavior and raw timing samples plus host/browser/DPR metadata. If the target is not met, report the actual result; do not substitute the historical synthetic measurement.

## Exact replay horizon
B04b's actual browser run exposed that the legacy range input step5 rounds a terminal tick such as284, showing a different pose. B04b corrects the payload cursor to logical step1. Carry exact terminal/cursor semantics into the new world/offline paths and test a horizon not divisible by5; do not choose a convenient recorded tick to hide rounding. A decimated package must still represent its exact terminal observation and declare sample availability between retained observations. Preserve gap handling and never invent a measurement for a rounded/interpolated tick.

## Observed report readability follow-up
Controller inspected /tmp/mekoniq-b04b-r1-browser-20261114-1111/B04b-navigation-visible-cursor{0,520}.png. Two nonblocking observations are deferred to this planned web-report work: the generic “Legacy / no native evidence” fallback actually describes absent arm/controller verification and should not imply absence of the displayed real mobile engine observations; navigation assertion details are highly compressed in the narrow sidebar table, despite its existing horizontal-scroll region. Make new-provider report scope and column/summary presentation readable with keyboard/touch access. Preserve evidence IDs/values, old-provider policy, and the corrected stable navigation region/focused-range behavior; no new metrics or verification claim is authorized by cosmetic changes.

## B05 world evidence and model identity handoff
B05 now has a separate `world-evidence-v1` schema/reader with complete world snapshots and birth/remove records admitted from known cup slots. Mobile-only B03/B04 evidence requires a fixed load set. Extend the web package/import path explicitly for world evidence; do not make the old payload importer accept missing/unknown props to accommodate dynamic coffee births. Preserve all identities/cursor/gap/interaction checks and the distinction between readable active prefix and finished evidence. B06 supplies actual Source custody/phase correlation; `worldInteractions` and native contacts alone are not those domain receipts. Use final reviewed B05/B06 interfaces and reports, not the earlier illustrative type names.

Cell visual identity is the admitted xArm/G2 component plus mobile model. The inherited design assetRef may still say `arm-puma-reference`; that display reference does not identify the actual physical model. UI/model labels, mesh digest and provenance must agree with admitted component/profile, preserving the separate future custom/PUMA hardware branch without labeling the current simulated xArm as PUMA.

B06 navigation preflight found the fixed world dock too near oldzero-origin planner bounds for a swept turn. Controller authorized explicit admitted signed bounds/origin for the world (physical geometry unchanged), with new scene/controller-policy identity and legacy defaults untouched. Consume the final B06 signed map extent consistently in2DviewBox/3Dfloor/camera/overlays and replay, not hardcoded0..width. Unknown/inconsistent extent must not silently crop or relabel the actual pose. Read final B06 report for exact schema and identity; no extra display translation of physical samples.

Observed performance context (development, not production benchmark): B06 initial Source preflight took305.55s for2100ticks/42s simulated inVitest while findingNO_PATH. Rootcause not established; do not attribute it solely to checkpoints/sweep without measurements. In the required production-build active-cell run, record actual simulation-time/wall-time pacing and end-to-end Source step latency separately from worker+IPC and display-frame time. Smooth idle rendering is not proof of requested1× pacing. UI must show achieved/limited playback honestly if runtime cannot sustain selected rate; investigate measured bottlenecks within the existing performance task, preserving durable-ACK/collision/evidence guarantees.

B06 full-world sweep reporting: generic legacy ARM03 retains its4096interval cap; a long moving-world run may have honest EVIDENCE_TRUNCATED there while a separately named bounded world-stream recheck covers the complete run. Use the final reviewed method/coverage fields, not a blanket reinterpretation of ARM03. Keep the distinct geometric sweep, all-substep native contacts and Source custody claims clear. worldControl records describe Source-selected phase/interlock/command context; they do not authorize browser mutation or arbitrary contact permissions. Preserve those bindings in export/replay, including phase boundaries.

## Execution split (controller ruling43)
B07 now runs sequential B07a (package/source export and bounded browser reader/admission) then B07b (UI/offline entry/catalogue/stories/browser/performance). See adjacent task-B07a-brief.md and task-B07b-brief.md. This parent remains the requirement source and is complete only when both pass review. One implementer at a time, code/pin/review at each boundary; no B06 overlap or reduction in exit criteria.
