# Verification và nghiệm thu

Đọc cùng [spec](README.md) và [contracts](contracts-and-evidence.md). Đây là tiêu chí tương lai; không ghi các hàng dưới thành pass trước execution.

## 1. Required scenarios

| Case | Backend / điều kiện | Assertions tối thiểu |
|---|---|---|
| V01 BV01 happy path | Mock, seed cố định, recipe espresso và iced-milk-coffee | Order→brew→grasp→CargoLoaded→arrival→delivery confirmed; cup owner đúng; conservation; không ghost cup |
| V02 Transfer adversarial | Mock và protocol double | Duplicate/reorder, old boot/epoch, wrong cup/slot, same observer, stale/future sample không tiến custody |
| V03 Crash cuts | Trước/sau takeCup; trước/sau stage ACK/start ACK/release/confirm | Recovery không phát lại motion; unknown cần query/reconcile; exactly-once projection |
| V04 Collision report | Checker với trace/mock hoặc controller | Collision thật fail; empty/gap not_run; allowed-contact chỉ đúng phase; replay không dùng future evidence |
| V05 Readiness | Missing dependency/unsupported backend/revision/expired snapshot | Start denied với reason đúng, không journal run nửa vời; imported report không mở gate |
| V06 Fault UI | Immediate và scheduled | AMR delay/disconnect, cup missing, grip fault, person blocker, restart; hỗ trợ theo backend; fired IDs replay đúng |
| V07 FD01 native | Ubuntu VM hoặc amd64, ROS/Gazebo live | Process alive, /clock, Nav2 active, goal→feedback→result, telemetry >0, contact sensor live |
| V08 FD02/03/04/07 | Sau V07 | Fixture assertions thực, separation/contact coverage, faults đúng scope; không chỉ exit 0 |
| V09 Controller terminal | Debian LinuxCNC stock kernel SIM | FK/IK reference, homing/jog, stage/start/pause/resume/cancel observed, lease/arbiter/restart, raw actual joints |
| V10 Controller GUI | QtVCP trong desktop VM | GUI mở/tương tác thật, operator takeover/revoke, Lab bị deny khi mất owner; ảnh/log và checklist thao tác |
| V11 Virtual grip | Native controller + modeled cup plant | Observed output và pose → grip; cup missing/receiver absent không confirm; units và collision world đúng |
| V12 Combined BV01 | Hai VM chạy đồng thời, một runId | V01 invariants + V07/V09 providers + V11; barrier, tunnel drop, boot change, pause/lease; đầy đủ transfer evidence |
| V13 PG integration | Isolated Supabase/Postgres | Full `pnpm test:integration`; skipped tests phân loại từng cái; thất bại không thay bằng SQLite |
| V14 Offline | Clean install từng target | Không checkout/pnpm store; network-off thật; launcher, BV01, import/export, rollback; hashes đúng |
| V15 Usability | Ít nhất 5 người mới | Mở project/start/fault/reconcile/replay/export; recording có consent, metrics/task outcomes và lỗi cần sửa |
| V16 Signed controller package | Clean Linux target + provisioned trust | Valid install, tamper/wrong/revoked/expired key deny, downgrade deny, rollback calibration, ACL/service isolation |

Negative fault tests pass khi hệ thống từ chối/attention đúng và giữ invariants; business outcome của run vẫn có thể attention. Không đòi negative scenario hoàn tất served để pass test.

## 2. Release gates

| Gate | Bằng chứng cần | Không đủ để promote |
|---|---|---|
| R-MOCK continuation | V01–06, V13–15 trên pin mới và các yêu cầu R-MOCK gốc | Tổng unit count, browser test trên pin cũ, ≥5 synthetic users |
| G-SIM-NAV / VM ARM64 | V07–08; package/renderer lock ARM64 | Worker double hoặc `doctor` pass |
| CONTROLLER-POC / VM ARM64 | V09–10; lock candidate đã resolve thật | Python fake service, terminal smoke thay GUI |
| G-SIM-ARM / VM ARM64 | V04 với controller actual trace + V11, coverage đủ | Joint feedback nhưng grip=null; geometric checker không có trace |
| R-SIM / VM ARM64 | Native gates trên + V12 và toàn bộ required assertions của spec gốc | Hai standalone reports, mixed mock arm/native AMR mà không ghi rõ |
| Software R-READY / amd64 | V16 + replay required native suite trên amd64 + installer/support matrix | ARM64 VM pass, test key hoặc prefix tạm trên macOS |
| Hardware / R-PILOT | Giữ yêu cầu spec cũ: calibration, safety, timing, physical/HIL/FAT/SAT | Bất kỳ VM/software gate nào |

