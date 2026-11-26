# Qualification R5: cái gì đã có, cái gì chưa, cách ghi

R5 đóng R5.0–R5.5 (hồ sơ thiết bị, phần Điện, tài liệu và gói ứng viên, dừng khẩn và chẩn đoán, UI). Bảng case và gate nằm ở [`scripts/sim-extension-r5.mjs`](../../scripts/sim-extension-r5.mjs) (48 case, chín gate đóng R5, hai gate ngoài `G-BENCH1` và `G-SAFE1` luôn `blocked_external`). Mọi record `accepted:false`; chấp nhận chỉ là sidecar do người viết.

## Trạng thái ngày 2026-11-27

- **Record hiện tại: `r5-candidate-02`** ở source `0d365afd` / Lab `ea54ebe` (identity ổn định, `accepted:false`): 43/48 case `tested`, 5 `not_run`, 0 `failed`. `tested`: G-DEV1, G-ELE1, G-DOC1, G-STP1, G-DGN1, G-WEB3, G-REG6. `not_run`: G-VIO1 (VIO01–04, E14 cắt), G-CLOUD3 (chỉ còn CLD06 `deploy_order_pending`; CLD04 và CLD05 `tested`). G-BENCH1, G-SAFE1 `blocked_external`. JSON cấp trên và `index.json`: [`evidence/hardware-electrical/r5-candidate-02-0d365afd-lab-ea54ebe-2026-11-27/`](../implementation/evidence/hardware-electrical/r5-candidate-02-0d365afd-lab-ea54ebe-2026-11-27/README.md); archive thô `robot/evidence-archive/r5-chain-0d365afd/`, CLD05 `robot/evidence-archive/r5-cld05-0d365afd/` (ngoài Git). `r5-candidate-01` (`6da4ca94` / `78c9c38`) bị thay thế, còn trong lịch sử git.
- **Guard:** trong chuỗi (timeout 1 200 s) guard 27 (R4 `r4-candidate-03`) và 31 (R5) đều 13/13, exit 0.
- **Quyết định phạm vi (người dùng, 26/11):** giữ cắt E14. R5 được công bố là **"R5 không có I/O ảo"** khi tám gate còn lại đạt; G-VIO1 và VIO01–04 giữ `not_run`.
- **Việc còn lại để đóng:** deploy Cloud Run image của `0d365afd` (người dùng đã cho phép), ghi CLD06 dưới `evidence/cloud-run/` (guard `cloud-run` và `LAB_R5_CLOSING=1 … sim-extension` gắn vào byte của record R5), rồi push `main`. Không ký acceptance.

## CLD06 (từ 27/11, sau lần thất bại của candidate 02)

Ca cố định trước khi chạy cloud (`R5_CLD06` trong `scripts/cloud-run-qualification.mjs`): MJ-TRAY01, `tray-stop-coast-v1`, seed 7, dừng khẩn thả trôi ở `elapsed_sim_ms` 12 000 (tick 601 = `stopStartTick`), giữa đoạn thẳng đầu tiên. Vận tốc chạy đều tham chiếu 0.488 m/s (`cruiseOf` của run Mac không dừng cùng model: 0.4878 m/s từ tick 394, đoạn thẳng tới tick 804).
- Điều kiện đầu vào, từng tick trong 25 tick trước lệnh, cả hai bản: v ≥ 95 % tham chiếu, |ω| ≤ 0.05 rad/s; |v_cloud − v_Mac| ≤ 2 % v_Mac; |Δyaw| ≤ 0.02 rad (đã xử lý vòng góc). Không đạt → `ENTRY_CONDITION_MISMATCH`, CLD06 chưa đạt.
- Kết quả mong đợi mỗi bản: receipt dừng ở 601, torque từng bánh 0 ở 601, `needs_attention`, served 0, cốc không đổ. So `stopDistanceM`, `stopTimeMs`, `peakDecelerationMps2`: |cloud − Mac| / Mac ≤ 5 % từng metric (`CLD06_TOLERANCE_EXCEEDED` nếu vượt). Quãng đường cả run và tick kết thúc chỉ để chẩn đoán.
- Stream vật lý từng tick của cả hai bản (route `GET /lab/v2/runs/:id/physics/<chunk>`) được tải, ghi và đọc lại từ đĩa trước khi archive run; thiếu mẫu (pose, torque từng bánh, receipt) từ tick 575 tới lúc xác nhận đứng yên → `CLD06_EVIDENCE_MISSING`.
- Thứ tự: (1) `pnpm lab:mujoco -- --mujoco-mobile` trên Mac ở tuple của candidate, rồi `MEKONIQ_LAB_ACCESS_KEY=<mã ghép một lần> node scripts/record-r5-cloud.mjs reference --candidate <R5> --endpoint http://127.0.0.1:4176 --origin http://127.0.0.1:4175 --out <ref>` từ cây sạch ở commit candidate; (2) deploy theo lệnh; (3) `execute … --mac-reference <ref> --release-approved --out <dir>`; kết quả thất bại vẫn được ghi đầy đủ và đọc lại.
- Chạy thử cục bộ 27/11 (source `eb75e3f3`, ngoài Git: `robot/evidence-archive/r5-cld06-trial-eb75e3f3/`): Mac qua HTTP trùng bit với run trong tiến trình (0.8138 m, 3 280 ms, 0.172 m/s², đứng yên tick 765); container Linux arm64 qua cùng route: đầu vào đạt, lệch 0.63 % / 0.61 % / 3.2 %.

