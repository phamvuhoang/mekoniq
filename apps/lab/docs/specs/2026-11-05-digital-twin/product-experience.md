# Trải nghiệm sản phẩm: thiết kế, chạy và giải thích một lần phục vụ

Ngày: 2026-11-05. Trạng thái: **đặc tả nâng cấp, chưa triển khai**. Đọc cùng [index](README.md), [kiến trúc và contracts](architecture-contracts.md), [mô phỏng](simulation.md), [cánh tay và phần cứng](arm-hardware.md), [nghiệm thu](verification.md).

## 1. Giá trị phải có sau nâng cấp

Lab giúp người dùng trả lời bằng một lần chạy có thể xem lại: robot có đi được trong mặt bằng này, phục vụ đúng bàn/đúng cốc, phối hợp đúng với trạm pha chế, và xử lý thế nào khi có người cắt ngang, mất kết nối hoặc thao tác chưa được xác nhận. Người dùng thấy nguyên nhân và giới hạn của kết quả, có thể sửa một đầu vào rồi so sánh lại.

**Ưu tiên người dùng đã chọn: cà phê, gồm máy pha, đá/sữa và arm phục vụ.** Phạm vi đầu tiên gồm robot giao món di động và một cell cà phê cố định có máy espresso, bộ cấp đá, bộ định lượng sữa, vị trí cốc, cánh tay 6 bậc tự do và vùng bàn giao cho robot giao món. Hai recipe mẫu là espresso và cà phê sữa đá; định lượng/cỡ cốc là fixture minh họa, chưa là công thức thương mại đã duyệt. Bắt đầu một cấu hình gripper, cup types được khai báo rõ. Chưa mô phỏng thủy động lực học chất lỏng nóng, truyền nhiệt CFD, nấu ăn, vệ sinh tự động hay chất lượng cà phê bằng hình ảnh. Trạng thái machine-ready, chu kỳ brew, nhiệt độ/sữa lạnh và cleaning vẫn là dữ liệu/interlocks của process model.

| Người dùng | Việc phải làm được | Đầu ra có ích |
|---|---|---|
| Chủ nhà hàng/người vận hành | Chọn mặt bằng, chọn hành trình, chạy, xác nhận tải/giao và thử một lỗi | Hiểu điểm chờ, thời gian đi/chờ, khả năng phục hồi và tác động của bố trí |
| R&D cơ điện | Đổi robot, footprint, tải, cell, joint limits, vùng thao tác | Cấu hình có revision; phép kiểm tương thích; bằng chứng đúng mức của backend |
| Kỹ sư tích hợp | Chạy cùng scenario qua mock, simulation, hardware được provision | Trace từ order/cup tới command, observation, report; xác định lỗi ở tầng nào |

Mục tiêu thử trải nghiệm đề xuất: người mới mở dự án mẫu, bắt đầu mock và tìm thấy lần chờ tải đầu tiên trong **3 phút**, hoàn thành một hành trình và mở report trong **5 phút**, tìm được nguyên nhân một ca thất bại trong **2 phút**. Đo với ít nhất 5 người không viết Lab; đây là mục tiêu usability, không phải kết quả đã đạt.

## 2. Baseline đã kiểm tra

