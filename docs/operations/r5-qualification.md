# Qualification R5: cái gì đã có, cái gì chưa, cách ghi

R5 đóng R5.0–R5.5 (hồ sơ thiết bị, phần Điện, tài liệu và gói ứng viên, dừng khẩn và chẩn đoán, UI). Bảng case và gate nằm ở [`scripts/sim-extension-r5.mjs`](../../scripts/sim-extension-r5.mjs) (48 case, chín gate đóng R5, hai gate ngoài `G-BENCH1` và `G-SAFE1` luôn `blocked_external`). Mọi record `accepted:false`; chấp nhận chỉ là sidecar do người viết.

## Trạng thái ngày 2026-11-25

- **Có:** bảng case/gate và test cấu trúc của nó; `scripts/record-r5-container.mjs` (CLD04, dựng CLD05 amd64, CLD06 `not_run`); campaign `stop-v1` ghi trên engine thật (16/16, `verify` exit 0) ở `robot/evidence-archive/r5-stop-v1-fa260332/`.
- **Chưa có:** recorder `record-sim-extension-r5.mjs`, reader `r5-readback.mjs`, nhánh `release==='r5'` trong `checkQualification` và guard acceptance. Chúng chỉ có ý nghĩa khi chạy cả chuỗi ghi; chuỗi đó chưa chạy (xem dưới), nên chưa có `qualification.json` r5 nào và **không gate nào của R5 được ghi `tested` trong một record**. Các suite chạy xanh trên máy này (xem status) là bằng chứng cục bộ, không phải record.
- **Cắt khỏi phạm vi:** E14 (I/O ảo `vio-v1`): VIO01–04 `not_run`, lý do `vio_cut`. Chọn thực thể bằng chuột trong twin 2D/3D (DGN02) và viền/biểu tượng cảnh báo trong twin (DGN04) chưa làm: `not_run`.

## Vì sao chưa chạy chuỗi ghi

Chuỗi là `Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → r4 → r5` ở **một tuple**, mỗi bước exit 0, dưới `caffeinate -dims`, màn hình mở khóa (xem [r4-qualification.md](r4-qualification.md) và `docs/2026-11-20-codebase-merge/rehearsal-2026-11-25.md`). Bước `owned-source-ci` dừng stack Supabase `mekoniq-w00-w04` và cần sự đồng ý của người dùng cho lần chạy này; cả chuỗi mất nhiều giờ. Chưa có lệnh, nên không chạy.

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
