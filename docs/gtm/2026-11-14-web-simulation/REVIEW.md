# Kiểm tra bộ tài liệu và bàn giao

**Hiện trạng kỹ thuật16/11:** đọc[08—readiness theo bằng chứng cuối](08-final-engineering-readiness.md) trước khi dùng pitch/claim. Source981/Labd4 đã được đo lại; drawing/pause/public capture validity chưa đạt. Guided replay4phút không phải full live1×; D0, host/native/hardware và quyền publish/spend vẫn riêng. Các snapshot cũ bên dưới giữ ngày/tuple lịch sử.


Ngày: 14/11/2026. Trạng thái: **bộ kế hoạch nội bộ đã soạn đầy đủ; chưa phát hành hoặc thực thi chiến dịch**. Phạm vi ghi file chỉ trong `docs/2026-11-14-web-simulation-gtm/`, ngoài bốn Git repository. Không đổi code, Git, deploy, ngân sách, tài khoản bên ngoài hoặc liên hệ người khác.

## Kiểm tra deliverables

- [x] Executive memo: ICP, buyer, positioning, naming, so sánh VN/JP, lựa chọn chiến lược và input còn thiếu.
- [x] Research ledger: 18 nguồn web chính thức, 11 nguồn local, ngày kiểm và giới hạn; không biến doanh thu F&B thành TAM.
- [x] Phân biệt phần mềm nhà hàng, robot trên thị trường, phương án thủ công và simulator kỹ thuật.
- [x] Pitch 30 giây/2 phút/5 phút; deck 12 slide có nội dung, proof, visual và speaker notes; partner/investor appendix; sales sheet và objections.
- [x] Demo 4 phút với fault/replay và fallback; phân biệt live/replay; cảnh arm+AMR chỉ dùng sau gate riêng.
- [x] GTM: offer, script discovery, qualification, giá giả thuyết, SaaS/hardware/services riêng, pipeline, partner terms và RACI.
- [x] Digital: xếp kênh, 3 budget scenarios, funnel/sensitivity, 6 experiment cards, 12 tuần và 16 dòng asset cho 4 tuần đầu.
- [x] Copy landing, 10 bài đăng, 3 video scripts, 4 outreach drafts, 4 nurture emails; headline/pitch/CTA VI/JA/EN. Chưa gửi.
- [x] Measurement: event spec, UTM, dedup, CRM, dashboards, claim-proof, launch runbook và checklist tuần. Meaningful engagement không yêu cầu quiz; hiểu đúng simulation được đo riêng nếu có cơ sở.
- [x] Ba CSV mở được trong spreadsheet; helper local kiểm arithmetic, không gọi network.

## Mô hình chuẩn dùng chung

Restaurant account funnel 90 ngày: **120 → 60 → 36 → 18 → 12 → 6 → 3**. Mốc 12 là 12 restaurant account khác nhau có meeting held, ít nhất 10 có discovery note. **3 partner meetings nằm ngoài funnel**. Tháng đầu 4 restaurant + 1 partner; hai tháng tiếp mỗi tháng thêm 4 + 1.

Contact, visitor, session, account và site là đơn vị khác nhau. Viewer funnel 600 → 300 → 180 không nhân sang sales khi chưa có identity evidence. Sáu assessment scoped chưa phải sáu site đã khảo sát. Ba paid assessment không phải thuê bao, doanh thu định kỳ hoặc physical pilot.

Cash ceilings: 24 / 60 / 120 triệu VND. Imputed labor: 50,4 / 78 / 108 triệu. Tổng: **74,4 / 138 / 228 triệu VND**. Standard dành 6 triệu reserve, 12 triệu paid có điều kiện. R&D, thiết bị và pilot ngoài ngân sách này. COGS delivery của assessment/integration theo hợp đồng dịch vụ riêng, không tính trùng presales. Tất cả là giả thuyết.

Kinh tế minh họa:

| Dòng | Revenue − direct cost | GP / margin |
|---|---|---|
| Assessment | 8 − 5 triệu | 3 triệu / 37,5% |
| Integration | 30 − 21 triệu | 9 triệu / 30% |
| SaaS | 2 − 0,6 triệu/tháng | 1,4 triệu / 70% |
| Hardware minh họa | 120 − 108 triệu | 12 triệu / 10% |
| Maintenance | 1,5 − 1,2 triệu/tháng | 0,3 triệu / 20% |

Hardware 120 triệu không phải quote và không đưa vào sales copy. Prospective CAC 12 triệu / GP 1,4 triệu mỗi tháng = 8,57 tháng payback. Chưa có observed CAC, LTV hoặc retention.

## Kiểm nguồn và giới hạn

Đã mở/đọc URL trong ledger trong phiên nghiên cứu 14/11/2026. Root spot-check độc lập xác nhận:

- iPOS 1H2026 ngày 10/09; JF 228 công ty, 36.827 điểm và doanh thu 107,3% cùng kỳ.
- KiotViet tab F&B 270/330/490 nghìn; Recruit 2.770億 JPY ở ba vùng, công bố 30/10.
- AirREGI basic 0 JPY với thiết bị/một số chức năng tính riêng; PUDU tray/app/button/watch/Link.

