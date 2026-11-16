# 05 — Nội dung sẵn để biên tập và xuất bản sau D0

**Hiện trạng kỹ thuật16/11:** đọc[08—readiness theo bằng chứng cuối](08-final-engineering-readiness.md) trước khi dùng pitch/claim. Source981/Labd4 đã được đo lại; drawing/pause/public capture validity chưa đạt. Guided replay4phút không phải full live1×; D0, host/native/hardware và quyền publish/spend vẫn riêng. Các snapshot cũ bên dưới giữ ngày/tuple lịch sử.


**Chưa đăng hoặc gửi.** Nội dung ở đây được viết cho release có simulation/replay và fault đã qua gate. Trước khi dùng, owner đối chiếu từng cảnh với [claim-proof](06-measurement-and-launch.md). Các biến `{{ten}}`, `{{quan}}`, `{{link_demo}}`, `{{link_lich}}`, `{{link_huy}}` phải được điền bằng thông tin/URL đã kiểm; không xuất bản nguyên biến. Không tự tạo lời chứng thực hoặc logo khách. Bản JA cần native-language review trước phát hành.

## Bộ headline, pitch ngắn và CTA VI/JA/EN

| Vai trò | Việt | 日本語 | English |
|---|---|---|---|
| Headline chính | Từ bếp đến bàn, mỗi bước đều có trạng thái rõ ràng. | 厨房からテーブルまで、各工程の状態を見える化。 | Clear status at every step, from kitchen to table. |
| Headline demo | Xem một chuyến giao. Hiểu cách xử lý khi có lỗi. | 配膳の流れと、トラブル時の対応を確かめる。 | See a delivery workflow and what happens when it fails. |
| Pitch | MEKONIQ kết nối vận hành nhà hàng và điều phối robot. Bắt đầu bằng mô phỏng, rồi đánh giá một luồng phục vụ tại quán trước khi quyết định pilot. | MEKONIQは、飲食店の業務とロボットの運用をつなぐプラットフォームです。まずシミュレーションで流れを確認し、店舗の業務と導入条件を評価してから実機検証を検討します。 | MEKONIQ connects restaurant workflows with robot orchestration. Start with a simulation, then assess one on-site workflow before deciding on a physical pilot. |
| CTA xem | Xem mô phỏng 4 phút | 4分のシミュレーションを見る | Watch the 4-minute simulation |
| CTA replay | Xem bản ghi mô phỏng | 記録済みシミュレーションを見る | Watch a recorded simulation |
| CTA buyer | Đánh giá luồng phục vụ của quán | 店舗の配膳フローを相談する | Assess your service workflow |
| CTA partner | Trao đổi về một cấu hình tích hợp | 具体的な連携構成を相談する | Discuss a specific integration |
| Nhãn giới hạn | Mô phỏng — chưa chứng minh hiệu quả hoặc an toàn trên thiết bị thật. | シミュレーションです。実機での効果や安全性を保証するものではありません。 | Simulation — physical performance and safety require separate validation. |

## Landing page — toàn bộ nội dung

**Eyebrow:** MEKONIQ Restaurant Platform · Robot Lab

**H1:** Từ bếp đến bàn, mỗi bước đều có trạng thái rõ ràng.

**Đoạn dẫn:** Khi món đã sẵn sàng, nhóm vận hành cần biết ai nhận việc, món đang ở đâu và phải làm gì khi chuyến giao bị gián đoạn. Xem cách MEKONIQ mô phỏng một luồng phục vụ, rồi cùng đánh giá điều gì phù hợp với nhà hàng của bạn.

**Nút chính:** Xem mô phỏng 4 phút.  
**Nút phụ:** Đánh giá luồng phục vụ của quán.

**Caption ngay dưới visual:** Đây là mô phỏng trong MEKONIQ Robot Lab. Chế độ live simulation hoặc replay được ghi trên màn hình. Kết quả không thay thế kiểm chứng thiết bị và khảo sát hiện trường.

**Section — Điều bạn sẽ thấy**

