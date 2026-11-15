# 03 — GTM, gói thương mại và lộ trình kiểm chứng

Đây là đề xuất triển khai sau D0, chưa có cam kết từ khách/đối tác. Tất cả mức giá, nhân lực, chuyển đổi và tỷ suất dưới đây là **giả thuyết lập kế hoạch**, cần founder duyệt trước đưa vào chào hàng. Không kế thừa BOM hay mức thuê trong slide cũ.

## 1. Chọn phân khúc và người mua

| Ưu tiên | Phân khúc | Trigger / JTBD giả thuyết | Buyer / người dùng / người chặn | Cách tiếp cận |
|---|---|---|---|---|
| 1 | Chuỗi nhỏ 2–10 nhà hàng phục vụ tại bàn; buffet/lẩu/nướng | Nhiều lượt bếp–bàn, thiếu rõ ràng khi bàn chưa nhận; muốn thử một điểm | Chủ/COO trả tiền; quản lý ca champion; bếp/phục vụ dùng; IT/POS và chủ mặt bằng có thể chặn | Founder giới thiệu có ngữ cảnh + demo và site screen |
| 2 | Nhà hàng đơn lẻ quy mô vận hành phù hợp, đã có robot hoặc dự toán mua | Cần nối trạng thái robot với công việc; tránh đầu tư không hợp site | Chủ quyết định nhanh; quản lý ca và integrator chịu vận hành | Đối tác robot/POS giới thiệu, kiểm API trước proposal |
| 3 | Integrator/OEM/distributor có nhà hàng cụ thể | Cần làm rõ workflow và giảm vòng trao đổi yêu cầu | Trưởng giải pháp/kinh doanh; kỹ sư và support đánh giá | Buổi technical discovery, một model và một site |
| 4 | Chuỗi lớn/khách sạn nhiều hệ thống | Chuẩn hóa và tích hợp phức tạp | HQ procurement, IT, security, operations | Nuôi quan hệ; không chiếm năng lực 90 ngày đầu |
| Chưa ưu tiên | Quán nhỏ chỉ cần thu ngân, quầy mang đi, site nhiều tầng/điều kiện chưa rõ | Nhu cầu khác hoặc chi phí triển khai có thể vượt giá trị | Chủ quán | Nội dung tự phục vụ; tư vấn lựa chọn hiện có nếu phù hợp |

Proto-persona 1: **chủ/COO** cần quyết định đầu tư có cơ sở, sợ tốn thời gian triển khai và bỏ robot sau vài tuần. Persona 2: **quản lý ca** cần biết việc nào còn chờ, ai xử lý, có đường thủ công khi xảy ra lỗi. Persona 3: **trưởng tích hợp** cần phạm vi API, version, support ownership và bằng chứng lặp lại. Đây là mô tả giả thuyết, chưa phải chân dung rút ra từ phỏng vấn.

## 2. Discovery và design-partner offer

**Lời mời:** “Cùng đánh giá một luồng phục vụ trong hai tuần làm việc, để quyết định có đáng và có thể tiến tới pilot hay không.” Thời lượng là kế hoạch công việc sau khi có người và dữ liệu, không hứa hoàn tất phần cứng trong hai tuần.

Đầu vào: 1 buổi 30–45 phút với buyer + quản lý ca; quy trình hiện tại; sơ đồ mặt bằng giản lược; danh sách POS/robot/network; 3–5 ca baseline nếu khách có thể ghi; quyền dùng dữ liệu nội bộ theo thỏa thuận. Không lấy dữ liệu khách ăn uống để làm audience marketing.

Đầu ra có thể thu phí: sơ đồ workflow và 3 ngoại lệ ưu tiên; bản mô phỏng tương ứng nếu scope hiện có hỗ trợ; báo cáo fit/gap; ma trận thiết bị/connector; giả thuyết giá trị; kế hoạch đo và estimate công việc pilot. Báo cáo “không phù hợp” vẫn là đầu ra hợp lệ. Không nhận tùy biến engine/robot miễn phí trong discovery.

**Scope gói khám phá đề xuất 8 triệu VND/site**: tối đa 2 buổi từ xa, 1 buổi khảo sát địa phương tối đa nửa ngày, 1 báo cáo + 1 vòng sửa. Đi lại ngoài cụm, hardware, lập trình connector, native qualification và pilot tách riêng. Có thể thử 5/8/12 triệu cho scope tương đương ở các phỏng vấn giá tuần tự; không công bố một giá khác nhau cho cùng khách mà không giải thích scope/điều kiện. Giá chưa VAT và chưa là bảng giá thương mại được duyệt.