## Chạy chuỗi ghi

Chuỗi là `Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → r4 → r5` ở **một tuple**, mỗi bước exit 0, dưới `caffeinate -dims`, màn hình mở khóa (xem [r4-qualification.md](r4-qualification.md)). Bước `owned-source-ci` dừng stack Supabase `mekoniq-w00-w04` (người dùng đã đồng ý cho candidate 01 và 02). Driver hiện tại: `robot/evidence-archive/r5-handover-2026-11-26/run-final-chain-v7.sh OUT SRC LAB` (bước 29 dưới umask 022; guard 27 và 31 phải exit 0, không có `|| true`); watcher `watch-chain.py <status.ndjson>` chỉ exit 0 khi sự kiện `finished` cuối là `["0","1"]`. Re-pin bằng `repin.sh` (pipefail, thư mục tạm riêng, từ chối nếu pin chạm ngoài `apps/lab`).

## CLD04 / CLD05

```sh
node scripts/record-r5-container.mjs --out $OUT/container     # cây sạch; arm64 build + tests/integration/r5-container.test.ts; dựng amd64 (không chạy); CLD06 not_run
```

`tests/integration/r5-container.test.ts` (tự bỏ qua khi không có Docker hoặc `LAB_CONTAINER_IMAGE`): trong image, ba phương án compile qua API công khai; **phần thân bundle** (`allocation`, `netlist`, `checks`, `bom`, `driveModelDraft`, `state`) bằng phần thân do CLI compile trên Mac. Digest cả bundle không so được trực tiếp vì nó gồm digest project (project do Lab compile ở mỗi nơi), nên so phần thân. Một run `MJ-TRAY01` với lịch dừng khẩn `tray-stop-coast-v1` kết thúc `needs_attention` với `EMERGENCY_STOP` đúng tick; `docker diff` rỗng; không chạy root.

CLD05 cần host x86-64 thật chạy test Python của tool root (GitHub Actions sau khi push **một nhánh** `r5/...`, không phải `main`). Push nhánh lên repo `mekoniq` có thể tạo bản preview Vercel cho cả app cloud và Lab; chưa kiểm cấu hình đó, nên nêu điều này khi xin lệnh push.

## CLD06: gói phát hành (không thực hiện)

Chỉ làm khi có lệnh deploy riêng. Origin trình duyệt Cloud Run cho phép: `https://lab.mekoniq.app`.

1. Tuple: source commit và pin Lab trên `main` phải bằng nhau; `sourceCommit` trong health của Cloud Run phải bằng pin sau khi deploy. Hiện Cloud Run phục vụ `0650ecbd`, pin trên `main` cục bộ đã đi trước.
2. Image: `deploy/lab-runtime/build.sh <tag> --platform linux/amd64` (Cloud Run x86-64) rồi `cloud-run.sh` (mặc định dry-run; ghi cần lệnh). Image mang catalog điện (profile, fixture, linh kiện) không kèm tài liệu hãng.
3. Smoke: `GET /lab/v2/health` (commit, schema hash, năng lực `electrical_bundle_v1`) → compile project Serve 3D → compile ba phương án (trạng thái `blocked`/`compiled`/`compiled` và phần thân bundle bằng bản Mac) → một run dừng khẩn hoàn tất `needs_attention`/`EMERGENCY_STOP` → so với Mac theo kết quả và dung sai (khoảng dừng là quan sát trong mô hình chưa hiệu chuẩn, không là số tuyệt đối).
4. Đường lùi: revision Cloud Run trước (`mekoniq-lab-runtime-00005-s68`) và deployment Vercel trước đó; ghi cả hai trước khi bắt đầu.
5. Ghi CLD06 `tested` chỉ sau các bước 3; trước đó `not_run`, lý do `deploy_order_pending`.
