# MEKONIQ Lab — Digital Twin & Simulation v2

> Phần tiếp nối ngày 06/11/2026: [BV01 Integration Completion & Native Simulation](../2026-11-06-bv01-native-simulation/README.md). Các release/hardware gates trong bộ spec này vẫn có hiệu lực.

Ngày 2026-11-05 · Trạng thái **đề xuất kiến trúc và kế hoạch triển khai**, chưa phải tính năng đã chạy hoặc chứng nhận máy thật.

## 1. Quyết định sản phẩm

Nâng Lab thành nơi **thiết kế, chạy thử, quan sát, tìm nguyên nhân và chuẩn bị triển khai** hệ thống robot phục vụ nhà hàng. Hai vertical đầu là food delivery và **coffee cell: máy pha, đá/sữa, arm phục vụ**, theo lựa chọn của người dùng. Coffee cell tạo đồ uống, arm chuyển cốc tới điểm bàn giao; robot giao món vận chuyển tới bàn. Hai loại robot dùng chung mô hình nhà hàng và luồng nghiệp vụ, không dùng chung motion controller.

Kết quả phải trả lời được những câu hỏi thực tế:

- Chủ quán: bố trí nào giảm thời gian chờ, quầy pha hay robot là nút nghẽn, cần bao nhiêu robot/người hỗ trợ?
- Nhân viên: món/cốc đang ở đâu, vì sao hệ thống chờ, thao tác nào cần người xác nhận, khi lỗi có thể xử lý thế nào?
- Kỹ sư robot: pose và joint nào là feedback, đường đi có va chạm không, model/calibration nào đang dùng, sai lệch và nguyên nhân lỗi nằm ở đâu?
- Đội triển khai: còn thiếu bằng chứng gì để chuyển từ mô phỏng sang bench rồi venue, cấu hình nào được phép đưa ra máy thật?

**“Mock chạy được luôn”** trong bộ tài liệu này là mốc bàn giao đầu tiên phải có launcher và runtime đóng gói, chạy cả giao món lẫn cà phê trên máy phát triển mà không cần LinuxCNC, ROS hay robot. Lượt công việc hiện tại tạo spec/plan; không tuyên bố đã hiện thực launcher hoặc chế độ mới.

## 2. Đọc bộ tài liệu

| Tài liệu | Câu hỏi được giải quyết |
|---|---|
| [Trải nghiệm và yêu cầu sản phẩm](product-experience.md) | Ai dùng, thấy gì, thao tác gì; food delivery và cà phê |
| [Kiến trúc, twin và contracts](architecture-contracts.md) | Quyền sở hữu, modes, data model, API, migration, dữ liệu thật/giả lập |
| [Simulation và tích hợp source](simulation.md) | Mock, Gazebo/Nav2, resource scheduling, coffee workflow và fidelity |
| [Arm, controller và hardware](arm-hardware.md) | LinuxCNC/QtVCP/PUMA, IPC/EtherCAT, local control và commissioning |
| [Kịch bản và nghiệm thu](verification.md) | Scenario IDs, metrics, UX và các gate có evidence |
| [Kế hoạch tổng](../../plans/2026-11-05-digital-twin/README.md) | Thứ tự thực thi, dependency, deliverables và ước lượng |

Tài liệu này mở rộng [spec Lab cũ](../2026-11-01-mekoniq-robot-lab.md) và [integration v1](../2026-11-01-source-integration.md). Với chức năng v2, bộ này là đề xuất thay thế phần roadmap R1/R2/R3; v1/S01 vẫn được giữ để regression. Không đổi trạng thái các checkbox L00–L11 hoặc gate W00–W11 đã có. IDs scenario mới không ghi đè S01–S14.

## 3. Hiện trạng đã khảo sát