Design partner đổi lại: cử champion, cung cấp baseline đúng thực tế, tham gia review, cho phép thảo luận kết quả nội bộ. Case study, logo, trích dẫn và hình ảnh cần đồng ý riêng; mua dịch vụ không đồng nghĩa cho phép dùng tên. Không yêu cầu độc quyền. Giới hạn tối đa 3 engagement discovery đồng thời theo năng lực chuẩn; tối đa 1 physical pilot đang hoạt động cho đến khi chứng minh support.

### Kịch bản phỏng vấn 35 phút

1. 0–5 phút: vai trò, mô hình, ai quyết ngân sách, chọn một ca gần nhất.
2. 5–15 phút: “Món rời bếp thế nào? Lần gần nhất phải tìm món/nhầm bàn/chờ robot ra sao? Ai xử lý, mất bao lâu, có ghi gì?” Hỏi ví dụ trước khi demo.
3. 15–20 phút: giải pháp đang dùng, chi phí hiện tại, điều đã thử, lý do giữ/đổi, hợp đồng tích hợp.
4. 20–25 phút: demo ngắn đúng pain; yêu cầu khách kể lại điều họ hiểu và điều không giống quán.
5. 25–30 phút: đề xuất bước đánh giá có scope; “Ai cần tham gia? Điều kiện nào khiến anh/chị không tiếp tục?”
6. 30–35 phút: thử giá có nhãn đề xuất, ngân sách và cách phê duyệt; xin bước tiếp theo cụ thể. Không ghi “sẵn sàng trả” chỉ từ lời khen.

Ghi từng quote với phép sử dụng, ngày, vai trò, ngành; phân biệt quan sát/khách tự báo/suy luận. Sau 10 interview, tổng hợp số người có cùng pain, mức độ, giải pháp thay thế và bằng chứng willingness-to-pay (đồng ý scope/budget, không chỉ bấm CTA).

## 3. Qualification

Chấm 0–2 mỗi yếu tố: **pain cụ thể, buyer/champion, site phù hợp sơ bộ, khả năng thiết bị/API, mức hợp tác đo baseline, thời gian/ngân sách**. Tổng 12 điểm; ≥8 là ưu tiên follow-up. Điểm là triage nội bộ, không chứng minh technical readiness.

Điều kiện bắt buộc trước assessment trả phí: xác định người ký và phạm vi; có champion; có vấn đề có thể đo; không có yêu cầu bất khả thi đã biết. Trước physical pilot bắt buộc mọi gate kỹ thuật/site ở mục 5 đạt, bất kể điểm. Lead yêu cầu “mua robot ngay, tự vận hành không giám sát” được chuyển thành tư vấn điều kiện trước; không chốt bằng cách lờ gate.

## 4. Packaging và giá thử

| Gói đề xuất | Khi nào chào | Giá giả thuyết | Không bao gồm / cách kiểm giá |
|---|---|---|---|
| Lab guided demo | Web/replay đã đạt | Miễn phí, 20–30 phút có discovery | Không có thiết bị hoặc cam kết triển khai; đo hiểu đúng + next step |
| Workflow assessment | Scope và buyer rõ | 8 triệu VND/site một lần; thử dải 5–12 triệu | Không phải deposit mua robot; trả tiền cho report đã mô tả |
| Deployment/integration | Qua fit và có estimate công | Ví dụ 30 triệu/site cho scope xác định, không phải flat fee mọi site | Thay bằng báo giá theo giờ/ngày, connector và UAT; vượt scope có change order |
| Platform Serve subscription | Chỉ sau readiness và hợp đồng vận hành | Ví dụ 2 triệu VND/site/tháng, thử dải 1–3 triệu | Chưa gồm robot/lease, fee payment/invoice, support onsite, custom connector, VAT; entitlement chốt theo cấu hình |
| Hardware + maintenance | Có OEM/model, warranty, service agreement | Báo giá riêng theo vendor và SLA được chấp thuận | Không dùng BOM prototype. Khuyến nghị đối tác trực tiếp cung cấp phần cứng trong giai đoạn học |
| Expansion modules | Khách có nhu cầu và module accepted cho phạm vi | Estimate riêng, chưa ấn giá | Inventory/CRM/chain không tự bật chỉ vì có code |

