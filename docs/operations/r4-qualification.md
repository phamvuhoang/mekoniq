# Qualification R4 (V16): ghi, đọc, giới hạn

Record `r4` đóng R4.1–R4.5 ở một tuple (source commit, Lab commit, pin runtime, portable tools). Nó dùng cùng lõi `qualify`/`checkQualification` với R2b ([`scripts/sim-extension-r4.mjs`](../../scripts/sim-extension-r4.mjs)); mọi record `accepted:false`, chấp nhận chỉ nằm trong sidecar do người ký viết. Bộ thiết kế: [virtual-commissioning/design](../implementation/virtual-commissioning/design/README.md).

## Ghi

Điều kiện: cây source và Lab sạch, pin Lab = source HEAD, không có bytecode dưới portable root, output ngoài hai repo và chưa tồn tại. Chuỗi, mỗi bước exit 0 mới sang bước sau, dưới `caffeinate -dims`, không commit Lab giữa chừng, dừng stack `mekoniq-w00-w04` trước:

```
Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → campaign R4 → container (CLD01) → r4
```

Campaign R4 (từ worktree sạch tại đúng commit; symlink `node_modules`, `apps/*/node_modules`, `packages/*/node_modules` và `.venv-mujoco`):

```sh
for c in cil-v2 bench-v2 fault-v1 tray-v1 perception-gap-v1; do node scripts/lab-mujoco.mjs run --campaign $c --out $OUT/$c; node scripts/lab-mujoco.mjs verify --input $OUT/$c; done
node scripts/record-r4-container.mjs --out $OUT/container            # CLD01 (arm64 image + test), CLD02 not_run nếu không có --cld02-dir <thư_mục_native_r4-cld02>
node scripts/record-sim-extension-r4.mjs --r2b-record $OUT/r2b --cil-campaign $OUT/cil-v2 --fault-campaign $OUT/fault-v1 --tray-campaign $OUT/tray-v1 \
  --perception-study $OUT/perception-gap-v1 --bench-record $OUT/bench-v2 --container-record $OUT/container --mock-regression $OUT/mock --out $OUT/r4-candidate-NN
LAB_SIMEXT_EVIDENCE_DIR=$OUT/r4-candidate-NN pnpm test:acceptance -- sim-extension
```

`--plan` liệt kê suite và gate mà không chạy gì. `--calibration-selftest` chưa có recorder: không truyền thì các ca CAL ghi `not_run` (G-CAL1 nằm ngoài điều kiện đóng R4, contracts §10).

## Đọc

`scripts/r4-readback.mjs` đọc lại cả thư mục, không tin trạng thái nào trong `qualification.json`:

- Mỗi campaign được copy cạnh record, băm, rồi chạy lại verifier đã ghi nó (`verifyCilCampaign`, `verifyBenchCampaign`, `verifyFaultCampaign`, `verifyTrayCampaign`, `verifyPerceptionStudy`); sai id, sai commit, `accepted:true` hoặc thiếu run → case `failed`/`not_run`, không bao giờ `tested`.
- REG05 cần record R2b cùng tuple (đọc lại bằng reader R2b) và manifest hồi quy Lab trùng SHA-256 với bản R2a trong chuỗi, đúng identity đầu/cuối và không bỏ qua ca nào.
- CLD01 đọc hai ca trong suite container và đối chiếu log identity với image, commit và runtime. CLD02 nhận toàn bộ thư mục native từ `scripts/r4-cld02.sh` qua `--cld02-dir`: kiểm SHA256SUMS, host/guest, image, runtime, exit code và đủ 316 test worker đã đăng ký (kể cả từng tham số) trong JUnit lẫn `pytest/collection.json` của cùng lần pytest. Thay test worker phải cập nhật roster đã review trong `scripts/native-sim/r4-cld02-pytest-roster.txt` từ collection thật.
- WEB07 chạy launcher `--production-ui`: lưu và kiểm byte index, pin, mọi chunk JS/CSS (kể cả import động), rồi gắn từng sweep với build, Lab commit và tuple Source/runtime/schema/portable tools. Tám panel gồm Control, báo cáo lỗi, bộ soạn lỗi/timeline, khay, belief, study, recovery và calibration; mỗi panel đo VI/JA/EN × 390/1024/1440, axe serious/critical = 0, reduced motion, không cuộn ngang. Calibration đo riêng trạng thái có bảng/series, rỗng và lỗi. Fixture study/recovery có nhãn `synthetic-ui-only`, chỉ chứng minh giao diện; không đóng REC06 hoặc WEB10. WEB08/WEB10 đọc gói replay mẫu của Lab chép cạnh record bằng consumer Source (hash/coverage mọi asset, kể cả alias `.bin`). Receipt của test offline phải khớp manifest, run và tick có lỗi drive hoặc bước phục hồi trong cell.
- Thiếu đầu vào → `not_run` kèm lý do; hỏng/khác tuple/đã `accepted` → `failed`.

## Không ghi ở đây