| Có thật trong code hiện tại | Điểm cần thay đổi |
|---|---|
| [LabApp](../../../src/app.ts) có Design, Restaurant, Scenarios, Results, Deployment; VI/JA/EN, persistence, undo, import/export | `LabApp` đang giữ nhiều trách nhiệm; tách presentation, run state, backend client và editor khi nâng cấp |
| [RobotDesign/RestaurantWorld/RunSnapshot](../../../src/shared/types.ts) chỉ có chassis, khay, pin/cảm biến, điểm x/y, vật cản hình chữ nhật; run chỉ `business_sim` | Thêm robot/cell assets, pose có hướng, chuyển động, joints, cup/process state, backend/capability và phiên bản schema |
| [mountRobot](../../../src/viewer/robot.ts) tạo robot minh họa để chọn phần/lắp ráp | Chưa nhận world/pose/joints; chưa là renderer của robot đang chạy |
| [worldSvg](../../../src/app.ts) vẽ tọa độ snapshot và đường thẳng từ robot tới target | Đường thẳng hiện tại không phải route được planner tìm; không có trajectory, sensor hay collision engine |
| [validateWorld](../../../src/world/validation.ts) kiểm bounds, điểm nằm trong vật cản và footprint tại điểm đích | Chưa chứng minh đường đi liên tục, vùng quét khi quay, vật cản động hay khả năng tiếp cận cell |
| [runtime client](../../../src/runtime/client.ts) gọi source `/lab/v1`; S01 có load/handoff thật qua source | Chỉ tạo `business_sim`; không có runner browser cho nghiệp vụ. UI lấy snapshot sau action hoặc nút Refresh, chưa có polling tự động/SSE dù tài liệu cũ dùng từ polling |
| [metrics/replay](../../../src/reports/metrics.ts) tách travel/human wait và replay event chỉ đọc | `distanceM:null`, một sample, chỉ đọc report `business_sim`; chưa replay pose/joints/process trace |
| [e2e S01](../../../tests/e2e/service-journey.spec.ts) kiểm không giao trước xác nhận, snapshot world bất biến, replay không phát action | Chưa kiểm navigation/collision/arm/dose/telemetry liên tục; test cần runtime token riêng |

Một sai khác cần loại bỏ trước khi dùng scene để quyết định kỹ thuật: [mesh minh họa](../../../src/viewer/robot.ts) hardcode thân bán kính khoảng 0,46 m và khay rộng 0,79 m, còn [catalog](../../../fixtures/catalog/service-illustrative.json) khai báo base 0,55 × 0,60 m và khay 0,45 × 0,40 m. Các số này đang phục vụ minh họa; nâng cấp phải sinh visual, footprint/collision và simulator từ cùng asset revision với đơn vị rõ ràng. Không lấy mesh hiện tại làm bản đo robot.

## 3. Ba chế độ công khai và một cách xem lại

UI chỉ dùng ba mode **Mock / Simulation / Hardware**; trình replay là cách xem bản ghi, không phải backend thực thi. Hiển thị backend cụ thể trong bảng thông tin kỹ thuật và mọi report.

| Mode | Trải nghiệm | Bằng chứng được phép tạo |
|---|---|---|
| Mock | Chạy local từ runner TypeScript đóng gói trong source, fake clock xác định, chuyển động động học và thiết bị/cell giả lập; không cần Linux hay hardware | Nghiệp vụ, điều phối, hình học/động học trong phạm vi model mock, faults xác định; không chứng minh động lực học, sensor thật hoặc hardware |
| Simulation | Kết nối backend được provision như `gazebo_nav2` và/hoặc `linuxcnc_sim`; scene đi theo telemetry của backend | Chỉ những khả năng engine thực sự chạy và ghi bằng chứng: navigation/physics/sensors của Gazebo; kinematics/controller traces của LinuxCNC; process model riêng cho dose |
| Hardware | Profile kỹ thuật đã provision, phân biệt `shadow`, `hil`, `live`; capability và quyền quyết định thao tác nào khả dụng | Shadow quan sát; HIL kết quả đúng thành phần thật trong vòng lặp; live kết quả đúng thiết bị/config/test. Không tự là nghiệm thu nhà hàng |

Browser mở offline vẫn xem/sửa dự án và phát fixture để học giao diện, với nhãn **Preview dữ liệu mẫu**. Nó không tạo source business evidence, không tự chuyển thành mock run khi source chưa chạy. Luồng khởi động mock phải có một lệnh phát triển được tài liệu hóa để bật web và runner local cùng nhau; pairing vẫn theo contract source và không nhét credentials vào project.

