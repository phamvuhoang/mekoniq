# Báo cáo smoke 2026-11-14: mọi mô phỏng chạy local, MuJoCo chạy cloud

**Phạm vi.** Chạy tay từng mô phỏng của Lab trên Chrome ở máy phát triển, và chạy `MJ-BV01` trên Cloud Run. Source `4f893ac`, Lab `a744954`, Lab ghim `4f893ac`.
**Không phải** nghiệm thu: không có `acceptance.json`, native và phần cứng vẫn `not_run`, kiểm tay Chrome/Firefox/Safari cho luồng HTTPS → loopback chưa làm. Mọi số dynamics vẫn `not_calibrated`.

Spec sửa lỗi: [../superpowers/specs/2026-11-14-smoke-findings-design.md](../superpowers/specs/2026-11-14-smoke-findings-design.md). Plan: [../superpowers/plans/2026-11-14-smoke-findings/README.md](../superpowers/plans/2026-11-14-smoke-findings/README.md).

## 1. Kết quả chạy

Tất cả hoàn thành, không banner lỗi, `drop 0 · gap 0` ở nơi có đếm.

| Nhóm | Kịch bản | Cách chạy | Đã giao | Thời gian sim | Ghi chú |
|---|---|---|---|---|---|
| Mock | Cà phê sữa đá (BV01) | Chrome, 16× | 2 | 97,8 s | 300 sự kiện |
| Mock | Một đơn giao món (FD01) | Chrome, 4× | 1 | 34,2 s | 53 sự kiện |
| Mock | Món ăn và cà phê cùng chuyến | Chrome, 4× | 2 | 81,8 s | 203 sự kiện |
| Mock | Chiến dịch hai robot | Chrome, 4× | 4 | 121,4 s | đo được ~3,3× |
| Mock | `twin-recovery`, `coffee-journey` | e2e `test:mock-e2e` | | | 2/2 đạt (12,3 s, 9,4 s) |
| IR-SIM 2D | FD01 một robot | Chrome, 4× | 1 | 61,9 s | LinkForge `Đạt`, 7 PASS, 2 `NOT_RUN` có lý do |
| IR-SIM 2D | FD07 hai robot | Chrome, 4× | 2 | 118,4 s | cả hai robot `Đạt` |
| IR-SIM 2D | `irsim-journey`, `irsim-fleet` | e2e | | | 2/2 đạt (24,8 s, 37,8 s) |
| Webots 3D | FD01 | Chrome, 4× | 1 | 103,0 s | |
| Webots 3D | FD07 hai robot | Chrome, 4× | 2 | 194,9 s | đo được 2,1–2,4× |
| Webots 3D | Cà phê với tay máy | Chrome, 4× | 2 | 99,0 s | |
| MuJoCo xArm 6 | MJ-BV01 local | Chrome | 2 | 96,2 s, tick 4810 | ARM03 `pass`, 976 mẫu |
| MuJoCo xArm 6 | MJ-BV01 cloud | Chrome → Cloud Run | 2 | 96,2 s, tick 4810 | ARM03 `pass`, 976 mẫu |

Không chạy có chủ ý: `BV01 native SIM` (cần native, `not_run` theo thiết kế), Gazebo, LinuxCNC và các backend chưa cài.

### MuJoCo local so với cloud

| | Local | Cloud |
|---|---|---|
| Lệch đỉnh q1…q6 (rad) | 0,0176 / 0,0247 / 0,0101 / 0,0003 / 0,0099 / 0,0001 | y hệt |
| RMS q1…q6 (rad) | 0,0053 / 0,0093 / 0,0030 / 0,0001 / 0,0039 / 0,0000 | y hệt |
| Mẫu telemetry | 4566 (amr/arm/coffee 1201, cup-1 442, cup-2 521) | 4538 (1193, cup-1 442, cup-2 517) |
| sha256 vệt cánh tay | `d2f1c3251ba8` | `bb7efd60fd79` |
| Va chạm cho phép đã áp dụng | 412 | |

Kết quả vật lý và nghiệp vụ giống nhau; số mẫu và mã băm lệch nhẹ (F3).

### Cloud Run

- Health công khai `GET /lab/v2/health`: 200, `sourceCommit` `4f893ac`, giao thức 2.
- Chi phí tính theo thời gian có request mở, không có phí cố định: 0,146 USD mỗi giờ instance hoạt động (1 vCPU, 2 GiB, Singapore Tier 2, giá trong runbook mục 8, chưa trừ free tier, chưa đối chiếu lại với bảng giá chính thức).
- Lần smoke này instance active khoảng 03:30–04:33 UTC (≈ 1 giờ 3 phút, ≈ 0,16 USD), tắt hẳn khoảng 04:50 UTC.

## 2. Phát hiện

Mức: **P1** người xem demo dễ thấy hoặc gây hiểu sai, **P2** đúng nhưng gây rối hoặc tốn, **P3** nhỏ.

