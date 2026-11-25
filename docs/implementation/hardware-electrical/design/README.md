# MEKONIQ — Roadmap từ R5 và R5: Bàn kỹ thuật phần cứng và điện

**Ngày thiết kế:** 2026-11-25 · **Trạng thái:** đề xuất. Chiều 25/11 người dùng đã trả lời bốn điểm cần quyết ([§0](#0-hướng-đã-chốt-với-người-dùng)); spec và plan chưa được duyệt từng tài liệu, và chưa có lệnh bắt đầu E00. Bộ này chỉ gồm tài liệu, probe và tài liệu hãng đã tải; nó chưa tạo thay đổi nào trong `source/`, `trial/`, `web/`, Vercel, Cloud Run hay GitHub.

**Yêu cầu:** đọc toàn bộ các trao đổi về nhiều giải pháp tích hợp vào MEKONIQ Lab sau R4 và Codebase Merge ([discussions.md](discussions.md)), nghiên cứu sâu các giải pháp, và lập roadmap cùng spec/plan cho giai đoạn từ R5.

**Một câu:** R4 kiểm thử controller qua một drive ảo mà mọi tham số là giả định; R5 biến Lab thành công cụ **chọn và kiểm một cấu hình phần cứng chế tạo được** cho MEKONIQ Serve (hồ sơ thiết bị có nguồn, phân bổ I/O, netlist và tài liệu đấu dây, hành vi dừng trên plant R4, một gói hồ sơ để đặt mua và chuẩn bị bàn thử), rồi R6 biến mặt bằng của một quán thành báo cáo robot đi được tới đâu. Không thêm simulator. Không cài runtime ngoài. Lab vẫn không bao giờ nói chuyện với robot thật.

## 0. Hướng đã chốt với người dùng

Các hướng chốt từ trước khi bộ này được viết:

1. **Đích chạy là máy Mac local và cloud;** không việc nào được chờ host Linux native hay phần cứng; web là bề mặt demo cho nhà đầu tư và đối tác; chưa có lịch phần cứng (19/11).
2. **Codebase Merge cutover sau khi R4 về `main`;** Lab ở `lab.mekoniq.app`; trang marketing về `mekoniq.app` (20/11). R4 đã về `main` sáng 25/11.
3. Push `main`, deploy, khóa truy cập cloud và chữ ký acceptance đều cần lệnh riêng của người dùng cho từng lần.

Chiều 25/11 người dùng dán vào phiên làm việc bốn câu trả lời cho bốn điểm cần quyết của roadmap. Tôi ghi chúng là quyết định của người dùng; nguyên văn và hệ quả ở [roadmap §4](02-roadmap.md#4-thứ-tự-và-điểm-quyết-định):

4. **R6 (mặt bằng) đứng trước phần chế tạo.** Đảo lại nếu Hoàng Anh có lịch chế tạo chiếc đầu tiên trong vài tuần.
5. **Merge trước R5.** M7–M10 vẫn cần lệnh từng bước. Lúc ghi (18:05 ngày 25/11) lần gộp đã chạy tới bước push của M7, nên R5 làm trong một repo ([§3](#3-điểm-xuất-phát)).
6. **Giữ ba phương án phần cứng** BLV-R, ZLAC8015D và BLV-R cộng I/O rời. Hỏi Hoàng Anh trước E03 xem có danh sách ngắn khác không ([câu hỏi](02-roadmap.md#41-câu-hỏi-gửi-hoàng-anh-trước-e03)).
7. **Giữ một chuỗi regression đầy đủ ở E21.**

Mọi thứ khác trong bộ này vẫn là đề xuất; các lựa chọn tôi tự quyết nằm ở [§9](#9-những-lựa-chọn-bộ-này-tự-quyết-cần-người-dùng-xem). Cụm "roadmap chúng ta vừa thống nhất" trong các cuộc trao đổi là lời của trợ lý trong đó, không phải quyết định của người dùng.

## 1. Đọc theo thứ tự

| Tài liệu | Nội dung |
|---|---|
| [01 — Nghiên cứu](01-research.md) | Baseline 25/11, 11 chủ đề đã đọc, phát hiện từ code, kết quả kiểm từng giải pháp trên nguồn gốc, các hướng đã cân nhắc, điều chỉnh so với các cuộc trao đổi, điều không kiểm được |
| [02 — Roadmap](02-roadmap.md) | R5 → R8, 17 lane chờ điều kiện, bảng truy vết từng đề xuất, rủi ro, bốn điểm người dùng đã quyết ngày 25/11, câu hỏi gửi Hoàng Anh |
| [03 — Spec R5-A](03-r5-hardware-electrical-spec.md) | Hồ sơ thiết bị, thiết kế điện, phân bổ I/O, netlist, quy tắc điện, tài liệu đấu dây, so sánh chi phí, gói ứng viên phần cứng |
| [04 — Spec R5-B/C](04-r5-stop-diagnostics-spec.md) | Ba chức năng dừng trên plant R4, I/O ảo, phần Điện của trang Lắp ráp, panel Chẩn đoán |
| [05 — Contracts và evidence R5](05-r5-contracts-and-evidence.md) | Schema, wire, metric, oracle, 48 case, 9 gate, qualification |
| [06 — Spec R6](06-r6-venue-readiness-spec.md) | Đánh giá mặt bằng, ở mức spec gọn; plan viết sau khi R5.2 bàn giao |
| [Plan — Tổng quan](plans/README.md) | Thứ tự, dependency, ràng buộc chung, điểm dừng của R5 |
| [Plan 01](plans/01-profiles-and-design.md) | E00–E05: baseline, spike, hồ sơ thiết bị, catalog, thiết kế điện, ba phương án |
| [Plan 02](plans/02-allocation-netlist-documents.md) | E06–E10: phân bổ, netlist, quy tắc, compile, tài liệu, chi phí |
| [Plan 03](plans/03-stop-and-virtual-io.md) | E11–E14: drive model suy ra, lịch dừng, `stop-v1`, I/O ảo, `vio-v1` |
| [Plan 04](plans/04-lab-ui-package-closeout.md) | E15–E21: giao diện, mẫu web, gói ứng viên, kiểm cloud, qualification |
| [research/](research/) | Sáu báo cáo thô bằng tiếng Anh của các nhánh nghiên cứu, bản đồ code dở dang, và 14 tài liệu hãng đã tải kèm `SHA256SUMS` |
| [probes/](probes/) | Script và kết quả probe: Pinocchio so với MuJoCo, render offscreen, IFC và kiểm khoảng hở, WireViz và elkjs, tóm tắt EDS/ESI, USD sang MJCF, mô hình cho thuê |

Đường dẫn bắt đầu bằng `source/` hoặc `lab/` tính từ workspace `robot/`. Từ lần gộp ngày 25/11, `lab/` là symlink tới `source/apps/lab`, nên các đường dẫn đó vẫn đúng. File ghi **Create** là đầu ra tương lai. Lệnh trong plan là lệnh khi thực thi, không phải kiểm thử đã chạy.

## 2. Quan hệ với tài liệu đang có

- Bộ này **nối tiếp** [bộ R4](../2026-11-19-virtual-commissioning/README.md) và [bộ Codebase Merge](../2026-11-20-codebase-merge/README.md), không sửa chúng. Mọi quyết định R2B-, R3-, R4- và MG- giữ hiệu lực.
- ID mới của R5: yêu cầu `R5-NN`, quyết định `R5-DNN`, task `E00`–`E21`, case `DEV`, `IOA`, `NET`, `ERC`, `SAF`, `DOC`, `TCO`, `STP`, `VIO`, `DGN`, `WEB11`–`WEB13`, `CLD04`–`CLD06`, `REG06`; gate `G-DEV1`, `G-ELE1`, `G-DOC1`, `G-STP1`, `G-VIO1`, `G-DGN1`, `G-WEB3`, `G-REG6`, `G-CLOUD3`, và hai gate ngoài `G-BENCH1`, `G-SAFE1`. ID của R6: `R6-NN`, `R6-DNN`, task `S00`–`S11`.
- Tài liệu nằm ở workspace `robot/docs/`, ngoài các repo, cùng lý do với hai bộ trước: recorder và build từ chối cây có file chưa theo dõi. Khi đóng R5, E21 chép bộ này vào `source/docs/`.
- Tên "R5", "R6", các tiền tố và tên release là đề xuất của bộ này.

## 3. Điểm xuất phát

R4 đã về `main` và đã deploy ngày 25/11: source `6285c490`, Lab `77dcce3`, pin và Cloud Run `0650ecbd`; `r4-candidate-02` có 55/56 case trong record và CLD03 đạt qua bản bổ sung; chưa có chữ ký acceptance nào. Lúc bộ này được viết, Codebase Merge chưa chạy task nào.

**Cập nhật 18:05 ngày 25/11.** Trong ngày, Codebase Merge đã chạy tới bước push của M7 ([bản ghi diễn tập và review](../2026-11-20-codebase-merge/rehearsal-2026-11-25.md)):

- Repo `mekoniq` có Lab ở `apps/lab`; `main` = `origin/main` = `c7df3381`; `robot/lab` là symlink tới `source/apps/lab`; cây sạch.
- Pin trên `main`, bản Lab công khai và Cloud Run vẫn cùng `0650ecbd` và cùng schema hash `353b06e2…`.
- Chưa làm: `lab.mekoniq.app` trả 404 (M8), `mekoniq.app` còn chuyển hướng 308 (M9), `CLAUDE.md` của workspace còn mô tả bốn repo (M10). Bước nối Vercel của M7 tôi không kiểm.
- Plan của R5 đã được kiểm lại bằng máy trên cây đã gộp: 34 file sẵn có mà plan sửa hoặc đọc đều còn ở đúng đường dẫn, và không file **Create** nào đã tồn tại. Quy ước làm việc trong một repo ở [plan §2](plans/README.md#2-quy-ước-thực-thi).

| Đã có | Khoảng trống R5 nhắm tới |
|---|---|
| Catalog 13 linh kiện với cổng nguồn và dữ liệu, tài liệu có digest; kiểm điện áp, dòng và giao thức ở mức cổng; BOM có báo giá | Không có gì ở mức **chân**: giắc, điểm I/O, cách lộ ra bus, khả năng của drive |
| Drive ảo có trạng thái, giới hạn, encoder, trễ, watchdog; mọi tham số `assumed` | Không có đường nào từ tài liệu của một drive thật tới tham số của drive ảo |
| Lỗi drive có biên nhận, báo cáo lỗi có quãng đường tới lúc nghỉ; khay ba cốc | Chưa so được các kiểu dừng; controller chưa bao giờ phát quick stop; không có khái niệm dừng khẩn độc lập |
| Trang Lắp ráp có BOM và danh sách vấn đề; 5 tab inspector; studio lỗi | Không có phân bổ I/O, danh sách dây, bảng chân; không chọn được một trục để xem trạng thái |
| `EngineeringCandidate`, dossier đích vật lý, hồ sơ commissioning chassis còn `blocked_external` | Không có gói hồ sơ nào để hai người ở hai thành phố trao đổi về một cấu hình trước khi mua |
| Ứng viên motor trong catalog (BLV-R) chỉ có một trang hãng; 0 báo giá | Chưa có thiết bị nào ở mức "theo tài liệu của hãng" |

## 4. Roadmap tóm tắt

| Release | Người dùng thấy gì | Phụ thuộc | Ước lượng |
|---|---|---|---|
| **R5 — Bàn kỹ thuật phần cứng và điện** | Ba phương án Serve so được; phân bổ I/O; danh sách dây, bảng chân, BOM; bốn kiểu dừng với khay ba cốc; gói ứng viên kèm checklist bàn thử | Không | 37–55 |
| **R6 — Đánh giá mặt bằng** | Mô hình không gian có nguồn; kiểm khoảng hở có lý do; báo cáo đánh giá mặt bằng | Không; song song được với R5.3–R5.5 | 30–45 |
| **R7.1 — Hồ sơ chế tạo** | Manifest chế tạo, hướng dẫn lắp, checklist QC, báo giá theo cấu hình | Cây CAD của Serve; một phương án `documented` | 12–18 |
| **R8 — Bàn thử Physical AI** | Oracle Pinocchio; teleop và ghi; đánh giá policy vòng kín | Không cho phần chạy trên Mac | 27–43 |
| 17 lane chờ điều kiện | Bàn thử, an toàn, native, hiệu chuẩn, commissioning, QElectroTech, MuJoCo 4.x, tài sản ngoài, Intrinsic… | Mỗi lane có điều kiện mở ghi rõ | — |

Các đợt của R5, mỗi đợt bàn giao riêng được:

| Đợt | Người dùng thấy gì | Phụ thuộc |
|---|---|---|
| **R5.1 — Hồ sơ thiết bị và thiết kế điện** | Thiết bị có mức bằng chứng tính bằng máy; ba phương án HW-A/B/C nạp được | Baseline |
| **R5.2 — Phân bổ, netlist, tài liệu** | `lab-hardware check\|compile\|docs\|compare`: bảng phân bổ kèm lý do, danh sách dây, bảng chân, BOM, checklist bàn thử, so sánh chi phí | R5.1 |
| **R5.3 — Hành vi dừng** | Dừng thường, dừng bảo vệ, dừng khẩn trên khay ba cốc; báo cáo dừng và câu gợi ý | R5.2 |
| **R5.3b — I/O ảo** | Bumper và trạng thái E-stop ảo; ba lỗi I/O | R5.3; cắt được |
| **R5.4 — Giao diện** | Phần Điện của trang Lắp ráp; panel Chẩn đoán; hai mẫu tĩnh trên web | R5.2, R5.3 |
| **R5.5 — Gói và đóng** | Gói ứng viên phần cứng tải về được; qualification | Tất cả |

Nếu phải cắt: giữ **R5.1 và R5.2**. Hai đợt đó không chạy mô phỏng nào và đã đủ để có bảng so sánh và bộ hồ sơ đấu dây.

## 5. Quyết định trọng tâm

1. **Mở rộng tầng engineering sẵn có, không dựng nền tảng phần cứng mới.** Hồ sơ thiết bị là tài liệu anh em của linh kiện trong catalog; thiết kế điện tham chiếu project; bundle điện đứng cạnh bundle engineering. Không schema đóng băng nào bị sửa.
2. **Giá trị của hãng chỉ đến từ tài liệu đã ghim bằng hash.** Không điền từ trí nhớ, từ web hay từ mô hình ngôn ngữ. Không ghim được thì là `assumed`.
3. **Không trường nào gõ được mức.** Mức bằng chứng của thiết bị, mức của một tuyên bố an toàn và trạng thái của một yêu cầu an toàn đều là hàm thuần của tài liệu và nguồn.
4. **An toàn nằm ngoài quyền của công cụ.** Tín hiệu chuỗi an toàn không được phân bổ hay tự đấu; tuyên bố an toàn được chép nguyên văn kèm chứng chỉ nếu có; không đầu ra nào khẳng định mức an toàn.
5. **Tài liệu soạn, tài liệu suy ra và file của công cụ vẽ là ba lớp tách nhau.** File vẽ là đầu ra; sửa tay bị phát hiện.
6. **AI nằm ngoài đường tin cậy.** Một agent sửa JSON thiết kế; compiler và bộ quy tắc quyết định. Sản phẩm không gọi mô hình ngôn ngữ.
7. **Hành vi dừng là ánh xạ, không phải máy trạng thái mới.** Dừng khẩn do worker áp dụng, độc lập với controller và kênh lệnh; sau dừng bảo vệ và dừng khẩn không tự khởi động lại.
8. **Không hứa kết quả vật lý.** Quãng đường dừng là quan sát trong model giả định, luôn kèm tham số quyết định và bài đo cần làm.
9. **Không đủ chân, thiếu giá, thiếu tài liệu là kết quả, không phải lỗi.** Bundle vẫn sinh ra và nói rõ thiếu gì.
10. **Mac local và cloud là hai đích bắt buộc.** Digest của bundle điện phải trùng giữa hai kiến trúc; kết quả engine được so theo dung sai.

## 6. R5 cố ý không làm

Driver phần cứng; adapter `ros2_control`; đọc hay ghi tham số drive; kiểm thử trên bàn thử; thiết kế mạch an toàn, tính PL/SIL; sinh sơ đồ QElectroTech; AI soạn thảo trong sản phẩm; nhập ngược từ file vẽ; bố trí 3D khoang điện; mô phỏng dòng điện và nhiệt; I/O ảo cho đèn, còi, dock; HMI vận hành và cổng dữ liệu OT; nâng MuJoCo 4.x; sổ chế tạo theo serial; quản lý hợp đồng thuê; mọi thứ về mặt bằng (thuộc R6). Lý do và điều kiện mở của từng mục ở cuối mỗi spec và ở [roadmap §5](02-roadmap.md#5-các-lane-chờ-điều-kiện).

## 7. Hoàn tất nghĩa là gì

R5 hoàn tất khi chín gate ở [contracts §8](05-r5-contracts-and-evidence.md#8-case-và-gate) có artifact xem lại được ở một tuple source/Lab: G-DEV1, G-ELE1, G-DOC1, G-STP1, G-VIO1, G-DGN1, G-WEB3, G-REG6 và G-CLOUD3; Lab pin đúng source; chuỗi regression trước đó được ghi lại cùng tuple. G-CLOUD3 cần một lần deploy Cloud Run do người dùng ra lệnh; trước lần đó các gate local vẫn đóng được và CLD06 ghi `not_run` có lý do. Nếu I/O ảo bị cắt theo điều kiện dừng, G-VIO1 ghi `not_run` kèm lý do và R5 đóng là "R5 không có I/O ảo". Mọi record `accepted:false`; chấp nhận chỉ do người ký viết trong sidecar.

Hai thứ **không** nằm trong hoàn tất R5 và luôn `blocked_external`: G-BENCH1 (thiết bị trên bàn thử) và G-SAFE1 (đánh giá và thử nghiệm an toàn). Gate `tested` nghĩa là test đạt; nó không nghĩa là cấu hình mua được, đấu được trên thiết bị thật, hay an toàn.

## 8. Ước lượng

Engineer-day cho một kỹ sư quen codebase, chỉ để lập kế hoạch:

| Đợt | Task | Ước lượng |
|---|---|---|
| R5.0 | E00–E01 | 2–3 |
| R5.1 | E02–E05 | 6–9 |
| R5.2 | E06–E10 | 9–13 |
| R5.3 | E11–E13 | 7–10 |
| R5.3b | E14 | 3–5 |
| R5.4 | E15–E18 | 6–9 |
| R5.5 | E19–E21 | 4–6 |

Tổng 37–55. Các cuộc trao đổi ước 27–41 cho nhánh phần cứng và 14–26 cho nhánh QElectroTech. Bộ này bỏ bộ sinh QElectroTech và AI trong sản phẩm, thu I/O ảo về hai điểm, và dùng lại catalog, BOM và drive ảo sẵn có; đổi lại nó tính đủ evidence, kiểm cloud, ba ngôn ngữ, a11y và chuỗi qualification, là những thứ R4 đã cho thấy tốn thời gian thật. Phần lớn rủi ro về thời gian nằm ở việc nhập hồ sơ thiết bị từ tài liệu hãng (E03, E05), không nằm ở code. Chốt lại sau spike E01; không cộng thành ngày hứa bàn giao.

## 9. Những lựa chọn bộ này tự quyết, cần người dùng xem

Các điểm dưới đây không có trong yêu cầu; tôi chọn và ghi lý do trong spec và nghiên cứu. Đổi bất kỳ điểm nào là đổi phạm vi tương ứng. Ngày 25/11 người dùng đã trả lời bốn điểm 2, 6, 16 và 17 ([§0](#0-hướng-đã-chốt-với-người-dùng)); mười bốn điểm còn lại chưa được xem:

1. Tách "R5 gộp" của các cuộc trao đổi thành **R5 (phần cứng và điện)** và **R6 (mặt bằng)**; chẩn đoán 3D nằm trong R5.4.
2. **Đặt mặt bằng trước phần chế tạo**: R6 là Venue Readiness, phần "Manufacturing & Lifecycle" thành R7 và chỉ R7.1 xếp lịch được ([roadmap §4](02-roadmap.md#4-thứ-tự-và-điểm-quyết-định) mục 1). **Người dùng chốt 25/11.**
3. **Không sinh sơ đồ QElectroTech** trong R5; tài liệu đấu dây là CSV và Markdown của MEKONIQ cộng YAML cho WireViz ([nghiên cứu §4.2](01-research.md#42-tài-liệu-điện-và-công-cụ-vẽ)).
4. **AI soạn thảo nằm ngoài sản phẩm**: một bản hướng dẫn cho agent cộng validator (R5-D11).
5. **Hồ sơ thiết bị gõ tay từ tài liệu đã ghim và được kiểm chéo** với bản tóm tắt EDS/ESI, thay cho "Vendor Profile Importer".
6. **Ba phương án phần cứng** dùng BLV-R 60 W (HW-A), ZLAC8015D cộng module I/O (HW-B) và BLV-R cộng I/O rời (HW-C), với 2ELD2-CAN là biến thể không bắt buộc. Lấy từ tài liệu đã đọc, không từ trao đổi với Hoàng Anh. **Người dùng chốt 25/11: giữ ba phương án, hỏi Hoàng Anh trước E03.**
7. **Thiết bị thuần điện không vào assembly cơ khí**, để mọi digest và golden hiện có giữ nguyên.
8. **I/O ảo chỉ có hai điểm** (bumper, trạng thái E-stop) và là phần cắt đầu tiên.
9. **Bumper là đầu vào thường**; ca "kẹt ở 0 không ai phát hiện" được khai trước là kết quả hợp lệ (R5-D29).
10. **Panel Chẩn đoán đọc evidence của run**, không mở kênh tag sống mới tới runtime và không đọc thiết bị.
11. **Sơ đồ khối cột cố định**, không thêm `elkjs`.
12. **Sáu file schema** thay cho tám hợp đồng; `DeviceConformanceReport` và mức `bench_verified` để lại cho lane bàn thử.
13. **Bộ nhập IFC của R6 là tool venv IfcOpenShell trên máy kỹ sư**, không phải web-ifc trong trình duyệt và không nằm trong image.
14. **Tới năm chiếc đầu không dựng sổ chế tạo**; chuyển sang InvenTree theo điều kiện ghi ở [roadmap §3.4](02-roadmap.md#34-r7--hồ-sơ-chế-tạo-và-vòng-đời).
15. **Lát cắt Physical AI dựng trên worker xArm 6 sẵn có**, không dựng trên LeKiwi.
16. Làm trên nhánh `r5/hardware-electrical` và fast-forward về `main` ở cuối; chạy Codebase Merge trước R5. **Người dùng chốt 25/11.** Lần gộp đã diễn ra, nên đó là một nhánh trong một repo, không còn cặp nhánh.
17. Giữ quy tắc một chuỗi regression đầy đủ khi đóng release. **Người dùng chốt 25/11.**
18. Lưu 14 tài liệu hãng đã tải (31 MB, giấy phép chưa rà) trong `research/vendor-documents/` để E03 và E05 ghim vào catalog mà không phụ thuộc URL còn sống.

## 10. Giới hạn của đợt nghiên cứu này

- Tám agent chạy song song đã chạm giới hạn sử dụng sau khoảng mười phút. Sáu agent nghiên cứu được chạy tiếp với phạm vi thu gọn và đều đã trả báo cáo; hai agent lập bản đồ code không được chạy lại, phần cần cho plan tôi đọc trực tiếp. Vì vậy bản đồ Lab và platform không đầy đủ như dự định, và E00 phải đọc lại baseline thật thay vì tin tài liệu này.
- Phiên bản hiện hành của các tiêu chuẩn an toàn không kiểm được vì trang nguồn từ chối truy cập. QElectroTech chưa được chạy. Không có giá thuê robot nào bằng đồng Việt Nam được tìm thấy. Danh sách đầy đủ ở [nghiên cứu §8](01-research.md#8-không-kiểm-được).
- Không có cuộc trao đổi nào với Hoàng Anh hay với khách hàng trong đợt này. Ba phương án phần cứng và thứ tự R6 trước R7 là đề xuất từ tài liệu. Người dùng đã chốt cả hai ngày 25/11; câu trả lời của Hoàng Anh chưa có.
- Plan của R5 được viết từ việc đọc code, chưa có dòng nào được chạy thử ngoài các probe trong [probes/](probes/). Các tên hàm và file **mới** trong plan là quyết định của plan; các tên **sẵn có** đã được đối chiếu với cây tại `6285c490` / `77dcce3`, và đường dẫn của chúng được kiểm lại bằng máy trên cây đã gộp `c7df3381`. Số dòng trích dẫn trong [nghiên cứu](01-research.md) là của cây trước khi gộp.
- Quy ước một repo trong plan (định danh theo đường dẫn, commit pin chỉ đụng `apps/lab`) được chép từ code và bản ghi của lần gộp, chưa được chạy thử cho R5. E00 kiểm lại.
