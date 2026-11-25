# Physical Robot Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bổ sung thiết kế lắp ráp có provenance và mô phỏng native cho AMR giao món + trạm pha chế cố định có tay máy, giữ toàn bộ chức năng/dữ liệu hiện hữu theo NR01–NR12.

**Architecture:** Source giữ hợp đồng, compiler, adapters và domain; Lab dùng chung engineering project cho thiết kế, scene và run. Gazebo là world vật lý chung; legacy/mock giữ profile riêng.

**Tech Stack:** Node 24.22.2, pnpm 10.32.1, TypeScript/Vitest, Python/pytest, Ubuntu 24.04, ROS Jazzy, Gazebo Harmonic, Nav2, MoveIt 2, ros2_control, Three.js/Playwright.

**Spec:** [Spec chính](../../specs/2026-11-06-physical-robot-lab/README.md), [kiểm chứng](../../specs/2026-11-06-physical-robot-lab/verification.md), [bảo toàn chức năng](../../specs/2026-11-06-physical-robot-lab/compatibility.md).

## Global Constraints

- Node 24.22.2; pnpm 10.32.1; dependencies khóa theo lockfile, không nâng major để hoàn thành task.
- Business authority/contracts/adapters ở `source/`; presentation/project UX ở `lab/`.
- Không sửa `trial/`, không chạm robot hoặc cổng `1880`/`1884`; UI/runtime loopback `4175`/`4176`.
- Mỗi run khóa mode, seed, backend versions, model/world/recipe/profile revisions và clock domains.
- UI Việt/Nhật/Anh; mọi nhãn kết quả phải nêu provenance và không nâng simulation thành hardware evidence.
- Native test thiếu môi trường ghi `not_run` với blocker; test đã chạy sai assertion ghi `fail`.
- Không export dirty source; không ghi secrets, VM disk, SSH private key hoặc signing key vào Git.
- Không xóa dữ liệu host để provision VM; storage và RAM preflight phải đạt trước khi tải image lớn.
- Engineering profile không tự fallback sang mock, legacy hoặc hardware khi thiếu capability.
- Giữ toàn bộ chức năng và dữ liệu hiện hữu theo NR01–NR12; giới hạn MVP engineering không áp dụng cho các profile cũ.

---

## Trạng thái và cách dùng

Ngày 06/11/2026: **planned, chưa thực thi**. Không checkbox nào đã hoàn thành; các command mới ghi rõ task tạo ra chúng. Bộ này triển khai feature mới, không ghi đè evidence của kế hoạch BV01 trước đó. Đọc spec và plan tương ứng trước sửa code.

Paths bắt đầu `source/`/`lab/` tính từ workspace. Hai repo commit riêng; không commit ở workspace root. Các thư mục/module/test ghi **new** là deliverable tương lai. Không mua thiết bị, provision máy không đủ resource, kết nối robot hoặc nâng hardware mode khi thực hiện plan.

## Thứ tự và deliverables

| Plan | Tasks | Phụ thuộc | Đầu ra có thể kiểm riêng |
|---|---|---|---|
| [01 — Catalog, assembly, contracts](01-components-assembly.md) | A01–A04 | Baseline hiện tại | Schema, reference catalog, validator/resolver, content store/API |
| [02 — Compiler và AMR vật lý](02-physics-navigation.md) | B01–B04 | B01 độc lập; B02 sau A03/A04; B03 sau A04/B01/B02 | Full project compiler, profile-aware admission, FD01 native, actuator fidelity |
| [03 — Tay máy và pha chế](03-beverage-manipulation.md) | C01–C04 | C01 sau A02/B01/B02; C02 sau C01; C03 sau B02; C04 sau B03/C02/C03 | Arm native, contact cup, process plant, BV01 |
| [04 — Lab và qualification](04-lab-integration-qualification.md) | D01–D04 | D01 editor sau A04/B02, live sau B03; D02 sau D01/B03/C04; D03 sau D02; D04 sau B04/C04 | UI/persistence/export, client v2/recovery, preservation gate, clean pin/offline, calibration tooling |

Đường tới giá trị đầu tiên: A01→A03→A04 + B01/B02→B03→D01: cùng một thiết kế chạy FD01 trong engine. Đường tiếp: A02→C01→C02 và C03→C04→D02→D03: BV01 có contact. B04/D04 nâng fidelity có dữ liệu; chưa có calibration data không được chặn phát hành G1/G2 có nhãn đúng, nhưng G3 vẫn mở.

Không cam kết thời lượng theo tuần trước B01/C01. Sau hai native spikes, ghi thời gian build/run, memory, RTF, vendor compatibility và số model parameters thiếu rồi mới ước lượng phần còn lại.

## Hợp đồng dùng xuyên task

Canonical type names, units, API và thresholds ở [components](../../specs/2026-11-06-physical-robot-lab/components-and-assembly.md) và [runtime](../../specs/2026-11-06-physical-robot-lab/simulation-runtime.md). A01 xuất types/schema; task sau phải import, không tự khai báo interface cùng tên khác cấu trúc. B02 là compiler duy nhất; UI không biên dịch vật lý lần hai.

