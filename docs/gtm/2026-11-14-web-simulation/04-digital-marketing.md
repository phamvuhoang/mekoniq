# 04 — Digital marketing vận hành trong 90 ngày

**Hiện trạng sau N1, 16/11:** đọc [09 — readiness mới](09-post-n1-engineering-readiness.md) và [kết quả actual](../../implementation/web-lab-to-physical/post-n1-final-recording/status.md). Source `0d46403` / Lab `7c97b20`; capture mới invalid và bốn assertions mock chưa giải quyết, guided replay bốn phút khác live 1×, D0/native/phần cứng còn mở. Các số liệu và ghi chú trước đó bên dưới là snapshot theo ngày/tuple lịch sử.


Mục tiêu: đưa đúng buyer đến một trải nghiệm giúp họ hiểu vấn đề và đồng ý bước đánh giá có phạm vi. Kế hoạch dùng **founder-led sales**, nội dung hỗ trợ quyết định và partner introductions. Mọi chương trình dưới đây là bản thiết kế; chưa có quảng cáo, email hay dữ liệu tracking nào được gửi ra ngoài.

## Thứ tự ưu tiên kênh

| Ưu tiên/kênh | Đối tượng và asset | Nhịp đề xuất | Kết quả đo / lý do |
|---|---|---|---|
| 1. Founder-led introductions/outreach có ngữ cảnh | Chủ/COO/quản lý ca của 120 account; clip 45s + demo + phiếu fit | 10 account nghiên cứu/tuần; tiếp cận qua giới thiệu/đầu mối công việc phù hợp sau kiểm quyền liên hệ | Reply có pain, meeting held, scope assessment; học nhanh với ít account |
| 2. Partner co-discovery | Integrator/robot/POS consultant; technical one-pager + scope/API checklist | 3 partner interview/90 ngày; chọn 1 buổi joint workshop nếu có fit | Introductions hợp lệ, API access, support owner; không tính partner logo là doanh thu |
| 3. Founder content + video | LinkedIn founder cho buyer/partner; Facebook/Zalo cộng đồng chuyên môn nếu quy định cho phép; YouTube lưu demo dài | 2 bài + 1 clip/tuần; 1 bài kỹ thuật chọn lọc mỗi 2 tuần | Qualified conversations và assisted accounts; không chỉ likes |
| 4. Search/SEO hữu ích | Người đang cân nhắc robot, POS integration, pilot | 4 trang core + 4 bài giải thích/90 ngày, không viết hàng loạt bằng keyword | Demo meaningful từ intent đúng, inquiries có fit; chưa kỳ vọng SEO trưởng thành sau 4 tuần |
| 5. Webinar nhỏ | 6–12 người vận hành/đối tác mời đúng vai trò, không cần auditorium | 1 buổi tuần 6; 1 buổi tuần 10 nếu buổi đầu tạo học hỏi | Attended ICP, next steps, objections; không tự dựng danh sách email |
| 6. Paid search hẹp | Query ý định mua/đánh giá ở địa bàn có support | Chỉ sau ≥5 cuộc trao đổi buyer xác nhận thông điệp và landing/CRM sẵn sàng | Cost/qualified conversation; cap và feedback, chưa CAC mature |
| Chưa ưu tiên | Mass paid social, influencer giải trí, booth lớn, Product Hunt, paid LinkedIn diện rộng | Không cấp ngân sách baseline | Audience có thể thích robot nhưng không mua vận hành; thử sau khi có vấn đề/phân khúc rõ |

Không dùng chỉ tiêu “phủ mọi mạng xã hội”. Một recording 4 phút tạo clip 45s, bài giải thích, screenshot timeline và email recap; tất cả giữ cùng release/mode. Facebook/Zalo dùng để chia sẻ trong ngữ cảnh cộng đồng được phép hoặc phản hồi inquiry, không tự động thêm thành viên vào CRM/nurture. Nhật: một trang JA, 1 đoạn demo phụ đề và outreach đối tác; không mở paid JP trong baseline.

## Ngân sách 90 ngày — triệu VND

