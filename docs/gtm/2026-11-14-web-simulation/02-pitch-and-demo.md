# 02 — Pitch và demo

**Hiện trạng kỹ thuật16/11:** đọc[08—readiness theo bằng chứng cuối](08-final-engineering-readiness.md) trước khi dùng pitch/claim. Source981/Labd4 đã được đo lại; drawing/pause/public capture validity chưa đạt. Guided replay4phút không phải full live1×; D0, host/native/hardware và quyền publish/spend vẫn riêng. Các snapshot cũ bên dưới giữ ngày/tuple lịch sử.


Bản dùng **sau D0**, chỉ khi các cảnh được nhắc đã qua checklist [06](06-measurement-and-launch.md). Trước D0 dùng “chúng tôi đang hoàn thiện mô phỏng” và mời buổi xem nội bộ có hướng dẫn. Toàn bộ số lượng khách, giá và kết quả kinh doanh phải lấy dữ liệu thật trước khi thêm vào deck.

## Bài nói 30 giây

“MEKONIQ kết nối cách nhà hàng nhận món, chuyển việc cho bếp và tổ chức giao tới bàn. Chúng tôi bắt đầu từ câu hỏi rất cụ thể: khi một chuyến giao bị gián đoạn, ai biết chuyện gì đã xảy ra và cần làm gì tiếp? Trong Robot Lab, anh chị có thể xem mô phỏng, thử một tình huống lỗi và xem lại kết quả. Bước tiếp theo là cùng đánh giá một luồng phục vụ tại quán, trước khi quyết định có phù hợp để pilot với thiết bị thật hay không.”

## Bài nói 2 phút

“Trong một ca đông khách, hoàn thành món ở bếp mới là một phần của công việc. Món cần đến đúng bàn; nhân viên cần biết đã xếp khay nào, đã giao hay chưa và khi khách báo nhầm thì ai xử lý. Nếu nhà hàng dùng nhiều màn hình và một robot riêng, nhóm cần thống nhất những trạng thái này. Chúng tôi muốn kiểm chứng vấn đề ấy tại những quán có nhiều lượt vận chuyển, chứ không mặc định quán nào cũng cần robot.

MEKONIQ là nền tảng vận hành nhà hàng và điều phối robot. Phần mềm được thiết kế nối order, bếp, giao món và ghi nhận vận hành. Khi phù hợp, nhân viên vẫn là người giao và xác nhận. Thiết kế nhiều tablet có đường phối hợp qua LAN khi WAN mất; khi các thiết bị không liên lạc được, quyền thao tác và phục hồi có giới hạn rõ. Những khả năng đó cần được nghiệm thu trên thiết bị và cấu hình thực tế.

Hôm nay chúng tôi giới thiệu Robot Lab: môi trường mô phỏng để cùng nhìn một quy trình. Trong khoảng bốn phút, chúng ta xem một lượt giao, một tình huống gián đoạn và bản ghi để giải thích kết quả. Đây là mô phỏng, chưa phải chứng nhận robot hay lời hứa tiết kiệm chi phí.

Nếu câu chuyện gần với ca làm của anh chị, đề nghị bước tiếp theo là một buổi đánh giá 30 phút. Chúng ta chọn một tuyến, một điểm giao và cách đo hiện tại; sau đó mới quyết định có cần khảo sát và pilot có giám sát. Anh chị sẽ có đầu ra rõ ràng: phạm vi phù hợp, điều chưa biết, chi phí cần xác minh và tiêu chí để tiếp tục hoặc dừng.”

## Bài nói 5 phút — kèm điểm chuyển demo

**0:00–0:45.** “Hãy hình dung bếp vừa hoàn thành hai món cho hai bàn. Một món đã đặt lên khay, món còn lại đang chờ. Trong lúc đó, khách đổi yêu cầu và đường giao bị gián đoạn. Điều quản lý cần biết là món nào đang ở đâu, trạng thái nào đã xác nhận và ai chịu trách nhiệm cho bước tiếp theo. Chúng tôi dùng tình huống này để nói về MEKONIQ: một nền tảng vận hành nhà hàng và điều phối robot, với trọng tâm đầu tiên là luồng từ bếp đến bàn.”

