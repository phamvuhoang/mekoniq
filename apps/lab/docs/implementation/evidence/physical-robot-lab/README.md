# Physical Robot Lab — bằng chứng release hiện tại (07/11/2026)

Danh tính mã đã kiểm: Source `899a83769726aa6840c40a32fb0e89d17a137cb7`, Lab `582f9f46eb4a6fed40e3df97ce50c580c5ea850d`. Runtime được export từ cây Source sạch `899a83769726aa6840c40a32fb0e89d17a137cb7`, SHA-256 artifact `7180f99d1a168ce25f3bf90607cd9afddfddec8e4d41d31403f1939607de6ec0`, SHA-256 schema `7f93a1e1d27b345a64e766c8d67df93a3dc2bbffd92aa7ee16754bccbfc6f222`. Đây là snapshot mã đã kiểm/export; commit chỉ thêm tài liệu về sau không đổi nguồn gốc runtime.

[Biên bản sửa, deployment và guide](release-2026-11-07.md) · [Production smoke](production-2026-11-07.json) · [GitHub CI Source](source-ci-2026-11-07.json).

## Biên bản portable hiện tại (release-2026-11-07-r3)

R3 là biên bản phục hồi có nguồn gốc: giữ nguyên **19 lệnh đã pass từ R2**, chỉ chạy lại **2 lệnh thất bại**. Không phải toàn bộ bộ lệnh được chạy mới ở R3. Manifest R2: [release-2026-11-07-r2/manifest.json](release-2026-11-07-r2/manifest.json), SHA-256 `792b6d486d33ad04999141a01443825f15125aa44033deff5e303e1560852e63`. Bytes và metadata của kết quả tái sử dụng đã được đối chiếu; thời gian chạy gốc được giữ nguyên.

Lệnh giữ từ R2: `lab-build`, `lab-check-source`, `lab-e2e-browser`, `lab-mock-e2e`, `lab-offline-build`, `lab-offline-e2e`, `lab-runtime-e2e`, `lab-typecheck`, `lab-vitest`, `source-adapters`, `source-build`, `source-contracts`, `source-contracts-check`, `source-engineering`, `source-lint`, `source-pytest`, `source-pytest-simulation`, `source-typecheck`, `source-unit`.

Lệnh chạy lại ở R3: `lab-ui-performance`, `source-integration`.

R2 được giữ nguyên, gồm hai lần thất bại sau:

- [source-integration.json](release-2026-11-07-r2/source-integration.json): exit 1; 858 passed, 11 failed, 125 skipped; SHA-256 `95d3e6b1f9a4af1fe8968cbdbfed4faac078eef93ed7b7e4cdc60aa3ec855002`.

- [lab-ui-performance.json](release-2026-11-07-r2/lab-ui-performance.json): exit 1; desktop-3d: frame p95 16.80 ms, paint p95 40.20 ms, ngưỡng 33 ms, meetsTarget=False; tablet-2d-emulated: frame p95 16.70 ms, paint p95 1.80 ms, ngưỡng 50 ms, meetsTarget=True; SHA-256 `ede73ba612e2b7add0b1fa98bdefc716d6e2e76f3c7be69d9aa6ba67fbc553df`.

Operator ghi nhận OrbStack/Postgres treo khi chạy integration và thời điểm khởi động lại OrbStack trùng benchmark. Đây là bối cảnh vận hành, chưa chứng minh nguyên nhân benchmark thất bại. Kết quả R3 được đánh giá từ chính biên bản retry; lịch sử R2 không bị đổi thành pass.