| Khoản | Lean | Tiêu chuẩn (đề xuất) | Partner-intensive |
|---|---:|---:|---:|
| Sản xuất/edit nội dung bên ngoài | 6 | 12 | 24 |
| Tool CRM/form/hosting cho marketing | 3 | 9 | 12 |
| Đi lại discovery/partner trong địa bàn | 6 | 9 | 18 |
| Workshop/webinar nhỏ | 3 | 6 | 12 |
| Review ngôn ngữ/localization | 0 | 6 | 24 |
| Paid search thử có điều kiện | 0 | 12 | 18 |
| Dự phòng chưa phân bổ | 6 | 6 | 12 |
| **Trần cash** | **24** | **60** | **120** |
| Founder: 120/180/240 giờ × 0,3 triệu | 36 | 54 | 72 |
| Presales engineer: 36/60/90 giờ × 0,4 triệu | 14,4 | 24 | 36 |
| **Trần chi phí kinh tế** | **74,4** | **138** | **228** |

Bảng là **khả năng chi**, không phải cost đã xảy ra. Người viết bài/founder dùng giờ founder; editor ngoài dùng cash content; presales engineer dùng giờ presales. Không giả định có thêm nhân viên marketing miễn phí. Nếu thuê full-time phải thêm lương/bảo hiểm/overhead và tính lại mô hình. Dự phòng chỉ vào actual CAC khi đã chi; tiền thực của pilot/thiết bị/R&D và phí pháp lý/thuế nằm ngoài cả ba kịch bản. Partner-intensive dành cho localization và partner enablement nhiều hơn; vẫn chưa đủ để hứa rollout Nhật.

Giải ngân tiêu chuẩn: giai đoạn 0–30 tối đa 18 triệu = content 4 + tools 3 + travel 3 + workshop 2 + localization 6; 31–60 tối đa 18 triệu = content 4 + tools 3 + travel 3 + workshop 2 + paid 6; 61–90 tối đa 18 triệu cùng cấu trúc; 6 triệu reserve giữ riêng. Paid không đủ điều kiện thì giữ chưa chi, không chuyển sang mua reach để tiêu hết ngân sách. Founder 15 giờ/tuần và presales 5 giờ/tuần là giả định cho 12 tuần, cần giảm lịch nếu engineering không có thời gian.

## Hai funnel phải đo riêng

**Funnel account mục tiêu (giả thuyết standard, tổng 90 ngày):** 120 researched → 60 account được định danh có người xem → 36 account meaningful demo → 18 qualified → 12 meeting held → 6 assessment scoped → 3 paid assessment. Tỷ lệ lần lượt 50%; 60%; 50%; 66,67%; 50%; 50%. Mốc meeting held là 12 account khác nhau có cuộc gặp đã diễn ra; follow-up thêm với cùng account được báo hoạt động riêng, không tăng count funnel. Phải kiểm 1 account không bị tính lại do có nhiều người xem. 3 partner interviews là đường hoạt động riêng; chỉ khi có restaurant account được giới thiệu mới đi vào funnel và dedup.

**Funnel nội dung:** 600 unique viewers → 300 starters → 180 meaningful completers, tức 50% và 60%. Đây là người xem chứ không phải account; nhiều người có thể không phải buyer hoặc thuộc cùng account. Không lấy 180 nhân tỷ lệ qualified của account funnel để dự đoán sales. Anonymous viewers được giữ riêng, chỉ nối identity khi người dùng chủ động cung cấp và có cơ sở xử lý phù hợp.

Các scenario account dùng cùng stage: low 120→36→18→6→4→2→0; base 120→60→36→18→12→6→3; high 120→84→59→30→20→10→5. Đây là sensitivity về khả năng tiếp cận và chuyển bước, không confidence interval và không cam kết. High vượt capacity assessment đồng thời thì xếp lịch, không nhận scope quá khả năng. **Không có customer SaaS trả tiền dự đoán trong funnel này.**

