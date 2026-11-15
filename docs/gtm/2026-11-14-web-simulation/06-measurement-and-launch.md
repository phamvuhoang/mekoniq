# 06 — Measurement, launch runbook và quyền công bố

Tài liệu đặc tả việc cần đo; **chưa triển khai tracking, tạo tài khoản, upload audience hay gửi dữ liệu ra ngoài**. Dữ liệu kỹ thuật/evidence và dữ liệu marketing có mục đích, quyền truy cập và retention riêng.

## Funnel và định nghĩa

- **Viewer:** người xem demo/replay duy nhất trong cửa sổ 90 ngày nếu có cách đếm phù hợp được duyệt. Khi chỉ có session, báo session; không gọi session là người duy nhất.
- **Started:** chủ động bấm bắt đầu kịch bản hoặc replay; page load/autoplay không tính.
- **Meaningful live completion:** người dùng chủ động bắt đầu một run, run có terminal result thực và người dùng chủ động mở kết quả hoặc đoạn fault/reason của run đó. Run lỗi vẫn có thể meaningful. Đây là tín hiệu tương tác, không chứng minh người xem hiểu đúng giới hạn mô phỏng; không đòi mọi run phải success để marketing đẹp.
- **Meaningful replay completion:** người dùng chủ động bắt đầu replay, thực xem tối thiểu 75% timeline và chủ động mở đoạn fault hoặc result. Live và replay báo riêng. Không có quiz bắt buộc hoặc màn chặn UX. Nếu chưa instrument được, dùng người hướng dẫn tick checklist; không tạo số tự động giả.
- **Meaningful account:** ít nhất một contact đã định danh hợp lệ thuộc restaurant account đạt một trong hai điều kiện trên; nhiều contact/run vẫn chỉ một account.
- **Qualified account:** đáp ứng qualification ở [03](03-gtm-and-commercial.md), có pain và vai trò cụ thể; simulation hoàn thành không tự đủ qualified.
- **Meeting held:** cuộc gặp thực có note, người tham dự và next step. Booking/no-show không tính. Funnel account đếm account có ít nhất một cuộc gặp, không tổng số cuộc; activity log vẫn giữ từng cuộc và follow-up. Mục tiêu 12 là 12 account khác nhau.
- **Assessment scoped:** scope, buyer, đầu vào, phí đề xuất và bước quyết định đã ghi; chưa đồng nghĩa đã khảo sát tại chỗ hoặc được trả tiền.
- **Paid assessment:** engagement dịch vụ có thỏa thuận và tiền nhận theo chính sách kế toán được chọn. Không tính ARR/MRR.
- **Physical pilot started:** có G3/G4 và ca thực bắt đầu; web run không tính.
- **Subscription active:** hợp đồng và acceptance đúng phạm vi, kỳ thuê bao hoạt động. Đây mới là paid venue cho SaaS CAC/retention.

Hiểu đúng giới hạn mô phỏng được đo riêng qua guided discovery/rehearsal hoặc phản hồi tự nguyện; không suy engagement thành hiểu đúng. Nhãn simulation/live/replay vẫn thường trực. Event spec này không yêu cầu thêm bước UX vào sản phẩm.

**North-star giai đoạn học:** số restaurant account đủ phù hợp đồng ý bước assessment cụ thể, kèm thời gian/chi phí cần để đạt bước đó. Guardrails: hiểu đúng simulation, claim không sai, thời gian presales, lỗi demo, dữ liệu tối thiểu. Chưa dùng “robot missions” trong Lab làm customer value metric.

## Event spec đề xuất

Tất cả event có `event_id` UUID, `event_name`, `schema_version`, `occurred_at_utc`, `received_at_utc`, `release_id`, `environment` (`internal`, `public_demo`, `customer_pilot`), `mode` (`live_sim`, `replay`, `physical`), `session_id`, `consent_state`, `locale`, `utm_*` nếu có. `account_id`/`contact_id` chỉ khi người dùng cung cấp và được xử lý hợp lệ; không để email/số điện thoại vào event payload, URL hay UTM. Event marketing không sao chép trace vận hành chứa dữ liệu nhạy cảm.

