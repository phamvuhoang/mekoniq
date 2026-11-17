# MEKONIQ Lab — sửa các phát hiện của buổi smoke 2026-11-14

- **Báo cáo gốc:** [../../implementation/smoke-local-cloud-2026-11-14.md](../../implementation/smoke-local-cloud-2026-11-14.md) (bằng chứng, số liệu, đính chính).
- **Plan:** [../plans/2026-11-14-smoke-findings/README.md](../plans/2026-11-14-smoke-findings/README.md)

## 1. Mục tiêu và phạm vi

Sửa hoặc làm rõ chín phát hiện F1–F9 mà không đổi kết quả mô phỏng. Trừ F3 và F4 (cần đo trước), mọi sửa đổi nằm ở **Lab** và tài liệu; **không đổi** runtime, schema, công cụ mô phỏng, nên không cần ghim lại source và không làm hỏng bản ghi `candidate-09`, `r1-candidate-07`, `r11-candidate-04`, `r2a-candidate-02`.

| Mã | Mức | Sửa | Nơi |
|---|---|---|---|
| F1 | P1 | Cốc giữ vị trí cuối trên khay đến khi chủ sở hữu đổi | Lab `twin/scene.ts` |
| F5 | P1 | Chọn kịch bản khi run đã xong hoạt động và có phản hồi; thêm "Đóng lần chạy" | Lab `ui/workspace.ts`, `ui/run-bar.ts` |
| F6 | P1 | Giao diện nói rõ engine nào và "hình do Lab vẽ"; tài liệu so sánh engine; thử chế độ xem Webots | Lab UI, docs |
| F2 | P2 | Bảng Kỹ thuật dùng `FROZEN_SIM` khi pause, "kết thúc" khi run xong | Lab `twin/arm/arm-telemetry.ts`, `twin/inspector.ts` |
| F3 | P2 | Đo, rồi chốt hợp đồng tất định giữa các lần chạy và nền tảng | đo + docs, có thể thêm test |
| F4 | P2 | Tái hiện có kiểm soát, rồi chọn giảm thiểu | đo trên cloud, có thể đổi `cloud-run.sh` |
| F7 | P2 | Runbook ghi đúng quyền archive và cách giải phóng slot | `docs/operations/lab-runtime-cloud-run.md` |
| F8 | P3 | Nút "Kiểm tra mô hình" vô hiệu có lý do khi bundle không có URDF | Lab `ui/assembly-page.ts` |
| F9 | P3 | Ghép nối không đặt lại kịch bản đang chọn | Lab `ui/workspace.ts` |

**Ngoài phạm vi (không làm, không được suy ra):** đổi `mujoco-arm-ports.ts` hay hành vi gỡ prop; render Webots trong trình duyệt hoặc nhúng GUI Webots; gộp hoặc bỏ IR-SIM/Webots; hiệu chuẩn; sửa bất cứ gate nào; deploy production và đẩy `main` (cần lệnh riêng của người dùng, theo CLAUDE.md); xóa hay sửa bản ghi bằng chứng cũ; ghi `acceptance.json`.

## 2. Nguyên tắc

- Hình vẽ không bao giờ bịa trạng thái mới. Khi vẽ thứ không còn được báo, phải là **giá trị cuối đã quan sát** và nói rõ nguồn, không phải suy đoán.
- Không có số mô phỏng nào đổi. Mọi test hiện có về số liệu run (KPI, `tick`, `served`) giữ nguyên.
- Mỗi sửa có một test kiểm chéo thất bại trước khi sửa (TDD), theo kiểu dày đặc của file bên cạnh.
- Tên i18n: mọi chuỗi `tr(vi, ja, en)` đủ ba ngôn ngữ.

## 3. Thiết kế từng phát hiện

### F1: cốc giữ vị trí cuối đến khi đổi chủ