A03→A04→B02 truyền `EngineeringCompileInput` đầy đủ, không chỉ ResolvedAssembly. B03 chọn provider requirements bằng backendSetId và dùng chung resolver cho health/readiness/gateway/CLI/report. D01 phải sửa client Twin v2 trong scenarios/controls.ts, giữ engineeringRef và lockedInput qua reset/reclaim; runtime/client.ts vẫn là client S01. Persistence/candidate engineering có discriminator riêng, không đổi nghĩa schemaVersion 1 cũ. NR01–NR12 là requirement của mỗi task bị ảnh hưởng, không phải kiểm tùy chọn cuối đợt.

Code blocks trong tasks là regression examples và thuật toán cốt lõi; implementer hoàn thiện branches/schema đã liệt kê trong spec trước đánh dấu done. Test harness có tên trong task nào thì task đó phải tạo, không giả định tồn tại. Không dùng synthetic fixtures làm bằng chứng native.

Quy trình mỗi task: viết case → chạy RED có nguyên nhân đúng → implement → chạy GREEN focused + affected regression → lưu evidence → review diff → commit chỉ files của task. Provisioning dùng preflight/blocker thật thay RED giả. Nếu còn native blocker, chỉ tick portable steps, giữ gate native mở.

## Coverage

| Yêu cầu | Tasks | Verification |
|---|---|---|
| PHY-01 | A01/A03/A04/B02/D01 | V01/V04/V14/V17/V19 |
| PHY-02 | A02/D03/D04 | V02/V03/V15/V16 |
| PHY-03 | A03 | V02/V03 |
| PHY-04 | A03/B02/D01 | V01/V03/V17 |
| PHY-05 | B01/B03/B04 | V05–07 |
| PHY-06 | C01 | V08 |
| PHY-07 | C02/C04 | V09/V10 |
| PHY-08 | C03 | V11 |
| PHY-09 | B03/C04/D02 | V10/V13/V18 |
| PHY-10 | A04/B03/D01/D02/D03 | V04/V12/V15/V19 |
| PHY-11 | D01/D02 | V14/V20 |
| PHY-12 | B01/B04/D03/D04 | V06/V15/V16 |
| PHY-13 | A01/A03/A04/B02/B03/C01/C04/D01/D02/D03 | V17–V21, NR01–NR12 |

## Lệnh và kiểm cuối

Dùng Node 24.22.2 trước mọi lệnh pnpm. Source dùng `pnpm exec vitest run tests/...test.ts`; Python pure tests chạy `python3 -m pytest robotics/simulation/tests/<file>.py -q` từ source (conftest hiện hữu thêm compiler/bridge vào path). ROS integration chạy trên Linux đã source environment và colcon workspace; không chạy pytest fake để thay qualification.

Sau thay contracts: `pnpm contracts:generate`, `pnpm contracts:check`, `pnpm test:contracts` trong source. Sau cập nhật Lab pin: `pnpm check:source`, `pnpm typecheck`, `pnpm test`, `pnpm build` và **toàn bộ block hồi quy của [D03](04-lab-integration-qualification.md#d03--artifact-offline-closure-và-qualification-campaign)**. Block này gồm S01 launcher, UI/brand/controller/engineering-design, mock launcher với inputs/fault/campaign và benchmark/offline; `test:twin-e2e` một mình chưa đủ. Full source CI theo scripts hiện hành, ghi rõ suite nào chạy/không chạy; không nhận pass vì command có skip native. Baseline pass bị mất hoặc thành skip/not_run là fail preservation.

Mỗi task kết thúc bằng một commit theo subject trong task; stage chính xác create/modify/test files được liệt kê, không `git add .`. Không commit build output, raw journals, secret hoặc vendor asset chưa có quyền phân phối.

## Definition of done của bộ triển khai

- [ ] G0: contracts/compiler/assembly và compatibility có evidence.
- [ ] Preservation: NR01–NR12 và V17–V21 có trước/sau, mọi legacy function/data format còn dùng được; portable/browser suites bắt buộc không pass nhờ skip.
- [ ] G1: FD01 trên ít nhất một native target, thực chạy 9 runs theo verification.
- [ ] G2: BV01 contact, negative tests và native browser đủ evidence.
- [ ] Distribution: clean artifact import/rollback/offline và license closure trên target được công bố.
- [ ] G3: chỉ tick khi datasets thật và validation residual đạt; thiếu dữ liệu ghi blocker độc lập.
- [ ] Reviewer ghi accepted scope riêng với test status; không tự nhận hardware acceptance.

## Đối chiếu các điểm review đã sửa trong tài liệu

| Điểm review | Hợp đồng/task đóng khoảng trống | Điều kiện kiểm |
|---|---|---|
| Compiler thiếu world/bindings | EngineeringCompileInput; A03/A04/B02 | V17, NR03 |
| BV01 hardcode LinuxCNC | Provider roles theo backend set; B03/C04 | V18, NR05–NR07 |
| Thiếu client Twin v2 và ref xuyên lifecycle | controls/catalog/preflight, lockedInput và durable bundle grants; A04/B03/D01/D02 | V19, NR08–NR09 |
| Shared store thiếu persistence/exports | Repository riêng, archive/candidate schema, atomic migration/history; A01/D01 | V20, NR01–NR03/NR10–NR11 |
| Gate bỏ sót UI/input/fault/campaign | Inventory và lệnh hồi quy đầy đủ; A01/D01/D03 | V21, NR01–NR12 |

Đóng khoảng trống trong tài liệu không đánh dấu các task hoặc gate implementation là đã hoàn thành.