- **CLD03** (deploy Cloud Run và smoke) chỉ chạy theo lệnh deploy của người dùng. Bằng chứng là thư mục bổ sung dưới `docs/implementation/evidence/cloud-run/`, kiểm bằng `checkCloudRunR4Evidence` (`scripts/cloud-run-qualification.mjs`): gắn với đúng byte của record R4, không sửa record, không chấp nhận gì. Chưa deploy → CLD03 `not_run: deploy_order_pending`.
  Supplement cần `deployment.json`, `health.json`, `cell-report.json`, `bench-report.json`, `mac-cell-report.json`, `summary.json` và `checksums.json`. Cell và bench phải là hai run riêng, đúng scenario/backend, worker báo `x86_64`; bản so sánh Mac là report cell `arm64` cùng Source commit. `summary.timing.cellTicks`/`benchTicks` phải khớp report, `realtimeFactor = cell.manifest.clock.tickMs / cellMsPerTick` (sai số tối đa 1e-6), và `macComparison.servedMac`/`servedCloud` phải khớp từng report. Fixture unit chỉ kiểm reader, không thay bằng chứng deploy.
- **CLD02** cần host Linux x86-64 thật (`scripts/r4-cld02.sh`; image runtime không mang test, giả lập không phải bằng chứng). Chưa có → `not_run`.
- **REC06** bị chặn: không lực đẩy nào làm kẹp hụt mà cốc còn trong tầm nhìn; không chỉnh gì để vừa. G-REC1 vì vậy không `tested`.
- **WEB09** đo frame p95 với đồ thị 5.000 mẫu và lớp belief. Suite `e2e-perf` (`lab/tests/e2e/mujoco-perf.spec.ts`) ghi schema 3 từ build production và runtime thật. Mỗi kịch bản có cửa sổ đo ít nhất 60 s.
  - Đồ thị bench dùng `MJ-BENCH-WHEEL` và được cuộn, đổi opacity mỗi 100 ms. Trace và tuning report phải cùng run và chứa đúng hai trục bánh xe. Mỗi trục có 10 vị trí substep ban đầu và 5.000 mẫu đo hợp lệ tại `dtS` = 0,002 s. Mẫu dùng số hữu hạn, cho phép feedback rỗng và cờ `saturated` kiểu boolean khi có. Hai bộ đếm đồ thị phải bằng số mẫu hợp lệ của trục đầu tiên, kể cả mẫu ban đầu hợp lệ. Manifest phải khai một backend `mujoco_3d` với model `mujoco_drive_bench` có dynamics, cùng ID và phiên bản với engine trong tuning report.
  - Replay offline của run cell `belief_estimated` thật phải có ít nhất 60 s phát ở tốc độ 1×. Mỗi pass bắt đầu tại tick của một seek được ghi tường minh. Tick đầu tiên phải khớp khai báo `firstTick` và nằm trước horizon. Reader so tiến độ cursor với đồng hồ tại mọi lần vẽ. Chênh lệch giữa thời gian thực và số tick đã tiến × 20 ms giữa hai lần vẽ bất kỳ trong cùng pass tối đa 200 ms. Tick có thể lặp trong vài lần vẽ liên tiếp. Khoảng cách giữa hai lần cursor tiến tối đa 500 ms. Mỗi pass hợp lệ được tính theo thời gian nhỏ hơn giữa hai đồng hồ. Quãng nghỉ qua mỗi seek tối đa 3 s và có tối đa 4 seek.
  - Giới hạn R2b desktop 3D là 33 ms cho p95 khoảng rAF, thời lượng vẽ và cadence render. Khoảng trống render trong một pass tối đa 500 ms. Sự kiện `twin-render` ghi thời điểm, thời lượng, draw call, `worldTick` và ghost belief. Ít nhất 80 % lần vẽ có ghost. Mỗi ghost phải có belief hợp lệ của cốc tại cursor theo luật `beliefAt` của Lab. Reader lấy bản ghi mới nhất không muộn hơn cursor. Update bị rơi giữ belief cũ. Cốc ra khỏi tầm nhìn hoặc belief không hợp lệ thì không có ghost.
  - Reader `scripts/r4-web09-readback.mjs` tính lại các số đo từ dữ liệu thô và kiểm tổng khoảng rAF bằng khoảng giữa khung đầu và cuối. Cửa sổ đo nằm trong ranh giới test do spec ghi, sau khi attempt bắt đầu và trước khi process kết thúc (`result.json` và `process.json`). `duration` của Playwright dùng để đối chiếu tổng thời gian đo vì đồng hồ này bỏ qua thời gian khởi tạo fixture. Reader kiểm runId, hash của các artefact, trạng thái hoàn tất của bench và `issues` của bench trace và perception. Cả hai workload phải khớp Source commit và build production của tuple đã ghi. Thiếu bản đo → `not_run`.
- G3 (hiệu chuẩn bằng dữ liệu đo), phần cứng và chữ ký chấp nhận nằm ngoài R4.

R4 chỉ được gọi là đầy đủ khi G-DRV1, G-CIL1, G-TUNE1, G-FLT1, G-TRAY1, G-BEL1, G-REC1, G-WEB2, G-REG5 và G-CLOUD2 đều `tested`.
