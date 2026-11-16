# MEKONIQ — Kế hoạch pitch, digital marketing và GTM sau web simulation

**Hiện trạng kỹ thuật16/11:** đọc[08—readiness theo bằng chứng cuối](08-final-engineering-readiness.md) trước khi dùng pitch/claim. Source981/Labd4 đã được đo lại; drawing/pause/public capture validity chưa đạt. Guided replay4phút không phải full live1×; D0, host/native/hardware và quyền publish/spend vẫn riêng. Các snapshot cũ bên dưới giữ ngày/tuple lịch sử.


Ngày lập: **14/11/2026**. Bản nội bộ để founder duyệt và giao việc; chưa phải chiến dịch đã chạy, báo giá, dự báo doanh thu hay tuyên bố ra mắt. Nghiên cứu công khai được kiểm ngày 14/11; bằng chứng kỹ thuật khóa theo snapshot được dẫn trong [01](01-research-and-evidence.md). Không có phỏng vấn khách hàng nào được thực hiện trong công việc lập kế hoạch này.

**Cập nhật bằng chứng 14/11, 08:59 ICT:** R2a arm `MJ-BV01` đã có [CL01 Cloud Run amd64 qua HTTP](../../implementation/evidence/cloud-run/mekoniq-2026-11-14/README.md) hoàn tất tick 4800 và [Chrome UI HTTPS production](../../implementation/evidence/production/r2a-2026-11-14/README.md) hoàn tất tick 4810, cùng phục vụ 2 trong mô phỏng. Runtime pin vẫn `4f893ac…`; `accepted:false`, `not_calibrated`. [Guide R2a offline](../../../artifacts/mekoniq-r2a-demo-guide.html) là walkthrough tài liệu. Những bằng chứng này không tự hoàn tất web payload B04, R2b shared-world, R3/hardware hay checklist D0 của chiến dịch; chi tiết snapshot và thời gian ở [01](01-research-and-evidence.md).

**Snapshot phát triển lịch sử trước lượt ghi cuối:** [R2b trên worktree riêng](../../implementation/web-lab-to-physical/design/00-implementation-status.md) đã qua review B09, import B00R2, code chuẩn bị L00–L05 và tooling B10/L06, với Source `6e5eee9` / Lab `283696b`; hồ sơ cả hai nhánh và bộ đọc qualification theo profile đã review. Ba lỗi tương thích dữ liệu L06 đã đóng qua review lại. Bốn lỗi bằng chứng B10 đã đóng qua review lại; chưa có lượt đo web/container/native mới. Dossier chỉ đánh giá đủ tham chiếu, không cấp quyền chạy thật. Qualification native xArm/PUMA vẫn incomplete/not_run, tách với review code chuẩn bị. Probe L01 giữ 16 ca native `not_run`. Handoff mới vẫn `nativeReady:false`; chưa có host được giao hoặc lượt chạy cloud/native mới. Runtime persistence/quyền ghi đã có kiểm local và Mac worker, nhưng image mới chưa build, WEB05 còn `not_run` do Docker không đáp ứng. B08 có một lượt thật trên mỗi engine IR-SIM/Webots/MuJoCo và study có phạm vi; chưa phải benchmark thống kê hay bằng chứng phần cứng. UI/replay đã có kiểm browser thật. Lượt đo production 185 giây trước vòng sửa UI, tại `e07685d` / `89b4a38`, đã xuất ZIP H4760 hoàn chỉnh; tốc độ quan sát theo receipt Source khoảng 0,498× và nhịp vẽ p95 khoảng 300 ms chưa đạt mục tiêu. Không quảng bá live realtime/1× hoặc coi đây là D0. Demo 4 phút là hành trình dẫn có thể chọn các mốc replay đã duyệt; buổi chạy live đầy đủ phải có thời lượng riêng. Bằng chứng vẫn nội bộ, `accepted:false`, `not_calibrated`; hardware chưa chốt. UI mới chưa được đo lại lượt hiệu năng dài; Giai đoạn ghi bằng chứng cuối bắt đầu sau review tooling B10/L06; D0 vẫn mở cho đến khi kết quả thực tế được đánh giá.


## Quyết định đề xuất

**Bắt đầu ở Việt Nam, trong một cụm địa lý mà đội có thể đến hỗ trợ trong ngày.** Tạm lấy TP.HCM làm địa bàn lập danh sách nếu founder thực sự có năng lực hỗ trợ tại đó; nếu không, chọn nơi đội đang hoạt động. Đối tượng đầu tiên: chủ chuỗi nhỏ hoặc quản lý vận hành **2–10 nhà hàng phục vụ tại bàn**, ưu tiên buffet/lẩu/nướng có nhiều lượt vận chuyển giữa bếp và bàn, một điểm sẵn sàng làm nơi thử có kiểm soát, và người phụ trách ca chịu tham gia đo baseline. Các ngưỡng là giả thuyết chọn mẫu, không phải dữ liệu thị trường.

