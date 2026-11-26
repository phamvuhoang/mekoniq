# Qualification R5: cái gì đã có, cái gì chưa, cách ghi

R5 đóng R5.0–R5.5 (hồ sơ thiết bị, phần Điện, tài liệu và gói ứng viên, dừng khẩn và chẩn đoán, UI). Bảng case và gate nằm ở [`scripts/sim-extension-r5.mjs`](../../scripts/sim-extension-r5.mjs) (48 case, chín gate đóng R5, hai gate ngoài `G-BENCH1` và `G-SAFE1` luôn `blocked_external`). Mọi record `accepted:false`; chấp nhận chỉ là sidecar do người viết.

## Trạng thái ngày 2026-11-26

- **Record đầu tiên: `r5-candidate-01`** ở source `6da4ca94` / Lab `78c9c38` (identity ổn định, `accepted:false`): 40/48 case `tested`, 8 `not_run`, 0 `failed`. `tested`: G-DEV1, G-ELE1, G-DOC1, G-STP1, G-WEB3, G-REG6. `not_run`: G-VIO1 (VIO01–04, E14 cắt), G-DGN1 (DGN02/04), G-CLOUD3 (CLD05/06). G-BENCH1, G-SAFE1 `blocked_external`. JSON cấp trên và `index.json`: [`evidence/hardware-electrical/r5-candidate-01-6da4ca94-lab-78c9c38-2026-11-26/`](../implementation/evidence/hardware-electrical/r5-candidate-01-6da4ca94-lab-78c9c38-2026-11-26/README.md); archive thô `robot/evidence-archive/r5-chain-6da4ca94/` (ngoài Git).
- **Guard:** trong chuỗi, guard 27 (R4) và 31 (R5) đạt 11/12 vì test đọc toàn bộ artifact chạm timeout 300 s; reader trực tiếp trả `problems: []`. Sau khi ghi, commit `test:` `f4c72c29` nâng riêng timeout đó lên 1 200 s; guard chạy lại: R4 12/12 exit 0 (322 s), R5 12/12 exit 0 (339 s); SHA-256 hai `qualification.json` không đổi.
- **Quyết định phạm vi (người dùng, 26/11):** giữ cắt E14. R5 được công bố là **"R5 không có I/O ảo"** khi tám gate còn lại đạt; G-VIO1 và VIO01–04 giữ `not_run`.
- **Giới hạn của candidate 01** (sửa ở candidate kế tiếp): oracle dừng, allocator khi chưa biết chu kỳ, verifier gói, Diagnostics trước mẫu đầu, nhãn brake/coast của câu gợi ý, phép so CLD04 và verifier S4. Chi tiết trong README của bản ghi.

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