**Hành vi hiện tại.** `plantCup(f,cupId)` (`scene.ts:31`) trả `null` khi mẫu cốc cũ hơn mẫu `mujoco_arm` mới nhất quá 1 s (`PLANT_CUP_STOPPED_NS`). Khi đó cốc vẽ sơ đồ tại chủ sở hữu (`cupLocation`).

**Quy tắc mới.** Mẫu đã dừng chỉ nghĩa là "cốc rời cell" khi chủ sở hữu trong run view **không còn** là `arm` hoặc `cell`. Nếu chủ vẫn là `arm` hoặc `cell` và có mẫu cuối, giữ vẽ cốc theo pose cuối (hình dạng và kích thước của cốc plant, không phải cốc sơ đồ). Khi chủ đổi sang `robot`/`customer` thì quay về vẽ theo người giữ như cũ.

- Chỉ đọc dữ liệu đã có: mẫu cuối nằm sẵn trong `f.samples[cupId]`, không thêm trạng thái hay lịch sử.
- `droppedPlantCups` giữ nghĩa: cốc plant có báo mà run view không liệt kê.
- Run kết thúc hoặc bị chốt (latched) khi cốc còn ở cell: cốc ở lại pose cuối, đúng sự thật hơn cốc sơ đồ.

**Chấp nhận.** Với `MJ-BV01` ở tốc độ bất kỳ: không có khung nào cốc được vẽ cao hơn 0,9 m hoặc cách khay quá 0,05 m giữa tick 1825 và 1926 (cup-1), 3740 và 3839 (cup-2); `plantCupsDropped=0` như hiện nay; test 83 của `arm-mesh.test.ts` được viết lại theo quy tắc mới (mẫu dừng và chủ `arm` → còn `plant`; chủ `robot` → bỏ `plant`).

### F5: chọn kịch bản khi run đã xong

**Quyết định (khuyến nghị, người dùng duyệt):**
1. Run ở trạng thái cuối (`completed`/`failed`/`cancelled`): chọn kịch bản khác thực hiện `retire()` (lưu bằng chứng và archive như đường "Chạy lại"), bỏ gắn run rồi áp kịch bản mới. Không tạo run mới.
2. Run đang `running`/`paused`: các mục trong bộ chọn bị vô hiệu kèm lý do "Hủy hoặc đóng lần chạy hiện tại trước".
3. Thêm nút **"Đóng lần chạy"** khi run ở trạng thái cuối: gọi `retire()` rồi để màn hình ở trạng thái "chưa chạy". Đây là cách duy nhất từ giao diện để giải phóng chỗ MuJoCo và đóng luồng SSE mà không tạo run mới.
4. Nếu `retire()` thất bại (runtime mất run, `RUN_NOT_FOUND`), áp dụng như đường "Chạy lại" hiện nay: ghi thông báo "lần chạy trước không còn trên runtime", vẫn chuyển kịch bản.

**Chấp nhận.** Sau khi một run hoàn thành, chọn kịch bản khác đổi tiêu đề và cảnh ngay, không cần tải lại và không mất ghép nối; bộ chọn có phản hồi khi bị vô hiệu; gọi `archive` đúng một lần cho run cũ; không còn lựa chọn bị bỏ qua im lặng.

### F6: giao diện nói rõ engine, tài liệu so sánh engine

- **Nhãn engine.** Trên thanh trạng thái hoặc vùng khung nhìn của Bản sao số, hiện nhãn ngắn lấy từ `report.arm.armPlant.engine` hoặc engine của run: ví dụ "Vật lý: Webots R2025a (3D)" hay "Vật lý: IR-SIM (2D động học)", kèm tooltip "Hình do Lab vẽ từ pose engine báo; cửa sổ Webots không dùng để xem". Mock hiện "Mock".
- **Chú thích Webots đen.** Trong help (phím `?`) và trong thông báo khi chạy Webots lần đầu, một câu giải thích: cửa sổ Webots mở nhưng tắt render để chạy nhanh; mô phỏng vẫn chạy.
- **Tài liệu.** Thêm một bảng "mỗi engine mô hình hóa gì và không mô hình hóa gì" (IR-SIM, Webots, MuJoCo, mock) vào `lab/docs/simulation-compatibility.md`, với những gì quan sát được trong báo cáo (engine, phiên bản, pose 3D, LiDAR).
- **Chế độ xem Webots.** Thử và ghi lại cách chạy `MEKONIQ_WEBOTS_WATCH=1 pnpm lab:webots` trên máy này (một lần, ghi kết quả thật: chạy được hay không, có lặp lại lỗi treo `--minimize` không). Không đổi mặc định headless.