Với trần 138 triệu và 3 paid assessments, cost/paid assessment minh họa là 46 triệu nếu chi hết, cao hơn GP assessment 3 triệu. Đây là chương trình học thị trường có giới hạn, không một máy tăng trưởng có lợi nhuận đã chứng minh. Nếu không có đường chuyển sang hợp đồng vận hành và support economics tốt, phải giảm cost hoặc đổi offer. CAC SaaS chỉ được tính khi có paid venue đúng nghĩa; không dùng 46 triệu làm CAC SaaS.

## Thẻ thử nghiệm

Giới hạn chi dưới đây là phần của các dòng ngân sách, không cộng thêm. Cỡ mẫu là mức công việc khả thi để học, không ngưỡng statistical significance.

| ID / giả thuyết | Thiết kế và cap | Evidence cần có | Quyết định ở review |
|---|---|---|---|
| X1 Buyer hiểu thông điệp “trạng thái và ngoại lệ” | 20 account đầu, 3 tuần; founder ≤20h; tối đa 1 triệu travel từ dòng travel | Notes của tối đa 5 phản hồi/trao đổi ngắn (bao gồm interview đã nằm trong lịch, không thêm 5 interview); hoặc lý do chưa tiếp cận; họ kể lại hiểu gì | Nếu ≥3 buyer tự nêu vấn đề tương tự, lặp với 20 account khác; nếu không, sửa pain/category. Không kết luận whole channel fail |
| X2 Demo lỗi tạo cuộc trao đổi tốt hơn clip chuyển động | 10 lượt xem có hướng dẫn trong 12 buổi gặp nhà hàng/90 ngày, luân phiên narrative; ≤15h founder + 8h presales đã nằm trong envelope | Mỗi người kể đúng giới hạn simulation và chọn được tình huống site; next step cụ thể | Nếu hiểu sai hardware, sửa copy ngay; so chất lượng note, chưa dùng p-value |
| X3 Partner có nhu cầu workflow bổ sung | 3 interview + tối đa 1 workshop; ≤3 triệu từ workshop budget | Một model/API, một khách được phép giới thiệu, owner support rõ | Chỉ soạn SOW tiếp khi có cả ba; nếu chỉ muốn lead miễn phí thì sửa proposition |
| X4 SEO/query pain tìm được buyer | 4 core pages, review 8 tuần; ≤8 triệu từ content | Search query, relevant clicks, qualified questions; content proof-reviewed | Giữ nội dung hữu ích; sửa title/intent nếu reach sai, không “kill SEO” vì 8 tuần ít traffic |
| X5 Paid search đủ ý định | Tối đa 6 triệu mỗi đợt, 2 đợt; 4 tuần/đợt; cap 200 click/đợt | Query report, fit của inquiry, view→meaningful, cost/conversation | Review ở mốc 30 click đầu để loại sai query. Nếu hết 6 triệu/200click chưa có ≥2 qualified conversation, không tự mở tranche tiếp; phỏng vấn và sửa. Không kết luận CAC/LTV |
| X6 Người mua trả cho assessment | Tối đa 6 proposal, 6–8 tuần; 12h founder; delivery cost sau bán tính COGS riêng | Chấp nhận scope, lịch, budget và thanh toán; lý do decline | 3 paid là mục tiêu học; 0 paid yêu cầu rà deliverable/trust/price; không discount hardware để che vấn đề |