1. **Một chuyến giao có trạng thái.** Theo dõi điểm đi, điểm đến và những bước cần xác nhận trong kịch bản.
2. **Một tình huống cần xử lý.** Xem điều gì xảy ra khi lượt chạy gặp lỗi được chọn trong demo và trạng thái nào cần được làm rõ.
3. **Bản ghi để cùng xem lại.** Nhìn timeline và kết quả của lần chạy, thay vì chỉ xem một đoạn chuyển động.

**Section — Bắt đầu từ cách quán đang làm việc**

MEKONIQ được phát triển cho vận hành nhà hàng và điều phối robot. Buổi trao đổi đầu tập trung vào một luồng: bếp đến bàn, thu dọn hoặc phối hợp với robot đang có. Phạm vi phần mềm, kết nối POS và thiết bị được đánh giá riêng trước khi đề xuất triển khai.

**Section — Từ demo đến đánh giá có cơ sở**

Xem mô phỏng → trao đổi với quản lý vận hành → đánh giá địa điểm và tích hợp → quyết định phạm vi pilot sau khi đủ kiểm chứng. Báo cáo đánh giá nêu điều phù hợp, điều còn thiếu và chi phí cần xác minh. Chưa có lời hứa tiết kiệm nhân sự hoặc thời điểm vận hành máy thật chỉ từ demo này.

**Section — Có phù hợp với quán của bạn?**

Phù hợp để trao đổi nếu quán phục vụ tại bàn, có nhiều lượt vận chuyển giữa các trạm và sẵn sàng cùng đo một quy trình. Nếu quán đã có POS hoặc robot, hãy cho biết model và cách đang dùng; khả năng kết nối cần được xác minh theo cấu hình cụ thể.

**FAQ**

- **Demo có điều khiển robot thật không?** Không. Robot Lab là môi trường mô phỏng.
- **Có phải thay POS không?** Buổi đánh giá sẽ xác định phần cần giữ, phần cần tích hợp và phần chưa khả thi. Không mặc định thay toàn bộ hệ thống.
- **Có báo giá robot không?** Giá chỉ được lập sau khi chọn cấu hình, phạm vi tích hợp, bảo hành và hỗ trợ. Chưa có bảng giá hardware chung cho mọi địa điểm.
- **Xem demo có mất phí không?** Buổi demo giới thiệu không thu phí theo kế hoạch hiện tại. Assessment chuyên sâu có thể là dịch vụ trả phí, với scope thống nhất trước.
- **Bao giờ có pilot?** Sau khi đánh giá site và hoàn thành các cổng kỹ thuật, thiết bị và vận hành phù hợp. Lịch được thống nhất theo điều kiện thực tế.

**Form:** Tên; vai trò; tên quán/doanh nghiệp; địa bàn; số điểm; email hoặc điện thoại công việc; mục tiêu trao đổi (giao món/thu dọn/tích hợp/khác); POS hoặc robot đang dùng (tùy chọn); cách liên hệ mong muốn. Không yêu cầu doanh thu hay dữ liệu thực khách ở bước đầu.

**Thông báo form dự thảo:** “MEKONIQ dùng thông tin này để phản hồi yêu cầu đánh giá của bạn. Xem chính sách dữ liệu để biết cách xử lý và yêu cầu xóa.” Chính sách thật phải được owner hoàn thiện và liên kết trước khi mở form.

**Checkbox riêng, mặc định bỏ chọn:** “Tôi muốn nhận email về demo và hướng dẫn đánh giá pilot. Tôi có thể hủy đăng ký bất cứ lúc nào.” Không gộp đăng ký marketing vào nút gửi yêu cầu.

**Nút gửi:** Gửi yêu cầu đánh giá.  
**Success:** “Đã ghi nhận yêu cầu. Đội MEKONIQ sẽ phản hồi theo kênh bạn đã chọn trong 1 ngày làm việc.” Chỉ dùng SLA này khi đã bố trí người phụ trách; nếu chưa, thay bằng thời gian có thể thực hiện.

## 10 bài đăng dùng được

### P01 — Công bố trải nghiệm web (LinkedIn/Facebook founder)

