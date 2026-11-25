# BV01 và native simulation — implementation evidence

Đã implement phần mềm portable trên `source/feat/lab-digital-twin-v2` và `lab/feat/robot-lab`. [Báo cáo HTML](implementation-report.html) và [manifest qualification](qualification-final.json) ghi kết quả trên source `f82b2057cae89b0029968212753df01f86f334ad`, Lab code/pin `66445c5acf24f90cc17449bae561dbc45965eba7`. Commit tài liệu sau đó không phải một lần kiểm UI mới.

## Kết quả và phạm vi

- I01–I05: durable cup ledger/table projection, shared CoffeeDriver, stage/start recovery, controller/ARM03 report + clock-aware replay/CSV, readiness và fault schedule.
- N02–N06: explicit candidate ARM64 profiles, terminal/GUI staging, SSH supervisor/barriers, SIM gripper/independent tray, native coordinator/CLI/gateway/UI. Worker/agent/resource closure được pin và snapshot; controller inventory, clock mapping và original wire expiry được giữ làm evidence.
- R01: full PostgreSQL + SQLite integration pass trên final source HEAD. Không lọc SQLite để thay PostgreSQL.
- R02: clean export/re-pin, 4 browser journeys và BV01 offline darwin/arm64 pass. Cold clean target, OS network-off, Linux package và usability vẫn chưa nghiệm thu.
- N01/R03: hai VM và signed release trên clean Linux amd64 chưa thực hiện. Existing signing/installer tooling đã có portable regression tests; không có release key hoặc target thật được tạo.

Runtime artifact `470a404c61714f5ee5b1878f964c1be4bea28628846bdfd800b1df8619a9d236`, schemas `ebc4b1f05c57f1dbbbca9e376bd815dd20277a9fe8a7d4c8365ab566cc8f63fe`; `R02-runtime-manifest.json` có 33 schema và approved nativeTools closure. Export dùng checkout sạch của committed HEAD, Node 24.22.2; các artifact source đang sửa từ trước được giữ nguyên và không vào export.

## Bằng chứng

- `qualification-final.json`: exact commands/commits, suite counts, skipped-case classification và browser scope. Python chạy 3.13.3 trên Mac; CI target 3.12 không được suy ra từ lần này.
- `review-resolution.md`: sáu Important findings W01–W06 đã đóng sau review; các fixture/disclosure/flow issues phát hiện bởi qualification cũng được ghi riêng.
- `browser-*.json`, `offline-browser-offline-bv01.json`: bốn browser journeys và một offline journey, không skip. Controller report dùng fixture read-only, không chứng minh controller đã chạy.
- `R02-offline-manifest.json`, `offline-qualification.json`: gói `/var/tmp/mekoniq-bvi-offline-f82b205-darwin-arm64`. Chạy `./start` trong thư mục gói, dùng mã pairing từ terminal. Không cần checkout/pnpm để launcher hoạt động. Test browser chặn HTTP ngoài loopback; đây chưa phải clean-machine hoặc OS network-off acceptance.
- `native-prerequisites-f82b205.json`, `N03-terminal-final-f82b205/`, `N03-gui-final-f82b205/`, `N06-native-final-f82b205/`: các lệnh thực sự đã gọi, exit 2 / not_run do môi trường Mac; không có native engine run nào pass.
- `R02-usability.md`, `R03-amd64-release.json`, `V11-native-grip.json`: external gates còn mở. R-MOCK/R-SIM/R-READY chưa được đánh dấu accepted.
- `R01-attempt-*`, `R02-attempt-*`, `browser-attempt-*`: giữ các lượt fail/interrupted, gồm ENOSPC/Docker restart và lỗi code/test đã sửa. Không dùng chúng làm qualification xanh.
- `rulings.md`: các quyết định và chi phí nếu cần đổi.

## Deploy và next steps

Mac mock: Node 24.22.2, `cd lab && pnpm check:source && pnpm lab:mock`; UI/runtime chỉ loopback 4175/4176. Gói offline chỉ dùng đúng darwin/arm64; build riêng cho Linux. Không có ROS/Gazebo/LinuxCNC bên trong gói mock.

[UTM runbook](../../../plans/2026-11-06-bv01-native-simulation/utm-runbook.md) ghi cấu hình hai VM, candidate dependency resolution, SSH/ACL, embedded tool identity và bounded controller-wall deadline policy. Cần 120 GiB cho VM và 20 GiB reserve host; host 16 GiB RAM. Chưa tải ISO/cài UTM/tạo VM hoặc xóa dữ liệu người dùng.

Thứ tự tiếp tục: đủ storage → provision Ubuntu/Debian → pin actual inventory và export/re-pin cùng revision → FD01 rồi FD02/03/04/07 → LinuxCNC terminal và QtVCP checklist thật → combined BV01 + negative faults với hai engine → native report import/replay → clean offline target/5 người usability → clean amd64 signed install/reboot/rollback. Hardware safety/timing/guarded HIL là gate riêng.

`implemented`, `verified_mock`, `verified_native`, `accepted` không thay thế nhau. Inventory, doctor, animation, protocol double hoặc report import không tự xác nhận physics hay hardware.