Nếu yêu cầu gốc rộng hơn bảng này, yêu cầu gốc vẫn áp dụng. Không dùng bộ continuation để giảm release criteria. Gate decisions lưu reviewer chịu trách nhiệm và evidence scope cụ thể. R-MOCK usability có thể blocked_external dù code/tests xanh; ghi rõ thay vì tự accept.

## 3. Evidence bundle

Root execution mới: `lab/docs/implementation/evidence/bv01-native-simulation/`. Metadata nhỏ vào Git; logs lớn/VM/images ngoài Git trong artifact store do operator chọn. Một manifest gồm:

```json
{
  "schemaVersion": 1,
  "taskId": "N02",
  "gate": "G-SIM-NAV",
  "execution": "not_run",
  "result": "not_run",
  "blockers": ["VM_STORAGE_INSUFFICIENT"],
  "target": {"profile": "linux-vm-sim", "architecture": "arm64"},
  "claims": {"hardwareValidated": false, "productionReady": false},
  "artifacts": []
}
```

Khi execution=ran, bắt buộc thêm UTC start/end, exact argv/cwd, source+lab commits, runtime/schema digests, scenario/seed/repeat, backend/image/package versions, profile/model/world/recipe hashes, kernel/UTM/guest arch, exitCode, assertion verdicts, provider boot/clock domains, raw artifacts sha256+size. Capture renderer, real-time factor, process resource usage trong native run. Không đưa serial máy, IP public, tokens/passwords/private keys vào report. Preflight evidence khác run evidence.

Verifier kiểm completeness theo gate, file hashes và scope. Lưu pass hiện tại và historical pass riêng; đổi model/world/schema/profile làm evidence cũ stale cho acceptance mới. Report import kiểm integrity, không phải attestation độc lập; đánh dấu origin imported. Release decision dựa cả trusted execution record và review, không tin trường `accepted` từ file upload.

## 4. Reproducibility và performance

Mock lặp cùng seed/config/checkpoint có canonical domain outcome giống nhau. Native chạy ít nhất 3 lượt seed cố định cho happy path và mỗi fixture fault required; kiểm invariants và tolerance đã pin, không hứa byte-level deterministic physics. Không lấy kết quả nhanh nhất. Một lượt fail giữ fail, phải có fix + run mới trên revision mới.

Native VM resource gate: không OOM; không mất required telemetry; không lease expiry do overload; bounded timeouts đúng fixture; ghi real-time factor và render backend. Chưa có throughput SLA thương mại. Nếu host 16 GiB không đáp ứng simultaneous run, ghi resource blocker; không tăng timeout vô hạn hoặc tắt sensor để pass. Production amd64 validation là campaign riêng.

## 5. Execution discipline

Chạy Node 24.22.2 và pnpm 10.32.1. Baseline toàn suite một lần; mỗi task red/green focused tests; full static/contracts + affected integration + Lab browser trên pin mới cuối wave. Full PostgreSQL phải dùng instance development riêng. Không đổi port hoặc dừng database/service người dùng đang sử dụng. Chỉ ký release bằng signing station provisioned; test fixtures không được dùng làm release trust.

Thiếu storage hiện tại chỉ chặn provisioning/run native, không chặn việc viết spec, plan, tests portable hoặc build code. Không gán trạng thái failed cho phép thử chưa chạy. Tài liệu đợt này được kiểm links/coverage/diff; đó không phải runtime test evidence.
