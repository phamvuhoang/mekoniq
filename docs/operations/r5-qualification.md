# Qualification R5: cái gì đã có, cái gì chưa, cách ghi

R5 đóng R5.0–R5.5 (hồ sơ thiết bị, phần Điện, tài liệu và gói ứng viên, dừng khẩn và chẩn đoán, UI). Bảng case và gate nằm ở [`scripts/sim-extension-r5.mjs`](../../scripts/sim-extension-r5.mjs) (48 case, chín gate đóng R5, hai gate ngoài `G-BENCH1` và `G-SAFE1` luôn `blocked_external`). Mọi record `accepted:false`; chấp nhận chỉ là sidecar do người viết.

## Trạng thái ngày 2026-11-27 (R5 đóng)

- **Record: `r5-candidate-03`** ở source `9de1a285` / Lab `a3b2f9f4` (`accepted:false`): 43/48 `tested`, 5 `not_run` (VIO01–04, CLD06). [`evidence/hardware-electrical/r5-candidate-03-…`](../implementation/evidence/hardware-electrical/r5-candidate-03-9de1a285-lab-a3b2f9f-2026-11-27/README.md); archive `robot/evidence-archive/r5-chain-9de1a285/`. Guard trong chuỗi R4/R5 13/13.
- **CLD06:** deploy revision `00007-q9t` (`9de1a285`); bản bổ sung [`cloud-run/mekoniq-r5-cld06-2026-11-27/`](../implementation/evidence/cloud-run/mekoniq-r5-cld06-2026-11-27/README.md) thất bại chỉ ở `peakDecelerationMps2` (5.2 %); điều kiện đầu vào, quãng và thời gian dừng đạt.
- **Đóng:** theo quyết định của người dùng trước khi chạy CLD06 (xem [phần quyết định](../implementation/evidence/cloud-run/mekoniq-r5-cld06-2026-11-27/README.md#quyết-định-phạm-vi-và-triển-khai)), R5 đóng là **"R5 không có I/O ảo, CLD06 chuyển sang R6"** (`checkR5Closing` với cut `G-VIO1,G-CLOUD3`; guard `LAB_R5_CLOSING=1 LAB_R5_CUT=G-VIO1,G-CLOUD3` 13/13). G-BENCH1, G-SAFE1 `blocked_external`. Không có acceptance.

## CLD06 (từ 27/11, sau lần thất bại của candidate 02)

Ca cố định trước khi chạy cloud (`R5_CLD06` trong `scripts/cloud-run-qualification.mjs`): MJ-TRAY01, `tray-stop-coast-v1`, seed 7, dừng khẩn thả trôi ở `elapsed_sim_ms` 12 000 (tick 601 = `stopStartTick`), giữa đoạn thẳng đầu tiên. Vận tốc chạy đều tham chiếu 0.488 m/s (`cruiseOf` của run Mac không dừng cùng model: 0.4878 m/s từ tick 394, đoạn thẳng tới tick 804).
- Điều kiện đầu vào, từng tick trong 25 tick trước lệnh, cả hai bản: v ≥ 95 % tham chiếu, |ω| ≤ 0.05 rad/s; |v_cloud − v_Mac| ≤ 2 % v_Mac; |Δyaw| ≤ 0.02 rad (đã xử lý vòng góc). Không đạt → `ENTRY_CONDITION_MISMATCH`, CLD06 chưa đạt.
- Kết quả mong đợi mỗi bản: receipt dừng ở 601, torque từng bánh 0 ở 601, `needs_attention`, served 0, cốc không đổ. So `stopDistanceM`, `stopTimeMs`, `peakDecelerationMps2`: |cloud − Mac| / Mac ≤ 5 % từng metric (`CLD06_TOLERANCE_EXCEEDED` nếu vượt). Quãng đường cả run và tick kết thúc chỉ để chẩn đoán.
- Stream vật lý từng tick của cả hai bản (route `GET /lab/v2/runs/:id/physics/<chunk>`) được tải, ghi và đọc lại từ đĩa trước khi archive run; thiếu mẫu (pose, torque từng bánh, receipt) từ tick 575 tới lúc xác nhận đứng yên → `CLD06_EVIDENCE_MISSING`.
- Thứ tự: (1) trên Mac ở tuple của candidate, runtime đã pin chạy với đúng các cờ của `pnpm lab:mujoco -- --mujoco-mobile` nhưng access key qua `MEKONIQ_LAB_ACCESS_KEY` (mã ghép 5 phút của launcher hết hạn trong bước đọc lại record 5 phút 34 giây; lỗi quy trình, sửa sau R5), rồi `MEKONIQ_LAB_ACCESS_KEY=<key> node scripts/record-r5-cloud.mjs reference --candidate <R5> --endpoint http://127.0.0.1:4176 --origin http://127.0.0.1:4175 --out <ref>` từ cây sạch ở commit candidate; (2) deploy theo lệnh; (3) `execute … --mac-reference <ref> --release-approved --out <dir>`; kết quả thất bại vẫn được ghi đầy đủ và đọc lại.
- Chạy thử cục bộ 27/11 (source `eb75e3f3`, ngoài Git: `robot/evidence-archive/r5-cld06-trial-eb75e3f3/`): Mac qua HTTP trùng bit với run trong tiến trình (0.8138 m, 3 280 ms, 0.172 m/s², đứng yên tick 765); container Linux arm64 qua cùng route: đầu vào đạt, lệch 0.63 % / 0.61 % / 3.2 %.

## Chạy chuỗi ghi

Chuỗi là `Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → r4 → r5` ở **một tuple**, mỗi bước exit 0, dưới `caffeinate -dims`, màn hình mở khóa (xem [r4-qualification.md](r4-qualification.md)). Bước `owned-source-ci` dừng stack Supabase `mekoniq-w00-w04` (người dùng đã đồng ý cho candidate 01 và 02). Driver hiện tại: `robot/evidence-archive/r5-handover-2026-11-26/run-final-chain-v7.sh OUT SRC LAB` (bước 29 dưới umask 022; guard 27 và 31 phải exit 0, không có `|| true`); watcher `watch-chain.py <status.ndjson>` chỉ exit 0 khi sự kiện `finished` cuối là `["0","1"]`. Re-pin bằng `repin.sh` (pipefail, thư mục tạm riêng, từ chối nếu pin chạm ngoài `apps/lab`).

## CLD04 / CLD05

```sh
node scripts/record-r5-container.mjs --out $OUT/container     # cây sạch; arm64 build + tests/integration/r5-container.test.ts; dựng amd64 (không chạy); CLD06 not_run
```

`tests/integration/r5-container.test.ts` (tự bỏ qua khi không có Docker hoặc `LAB_CONTAINER_IMAGE`): trong image, ba phương án compile qua API công khai với **digest đầy đủ của bundle** bằng digest host compile từ cùng project và đầu vào điện (`scripts/r5-readback.mjs` compile lại từ project đã ghi). Một run `MJ-TRAY01` với lịch dừng khẩn `tray-stop-coast-v1` kết thúc `needs_attention` với `EMERGENCY_STOP` đúng tick; `docker diff` rỗng; không chạy root.

CLD05 cần host x86-64 thật chạy test Python của tool root (GitHub Actions sau khi push **một nhánh** `r5/...`, không phải `main`). Push nhánh lên repo `mekoniq` có thể tạo bản preview Vercel cho cả app cloud và Lab; chưa kiểm cấu hình đó, nên nêu điều này khi xin lệnh push.

## CLD06: quy trình phát hành hiện hành

Chỉ làm khi có lệnh deploy riêng của người dùng. Origin trình duyệt Cloud Run cho phép: `https://lab.mekoniq.app`. Không dựng lại image: deploy đúng image CI của CLD05 đã xác minh.

1. Đường lùi ghi trước: revision Cloud Run đang phục vụ và deployment Vercel hiện tại của `mekoniq` và `mekoniq-lab`.
2. Image: tải artifact CI CLD05 (`handoff.json`), kiểm **ba digest đầy đủ** trước khi đẩy: `archiveSha256` của `image.tar`, `imageId` sau `docker load`, và `nativeImageSha256`; đẩy lên Artifact Registry rồi ghi digest registry. Lần R5 (`9de1a285`): `archiveSha256` `0591d0e0dcaf40f9605b1b23bdc9c6506cbbfab71155f98fdef32ad7d4f6bdb4`, `imageId` `sha256:b3070230982d94677d49d8b26864c13c0ea29ec2602c6a2307b67ac5965c5ae0`, `nativeImageSha256` `d6740e9c26482d95c838a0de7e9992e79d59f5bf6d5c97ca3144bd4c9a7b23e2`, registry `…/mekoniq-lab-runtime@sha256:410f9f138cd05c73e7dd537ae8a406eac17790243cb3390245a0a69bc72a9590`.
3. `cloud-run.sh` (mặc định dry-run; ghi cần lệnh), rồi `gcloud run services update-traffic --to-latest`; chờ `GET /lab/v2/health` trả `sourceCommit` = pin trên `main`.
4. `record-r5-cloud.mjs execute … --mac-reference <ref> --release-approved --out <dir>` (mục CLD06 ở trên); kết quả thất bại vẫn được ghi đầy đủ và đọc lại.
5. Commit evidence, push `main` theo lệnh, smoke `lab.mekoniq.app` (pin) và `www.mekoniq.app/health/ready`.

Hiện hành (27/11): revision `mekoniq-lab-runtime-00007-q9t` phục vụ `9de1a285`; đường lùi `00005-s68`, Vercel `dpl_3NxQwSoN1F5vP36f34yW6bBdzt9s` / `dpl_69k2Sq7zAyxzAJWguSRrAWDSA28E`.

## Lịch sử

- Trước 27/11 Cloud Run phục vụ `0650ecbd` (R4, revision `00005-s68`); gói phát hành dự kiến khi đó dựng lại image bằng `deploy/lab-runtime/build.sh <tag> --platform linux/amd64` và CLD04 chỉ so phần thân bundle (`allocation`, `netlist`, `checks`, `bom`, `driveModelDraft`, `state`). Cả hai đã được thay bằng quy trình trên.