Tại Nhật chưa chào giá JPY bằng đổi tỷ giá VND: cần tính local support, thuế, hợp đồng, reseller margin và willingness-to-pay riêng. Bộ JA hiện dùng CTA tư vấn và báo giá theo scope. Không định giá thấp hơn AirREGI/KiotViet để thắng; gói Serve giả thuyết cao hơn POS cơ bản cần chứng minh giá trị bổ sung.

### Kinh tế đơn vị — ví dụ tính được, không phải số thực

Đơn vị triệu VND, trước thuế. Không cộng revenue phần cứng vào SaaS ARR.

| Dòng | Revenue | Direct cost giả thuyết | Gross profit | Gross margin |
|---|---:|---:|---:|---:|
| Assessment một lần | 8,0 | 5,0 = 10h × 0,4 + đi lại/report 1,0 | 3,0 | 37,5% |
| Integration một lần | 30,0 | 21,0 = 45h × 0,4 + chi phí trực tiếp 3,0 | 9,0 | 30,0% |
| SaaS một tháng/site | 2,0 | 0,6 = cloud 0,2 + support 0,4 | 1,4 | 70,0% |
| Hardware bán lại minh họa, chỉ nếu sau này chọn mô hình này | 120,0 | 108,0 = landed 95 + install 5 + warranty reserve 8 | 12,0 | 10,0% |
| Maintenance một tháng/site, giả sử có gói riêng | 1,5 | 1,2 gồm support/spare reserve | 0,3 | 20,0% |

Chi phí delivery của assessment/integration là COGS dịch vụ, không nằm trong trần ngân sách GTM. Ví dụ 3 assessment giá8 triệu tạo revenue24 triệu, direct cost15 triệu, GP9 triệu nếu đúng scope; cần lịch thu tiền đủ tài trợ delivery. Không mặc định các khoản này bù đủ chi phí GTM.

Giá hardware 120 triệu là **con số mô hình tài chính tùy ý để thấy margin**, không phải báo giá OEM hay MEKONIQ; không đưa vào sales sheet. Install hardware 5 triệu phải là công việc khác integration phần mềm; nếu cùng giờ thì chỉ phân bổ một lần. Support SaaS 0,4 triệu là phần ứng dụng; maintenance 1,2 triệu là phần thiết bị, không được tính trùng. Founder cần thay từng cost bằng quote/time log trước proposal.

**CAC fully loaded** = (tiền sales/marketing thực chi cho cohort + thời gian sales/presales phân bổ + commission) / số venue mới trả phí thuê bao trong cohort, cùng cửa sổ thời gian và có lag conversion. Nếu chưa có venue thuê bao, CAC SaaS **chưa xác định**; không chia cho demo, discovery fee hay MQL. Cost per paid assessment là metric riêng. Không tính công R&D sản phẩm vào CAC; công triển khai đã thu phí vào COGS, công presales chưa thu phí vào S&M theo timesheet.

**Payback SaaS** = CAC / (MRR/site − direct cloud/support cost/site/tháng). Giả sử CAC 12 triệu và GP 1,4 triệu/tháng: 8,57 tháng. Giá 1 triệu giữ cost 0,6 → GP 0,4 → 30 tháng. Giá 3 triệu giữ cost 0,6 → GP 2,4 → 5 tháng. Nếu support tăng 0,4 lên 1,0 triệu, giá 2 triệu với cloud 0,2 → GP 0,8 → 15 tháng. Nếu CAC 24 triệu và GP 1,4 → 17,14 tháng. Đây là sensitivity để xác định điều phải đo, không phải forecast.

Không có churn cohort nên không tính lifetime value thực. Có thể dùng GP 12 tháng có điều kiện = 12 × 1,4 = 16,8 triệu **nếu site duy trì và cost đúng giả định**; đây là gross profit horizon, không gọi LTV. Assessment/integration có thể tạo GP một lần nhưng không che payback SaaS xấu. Dòng tiền phải ghi lịch thu/chi, deposit hardware và warranty reserve riêng. Mô hình cho thuê robot chỉ mở khi đã có dữ liệu capital cost, tỷ lệ hỏng, downtime, residual value và financing thực; không tự tài trợ fleet bằng ngân sách marketing.

### Validation giá