| Event | Trigger / thuộc tính thêm | Nguồn và chống double count |
|---|---|---|
| `demo_viewed` | Trang/asset demo thực hiển thị; `asset_id` | Client, 1 lần/session/asset; loại internal/bot đã biết |
| `scenario_started` | Intent bắt đầu được nhận; `scenario_id`, `run_id` | Runtime ACK cho live; client cho replay, ghi mode riêng |
| `scenario_terminal` | Result thật; `outcome`, `reason_code`, `coverage_status` | Runtime/replay manifest có provenance; dedup theo run+terminal revision |
| `replay_progress` | Mốc 25/50/75/100%; `replay_id`, `milestone` | Client, 1 event/mốc/session/replay; seek không đồng nghĩa xem đủ |
| `fault_inspected` | Người dùng mở fault hoặc reason/timeline; `run_id` | Client, 1 lần/run/session |
| `result_opened` | Người dùng chủ động mở kết quả | Client, không phát từ page autoplay |
| `scope_understood` | Người tham gia tự nguyện trả lời về giới hạn trong guided discovery/rehearsal; `correct` boolean | Checklist riêng, không điều kiện completion, không thêm quiz bắt buộc vào web; chưa đo thì `unknown` |
| `meaningful_completed` | Điều kiện live/replay đủ | Derived từ event/checklist, không bắn thêm để bù run thiếu evidence |
| `assessment_cta_clicked` | Bấm CTA | Client; đo click, không gọi lead |
| `inquiry_submitted` | Form hợp lệ được lưu; `inquiry_id`, `contact_preference` | Server; idempotency theo submission key, double-click không thêm lead |
| `account_qualified` | Người sales review và ghi lý do | CRM manual, một record theo stage transition; log correction |
| `meeting_held` | Sau họp có note | CRM; meeting ID; meeting partner có `account_type=partner` |
| `assessment_scoped` / `assessment_paid` | Có scope / payment thực được xác nhận | CRM/finance; deal ID, không nhận revenue từ click |
| `pilot_started` / `subscription_activated` | Gate + acceptance đạt theo record | CRM/ops; site ID, release và acceptance reference; không từ Lab |

`occurred_at` dùng UTC, dashboard trình bày Asia/Ho_Chi_Minh; Nhật xem Asia/Tokyo nhưng cohort không đổi giữa dashboard. “90 ngày” tính từ D0; 12 tuần nội dung =84 ngày, 6 ngày còn lại dành reconciliation và decision memo. Phát event trễ giữ ngày phát sinh và ngày nhận; không sửa funnel lịch sử im lặng.

### Dedupe và attribution

Khóa account là pháp nhân/chuỗi được sales xác minh, site là địa điểm con; domain/email đơn lẻ chỉ gợi ý match. CRM merge cần lưu alias và lịch sử. Một chuỗi xem 5 lần vẫn một account; 2 site thuê bao là 2 venue. Email người dùng ở domain phổ thông không dùng domain làm account. Contact cùng công ty và nhiều thiết bị phải có quy trình match do người kiểm khi không chắc.

Attribution kế hoạch: lưu first known source, last non-direct source trước inquiry trong cửa sổ 30 ngày và self-reported “biết đến từ đâu”; giữ cả ba, không ép một kênh nhận toàn bộ. Partner sourced phải có intro/deal-registration record trước inquiry, không lấy lời nhận sau khi deal thắng. Organic/direct không bị xóa vì một lần retargeting sau đó. Có thể có assisted source nhiều giá trị nhưng primary source chỉ một để tổng không nhân đôi. Account funnel tuần có cohort D0/D30/D60; sales lag được báo riêng.

UTM lowercase ASCII: `utm_source=linkedin|facebook|youtube|partner_slug|google|newsletter`; `utm_medium=organic_social|referral|cpc|email|webinar`; `utm_campaign=mkq_websim_v1_vn_90d`; `utm_content=p01_launch_vi|v01_fault_vi|x05_assessment_a`; `utm_term` chỉ keyword nhóm đã duyệt. Không có tên người/nhà hàng trong UTM. URL mẫu là cấu trúc nội bộ, không tự phát sinh domain/link live.

## CRM tối thiểu

`account_id`, `account_type` restaurant/partner, tên, nguồn URL công khai, địa bàn, số site đã xác minh, mô hình, buyer role, champion, channel/contact permission, consent source/time/version, pain verbatim được phép lưu, current POS/robot, API unknowns, site constraints, qualification 6 yếu tố, stage + ngày, owner, next action + ngày, first/last/self-report source, meeting ID, scope/fee/currency, reason lost/no decision, hardware/native blockers, assessment/pilot/subscription IDs, payment state, renewal date khi có, support hours. Chưa có dữ liệu thì để `unknown`, không điền 0 thay unknown. Không lưu số thẻ, thông tin thực khách, credentials vendor hay sơ đồ nhạy cảm trong marketing CRM.

## Dashboard hàng tuần