| Mã | Mức | Phát hiện | Bằng chứng | Trạng thái nguyên nhân |
|---|---|---|---|---|
| F1 | P1 | Cốc "nhảy" khỏi khay sang vị trí tay máy ở độ cao 1,0 m trong ~2 s sau khi đặt xuống | CSV `mekoniq-run-MJ-BV01-seed42-d0abab0b.csv`: mẫu cốc cup-1 dừng ở tick 1825, chủ đổi sang robot ở tick 1926; cup-2: 3740 → 3839 | Đã xác định (mục 3.1) |
| F5 | P1 | Khi run đã hoàn thành còn hiện, chọn kịch bản khác bị bỏ qua và không báo gì; tải lại để đổi thì mất ghép nối, mã ghép nối dùng một lần | Lặp lại 4 lần trên 3 launcher | Đã xác định ở `workspace.ts:559`, cần xác nhận vì sao tiêu đề không đổi |
| F6 | P1 | Cửa sổ Webots đen; Webots và IR-SIM trông giống nhau trên web nên người xem không thấy khác biệt | Câu hỏi của người dùng; `engine.py:53` | Đã xác định: thiết kế (mục 3.6) nhưng giao diện không giải thích |
| F2 | P2 | Pause, và sau khi run kết thúc, bảng Kỹ thuật hiện `STALE`, tuổi tăng mãi, nguồn "chưa rõ" thay vì `FROZEN_SIM` | Ảnh 09:29, 09:46: tuổi 802 071 ms, 20 490 ms | Đã xác định: `armJointsView` bỏ qua pause (`arm-telemetry.ts:10`) |
| F4 | P2 | Cloud Run instance vẫn active ~30 phút sau khi tab đóng | Số liệu Monitoring: `active` = 1 và 2 request đồng thời từ 03:30 đến ~04:33 UTC | **Chưa rõ**: code gateway có xử lý `close` (`event-stream.ts:44-46`) |
| F3 | P2 | Số mẫu telemetry và mã băm vệt cánh tay lệch nhẹ giữa cloud và local | Bảng trên | **Chưa rõ** |
| F7 | P2 | Runbook chưa nói khóa vận hành không archive được run của phiên khác; không có cách dọn từ ngoài | Archive bằng khóa trả `RUN_NOT_FOUND` cho run của tab (`gateway.ts:243,254`) | Đã xác định: thiết kế, thiếu tài liệu |
| F8 | P3 | Nút "Kiểm tra mô hình" trên bundle Webots luôn bị từ chối `ENGINEERING_CLOSURE_MISSING: robots/amr-1.urdf` | Trang Lắp ráp, mục Webots 3D | Đã xác định: bundle Webots không có URDF; e2e Webots không có bước này |
| F9 | P3 | Sau khi ghép nối, kịch bản chọn trước đó bị đặt lại về "Cà phê sữa đá" | Quan sát 3 lần | Chưa tìm chỗ gây ra |

Thông tin thêm, không phải lỗi: tốc độ chọn chỉ là mục tiêu (Webots đo được 2,1–2,4× khi chọn 4×; tài liệu đã cảnh báo).

## 3. Phân tích

### 3.1 F1: cốc nháy
Hai nguồn sự thật chạy lệch nhịp.
1. Khi cốc đã nằm yên trên khay, cổng arm gỡ prop khỏi MuJoCo (`mujoco-arm-ports.ts:126`, `pose:null`). Từ đó plant không còn mẫu cho cốc.
2. Chủ sở hữu trong run view đổi sang `robot` ở lần `CupTransferConfirmed` kế tiếp, ~100 tick (2 s) sau.
3. Trong khoảng đó `plantCup()` coi cốc "đã rời cell" vì mẫu cũ hơn mẫu mới nhất 1 s (`scene.ts:31-35`), nên vẽ cốc sơ đồ tại chủ cũ: `cupLocation` cho `arm` là `(arm.x, arm.y−0,3)`, độ cao mặc định 1,0 m (`twin3d.ts:106`).

Dữ liệu và nghiệp vụ đúng; chỉ hình vẽ sai trong 2 s. Test hiện tại đang khóa hành vi này (`arm-mesh.test.ts:83`).

### 3.2 F2: bảng Kỹ thuật khi pause và khi kết thúc
`freshness.ts:16` đã có `frozen_sim` khi `link.paused`, nhưng bảng khớp dùng `armJointsView` (`inspector.ts:31`), chỉ so tuổi với 500 ms và không biết pause hay run đã kết thúc. Run kết thúc không còn mẫu nên tuổi tăng theo đồng hồ trình duyệt.

### 3.3 F3: lệch nhẹ cloud và local
Chưa có nguyên nhân. Giả thuyết chưa kiểm: (H1) số mẫu phụ thuộc cách chia bước (lần local chạy ở 1×, 4× và 16× xen kẽ, cloud chỉ 16×); (H2) khác nền tảng (arm64 và x86-64) cho phép khác sai số dấu phẩy động; (H3) khác điểm cắt tick cuối. Hướng sửa phụ thuộc kết quả đo.