Tuần 1–4: 4 interview nhà hàng theo lịch, ưu tiên ít nhất 2 có buyer/quy trình ngân sách; trình một scope rõ và hỏi đánh đổi giá/thời gian/tự làm. Tuần 5–8: thêm 4 cuộc gặp, đạt mục tiêu lũy kế 4 assessment scoped, ghi accepted/declined/no decision và lý do. Tuần 9–12: thêm 4 cuộc gặp, đạt mục tiêu lũy kế 6 assessment scoped; so estimate với time log của engagement thực, phỏng vấn lý do trả/không trả. Trong toàn bộ 12 cuộc gặp, ít nhất 10 cần discovery note đầy đủ. Không xem 2/6 thắng là “giá tối ưu”; dùng để thiết kế vòng tiếp theo.

## 5. Cổng từ web tới máy thật

| Gate | Điều kiện ra | Owner ký / đầu ra | Khi chưa đạt |
|---|---|---|---|
| G0 Web/replay | Nhãn mode, release pin, happy/fault report, fallback, CTA đúng, không claim hardware | Engineering + GTM / checklist launch | Chỉ discovery hoặc xem nội bộ |
| G1 Qualified discovery | Pain, buyer, scope, dữ liệu và khả năng trả được xác định | Founder sales / account note | Nuôi lead theo phép; không dự đoán deal |
| G2 Site assessment | Mặt bằng, mạng, nhân sự, tải, tuyến, điểm dừng, POS/API và constraints được khảo sát | Solutions + operator / fit-gap | Không nhận tiền cho pilot chưa thể thực hiện; có thể bán assessment rõ scope |
| G3 Native/device readiness | Linux/native từng nhánh, adapter/model/firmware, calibration, e-stop/safety và thiết bị đúng scope có evidence | Engineering + integrator + người chịu trách nhiệm hiện trường | `not_run`/`blocked_external`; Lab pass không đóng gate |
| G4 Supervised pilot | Phạm vi, runbook, người dừng, fallback, bảo trì, hợp đồng và tiêu chí đo đã thống nhất | Operator + founder + technical owner | Chưa đưa vào ca thật |
| G5 Commercial rollout | Review pilot, chi phí support, dữ liệu không mất/trùng và kết quả so baseline; buyer ký | Buyer + founder / acceptance record | Sửa scope hoặc dừng; không ép rollout vì mốc marketing |

Pilot đề xuất: một site, một tuyến, tải nguội phù hợp, ca giới hạn, người giám sát, không tự động mở rộng load/motion. Arm/coffee cell là scope riêng; nhánh xArm và nhánh custom/PUMA/LinuxCNC không kế thừa acceptance của nhau. Thỏa thuận thời lượng 2–4 tuần chỉ sau G3/G4 và phụ thuộc lịch vận hành. Đo baseline 3–5 ca tương đồng; so median/P90 thời gian, tổng nhiệm vụ, intervention theo nguyên nhân, downtime, số giờ hỗ trợ, lỗi nghiệp vụ. Cỡ mẫu nhỏ chỉ cho kết luận mô tả theo scope; không suy ROI phổ quát. Ngưỡng pass do hai bên xác định trước sau baseline; mọi sự cố an toàn nghiêm trọng hoặc chưa rõ quyền điều khiển yêu cầu dừng pilot và điều tra.

## 6. Pipeline và trách nhiệm

| Stage | Exit criterion | Action/timebox |
|---|---|---|
| Researched | Có account và lý do fit, nguồn tiếp cận hợp lệ | 120 account trong 90 ngày, không scrape danh sách cá nhân |
| Engaged | Người phù hợp phản hồi hoặc xem demo được định danh có phép | Ghi source, không suy từ cookie ẩn danh |
| Meaningful demo | Hoàn thành hành trình theo [06](06-measurement-and-launch.md) | Hỏi một vấn đề ca thực, gửi đúng tài liệu họ yêu cầu |
| Qualified | Đạt triage và xác định buyer/champion | Meeting offer, SLA phản hồi nội bộ 1 ngày làm việc |
| Meeting held | Có note pain/buyer/next step thực | Follow-up 2 ngày làm việc; không tính no-show |
| Assessment scoped | Scope, fee, đầu vào và lịch có owner | Proposal tối đa 1 trang + phụ lục chi phí |
| Assessment paid | Hợp đồng/PO và điều kiện thanh toán được xác nhận, tiền nhận theo chính sách | Ghi revenue dịch vụ, không ghi ARR |
| Pilot ready/running | G3/G4 đạt; lịch thực | Pipeline riêng; bắt đầu khi onsite owner ký |
| Subscription active | Acceptance đúng scope và hợp đồng thuê bao hoạt động | Customer cohort, MRR, retention bắt đầu từ đây |
| Closed/no decision | Lý do, ngày, có/không được liên hệ lại | Không auto nurture khi chưa đồng ý |

