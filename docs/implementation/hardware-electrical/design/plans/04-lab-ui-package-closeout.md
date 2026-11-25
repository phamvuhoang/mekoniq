# R5.4–R5.5 Lab UI, Hardware Candidate Package and Close-out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người dùng mở Lab, chọn một phương án phần cứng, xem phân bổ, kiểm tra, đấu dây và chi phí, chọn một trục trong twin để chẩn đoán, và tải về gói ứng viên phần cứng; R5 được ghi qualification ở một tuple.

**Architecture:** Phần Điện là một phần mới của trang Lắp ráp, gọi route `engineering/electrical` và chỉ hiển thị thứ biên nhận của server trả về. Panel Chẩn đoán là một tab inspector ghép từ evidence của run qua các route đang có. Gói ứng viên là hàm thuần của bundle cộng tài liệu, đóng bằng manifest và checksums.

**Tech Stack:** theo [Global Constraints](README.md#global-constraints).

**Spec:** [R5-B/C §7](../04-r5-stop-diagnostics-spec.md#7-r54--giao-diện), [R5-A §8](../03-r5-hardware-electrical-spec.md#8-gói-ứng-viên-phần-cứng-và-drive-model-suy-ra), [contracts §7–9](../05-r5-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Riêng gói này: Lab không tự compile, không tự tính mức bằng chứng và không tự tính kết quả kiểm; nó hiển thị bundle. Không thêm dependency npm (không thêm thư viện bố cục đồ thị). Mỗi launcher chạy đúng một spec Playwright.

## Review Focus

1. **Runtime cũ không có năng lực `electrical_bundle_v1`** (bản web công khai trước lần deploy): phần Điện hiện "runtime này chưa hỗ trợ", không gọi route, không báo lỗi đỏ (test ở E15).
2. **Bundle `blocked`:** bảng phân bổ và danh sách kiểm tra vẫn hiện đầy đủ; nút xuất gói bị tắt kèm lý do đọc được (test ở E16).
3. **Run R4 cũ không có stream `io` hay báo cáo dừng:** panel Chẩn đoán mở được, hiện "không có dữ liệu" cho phần thiếu, không hiện 0, không tô xanh (test ở E17).
4. **Người dùng chỉ dùng bàn phím:** chọn được trục, mở được panel, đi tới được một cảnh báo và nhảy tới tick của nó (test ở E17).
5. **Gói ứng viên bị sửa một byte sau khi sinh:** reader từ chối và nêu tên file; trạng thái trong manifest không được tin (test ở E19).

---

## Task E15 — Phần Điện: phương án, thiết bị, kiểm tra

**Files:**

- Create `lab/src/design/electrical.ts`, `lab/src/ui/electrical-panel.ts`.
- Modify `lab/src/ui/assembly-page.ts` (gắn phần mới sau BOM), `lab/src/scenarios/engineering.ts` (lời gọi `compileElectrical`, `loadElectricalBundle`), `lab/src/styles/` (file style của trang Lắp ráp).
- Test `lab/tests/unit/electrical-view.test.ts`, `lab/tests/e2e/engineering-electrical.spec.ts`.

**Interfaces:** consumes `ElectricalBundleV1`, `ElectricalDesignV1` từ `lab/src/shared/engineering.ts` (đã sync ở E08); produces

```ts
// design/electrical.ts — view model thuần, không DOM
export interface ElectricalView {state: 'no_runtime' | 'unsupported' | 'idle' | 'compiling' | 'compiled' | 'blocked' | 'rejected';
  option: {id: string; label: string} | null;
  devices: {id: string; label: string; orderCode: string | null; firmware: string | null; level: 'candidate' | 'documented'; assumedSources: number}[];
  checks: {level: 'blocking' | 'warning' | 'unverified'; ruleId: string; path: string; detail: string}[];
  counts: {blocking: number; warning: number; unverified: number}; rejection: string[]}
export function electricalView(input: {capabilities: readonly string[] | null; bundle: ElectricalBundleV1 | null; rejection: string[] | null; busy: boolean}): ElectricalView;
export function serveOptions(): {id: string; label: string; design: ElectricalDesignV1}[];      // ba phương án từ fixture đã sync
```

- [ ] Viết test view model trước: `capabilities: null` → `no_runtime`; capabilities không có `electrical_bundle_v1` → `unsupported`; bundle `blocked` → `state:'blocked'` và `counts.blocking > 0`; `devices[].level` lấy **nguyên văn** từ `bundle.inputs.profiles[].evidenceLevel` (test bằng một bundle có mức khác với mức mà nguồn của hồ sơ gợi ý, để chứng minh Lab không tự tính); `rejection` chép mã lý do của server.
- [ ] Chạy để thấy fail: `lab/`: `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/electrical-view.test.ts`.
- [ ] Implement view model và panel: bộ chọn phương án, bảng thiết bị (mã đặt hàng, firmware, huy hiệu mức, số nguồn `assumed`, liên kết mở tài liệu theo digest qua route blob), danh sách kiểm tra dùng lại `ui/problems.ts` với bộ lọc ba mức. Mọi chuỗi qua `tr(vi, ja, en)`. Huy hiệu mức có chữ, không chỉ màu.
- [ ] E2E trên runtime thật có engineering: mở trang Lắp ráp với project Serve → chọn HW-A → thấy bảng thiết bị và số mục kiểm tra khớp bundle đọc trực tiếp từ runtime. Đọc `lab/scripts/` để dùng đúng runner mà `engineering-design.spec.ts` đang dùng; một spec một launcher.
- [ ] `pnpm typecheck && pnpm exec vitest run tests/unit`; commit `feat: electrical section of the assembly page — options, devices and checks`.

## Task E16 — Phần Điện: phân bổ, đấu dây, chi phí

**Files:**

- Modify `lab/src/design/electrical.ts`, `lab/src/ui/electrical-panel.ts`.
- Create `lab/src/ui/wiring-diagram.ts` (SVG nội tuyến).
- Test `lab/tests/unit/electrical-view.test.ts` (thêm ca), `lab/tests/unit/wiring-diagram.test.ts`, `lab/tests/e2e/engineering-electrical.spec.ts` (mở rộng cùng spec).

**Interfaces:** consumes `ElectricalView` (E15), `TcoComparisonV1`; produces

```ts
// design/electrical.ts
export function pinSignal(design: ElectricalDesignV1, signalId: string, target: {deviceId: string; pointId: string} | null): ElectricalDesignV1;   // revision + 1; không sửa đối số
export function wireRows(bundle: ElectricalBundleV1, filter: {deviceId?: string; netId?: string}): WireRow[];
// ui/wiring-diagram.ts
export function wiringDiagramSvg(bundle: ElectricalBundleV1, labels: (deviceId: string) => string): string;   // năm cột cố định: nguồn, bảo vệ, điều khiển, drive, thiết bị trường
```

- [ ] Test: `pinSignal` trả thiết kế mới với `revision` tăng 1 và chỉ đổi `pinned` của tín hiệu đó; bỏ ghim đưa `pinned` về `null`; `wireRows` lọc đúng và giữ thứ tự id; `wiringDiagramSvg` cho cùng chuỗi ở hai lần gọi, mỗi thiết bị một `<g data-device-id>`, mỗi bus và ray một `<path data-net-id>`, có `<title>` cho từng phần tử.

```ts
// ponytail: five fixed columns, straight and elbow connectors; readable up to about 20 devices. Pin-level drawing is the trigger for elkjs (spec R5-A §10).
```

- [ ] Implement: bảng phân bổ (tín hiệu → thiết bị/chân/bus/kiểu lộ; phần `unassigned` kèm mã lý do và số ứng viên bị loại; chân dư); nút ghim và bỏ ghim gọi `pinSignal` rồi compile lại; bảng dây và bảng chân; chọn một dây làm nổi hai `<g>` đầu mút; bảng chi phí từ route `engineering/electrical/compare` của E10 (trả `TcoComparisonV1`) với ô "chưa so được" và danh sách dòng thiếu giá.
- [ ] E2E mở rộng: ghim `bumper-front` vào một chân khác → bảng đổi và revision của thiết kế tăng; ghim vào chân không hợp lệ → thấy `IOA_PINNED_CONFLICT`, nút xuất bị tắt và có lý do; bảng chi phí hiện "chưa so được" trên fixture không có báo giá.
- [ ] Commit `feat: I/O allocation, wiring and cost views in the electrical section`.

## Task E17 — Panel Chẩn đoán

**Files:**

- Create `lab/src/reports/stop.ts`, `lab/src/reports/diagnostics.ts`, `lab/src/ui/diagnostics-panel.ts`.
- Modify `lab/src/ui/workspace.ts` (thêm tab vào `TABS`), `lab/src/twin/selection.ts` (chọn tới mức trục), `lab/src/twin/overlays.ts` (đánh dấu cảnh báo), `lab/src/ui/report-panel.ts` (mục báo cáo dừng).
- Test `lab/tests/unit/diagnostics.test.ts`, `lab/tests/unit/stop-report-view.test.ts`, `lab/tests/e2e/mujoco-diagnostics.spec.ts`.

**Interfaces:** consumes report của run (`drives`, `faultReport`, `stopReport`, `ioFaultReport`, `io`), `ElectricalBundleV1` nếu có; produces

```ts
// reports/diagnostics.ts — thuần, không DOM
export type Quality = {kind: 'good'} | {kind: 'stale'; ageTicks: number} | {kind: 'unavailable'; reason: string};
export interface TagValue {tag: string; value: number | boolean | string | null; unit: string | null; quality: Quality; tick: number | null}
export interface Alarm {id: string; source: 'fault' | 'stop' | 'io'; targetId: string; code: string; tick: number; verdict: string}
export function selectableTargets(scene: SceneEntityList): {id: string; kind: 'amr' | 'wheel' | 'arm' | 'joint' | 'gripper'; label: string}[];   // thứ tự ổn định cho bàn phím
export function diagnosticsFor(targetId: string, input: {report: RunReport | null; cursorTick: number | null; bundle: ElectricalBundleV1 | null}): {device: {id: string; label: string} | null; tags: TagValue[]; alarms: Alarm[]};
export function alarmsOf(report: RunReport | null): Alarm[];     // gộp ba báo cáo, sắp theo (tick, id)
```

- [ ] Test trước: report không có `drives` → mọi tag drive có `quality.kind === 'unavailable'` và `value === null` (không phải 0); report R4 thật (fixture JSON đã có trong `lab/tests`) → tag drive `good`, tag I/O `unavailable` với lý do `NO_IO_STREAM`; con trỏ sau tick cuối có mẫu → `stale` kèm `ageTicks`; `alarmsOf` gộp và sắp đúng; `selectableTargets` trả hai bánh và sáu khớp theo thứ tự cố định; `diagnosticsFor` với `bundle` cho đúng thiết bị điều khiển trục theo `design.axes`.
- [ ] Implement panel: tiêu đề là thực thể đang chọn; bảng tag (giá trị, đơn vị, chất lượng bằng chữ và biểu tượng); đồ thị nhỏ lệnh so với thực bằng `ui/svg-plot.ts`; danh sách cảnh báo có nút nhảy tới tick (dùng cơ chế nhảy tick mà báo cáo lỗi đang dùng). Trạng thái bình thường không có màu; màu chỉ cho cảnh báo. Không có nhãn "khỏe" hay dấu xanh.
- [ ] Chọn: bấm vào bánh hoặc khớp trong 2D và 3D; danh sách `selectableTargets` là một `listbox` điều khiển được bằng mũi tên và Enter; thực thể có cảnh báo được viền và có biểu tượng trong twin.
- [ ] E2E (`mujoco-diagnostics.spec.ts`, runtime MuJoCo mobile thật): chạy `MJ-TRAY01` với một lịch dừng `emergency` → mở tab Chẩn đoán bằng bàn phím → chọn bánh trái → thấy trạng thái `fault`, mã `EXTERNAL_TRIP`, một cảnh báo nguồn `stop` → Enter trên cảnh báo đưa con trỏ phát lại tới tick áp dụng. Chạy bằng `node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port <cổng trống> --runtime-port <cổng trống> mujoco-diagnostics.spec.ts`.
- [ ] Commit `feat: diagnostics tab — select an axis, read its drive, I/O and alarms`.

## Task E18 — Ba ngôn ngữ, a11y, ba bề rộng và hai mẫu tĩnh

**Files:**

- Create `lab/public/samples/catalog.json`, `lab/public/samples/hardware-candidate/`, `lab/public/samples/stop-report/`.
- Create `lab/src/reports/samples.ts`; Modify `lab/src/ui/replay-workspace.ts` hoặc màn hình danh sách mẫu hiện có (thêm hai mục; đọc file để xác định đúng chỗ).
- Test `lab/tests/unit/samples.test.ts`, `lab/tests/e2e/samples-offline.spec.ts`, `lab/tests/e2e/brand-accessibility.spec.ts` (thêm panel mới vào danh sách đã quét).

**Interfaces:** consumes gói ứng viên của E19 (sinh từ `serve-hw-a-v1`) và `StopReportV1` của nhóm S1 từ campaign đã ghi; produces

```ts
// reports/samples.ts
export interface SampleEntry {id: 'hardware-candidate' | 'stop-report'; kind: 'hardware_candidate' | 'stop_report'; manifest: string; sha256: string; calibration: 'not_calibrated'; accepted: false}
export function verifySample(entry: SampleEntry, fetchBytes: (path: string) => Promise<Uint8Array>): Promise<{ok: boolean; mismatched: string[]}>;
```

- [ ] Task này chạy sau E19. Sinh hai mẫu bằng công cụ của chính sản phẩm: `node scripts/lab-hardware.mjs package --design robotics/catalog/electrical/serve-hw-a-v1.json --out <tmp>` rồi chép vào `lab/public/samples/hardware-candidate/`; chép bốn `stop-report.json` của nhóm S1 từ archive `stop-v1` vào `lab/public/samples/stop-report/`. Không sửa tay file nào; `catalog.json` ghi sha256 của manifest từng mẫu.
- [ ] Test: `verifySample` phát hiện một file bị đổi một byte; mục catalog thiếu `accepted:false` hoặc `calibration` bị từ chối.
- [ ] E2E offline (`samples-offline.spec.ts`, không có runtime, mạng bị chặn ngoài origin): mở mẫu `hardware-candidate` → thấy bảng phân bổ, kiểm tra, dây, checklist; mở `stop-report` → thấy bốn kiểu dừng cạnh nhau với quãng đường hoặc "không có dữ liệu", và dòng giới hạn `not_calibrated`.
- [ ] Quét a11y và bố cục cho phần Điện, panel Chẩn đoán và hai màn hình mẫu ở 390, 1024, 1440 px và ba ngôn ngữ: axe serious/critical = 0; không tràn ngang; reduced motion tắt chuyển động của đánh dấu cảnh báo.
- [ ] CLD04 của R5.4: image arm64 phục vụ route `engineering/electrical` và một run có lịch dừng cho panel đọc.
- [ ] Commit Lab `feat: static hardware-candidate and stop-report samples; a11y and i18n for the R5 panels`.

## Task E19 — Gói ứng viên phần cứng

**Files:**

- Create `source/packages/lab-runtime/src/engineering/electrical/package.ts`.
- Modify `source/scripts/lab-hardware.mjs` (thêm `package`, `verify`), `source/packages/contracts/schemas/hardware-candidate-v1.schema.json` (dùng `HardwareCandidateV1` đã khai ở E10).
- Modify `source/packages/lab-runtime/src/engineering/gateway.ts` và `v2/gateway.ts` (route tải gói: `GET /lab/v2/engineering/electrical/<digest>/package`).
- Test `source/tests/unit/electrical-package.test.ts`, `source/tests/integration/lab-hardware-cli.test.ts` (thêm ca).

**Interfaces:** consumes `renderElectricalDocuments`, `compareOptions`, `deriveDriveModel`; produces

```ts
export function buildHardwareCandidate(input: {bundle: ElectricalBundleV1; context: DesignContext; safety: SafetyRequirementsV1 | null;
  evidenceRefs: {runId: string; reportDigest: string; kind: 'stop' | 'io' | 'tray'}[]}): {files: {path: string; bytes: Uint8Array}[]; manifest: HardwareCandidateV1};
export function verifyHardwareCandidate(read: (path: string) => Promise<Uint8Array | null>): Promise<string[]>;   // danh sách vấn đề; rỗng là đạt
```

```sh
node scripts/lab-hardware.mjs package --design <file> --out <dir> [--evidence <campaign dir>]
node scripts/lab-hardware.mjs verify  --package <dir>                                          # exit 0 khi không có vấn đề
```

- [ ] Test: bundle `blocked` → `ELECTRICAL_BUNDLE_BLOCKED`, không file nào được ghi; manifest có `status:'draft'`, `hardwareValidated:false`, `controlAuthority:false` (schema là hằng; thử đặt `true` phải bị từ chối); `files` gồm thiết kế, các hồ sơ đã dùng, sổ yêu cầu, bundle, bảy tài liệu, `drive-model.derived.json`, `drive-model.diff.md`, `checksums.json`; **không** có blob tài liệu hãng nào; `readiness[]` có một mục `blocked_external` cho bàn thử và một cho an toàn, và một mục `pending` cho mỗi nhóm "chưa kiểm"; hai lần sinh trùng byte.
- [ ] Test `verifyHardwareCandidate`: gói nguyên vẹn → `[]`; đổi một byte trong `wire-list.csv` → `['CHECKSUM_MISMATCH wire-list.csv']`; xóa một file → `['FILE_MISSING …']`; sửa `manifest.json` thành `hardwareValidated:true` → `['MANIFEST_INVALID']`; thêm file lạ → `['FILE_UNEXPECTED …']`.
- [ ] Implement. `drive-model.diff.md` là bảng `changes` của `deriveDriveModel` cộng số nhóm nguồn đã thành `manufacturer` trên bảy.
- [ ] Commit `feat: export the hardware configuration candidate package`; re-pin Lab.

## Task E20 — Kiểm cloud

**Files:**

- Create `source/scripts/record-r5-container.mjs` (theo mẫu `record-r4-container.mjs`), `source/docs/operations/r5-qualification.md`.
- Modify `source/deploy/lab-runtime/` chỉ khi image thiếu file mới của catalog; không thêm gói hệ thống.
- Test `source/tests/integration/r5-container.test.ts` (bỏ qua có lý do khi không có Docker).

**Interfaces:** consumes image do `deploy/lab-runtime/build.sh` dựng; produces `container.json` cho recorder (CLD04) và hướng dẫn CLD05, CLD06.

- [ ] Xác nhận Docker (OrbStack) đang chạy; không chạy thì dừng task và báo, không ghi `not_run` thay cho việc chưa thử.
- [ ] CLD04: dựng `linux/arm64` từ cây sạch; trong container: compile ba phương án và so digest với bản Mac (**phải trùng**); một run `stop-v1` nhóm S1 `emergency`+`coast`; một run danh định `vio-v1` nếu E14 không bị cắt; `docker diff` rỗng; tiến trình không chạy root. Ghi `container.json` kèm digest image.
- [ ] CLD05: dựng `linux/amd64` từ cùng commit (chỉ cần dựng được trên Mac). Test Python của tool root chạy trên host x86-64 native bằng workflow GitHub Actions hiện có sau khi push **nhánh** `r5/hardware-electrical` (không phải `main`); ghi số run và số test. Push nhánh cần lệnh của người dùng nếu phiên làm việc chưa được phép. Sau lần gộp, một lần push nhánh lên repo `mekoniq` có thể tạo bản preview trên Vercel cho cả app cloud lẫn Lab; cấu hình đó chưa được kiểm, nên nêu điều này khi xin lệnh push.
- [ ] CLD06: viết gói phát hành theo mẫu của CLD03 (`release-package-cld03-…md` trong archive R4): tuple, image, các bước smoke (health → compile ba phương án → một run dừng → so với Mac), đường lùi. Origin trình duyệt mà Cloud Run cho phép lấy theo trạng thái M8 của lần gộp lúc đó: `https://lab.mekoniq.app` nếu M8 đã xong, ngược lại `https://mekoniq-lab.vercel.app`. **Không thực hiện.** Ghi CLD06 `not_run`, lý do `deploy_order_pending`.
- [ ] Commit `test: container checks for R5 and the Cloud Run smoke package`.

## Task E21 — Qualification và đóng R5

**Files:**

- Create `source/scripts/sim-extension-r5.mjs` (bảng suite, case, gate), `source/scripts/record-sim-extension-r5.mjs`, `source/scripts/r5-readback.mjs`.
- Modify `source/scripts/sim-extension-qualification.mjs` (nhánh `release === 'r5'` trong `checkQualification`), `source/tests/acceptance/sim-extension.acceptance.test.ts`.
- Create `source/docs/implementation/hardware-electrical/status-<ngày>.md`, `source/docs/implementation/hardware-electrical/design/` (bản sao bộ tài liệu này).
- Modify `robot/CLAUDE.md` (mục trạng thái R5).

**Interfaces:** consumes mọi suite của E02–E19, archive `stop-v1` và `vio-v1`, `container.json`, record R4 và chuỗi trước ở cùng tuple; produces `qualification.json` (`release:'r5'`, `accepted:false`).

- [ ] Viết `tableR5()` theo mẫu `tableR4()`: mỗi case ở [contracts §8](../05-r5-contracts-and-evidence.md#8-case-và-gate) ánh xạ tường minh tới suite, file test và artifact. Test bảng: 48 case, 9 gate đóng R5, hai gate ngoài (`G-BENCH1`, `G-SAFE1`) luôn `blocked_external`, không case nào thiếu suite, không suite nào không thuộc case nào.
- [ ] Viết reader: đọc và hash lại mọi artifact; không tin status trong manifest; `stop-v1` và `vio-v1` được dựng lại bằng verifier của chính chúng; gói ứng viên qua `verifyHardwareCandidate`; digest bundle của ba phương án trong record phải trùng digest trong `container.json`.
- [ ] Đóng băng tuple: nếu `main` đã đi tiếp thì `git merge main` vào nhánh trước; hai phía sạch (`sourceDirty` và `labDirty` rỗng); `pin.sourceCommit` bằng commit source tính theo đường dẫn; không commit nào sau đó. Chạy **một** chuỗi ghi đầy đủ (người dùng chốt ngày 25/11) theo `docs/operations/r4-qualification.md` cộng bước r5: Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → r4 → r5, output ngoài repo, mỗi bước exit 0, dưới `caffeinate -dims`, màn hình mở khóa. Runbook R4 được viết trước lần gộp; áp dụng nó cùng các ruling trong `docs/2026-11-20-codebase-merge/rehearsal-2026-11-25.md`, nhất là ruling 1–3 về commit source, các chỗ còn đọc `HEAD` và thứ tự so với commit pin. Dừng stack Supabase `mekoniq-w00-w04` cho bước owned-source-ci cần sự đồng ý của người dùng cho lần chạy này.
- [ ] Đọc lại record bằng guard: `LAB_SIMEXT_EVIDENCE_DIR=<record> pnpm test:acceptance -- sim-extension`. Expected: PASS; đếm case từ dữ liệu thực, không ghi trước con số.
- [ ] Xuất bản record (JSON cấp trên và `index.json`) vào `source/docs/implementation/evidence/`, archive thô ngoài Git ở `robot/evidence-archive/r5-chain-<sha>/`. Viết tài liệu trạng thái: gate nào `tested`, case nào `not_run` và vì sao, G-CLOUD3 ở trạng thái thực, hai gate ngoài `blocked_external`, mọi record `accepted:false`.
- [ ] Chép bộ tài liệu thiết kế này vào `source/docs/implementation/hardware-electrical/design/`. Cập nhật `CLAUDE.md`.
- [ ] **Dừng ở đây.** Fast-forward `main`, push, deploy Cloud Run và Lab, và ký acceptance là bốn việc riêng, mỗi việc cần lệnh của người dùng.

**Exit:** R5 có record đọc lại được ở một tuple; không gì được push lên `main` hay deploy; không ai ký thay người ký.