Backend set bất biến trong một run. Chọn mode/backend khác tạo run mới sau khi người dùng nhìn thấy tình trạng run hiện tại; không đổi backend của command đang chờ. Không có backend thì hiện lý do và bước chuẩn bị, không phát animation thay cho run thành công.

## 4. Cấu trúc giao diện và luồng chính

Giữ navy/lime và VI/JA/EN hiện tại. Navigation gồm **Dự án**, **Robot & cell**, **Nhà hàng**, **Chạy thử**, **Kết quả**, **Chuẩn bị thiết bị**. Có thể gộp Dự án vào shell nếu không cần một trang riêng. Trang Chạy thử là trung tâm, không bắt người dùng đi qua màn BOM trước mỗi lần chạy.

```text
Tên dự án · revision          Mock / Simulation / Hardware       Backend · kết nối
Scenario + mục tiêu           Run / Pause / Step / tốc độ          thời gian mô phỏng
┌ Danh sách công việc ┐ ┌ Scene nhà hàng 2D / 3D ─────────────────┐ ┌ Đối tượng chọn ┐
│ order / bàn / cup  │ │ robot · cell · người · đường đi · vùng  │ │ pose/joints    │
│ bước đang chờ     │ │ target khác route; quan sát khác lệnh   │ │ cup / sensor   │
│ hành động cần làm │ │ chọn đối tượng để đọc trạng thái        │ │ giới hạn/lỗi   │
└───────────────────┘ └─────────────────────────────────────────┘ └────────────────┘
Timeline: command → accepted → moving → arrived → load/handoff; lỗi có nguyên nhân
```

Luồng giao món: chọn layout và robot → chọn FD01/FD02 → kiểm điều kiện → tạo run → order/KDS ready theo actor scenario → robot đến bếp → nhân viên xác nhận đúng món/khay → robot đến điểm bàn giao bàn → xác nhận giao từng allocation → về parking → mở report. Người dùng có thể xem actor chuẩn bị order tự động hoặc tự thao tác; report ghi ai/cái gì phát mỗi confirmation. Auto-run không mặc nhiên tự xác nhận tải/giao.

Luồng cà phê: order/recipe → reserve nguyên liệu và cốc → kiểm cup-present, machine-ready và interlocks → thực hiện brew/cấp đá/định lượng sữa theo thứ tự recipe → xác minh từng bước và lượng cuối → arm lấy cốc → đặt vào vị trí handoff → xác nhận chuyển quyền giữ cốc sang khay robot → giao đúng bàn → xác nhận người nhận. Espresso bỏ qua bước đá/sữa theo recipe, không giả báo các bước ấy đã chạy. Scene phải giữ cốc ở đúng nơi/đúng owner qua từng bước; không làm cốc biến mất rồi tăng served.

Chọn một failure mở giải thích theo chuỗi: **điều đang chờ → điều quan sát được → rule từ chối → hành động khả dụng**. Ví dụ: “Chờ xác nhận lượng. Cân mô phỏng đọc 231 g; recipe revision 3 yêu cầu 245–255 g với density fixture 1 g/mL. Cốc chưa được chuyển cho arm.” Có liên kết tới trace, không chỉ toast chung “Error”.

## 5. Yêu cầu trải nghiệm