| Nguồn | Có thật trong code | Khoảng trống cần xử lý |
|---|---|---|
| `trial/`, HEAD `6298f83` | Node-RED/Valetudo và nghiệp vụ nhà hàng đang là prototype vận hành | Chỉ tham khảo workflow; không sửa hay dùng làm runtime mới |
| `source/`, HEAD `a078777` | Domain, SQLite journal/outbox, robot adapters, W00–W11 | Lab gateway chỉ cho S01/business_sim; chưa có coffee cell/arm controller |
| `lab/`, HEAD `2d31fd5` | Vite/TS/Three, configurator, world, report/replay, runtime artifact pin | Chưa có scene twin liên tục, physics, arm/coffee entities, launcher mock mới |
| `source/packages/robot-adapters/src/simulator.ts` | `SimulatorAdapter`, completion sau thời gian giả lập mặc định 1000 ms | Không tính đường đi, lực, va chạm hoặc thời gian di chuyển theo map |
| `lab/src/app.ts`, `src/runtime/client.ts` | `getRun()` sau action/Refresh; gateway có endpoint snapshot | Chưa có vòng cập nhật telemetry liên tục trong UI; cần triển khai chứ không chỉ ghi polling trong README |
| `lab/src/viewer/robot.ts` và `src/design/catalog.ts` | Mesh minh họa và footprint validation | Chưa cùng geometry source; v2 phải hợp nhất revision/hình học |

Runtime pin hiện tại: commit đầy đủ `a07877718196ffc88832044fad97b027cedd53f4`, protocol 1, artifact theo `lab/config/source-runtime.lock.json`. `source/` đang có thay đổi local chưa commit; bộ tài liệu này không lấy chúng làm runtime release. Khảo sát code là baseline, không thay cho lần chạy kiểm thử mới.

## 4. Lựa chọn kiến trúc

| Phương án | Giá trị | Chi phí / giới hạn | Kết luận |
|---|---|---|---|
| A. Tăng animation trong trình duyệt | Demo nhanh, nhẹ | Lặp business logic, khó kiểm chứng motion và khó nối thiết bị | Chỉ dùng cho UI preview có nhãn |
| **B. Lab + source orchestration + các backend chuyên trách** | Dùng lại nghiệp vụ, mock chạy nhẹ, nâng dần Gazebo/LinuxCNC/hardware, cùng contracts | Cần versioning, clocks, adapter và quản lý evidence | **Chọn** |
| C. Chuyển toàn bộ sang một simulator nặng/cloud ngay | Hệ sinh thái physics/render mạnh | Tăng yêu cầu máy/GPU, không giải quyết source business authority, chậm mock | Chỉ xem xét thêm provider sau khi có nhu cầu đo được |

Không thay UI framework hiện có chỉ để triển khai twin. Dùng Three hiện tại cho scene và TypeScript cho Lab/source. Gazebo/Nav2 dùng cho AMR SIL; LinuxCNC simulation dùng cho arm controller; collision/dynamics arm là một mức kiểm chứng riêng. MoveIt 2 là tùy chọn khi cần lập kế hoạch tránh va chạm, không là điều kiện của PoC PUMA.

## 5. Định nghĩa hoàn thành theo release

| Release | Đầu ra bắt buộc | Chưa chứng minh |
|---|---|---|
| **R-MOCK** | Một lệnh chạy bản đã cài, food + coffee mock, source domain thật, scene live 2D/3D, fault/replay/compare, report có provenance | Motion controller, physics và phần cứng |
| **R-SIM** | Gazebo/Nav2 cho food; LinuxCNC SIM cho arm; coffee station simulated I/O, tích hợp end-to-end; ma trận scenario đạt | Dung sai cơ khí, tải, phanh, nhiệt/chất lỏng thật, an toàn máy |
| **R-READY** | Hardware adapters và packaging, shadow/HIL, cấu hình và validation contract, hồ sơ FAT/SAT, bằng chứng thiếu hiển thị blocked | Không tự có quyền live hoặc chứng nhận chỉ từ software tests |
| **R-PILOT / R-INDUSTRIAL** | Thiết bị cụ thể, calibration, risk assessment, FAT/SAT, runbook, rollback và venue acceptance | Không áp dụng tự động sang robot/drive/venue khác |

R-SIM là tiêu chí **simulation hoàn chỉnh trong phạm vi đã chọn**, không phải hứa sẽ bổ sung sau: backend phải thật sự được chạy trên Linux và lưu evidence. Nếu chỉ làm mock hoặc chỉ có launch file thì không được gắn nhãn đạt R-SIM. Hardware readiness chia `software_ready`, `bench_qualified`, `cell_qualified`, `venue_accepted` để không gộp thành một đèn xanh.