| Chỉ số | Công thức / cách đọc |
|---|---|
| Meaningful rate theo mode | Unique meaningful viewers ÷ unique started viewers cùng cohort/mode; chưa có identity thì ghi session-rate |
| Account meaningful rate | Account meaningful ÷ account viewed đã định danh; dedup chain |
| Qualification rate | Qualified restaurant accounts ÷ meaningful restaurant accounts; báo count cạnh % |
| Held rate | Meeting held ÷ meetings booked; no-show riêng |
| Proposal progression | Scoped assessments ÷ restaurant meetings held; đếm cùng cohort hoặc ghi lag |
| Paid assessment conversion | Paid assessments ÷ scoped assessments đủ thời gian quyết định; pending riêng |
| Cost per qualified account | Actual S&M phân bổ ÷ qualified restaurant accounts; không gọi CAC |
| Cost per paid assessment | Actual S&M phân bổ ÷ assessment trả phí; dịch vụ COGS báo riêng |
| SaaS CAC | (Cash S&M + allocated sales/presales labor + commissions) ÷ new active paying venues; nếu 0 venue: chưa xác định |
| SaaS contribution/site/tháng | MRR site − cloud/runtime/support trực tiếp định kỳ − phí partner định kỳ nếu thuộc COGS |
| Payback | CAC ÷ contribution monthly; không trộn tháng/năm |
| Customer value tại pilot | Completion eligible tasks; intervention/100 task; median/P90 duration; support hours; downtime trong scheduled hours, cùng definition baseline |
| Guardrails | Demo failure count; % hiểu đúng simulation; presales hours/account; unresolved claim issues; consent/unsubscribe handling |

Báo cáo tuần: Actual / target / remaining budget / evidence / next decision. Tỷ lệ từ mẫu 1/2 phải hiện “1 trên 2”, không chỉ 50%. Không điền LTV/NRR/retention từ phỏng đoán. Khi có cohort khách đủ thời gian, theo dõi logo/revenue retention theo ngày ký và channel; không kết luận scale/kill chỉ vì đạt một tỷ lệ trên ít khách.

## Claim-proof matrix trước phát hành

| Claim / asset | Bằng chứng tối thiểu | Wording được dùng | Owner / trạng thái tại snapshot |
|---|---|---|---|
| Nền tảng nhà hàng + orchestration | Capability/spec + implementation đúng release | “Được phát triển/thiết kế cho…”; từng module kèm readiness | Product/engineering; local code, external gates còn thiếu |
| AMR physics có tải | Run/report và artifact hợp lệ của B02+ phần UI tương ứng | “Mô phỏng một AMR có tải trong cấu hình này” | Engineering; worker/provider tested local; web payload release chưa hoàn tất tại snapshot |
| Fault/recovery/replay trên web | Case được duyệt, report/hash/coverage, UI và replay acceptance | Nêu fault cụ thể, label mode; không hứa mọi lỗi tự phục hồi | Engineering; release gate phải refresh |
| Arm đặt cốc lên AMR chung world | Shared-world case có continuity/custody evidence, không teleport | “Kịch bản mô phỏng…”; coffee mock | Engineering; planned/in progress, chưa dùng trong launch bắt buộc |
| Offline nhiều tablet | Test WAN/LAN/ownership đúng thiết bị/provider | “Thiết kế có giới hạn rõ; cần nghiệm thu cấu hình” | Engineering; chưa blanket claim production |
| Tương thích robot cụ thể | Model/firmware/API permission + conformance + native/device acceptance | Nêu model/firmware/scope đúng record | Integrator/engineering; chưa có blanket support |
| Tăng năng suất/ROI/an toàn | Pilot baseline và kết quả được reviewer/buyer cho phép; safety evidence riêng | Số có mẫu, ca, scope và hạn chế | Chưa có; cấm số tiết kiệm/certification marketing |
| Giá/gói/khả năng cung cấp | Scope + cost + founder approval | “Đề xuất theo cấu hình”; price draft ở internal | Founder; giả thuyết |
| Khách hàng/logo/partner | Hợp đồng/relationship thật + phép công bố | Chỉ đúng hình thức quan hệ | Chưa cung cấp bằng chứng |
| Live simulation R2a / release GTM mới | Host deploy/health/session/access test đúng scope, owner support | R2a `MJ-BV01` đã được kiểm qua HTTPS; claim release mới phải có evidence riêng | [CL01](../../implementation/evidence/cloud-run/mekoniq-2026-11-14/README.md) và [production UI](../../implementation/evidence/production/r2a-2026-11-14/README.md) `tested`, `accepted:false`, `not_calibrated`; chưa đóng B04/R2b/D0 |

## Checklist launch: D−7 đến D+7

**D−7, Engineering owner**

- [ ] Chốt release tuple source/Lab, runtime pin, commit, evidence URI và signoff scope.
- [ ] Demo happy + fault + result đúng input; không có success giả khi ACK/coverage thiếu.
- [ ] Replay package cùng release mở được offline; mode/seed/input/model provenance hiện đúng. [Guide R2a offline](../../../artifacts/mekoniq-r2a-demo-guide.html) chỉ là fallback walkthrough, không đóng điều kiện replay này.
- [ ] Kiểm hosting đúng release/scenario cần quảng bá. R2a arm đã có record HTTPS production; không tự chuyển bằng chứng đó sang R2b. Nếu release mục tiêu chưa có live evidence, đổi CTA thành replay/guided đúng asset đã có; không gắn nhãn live.
- [ ] Một-AMR story đủ rõ; arm+AMR chỉ thêm khi gate riêng đạt. Physics chưa hiệu chuẩn được nói đúng.