Một chuyến giao món không kết thúc chỉ vì robot đã tới gần bàn. Nhóm vận hành còn cần biết món đã được nhận chưa và ai xử lý nếu có thay đổi.

Chúng tôi mở MEKONIQ Robot Lab để cùng xem những câu hỏi đó trong một mô phỏng có hướng dẫn: theo dõi một chuyến giao, gặp một tình huống lỗi và mở lại bản ghi để hiểu kết quả.

Đây là mô phỏng, chưa phải chứng minh hiệu quả hay an toàn trên robot thật. Chúng tôi đang tìm nhà hàng phục vụ tại bàn sẵn sàng cùng đánh giá một luồng vận hành cụ thể.

Xem demo 4 phút: {{link_demo}}. Nếu câu chuyện gần với quán mình, có thể đặt buổi trao đổi 30 phút tại {{link_lich}}.

### P02 — Trạng thái chưa rõ (LinkedIn, kèm timeline)

“Chưa xác nhận” là một thông tin cần giữ nguyên.

Khi một thao tác bị gián đoạn, việc hiển thị thành công quá sớm có thể khiến người tiếp theo hiểu sai. Trong buổi demo MEKONIQ, chúng tôi dành thời gian xem trạng thái và lý do cần xử lý, rồi đối chiếu bản ghi của lần chạy.

Ảnh này là dữ liệu mô phỏng trong phạm vi release được ghi kèm. Điều chúng tôi muốn thảo luận với quản lý ca là: ở quán mình, ai có đủ thông tin và quyền quyết định bước tiếp theo?

Xem tình huống và trao đổi về workflow tại {{link_demo}}.

### P03 — Có POS rồi (Facebook cộng đồng, chỉ khi cho phép)

Quán đã có POS tốt thì buổi đánh giá robot nên bắt đầu ở đâu?

Có thể bắt đầu bằng ba câu hỏi: món sẵn sàng được chuyển thành việc giao như thế nào; ai xác nhận đã giao; khi không giao được, công việc quay về ai? Nếu cách hiện tại đã đáp ứng tốt, chưa cần thêm hệ thống chỉ để có thêm một màn hình.

MEKONIQ dùng mô phỏng để làm rõ những bước này. Kết nối POS hay robot hiện hữu vẫn cần kiểm quyền API, dữ liệu và cấu hình riêng.

Chúng tôi có một phiếu đánh giá luồng phục vụ để cùng đi qua trong 30 phút: {{link_lich}}.

### P04 — Đồ uống trong mô phỏng (YouTube caption/LinkedIn)

Cốc trên khay là một cách đặt câu hỏi: khi đổi tải hoặc cách di chuyển, điều gì cần được quan sát?

Trong mô phỏng MEKONIQ, đầu vào và kết quả được giữ theo từng lần chạy. Bản ghi giúp kỹ sư và người xem cùng chỉ vào một tình huống để thảo luận.

Mô hình chưa hiệu chuẩn với thiết bị thật. Không thể dùng clip này để kết luận robot chở đồ nóng an toàn hoặc đi được trên mọi mặt sàn. Những điều đó cần kiểm chứng riêng.

Xem demo có nhãn mô phỏng và tìm hiểu lộ trình đánh giá: {{link_demo}}.

### P05 — Offline có nhiều tình huống (LinkedIn, infographic)

“Mất mạng” chưa nói hết tình huống của một ca phục vụ.

Mất Internet nhưng các tablet còn LAN khác với việc các thiết bị không còn liên lạc được. Một hệ thống cần nói rõ công việc nào tiếp tục được, công việc nào phải chờ và cách đối soát khi phục hồi.

MEKONIQ được thiết kế phân biệt những tình huống đó. Khả năng trên tablet, mạng và provider cụ thể vẫn cần nghiệm thu; không có lời hứa mọi thao tác đều chạy đầy đủ khi mất kết nối.

Trong buổi đánh giá, chúng tôi muốn nghe một lần mất mạng thật của quán và cách nhóm đã xử lý: {{link_lich}}.

### P06 — Checklist trước pilot (Facebook/LinkedIn)