Đây là kiểm nguồn và đơn vị, **không kiểm chứng hiệu quả sản phẩm hoặc khách hàng**. SoftBank E10 được thu hẹp về việc ra mắt Servi Q ở Nhật ngày 28/09/2026, tránh giản lược điều kiện phân phối. Smaregi chỉ trích nhóm tính năng đọc được; không đưa giá do lần đọc lại gặp 403. Nguồn động có thể thay đổi: refresh giá, policy và product claims trước xuất bản.

Không có claim thị phần, thứ hạng, tiết kiệm nhân sự, an toàn, nguồn vốn hoặc trợ cấp chưa được chứng minh. Không nghiên cứu thay cho customer discovery; chưa có phỏng vấn thật trong lần lập kế hoạch.

## Kiểm lại bằng lệnh

```sh
python3 docs/2026-11-14-web-simulation-gtm/build-and-validate-model.py
```

`--rebuild` ghi lại ba CSV từ giả thuyết chuẩn trong helper; chỉ dùng để khôi phục mô hình ban đầu, vì sẽ thay chỉnh sửa thủ công trong CSV. Script không chỉnh sản phẩm hoặc tài khoản ngoài. Kiểm lần soạn: PASS cho totals, conversion, gross margins và prospective payback. Các liên kết Markdown local được kiểm tồn tại sau khi hoàn tất bundle.

Biến cá nhân hóa/link trong copy và ô trống của weekly scorecard là trường mẫu có chủ ý, không phải URL live hay thông tin khách hàng giả. Trước xuất bản phải điền và kiểm URL thật, lịch, người phản hồi và permission.

## Quyết định còn cần founder

1. Chọn địa bàn có năng lực hỗ trợ thực; xác nhận VN-first hoặc chuyển JP theo điều kiện partner.
2. Chốt owner sales/content/presales, số giờ và ngân sách; chưa coi 60 triệu là được duyệt.
3. Chọn offer assessment có thu phí hay phương án khác; duyệt scope/giá/điều khoản trước gửi.
4. Chốt release/mode đã nghiệm thu dùng cho D0 và link/contact thật.
5. Cung cấp quan hệ khách/partner có thể tiếp cận hợp lệ; hoàn thiện privacy/contact/consent process.
6. Chốt kinh phí, thiết bị/native host và người chịu trách nhiệm pilot, độc lập ngân sách marketing.

Những input này không chặn việc soạn kế hoạch. Chúng là điều kiện của hành động thực tế tương ứng: chi tiền, công bố live, ký offer hoặc mở pilot. Cập nhật plan theo thông tin founder và evidence mới; không tự biến giả thuyết thành dữ kiện.

## Evidence refresh 14/11/2026, 08:59 ICT

Đã đọc local [Cloud Run CL01](../../implementation/evidence/cloud-run/mekoniq-2026-11-14/README.md), [production R2a](../../implementation/evidence/production/r2a-2026-11-14/README.md), mốc thời gian trong `browser-smoke.json` và [guide HTML R2a](../../../artifacts/mekoniq-r2a-demo-guide.html). HEAD đọc được: source `11d25b47a18adafb88ac21adc249499109996bc5`, Lab `a7449541e118d01f65af0ad1466e0c963a173f3c`; deployment record dùng source `d1a2522…`, runtime pin `4f893ac…`.

Cập nhật 5 file: README, 01 research/evidence, 02 pitch/demo, 06 measurement/launch và REVIEW. Cloud amd64 HTTP tick 4800 và Chrome HTTPS UI tick 4810 đều là bằng chứng R2a theo lần ghi, không là acceptance hoặc calibration. Không chuyển thành R3 native qualification, hardware proof hay hoàn thành B04/R2b shared-world. Guide là tài liệu offline, không phải runtime replay. Giữ nguyên D0 scope, budgets, funnel, permission campaign và code sản phẩm. Không truy cập live cloud hoặc secret trong đợt refresh.

Cập nhật controller 14/11/2026 17:56 ICT: bổ sung L11 và README theo snapshot worktree mới nhất — B04/B05 đã review, B06 matrix 3+5 đạt nhưng review đang chạy, B07/performance/D0 chưa đóng. Giữ research công khai, giá, ngân sách, funnel và checklist launch nguyên nghĩa; không phát hành/chạy chiến dịch.

Cập nhật controller 14/11/2026 19:51 ICT: B06 đã qua review lại sau sửa race xuất report cùng horizon; Source `0624b5a`, Lab `4fabc5a`. Giữ nguyên bằng chứng phát triển và gate D0/performance/hardware; B07a đang triển khai.

Cập nhật controller 14/11/2026 21:23 ICT: B07a đã qua full review và scoped review sau sửa bốn finding, tuple Source5e09a48/Labbe01048. README cập nhật package toàn mẫu dưới25MiB và B07b đang thực hiện; D0/performance/native/hardware vẫn chưa đóng. Không đổi ngân sách/funnel/giá hoặc triển khai chiến dịch. Public shutdown observation giữ trong R2b decision63/B09.