**D−3, GTM + founder**

- [ ] Kiểm copy/web cũ có claim 4 khay, auto reassignment, price/BOM hoặc safety cần loại khỏi chiến dịch mới.
- [ ] Review 100% landing/deck/video theo matrix; không logo/quote chưa được phép.
- [ ] Landing, form, lịch, contact owner, privacy notice và consent choices thực tồn tại; links không còn biến mẫu.
- [ ] Consent/unsubscribe được xử lý, dữ liệu tối thiểu, retention/access owner quyết định trước thu thập.
- [ ] Tài khoản quảng cáo nếu dùng đủ eligibility; [lead form policy](https://support.google.com/google-ads/answer/9423234?hl=en) kiểm lại. Baseline không phụ thuộc retargeting.

**D−1, rehearsal có người đóng vai buyer**

- [ ] 2 người không thuộc đội engineering xem và kể lại đúng simulation/physical distinction; đây là rehearsal, không giả thành customer validation.
- [ ] Thử desktop/mobile hiển thị copy và replay fallback; màn hình nhỏ không buộc điều khiển simulation nặng để hiểu offer.
- [ ] 4 phút demo chạy đúng script; chuyển fallback ≤15 giây khi runtime unavailable.
- [ ] Test form một record nội bộ gắn `internal`; check không cộng vào production funnel.
- [ ] Founder xác nhận scope launch, lịch người trực và tiền được giải ngân. Engineering ký claims kỹ thuật đúng scope.

**D0**

- [ ] Chỉ đăng asset đã duyệt; launch một địa bàn/ICP, lưu release và bản copy.
- [ ] Demo link, contact và error page hoạt động; không chứa dữ liệu khách hoặc secret trong replay.
- [ ] Mỗi inquiry có owner và next action. Không bắn chuỗi email khi chỉ xem trang.

**D+1 đến D+7**

- [ ] Kiểm inquiry mỗi ngày làm việc, phản hồi theo SLA đã công bố.
- [ ] Ghi câu hỏi hiểu sai, lỗi demo, no-show, thời gian hỗ trợ; sửa thông điệp trước tăng phân phối.
- [ ] Review ngày 7: có buyer đúng vai trò chưa; họ hiểu gì; event đáng tin chưa; giữ/giảm phạm vi.

## Rủi ro và quyết định

| Rủi ro | Tín hiệu sớm | Hành động / chủ sở hữu |
|---|---|---|
| Video đẹp hút người xem sai | Nhiều view, inquiry hỏi đồ chơi/code/học tập | GTM đổi phân phối/title/CTA, giữ technical track riêng |
| Khách tưởng đã có robot thương mại | Hỏi giao ngay hoặc cite giá BOM cũ | Founder sửa claim và recap rõ scope trước proposal |
| Engineering bị kéo vào presales | Vượt 5h/tuần baseline hoặc custom scope ngoài gói | Founder xếp lịch, engineer báo blocker, tính phí khám phá kỹ thuật |
| Pilot chậm vì hardware/native | Không có host/model/support owner | Không hứa ngày; hoàn thành assessment/replay và báo gate còn thiếu |
| Vendor khóa API/giới hạn warranty | Không có tài liệu/quyền hoặc tích hợp làm mất bảo hành | Integrator kiểm bằng văn bản; đổi model/scope, không hack vòng |
| Chi phí support phá margin | Time log vượt giả định 2 đợt | Đổi giá/scope/SLA, không “scale” trước cost review |
| Sai attribution/cohort | Nhiều contact cùng account, pending bị coi lost | Ops dedup và dùng cohort ngày, báo pending |
| Thu thập dữ liệu vượt mục đích | Lead không biết sẽ nhận newsletter | Dừng nurture, sửa notice/permission; kiểm quy định với người có chuyên môn trước gửi |

Retention marketing đề xuất để owner duyệt: raw anonymous analytics tối đa 90 ngày; lead chưa có hoạt động 180 ngày thì rà xóa/ẩn danh, trừ trường hợp có căn cứ lưu khác; giao dịch/hợp đồng theo chính sách pháp lý riêng. Đây là nguyên tắc vận hành dự thảo, không tuyên bố thời hạn pháp luật. Consent record/version và unsubscribe suppression cần cơ chế tối thiểu để tôn trọng lựa chọn, không giữ thêm dữ liệu không cần thiết.
