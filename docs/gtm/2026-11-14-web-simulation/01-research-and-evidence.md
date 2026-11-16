# 01 — Nghiên cứu thị trường và sổ bằng chứng

**Hiện trạng sau N1, 16/11:** đọc [09 — readiness mới](09-post-n1-engineering-readiness.md) và [kết quả actual](../../implementation/web-lab-to-physical/post-n1-final-recording/status.md). Source `0d46403` / Lab `7c97b20`; capture mới invalid và bốn assertions mock chưa giải quyết, guided replay bốn phút khác live 1×, D0/native/phần cứng còn mở. Các số liệu và ghi chú trước đó bên dưới là snapshot theo ngày/tuple lịch sử.


Ngày kiểm: 14/11/2026. Nhãn: **F** = điều quan sát được từ nguồn, **I** = suy luận chiến lược, **H** = giả thuyết cần khảo sát. Nguồn của hãng chứng minh hãng công bố điều gì; không phải kiểm chứng độc lập về hiệu quả. Không có dữ liệu khách hàng MEKONIQ được suy từ khách hàng của hãng khác.

## Sổ nguồn công khai

| ID | Nguồn chính thức, ngày công bố khi biết | Phát hiện có thể dùng | Giới hạn / hệ quả |
|---|---|---|---|
| E01 | [iPOS/Nestlé, báo cáo 1H2026](https://ipos.vn/ipos-vn-va-nestle-professional-cong-bo-bao-cao-thi-truong-kinh-doanh-am-thuc-tai-viet-nam-6-thang-dau-nam-2026/), 10/09/2026 | F: có báo cáo nửa đầu 2026 và diễn đàn F&B tại Việt Nam; thông cáo nhấn mạnh cơ hội không đồng đều giữa các cửa hàng | Nghiên cứu do nhà cung cấp ngành thực hiện; không dùng doanh thu F&B làm TAM phần mềm/robot. I: nội dung nên nói về vận hành từng điểm và khả năng đo hiệu quả |
| E02 | [iPOS/Nestlé, báo cáo 2025](https://ipos.vn/thong-cao-bao-chi-ipos-vn-va-nestle-professional-cong-bo-bao-cao-thi-truong-kinh-doanh-am-thuc-tai-viet-nam-nam-2025/), trang 09/04/2026, sự kiện 08/04 | F: nghiên cứu 3.001 chủ nhà hàng/café và 3.045 thực khách theo thông cáo | Là số mẫu khảo sát, không phải khách MEKONIQ, số nhà hàng phù hợp hay market size |
| E03 | [JF, tháng 09/2026](https://www.jfnet.or.jp/wp/wp-content/uploads/2026/10/getujidata-2026-9.pdf), 26/10/2026 | F: mẫu thành viên gồm 228 công ty, 36.827 cửa hàng; doanh thu toàn mẫu 107,3% cùng kỳ | Dữ liệu toàn cửa hàng của thành viên, không đại diện mọi quán Nhật; doanh thu tăng không chứng minh sẵn sàng mua robot |
| E04 | [Recruit, thị trường ăn ngoài 09/2026](https://www.hotpepper.jp/ggs/research/article/marketing/202609), 30/10/2026 | F: nghiên cứu ba vùng đô thị ghi 2.770億 JPY, tương đương 277 tỷ JPY, giảm cùng kỳ | Khác phạm vi/phương pháp với JF; không gộp hay chọn riêng số thuận lợi để kể chuyện tăng trưởng |
| E05 | [Mmenu](https://mmenu.io/vn/vi), trang hiện hành không ghi ngày | F: công bố order, bếp/bar, khách hàng, kho, báo cáo, QR/Zalo và hỗ trợ đa ngôn ngữ | Không thấy giá chuẩn đủ điều kiện trong trang đã đọc. Không được nói MEKONIQ là sản phẩm duy nhất nối đơn với bếp |
| E06 | [KiotViet phí dịch vụ](https://www.kiotviet.vn/phi-dich-vu), trang hiện hành | F: mục ăn uống/giải trí hiển thị 270.000/330.000/490.000 VND cho ba gói, bảng quản lý theo chi nhánh/tháng và điều kiện tính năng | Chỉ là mức niêm yết kiểm tại ngày này, cần xác nhận kỳ thanh toán, VAT, khuyến mại, thiết bị và cấu hình trước báo giá so sánh. Không lấy giá bán lẻ ở tab khác làm giá F&B |
| E07 | [AirREGI phí](https://airregi.jp/jp/cost/), trang hiện hành | F: tính năng POS cơ bản và hỗ trợ 0 JPY; thiết bị tính riêng, có một số chức năng trả phí; AirREGI Order có cấu phần riêng | Không được nói mọi vận hành nhà hàng Nhật miễn phí. I: định vị bằng POS giá rẻ khó tạo khác biệt |
| E08 | [Smaregi](https://smaregi.jp/price/), đọc đầu trang thành công, lần đọc lại 403 | F: trang giới thiệu order entry, mobile order, API/liên kết hệ thống và các gói | Không trích giá vì chưa đối chiếu ổn định phần bảng. Đánh dấu cần refresh trước bất kỳ battle card giá nào |
| E09 | [PUDU BellaBot](https://www.pudurobotics.com/en/products/bellabot), trang hiện hành | F: hãng công bố robot giao món, cảm biến khay, gọi từ app/nút/đồng hồ và PUDU Link quản lý robot; có liên kết Open Platform | Link developer không chứng minh MEKONIQ có quyền API, tương thích hay quan hệ đối tác. Chưa có báo giá địa phương đủ cấu hình |
| E10 | [SoftBank/Bear Servi Q](https://www.softbankrobotics.com/jp/news/press/20260928a/), 28/09/2026 | F: công bố bắt đầu bán Servi Q ở Nhật ngày 28/09/2026 | I: đối thủ tiếp tục cải tiến và có kênh phân phối. Không gọi thị trường Nhật là “chưa có ai làm” |
| E11 | [SoftBank BellaBot](https://www.softbankrobotics.com/jp/product/delivery/bellabot/) và [hỗ trợ sản phẩm](https://www.softbankrobotics.com/jp/product/contact/), trang hiện hành | F: có sản phẩm, tư vấn và đường hỗ trợ theo model | Giá phải hỏi theo hợp đồng. Chỉ là tên đối tác tiềm năng/người bán hiện hữu, chưa là partner MEKONIQ |
| E12 | [USEN Robotics](https://usen.com/service/robot/), trang hiện hành | F: giới thiệu các model robot giao/vận chuyển/dọn dẹp của nhiều hãng | I: integrator/distributor có thể bán, triển khai và hỗ trợ; cần khám phá động cơ hợp tác thay vì mặc định họ cần phần mềm mới |
| E13 | [MuJoCo overview](https://mujoco.readthedocs.io/en/stable/overview.html) | F: engine mô phỏng vật lý và tiếp xúc phục vụ kỹ thuật | Là thành phần kỹ thuật, không phải đối thủ bán POS cho chủ quán |
| E14 | [NVIDIA Isaac Sim](https://developer.nvidia.com/isaac/sim), trang hiện hành | F: framework mô phỏng/test/synthetic data cho robotics | Thay thế kỹ thuật khi integrator tự xây demo/test; không cùng quyết định mua với một nhà hàng thuê dịch vụ |
| E15 | [UFACTORY ROS 2](https://github.com/xArm-Developer/xarm_ros2) | F: hãng duy trì package ROS 2 cho robot của mình | Không chứng minh profile MEKONIQ đã nghiệm thu xArm thật |
| E16 | [LinuxCNC kinematics](https://linuxcnc.org/docs/stable/html/motion/kinematics.html) | F: mô tả mapping joint/axis và động học cho các cấu hình máy | Không chứng minh PUMA tham chiếu tương đương tay máy tự chế hoặc đã an toàn |
| E17 | [Google Customer Match](https://support.google.com/adspolicy/answer/6299717?hl=en) | F: yêu cầu dữ liệu first-party và điều kiện tài khoản; một số quyền targeting cần lịch sử/spend riêng | Kế hoạch không giả định tài khoản MEKONIQ đủ điều kiện. Không mua danh sách để tải lên |
| E18 | [Google lead forms](https://support.google.com/google-ads/answer/9423234?hl=en) | F: yêu cầu privacy policy; điều kiện ngành/tài khoản và một số định dạng có xác minh riêng | Dùng landing page trước; eligibility phải kiểm lại lúc mở tài khoản. Không hứa bật mọi định dạng ngay |

Không dẫn số tiết kiệm của đối thủ thành kỳ vọng của MEKONIQ. Không dùng tài liệu bên thứ ba về trợ cấp Nhật làm cơ sở giá; chưa xác minh sản phẩm đủ điều kiện trợ cấp, vì vậy đề xuất không tính trợ cấp vào business case.

## Việt Nam và Nhật — quyết định gia nhập

| Tiêu chí | Việt Nam | Nhật | Kết luận hiện tại |
|---|---|---|---|
| Khả năng tiếp cận/support | H: có thể thuận lợi nếu founder/đội ở VN; website hiện có tiếng Việt | H: cần người nói Nhật và onsite partner thực sự | Chọn theo năng lực có thật, không chỉ theo quy mô thị trường |
| Cạnh tranh phần mềm | F: Mmenu, KiotViet, iPOS đã có bộ module rộng [E05/E06/E02] | F: AirREGI, Smaregi có hệ sinh thái hiện hữu [E07/E08] | Không lấy “all-in-one” làm lợi thế đã chứng minh |
| Robot và triển khai | Phải tìm hãng/đại lý có phụ tùng, API và người bảo trì tại địa bàn; chưa xác thực đối tác cụ thể | F: SoftBank/USEN công khai sản phẩm và hỗ trợ [E10–E12] | Nhật có lựa chọn mua đã tồn tại; partner route hợp lý để khám phá |
| Giá trị khách mua | H: giảm thao tác phối hợp, kiểm ngoại lệ và chi phí triển khai có thể quan trọng hơn robot đẹp | H: vận hành ổn định, integration, hỗ trợ Nhật có thể là điều kiện tiên quyết | Phỏng vấn về ca gần nhất và hóa đơn chi phí, không hỏi “anh/chị thích AI không?” |
| Tốc độ học | H: một địa bàn VN giúp thăm site và lặp quy trình nhanh nếu có đội tại đó | H: chậm hơn nếu phụ thuộc dịch/đối tác; có thể nhanh hơn nếu sẵn buyer champion | VN-first là giả thuyết về execution advantage, không kết luận VN hấp dẫn hơn tuyệt đối |
| Điều kiện đổi lựa chọn | Không tìm được site hợp, không có buyer hoặc ngân sách | Có 1 partner cam kết kỹ thuật/support và 2 nhà hàng phù hợp sẵn đánh giá | Founder xem lại ở ngày 30; không triển khai hai thị trường đầy đủ cùng lúc |

## Đối thủ trong quyết định mua thật

| Quyết định của buyer | Lựa chọn thay thế | Điểm cần tôn trọng | Câu hỏi để MEKONIQ chứng minh giá trị |
|---|---|---|---|
| Cần phần mềm nhà hàng | Mmenu/iPOS/KiotViet; AirREGI/Smaregi ở Nhật | Module, hỗ trợ, dữ liệu, thiết bị đã quen | Vấn đề còn lại nằm ở vận chuyển/ngoại lệ hay chỉ là cấu hình POS? |
| Cần bớt việc vận chuyển | Robot PUDU/Bear qua nhà phân phối; dùng app gọi robot đi kèm | Robot và công cụ gọi/quản lý đã có | Nhà hàng có thực sự cần nối mission với order và xử lý ngoại lệ không? |
| Muốn giữ cách vận hành | Nhân viên mang món, xe đẩy, đổi bố trí trạm, gọi qua bộ đàm | Rẻ hơn hoặc phù hợp hơn trong một số mặt bằng | Có nút thắt đo được đủ lớn để thử công nghệ không? |
| Muốn tích hợp robot | Integrator viết connector/custom workflow | Có quan hệ và hiểu site; có thể vừa partner vừa đối thủ | MEKONIQ giảm bao nhiêu công tích hợp thực đo, ai sở hữu hỗ trợ? |
| Muốn thử kịch bản kỹ thuật | MuJoCo/Isaac Sim và công cụ tự dựng | Engine không phải điểm bán riêng | Replay/workflow có giảm thời gian thống nhất yêu cầu trong thử nghiệm không? |

Chưa có head-to-head conformance hay thử nghiệm tính năng đối thủ. Không gắn ô “không hỗ trợ offline/robot” chỉ vì trang web không nói. Trong discovery, yêu cầu khách mô tả lựa chọn đang dùng, rồi kiểm tài liệu phiên bản cụ thể với sự cho phép của họ.

## Sổ bằng chứng sản phẩm nội bộ

**Refresh chỉ đọc lúc 2026-11-14 01:59 UTC (08:59 ICT):** `source/main` hiện ở `11d25b47a18adafb88ac21adc249499109996bc5`, `lab/main` ở `a7449541e118d01f65af0ad1466e0c963a173f3c`. Đây là HEAD chứa tài liệu cập nhật; deployment production được kiểm dùng source `d1a2522a89f17d0f9d8d2c444975778844f74425`, Lab `a744954…`, runtime pin `4f893ac6fb75dff414a3ee42a726defb7935c734`. Không đồng nhất HEAD tài liệu, commit deployment, pin runtime và worktree R2b đang phát triển.


| ID | Nguồn local | Có thể nói | Không được suy ra |
|---|---|---|---|
| L01 | [source README](../../../README.md), snapshot báo ngày 04/11 | Code W00–W11 trên main, 49 task verified_local, 14 blocked_external tại snapshot đó | Tất cả module production/accepted hoặc số đếm vẫn chính xác ở commit mới |
| L02 | [Capability matrix](../../product/2026-10-30-capability-matrix.md) | Phạm vi và tiêu chí; preset robot-only, no-robot, continuity | Header là trạng thái lúc 30/10; không dùng một mình để quyết định trạng thái hiện tại |
| L03 | [Tiến độ R2b/R3](../../implementation/web-lab-to-physical/design/00-implementation-status.md), 14/11 09:00 ICT | B00/B01/B02/B00R/B03 đã review; một AMR MuJoCo có free payload, lifecycle mất ACK và recorder/metric physics có test local; B04 đang triển khai, physics not_calibrated | Chưa chứng minh web payload UI, replay/public live, shared-world cell hoặc hardware |
| L04 | [R2b spec](../../implementation/web-lab-to-physical/design/02-r2b-web-lab-spec.md) | Đích web: replay, fault, preset; một world arm+AMR; coffee mock | Đây là kế hoạch; không được quay animation rồi gọi là experiment đã chạy |
| L05 | [R3 spec](../../implementation/web-lab-to-physical/design/04-r3-linux-physical-readiness-spec.md) | Hai nhánh chuẩn bị xArm/ROS 2 và custom/PUMA/LinuxCNC | Chưa đóng Linux native/physical commissioning |
| L06 | [Business plan nguồn](../../../artifacts/src/business-plan.js) | Narrative nền tảng; BOM 28,12 triệu được ghi là ước tính ban đầu có nhiều khoản loại trừ | Không được biến 28,12/30 triệu thành giá bán robot, TCO hoặc báo giá hiện hành |
| L07 | [Marketing hiện có](../../../../web/index.html) | Ngôn ngữ Việt, CTA demo/pilot, nhãn concept | Các câu 4 khay, robot khác nhận thay, né vật cản không chuyển thành claim bản mới nếu thiếu evidence |
| L08 | [CL01 Cloud Run](../../implementation/evidence/cloud-run/mekoniq-2026-11-14/README.md), kiểm HTTP 00:55:53.990–00:57:13.606 UTC ngày 14/11 | `MJ-BV01` trên image amd64 Cloud Run hoàn tất tick 4800, phục vụ 2; revision `mekoniq-lab-runtime-00002-9lx`, source/pin `4f893ac…`, Lab lúc kiểm `a6ec316…`; G-CLOUD1 `tested` qua bản bổ sung | `accepted:false`, `not_calibrated`; chưa kiểm restart/scale-to-zero, timeout dài, nhiều người dùng. Run/session trong RAM có thể mất; không chứng minh hardware |
| L09 | [Production R2a](../../implementation/evidence/production/r2a-2026-11-14/README.md) và [browser smoke](../../implementation/evidence/production/r2a-2026-11-14/browser-smoke.json), 01:34:05.057–01:35:34.055 UTC ngày 14/11 | Chrome 157 tự động qua UI HTTPS production tới Cloud Run thật: `MJ-BV01 completed`, tick 4810, phục vụ 2, không page JS error; runtime pin vẫn `4f893ac…` | `accepted:false`, `not_calibrated`; không thay kiểm tay đa trình duyệt HTTPS→runtime local, không mở R2b/B04/shared-world, R3 qualification hoặc physical gate |
| L10 | [R2a demo guide HTML](../../../artifacts/mekoniq-r2a-demo-guide.html), artifact hiện có ở HEAD source trên | Walkthrough VI/JA/EN độc lập, đọc offline, chỉ dẫn đường web/local và ảnh bằng chứng | HTML không chạy simulation, không deploy hoặc gửi lệnh robot. Là tài liệu fallback, không phải offline replay runtime của R2b |
| L11 | [R2b implementation status](../../implementation/web-lab-to-physical/design/00-implementation-status.md), refresh sau review tooling B10/L06 | B04–B09, import B00R2, code chuẩn bị L00–L05 và tooling B10/L06 đã review; tuple tooling `6e5eee9` / `283696b`, bốn lỗi bằng chứng B10 và ba lỗi tương thích dữ liệu L06 đã đóng. Chưa có lượt đo web/container/native mới ở tuple này. Dossier không cấp quyền chạy thật. Native qualification xArm/PUMA vẫn incomplete/not_run. Probe L01 giữ 16 ca native not_run. Handoff prepared:true nhưng nativeReady:false, chưa có host được giao; hồ sơ cloud vẫn là R2a cũ. B09 local ownership/recovery đạt kiểm liên quan; image chưa build, WEB05 not_run. B08 có một X01 thật mỗi engine, producer `709a797`; validator mới chỉ đọc lại dữ liệu đã giữ nguyên. B06 có3nominal served2 và5fault; UI/replay thật và H7 round-trip đã kiểm. Lượt185giây/ZIP H4760 thuộc tuple trước sửaUI `e07685d` / `89b4a38` | Dev evidence `accepted:false`, `not_calibrated`; UI mới chưa đo lại hiệu năng dài. Tuple trước có nhịp vẽ p95 khoảng300ms và Source receipt-span khoảng0,498× chưa đạt. Đây là receipt-observation span có giới hạn clock, không phải mốc commit nội bộ. Chưa đóng D0/hardware; demo4phút cần replay theo mốc hoặc buổi live dài riêng |
| L12 | [Readiness kỹ thuật16/11](08-final-engineering-readiness.md) và [finalrecording](../../implementation/web-lab-to-physical/final-recording-status.md) | Source981/Labd4: production browser1+replay5pass, payload19/cell8, mock/IR và profile-prepared có rawrecords; longcapture0.47188883×/draw300.2ms/worker4.837ms/pause2797.283ms | Public capturevalidity false; native/physical/humanacceptance và D0 vẫn mở. Không chuyển pass của browser thành performance qualification |


L11 cập nhật trạng thái phát triển sau snapshot L03; không viết lại lần ghi R2a hoặc suy thêm bằng chứng deployment. Khi dùng deck/video sau D0, lấy đúng release có UI và replay đã kiểm, không thay recording bằng các chỉ số backend.

**Ý nghĩa cập nhật:** không còn đúng nếu nói mọi demo cloud/live đều chưa có bằng chứng. R2a arm `MJ-BV01` đã được kiểm qua HTTP trên Cloud Run và qua UI HTTPS production trong các lần ghi trên. Tick 4800 của HTTP dùng nhóm bước 50; UI có bước đầu 250 rồi nhóm 20 nên kết thúc 4810. Hai kết quả có phạm vi khác nhau, không sửa tick để ép khớp. Thời gian wall-clock của từng lần gồm mạng/UI/xử lý, không là benchmark CPU hoặc nhịp 1×.

Các record mới không đóng B04 (web payload/report), R2b shared-world/replay packaging, nghiệm thu R3 native đầy đủ (chẳng hạn ma trận nhiều seed/lượt grip), hardware/calibration hoặc D0 marketing. Bản qualification R2a lịch sử không bị viết lại; acceptance vẫn false. Đợt refresh này chỉ đọc record local, không kiểm lại trạng thái live hiện tại, không truy cập khóa và không nhận thêm quyền triển khai/chạy chiến dịch.

Thứ tự khi có mâu thuẫn: evidence của release/commit cụ thể + reviewer signoff → trạng thái implementation cập nhật → spec mục tiêu → slide/website cũ. Engineering owner refresh L03 trước mỗi lần phát hành. Ghi trạng thái `planned`, `tested_local`, `blocked_external`, `accepted_scope` riêng; acceptance một phạm vi không mở mọi phạm vi.

## Không tính TAM bằng cách nhân toàn bộ nhà hàng với giá giả định

Chưa đủ dữ liệu để ước TAM/SAM/SOM đáng bảo vệ. Lập **danh sách có tên 120 account** là nhiệm vụ 90 ngày, không phải ước thị trường. Mỗi account cần URL nguồn công khai, mô hình, số điểm đã xác minh, địa bàn, người mua theo vai trò, nguồn giới thiệu và lý do phù hợp. 120 account × số điểm tiềm năng chỉ là độ phủ danh sách; chưa là ARR.

Sau 30–60 ngày có thể ước bottom-up: số account thực xác minh ở địa bàn × tỷ lệ qua site screen quan sát được × số site được buyer xác nhận × khoảng giá được thử. Báo khoảng và độ thiếu dữ liệu; tách market potential khỏi doanh số có thể phục vụ bởi đội hiện tại. Trước khi dùng số ra ngoài phải kiểm nguồn từng input và thời điểm.