## 6. Phạm vi, giả định và quyết định còn cần dữ liệu

Phạm vi đầu: nhà hàng một tầng, 1–2 AMR, một coffee cell cố định, một arm 6 trục mẫu PUMA, hai recipe minh họa espresso và cà phê sữa đá; handoff một cốc mỗi transfer. Robot arm chưa gắn lên AMR. Default có nhân viên xác nhận load/handoff; automated transfer chỉ bật khi cả hai phía có tín hiệu xác nhận và profile đã cho phép. Recipe volume/duration trong fixture là dữ liệu demo, không là hướng dẫn vận hành thực phẩm.

| Dữ liệu cần chốt | Chủ sở hữu đề xuất | Mốc chặn | Default khi chưa có |
|---|---|---|---|
| Máy pha: hãng/model/API, brew completion, vệ sinh | Product + thiết bị quầy | Coffee hardware | Mock thiết bị với contract rõ; không bịa driver |
| Ice/milk dispenser, load cell, gripper, cup | Cơ điện + food operations | Bench và quality calibration | Model minh họa, giá trị vật lý unknown |
| CAD/DH/URDF, payload, TCP, joint limits arm thật | Robotics/cơ khí | Chuyển PUMA sang robot MEKONIQ | PUMA reference, không gắn mã robot thật |
| IPC, drive/ESI/PDO, kernel/NIC/firmware | Controls | HIL/EtherCAT | Compatibility matrix chờ qualification |
| Mặt bằng, AMR firmware/map và profile đo | Deployment | Shadow/pilot | Fixture restaurant, Valetudo geometry unknown |
| Mục tiêu throughput/quality, giờ cao điểm, nhân sự | Chủ quán/Product | Chốt KPI pilot | Benchmark minh họa; không cam kết ROI |
| Thị trường, safety/food-contact obligations | Safety + đơn vị chuyên môn | Commercial release | Register có owner, không tự nhận conformant |

Những dữ liệu này không chặn viết spec, mock và simulation mẫu; chúng chặn các gate hardware tương ứng. Pha chế/nấu ăn tổng quát, CFD chất lỏng, mô phỏng latte art, fleet diện rộng, tự động thiết kế cơ khí và robot collaborative chưa được đưa vào release đầu.

## 7. Ràng buộc triển khai

- Platform/domain/contracts/adapters đặt trong `source/`; trải nghiệm, project editor/viewer đặt trong `lab/`. Arm controller khởi đầu trong boundary tự đóng gói `source/integrations/arm-controller/`.
- Không sửa `trial/`, không chạm robot đang chạy hoặc cổng `1880`/`1884`; dev UI/runtime vẫn `4175`/`4176`.
- Mỗi run khóa mode, backend versions, model/world/recipe revision và seed. Không có nút biến run simulation thành điều khiển thật.
- Live twin mặc định shadow chỉ đọc. Chỉ controller/executor tại thiết bị được phát lệnh motion; Lab không vào servo loop.
- Chạy nhà hàng không đòi một server mới tại venue: source vẫn theo tablet coordinator/robot hiện có; IPC là controller của coffee cell, không thay vai trò coordinator nhà hàng.
- UI Việt/Nhật/Anh, giữ nhận diện navy/lime. Dashboard cho vận hành và diagnostics cho kỹ sư cùng đọc một trạng thái có provenance.

## 8. Nguồn đầu vào

- Tài liệu người dùng: `/Users/hoangpham/Downloads/MEKONIQ-6DOF-Architecture-Technical-Spec-v1.md`, version 1.0, 2026-11-04. Nội dung được đối chiếu về HMI, machine/app/presentation/integration, simulation-first và safety. Không copy file vào repository để tránh tạo một bản gốc thứ hai.
- Code/repo và tài liệu baseline liệt kê ở mục 3; các đường dẫn implementation cụ thể nằm trong từng plan.
- Các tài liệu primary LinuxCNC, QtVCP, genserkins, IgH/lcec, Gazebo/Nav2 và giới hạn kỹ thuật được dẫn trực tiếp trong [simulation](simulation.md) và [arm/hardware](arm-hardware.md).