Bán bước tiếp theo là **đánh giá luồng phục vụ và điều kiện pilot**, sử dụng mô phỏng để khách hiểu và chất vấn cách hệ thống xử lý. Chưa bán lời hứa tiết kiệm nhân sự, robot tự chế giá thấp hay một lần thay toàn bộ POS. Bản phát hành web là công cụ chứng minh hành vi trong mô hình; giá trị kinh doanh phải đo tại hiện trường sau các cổng kỹ thuật.

Nhật là nhánh khám phá qua đối tác tích hợp, với tài liệu Nhật và một phần trong 3 cuộc gặp đối tác của kế hoạch; 3 cuộc này được tính riêng ngoài 12 cuộc gặp nhà hàng. Chỉ chuyển Nhật thành thị trường đầu tiên nếu có đối tác chịu trách nhiệm hỗ trợ tại chỗ, người mua cụ thể, đường tích hợp khả thi và kinh phí riêng. Chưa có bằng chứng founder có những điều kiện này. So sánh chi tiết ở [01](01-research-and-evidence.md).

## Định vị và tên gọi

**Cho** chủ chuỗi nhỏ và quản lý vận hành nhà hàng phục vụ tại bàn **cần** hiểu và kiểm soát việc chuyển món từ bếp đến bàn, **MEKONIQ Restaurant Platform** là nền tảng vận hành nhà hàng và điều phối robot, giúp nhóm xác định trạng thái công việc, người cần xử lý và bằng chứng để xem lại khi có gián đoạn. Giả thuyết khác biệt cần kiểm chứng: khách coi việc nối nghiệp vụ, xử lý ngoại lệ và xem lại kết quả là đáng trả tiền hơn việc bổ sung một màn gọi robot riêng lẻ. Các đối thủ có thể có chức năng tương tự; chưa xác minh lợi thế độc quyền.

| Tên | Vai trò với khách | Cách dùng |
|---|---|---|
| MEKONIQ Restaurant Platform | Sản phẩm dài hạn | Nền tảng nhà hàng, mở module theo readiness và nhu cầu |
| MEKONIQ Serve | Use case mở đầu | Giao món/thu dọn và phối hợp nhân viên–robot; chưa chốt chassis thương mại |
| MEKONIQ Robot Lab | Demo và môi trường kiểm thử | Xem, chạy, thay đầu vào, xem lại mô phỏng; không điều khiển robot thật |
| xArm/ROS 2; custom/PUMA/LinuxCNC | Hai hướng kỹ thuật cần kiểm chứng | Đưa vào phụ lục kỹ thuật, không biến thành hai gói sản phẩm đã bán |

**Thông điệp chính:** “Từ bếp đến bàn, mỗi bước đều có trạng thái rõ ràng.” CTA chính: “Xem mô phỏng 4 phút.” CTA thương mại: “Đánh giá luồng phục vụ của quán.”

## Các lựa chọn chiến lược

1. Ưu tiên chất lượng cuộc trao đổi với người mua và khả năng triển khai trong một địa bàn. Lượt xem đại chúng đứng sau.
2. Chọn giao món/thu dọn làm vấn đề mở đầu. Cảnh tay máy và cốc có thể làm minh họa R&D; pha chế thật, chất lỏng nóng và nấu ăn không phải offer đầu tiên.
3. Có đường sử dụng robot với POS hiện có về mặt thiết kế; mỗi connector cần khảo sát và nghiệm thu. Không cam kết tích hợp trước khi kiểm quyền API, dữ liệu và chi phí.
4. Giữ lựa chọn module nền tảng rộng cho giai đoạn mở rộng. Không lấy số lượng tính năng làm lợi thế cạnh tranh chưa kiểm chứng.
5. Đối tác robot/POS/integrator là nguồn tiếp cận và năng lực hiện trường, chưa phải quan hệ đã ký.
6. Mở chi tiền theo từng thử nghiệm và cổng sẵn sàng. Không chạy quảng cáo chỉ để khoe mô phỏng đẹp.

## Mục tiêu 90 ngày — giả thuyết để quản lý năng lực

**D0 là ngày demo web đủ cổng trong [06](06-measurement-and-launch.md), không mặc định là 14/11/2026.** Nếu chỉ replay đạt, ra mắt có nhãn “xem bản ghi mô phỏng”; không quảng bá “tự chạy trực tiếp”.