- [release-2026-11-07-r3/manifest.json](release-2026-11-07-r3/manifest.json): 21 lệnh, 0 thất bại; 73 hash artifact trong manifest, 116 file lưu trữ riêng biệt đã kiểm hash. SHA-256 manifest `51731eae15c2b09f8c377ae0f3acfbd9726c6db1f0381fa71e7d47513f10f8bd`.
- [Biên bản test acceptance](release-2026-11-07-r3/acceptance-vitest.json): 41 passed, 0 failed, 0 skipped, 0 not_run. [Biên bản coverage](release-2026-11-07-r3/acceptance.json): 96/106 coverage rows pass; 4 not_run:UNSUPPORTED_FIDELITY, 5 not_run:NEEDS_HUMAN, 1 not_run:BLOCKED_EXTERNAL. Coverage thuộc phạm vi mock/macro; chưa hoàn tất nghiệm thu engineering vật lý.
- [Bảng bảo toàn NR01–NR12](compatibility.json): giữ nguyên baseline; mỗi dòng candidate ghi tên test, kết quả, tham chiếu lần chạy và hash thực. Test chỉ skip vẫn ghi skip. Lần mock chạy pass được giữ riêng với lần browser mặc định skip; chạy lặp không tăng coverage riêng biệt.
- Kiểm điều kiện native: 48.11 GiB free; VM budget 120 GiB + system reserve 20 GiB; Linux/ROS/native engine not provisioned; [biên bản](host-preflight-2026-11-07.json), exit 2 / `not_run`.