**0:45–1:30.** “Chúng tôi đang chọn một nhóm nhỏ nhà hàng phục vụ tại bàn để kiểm chứng nhu cầu. Có thể quán đã có POS tốt và chỉ cần tổ chức việc giao. Có thể vấn đề là quy trình giữa nhân viên và bếp, và robot chưa phải ưu tiên. Buổi trao đổi bắt đầu từ ca phục vụ gần nhất và cách quán đang xử lý. Phạm vi của nền tảng bao gồm menu, POS, QR, bếp, thanh toán, kho và điều phối; phạm vi triển khai phải được chọn theo nhu cầu và bằng chứng readiness của từng module.”

**1:30–2:15.** “Đây là MEKONIQ Robot Lab. Dòng ‘mô phỏng’ và chế độ live hoặc replay luôn hiển thị. Chúng ta sẽ xem một chuyến có đầu vào được ghi lại, trạng thái công việc và kết quả. Người xem không phải hiểu MuJoCo hay giao thức robot để theo dõi câu chuyện. Các chi tiết kỹ thuật vẫn có sẵn cho đội tích hợp kiểm tra. Nếu xem bản replay, đây là dữ liệu từ một lần chạy đã ghi; nó không điều khiển bất kỳ thiết bị thật nào.”

**2:15–3:00.** “Ở lượt chạy thứ hai, chúng ta dùng một tình huống lỗi đã kiểm thử trong bản phát hành này. Điểm cần quan sát là hệ thống không biến việc chưa xác nhận thành hoàn tất. Chúng ta xem trạng thái, lý do dừng hoặc cần xử lý, rồi mở timeline để nhìn các sự kiện liên quan. Nếu demo gặp lỗi ngoài kịch bản, tôi sẽ ghi nhận và mở bản ghi dự phòng, thay vì nói rằng hệ thống đã xử lý thành công.”

**3:00–3:45.** “Cách làm này giúp buổi trao đổi cụ thể hơn. Quản lý có thể hỏi: trong quán tôi ai bấm xác nhận, khi nào người khác tiếp quản, điều gì phải ghi vào báo cáo ca? Đội kỹ thuật có thể hỏi: phần nào là logic nghiệp vụ, phần nào phụ thuộc thiết bị, và cần thêm bằng chứng nào? Mô phỏng tạo một tình huống chung để thảo luận. Hiệu quả thật về thời gian, số lần can thiệp và chi phí vẫn cần đo trên ca vận hành thực tế.”

**3:45–4:30.** “Chúng tôi chưa chốt phần cứng cho mọi khách. Có hướng robot từ hãng, có hướng phần cứng tùy biến; mỗi model và cấu hình đều cần kiểm riêng. Lab không phát lệnh robot thật. Lộ trình tới pilot gồm đánh giá địa điểm, kiểm tương thích, nghiệm thu native và thiết bị, chuẩn bị người vận hành, rồi mới chạy trong phạm vi được giám sát. Việc mô phỏng đạt không bỏ qua các bước này. Kinh phí phần mềm, tích hợp, thiết bị và bảo trì cũng được tách để quán hiểu tổng chi phí.”

**4:30–5:00.** “Đề nghị của chúng tôi hôm nay là chọn một luồng có vấn đề rõ và một người vận hành cùng đánh giá. Sau buổi discovery và khảo sát nếu cần, hai bên quyết định phạm vi pilot, các chỉ số so với baseline và quyền dừng. Nếu giải pháp không phù hợp, báo cáo phải nói rõ điều đó. Nếu phù hợp, chúng ta mới bàn điều khoản và thiết bị cụ thể. Bước tiếp theo là buổi đánh giá 30 phút với quản lý vận hành.”

## Storyboard deck 12 slide

Dùng 6 slide 1–6 cho buyer bận; deck đầy đủ 10–15 phút cộng demo. Visual là ảnh thực từ release hoặc sơ đồ có nhãn, không dùng render robot để ngụ ý đã có hardware.