| ID | Yêu cầu bắt buộc | Cách nhận biết đạt |
|---|---|---|
| UX-01 | Dự án mẫu mở được, có food và beverage/arm scenario; chọn mock và chạy qua source runner trên máy phát triển | Tác vụ 3/5 phút ở mục 1; thiếu runner có hướng dẫn đúng, không báo completed |
| UX-02 | Chọn 2D/3D cho **cùng run/world/pose**; selection và camera có reset/follow | Đổi view giữ run ID, sim time, đối tượng, revision; không tạo action domain |
| UX-03 | Phân biệt planned route, observed trail, target, footprint và vùng giữ chỗ | Legend có đơn vị; route unavailable để trống, không vẽ đường thẳng rồi gọi là route |
| UX-04 | Hiện trạng thái mission/cargo/cup/arm song song, xác nhận đúng đối tượng | Handoff ghi cup/allocation/tray ID; không có một nút giao tất cả khi mới xác nhận một bàn |
| UX-05 | Run/Pause/Step/Reset/tốc độ hoạt động theo capability mode | Mock step có dt; pause clock không lẫn stop; hardware không có tua nhanh/reset world |
| UX-06 | Fault palette có tham số, thời điểm và phạm vi; hỗ trợ một lần hoặc schedule | Người dùng nhìn thấy fault đã áp dụng ở đâu, lúc nào và có hiệu lực hay bị từ chối |
| UX-07 | Nhấp robot/cell/obstacle/cup mở inspector có giá trị, đơn vị, nguồn và độ mới | Unknown/stale không bị biểu diễn thành 0 hoặc trạng thái khỏe |
| UX-08 | Timeline nối sự kiện nghiệp vụ, command và observation; filter theo entity và mức lỗi | Từ một lỗi tìm được trace liên quan trong mục tiêu 2 phút; ID giữ nguyên khi export |
| UX-09 | Replay có play/pause/scrub, pose/joints/process theo recorded time và event cursor | Không gửi execute; khoảng trống telemetry được đánh dấu, không nội suy vượt gap threshold |
| UX-10 | So sánh hai run trình bày thay đổi inputs, coverage, sample counts và KPI tương thích | Không xếp hạng mock so với hardware như cùng một thang chứng cứ; metric không đủ dữ liệu là unavailable |
| UX-11 | Responsive, keyboard và reduced-motion; 2D thay WebGL khi cần | Control chính dùng keyboard, focus rõ, status không chỉ bằng màu; không mất run khi context loss |
| UX-12 | Lưu/mở/import/export có migration và revision; đổi input không sửa lịch sử | Run cũ vẫn xem được, badge khác cấu hình hiện tại, tạo run mới dùng bản mới |

Trong 3D, robot và cell dùng mesh thẩm mỹ nhưng pose/joint transforms đi theo dữ liệu đã ghi; collision overlay là lớp riêng có thể bật. Chỉ đổi độ đẹp không làm thay geometry/collision hash. Cảm biến chỉ vẽ khi backend xuất đúng loại dữ liệu; mock sensor rõ là synthetic. Không rải nhãn kỹ thuật vào mỗi bước phục vụ: thông tin mode/nguồn nằm ở status/inspector/report, thao tác chính dùng ngôn ngữ nhà hàng.

## 6. Những gì khiến Lab trở thành bản sao số có ích

DT-01…DT-05 trong [architecture-contracts](architecture-contracts.md) là yêu cầu twin nền tảng. UX-13…UX-20 dưới đây cụ thể hóa cách người dùng thấy và kiểm tra các thuộc tính đó.

| ID | Yêu cầu | Giới hạn và phép kiểm |
|---|---|---|
| UX-13 | Một asset/world revision là nguồn thống nhất cho scene, planner, collision và export simulation | So bbox/footprint, scale và frames; không chấp nhận visual-only thay thế collision mesh |
| UX-14 | Pose/joints/process state luôn có entity, frame, unit, sim/wall time, nguồn và sequence | Kiểm frame transform, đơn vị, ordering; unknown không tự suy diễn từ command |
| UX-15 | Tách desired/commanded, observed và derived state | Đã phát goal không có nghĩa đã đến; đã gửi dispense không có nghĩa đủ lượng; đóng gripper không tự chứng minh đã giữ cốc |
| UX-16 | Run capture cố định project, scenario, source, backend set và model/calibration revisions | Sửa layout/recipe/arm giữa run không thay inputs của run; tạo candidate/run mới và invalidation đúng phạm vi |
| UX-17 | Có telemetry liên tục và đánh dấu stale/drop/disconnect | Đề xuất UI cập nhật pose ≥10 Hz khi backend cung cấp; sensor lớn downsample có nhãn; receipt age và heartbeat dùng monotonic clock theo profile; sim pause hiển thị FROZEN_SIM cùng tuổi dữ liệu thật, không báo LIVE hay làm mới timestamp đo giả; hardware không có ngoại lệ pause-age |
| UX-18 | Thay đổi hình học/tốc độ/tải/process parameter phải tác động tới model tương ứng | Bài so sánh đổi lối đi/giới hạn tốc độ/công thức phải có tác động giải thích được; không chỉ thay mesh |
| UX-19 | Report xác định từng assertion được engine nào chứng minh | LinuxCNC controller sim không tự cấp collision/force/fluid evidence; GUI 3D không tự cấp physics evidence |
| UX-20 | Calibration/measurement có provenance và ngày/revision; hồ sơ hardware gắn đúng asset thật | Mock profile mang nhãn giả định. Chỉ dùng “đã hiệu chuẩn/đã kiểm trên thiết bị” khi có hồ sơ tương ứng |