### 3.4 F4: instance active sau khi đóng tab
Code gateway kết thúc luồng khi `request`/`response` phát `close` (`event-stream.ts:44-46`), nên lập luận "gateway bỏ qua ngắt kết nối" **không đúng**. Số liệu cho thấy 2 request đồng thời giữ ~60 phút (đúng bằng `--timeout=3600`) rồi mới thôi. Có thể (a) một client sống ở đâu đó, nhưng client sống sẽ nối lại và instance sẽ không tắt, (b) Cloud Run không chuyển tiếp việc ngắt kết nối cho container, (c) kết nối giữ ở tầng trước container. Cần thí nghiệm có kiểm soát trước khi sửa.

### 3.5 F5 và F9: chọn kịch bản
`workspace.ts:559`: `twin-preset` gán `this.preset` nhưng khung nhìn lấy tiêu đề và cảnh từ run đang gắn (`this.view`, `runPreset`), nên lựa chọn đi vào trạng thái treo không phản hồi. Cách duy nhất hiện nay để bỏ run đã xong là "Chạy lại cùng đầu vào" (đường `retire()` ở `workspace.ts:477`), vốn tạo ngay một run mới.

### 3.6 F6: cửa sổ Webots đen, Webots và IR-SIM trông giống nhau
- Webots là ứng dụng riêng mà runtime khởi động ngầm làm engine vật lý. macOS không có chế độ headless thật, nên cửa sổ vẫn mở, nhưng worker truyền `--batch --no-rendering --mode=fast` (`engine.py:53-56`, commit `bb16724`) để khỏi treo khi nạp world. Mô phỏng vẫn chạy; đã đo LiDAR và đọc lại từ supervisor bằng bản có render thì bằng nhau.
- Hình trên web **không** phải hình của Webots. Đó là twin ba chiều của Lab (three.js) vẽ theo pose mà engine báo mỗi tick (`pose3d`: độ cao, roll, pitch). Spec R1 quyết định như vậy (`2026-11-10-simulation-extension-design.md`: F11, D12) nên mọi backend dùng chung một twin.
- Khác biệt thật nằm ở engine, và giao diện không nói ra:

| | IR-SIM 2D | Webots 3D |
|---|---|---|
| Mô hình | động học 2D, robot là hình bao trên mặt phẳng | vật lý vật rắn 3D: khối lượng, quán tính, ma sát, bánh và bánh lăn phụ |
| Pose | x, y, yaw | thêm độ cao, roll, pitch |
| LiDAR | tia 2D | quét theo engine |
| Cài đặt | worker Python mang theo, không cần phần mềm ngoài | cần Webots R2025a trên máy, không nằm trong gói offline |
| Vai trò | kiểm tuyến, vùng, tránh vật cản nhanh, mọi nơi | kiểm chéo bằng vật lý 3D; backend hồi quy |

  Cùng kịch bản FD01 cho 61,9 s trên IR-SIM và 103,0 s trên Webots. Đó là loại khác biệt mà engine vật lý tạo ra, nhưng tôi **chưa tách nguyên nhân** (robot và tham số cũng khác).
- Có chế độ xem Webots thật cho phát triển: `MEKONIQ_WEBOTS_WATCH=1` (render, thời gian thực; `worker-client.ts:15`). Chưa thử trên máy này.

### 3.7 F7: dọn run từ ngoài
Run thuộc về phiên đã tạo nó: `entry.owner!==sessionId` trả `RUN_NOT_FOUND` (`gateway.ts:243,254`). "Người giữ khóa là chủ runtime" chỉ áp dụng cho việc ghép nối. Run mồ côi được đóng ở lần tạo run kế tiếp sau khi phiên hết hạn (tối đa 1 giờ).

## 4. Đính chính trong buổi smoke

Ba kết luận tạm thời của tôi trong buổi làm việc cần sửa:
1. Lần archive đầu tiên trả `RUN_NOT_FOUND`, tôi nói "run có thể đã mất". Nguyên nhân thật là run thuộc phiên khác (mục 3.7); kết luận "đã mất" **không có cơ sở**.
2. Tôi từng nghi gateway không xử lý ngắt kết nối SSE. Code cho thấy có xử lý (mục 3.4); F4 là **chưa rõ nguyên nhân**.
3. Tôi từng ghi "gõ ngoài ô nhập kích hoạt phím tắt" như một phát hiện. `keys.ts` đã bỏ qua phím khi đang ở `INPUT/SELECT/TEXTAREA`; tôi gõ khi ô nhập chưa được focus. Đó là lỗi thao tác tự động của tôi, **không phải lỗi giao diện**, đã bỏ khỏi danh sách.

## 5. Việc còn mở (không thuộc spec này)

- Kiểm tay Chrome/Firefox/Safari cho luồng trang HTTPS → runtime local (R2a `not_run`).
- `acceptance.json` cho các record hiện hành: chỉ người duyệt viết.
- Đối chiếu giá Cloud Run với bảng giá chính thức và đặt Budget alert (không tự tạo).