| # | Headline | Nội dung trên slide | Bằng chứng / hình | Speaker notes |
|---|---|---|---|---|
| 1 | Từ bếp đến bàn, mỗi bước có trạng thái rõ ràng | MEKONIQ Restaurant Platform; “Web simulation • đang tìm design partner phù hợp” | Ảnh Lab đúng release, nhãn simulated | Nói buyer/use case; hỏi họ đang dùng người hay robot để giao |
| 2 | Một chuyến giao có nhiều điểm cần xác nhận | Bếp sẵn sàng → xếp khay → tới bàn → nhận món → xử lý ngoại lệ | Sơ đồ; các pain ghi “giả thuyết phỏng vấn” | Mời khách sửa quy trình; không kể như đã khảo sát |
| 3 | Bắt đầu ở một luồng, một địa điểm | Chuỗi nhỏ; điểm pilot; quản lý ca; đo baseline | Phiếu chọn site mẫu, không logo khách giả | Giải thích tại sao không rollout toàn chuỗi ngay |
| 4 | Một nền tảng, phạm vi bật theo readiness | Order/KDS/fulfillment; module quản trị; giao thủ công hoặc robot | Capability map phân biệt local/planned/hardware | Tránh đọc 30 tính năng; chỉ chỉ ra phần liên quan |
| 5 | Cùng xem một tình huống trong Lab | Run/replay → fault → timeline → đầu vào đã khóa | Demo 4 phút; nguồn release và run ID | Nói “mô phỏng” trước khi click; hardware không bị điều khiển |
| 6 | Kết quả chưa rõ phải được giữ nguyên | Trạng thái chưa xác nhận, lý do cần người xử lý, replay | Cảnh đã được engineering duyệt, không fault giả | Kết nối sự trung thực của trạng thái với trách nhiệm ca; không gọi đây là chứng nhận an toàn |
| 7 | Pilot phải chứng minh giá trị tại quán | Baseline; thời gian giao; can thiệp; hoàn tất; support hours | Mẫu biểu trống có đơn vị | Không điền số đẹp; cùng chọn ngưỡng từ baseline |
| 8 | Giữ lựa chọn thiết bị, kiểm từng cấu hình | OEM/integrator; xArm/ROS 2; custom/PUMA/LinuxCNC | Hai nhánh kỹ thuật, cổng riêng | Arm là lộ trình R&D; không yêu cầu nhà hàng mua tay máy để thử Serve |
| 9 | Chi phí tách rõ trước khi quyết định | Discovery, integration, SaaS, hardware/service | Bảng cấu phần, giá chỉ đưa khi scope đã chốt | Không dùng BOM cũ. Buyer biết khoản nào định kỳ, khoản nào một lần |
| 10 | Từ demo tới pilot qua các cổng | Đánh giá → site → technical → supervised pilot → review | Timeline theo gate, không ngày hứa cứng | Nếu thiếu robot/host, dừng đúng gate; vẫn có báo cáo discovery |
| 11 | Đối tác giữ vai trò rõ | Buyer: luồng và baseline; MEKONIQ: workflow; integrator: thiết bị/hiện trường | RACI giản lược | Không đặt logo đối tác chưa có quan hệ; yêu cầu một chủ sở hữu hỗ trợ |
| 12 | Chọn một luồng để đánh giá | CTA 30 phút; yêu cầu mô hình quán, POS, tuyến giao, người phụ trách | QR/link chỉ sau khi có landing/form thật | Kết thúc với bước cụ thể, không tạo áp lực ký mua robot |

## Demo 4 phút và phương án dự phòng

**Asset R2a đã có, dùng đúng phạm vi:** [hướng dẫn demo R2a](../../../artifacts/mekoniq-r2a-demo-guide.html) mở offline để đi qua UI/ảnh và cách nối web hoặc local. [Record production](../../implementation/evidence/production/r2a-2026-11-14/README.md) chứng minh lần Chrome tự động chạy arm `MJ-BV01` tới tick 4810, phục vụ 2; không chứng minh kịch bản Serve có tải hoặc arm→AMR chung world của R2b đã hoàn tất. Có thể dùng walkthrough này cho buổi discovery hiện tại và nói rõ đang xem tài liệu R2a. Không gọi nó là replay runtime, và không suy lần kiểm đã ghi thành cam kết live luôn sẵn sàng.

**Mặc định là Serve một AMR có tải** nếu đã có web UI/replay đạt. Cảnh arm→AMR chỉ đưa vào khi gate shared-world đã đạt; không thay bằng video ghép và gọi là một world.