Cập nhật controller sau bàn giao B07b: Source `e07685d` / Lab `89b4a38` đang review, chưa nghiệm thu. Đã đọc báo cáo cuối và raw185giây, kiểm độc lập ZIP50asset/H4760. README/L11/pitch ghi mục tiêu nhịp vẽ và1× chưa đạt; demo4phút dùng mốc replay khi cần, không hứa full live hoàn tất trong4phút. Giữ ngân sách, giá, funnel, nghiên cứu công khai và D0; không phát hành/chạy chiến dịch. Các phạm vi clock/camera/ACKUI khác commit được giữ trong báo cáo kỹ thuật.

Cập nhật controller 15/11/2026: B07b scoped review đã đóng I1/I2/R72, Source `e07685d` / Lab `c20108c`, kiểm493unit và nativebrowser1/1 trên build mới. B08 bắt đầu. Giữ nguyên benchmark185giây ở tuple trước `e07685d` / `89b4a38`; không chuyển số latency/hiệu năng sang UI mới. D0/performance/hardware chưa đóng; vệt header-like trên ảnh mobile có nguyên nhân chưa xác minh được chuyển sang B10 UI qualification. Không thay research công khai/giá/ngân sách/funnel hoặc thực hiện chiến dịch.

Cập nhật controller 15/11/2026 sau B08 review3: I1 đã đóng tại Source `714e37f` / Lab `4741edf`; B09 bắt đầu. B08 X01 thật thuộc producer `709a797`, một run/engine, 12 invariant đạt và 6 untriggered `not_run`; validator mới đọc lại byte-identical và từ chối chín coherent mutants. README/L11 giữ riêng benchmark B07b ở `e07685d` / `89b4a38`, không quảng bá engine ranking, realtime hoặc hardware readiness. D0/performance/hardware và qualification tuple cuối còn mở. Không thay research/giá/ngân sách/funnel hoặc thực hiện chiến dịch.

Cập nhật controller 15/11/2026 sau B09 review2: I1/I2 đã đóng tại Source `3c917ce` / Lab `538ba45`, B00R2 bắt đầu. B09 có kiểm local process/HTTP và Mac worker; image null/unbuilt, WEB05/TLS còn not_run theo quyết định76. Giữ riêng producer/validator B08 và benchmark B07b cũ, không nâng D0/performance/hardware hoặc coi code review là container qualification. Giá/ngân sách/funnel/research công khai giữ nguyên; chưa thực hiện chiến dịch.

Cập nhật controller 15/11/2026 sau B00R2 review1: spec/quality đều PASS, không có finding, tại Source `d0f3074` / Lab `176bf34`. Audit đầy đủ 8.841 path Source và 229 path Lab nhập từ upstream đã khóa; runtime chỉ thay ba chỗ source identity, không thay logic B09. README/L11 phản ánh L00 bắt đầu, không coi nhập hồ sơ cũ là chạy cloud/container/native mới. WEB05/image/D0/hiệu năng/phần cứng vẫn mở. Research công khai, giá, ngân sách và funnel giữ nguyên; chưa thực hiện chiến dịch.

Cập nhật controller 15/11/2026 sau L00 review2: hai Important đã đóng tại Source `298db9b` / Lab `7698aa6`, không có finding mới. README/L11 ghi L01 đang chuẩn bị adapter R2a và probe MuJoCo; gói handoff hiện prepared:true/nativeReady:false. Kiểm static/provenance không chứng minh host, image execution hoặc hardware readiness. Giữ nguyên các producer/benchmark trước, D0 và nghiên cứu/giá/ngân sách/funnel; chưa thực hiện chiến dịch.

Cập nhật controller 15/11/2026 sau L01 review3: bốn Important ban đầu và lỗi ghi request phát hiện ở vòng sửa đã đóng, Source `874d05a` / Lab `4a207b4`; L02 bắt đầu. README/L11 chỉ cập nhật tiến độ tooling: handoff prepared:true/nativeReady:false, 16 ca native not_run, không có lượt cloud/native/hardware mới. Giữ nguyên các producer/benchmark, giới hạn D0/hiệu năng, nghiên cứu công khai, giá, ngân sách và funnel; chưa thực hiện chiến dịch.

Cập nhật controller 15/11/2026 sau L02 review2: guard TF đã sửa và được chấp thuận; finding đường dẫn CLI được reviewer rút lại sau đối chiếu parser và regression compiler thật. Tuple Source `00d41e7` / Lab `82b5f92`; L03 bắt đầu xArm với motion/contact riêng. README/L11 chỉ cập nhật tiến độ tooling; các ca native vẫn not_run, không có host hoặc lượt cloud/native/hardware mới. Giữ nguyên producer/benchmark cũ, D0/hiệu năng, nghiên cứu, giá/ngân sách/funnel; chưa thực hiện chiến dịch.