X5 sensitivity: 6 triệu / CPC giả định 20k = 300 clicks nhưng cap chỉ 200 nên chi tối đa 4 triệu nếu CPC đúng; CPC 30k = 200click/6 triệu; CPC 60k = 100click/6 triệu. Với conversion click→qualified conversation giả định 1%/3%/5%, ở 200click kỳ vọng số học 2/6/10 cuộc, không phải kết quả dự đoán đáng tin. Những người hoàn thành simulation chưa đủ fit không được nâng conversion để báo hiệu quả. Không cài retargeting trong baseline. Nếu sau này đủ traffic/consent, lập experiment incrementality riêng, kiểm eligibility và consent theo [Google Customer Match](https://support.google.com/adspolicy/answer/6299717?hl=en); không áp assumed uplift.

## Lịch 12 tuần

| Tuần sau D0 | Chủ đề / đầu ra chủ lực | Việc sales/partner | Review |
|---|---|---|---|
| 1 | Launch note + demo 4 phút + landing bản duyệt | Nghiên cứu 10 account; 1 interview | Claim đúng, form/CRM hoạt động |
| 2 | Ngoại lệ: món chưa được xác nhận | 10 account; 1 interview; chuẩn bị scope | Người xem hiểu simulation |
| 3 | WAN/LAN và trách nhiệm người vận hành | 10 account; 1 interview + 1 partner | Pain và giới hạn offline |
| 4 | Checklist site và tổng chi phí | 10 account; 1 interview; 2 candidates assessment scoped | ICP/price/CTA, day30 decision |
| 5 | Bài chọn robot vs thay quy trình | 10 account; 1 interview; 1 proposal | Paid gate; chỉ mở X5 nếu đủ |
| 6 | Webinar “Một chuyến giao khi có lỗi” | 10 account; 1 interview; 1 partner | Attendance ICP + next step |
| 7 | Sơ đồ integration POS→fulfillment | 10 account; 1 interview; assessment delivery nếu đã bán | Time log so estimate |
| 8 | Mẫu báo cáo assessment ẩn danh/giả lập gắn nhãn | 10 account; 1 interview; cumulative 4 scope | Day60: evidence và paid tranche2 |
| 9 | Partner demo và readiness checklist | 10 account; 1 meeting; 1 proposal | Gate native/hardware, không hứa date |
| 10 | Office hours/webinar thứ hai có điều kiện | 10 account; 1 meeting; 1 partner | Thắc mắc mua thật và support |
| 11 | “Pilot cần đo gì?” + worksheet | 10 account; 1 meeting; cumulative 6 scope | WTP và nguồn lực cho delivery |
| 12 | Review học được và roadmap đúng trạng thái | 10 account; 1 meeting; tổng mục tiêu 3 paid | Day90 quyết định pha tiếp theo |

12 interview/meeting nhà hàng, 3 partner interview; ≥10 trong 12 meeting nhà hàng cần nội dung discovery đủ note. Lịch này là năng lực dự kiến, không chuyển meeting chưa có thành “đã hoàn thành”. Chi tiết tuần 1–4 tại [07](07-calendar-and-weekly-checklist.md).

## Keyword intent clusters

Không có search volume/CPC thực; phải kiểm công cụ/tài khoản trước chạy paid. Keyword sau là seed, không số liệu SEO.

| Cụm | VI / JA / EN seed | Asset / CTA |
|---|---|---|
| Đánh giá mua | robot phục vụ nhà hàng có phù hợp; chi phí triển khai robot nhà hàng / 配膳ロボット 導入 検討 / restaurant delivery robot evaluation | Site checklist → assessment |
| Tích hợp | robot phục vụ kết nối POS; POS KDS robot / 配膳ロボット POS 連携 / restaurant robot POS integration | Architecture business flow → partner discovery |
| Ngoại lệ | robot giao món bị chặn; quản lý giao nhầm món / 配膳ロボット トラブル 対応 / restaurant robot exception handling | Fault replay → guided demo |
| Đo hiệu quả | KPI pilot robot nhà hàng; tổng chi phí robot / 配膳ロボット 効果 検証 / service robot pilot metrics | Pilot worksheet → qualified meeting |
| Offline | POS mất mạng LAN nhiều tablet / 飲食店 POS オフライン / restaurant offline order coordination | Explainer về giới hạn → workflow call |
| Kỹ thuật phụ trợ | MuJoCo AMR payload; xArm restaurant simulation | Engineering note gắn “technical audience”; không trộn với buyer conversion |

Paid exact/phrase hẹp, địa bàn support thực; negative seeds: đồ chơi, mua robot hút bụi, việc làm, tải game, code bài tập, miễn phí crack. Không dùng tên đối thủ trong ad copy nếu chưa review điều kiện phù hợp; nội dung so sánh phải chỉ phạm vi đã xác minh. Không tạo landing “đã tích hợp” cho model đang là roadmap. Bản JA nên được người đủ năng lực bản địa review trước đăng.