**Thời lượng theo bằng chứng mới:** 4 phút là khung dẫn demo, không phải cam kết chạy xong một lượt live từ tick0. B07b đang review; phép đo local mới có nhịp Source khoảng0,498× và chưa đạt mục tiêu vẽ. Với bản này, chuẩn bị bản ghi đã kiểm và chọn các mốc timeline, nói rõ khi chuyển cursor hoặc đổi run/mode. Nếu khách muốn xem live toàn lượt, mở phần riêng có thời lượng dự kiến được đo trên release/máy dùng demo; không tăng tốc video hoặc bỏ nhãn thời gian để ngụ ý realtime.

| Thời gian | Thao tác | Lời dẫn / bằng chứng |
|---|---|---|
| 0:00–0:25 | Hiện nhãn simulation, mode, release và preset | “Đây là một mô hình được kiểm thử trong phạm vi ghi trên màn hình. Chúng ta đang xem live simulation/replay.” |
| 0:25–1:10 | Chọn preset đã duyệt, chạy hoặc mở run chuẩn | “Đây là đầu vào của chuyến: điểm đi, điểm đến và tải. Theo dõi trạng thái nghiệp vụ cùng chuyển động.” |
| 1:10–1:45 | Trong replay, chọn mốc kết thúc và giải thích xác nhận; live chưa xong thì giữ đúng trạng thái | “Chuyển động tới vị trí và xác nhận nghiệp vụ là các điều kiện riêng.” Chỉ nói hành vi release chứng minh được |
| 1:45–2:45 | Mở fault preset được duyệt; không tùy ý sửa model tại chỗ | “Tình huống này buộc chúng ta xem kết quả chưa rõ/lỗi. Đây là phần người vận hành phải hiểu.” Hiện reason thực |
| 2:45–3:30 | Timeline/replay, đầu vào/đầu ra, coverage nếu được expose | “Bản ghi giúp xem lại; mô hình còn chưa hiệu chuẩn máy thật.” Không so sánh cross-engine bằng ranking |
| 3:30–4:00 | Chuyển sang phiếu site fit | “Tình huống nào giống quán mình? Đánh giá một tuyến trước khi bàn pilot.” |

Fault cụ thể do engineering chọn từ case thực có report; mất ACK chỉ dùng nếu được UI và reporter hỗ trợ, không tự giả lập một nút chưa có. Chưa có fault live thì phát replay lỗi đã kiểm và nói rõ đổi mode. Runtime busy, mất mạng hoặc demo không chạy: trong 15 giây chuyển replay offline cùng release; ghi lỗi demo vào log; không nối hai run thành một run. Replay hỏng, chưa đóng gói hoặc không có bằng chứng: dùng sơ đồ hoặc guide R2a offline đã dẫn, nói “đây là tài liệu minh họa; hiện chưa thể chạy/replay kịch bản này”, giữ CTA discovery và không tuyên bố pass. Guide không thay replay cùng release trong checklist D0.

## Pitch đối tác — 60 giây

“MEKONIQ đang tìm một đối tác triển khai cho luồng phục vụ nhà hàng, bắt đầu từ địa điểm và thiết bị có phạm vi rõ. Chúng tôi đóng góp workflow, trạng thái nghiệp vụ và mô phỏng để thống nhất yêu cầu. Đối tác đóng góp khả năng tiếp cận thiết bị, API được phép, bảo trì và người hỗ trợ hiện trường. Hai bên kiểm tra một cấu hình trước khi chào pilot; chưa có giả định mọi robot đều tích hợp được. Buổi đầu đề nghị rà ba nội dung: một khách phù hợp, điều kiện kỹ thuật của model và cách chia trách nhiệm khi có sự cố. Phí giới thiệu, tích hợp và bảo trì sẽ tách riêng sau khi hiểu công việc.”

## Phụ lục investor — chỉ dùng nếu có nhu cầu gây vốn

Narrative: “Chúng tôi đang kiểm chứng một lớp workflow kết nối vận hành nhà hàng với robotics, dùng web simulation để làm rõ hành vi trước deployment. Mốc tiếp theo là chứng minh người mua trả tiền cho một vấn đề cụ thể và có thể triển khai với chi phí hỗ trợ chấp nhận được.”

4 slide bổ sung: (A) giả thuyết khách hàng + dữ liệu discovery khi có; (B) capability/evidence ladder cùng giới hạn; (C) kinh tế một site và sensitivity ở [03](03-gtm-and-commercial.md); (D) mốc cần vốn: hardware/vendor access, native validation, supervised pilot và support. Chưa có số tiền gọi vốn, định giá, traction hoặc exit claim; founder phải cung cấp runway, cap table, đội và ngân sách kỹ thuật trước khi biến thành deck gây vốn. Không dùng danh sách mục tiêu 120 account làm pipeline đã xác nhận.