UX-13–UX-19 cho phép xây mô hình số hữu dụng khi chưa có robot. Liên hệ với tài sản thật ở UX-20 tăng dần qua shadow/HIL/live; chưa có measured profile thì không gọi mô hình là bản sao đã hiệu chuẩn của robot đang vận hành.

## 7. Yêu cầu giao món

| ID | Yêu cầu | Scenario chính |
|---|---|---|
| FD-01 | Order/KDS/allocation/mission dùng source domain; mỗi món/khay/bàn có identity | FD01, FD02 |
| FD-02 | Robot di chuyển có hướng, tốc độ/giới hạn và trạng thái; arrival phải từ backend observation | FD01, FD03, FD04 |
| FD-03 | Đường đi xét footprint/vật cản theo khả năng engine; chặn lối giữ pending/attention | FD03, FD04 |
| FD-04 | Phân biệt arrival, load, handoff, return và parking; manual/scripted actor đều có provenance | FD01, FD02, FD06 |
| FD-05 | Admission kiểm capability, tải, pin và mapping phù hợp profile; lý do machine-readable | FD05, FD08 |
| FD-06 | Cancel/timeout/mất kết nối giữ cargo thực tế và command không rõ; không tự tính delivered | FD06, SYS02 |
| FD-07 | Resource reservation cho corridor/cell/handoff dùng coordinator; bất định không tự nhả quyền | FD07, BV03, BV07 |
| FD-08 | Kết quả tách travel, human wait, queue, fault wait; distance chỉ từ đủ pose samples | FD01–FD08 |

Parking là điểm chờ; chỉ ghi charging nếu profile có capability và observation đúng. Map update không làm world drawing tự trở thành SLAM map. Khi pose stale/localization lost, scene giữ last-known pose bằng nét mờ kèm timestamp và không dùng pose đó để xác nhận arrival.

## 8. Yêu cầu pha chế và cánh tay

| ID | Yêu cầu | Scenario chính |
|---|---|---|
| BV-01 | Recipe espresso/cà phê sữa đá có revision, thứ tự brew/ice/milk, ingredient/batch, cup type/capacity, target dose và đơn vị bất biến của lần pha | BV01, BV06 |
| BV-02 | Reserve cốc/nguyên liệu/máy pha/bộ cấp đá-sữa/cell/arm/handoff; kiểm cup-present, machine-ready và interlocks trước khi chạy | BV02, BV03, BV08 |
| BV-03 | Tách requested/dispensed/measured/accepted cho brew, đá và sữa; đánh giá tolerance từ sensor/process model, không từ timer UI | BV01, BV04 |
| BV-04 | Arm là execution domain riêng, có joints/TCP/gripper và các phase approach/grasp/lift/place/retract | ARM01–ARM06, BV01 |
| BV-05 | Cup có một owner/location hợp lệ; chuyển từ cell→arm→handoff→robot theo observation/confirmation được quy định | BV01, BV07 |
| BV-06 | Dispense/pick/place có command identity và reconciliation; ACK mất không tự lặp tác động không thể đảo | BV05, SYS03 |
| BV-07 | Cancel, kẹt đá, hết sữa, mất sensor và cleaning/cold-handling chưa sẵn sàng có đường recovery rõ; trạng thái lượng/cốc không bị reset giả | BV03, BV07, BV08 |
| BV-08 | Trace nối recipe/cup/batch/dose/arm/robot/order; report ghi process model và phần đã đo/thử thật | BV01–BV08 |