Trước khi hỏi “robot nào?”, hãy thống nhất “đang muốn cải thiện luồng nào?”.

Một phiếu pilot hữu ích nên ghi được tuyến giao, loại tải, người xác nhận, cách chuyển thủ công, baseline và ai có quyền dừng. Sau đó mới kiểm mặt bằng, thiết bị và chi phí hỗ trợ.

MEKONIQ đang dùng cách tiếp cận này cho các buổi đánh giá. Demo web giúp mô tả hành vi; pilot vật lý chỉ mở khi những điều kiện riêng đã được kiểm.

Đặt buổi trao đổi về một tuyến cụ thể: {{link_lich}}.

### P07 — Tổng chi phí (LinkedIn, worksheet)

Giá mua robot chỉ là một dòng trong chi phí triển khai.

Còn có thiết bị phụ trợ, cấu hình địa điểm, tích hợp, đào tạo, bảo trì và thời gian của người vận hành. Với phần mềm, cũng cần tách phí định kỳ khỏi công việc triển khai một lần.

MEKONIQ sẽ lập phạm vi đánh giá trước khi đề xuất giá. Các con số prototype trong tài liệu ý tưởng cũ không phải báo giá thương mại.

Nếu đang so sánh phương án, chúng ta có thể cùng lập bảng chi phí theo cấu hình của quán: {{link_lich}}.

### P08 — Lời mời partner (LinkedIn)

Chúng tôi muốn trao đổi với đội tích hợp/POS/robot đang có một bài toán nhà hàng cụ thể.

MEKONIQ đóng góp workflow, trạng thái nghiệp vụ và môi trường mô phỏng để thống nhất yêu cầu. Điều cần kiểm cùng nhau là model, quyền API, dữ liệu, người hỗ trợ hiện trường và phạm vi trách nhiệm khi xảy ra lỗi.

Chúng tôi chưa công bố tương thích với mọi robot và chưa có chương trình partner đã ký sẵn. Bước đầu là một buổi làm việc về một cấu hình và một khách hàng được phép thảo luận.

Liên hệ qua {{link_lich}} để chọn buổi technical discovery.

### P09 — Mời webinar nhỏ (LinkedIn/email opt-in)

Một chuyến giao gặp lỗi: người vận hành cần nhìn thấy gì?

Trong buổi demo có hướng dẫn của MEKONIQ, chúng ta sẽ xem một kịch bản mô phỏng, mở bản ghi và thảo luận ai xử lý bước tiếp theo. Phần cuối dành cho câu hỏi về một quy trình thực tế của người tham dự.

Buổi này dành cho chủ nhà hàng, quản lý ca và đội tích hợp đang đánh giá luồng phục vụ. Không cần kiến thức robotics. Mô phỏng chưa thay thế nghiệm thu thiết bị thật.

Xem lịch đã xác nhận và đăng ký nhận thông tin buổi tại {{link_lich}}. Chỉ dùng bài này khi đã có lịch/host và quy trình đăng ký.

### P10 — Cách công bố kết quả trung thực (Founder note, tuần 12)

Một báo cáo pilot hữu ích cần nêu cả điều chưa được chứng minh.

Chúng tôi tách kết quả mô phỏng, kiểm thử trên thiết bị và đánh giá ca vận hành. Mỗi kết quả cần có phạm vi, đầu vào và cách đo. Một lần chạy tốt không thay cho dữ liệu nhiều ca; bản ghi phần mềm không tự chứng minh an toàn của phần cứng.

Đây cũng là cách chúng tôi muốn làm việc với design partner MEKONIQ: xác định câu hỏi trước, ghi kết quả đúng và quyết định bước tiếp theo theo bằng chứng.

Nếu đang cân nhắc một thử nghiệm, hãy bắt đầu bằng buổi đánh giá một luồng tại {{link_lich}}. Bài này nói về phương pháp; không ngụ ý chúng tôi đã hoàn thành pilot.

## Ba kịch bản video

**V01 — 45 giây, dọc hoặc ngang; “Món đã tới, đã nhận chưa?”**

