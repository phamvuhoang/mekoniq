# Readiness kỹ thuật cho pitch và demo — 16/11/2026

**Hiện trạng sau N1, 16/11:** đọc [09 — readiness mới](09-post-n1-engineering-readiness.md) và [kết quả actual](../../implementation/web-lab-to-physical/post-n1-final-recording/status.md). Source `0d46403` / Lab `7c97b20`; capture mới invalid và bốn assertions mock chưa giải quyết, guided replay bốn phút khác live 1×, D0/native/phần cứng còn mở. Các số liệu và ghi chú trước đó bên dưới là snapshot theo ngày/tuple lịch sử.

**Chỉ dùng tuyên bố có phạm vi dưới đây.** Bằng chứng mới được ghi local trên Source `981e234` / Lab `d4c3032`, runtime `8eb111…`, production build `2c1e9f30…`. Commit công bố tài liệu là identity khác. [Kết quả và giới hạn cuối](../../implementation/web-lab-to-physical/final-recording-status.md), [cách tái hiện](../../implementation/web-lab-to-physical/reproduce-final-recording.md), [full report](../../implementation/web-lab-to-physical/retention/sdd/README/task-final-recording-report.md) và [các disposition còn mở](../../implementation/web-lab-to-physical/final-deferred-dispositions.md) là nguồn hiện trạng. Các bảng nghiên cứu/claim cũ được giữ như snapshot của ngày/tuple đã ghi, không phải trạng thái triển khai mới.

## Những gì có thể nói từ bản ghi local

- Production UI/browser cùng build đã kiểm 1 case shared-cell và 5 case strict replay/story: tick 0, chọn tốc độ mục tiêu 1×, pause/resume, new trial, export/import H7, VI/JA/EN ở 390/1024/1440 px, keyboard/reduced-motion/2D/axe và từ chối mạng/asset sai tại scope được ghi. Đây là browser tự động Chromium 157; không phải mọi thiết bị/trình duyệt hoặc tablet vật lý đã qualified.
- Source 981 có chiến dịch payload 19 case và shared-cell 8 case qua public readback. Ba nominal cell phục vụ 2 cốc ở 217 giây mô phỏng; các fault giữ đúng needs_attention/cancelled/custody-known hoặc unknown. Đây là MuJoCo thật trên Mac với tham số giả định/not_calibrated, không phải robot thật, chất lỏng nóng hay toàn bộ miền tham số đã thử.
- Complete mock có 18 lệnh trả mã 0 và 20 raw result; từng skip vẫn not_run. IR-SIM và Webots có bản ghi theo tuple mới và outcome cụ thể trong bảng cuối; không cộng các suite trùng nhau thành một con số chất lượng.
- Sáu profile R3 đã ghi và đọc lại ở scope prepared. G-PREP không chứng minh host đã cài, native motion/contact, security, calibration hay con người nghiệm thu. Cả xArm/ROS2 và custom/PUMA/LinuxCNC vẫn là hai đường chuẩn bị mở.

## Những gì chưa được quảng bá

Lượt production 185 giây đạt **0.47188883×** khi chọn mục tiêu 1×, served 1; chưa đo một mission live hai cốc hoàn tất ở subject UI này. Nhịp vẽ thật p95 **300.2 ms** không đạt 33 ms. Worker IPC p95 **4.837 ms** đạt 15 ms nhưng không phải nhịp commit Source. Pause tới receipt cuối khoảng **2797.283 ms** không đạt 500 ms; click→UI khoảng **3322.858 ms** là số khác. RAF 16.7 ms và render CPU 0.5 ms không chứng minh world được vẽ/cập nhật mỗi 16.7 ms. Public reader còn từ chối **CAPTURE_ACTIVE_DRAWING_DURATION**; không gọi capture này hợp lệ hoặc realtime/mượt/1×.

ZIP đo dài chỉ tới H4515/prefixCovered:true/streamFinalized:false, khác view paused H4520. Ảnh đang chạy chủ yếu nhìn thấy arm/cup; không chứng minh cả scene trong camera hoặc cup đang được nắm. Custody cần đúng mẫu Source. Live-report replay tại 390 px có DOM header count 1 và ảnh ràng buộc, với WORLD_NOT_RECORDED_IN_REPORT khi report thiếu world poses. Không lấp dữ liệu bằng pose live.

Lượt public dev launcher trên checkout isolated đã đạt startup, health 200 và export H7 nhưng thất bại khi mở trang offline thứ hai. Sau diagnostic riêng, lượt full stock trên cặp active sạch đã pass 1 case browser với assertions giữ nguyên và cleanup mã 0. Đây là hai layout dependency khác nhau; giữ nguyên lỗi/setup/diagnostic cũ. Cả hai không thay kết quả hiệu năng production. Current Docker/image/WEB05 và owned cloud-service baseline còn thiếu; genuine partial R2a và full R2b đều đã ghi các thiếu hụt bằng kết quả nonzero. Full R2b có CELL/X tested, các case MJ/web/regression tương ứng failed và WEB05/06 not_run; không ghép kết quả bổ sung vào candidate. HTTPS/host mới, fresh Linux/native/physical và human acceptance chưa đóng. Website/Cloud Run R2a lịch sử vẫn giữ tuple 4f893ac cũ, không phải deployment R2b mới.

## Dùng demo và pitch

CTA **“Xem mô phỏng 4 phút”** là hành trình dẫn qua các mốc replay đã kiểm. Khi chỉ dùng bản ghi, nhãn phải là **“Xem bản ghi mô phỏng”**. Thời lượng guided replay không phải wall time chạy live toàn mission, không có lời hứa live 1× hoặc hai cốc hoàn tất trong 4 phút. Buổi live phải có thời lượng và giới hạn riêng; khi không đủ môi trường, dùng replay đã được xác minh và nói rõ.

Giữ thông điệp về trạng thái nghiệp vụ, người cần xử lý và bằng chứng xem lại. Không đổi nó thành lời hứa tiết kiệm nhân sự, lợi ích vật lý, độ chính xác thực tế hoặc quyền chạy hardware chưa đo. Dossier/prepared code không cấp quyền commissioning. Parameters chưa calibrated; customer value vẫn cần discovery và baseline tại hiện trường.

## D0 và kế hoạch thương mại

D0 vẫn chưa mở. Cần chủ sở hữu quyết định claim đúng asset, đánh giá các yêu cầu web chưa đạt, hỗ trợ/hosting đúng release, dữ liệu/consent/analytics và các checklist ở [06](06-measurement-and-launch.md). Không suy từ local replay hoặc review code rằng đã được publish, deploy, gửi outreach, chạy tracking, chi tiền hay ký pilot.

Giữ nguyên giả thuyết Việt Nam trước/TP. HCM có điều kiện, Nhật qua đối tác, ngân sách 60 triệu tiền mặt + 78 triệu thời gian và funnel 120 → 60 → 36 → 18 → 12 → 6 → 3. Đây vẫn là giả thuyết năng lực/thương mại, không phải actual CAC, conversion, retention hay doanh thu. Demo mới không xác thực thị trường hoặc founder permissions. Không có outreach, marketing publication, paid resource hoặc physical pilot nào chạy trong đợt ghi bằng chứng này.