**Chấp nhận.** Người xem một run Webots và một run IR-SIM phân biệt được engine từ nhãn mà không cần mở báo cáo; tài liệu trả lời được "Webots khác IR-SIM ở đâu"; kết quả thử chế độ xem được ghi nguyên văn (kể cả khi thất bại).

### F2: độ cũ khi pause và khi run kết thúc

- `armJointsView(sample, nowMs, staleMs, opts)`: thêm `opts.frozen` (`'paused'|'ended'|null`). Khi có `frozen` và mẫu có `quality==='valid'`: `stale=false`, `quality` giữ `valid`, `reasonCodes` thêm `FROZEN_SIM` (pause) hoặc `RUN_ENDED` (kết thúc), `ageMs` hiển thị là tuổi **tại thời điểm đóng băng**, không tăng theo đồng hồ.
- `inspector.ts` tính `frozen` từ `f.link?.paused` và trạng thái run (`completed/failed/cancelled`), truyền vào; nhãn nguồn dùng nguồn thật của mẫu (`thực (MuJoCo)`), không rơi về "chưa rõ".
- `twin3d.ts:57` và `live-playback.ts:17` giữ hành vi cũ (hình đóng băng khi `stale`), chỉ đồng bộ cờ.
- Phần cứng không có ngoại lệ pause (như `freshness.ts:16`).

**Chấp nhận.** Pause giữa run: dòng khớp hiện `FROZEN_SIM`, tuổi không tăng, nguồn là nguồn thật. Run xong: `RUN_ENDED`. Mẫu `quality==='stale'` thật từ runtime vẫn `stale`.

### F3: hợp đồng tất định giữa các lần chạy và nền tảng (đo trước)

Thí nghiệm có kiểm soát, không sửa gì cho đến khi có số:

1. Cùng seed 42, cùng lịch chia bước cố định (ví dụ chỉ 50-tick), chạy 2 lần local; so `arm-trace` sha và số mẫu.
2. Cùng seed, hai lịch chia bước khác nhau (chỉ 1×, chỉ 16×), local.
3. Cùng lịch cố định, local so với Cloud Run (x86-64).
4. Từ kết quả: (a) nếu 1 bằng nhau và 2 khác → số mẫu phụ thuộc cách chia bước: ghi hợp đồng "tất định theo lịch bước", thêm test; (b) nếu 1 khác → lỗi tất định cần điều tra riêng; (c) nếu chỉ 3 khác → ghi dung sai nền tảng vào docs (không phải lỗi).

**Chấp nhận.** Một ghi chú đo được (số thật) trong `docs/implementation/`; hợp đồng viết thành câu có thể kiểm; không còn "lệch chưa rõ".

### F4: instance active sau khi đóng tab (đo trước)

1. Tạo run bằng producer có sẵn (CL01) hoặc một script, mở luồng sự kiện bằng `curl`, rồi `kill -9` `curl`. Theo dõi `instance_count{state=active}` và `max_request_concurrencies` 5–10 phút. Cần lệnh riêng của người dùng (ghi lên dịch vụ cloud thật, tốn tiền nhỏ) và một run đang mở.
2. Nếu active giữ đến khi hết timeout → Cloud Run không báo ngắt kết nối xuống container; giảm thiểu theo thứ tự: (a) `--timeout` 900 s (Lab nối lại từ con trỏ nên an toàn), đổi trong `cloud-run.sh` và runbook; (b) Lab gọi `navigator.sendBeacon` tới archive khi `pagehide` (cần đường không cần CSRF cookie; cân nhắc riêng).
3. Nếu active tắt ngay → nguyên nhân là client sống, ghi lại cách tìm.

