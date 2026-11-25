# R5.2 I/O Allocation, Netlist and Wiring Documents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Từ một thiết kế điện đã admission, sinh tất định bảng phân bổ I/O, netlist, kết quả kiểm quy tắc, BOM mở rộng và bộ tài liệu đấu dây; phục vụ qua route engineering và qua CLI.

**Architecture:** Bốn hàm thuần (`allocateIo`, `deriveNetlist`, `checkElectrical`, `extendBom`) được `compileElectrical` gọi theo thứ tự cố định và niêm phong thành `ElectricalBundleV1`. Service engineering lưu bundle cạnh bundle engineering, không đổi digest của nó. Tài liệu là hàm thuần của bundle.

**Tech Stack:** theo [Global Constraints](README.md#global-constraints).

**Spec:** [R5-A §6–7](../03-r5-hardware-electrical-spec.md), [contracts §2–3, §7–8](../05-r5-contracts-and-evidence.md).

## Global Constraints

Áp dụng toàn bộ [Global Constraints](README.md#global-constraints). Riêng gói này: không hàm nào đọc đồng hồ, môi trường hay hệ thống file; không dùng `Math.pow`, `Math.sqrt` hay hàm siêu việt trong đường tính của bundle; mọi mảng đầu ra được sắp theo khóa ổn định trước khi niêm phong.

## Review Focus

1. **Hai tín hiệu tranh một chân duy nhất hợp lệ:** đúng một cái được gán, cái kia vào `unassigned` với `NO_FREE_POINT`, và kết quả không phụ thuộc thứ tự khai báo (test ở E06).
2. **Người thiết kế ghim một tín hiệu vào chân đang mang chức năng không gán lại được:** `IOA_PINNED_CONFLICT`, không âm thầm bỏ ghim (test ở E06).
3. **Thiết kế đổi một tín hiệu:** id của mọi dây không liên quan giữ nguyên (test ở E07).
4. **Chính sách đấu dây `assumed`:** mọi dây mang nhãn đó và bundle có mục `UNVERIFIED_ASSUMED_SOURCE` cho chính sách, nhưng bundle vẫn `compiled` (test ở E08).
5. **Bundle `blocked`:** `docs` và `package` từ chối, `driveModelDraft` là `null`, và route vẫn trả bundle để giao diện hiện lý do (test ở E08, E09).

---

## Task E06 — Phân bổ I/O

**Files:**

- Create `source/packages/lab-runtime/src/engineering/electrical/allocate.ts`.
- Test `source/tests/unit/electrical-allocate.test.ts`.

**Interfaces:** consumes `DesignContext` (E04); produces

```ts
export const IO_COMPATIBILITY: Readonly<Record<IoElectrical, readonly IoElectrical[]>>;   // kiểu của tín hiệu trường → kiểu điểm I/O nhận được; bảng có version trong file này
export type AllocationReason = 'NO_CANDIDATE_DEVICE'|'DIRECTION_MISMATCH'|'ELECTRICAL_MISMATCH'|'VOLTAGE_OUT_OF_RANGE'|'OUTPUT_OVERCURRENT'|'POINT_RESERVED'|'NOT_BUS_EXPOSED'|'LATENCY_EXCEEDED'|'SAFETY_POINT_RESERVED'|'NO_FREE_POINT';
export function candidatePoints(signal: SignalV1, context: DesignContext): {deviceId: string; pointId: string}[] | {rejected: {code: AllocationReason; candidates: number}[]};
export function allocateIo(context: DesignContext): {allocation: IoAllocationV1; checks: CheckResult[]};
```

- [ ] Viết test trước, mỗi mã lý do một ca tối thiểu dựng bằng `tests/support/electrical.ts`: không thiết bị nào trên bus của bộ điều khiển; chỉ có điểm sai hướng; `pnp_sink_input` gặp tín hiệu `dry_contact`; tín hiệu 24 V gặp điểm 5 V; DO 10 mA gặp tải 0,2 A; điểm `reassignable:false` có chức năng khác; điểm `busExposure.kind:'none'`; điểm `acyclic` 100 ms gặp `maxLatencyMs: 40`; điểm có `safety` khác `null`; hai tín hiệu một điểm.
- [ ] Test tất định: `allocateIo` hai lần cho `JSON.stringify` trùng; đảo thứ tự `design.signals` và `design.devices` cho cùng `allocation` sau khi sắp.
- [ ] Test ghim: tín hiệu ghim hợp lệ xuất hiện trong `assigned` với `pinned:true` và không bị đổi dù có ứng viên "tốt hơn"; ghim vào điểm không hợp lệ → check `IOA_PINNED_CONFLICT` mức `blocking`, tín hiệu vào `unassigned`.
- [ ] Test an toàn: tín hiệu `consumer:'safety_chain'` không bao giờ có trong `assigned`, `unassigned` hay `spare`; nó không tiêu thụ điểm nào.
- [ ] Chạy để thấy fail: `perl -e 'alarm 180; exec @ARGV' pnpm exec vitest run tests/unit/electrical-allocate.test.ts`.
- [ ] Implement. Ghép cặp bằng đường tăng (Kuhn): duyệt tín hiệu theo `(số ứng viên, id)`, ứng viên theo `(cyclic trước, deviceId, pointId)`. Tín hiệu `required:true` không được gán sinh check `IOA_SIGNAL_UNALLOCATED` mức `blocking`; `required:false` sinh mức `warning`. Điểm `assignmentPersistence:'volatile'` được gán sinh `IOA_ASSIGNMENT_VOLATILE`. Không còn điểm dư cùng hướng sinh `IOA_SPARE_LOW`.

```ts
// ponytail: Kuhn's augmenting paths, O(signals × points); fine up to the schema bounds (128 × 2048). Switch to Hopcroft–Karp only if a design ever reaches them.
```

- [ ] Focused tests; `pnpm typecheck`; commit `feat: allocate functional signals to device I/O points deterministically`.

```ts
test('two signals competing for the only valid point: one is assigned, the other explains why not', () => {
  const ctx = context({points: [point({pointId: 'IN1'})], signals: [signal({id: 'bumper-front'}), signal({id: 'dock-detect'})]});
  const {allocation} = allocateIo(ctx);
  expect(allocation.assigned.map(a => a.signalId)).toEqual(['bumper-front']);
  expect(allocation.unassigned).toEqual([{signalId: 'dock-detect', reasons: [{code: 'NO_FREE_POINT', candidates: 1}]}]);
  expect(allocateIo(context({points: [point({pointId: 'IN1'})], signals: [signal({id: 'dock-detect'}), signal({id: 'bumper-front'})]})).allocation).toEqual(allocation);
});
```

## Task E07 — Netlist và dây

**Files:**

- Create `source/packages/lab-runtime/src/engineering/electrical/netlist.ts`.
- Test `source/tests/unit/electrical-netlist.test.ts`.

**Interfaces:** consumes `DesignContext`, `IoAllocationV1`, `WiringPolicyV1`; produces

```ts
export const BUS_SIGNALS: Readonly<Partial<Record<Protocol, readonly string[]>>>;   // canopen: ['CAN_H','CAN_L','CAN_GND']; modbus_rtu: ['A','B','GND']; giao thức khác: cáp đúc
export function wireId(netId: string, a: {deviceId: string; pin: string}, b: {deviceId: string; pin: string}): string;   // `${netId}:${min}~${max}` với hai đầu mút đã sắp
export function deriveNetlist(context: DesignContext, allocation: IoAllocationV1, policy: WiringPolicyV1, safety: SafetyRequirementsV1 | null): {netlist: NetlistV1; checks: CheckResult[]};
```

- [ ] Viết test trước trên một thiết kế nhỏ (pin, cầu chì, hai drive, bộ điều khiển, một bumper): net nguồn của ray đi qua thiết bị bảo vệ; mỗi ray có một net hồi; bus CANopen nối chuỗi theo thứ tự `members` với ba dây mỗi đoạn; tín hiệu đã gán có hai dây (tín hiệu và hồi về `commonPin`); tín hiệu `unassigned` không có net; trục có hai dòng cáp (`motor`, `encoder`); giao tiếp `usb`/`ethernet` là một dòng cáp, không có dây.
- [ ] Test lỗi cấu trúc, mỗi lỗi một check `blocking`: chân không có trong hồ sơ → `ELD_PIN_UNKNOWN`; một chân trong hai net → `ELD_PIN_REUSED`; thành viên bus không có giao tiếp cùng giao thức → `ELD_BUS_PROTOCOL_MISMATCH`; hai thành viên cùng địa chỉ → `ELD_BUS_ADDRESS_DUPLICATE`; điểm I/O không có `commonPin` mà tín hiệu có `returnPin` → `ELD_PIN_UNKNOWN`.
- [ ] Test an toàn: yêu cầu trong sổ nhắc `signalIds` → một net `kind:'safety'`, `reviewRequired:true`, `nodes` đúng bằng đầu mút của các tín hiệu đó, và **không** có phần tử nào trong `wires` mang `netId` đó.
- [ ] Test id ổn định: thêm một tín hiệu vào thiết kế; mọi `wires[].id` của thiết kế cũ vẫn có mặt nguyên văn trong kết quả mới.
- [ ] Implement. Tiết diện: dây nguồn lấy tiết diện nhỏ nhất của `policy.ampacity` có `maxCurrentA` ≥ dòng của nhánh; dây tín hiệu lấy `signalMinCsaMm2`; `Scalar.source` của tiết diện là `policy.sources.ampacity`. Màu theo `policy.colours` theo vai trò. `lengthM` chép từ `feeds[].lengthM`, còn lại `null`.
- [ ] Focused tests; commit `feat: derive the electrical netlist and wire list with stable ids`.

## Task E08 — Bộ quy tắc, `compileElectrical`, service và route

**Files:**

- Create `source/packages/contracts/schemas/electrical-bundle-v1.schema.json`; Modify `source/scripts/generate-contracts.mjs` (`engFiles`: `'electrical-bundle-v1': 'ElectricalBundleV1'`).
- Create `source/packages/lab-runtime/src/engineering/electrical/rules.ts`, `source/packages/lab-runtime/src/engineering/electrical/compile.ts`.
- Modify `source/packages/lab-runtime/src/engineering/gateway.ts` (`compileElectrical` trên service; lưu bundle bằng `createValidationStore`-kiểu store riêng `electrical/` cạnh bundle), `source/packages/lab-runtime/src/v2/gateway.ts` (`engineeringRoute` nhận thêm `electrical`; health thêm năng lực `electrical_bundle_v1`).
- Test `source/tests/unit/electrical-rules.test.ts`, `source/tests/unit/electrical-compile.test.ts`, `source/tests/integration/electrical-gateway.test.ts`, `source/tests/contracts/electrical-contracts.test.ts` (thêm bundle).

**Interfaces:** consumes E04, E06, E07; produces

```ts
// rules.ts
export function checkElectrical(context: DesignContext, allocation: IoAllocationV1, netlist: NetlistV1, policy: WiringPolicyV1, safety: SafetyRequirementsV1 | null): CheckResult[];
// compile.ts
export const ELECTRICAL_COMPILER_VERSION = 'electrical-compiler/1';
export const ELECTRICAL_LIMITS = {devices: 64, signals: 128, wires: 512, jsonBytes: 2 * 1024 * 1024} as const;
export function compileElectrical(input: {design: ElectricalDesignV1; resolved: ResolvedAssembly; project: {id: string; revision: number; digest: string};
  catalog: Pick<CatalogResult, 'components' | 'deviceProfiles' | 'quotes' | 'descriptions'>; policy: WiringPolicyV1; safety: SafetyRequirementsV1 | null;
  driveAxisIds: readonly string[]; schemaHash: string}): {problems: Problem[]; bundle: ElectricalBundleV1 | null};
// engineering/gateway.ts (service)
compileElectrical(sessionId: string, ref: unknown, design: unknown): Promise<{state: 'compiled' | 'blocked'; digest: string; problems: Problem[]}>;
readElectrical(sessionId: string, digest: string): Promise<ElectricalBundleV1>;
```

- [ ] Test quy tắc, mỗi quy tắc ở [spec R5-A §6.3](../03-r5-hardware-electrical-spec.md#63-tính-tiết-diện-và-kiểm-quy-tắc) một ca dương và một ca âm. Giá trị cụ thể cho các ca số: ray 24 V vào chân có dải 36–60 V → `ELD_VOLTAGE_MISMATCH`; ba nhánh 10 A trên nguồn 25 A → `ELD_POWER_BUDGET_EXCEEDED`; nhánh không có `protectionDeviceId` → `ELD_PROTECTION_MISSING`; cầu chì 30 A trên dây có khả năng tải 15 A → `ELD_PROTECTION_OVERSIZED`; nhánh 20 A, 10 m, 2,5 mm², ρ = 0,0175 Ω·mm²/m: sụt áp `2 × 10 × 20 × 0,0175 / 2,5 = 2,8 V` trên 24 V = 11,7 % > 5 % → `ELD_VOLTAGE_DROP_EXCEEDED`; cùng nhánh với `lengthM: null` → không có check sụt áp, có `UNVERIFIED_LENGTH`.
- [ ] Test "chưa kiểm": mỗi `SourceRef` `assumed` mà một kết quả dựa vào sinh đúng một `UNVERIFIED_ASSUMED_SOURCE` (khử trùng bằng `sourceKey`); firmware `null` → một `UNVERIFIED_FIRMWARE` mỗi thiết bị; điểm đã gán thuộc hồ sơ không có bản tóm tắt file mô tả → `UNVERIFIED_BUS_EXPOSURE`; dòng BOM không có báo giá → `UNVERIFIED_PRICE`.
- [ ] Test compile: ba phương án Serve compile hai lần trùng byte; `serve-hw-b-v1` **trước** khi thêm module I/O (biến thể dựng trong test) là `blocked` với `IOA_SIGNAL_UNALLOCATED` và `driveModelDraft: null`; fixture đầy đủ có `unassigned` chỉ chứa tín hiệu `required:false` hoặc rỗng; `bundle.inputs` mang digest project, `assemblyDigest`, digest thiết kế, digest và mức từng hồ sơ; `hardwareValidated` và `controlAuthority` là `false`.
- [ ] Test SAF02: chuỗi JSON của ba bundle không chứa bất kỳ mẫu nào trong `/\b(SIL ?\d|PL ?[a-e]\b|compliant|certified safe|đạt an toàn|an toàn tuyệt đối)/i` **ngoài** trường `claim` của `SafetyClaim` (trường đó là trích nguyên văn).
- [ ] Implement `checkElectrical` và `compileElectrical` theo thứ tự bảy bước ở [contracts §3](../05-r5-contracts-and-evidence.md#3-admission-và-mã-từ-chối). `state` là `'blocked'` khi có check `blocking`. `driveModelDraft` để `null` ở task này (E11 điền).
- [ ] Test tích hợp gateway theo mẫu `tests/integration` của engineering hiện có: compile project Serve → `POST /lab/v2/engineering/electrical` với `{ref, design}` → 200 `{state:'compiled', digest}`; đọc bundle qua route blob; phiên khác đọc → 403; thiết kế sai schema → 400 `INVALID_ELECTRICAL_DESIGN`; `ref` tới bundle `blocked` → 409 `ELECTRICAL_PROJECT_MISMATCH`; health có `electrical_bundle_v1`; **digest của bundle engineering trước và sau lời gọi bằng nhau**.
- [ ] `pnpm contracts:generate && pnpm contracts:check && pnpm typecheck && pnpm lint`; focused tests; commit `feat: compile electrical bundles on the engineering service`; re-pin Lab.

```ts
test('a branch longer than the policy allows is reported with the numbers that decided it', () => {
  const checks = checkElectrical(...branch({currentA: 20, lengthM: 10, csaMm2: 2.5, nominalV: 24, maxDrop: 0.05}));
  const drop = checks.find(c => c.ruleId === 'ELD_VOLTAGE_DROP_EXCEEDED')!;
  expect(drop.level).toBe('blocking');
  expect(drop.detail).toContain('2.8 V');
  expect(drop.detail).toContain('5 %');
});
```

## Task E09 — Tài liệu đấu dây, CLI và hướng dẫn soạn bằng agent

**Files:**

- Create `source/packages/lab-runtime/src/engineering/electrical/documents.ts`, `source/scripts/lab-hardware.mjs`.
- Create `source/docs/engineering-lab/electrical-drafting-brief.md`.
- Test `source/tests/unit/electrical-documents.test.ts`, `source/tests/integration/lab-hardware-cli.test.ts`.

**Interfaces:** consumes `ElectricalBundleV1`, `DesignContext`; produces

```ts
// documents.ts
export const ELECTRICAL_DOCUMENTS = ['io-allocation.md', 'wire-list.csv', 'pinout.csv', 'bom.csv', 'checks.md', 'bench-checklist.md', 'harness.yml'] as const;
export function renderElectricalDocuments(bundle: ElectricalBundleV1, context: DesignContext): {path: typeof ELECTRICAL_DOCUMENTS[number]; bytes: Uint8Array}[];
```

```sh
node scripts/lab-hardware.mjs check   --design <file> [--project <file>]            # exit 0 compiled, 1 blocked, 2 từ chối
node scripts/lab-hardware.mjs compile --design <file> --out <dir>                   # ghi electrical-bundle.json
node scripts/lab-hardware.mjs docs    --bundle <file> --out <dir> [--check] [--draw] # --check: so byte với thư mục có sẵn; --draw: gọi wireviz nếu có
```

- [ ] Test tài liệu: mỗi file sinh hai lần trùng byte; dòng đầu của mỗi file mang digest bundle và `electrical-compiler/1`; `wire-list.csv` có đúng `bundle.netlist.wires.length` dòng dữ liệu và cột `id,net,from,to,csa_mm2,colour,length_m,current_a,csa_source`; `bench-checklist.md` có đúng một mục cho mỗi check `unverified`; `io-allocation.md` liệt kê `unassigned` kèm mã lý do; `harness.yml` chỉ chứa `connectors`, `cables`, `connections`, `metadata`; mọi file kết thúc bằng một dòng giới hạn cố định ("Tài liệu sinh tự động từ dữ liệu thiết kế; không thay thế đo điện hay đánh giá an toàn").
- [ ] Test `renderElectricalDocuments` với bundle `blocked` ném `ELECTRICAL_BUNDLE_BLOCKED`.
- [ ] Test CLI: `check` trên `serve-hw-a-v1` exit 0; trên một thiết kế bị sửa cho thiếu chân exit 1 và in mã lý do; `docs --check` trên thư mục vừa sinh exit 0; sau khi sửa một ký tự trong `wire-list.csv` exit 1 và nêu tên file; `docs --draw` khi không có `wireviz` trên PATH exit 0, vẫn sinh `harness.yml`, và in `TOOL_NOT_INSTALLED wireviz`.
- [ ] Implement. CSV theo RFC 4180, xuống dòng `\n`, UTF-8 không BOM. Số in bằng `String(n)`; không định dạng theo locale.
- [ ] Viết `electrical-drafting-brief.md`: hướng dẫn một trang cho agent soạn thảo. Nội dung bắt buộc: chỉ sửa file trong `robotics/catalog/electrical/` và `robotics/catalog/devices/`; mỗi giá trị của hãng phải có `locator` vào tài liệu đã ghim, không có thì `assumed`; không bao giờ soạn tín hiệu `safety_chain`, sổ yêu cầu an toàn hay tuyên bố an toàn; sau mỗi thay đổi chạy `lab-hardware.mjs check` và dán kết quả; thiết kế chỉ được coi là xong khi người thiết kế đọc `checks.md`.
- [ ] Focused tests; commit `feat: generate wiring documents and add the lab-hardware CLI`.

## Task E10 — BOM mở rộng, so sánh chi phí và bàn giao R5.2

**Files:**

- Create `source/packages/lab-runtime/src/engineering/electrical/bom.ts`, `source/packages/lab-runtime/src/engineering/electrical/tco.ts`.
- Create `source/packages/contracts/schemas/hardware-candidate-v1.schema.json` (ở task này chỉ dùng định nghĩa `TcoAssumptionsV1` và `TcoComparisonV1`; `HardwareCandidateV1` do E19 dùng); Modify `generate-contracts.mjs`.
- Create `source/robotics/catalog/electrical/tco-assumptions-v1.json`; Modify `scripts/generate-electrical-fixture.mjs`.
- Modify `compile.ts` (gọi `extendBom`), `scripts/lab-hardware.mjs` (thêm `compare`), `source/packages/lab-runtime/src/engineering/gateway.ts` và `v2/gateway.ts` (route `POST /lab/v2/engineering/electrical/compare` nhận `{digests: string[]}` gồm 2–4 bundle của cùng phiên, trả `TcoComparisonV1`).
- Test `source/tests/unit/electrical-bom.test.ts`, `source/tests/unit/electrical-tco.test.ts`, `source/tests/integration/electrical-gateway.test.ts` (thêm ca: so ba bundle; bundle của phiên khác → 403; bundle của hai project khác nhau → 409 `ELECTRICAL_PROJECT_MISMATCH`).

**Interfaces:** consumes `Bom`, `BomLine`, `Quote` sẵn có; produces

```ts
// bom.ts
export function extendBom(base: Bom, context: DesignContext, netlist: NetlistV1, catalog: Pick<CatalogResult, 'components' | 'quotes'>): Bom;   // thêm dòng thiết bị điện, giắc cái (matingPart), dây theo mét từng tiết diện, bảo vệ
// tco.ts
export function compareOptions(bundles: readonly ElectricalBundleV1[], assumptions: TcoAssumptionsV1): TcoComparisonV1;
```

```ts
interface TcoAssumptionsV1 {id: string; revision: number; digest: string; currency: string; labourPerHour: Scalar; minutesPerWire: Scalar; minutesPerConnector: Scalar;
  testMinutesPerUnit: Scalar; driveReplacementsOverLife: Scalar; downtimeHoursPerRepair: Scalar; downtimeCostPerHour: Scalar; sources: {labour: SourceRef; service: SourceRef}}
interface TcoComparisonV1 {assumptionsDigest: string; options: {designId: string; bundleDigest: string; comparable: boolean; missingPriceLineIds: string[];
  parts: {hardware: number|null; wiring: number|null; assembly: number; testing: number; service: number|null; downtime: number}; total: number|null}[];
  dominant: {factor: 'hardware'|'wiring'|'assembly'|'testing'|'service'|'downtime'; spread: number}|null; notComparableReason: string|null}
```

- [ ] Test BOM: mỗi giắc có `matingPart` sinh một dòng phụ kiện với `qty` bằng số lần dùng; dây gộp theo `(csaMm2, colour)` với `qty` là tổng mét, `null` khi có đoạn chưa biết chiều dài (và dòng đó nằm trong `missingPriceLineIds`); mọi dòng mới giữ `candidate` theo linh kiện; BOM cơ khí cũ nằm nguyên trong kết quả; `incompleteTotal` là `true` khi còn dòng thiếu giá.
- [ ] Test so sánh: ba bundle không có báo giá nào → mọi `hardware` là `null`, `total` là `null`, `comparable:false`, `notComparableReason:'PRICE_MISSING_FOR_DECIDING_PARTS'`, và `assembly`, `testing`, `downtime` **vẫn** được tính từ số dây, số giắc và giả định; khi cả ba có đủ báo giá cùng tiền tệ → `total` là tổng sáu phần và `dominant` là phần có chênh lệch lớn nhất giữa các phương án; báo giá khác tiền tệ → `comparable:false`, `notComparableReason:'CURRENCY_MISMATCH'`.
- [ ] Implement. Không quy đổi tiền tệ. Không điền giá mặc định.
- [ ] Chạy trên fixture thật và ghi kết quả vào commit message: ngày 25/11 catalog có 0 báo giá, nên kết quả mong đợi là "chưa so được" kèm danh sách dòng thiếu giá. Đó là đầu ra đúng và là danh sách việc cho mua sắm.
- [ ] CLD04 của R5.2: dựng image arm64 từ cây sạch; trong container chạy `node scripts/lab-hardware.mjs compile` cho ba phương án và so digest bundle với bản sinh trên Mac. Expected: **trùng**. Lệch → áp dụng [README §4](README.md#4-khi-nào-dừng-một-nhánh) mục cuối.
- [ ] `pnpm contracts:generate && pnpm contracts:check && pnpm typecheck && pnpm lint`; commit `feat: extend the BOM with wiring parts and compare hardware options`; re-pin Lab.

**Exit:** G-ELE1 và G-DOC1 kiểm được, trừ DOC03 (gói ứng viên, E19). Một kỹ sư chạy được `lab-hardware.mjs check|compile|docs|compare` trên ba phương án mà không cần gateway.