- 0–5s: cận trạng thái demo, chữ “Mô phỏng”. Voice: “Robot tới bàn và khách nhận món là hai điều cần phân biệt.”
- 5–18s: run chuẩn đã duyệt, highlight đúng bước. Voice: “Trong MEKONIQ Robot Lab, chúng ta theo dõi một chuyến giao cùng các trạng thái cần xác nhận.”
- 18–32s: fault replay có nhãn, reason/timeline. Voice: “Khi có lỗi, xem hệ thống biết gì, chưa biết gì và người vận hành cần xử lý phần nào.”
- 32–40s: bảng baseline trống. Voice: “Bước tiếp theo là đánh giá một luồng thực tế; kết quả mô phỏng chưa chứng minh hiệu quả tại quán.”
- 40–45s: CTA “Xem demo 4 phút”; link ở mô tả. Không hiển thị số tiết kiệm hoặc logo khách.

**V02 — 60 giây, “Ba câu hỏi trước khi mua robot”**

0–10s founder trước camera: “Hãy chọn một tuyến giao cụ thể.” 10–25s sơ đồ bếp→bàn: “Ai nhận việc và ai xác nhận xong?” 25–40s ghi chú ngoại lệ: “Nếu không giao được, ai tiếp quản?” 40–50s bảng chi phí: “Tổng chi phí gồm thiết bị, tích hợp và hỗ trợ nào?” 50–60s: “MEKONIQ dùng mô phỏng để bắt đầu cuộc trao đổi, rồi kiểm site và thiết bị trước pilot. Đặt buổi đánh giá luồng phục vụ.”

**V03 — 90 giây, partner EN; JA phụ đề tùy nguồn lực**

Voice: “A restaurant workflow spans more than robot movement. This MEKONIQ simulation gives operators and integration teams a shared view of the task, its status and the recorded outcome. We start with a specific model and a specific workflow. We review API permissions, device capabilities, ownership of confirmations and the recovery procedure. The Lab remains a simulation environment; physical deployment requires separate device and site validation. We are exploring collaboration with partners who can support hardware and local operations. The next step is a technical discovery session around one configuration and one qualified venue.”

Hình: 0–20s workflow; 20–45s actual release screen; 45–65s API/readiness checklist gắn “planning”; 65–90s partner roles/CTA. Không tự dùng ảnh vendor hoặc logo nếu chưa có quyền phù hợp.

## Outreach và email — bản nháp, không gửi

Chỉ dùng qua đầu mối có cơ sở liên hệ phù hợp, ưu tiên được giới thiệu/inquiry. Không giả định email công khai đồng nghĩa đồng ý nhận newsletter. Kiểm quy định địa bàn/kênh và quyền dùng dữ liệu trước khi gửi; tài liệu này không kết luận pháp lý.

**O1 — Xin giới thiệu từ quan hệ hiện có (VI)**

Chào {{ten}}, mình đang hoàn thiện bước đánh giá luồng phục vụ cho MEKONIQ. Nhóm muốn trao đổi với chủ hoặc quản lý nhà hàng phục vụ tại bàn có nhiều lượt bếp–bàn, để hiểu cách xử lý khi việc giao bị gián đoạn. Demo hiện là mô phỏng; chưa chào bán robot hay hứa tiết kiệm nhân sự. Nếu bạn biết một người phù hợp và thấy thuận tiện, bạn có thể chuyển đoạn giới thiệu này để họ tự quyết định liên hệ tại {{link_lich}}. Cảm ơn bạn.

**O2 — Buyer đã đồng ý nhận thông tin (VI)**

Tiêu đề: Mô phỏng và buổi đánh giá luồng phục vụ cho {{quan}}

Chào {{ten}}, cảm ơn anh/chị đã đồng ý nhận thông tin. MEKONIQ đang đánh giá cách nối trạng thái giữa bếp, công việc giao và người xử lý khi có ngoại lệ. Đây là bản demo mô phỏng 4 phút: {{link_demo}}.

