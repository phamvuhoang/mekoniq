# R5.1 Device Profiles and Electrical Design — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catalog nhận hồ sơ thiết bị có nguồn, mức bằng chứng tính bằng máy; thiết kế điện có hợp đồng và admission; ba phương án Serve nạp được.

**Architecture:** Hồ sơ thiết bị là tài liệu anh em của `ComponentRevision`, nạp bởi `loadCatalog` qua khóa tùy chọn `deviceProfiles`. Validator và hàm mức bằng chứng là TS thuần trong `engineering/electrical/`. Bản tóm tắt EDS/ESI do một script Python thư viện chuẩn sinh và được commit; TS chỉ đọc JSON đó.

**Tech Stack:** theo [Global Constraints](README.md#global-constraints).

**Spec:** [R5-A §2–5](../03-r5-hardware-electrical-spec.md), [contracts §1–3](../05-r5-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Riêng gói này: không sửa `ComponentRevision` hay bất kỳ linh kiện nào đang có trong catalog; mọi linh kiện, hồ sơ và tài liệu là file mới; không task nào chạy mô phỏng.

## Review Focus

1. **Catalog cũ, không có `deviceProfiles`:** `loadCatalog` trả đúng kết quả cũ, `deviceProfiles` rỗng, không có problem mới (test ở E03).
2. **Hồ sơ dẫn tới linh kiện đã đổi revision:** digest lệch phải chặn hồ sơ đó, không chặn cả catalog (test ở E03).
3. **Tài liệu hãng tự mâu thuẫn** (manual ELD3 ghi 8 DI ở một mục, 6 DI ở bảng chân): hồ sơ chỉ khai chân có trong bảng chân, và mâu thuẫn xuất hiện ở danh sách "chưa kiểm" (test ở E05).
4. **Firmware `null`:** mức vẫn tính được, và luôn có đúng một mục `UNVERIFIED_FIRMWARE` cho thiết bị đó (test ở E03).
5. **Thiết kế điện nhắc một instance không có trong assembly:** từ chối, không tạo thiết bị "mồ côi" (test ở E04).

---

## Task E00 — Khóa baseline sau R4

**Files:**

- Create `source/docs/implementation/post-r4-baseline.md`. Read `lab/config/source-runtime.lock.json`, `source/docs/implementation/virtual-commissioning/status-2026-11-25.md`, `source/scripts/native-sim/r2a-arm-baseline.json`, `source/robotics/catalog/catalog.json`, `source/scripts/repo-identity.mjs`, và các ruling trong `docs/2026-11-20-codebase-merge/rehearsal-2026-11-25.md`.

**Interfaces:** consumes tuple R4 đã về `main`; produces tài liệu baseline. Không có API mới.

- [ ] Chụp `git -C source status --short`, nhánh đang checkout, `main` so với `origin/main`, commit source và commit Lab theo đường dẫn (`git -C source log -1 --format=%H -- . ':(exclude)apps/lab'` và `git -C source log -1 --format=%H -- apps/lab`), nội dung lock, và `curl -s https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app/lab/v2/health` (`sourceCommit`, `schemaHash`). Số đối chiếu lúc 18:05 ngày 25/11: `main` = `origin/main` = `c7df3381`; commit source `c7df3381`, commit Lab `dfa9c532`; pin và cloud `0650ecbd`, schema hash `353b06e2…`. Trên `main`, pin bằng commit mà Cloud Run phục vụ chứ không bằng commit source; đó là trạng thái đúng. Cây bẩn, hoặc pin trên `main` khác `sourceCommit` của Cloud Run → dừng và báo, không tự sửa.
- [ ] Ghi trạng thái lần gộp: `robot/lab` là symlink tới `source/apps/lab`; M8, M9, M10 đã tới đâu (`curl -sI https://lab.mekoniq.app`, `curl -sI https://mekoniq.app`, ngày sửa `robot/CLAUDE.md`). Hỏi người dùng có phiên nào khác đang làm trong `source/` không; có thì thống nhất ai giữ cây làm việc trước khi tạo nhánh.
- [ ] Hỏi người dùng đã gửi sáu câu hỏi cho Hoàng Anh chưa ([roadmap §4.1](../02-roadmap.md#41-câu-hỏi-gửi-hoàng-anh-trước-e03)); ghi ngày gửi và câu trả lời nếu đã có. Chưa gửi → nhắc một lần rồi làm tiếp: E00–E02 và các bước code của E03 không phụ thuộc câu trả lời.
- [ ] Hash lại năm schema và 25 file trong `r2a-arm-baseline.json` và so với giá trị ghim: `perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/mujoco-native-probe.test.ts`. Expected: PASS.
- [ ] Chạy guard của record R4 đang trong cây theo đúng lệnh trong `docs/operations/r4-qualification.md` và ghi nguyên kết quả.
- [ ] Ghi trạng thái catalog: số linh kiện (13), số báo giá (0), danh sách linh kiện `candidate`, và digest của `catalog.json`.
- [ ] Tạo nhánh `r5/hardware-electrical` từ `main`. Commit `docs: lock the post-R4 baseline for R5`. Đây là commit phía source; chưa cần pin vì chưa có thay đổi runtime và chưa ghi evidence nào.

**Exit:** baseline review được; không record nào bị đổi; nhánh R5 tồn tại.

## Task E01 — Spike: catalog mở rộng và bản tóm tắt file mô tả

**Files:**

- Create `source/docs/research/2026-11-electrical-spike.md`, thư mục output thô `source/docs/research/electrical-spike/`.
- Không sửa module nào ở task này. Mọi thử nghiệm chạy trong một bản sao tạm của `robotics/catalog` ngoài repo.

**Interfaces:** produces bảng quyết định trong tài liệu spike: nơi đặt hồ sơ thiết bị và thiết kế điện, tác động lên closure và artifact, định dạng bản tóm tắt file mô tả.

- [ ] Chép `robotics/catalog` ra thư mục tạm, thêm khóa `deviceProfiles: []` vào `catalog.json` của bản sao, gọi `loadCatalog` trên bản sao bằng một script tạm. Kỳ vọng: cùng `components`, `models`, `quotes`, `problems` như bản gốc.
- [ ] Trong một clone tạm của `source` (không phải cây đang dùng), thêm một file dưới `robotics/catalog/devices/` và so `closureIdentity()` của `scripts/lab-irsim.mjs` trước và sau. Kỳ vọng theo `PORTABLE_TOOL_PATHS` ngày 25/11: digest portable và native **không đổi** (catalog không nằm trong closure nào). Ghi kết quả thực. Chạy `node scripts/export-lab-runtime.mjs <tmp>` trước và sau, ghi artifact có đổi không.
- [ ] Liệt kê mọi nơi đọc `robotics/catalog`: `grep -rn "robotics/catalog\|catalogRoot" scripts packages tests apps/lab/scripts`. Với mỗi nơi, ghi nó đọc file theo tên hay quét thư mục.
- [ ] Chạy hai probe đã có trên file mô tả đã ghim và lưu output: `python3 -I -B ../docs/2026-11-25-R5~/probes/drive/eds_summary.py <ELD2-CAN.eds.eds>` và `esi_summary.py <ELD3_V1.10.xml>` (file ở `docs/2026-11-25-R5~/research/vendor-documents/`). Từ output, chốt hình dạng `DescriptionSummary`: `{kind:'eds'|'esi', fileSha256, vendorId, productCode, revision, supportedModes: string[], objects: {index: string, subindex: number, name: string, access: 'ro'|'rw'|'wo', pdoMappable: boolean}[]}`, sắp theo `(index, subindex)`.
- [ ] Ghi tài liệu spike với quyết định cho từng mục. Commit `docs: record the electrical catalog spike`.

**Exit:** các quyết định được khóa bằng số đo, hoặc áp dụng [README §4](README.md#4-khi-nào-dừng-một-nhánh) mục đầu.

## Task E02 — Hợp đồng hồ sơ thiết bị và mức bằng chứng

**Files:**

- Create `source/packages/contracts/schemas/device-profile-v1.schema.json`.
- Modify `source/scripts/generate-contracts.mjs` (thêm `'device-profile-v1': 'DeviceProfileV1'` vào `engFiles`).
- Create `source/packages/lab-runtime/src/engineering/electrical/contracts.ts`, `source/packages/lab-runtime/src/engineering/electrical/profiles.ts`.
- Test `source/tests/contracts/electrical-contracts.test.ts`, `source/tests/unit/electrical-profiles.test.ts`. Create `source/tests/support/electrical.ts` (builder cho hồ sơ và thiết kế trong test).

**Interfaces:** produces

```ts
// engineering/electrical/contracts.ts
export type {DeviceProfileV1, IOPointV1, DriveCapabilityV1, SafetyClaim, DeviceDocument} from '../../../../contracts/generated/engineering';
export const validateDeviceProfile: (input: unknown) => Checked;          // schema + quy tắc ngữ nghĩa, Problem[] như engineering/contracts.ts
export const sealElectrical = <T extends object>(doc: T): T & {digest: string};   // sealDocument(doc, 'digest')
// engineering/electrical/profiles.ts
export type EvidenceLevel = 'candidate' | 'documented';
export function deviceEvidenceLevel(profile: DeviceProfileV1): {level: EvidenceLevel; missing: string[]};
export function safetyClaimLevel(claim: SafetyClaim, profile: DeviceProfileV1): 'manual_only' | 'certified';
export function profileSources(profile: DeviceProfileV1): SourceRef[];     // mọi SourceRef của hồ sơ, theo thứ tự ổn định
```

- [ ] Viết negative schema test: thiếu `component.digest`; `pointId` trùng; chân của `ioPoints[].pin` không có trong `connectors`; `busExposure.kind:'cyclic'` thiếu `object`; `direction:'output'` thiếu `maxCurrentA`; `drive` có mặt ở thiết bị `kind` khác `servo_drive`; `drive.modes` rỗng; thiết bị chỉ có `pv` mà `profileAccelerationRadS2` là `null`; `safety` khác `null` trên điểm có `functions` chứa `'general_purpose'`; đơn vị ngoài `ALLOWED_UNITS`; trường lạ; **trường `evidenceLevel`, `status` hoặc `verified` ở bất kỳ đâu** (phải bị từ chối như trường lạ). Positive: hồ sơ dựng từ `tests/support/electrical.ts`.
- [ ] Chạy để thấy validator chưa có: `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/contracts/electrical-contracts.test.ts`. Expected: FAIL, `Cannot find module`.
- [ ] Viết schema theo [contracts §2](../05-r5-contracts-and-evidence.md#2-tài-liệu-mới), tham chiếu `engineering-component.schema.json#/definitions/{Digest,SourceRef,Scalar}`. Object đóng; giới hạn: 16 giắc, 64 chân mỗi giắc, 32 điểm I/O, 8 giao tiếp, 32 tài liệu.
- [ ] Viết `deviceEvidenceLevel` đúng bảng ở [spec R5-A §5.1](../03-r5-hardware-electrical-spec.md#51-hồ-sơ-thiết-bị-mô-tả-những-gì). `missing` liệt kê mã lý do: `ORDER_CODE_MISSING`, `DATASHEET_MISSING`, `MANUAL_MISSING`, `ASSUMED_SOURCE`, `DESCRIPTION_FILE_MISSING`, `SAFETY_MANUAL_MISSING`.
- [ ] Viết `safetyClaimLevel`: `certified` khi và chỉ khi `claim.certificate` khác `null`, tài liệu của nó có `kind:'certificate'` trong hồ sơ, và `certificate.models` chứa `variant.orderCode`.
- [ ] `pnpm contracts:generate && pnpm contracts:check && pnpm typecheck`; focused tests; commit `feat: define the device profile contract and its evidence level`; re-pin Lab.

```ts
import {expect, test} from 'vitest';
import {deviceEvidenceLevel, safetyClaimLevel} from '../../packages/lab-runtime/src/engineering/electrical/profiles';
import {driveProfile, manufacturer} from '../support/electrical';

test('one assumed source keeps a profile at candidate and names the reason', () => {
  const p = driveProfile({ioSource: {kind: 'assumed', documentId: 'worksheet', revision: '1', locator: 'guess', contentSha256: 'a'.repeat(64)}});
  expect(deviceEvidenceLevel(p)).toEqual({level: 'candidate', missing: ['ASSUMED_SOURCE']});
});
test('a fully cited profile is documented even when the firmware is not pinned', () => {
  const p = driveProfile({firmware: null});
  expect(deviceEvidenceLevel(p)).toEqual({level: 'documented', missing: []});
});
test('a torque-off claim is certified only by a certificate that names the order code', () => {
  const p = driveProfile({orderCode: 'DRV-200', certificateModels: ['DRV-750']});
  expect(safetyClaimLevel(p.drive!.stop.torqueOff!, p)).toBe('manual_only');
  const q = driveProfile({orderCode: 'DRV-750', certificateModels: ['DRV-750']});
  expect(safetyClaimLevel(q.drive!.stop.torqueOff!, q)).toBe('certified');
});
```

## Task E03 — Catalog mở rộng, truy nguồn và kiểm chéo file mô tả

**Files:**

- Modify `source/packages/lab-runtime/src/engineering/catalog.ts` (`CatalogResult`, `loadCatalog`).
- Create `source/scripts/describe-device.py` (thư viện chuẩn; nhận file EDS hoặc ESI, in `DescriptionSummary` JSON canonical ra stdout).
- Modify `source/packages/lab-runtime/src/engineering/electrical/profiles.ts` (thêm `crossCheckDescription`).
- Create `source/robotics/catalog/devices/` (hồ sơ), `source/robotics/catalog/descriptions/<sha256>.summary.json` (bản tóm tắt); Modify `source/robotics/catalog/catalog.json`, `source/robotics/catalog/imports.json`; thêm blob vào `source/robotics/catalog/documents/`.
- Create linh kiện mới trong `source/robotics/catalog/components/` cho phương án HW-A: `orientalmotor-blvd-krd.json` (driver), `orientalmotor-blv-r-60w.json` (motor có hộp số).
- Test `source/tests/unit/engineering-catalog.test.ts` (thêm ca), `source/tests/unit/electrical-description.test.ts`, `source/tests/hardware/test_describe_device.py`.

**Interfaces:** consumes `validateDeviceProfile`, `profileSources`; produces

```ts
// catalog.ts
export interface DescriptionSummary {kind: 'eds'|'esi'; fileSha256: string; vendorId: string; productCode: string; revision: string;
  supportedModes: string[]; objects: {index: string; subindex: number; name: string; access: 'ro'|'rw'|'wo'; pdoMappable: boolean}[]}
export interface CatalogResult { /* các trường cũ */ deviceProfiles: Record<string, DeviceProfileV1>; descriptions: Record<string, DescriptionSummary> }   // khóa: digest hồ sơ; sha256 file mô tả
// profiles.ts
export function crossCheckDescription(profile: DeviceProfileV1, summary: DescriptionSummary): Problem[];
```

- [ ] Viết test catalog trước (trong file test sẵn có, dùng `build()` của nó): catalog không có `deviceProfiles` → `deviceProfiles` là `{}` và `problems` không đổi; hồ sơ có digest khai lệch → `CATALOG_DIGEST_MISMATCH` dưới `/deviceProfiles/<n>`; `component.digest` không có trong catalog → `DEVICE_PROFILE_COMPONENT_UNAVAILABLE`; nguồn `manufacturer` dẫn tới tài liệu hồ sơ không khai → `PROVENANCE_UNRESOLVED`; blob tài liệu thiếu → `BLOB_UNAVAILABLE`; tuyên bố an toàn dẫn tới tài liệu `kind:'datasheet'` → `SAFETY_CLAIM_UNSUPPORTED`; hồ sơ hỏng không làm mất hồ sơ khác.
- [ ] Chạy để thấy fail. Rồi mở rộng `loadCatalog`: đọc `index.deviceProfiles` (mảng `{file, digest}`, tùy chọn), kiểm path bằng `inside()`, validate, so digest, kiểm blob từng tài liệu bằng `checkBlob`, chạy cùng hàm `cited` trên toàn hồ sơ với danh sách tài liệu của **hồ sơ**. Đọc `descriptions/<sha256>.summary.json` cho mỗi tài liệu `description_summary`.
- [ ] Viết `describe-device.py`: EDS bằng `configparser` (đọc `[DeviceInfo]`, mọi mục `[XXXX]` và `[XXXXsubN]`, `PDOMapping`, `AccessType`, giá trị mặc định của 6502h cho `supportedModes`); ESI bằng `xml.etree.ElementTree` (`Vendor/Id`, `Device/Type@ProductCode/@RevisionNo`, `Dictionary/Objects`, `RxPdo`/`TxPdo`). In JSON có khóa sắp xếp, `objects` sắp theo `(index, subindex)`, không có timestamp. File không đọc được → exit 2 kèm mã `DESCRIPTION_UNREADABLE`.
- [ ] Test Python: chạy script hai lần trên mỗi file đã ghim và so byte; file bị cắt cụt → exit 2. `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -I -B -m pytest tests/hardware/test_describe_device.py -q -p no:cacheprovider`.
- [ ] Viết `crossCheckDescription` và test: điểm lộ `cyclic` qua đối tượng `pdoMappable:false` → `BUS_EXPOSURE_CONTRADICTS_DESCRIPTION`; chế độ ngoài `supportedModes` → `MODE_CONTRADICTS_DESCRIPTION`; đối tượng không có → `OBJECT_UNKNOWN`; hồ sơ khớp → `[]`.
- [ ] **Điểm kiểm trước khi nhập hồ sơ** (người dùng chốt ngày 25/11): xem câu trả lời của Hoàng Anh đã ghi ở E00. Danh sách ngắn khác ba phương án → dừng bước nhập, báo người dùng và đổi thiết bị theo [roadmap §4.1](../02-roadmap.md#41-câu-hỏi-gửi-hoàng-anh-trước-e03). Chưa có câu trả lời → nhập HW-A như bước dưới và ghi trong commit message rằng danh sách chưa được Hoàng Anh xác nhận.
- [ ] Nhập tài liệu của Oriental Motor (`HP-5140-8E.pdf`, `HP-5143-3E.pdf`) từ `docs/2026-11-25-R5~/research/vendor-documents/orientalmotor/` vào `robotics/catalog/documents/<sha256>` và `imports.json` (`license: 'unreviewed'`). Viết hai linh kiện và hồ sơ `blvd-krd-v1`, đọc **từ PDF đã ghim**, mỗi giá trị có `locator` là mục và trang. Điểm khởi đầu đã đọc trong đợt nghiên cứu, phải đối chiếu lại với PDF trước khi nhập: 4 DI 12–30 VDC (xuất xưởng ID-SEL0, ID-SEL1, STOP, FREE; gán lại được), 2 DO tối đa 10 mA, đường ngắt mô-men HWTO1/HWTO2 kèm đầu ra EDM, chế độ pp/pv/hm/tq. Mã đặt hàng và firmware chưa có thì để `null`.
- [ ] Focused tests; `pnpm typecheck`; commit `feat: load device profiles into the engineering catalog with provenance checks`; re-pin Lab.

```ts
test('a catalog without device profiles loads exactly as before', async () => {
  const {root, digest} = await build({mfr: 'ok'});
  const result = await loadCatalog(root);
  expect(Object.keys(result.components)).toEqual([digest]);
  expect(result.deviceProfiles).toEqual({});
  expect(result.problems).toEqual([]);
});
```

## Task E04 — Hợp đồng thiết kế điện, chính sách đấu dây và sổ yêu cầu an toàn

**Files:**

- Create `source/packages/contracts/schemas/electrical-design-v1.schema.json`, `source/packages/contracts/schemas/safety-requirements-v1.schema.json`.
- Modify `source/scripts/generate-contracts.mjs` (`engFiles`: `'electrical-design-v1': 'ElectricalDesignV1'`, `'safety-requirements-v1': 'SafetyRequirementsV1'`).
- Modify `source/packages/lab-runtime/src/engineering/electrical/contracts.ts`.
- Create `source/packages/lab-runtime/src/engineering/electrical/design.ts`.
- Test `source/tests/contracts/electrical-contracts.test.ts` (thêm ca), `source/tests/unit/electrical-design.test.ts`.

**Interfaces:** consumes `DeviceProfileV1`, `ResolvedAssembly`; produces

```ts
// contracts.ts
export type {ElectricalDesignV1, SignalV1, StopFunctionV1, WiringPolicyV1, SafetyRequirementsV1};
export const validateElectricalDesign: (input: unknown) => Checked;
export const validateWiringPolicy: (input: unknown) => Checked;
export const validateSafetyRequirements: (input: unknown) => Checked;
// design.ts — bước 1–3 của thứ tự kiểm ở contracts §3; lỗi ở đây là từ chối, không phải mục kiểm
export interface DesignContext {design: ElectricalDesignV1; profiles: ReadonlyMap<string, DeviceProfileV1>;   // khóa: device id
  resolved: ResolvedAssembly; project: {id: string; revision: number; digest: string}}
export function admitElectricalDesign(design: ElectricalDesignV1, input: {resolved: ResolvedAssembly; project: {id: string; revision: number; digest: string};
  deviceProfiles: Record<string, DeviceProfileV1>; driveAxisIds: readonly string[]}): {problems: Problem[]; context: DesignContext | null};
export function safetyEvidenceStatus(requirement: SafetyRequirementsV1['requirements'][number]): 'open' | 'documented';
```

- [ ] Negative test schema: `devices[].id` trùng; trục trùng `axisId`; tín hiệu `consumer:'safety_chain'` có `pinned`; tín hiệu `consumer:'controller'` thiếu `maxLatencyMs`; `stopFunctions` có hai mục cùng `id`; quá 64 thiết bị, 128 tín hiệu; `wiringPolicyRef` thiếu; trường lạ. Chính sách: bảng tiết diện không tăng dần; `maxVoltageDropFraction` ngoài (0, 0,2]. Sổ yêu cầu: yêu cầu không có `documents` mà khai `status` (trường `status` phải bị từ chối: trạng thái là hàm).
- [ ] Test `admitElectricalDesign`: `project.id` hoặc `revision` khác → `ELECTRICAL_PROJECT_MISMATCH`; hồ sơ không có → `DEVICE_PROFILE_UNAVAILABLE`; digest hồ sơ lệch → `DEVICE_PROFILE_DIGEST_MISMATCH`; `assemblyInstanceId` không có trong `resolved.placements` → `ELECTRICAL_INSTANCE_UNKNOWN`; hồ sơ mô tả linh kiện khác với `componentDigest` của instance → `ELD_PROFILE_COMPONENT_MISMATCH`; một trục trong `driveAxisIds` không có trong `design.axes` → `ELD_AXIS_UNMAPPED`; thiết kế hợp lệ → `problems: []` và `context` có đủ `profiles`.
- [ ] Viết schema theo [contracts §2](../05-r5-contracts-and-evidence.md#2-tài-liệu-mới). `WiringPolicyV1`: `{id, revision, digest, ampacity: {csaMm2: number; maxCurrentA: Scalar}[], signalMinCsaMm2: Scalar, maxVoltageDropFraction: Scalar, copperResistivityOhmMm2PerM: Scalar, colours: {role: string; colour: string}[], sources: {ampacity: SourceRef; drop: SourceRef}}`. `SafetyRequirementsV1.requirements[]`: `{id, function, trigger, stopCategory: 0|1|2, deviceIds: string[], signalIds: string[], documents: DeviceDocument[], notes: string}`.
- [ ] Viết `admitElectricalDesign` và `safetyEvidenceStatus` (`documented` khi có ít nhất một tài liệu `safety_manual` hoặc `certificate` và mọi `deviceIds` có tuyên bố ngắt mô-men hoặc là thiết bị `safety_device`).
- [ ] `pnpm contracts:generate && pnpm contracts:check && pnpm typecheck`; focused tests; commit `feat: define the electrical design, wiring policy and safety requirements contracts`; re-pin Lab.

```ts
test('a safety-chain signal can never carry a pinned allocation', () => {
  const d = design({signals: [signal({id: 'estop-chain', consumer: 'safety_chain', pinned: {deviceId: 'drive-left', pointId: 'IN2'}})]});
  const r = validateElectricalDesign(d);
  expect(r.ok).toBe(false);
  expect(r.problems.map(p => p.code)).toContain('SAF_SIGNAL_ON_ORDINARY_IO');
});
```

## Task E05 — Ba phương án Serve và bàn giao R5.1

**Files:**

- Create `source/scripts/generate-electrical-fixture.mjs`, `source/robotics/catalog/electrical/` (`serve-hw-a-v1.json`, `serve-hw-b-v1.json`, `serve-hw-c-v1.json`, `wiring-policy-v1.json`, `serve-safety-requirements-v1.json`, `README.md`, `manifest.json`).
- Create linh kiện và hồ sơ còn thiếu cho ba phương án trong `source/robotics/catalog/{components,devices}/`: `zltech-zlac8015d`, bánh hub `zltech-zllg65asm250`, một module I/O, bộ điều khiển, DC/DC, hộp cầu chì, nút E-stop, rơ-le an toàn, contactor, công tắc bumper, cảm biến dock, đèn, còi. Thiết bị chưa có tài liệu ghim dùng nguồn `assumed`.
- Modify `lab/scripts/sync-engineering-contracts.mjs` (chép thư mục `electrical/` và các hồ sơ đã dùng vào fixture Serve của Lab).
- Test `source/tests/unit/electrical-fixture.test.ts`, `source/tests/unit/engineering-compile-fixtures.test.ts` (chỉ chạy lại, không sửa).

**Interfaces:** consumes mọi validator của E02–E04; produces

```js
// scripts/generate-electrical-fixture.mjs
export function generateElectricalFixture(outDir: string): Promise<void>;   // tất định; manifest.json liệt kê path, sha256, bytes
```

- [ ] **Điểm kiểm thứ hai:** nếu Hoàng Anh vẫn chưa trả lời, hỏi người dùng một lần trước khi nhập ZLAC8015D và các thiết bị còn lại: nhập theo mặc định hay chờ. Làm theo câu trả lời đó.
- [ ] Nhập tài liệu ZLTECH (`ZLAC8015D_manual_v1.02_20231030_zh.pdf`, `ZLLG65ASM250-L_V3.15.pdf`) vào catalog như ở E03 và viết hồ sơ `zlac8015d-v1` từ PDF đã ghim. Điểm khởi đầu cần đối chiếu lại: 2 DI mức 5 V với `assignmentPersistence:'volatile'`, 2 DO, hai đầu ra phanh giữ, **không có** đường ngắt mô-men (`drive.stop.torqueOff: null`).
- [ ] Viết test fixture trước: sinh hai lần vào hai thư mục tạm và so byte; mỗi thiết kế qua `validateElectricalDesign`; mỗi hồ sơ được nhắc có trong catalog; cả ba thiết kế có **cùng** tập `signals[].id`; `serve-hw-b-v1` có `stopFunctions` `emergency` với `requirementId` trỏ tới yêu cầu dùng contactor và rơ-le an toàn; mức của `blvd-krd-v1` và `zlac8015d-v1` đúng như tài liệu cho phép (ghi mức thực vào test sau khi nhập, không ép `documented`).
- [ ] Viết generator: project là `serve-3d-project.json` của fixture `robotics/simulation-mujoco/fixtures/serve-tray-v1/` (project mà `MJ-TRAY01` chạy), để thiết kế điện và campaign dừng của gói 03 nói về cùng một robot; đọc `id` và `revision` từ file đó, không gõ lại. Danh sách tín hiệu ở [spec R5-A §5.4](../03-r5-hardware-electrical-spec.md#54-ba-phương-án-cho-serve); `wiring-policy-v1` với mọi nguồn `assumed` (bảng dòng chưa ghim được).
- [ ] Xác nhận legacy giữ byte: `perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/unit/engineering-compile-fixtures.test.ts tests/unit/engineering-assembly.test.ts tests/unit/drive-fixture.test.ts`. Expected: PASS, không snapshot nào đổi.
- [ ] Commit phía source `feat: add the three Serve hardware options as electrical design fixtures`. Commit phía Lab `build: sync the electrical fixtures into the Lab` cho thay đổi của `sync-engineering-contracts.mjs` (chỉ đụng `apps/lab`).
- [ ] Re-pin Lab theo [README §2](README.md#2-quy-ước-thực-thi): bước sync chép thư mục `electrical/` vào fixture của Lab, và commit pin mang các file đó. Sau commit pin, `pnpm typecheck` ở root (nay gồm cả Lab) phải đạt.
- [ ] CLD04 của R5.1: dựng image arm64 từ cây sạch và chạy `tests/unit/electrical-*.test.ts` cùng `tests/unit/engineering-catalog.test.ts` trong container.

**Exit:** G-DEV1 kiểm được (DEV01–DEV05; DEV06 thuộc E11). Ba phương án nạp được; chưa có phân bổ hay netlist.