Mock mặc định có recipe minh họa espresso và cà phê sữa đá; mỗi component khai báo target/tolerance riêng, cup capacity/headspace và thứ tự thao tác. Fixture kiểm định lượng độc lập có thể dùng 250 mL ±5 mL với density 1 g/mL, nhưng không tự áp dụng phép đổi này cho sữa, espresso hay khối lượng đá. UI nhập/hiển thị g, mL, °C theo loại sensor; canonical recipe/telemetry lưu kg, m³, K theo architecture, quantity là exact decimal string với scale rõ ràng. Adapter/UI conversion phải round-trip đúng và không mất độ chính xác inventory; density nếu có phải có nguồn/giả định. Thông tin milk batch, thời điểm mở, trạng thái bảo quản lạnh, cleaning và freshness được kiểm bằng policy fixture có version; không gọi đó là chứng nhận vệ sinh. Mock amount không là phép đo máy pha. Simulation không ghi dose PASS nếu chỉ arm controller chạy, chưa có process model/measurement fixture. Hardware thay ngưỡng bằng calibration/công thức được duyệt trước test.

Với arm 6DOF, người dùng nhìn được joint angle, TCP frame, limit, target và trajectory actual/commanded; slider joint chỉ sửa draft hoặc fixture; joint jog/home thực ở HMI local QtVCP theo owner/state policy của MVP. UI chỉnh joint trong draft không điều khiển thiết bị. Thao tác run/program thực dùng đường source/executor được provision trong [spec arm/hardware](arm-hardware.md); không gửi raw motor/G-code tùy ý từ file project hoặc trình duyệt công khai.

## 9. Thư viện kịch bản và báo cáo

Mỗi card scenario nêu mục đích, inputs cần có, actor thủ công/scripted, fault schedule, assertions và backend cần cho từng assertion. ID mới là FD01–FD08, BV01–BV08, ARM01–ARM06, SYS01–SYS06, được định nghĩa ở [verification](verification.md). Chúng không thay ý nghĩa S01–S14 của spec 2026-11-01; e2e S01 cũ vẫn là regression hành trình nền.

Report mở bằng outcome và nguyên nhân chính, tiếp theo là work completed/pending, thời gian, path/cup trace, assertions, coverage và revision. Dùng `pass`, `fail`, `blocked_external`, `not_run` cho từng assertion; `unknown` là trạng thái kết quả command/thiết bị, không phải cách đánh PASS. Ghi engine/model đã chạy và engine chưa chạy. Một run completed có thể còn assertion fail; UI không thay hai khái niệm bằng một badge xanh.

So sánh hai layout chỉ so mission time/distance khi scenario, mode, engine và workload tương thích. p50/p95 phải có tập run/sample count; một run không tạo percentiles. Người dùng tải report + manifest + logs/trace liên quan; file export không chứa credentials hay các lệnh chờ có thể được thực thi lại.

## 10. Ranh giới giao hàng

Đợt mock đầu phải có FD01/FD02, một BV01 hoàn chỉnh có arm mock, failure điển hình, replay và report có coverage. Đợt simulation phải chứng minh Gazebo/Nav2 thật và LinuxCNC simulator thật theo capability riêng; không để card “sắp có” được tính là hoàn tất. Đợt hardware bàn giao được profile/connector/conformance/shadow/HIL hồ sơ để thay thiết bị; live acceptance chỉ khi có thiết bị và các phép đo bắt buộc. Lịch triển khai và điều kiện hoàn tất nằm trong [plan](../../plans/2026-11-05-digital-twin/README.md).