Nếu phù hợp với vấn đề của {{quan}}, đề nghị buổi 30 phút với người phụ trách vận hành. Đầu ra buổi đầu là chọn một luồng cần đánh giá và những thông tin còn thiếu; không yêu cầu quyết định mua thiết bị. Anh/chị có thể chọn lịch tại {{link_lich}} hoặc phản hồi thời gian tiện. Nếu không cần theo dõi thêm, chỉ cần nói để chúng tôi dừng liên hệ.

**O3 — Partner Nhật (JA; dùng sau giới thiệu/cho phép)**

件名：MEKONIQ — 飲食店向けロボット連携の検討について

{{ten}}様

ご紹介の機会をいただき、ありがとうございます。MEKONIQは、飲食店の業務とロボットの運用をつなぐプラットフォームを開発しています。現在はWebシミュレーションを使い、配膳の状態管理やトラブル時の対応を具体的に確認する段階です。

特定の機種について、APIの利用条件、店舗側の業務、現地サポートの役割分担を一緒に検討できるパートナーを探しています。現時点で実機との互換性や導入効果を保証するものではありません。

まずは30分程度、対象となる構成とお客様の課題について意見交換できれば幸いです。デモ：{{link_demo}}。ご都合のよい日時をご返信いただくか、{{link_lich}}をご利用ください。

**O4 — Partner English**

Subject: Exploring one restaurant workflow integration with MEKONIQ

Hello {{ten}}, thank you for agreeing to receive this introduction. MEKONIQ connects restaurant workflows with robot orchestration. Our web simulation helps operators and engineers inspect a delivery workflow, an exception and the recorded outcome.

We would like to explore one configuration with a partner who can support hardware and local operations. The first discussion would cover a qualified venue, API access and support responsibilities. We have not claimed compatibility or physical performance for your equipment.

Here is the simulation: {{link_demo}}. If this is relevant, we can arrange a 30-minute technical discovery at {{link_lich}}. Please let us know if you would prefer no further follow-up.

### Nurture chỉ cho người đã đồng ý nhận chuỗi

**N1, ngay sau opt-in — “Bản demo và cách xem”**: “Cảm ơn bạn đã đăng ký nhận tài liệu MEKONIQ. Bắt đầu với demo {{link_demo}}: xem lượt giao, tình huống lỗi và bản ghi. Chế độ simulation/replay luôn được ghi rõ. Nếu muốn đánh giá một luồng của quán, đặt lịch {{link_lich}}. Bạn có thể hủy chuỗi tại {{link_huy}}.”

**N2, ngày 3 — “Một câu hỏi cho quản lý ca”**: “Khi món chưa được xác nhận đã nhận, ai có quyền quyết định bước tiếp theo ở quán bạn? Câu trả lời này giúp chọn phạm vi đánh giá tốt hơn việc bắt đầu từ model robot. Nếu có một tình huống gần đây, hãy mô tả mà không kèm dữ liệu cá nhân thực khách; chúng tôi có thể cùng trao đổi trong buổi {{link_lich}}. Hủy đăng ký: {{link_huy}}.”

**N3, ngày 7 — “Checklist trước pilot”**: “Một pilot cần tuyến, tải, baseline, người giám sát, cách chuyển thủ công và quyền dừng. Mô phỏng giúp mô tả; thiết bị và hiện trường cần kiểm riêng. Nếu bạn muốn cùng đi qua checklist, đặt buổi đánh giá {{link_lich}}. Hủy đăng ký: {{link_huy}}.”

**N4, ngày 14 — “Có nên tiếp tục trao đổi?”**: “Chúng tôi kết thúc chuỗi giới thiệu tại đây. Nếu vấn đề bếp–bàn là ưu tiên, bạn có thể đặt buổi {{link_lich}}; nếu chưa, không cần phản hồi. Chúng tôi sẽ không tự mở thêm chuỗi từ việc bạn đã xem demo. Hủy đăng ký mọi email marketing: {{link_huy}}.”

Mỗi lead chỉ một chuỗi; dừng khi book meeting, từ chối, unsubscribe hoặc đang trao đổi trực tiếp. Không coi email open là tín hiệu qualified. Meeting recap là thư trả lời giao dịch riêng, không chèn thêm newsletter khi chưa có phép.