RACI (R làm, A chịu trách nhiệm cuối): Founder A/R thị trường, ngân sách, qualification, giá/hợp đồng; GTM/content R nội dung, lịch, UTM, CRM và báo cáo, founder A claim thương mại; engineering lead R/A evidence và readiness; solutions/integrator R khảo sát, thiết bị, estimate, support theo hợp đồng; restaurant operator R quy trình/baseline/on-site, buyer A acceptance nghiệp vụ. Một người có thể giữ nhiều vai trò; không giả định đã có đội tuyển đủ. Các gate kỹ thuật không bị sales ghi đè.

## 7. Đối tác

Thứ tự khám phá: integrator có khách trong địa bàn → đại lý robot có service/API → POS consultant/vendor phù hợp → partner Nhật có hỗ trợ tại chỗ. Tên nguồn [01](01-research-and-evidence.md) là landscape, không phải đối tác đã liên hệ.

Partner checklist: một khách thật được phép giới thiệu; model/firmware và quyền API; hardware warranty; thời gian/spare support; người xử lý L1/L2/L3; điều khoản dữ liệu; trách nhiệm thay đổi cấu hình; quyền dùng logo. Workshop kỹ thuật dùng model và capability matrix có chứng cứ.

**Điều khoản để đàm phán, chưa được chấp thuận:** referral 10% doanh thu SaaS thực thu 12 tháng đầu, không gồm VAT/hardware/hoàn tiền; trả sau khi khách thanh toán, gắn account đăng ký và điều khoản hoàn lại khi hủy. Reseller margin ví dụ 20% chỉ khi partner có nghĩa vụ L1/support/training rõ; không cộng cả referral và reseller cùng deal. Phí integration do bên thực hiện giữ theo SOW; thiết bị ưu tiên partner bán trực tiếp. Không độc quyền, không quota mua robot, không hứa SLA trước khi định cost. 3 đối tác interview đầu dùng để kiểm sự hấp dẫn, chưa ký partner program hàng loạt.

## 8. Roadmap thương mại

| Giai đoạn | Công việc và đầu ra | Quyết định |
|---|---|---|
| Trước D0 | Demo/replay evidence, claim review, landing copy, CRM mẫu, 30 account đầu, consent/contact process | Web/replay đã đủ cổng chưa? |
| Ngày 0–30 | 40 account researched; 4 interview nhà hàng, 1 partner interview; content tuần 1–4; 2 scoped assessment candidates | Người mua có nhận đúng vấn đề không; chốt/đổi ICP và offer |
| Ngày 31–60 | Thêm 40 account; thêm 4 interview + 1 partner; cumulative 4 assessments scoped; thử giá; paid search có điều kiện | Buyer có bỏ thời gian/dữ liệu/ngân sách không; chặn custom work vô hạn |
| Ngày 61–90 | Thêm 40 account; thêm 4 meeting + 1 partner; cumulative 6 assessments scoped, mục tiêu 3 paid; 0–1 physical pilot nếu đủ gate | Giữ/đổi scope, giá và năng lực support dựa evidence |
| Tháng 4–6 | Hoàn thành/đánh giá pilot đầu, subscription theo acceptance; một case study nếu được phép | Cần chứng minh repeatability và cost thực trước thêm địa bàn |
| Tháng 7–12 | Lặp cùng use case qua một partner; mở module/địa bàn hoặc nhánh Nhật khi đủ đội và nhu cầu | Mở rộng có điều kiện; không dự báo số site từ TAM |

Đổi hướng khi: sau 10 interview không thấy pain lặp lại có ví dụ cụ thể → sửa segmentation/problem; có pain nhưng 6 scoped proposal không có willingness-to-pay → tách giá, deliverable và trust barriers; nhiều view ít buyer → sửa phân phối/CTA; assessment vượt cost 2 lần liên tiếp → thu hẹp scope, tính phí lại; API/hardware không khả thi → tìm model/partner khác hoặc tiếp tục workflow không robot. Đây là quy tắc giới hạn thử nghiệm, không kết luận kênh chết hay thị trường không tồn tại từ mẫu nhỏ.