**Chấp nhận.** Kết luận có số đo, hoặc bằng chứng không tái hiện được; nếu đổi `--timeout` thì chỉ thay `cloud-run.sh` và runbook, **không deploy** trừ khi có lệnh.

### F7: runbook cloud

Thêm vào `docs/operations/lab-runtime-cloud-run.md`:
- Run thuộc phiên đã tạo; khóa vận hành ghép nối được nhưng không archive hay đọc run của phiên khác (`RUN_NOT_FOUND` giống "không tồn tại").
- Cách giải phóng chỗ MuJoCo: "Đóng lần chạy" trong Lab (sau F5); hoặc chờ phiên hết hạn (≤ 1 giờ) rồi lần tạo run kế tiếp đóng run mồ côi; hoặc tạo revision mới (ghi lên production, cần lệnh).
- Gọi từ ngoài trình duyệt phải gửi `Origin` được phép (`ORIGIN_REQUIRED`).
- Đo chi phí thực: instance active tính tiền, kể cả sau khi đóng tab (F4), và liên kết tới Budget alert.

### F8: kiểm tra mô hình không áp dụng

Trên trang Lắp ráp, nút "Kiểm tra mô hình" ở bundle không có URDF (Webots 3D) bị vô hiệu kèm dòng "Không áp dụng cho engine này: bundle không có URDF" thay vì gọi runtime và hiện `ENGINEERING_CLOSURE_MISSING`. Nguồn quyết định: chính hồ sơ engine của bundle, không so chuỗi mã lỗi.

### F9: ghép nối đặt lại kịch bản

Giữ `this.preset` qua ghép nối. Cần tìm điểm đặt lại (nghi ở đường `checkReadiness`/`health`), viết test tái hiện trước.

## 4. Kiểm chứng

| Lớp | Lệnh | Thuộc |
|---|---|---|
| Kiểu và đơn vị | `pnpm typecheck && pnpm exec vitest run` trong `lab/` | mọi sửa Lab |
| e2e mock | `pnpm test:mock-e2e` | F5, F9 |
| e2e MuJoCo | `pnpm test:mujoco-e2e -- tests/e2e/mujoco-coffee.spec.ts` | F1, F2 |
| e2e Webots, IR-SIM | `pnpm test:webots-e2e`, `pnpm test:irsim-e2e` (mỗi lần một spec) | F6, F8 |
| Hồi quy R-MOCK | `node scripts/record-regression.mjs --suite physical-robot-lab …` ra ngoài cây | trước khi coi sửa Lab là xong |
| Tay | Cùng các bước smoke trong báo cáo, Chrome | mọi F có hình |

Cổng nào đang `tested` vẫn `tested`; không gate nào bị ghi `accepted`.

## 5. Rủi ro và quyết định mở

| # | Nội dung | Mặc định |
|---|---|---|
| Q1 | F5: chọn kịch bản trên run đã xong có tự `retire()` không, hay chỉ vô hiệu và buộc bấm "Đóng lần chạy"? | Tự `retire()` (ít thao tác); cần người dùng duyệt vì nó archive run |
| Q2 | F4(b): có làm `sendBeacon` archive khi đóng tab không (cần đường không CSRF)? | Không, đo trước, chỉ làm nếu (a) không đủ |
| Q3 | F6: có thêm công tắc "Xem Webots thật" trong UI? | Không; chỉ tài liệu |
| Q4 | Deploy Lab lên production sau khi sửa | Không tự làm; đẩy `main` là deploy production, cần lệnh riêng |
| R1 | F1 vẽ cốc theo pose cuối có thể sai nếu cốc thật sự bị lấy đi mà chủ vẫn `arm` | Chủ chỉ đổi khi chuyển giao được xác nhận (ghi chú trong `inspector.ts`), nên pose cuối là giá trị đúng nhất |