## Sales sheet một trang — bản copy

**MEKONIQ Serve trên MEKONIQ Restaurant Platform**  
**Từ bếp đến bàn, mỗi bước đều có trạng thái rõ ràng.**

Dành cho nhóm vận hành nhà hàng phục vụ tại bàn đang đánh giá cách phối hợp bếp, nhân viên và robot. Bắt đầu bằng một mô phỏng có hướng dẫn: xem chuyến giao, tình huống gián đoạn và bản ghi kết quả. Đội cùng xác định ai xác nhận mỗi bước và khi nào cần người xử lý.

**Buổi đánh giá giúp xác định:** một luồng ưu tiên; điều kiện địa điểm; POS/thiết bị liên quan; dữ liệu baseline; những kiểm chứng còn thiếu; phạm vi và chi phí dự kiến cho bước tiếp theo.

**Lộ trình:** demo mô phỏng → discovery → khảo sát phù hợp → kiểm chứng thiết bị và cấu hình → pilot có giám sát → review theo dữ liệu. Lab luôn là môi trường mô phỏng. Hiệu quả chi phí, tương thích thiết bị và an toàn hiện trường cần bằng chứng riêng.

**Chuẩn bị cho buổi trao đổi:** người quản lý ca; mô tả tuyến bếp–bàn; POS/robot nếu đang dùng; một tình huống gần đây cần xử lý thủ công. Không cần gửi thông tin cá nhân của thực khách.

**CTA:** Đặt buổi đánh giá luồng phục vụ 30 phút. Giá phần mềm, tích hợp và thiết bị được tách sau khi xác định phạm vi.

## Phản đối và câu trả lời

| Câu hỏi | Câu trả lời dùng được |
|---|---|
| “Chỉ là mô phỏng?” | “Đúng. Nó giúp cùng kiểm tra hành vi trong mô hình và thống nhất câu hỏi. Pilot thiết bị thật có cổng riêng; chúng tôi chưa lấy kết quả này làm bằng chứng hiệu quả tại quán.” |
| “Quán đã có POS.” | “Hãy bắt đầu từ phần còn vướng. Thiết kế có preset robot-only; kết nối POS hiện tại cần kiểm API, quyền và dữ liệu trước khi cam kết.” |
| “Robot hãng đã có app.” | “Đúng. Nếu app hiện tại đáp ứng đủ, chưa có lý do thêm hệ thống. Ta cần xác định phần phối hợp hoặc ngoại lệ chưa được giải quyết và giá trị của việc nối nó.” |
| “Tiết kiệm bao nhiêu nhân viên?” | “Chưa có số đáng tin cho quán này. Pilot đo thời gian và can thiệp theo ca, sau đó tính chi phí thay đổi thực; không quy mọi phút tiết kiệm thành nhân sự cắt giảm.” |
| “Có chạy mất mạng không?” | “Thiết kế phân biệt mất WAN, mất LAN và bảo trì toàn bộ. Tác vụ/provider có giới hạn riêng; cần thử trên tablet và mạng dự kiến của quán.” |
| “Dùng mọi robot được?” | “Mỗi model/firmware/adapter phải kiểm khả năng và nghiệm thu. Xin model cụ thể để đánh giá; chúng tôi không hứa tương thích chung.” |
| “Giá robot 30 triệu?” | “Con số trong bản ý tưởng cũ là dự toán thiếu nhiều khoản, không phải báo giá. Giá hiện tại chỉ lập sau khi chốt thiết bị, tích hợp, bảo hành và hỗ trợ.” |
| “Có an toàn cho trẻ em và đồ nóng không?” | “Demo không chứng minh điều đó. Phạm vi pilot chỉ được mở sau đánh giá thiết bị/hiện trường và người chịu trách nhiệm ký; giai đoạn đầu đề xuất tải nguội và khu kiểm soát.” |
| “Bao giờ có thể mua?” | “Có thể thảo luận đánh giá/design engagement theo phạm vi. Ngày vận hành thật phụ thuộc các gate còn thiếu, không chốt từ lịch marketing.” |