| Kết quả lưu trữ | Trạng thái | Nguồn lần chạy | Số lượng / phạm vi |
|---|---|---|---|
| [source-unit.json](release-2026-11-07-r3/source-unit.json) | pass | reused | 235 passed, 0 failed, 0 skipped, 0 not_run |
| [source-contracts.json](release-2026-11-07-r3/source-contracts.json) | pass | reused | 51 passed, 0 failed, 0 skipped, 0 not_run |
| [source-engineering.json](release-2026-11-07-r3/source-engineering.json) | pass | reused | 611 passed, 0 failed, 3 skipped, 0 not_run |
| [source-pytest-simulation.xml](release-2026-11-07-r3/source-pytest-simulation.xml) | pass | reused | 183 passed, 0 failed, 1 skipped, 0 not_run |
| [source-adapters.json](release-2026-11-07-r3/source-adapters.json) | pass | reused | 50 passed, 0 failed, 0 skipped, 0 not_run |
| [source-integration.json](release-2026-11-07-r3/source-integration.json) | pass | retried | 992 passed, 0 failed, 2 skipped, 0 not_run |
| [source-pytest.xml](release-2026-11-07-r3/source-pytest.xml) | pass | reused | 178 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-vitest.json](release-2026-11-07-r3/lab-vitest.json) | pass | reused | 279 passed, 0 failed, 1 skipped, 0 not_run |
| [lab-pw-browser.json](release-2026-11-07-r3/lab-pw-browser.json) | pass | reused | 38 passed, 0 failed, 15 skipped, 0 not_run |
| [lab-pw-mock-twin-workspace.json](release-2026-11-07-r3/lab-pw-mock-twin-workspace.json) | pass | reused | 5 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-mock-coffee-journey.json](release-2026-11-07-r3/lab-pw-mock-coffee-journey.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-mock-twin-recovery.json](release-2026-11-07-r3/lab-pw-mock-twin-recovery.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-mock-twin-inputs.json](release-2026-11-07-r3/lab-pw-mock-twin-inputs.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-mock-fault-schedule.json](release-2026-11-07-r3/lab-pw-mock-fault-schedule.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-mock-arm-simulation.json](release-2026-11-07-r3/lab-pw-mock-arm-simulation.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-mock-twin-plan01.json](release-2026-11-07-r3/lab-pw-mock-twin-plan01.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-mock-legacy-campaign.json](release-2026-11-07-r3/lab-pw-mock-legacy-campaign.json) | pass | reused | 3 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-runtime.json](release-2026-11-07-r3/lab-pw-runtime.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-ui-performance.json](release-2026-11-07-r3/lab-ui-performance.json) | pass | retried | {"durationMs": 60000, "profiles": [{"id": "desktop-3d", "p95Ms": 16.700000000004366, "paintP95Ms": 20.100000143051147, "limitMs": 33}, {"id": "tablet-2d-emulated", "p95Ms": 16.700000000004366, "paintP95Ms": 1.6999998092651367, "limitMs": 50}]} |
| [lab-pw-offline-twin-recovery.json](release-2026-11-07-r3/lab-pw-offline-twin-recovery.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-offline-coffee-journey.json](release-2026-11-07-r3/lab-pw-offline-coffee-journey.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |
| [lab-pw-offline-offline-bv01.json](release-2026-11-07-r3/lab-pw-offline-offline-bv01.json) | pass | reused | 1 passed, 0 failed, 0 skipped, 0 not_run |

## Gate và việc còn mở

G0 vẫn **blocked**: browser portable V14/V19 và hành trình project chung Designer/Twin chưa hoàn tất. G1/G2 **not_run** vì chưa có Linux/ROS/engine native và campaign native. G3 cần dataset đo hiệu chuẩn thật. Qualification phần cứng nằm ngoài phạm vi release này. Biên bản không đóng gate distribution/native/hardware. Smoke mock offline trên cùng host chưa chứng minh qualification máy sạch/offline-native.

Entity-binding editor (owner chỉ đọc; thêm assembly tự dùng entity runtime đầu tiên, chưa có selector), provenance/model inspector, inspector link/joint/port, exploded view, project chung, stability UI, thông số catalog thật/vendor qualification và hành trình browser engineering-run native vẫn mở. Test assembly/compiler/pure/mock chỉ chứng minh assertion đã ghi. Chức năng cũ tiếp tục được theo dõi qua NR01–NR12, giữ nguyên baseline.

R1 (`release-2026-11-07`) được giữ nguyên làm lịch sử. XML JUnit simulation đã lưu bị sai cú pháp do placeholder đường dẫn không escape; không dùng làm biên bản JUnit cuối. Mọi XML JUnit trong biên bản hiện tại phải qua parser nghiêm ngặt trước khi tạo mục lục này.

## Ghi chú triển khai lịch sử (số liệu và runtime pin cũ)

Phần dưới giữ nguyên văn để truy vết. Trạng thái, pin và nhận định về recorder bên dưới thuộc lịch sử; release hiện tại dùng mục biên bản hiện tại và candidate compatibility phía trên.

---

# Physical Robot Lab — evidence index (07/11/2026)

Chỉ ghi những gì đã chạy thật trên host macOS arm64 (Node 24.22.2). **Không có gate G1/G2/G3, distribution hay hardware nào được đóng.** Mọi mục native là `not_run` kèm blocker; mô phỏng không được nâng thành bằng chứng phần cứng.

Commits: source `d881c6f` → `54bf203` (gồm một đợt sửa sau review độc lập); Lab `679a239` → `9e1e712` (+ cập nhật README này). Baseline NR01–NR12 trước thay đổi: [compatibility.json](compatibility.json).

## Trạng thái theo task

| Task | Portable | Native / UI còn mở |
|---|---|---|
| A01 contracts | **xong** — 5 schema + generated types, validator, fixtures; test contracts | — |
| A02 catalog | **xong** — loader có hash/license/closure, importer có allowlist, catalog tham chiếu; FD01 AMR tham chiếu resolve+compile | Chưa import vendor thật; xArm/G2 `not_run` (`robotics/catalog/vendor-compatibility.json`) |
| A03 resolver | **xong** — assembly, quán tính (đối chiếu số độc lập), BOM, `EngineeringCompileInput` | `PAYLOAD_EXCEEDED` chưa có (catalog chưa có payload rating) |
| A04 bundle store + gateway | **xong** — compile/manifest/blob, create-run, reclaim, readiness theo `engineeringRef`; CLI runtime có opt-in `--engineering-catalog/--engineering-simulation/--engineering-python` (không cờ ⇒ không có capability; thiếu compiler ⇒ không khởi động) | Artifact chưa mang catalog/compiler (phân phối riêng); Lab pin runtime vẫn là bản cũ chưa có engineering |
| B01 môi trường native | Validator + lock candidate + runbook | **not_run**: host không đủ dung lượng VM (22,9 GB < 120 GiB), chưa có Linux/ROS; chưa chụp inventory, chưa có smoke |
| B02 compiler | **xong** — `compiler/engineering.py`, golden V17, parity hash TS↔Python | Chưa chạy trong Gazebo |
| B03 vật lý + routing | Resolver `requiredBackends(target,mode,set,catalog)`, health theo set, ingest `PhysicsSample`, logic worker thuần, CLI `--engineering-project` | **not_run**: launch file, worker thật, lifecycle native, FD01 9 runs (G1) |
| B04 actuator | Mô hình thuần + vector dùng chung | Plugin không build; V06/V07 native `not_run`; actuator khai báo `ideal` |
| C01 arm | `validate_plan`, `vendor.lock.json` (chưa pin) | Package ROS, MoveIt/ros2_control, V08 `not_run` |
| C02 contact | `assess_transfer` (ngưỡng đã kiểm bằng mutation) | Hợp đồng SDF cup/jaw, V09/V10 `not_run` |
| C03 process | `step_process`/`observe`, bảo toàn khối lượng | Cập nhật khối lượng cup trong engine, V11 `not_run` |
| C04 BV01 | — | **chưa làm**: cần provider native |
| D01 Lab | Store, repository, archive, client, candidate, estimates, renderer + **trang Lắp ráp** (chọn linh kiện, mount/connect, blocker xem trước, undo/redo, lưu/tải lại, xuất/nhập, candidate, nút compile khi runtime có capability, BOM/cảnh compile) VI/JA/EN; `engineering-design.spec.ts` (7) và `legacy-campaign.spec.ts` (3) pass | Compile + xem cảnh **chưa kiểm trên trình duyệt** (cần runtime có `engineering_bundle_v1`; phần client/gateway đã có test); chưa có chọn link/joint/port inspector và exploded view |
| D02 evidence | Source `assessEngineeringEvidence` + schema | Nối vào report/replay/compare của Lab; `engineering-run.spec.ts` native |
| D03 distribution | Exporter đóng gói schema; recorder `--suite physical-robot-lab --out` (root mới, không bao giờ ghi đè/ghi vào root cũ) và acceptance đọc `LAB_V2_REGRESSION_DIR` — có test | **Chưa ghi nhận lần record cuối**: cần cây Lab sạch (README/docs plan+spec của bạn đang chưa commit), export sạch + pin runtime mới, rồi record + acceptance; campaign `engineering-qualification`, clean-machine/offline-native, tamper/rollback của closure chưa làm |
| D04 calibration | Schema, `assessCalibration`, CLI, protocol | **G3 not_run**: chưa có dataset đo thật |

## Kết quả đã chạy (host, không native)

- Source: `pnpm contracts:check`, `tsc --noEmit`, `pnpm lint` sạch; `test:unit` 181 pass; `test:contracts` 51 pass; Python `pytest robotics/simulation/tests` 173 pass (1 skip có sẵn); các suite `lab-v2-*`, `lab-runtime*`, `engineering-*` pass (524 test ở lần chạy B03).
- Lab: `pnpm test` 235 pass, 1 skip có sẵn (baseline 188/1); `pnpm typecheck`, `pnpm build` pass.
- Browser (host, không runtime): `playwright test` 34 pass, 12 skip (cần runtime). Qua mock launcher: twin-workspace, coffee-journey, twin-recovery, twin-inputs, fault-schedule, arm-simulation, twin-plan01 đều pass; `legacy-campaign` 3 pass; `test:runtime-e2e` 1 pass; offline-bv01 + twin-recovery trên bundle offline pass; benchmark 60 s: desktop-3d p95 16,8 ms, tablet-2d-emulated 16,7 ms (ngưỡng 33/50) — `ui-performance.json`.
- Chưa chạy: các suite source cần Postgres/Supabase (Docker tắt: `ECONNREFUSED 127.0.0.1:57422`), recorder/acceptance bản cuối, kiểm trên máy sạch/ngắt mạng.

## Review độc lập (1 lần, toàn bộ source diff) và kết quả

Sáu lỗi Critical/Important đã sửa, mỗi lỗi có test đỏ trước: `aborted` bị báo pass; mẫu thiếu `cupId/epoch` được coi là bằng chứng; mẫu trùng/lặp tính vào coverage; xác nhận kẹp qua khoảng trống dữ liệu; engineering set nhận run/readiness không có bundle ref (và health báo supported khi runtime không có capability); cổng mount không chọn được link chuyển động của cha (thêm `Port.link`). Minor chưa sửa: xem mục cuối.

## Việc đã sửa trong lúc làm (phát hiện nhờ kiểm chéo)

- A03 sinh `lineId` BOM chứa `@`, vi phạm chính schema `EngineeringId`; chỉ validation Python lộ ra. Nay `prepareEngineeringCompileInput` tự validate đầu ra theo schema (test đã kiểm bằng mutation).
- Catalog tham chiếu có pin/khay xuyên nhau (resolver `INITIAL_PENETRATION` phát hiện); đã sửa hình học mount.

## Quyết định (rulings) nằm ở `.superpowers/sdd/01-components-assembly/progress.md` (cục bộ, không commit).

## Đợt sửa thứ hai (review của người dùng: 5 P1, 6 P2, 3 deferred)

Đã sửa, mỗi mục có test đỏ trước: grasp xác nhận khi thiếu contact (hai stream phải phủ toàn bộ khoảng lift/hold); evidence mất phần cuối vẫn pass (manifest khóa `window` và `lastSequence`, thiếu → `EVIDENCE_TRUNCATED`); digest tùy ý nâng lên `verified` (cần bản ghi calibration thật: hash khớp, pass, đúng `configDigest`, chưa bị invalidated, đúng capability và miền quan sát); calibration đếm trial không có dữ liệu (`TRIAL_WITHOUT_DATA`); save race ghi bytes sai (snapshot đồng bộ trước validate); projection chọn sai root link; catalog không kiểm provenance (`PROVENANCE_UNRESOLVED`); archive không kiểm assets/recipes và trường quyền/secret; renderer không truyền transform qua cây frame; estimates ném exception với model blob sai; estimate khi thiếu component. Cùng đợt: process vượt deadline không còn xả cả `dt`, mọi cleanup đều chạy, queue từ chối mẫu sau overflow kể cả sau `drain`.

Số liệu sau đợt này: source vitest (lab-*/engineering*/contracts) 64 file, 555 pass, 2 skip có sẵn; pytest 360 pass, 1 skip; Lab 223 pass, 1 skip.

## Đợt sửa thứ ba (2 P1, 2 P2)

`verified` nay so miền calibration với **toàn bộ** quan sát của run (mọi entity, mọi giá trị theo tên), không phụ thuộc danh sách checks hay thứ tự của chúng; calibration không nêu miền, hoặc kênh mà run không tạo ra, không xác minh gì. Calibration với policy không có channel hoặc trial không có mẫu luôn fail (`NO_MEASURED_SAMPLES`/`TRIAL_WITHOUT_DATA`). Archive validate asset/recipe theo đúng schema nguồn đầy đủ (đồng bộ `asset-revision`, `coffee-recipe`) rồi mới kiểm hash; recipe hash là hash canonical của recipe bỏ trường `hash`.

## Minor chưa sửa (ghi nhận từ review đầu)

Hai compile song song cùng project có thể va `rename` (500 thay vì trả bundle sẵn có); reclaim/resume không kiểm lại closure; instance chưa bind bị compiler Python từ chối với `COMPILER_FAILED` thay vì mã resolver; URDF 9 chữ số có nghĩa so với `scene.json` đầy đủ.

## Đợt sửa thứ tư (hồi quy O(n²) + foundation còn lại)

Observations của evidence nay là min/max/count theo tên giá trị (72.000 mẫu: ~1,8 s thay vì ~19 s, kết quả không đổi, vẫn thấy một mẫu ngoài miền). Publish song song cùng bundle thành công (rename thua = đã có cùng bytes). Reclaim báo `engineeringClosure` và start/resume bị chặn `ENGINEERING_CLOSURE_MISSING` khi thiếu file. Instance không thuộc entity nào bị resolver báo `INSTANCE_UNBOUND`. URDF ghi đúng double như `scene.json`.