Kịch bản tiêu chuẩn: 120 restaurant account được nghiên cứu; 60 account có người được xác định đã xem demo; 36 account hoàn thành hành trình có ý nghĩa; 18 account đủ phù hợp; **12 nhà hàng/account khác nhau có cuộc gặp đã diễn ra, ít nhất 10 cuộc có nội dung discovery đầy đủ**; 6 assessment được xác định scope; **3 engagement assessment/design có trả phí** là giả thuyết thương mại. Assessment scoped chưa đồng nghĩa đã khảo sát onsite hoặc đã trả phí. Ngoài funnel nhà hàng, kế hoạch có **3 cuộc gặp đối tác**; không cộng chúng vào 12 cuộc gặp nhà hàng. Restaurant account được partner giới thiệu chỉ vào funnel sau khi có phép và được dedup.

Mục tiêu bổ sung cho nội dung: 600 người xem demo/replay duy nhất, 300 người bắt đầu, 180 người hoàn thành có ý nghĩa. Đây là funnel người xem riêng, không cộng hoặc nhân với funnel account. Không quy lượt xem ẩn danh thành account đã đủ phù hợp.

**0–1 pilot vật lý** có thể mở trong 90 ngày, hoàn toàn phụ thuộc hardware/native/site gates; 0 pilot khi chưa đủ bằng chứng không phải thất bại của marketing. Không đặt MRR giả; paid discovery không được tính là thuê bao hoặc pilot vật lý. Nếu không có 3 engagement trả phí, ghi đúng 0–2 và điều tra nguyên nhân.

## Nguồn lực và điều kiện duyệt

Đề xuất trần tiền mặt **60 triệu VND/90 ngày**, gồm 6 triệu dự phòng; chi phí thời gian nội bộ giả định 78 triệu, tổng kinh tế tối đa **138 triệu**. Đây là kế hoạch GTM, không bao gồm R&D sản phẩm, mua robot, vận hành pilot, thuế hay phí pháp lý. Không tự động giải ngân: tháng đầu ưu tiên phỏng vấn và nội dung; paid tối đa 12 triệu chỉ sau cổng. Kịch bản lean 24 triệu, partner 120 triệu trong [04](04-digital-marketing.md) và [budget.csv](budget.csv).

Founder cần chốt trước D0: địa bàn hỗ trợ; người sở hữu sales và chăm sóc lead; thời gian thực có thể dành; trần ngân sách; pháp nhân ký hợp đồng; quan hệ hiện hữu ở VN/JP; phần cứng có thể mượn/mua và nguồn kinh phí; khách trả phí cho discovery hay chỉ pilot; chính sách liên hệ/dữ liệu. Chưa có câu trả lời thì chạy nghiên cứu, hoàn thiện tài liệu và demo nội bộ; không suy thành quyền chi tiền hoặc ký kết.

## Bộ tài liệu bàn giao

| File | Dùng để làm gì |
|---|---|
| [01 — Research/evidence](01-research-and-evidence.md) | VN/JP, đối thủ, nguồn và mức chứng minh |
| [02 — Pitch](02-pitch-and-demo.md) | Bài nói 30 giây/2 phút/5 phút, 12 slide, demo, sales sheet, phản đối |
| [03 — GTM/commercial](03-gtm-and-commercial.md) | ICP, discovery, gói/giá giả thuyết, kinh tế đơn vị, pipeline, đối tác, lộ trình |
| [04 — Digital marketing](04-digital-marketing.md) | Kênh, ngân sách, 12 tuần, thử nghiệm, keyword |
| [05 — Nội dung dùng được](05-ready-to-use-content.md) | Landing page, 10 bài đăng, 3 video, email/outreach VI/JA/EN |
| [06 — Measurement/launch](06-measurement-and-launch.md) | Event, CRM, attribution, claim-proof, checklist launch và rủi ro |
| [07 — Lịch thực thi](07-calendar-and-weekly-checklist.md) | Lịch 4 tuần chi tiết và checklist tuần có thể giao ngay |
| [budget.csv](budget.csv), [funnel.csv](funnel.csv), [economics.csv](economics.csv) | Mô hình số nhất quán, mở trong Sheets/Excel; chưa nhập vào dịch vụ ngoài |
| [08—Readiness kỹ thuật cuối](08-final-engineering-readiness.md) | Claim/demo theo kết quả actual, các gate chưa đạt và D0 |
| [REVIEW.md](REVIEW.md) | Kết quả tự kiểm, giới hạn và danh mục quyết định cần founder chốt |

Kế hoạch vận dụng product-strategy-session và positioning-statement theo chế độ “context + giả thuyết”, chưa gọi là chiến lược đã được khách hàng xác thực. acquisition-channel-advisor chỉ cung cấp công thức prospective: kênh mới chưa có cohort nên không có kết luận scale/kill hay LTV/CAC từ churn tưởng tượng.
