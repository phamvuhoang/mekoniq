# Review resolution — BV01 continuation

Whole-branch review: source `a89a077..831344f`, Lab `3a92e65..19033a6`; 6 Important, 0 Critical, 0 Minor. Một lượt sửa thống nhất: source `fa5ed2871db92e57e5bd3490195486d569ecc5a0`, Lab `81b596b2183677b73371c1d9efd6321da43ca3a5`. Scoped rereview đã duyệt cả sáu finding; không tìm thêm actionable regression trong delta. Các task trước đó đã có review và sửa riêng.

| ID | Vấn đề | Cách đóng và regression |
|---|---|---|
| W01 | Worker/agent bytes không gắn với runtime pin; thiếu actual inventory | Export nhúng nativeTools; kiểm và snapshot closure trước acquire; inventory controller/Gazebo được hash. Worker/agent mutation, dirty source/export và inventory tests. |
| W02 | Cốc đã giao vẫn gắn trên tray và theo AMR về parking | Domain-confirmed durable table projection; clear tray; recovery idempotent. Hai recipe qua production ports, cup pose ở bàn sau AMR về; crash-cut tests. |
| W03 | Native navigation timeline lệch business/arm khi world origin khác 0 | Persist origin/business epoch; replay/CSV chung mapping; giữ raw time. Nonzero-origin/import/cursor-safe regressions. |
| W04 | Autonomous hold không hiện trong UI | Durable state revision; SSE heartbeat refresh và polling; run-level reconcile. Deadline/owner/tunnel loss và idempotent notification tests. |
| W05 | Simulation expiry bị bridge hiểu là wall-clock expiry | Bounded lease-based controller clock mapping, journal expiry đầu tiên trước stage/start. Production Python validator kiểm startup delay, RTF, skew/RTT, expiry/recovery. |
| W06 | Native config của BV01 làm FD campaign đi sai factory | Chọn composition theo required backends. Actual CLI dispatch regression FD01/BV01 cùng config. |

Focused checks được reviewer đối chiếu với assertions/code: 93 source, 41 Lab, 41 contracts, 39 controller Python +6 subtests, 6 profile; thêm subset 7 test provenance/autonomous sau hardening cuối. Đây là protocol-double/pure/UI/controller-double evidence. Full-suite qualification và browser kết quả cuối nằm trong manifest kiểm thử của thư mục này.

Rereview approval là cho implementation delta. Native engine/controller/GUI, clean target offline install, usability, signing và hardware có gate độc lập; không có release acceptance được suy ra từ review này.

## Phát hiện khi qualification toàn bộ

- Lab full suite phát hiện campaign mirror note và expected preset list còn cũ: đồng bộ với source/native-bv01, giữ assertion exact; commit `23aebdf`.
- Browser fault schedule phát hiện panel tự đóng khi đổi dropdown: giữ disclosure state qua render, thêm assertion visibility/open trong journey; commit `0f5b4eb`. Đây là lỗi UI thực, không phải timeout được bỏ qua.
- Source full integration phát hiện scratch repository của exporter thiếu helper import mới: copy helper thật vào fixture, giữ dirty-source/worktree-cleanup checks; commit `f82b205`. Runtime production không đổi so với `fa5ed28`; clean export vẫn được tạo lại theo commit mới.

Các lần fail được lưu riêng (R01-attempt-fa5ed28, R02-attempt-54bfdf4, browser-attempt-23aebdf). Kết quả cuối được chạy lại trên source/pin/Lab commit ghi trong qualification manifest, không lấy lần chạy trước thay thế.

- Browser journey sau sửa disclosure còn thiếu bước `Kiểm tra lại` khi project revision đổi: bổ sung thao tác UI hiện có trong `66445c5`; không bỏ gate readiness và không đổi runtime authority.
- Một lượt qualification tiếp theo gặp host `ENOSPC` cùng Docker restart/`ECONNREFUSED`. Giữ riêng manifest lỗi môi trường; dọn chỉ export/offline superseded do task tạo và chạy lại tuần tự khi services/disk phục hồi.
