# Handover V09 — sau V08 (21/11/2026)

**V08 đã xong phần phần mềm trên nhánh `r4/virtual-commissioning`.** Chưa có acceptance, chưa CLD01/CLD02/CLD03 cho V08, chưa push, chưa deploy. Mọi record `accepted:false`.

## Checkpoint

| Thành phần | Revision |
|---|---|
| Source (runtime đã ghi và verify) | `6d686125697e43c52ae620d2b9c81c0460f9fd2e` (các commit docs sau đó không đổi runtime) |
| Lab (pin) | `1d66e08` — `chore: pin source runtime 6d686125` (trên `6973aa21`) |
| Schema SHA-256 (pin) | `fb8b8624c35504fd0aeadc75c5d2a2bb0431b14ec1c2208e83675ae2b216968d` |
| Campaign | `robot/evidence-archive/r4-fault-v1-6d686125/` 23/23, SHA256SUMS hash `56884d3b…bfbbf` |

Evidence trong Git: `source/docs/implementation/evidence/virtual-commissioning/v08-faults-2026-11-21/` (README, `campaign.json`, `summary.json`, `SHA256SUMS.txt`). Rulings: [plan 02, "V08 — trạng thái ngày 21/11"](02-workbench-faults-tray.md).

## Kiểm chứng

| Kiểm tra | Kết quả |
|---|---|
| Source unit + contracts + gateway (cần `MEKONIQ_RETAINED_INPUTS` như handover V08) | **1.414/1.414**, 155 file |
| Python worker (native arm64) | **300/300** (266 cũ + 34 mới); không có `__pycache__` |
| Integration: cell, CIL, bench, drive, fault | 99 đạt, 2 skip có sẵn (10 file); `mujoco-drive-faults` 8/8 (4 mobile, 4 cell) |
| `contracts:check`, `typecheck`, `lint` toàn repo | đạt |
| Lab (pin mới) | **768/768**, 1 test đo hiệu năng (`twin-telemetry-measure`) bị skip theo thiết kế; `typecheck` + `check:source` đạt |
| `fault-v1` | 23/23, verify độc lập exit 0 |

Không chạy lại: TUNE04 (UI Lab không đổi), CLD01/CLD02 (image cloud và amd64 native), CIL/bench campaign ghi mới (controller/physics không đổi cho run không lỗi; bit-identity của run không lịch được test bởi `mujoco-drive-mobile` và test worker). `drive-evidence.test.ts` ("drive snapshots are recorded…") **đã fail sẵn ở `59583a0f`** (`CIL_CONTROL_EVIDENCE`), không do V08; chưa điều tra.

## Giữ nguyên khi làm V09 (UI studio lỗi)

1. Lịch lỗi drive là `driveFaultSchedule` của run request, không nằm trong project; `drive-reset` không bao giờ từ trình duyệt (health không liệt kê, validate từ chối `FAULT_CAMPAIGN_ONLY`).
2. Nguồn sự thật cho UI: `GET /lab/v2/health` → `faultCatalog` (id, lớp, đối tượng, biên; chỉ có khi runtime chạy được lỗi drive). `POST /lab/v2/projects/validate` với thân `{driveFaultSchedule, backendSetId, scenarioId, driveExperimentId?}` trả `{ok:true}` hoặc 422 `INVALID_FAULT_SCHEDULE` + `reasonCodes` (`FAULT_OVERLAP`, `FAULT_PARAM_INVALID`, `FAULT_TARGET_INVALID`, …) hoặc `FAULT_BACKEND_UNSUPPORTED`. Kiểm này của cổng là gần đúng cho mobile (axes/LiDAR của robot mặc định `amr-1`); run tự kiểm lại với scene thật.
3. Báo cáo: `report.faultReport` (`FaultReportV1`: mỗi mục có injection tick, detection, tick lệnh đổi đầu tiên, phản ứng plant, verdict; sáu invariant ở cấp báo cáo). Chỉ có khi evidence đầy đủ; thiếu thì xem `driveEvidence.issues`. Run cell đã reclaim (đọc lại lạnh) không có `faultReport`.
4. Tick: bắt đầu `ceil(ms/20)+1`; cửa sổ `[start, start+ceil(dur/20))`. Hai run cùng lịch cho cùng tick (hàm thuần).
5. Lỗi không bắt buộc phát hiện (motor-weak, command-delay, lidar-noise, grip-weak, drive-reset) hiển thị `not_detected` là kết quả hợp lệ, không phải thất bại.
6. Python luôn `PYTHONDONTWRITEBYTECODE=1`, `-B`, `-p no:cacheprovider`. Không sửa `lab-fault-schedule.schema.json` (băm của nó nằm trong tham chiếu R2a lịch sử).

## Việc còn mở

- Hai đợt mở rộng được ghi trong rulings: ý định lỗi của cell chưa bền trước ACK; `CUSTODY_UNCHANGED` của cell là proxy.
- Cây nhánh sau V08: V09 (UI studio lỗi), V10 (khay ba cốc), rồi gói 03/04. CLD01/CLD02 theo đợt R4.3 sau V10.
