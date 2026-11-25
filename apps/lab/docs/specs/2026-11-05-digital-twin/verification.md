# Nghiệm thu và ma trận bằng chứng

Ngày: 2026-11-05. Trạng thái: **kế hoạch kiểm chứng, chưa phải kết quả test**. Phạm vi theo [trải nghiệm](product-experience.md), [contracts](architecture-contracts.md), [simulation](simulation.md), [arm/hardware](arm-hardware.md). Mọi ngưỡng dưới đây là mục tiêu đề xuất hoặc fixture để hiện thực; chưa có PASS mới được tạo bởi việc viết tài liệu.

## 1. Quy tắc đánh giá

Một run có hai kết quả khác nhau: workflow outcome (`completed`, `cancelled`, `needs_attention`…) và assertion results (`pass`, `fail`, `blocked_external`, `not_run`). Ca fault đạt khi hệ thống giữ invariant và phản ứng đúng, dù mission không completed. `unknown` là tình trạng chưa đủ bằng chứng của command/thiết bị/cargo; không quy đổi thành success hoặc mặc nhiên retry.

ID mới không thay thế S01–S14 trong spec 2026-11-01. Regression S01 hiện tại phải còn chạy qua source domain/journal/dispatcher. Scenario mới được định nghĩa bằng versioned data, seed, inputs, actor actions, fault schedule, assertions và timeout; không nhận script/shell tùy ý. Scripted load/handoff là actor test được ghi danh tính, không phải arrival tự tăng delivered.

| ID | Quy tắc nghiệm thu |
|---|---|
| QA-01 | Mỗi assertion ghi requirement ID, scenario revision, backend/model/capability thực chạy, expected/actual và raw evidence refs |
| QA-02 | Manifest giữ project/world/design/recipe/source/adapter/backend/config hashes, seed, clock và calibration/profile revisions |
| QA-03 | Mock deterministic: cùng inputs/seed/source tạo cùng trace chuẩn hóa và assertions; chuẩn hóa chỉ loại run ID/wall timestamps đã công bố |
| QA-04 | Clock của backend là nguồn thực thi; render FPS/tab visibility/tốc độ replay không đổi domain result |
| QA-05 | Có negative cases trước acceptance: stale, duplicate, missing ACK, no-path, invalid recipe/joints/cup và backend unavailable |
| QA-06 | Report/replay/import không thực thi robot, cell, arm, payment hoặc print; kiểm ở effect/transport boundary |
| QA-07 | Không có backend/capability hoặc thiết bị thì ghi blocked_external/not_run theo nguyên nhân, không fallback để ghi PASS |
| QA-08 | Metrics có đơn vị, khoảng thời gian, engine, sample count và missing-data policy; không suy distance/accuracy từ animation |
| QA-09 | Sửa model/world/recipe/profile làm bằng chứng cũ stale theo scope; giữ bản ghi cũ bất biến và test migration có rollback dữ liệu |
| QA-10 | Freshness, frame và unit conversion được kiểm độc lập; commanded state không được dùng làm observed result |
| QA-11 | UI mất WebGL/disconnect/reload không đổi command ownership hoặc tự lặp tác động; lịch sử nối lại bằng cursor/session contract |
| QA-12 | Gate hardware chứa identity, calibration, đo thực và owner ký đúng phạm vi; mock/simulation không tự nâng gate |

## 2. Bằng chứng nào hợp lệ ở từng backend

| Điều muốn kết luận | Mock source runner | Gazebo/Nav2 | LinuxCNC simulator | Hardware |
|---|---|---|---|---|
| Nghiệp vụ/allocation/cup ownership/idempotency | Domain + journal thật, devices/process giả lập | Chỉ có khi nối cùng source domain | Chỉ có khi nối cùng source domain | Domain + observation đúng thiết bị |
| Đường đi/vật cản/footprint | Geometric/kinematic model, không động lực học | Nav2 + simulated sensor + model/contacts thực chạy | Không cung cấp navigation | Pose/contact/stop đo được, trên test đã chạy |
| Arm FK/IK/joint trajectory | Model toán/runner có revision | Chỉ khi có arm engine/model tương ứng | Controller kinematics/joint traces từ sim thực chạy | Encoder/drive/controller evidence đúng thiết bị |
| Collision arm/vật/cup | Chỉ khi collision checker thực chạy, ghi engine/model | Chỉ khi collision geometry + checker/physics được nối | Không tự có; cần collision engine riêng | Sensor/đo/giám sát thích hợp; không suy từ controller ACK |
| Lượng cà phê/sữa/đá, brew state | Process model + synthetic sensor fixture | Vẫn cần process model; physics scene không tự cung cấp lượng | Không tự cung cấp | Sensor/cân/flow/brew device đã calibration phù hợp |
| Độ bám cốc, lực grasp, spill, stop distance | Không chứng minh vật lý | Chỉ kết luận trong model đã khai báo; không tự là hardware | Không tự cung cấp | Phép đo/quan sát thực đã thiết kế |

Một run simulation có thể phối hợp `gazebo_nav2` + `linuxcnc_sim` + process/collision model. Manifest ghi từng engine, timestamp/clock mapping và claim scope. Thiếu một engine làm assertion phụ thuộc engine đó blocked/not_run; không vì engine khác xanh mà đánh PASS toàn bộ cell.

## 3. Catalog scenario giao món

M = mock, S = simulation với capability tương ứng, H = hardware có profile/test được duyệt. “M/S/H” không có nghĩa cùng một loại bằng chứng; áp dụng bảng mục 2.

| ID | Setup/trigger | Kết quả bắt buộc | Mode / requirement |
|---|---|---|---|
| FD01 | Một order, một robot, bếp→bàn 1→parking | 0 delivered trước load/handoff; đúng allocation; arrival từ observation; ba chặng có trace; về parking không tự charging | M/S/H; FD-01/02/04/08 |
| FD02 | Hai bàn, nhiều khay, trộn món và cốc có IDs riêng | Xác nhận bàn A chỉ chuyển allocation của A; không trộn khay/cup; remaining stops và cargo đúng | M/S/H; FD-01/04/08 |
| FD03 | Người cắt ngang route theo lịch; sau đó rời lối | Mock tránh/đợi đúng model; S phản ứng theo sensor/Nav2; không xuyên vật cản trong model; resume có nguyên nhân | M/S; H cần bài test người/vật thay thế được duyệt; FD-02/03 |
| FD04 | Ghế chắn đích; variant bịt kín lối; variant mở lại lối | Không false arrival; no-path/blocked/attention có lý do; không teleport; mở lại lối chỉ resume theo policy | M/S/H; FD-02/03 |
| FD05 | Payload vượt, pin dưới admission, thiếu capability hoặc thiếu target binding | Từ chối trước native start với mã đúng; không giảm hàng hoặc đánh served | M/S/H; FD-05 |
| FD06 | Cancel/retarget lúc robot đang giữ món/cốc | Mission ngừng đúng evidence; cargo còn được ghi rõ; cần return/unload/disposition; không báo delivered | M/S/H; FD-04/06 |
| FD07 | Hai robot tranh hành lang hẹp và vị trí pickup cell | Một owner/reservation theo policy; không deadlock không phát hiện; unknown không tự giải phóng vùng chỉ vì TTL | M/S/H; FD-07 |
| FD08 | Đổi map revision; pose stale; localization lost trước arrival | Chặn dispatch/arrival hoặc attention; last-known pose được đánh stale; map mới cần binding mới | M/S/H; UX-14, UX-16, UX-17, FD-05 |

FD03/FD04 phải lưu sampled trajectory và khoảng cách/contacts từ engine. Mock không dùng một fault boolean `blocked` làm bằng chứng đã có avoidance. FD07 mock chứng minh coordination/resource logic; simulation cần cả reservation và hai robot thực chạy trong world để kết luận hình học/chuyển động.

## 4. Catalog scenario cà phê

Ưu tiên đã chốt với người dùng: máy cà phê, đá/sữa và arm phục vụ. Có hai recipe mẫu **espresso** và **cà phê sữa đá**. Thứ tự brew/ice/milk là dữ liệu của từng recipe; không hardcode một thứ tự chung. Không mô phỏng CFD chất lỏng nóng; vẫn kiểm machine readiness, cycle completion, cup state, measurement, cold-handling/cleaning metadata và handoff.

| ID | Setup/trigger | Kết quả bắt buộc | Mode / requirement |
|---|---|---|---|
| BV01 | Chạy từng recipe mẫu; machine ready; cốc đúng; nguyên liệu đủ; arm lấy và chuyển robot tới bàn | Recipe steps đúng revision; espresso không chạy đá/sữa; cốc có một owner; verified dose trước pickup; đúng cup/order tại bàn | M/S/H; BV-01/03/04/05/08 |
| BV02 | Không có cốc, sai loại/capacity hoặc lấy cốc ra giữa brew/dispense | Không khởi động khi thiếu cốc; khi mất cốc thì theo interlock policy, ghi partial/unknown rõ; không báo cup ready | M/S/H; BV-02/07 |
| BV03 | Hết sữa/nguyên liệu; kẹt bộ cấp đá; hai order cùng đòi máy/arm; robot pickup chưa sẵn sàng | Không dùng chung resource trái policy; fail/queue với lý do; lượng thực/partial state được giữ; retry không làm cộng lượng mù | M/S/H; BV-02/07 |
| BV04 | Brew/dispense timeout; thiếu/thừa cà phê/sữa/đá; sensor outlier | Không ready nếu ngoài tolerance hoặc chưa có measurement đủ tin cậy; lưu requested/observed/accepted riêng; recipe-specific recovery | M/S/H; BV-03 |
| BV05 | Mất ACK sau brew/dispense accepted; disconnect/reboot; gửi lặp cùng command ID | Một tác động hoặc unknown có reconcile; không tự brew/dispense lần hai; lifecycle cup/liquid không reset | M/S/H; BV-06 |
| BV06 | Cup/order/recipe revision mismatch, trình tự step sai hoặc vượt capacity/headspace | Từ chối trước bước không hợp lệ; không chuyển cốc khác tới order; không lấy recipe mới cho run cũ | M/S/H; BV-01/05 |
| BV07 | Pickup timeout, dock lệch, arm đặt chưa xong, cancel giữa cycle/handoff | Robot chưa được rời khi chưa nhận đúng cốc; arm/robot không cùng sở hữu cốc; có disposition cho cốc đầy/dở/unknown | M/S/H; BV-05/07 |
| BV08 | Machine not ready; cleaning overdue; milk batch/open-time/cold-handling hoặc sensor freshness không đạt policy fixture | Chặn step liên quan có mã lý do; xác nhận readiness mới chỉ mở bước được phép; không tự bỏ interlock sau reboot | M/S/H; BV-02/07/08 |

Campaign phối hợp chọn FD02 + FD07 + BV01 + BV03: food và coffee chạy đồng thời trong workload có version; đo queue/travel/human wait/cell busy riêng. Mục tiêu là tìm contention thực tế, không tạo thêm scenario ID trùng ý nghĩa. Counter chỉ tính đồ uống served sau đúng handoff cuối, không sau brew complete.

## 5. Catalog arm 6DOF và hệ thống

| ID | Setup/trigger | Kết quả bắt buộc | Requirement category |
|---|---|---|---|
| ARM01 | Pose/joint fixture hợp lệ; kiểm FK độc lập, IK seeded, trajectory approach→grasp→place | Unit/frame đúng; residual dưới profile tolerance; joint continuity/configuration hợp lệ; trace commanded/observed riêng | ARM-*, UX-13, UX-14, UX-15 |
| ARM02 | Target ngoài workspace; joint limit vượt hoặc cấu hình không hợp lệ | Solver/controller từ chối có lý do, không clip rồi nhận success; không phát trajectory ngoài giới hạn | ARM-* |
| ARM03 | Self-collision hoặc arm/cup/fixture/robot va chạm theo checker; có vật cản nằm giữa hai sample trajectory | Kiểm cả vùng quét của links/gripper/cốc đang giữ, phát hiện va chạm giữa samples; chặn hoặc phát hiện đúng expected result; lưu collision engine/model, tolerance và cặp geometry; viewer overlap không là bằng chứng | ARM-*, UX-19 |
| ARM04 | Gần singularity, đổi IK branch, vượt velocity/acceleration | Policy giữ continuity hoặc từ chối; trajectory có giới hạn thực; lưu solver/controller trace | ARM-* |
| ARM05 | Following error/stop/E-stop trong chuyển động rồi reset | Phân biệt request/ACK/observed stop; reset không tự resume; actual joint/cup state được reconcile | ARM-*, HW-* |
| ARM06 | Mất liên lạc/reboot sau accepted trước completed | Không gửi lại mù; command unknown giữ resource/cup ownership tới reconcile; reconnect không tự chạy | ARM-*, HW-*, BV-06 |

Các fixture PUMA/LinuxCNC phải test explicit source units→SI: inch→m, degree→rad và frame convention; không chỉ kiểm GUI trông đúng. Test singularity phải nêu đúng joint/configuration trong model, solver version và seed. Tên joint dễ nhầm 0-based/1-based phải được mapping rõ. Tolerance ở mục 7 chỉ là độ nhất quán model, không là độ chính xác cơ khí.

| ID | Setup/trigger | Kết quả bắt buộc | Requirement chính |
|---|---|---|---|
| SYS01 | Cùng project/scenario/seed, render 15/60 FPS, tab background, tốc độ chạy khác | Trace chuẩn hóa mock và assertions như nhau; render không là clock; manifest có backend set | QA-02/03/04 |
| SYS02 | Mất UI/gateway/executor khác nhau; crash sau accept; reconnect/reclaim | Không đổi owner hoặc nhân đôi effect; phân biệt stale/unknown; recovery trace đủ | FD-06, BV-06, QA-05/11 |
| SYS03 | Duplicate/reordered/delayed observations, stale retained completion | Không hồi sinh terminal state, không tăng served/dose lần hai; correlation/sequence hợp lệ | QA-05/10 |
| SYS04 | Sửa geometry/recipe/profile; import schema cũ/malformed; reopen saved run | Migration rõ; bad import không phá project; report cũ immutable và stale theo scope | UX-12, UX-16, UX-20, QA-09 |
| SYS05 | Replay/scrub/import/export report; bỏ action-like fields vào artifact | Không có effect hoặc network call điều khiển; input lạ bị từ chối/giữ inert theo schema | UX-09, QA-06 |
| SYS06 | Backend thiếu/sai version; đang run đổi mode; backend chết giữa run | Block với reason; không fallback; run backend immutable; unknown giữ đúng | UX-19, QA-07 |

## 6. Gates giao hàng

| Gate | Đầu vào và bắt buộc đạt | Đầu ra được phép tuyên bố |
|---|---|---|
| G-DOC | Các spec/plan liên kết nhất quán; schema owner, mode/backend và acceptance rõ | Sẵn sàng implementation; không có runtime PASS |
| G-MOCK | Source packaged TS runner chạy local không cần Linux/robot; FD01–FD08, BV01–BV08, ARM01/02/04/06 theo mock capabilities, SYS01–SYS06; replay/trace/UI task tests; ARM03 chỉ PASS nếu có checker | Luồng food + coffee + arm mock chạy được, kết quả deterministic đúng scope; giữ hardware not_run |
| G-SIM-NAV | Linux/ROS/Gazebo/Nav2 thực chạy, model/world cùng revision; FD01/03/04/07/08 và faults/recovery liên quan, raw pose/sensor/contact/action logs | Navigation/SIL evidence trên engine/model đã pin |
| G-SIM-ARM | LinuxCNC simulator thực chạy; ARM01–ARM06 theo capability; **ARM03 bắt buộc có geometric collision checker cho arm và vùng quét cốc đang giữ**; coffee process model được nối và BV01/04/05/07 | Controller/kinematic/process/geometric collision evidence tách rõ; không claim lực/độ bám/cơ khí |
| G-SIM-E2E | Food + coffee + arm phối hợp trong scenario; clock mapping và resource ownership đúng; BV01–BV08 và SYS cases liên quan có evidence | Simulation end-to-end đúng bộ engines/config; partial coverage hiện rõ |
| G-HW-READY | Connector contract/conformance, profile/schema/mapping, dry-run, version checks, disable/stop/reconcile paths, commissioning runbook | Phần mềm có đường tích hợp hardware cụ thể; chưa là physical acceptance |
| G-HW-ACCEPT | Đúng robot/arm/máy pha/ice/milk device, calibration, payload/cup/temperature/stop/network tests và người phụ trách; shadow/HIL/live scope có evidence riêng | Đã kiểm thử đúng tuple thiết bị/firmware/config/scenario, không tự venue approved |
| G-VENUE | Layout/map thực, operator training, vận hành và source gates liên quan, rollback, acceptance tại nhà hàng | Phạm vi venue được chấp thuận theo hồ sơ |

Không có Linux/ROS hoặc LinuxCNC thì vẫn hoàn tất các deliverable code/tests mock và adapter fixtures đã có, nhưng G-SIM tương ứng `blocked_external`; phải để nguyên task kiểm chứng thật chưa đạt. Không có thiết bị thì G-HW-READY có thể đạt bằng hồ sơ/conformance, G-HW-ACCEPT còn blocked_external. Một matrix có phần blocked không được gọi “toàn bộ đã PASS”.

Full R-SIM yêu cầu ARM03 đạt với self-collision, arm với scene/robot, gripper/cốc gắn vào tool và toàn bộ vùng quét trajectory. Checker có thể dùng continuous collision detection hoặc chia nhỏ chuyển động theo bound/tolerance được chứng minh bằng test; chỉ kiểm endpoints hoặc ảnh render không đủ. Phải có case endpoints đều trống nhưng đoạn giữa va chạm. Chưa có checker hoặc chưa xử lý cốc đang giữ thì G-SIM-ARM và R-SIM chưa đạt. Dynamics, lực grasp, ma sát, chất lỏng/tràn và closed-loop plant là các mức mở rộng tùy chọn; không cần chúng để kết luận geometric collision, và geometric PASS không chứng minh các thuộc tính đó.

## 7. Ngưỡng đề xuất và phương pháp đo

Các giá trị này là điểm bắt đầu có thể review, không phải số đo hiện tại. Profile test phải chốt giá trị trước run; không đổi tolerance sau khi xem kết quả để biến fail thành pass.

| Đối tượng | Mục tiêu ban đầu | Phương pháp/giới hạn |
|---|---|---|
| Mock correctness | 20 seed cố định/scenario có randomness; 3 lần lặp mỗi input; 0 invariant violations, cùng normalized trace | Scenario không có randomness ghi rõ seed chỉ provenance; không gọi 20 lần cùng trace là 20 perturbations |
| Mock control loop | dt fixture 20 ms; UI pose ≥10 Hz; thay render FPS không đổi result | dt có thể khác theo backend, luôn ghi trong manifest; không đồng nhất với real-time deadline |
| Simulation repetitions | Ít nhất 10 lượt/ca dynamic/navigation trọng yếu, perturbations bounded có seed/config | So invariants/tolerances, không yêu cầu trajectory bit-identical; báo cả failures và run bị loại cùng lý do |
| Arrival fixture mobile | Sai số vị trí ≤0,10 m, yaw ≤0,17 rad, tốc độ ≤0,02 m/s giữ ≥0,5 s | Chỉ profile demo ban đầu; bàn/cell cần tolerance riêng. Collision/clearance và explicit handoff vẫn bắt buộc |
| Physical navigation claims | 0 contact không mong đợi trong tập test; no-path không false arrival | Gazebo contact logs không chứng minh robot thật; số 0 trong 10 lượt không là bảo đảm an toàn phổ quát |
| Arm FK consistency | Vị trí ≤1e-6 m, góc quaternion geodesic ≤1e-6 rad | Double-precision model so với reference độc lập; exact geometry/frames cùng revision |
| Arm IK fixture | Residual ≤0,001 m và ≤0,0087266463 rad (0,5°), đồng thời đúng limits/continuity | Solver/version/seed rõ; không đo mechanical accuracy hay repeatability |
| Coffee/ice/milk process | Target/tolerance, timeout, cup capacity/headspace theo recipe; test các biên dưới/trên và partial cycle | UI g/mL/°C đúng sensor, canonical kg/m³/K với exact decimal; test conversion round-trip và conservation. Fixture 250 mL ±5 mL chỉ dùng bài đo tổng quát riêng; không mặc nhiên áp cho espresso/sữa/đá |
| Telemetry freshness | Đề xuất pose/joints stale sau 500 ms monotonic receipt age; disconnect sau 2 s monotonic time mất heartbeat | Backend profile có thể chặt hơn; sim pause hiển thị FROZEN_SIM và tuổi dữ liệu thật, miễn stale alarm chỉ khi pause đã được xác nhận; heartbeat transport độc lập; hardware không có ngoại lệ này |
| Replay correctness | 100% event ordering/correlation giữ nguyên; 0 effect; gap rõ | Nội suy chỉ đoạn có dữ liệu hợp lệ và dưới max gap được khai báo; không tạo bằng chứng sensor mới |
| UI performance | Scene mẫu 2 robot + 1 arm + 6 bàn: mục tiêu p95 frame ≤33 ms desktop, ≤50 ms tablet 2D | Ghi device/browser/resolution, capture ≥60 s; không ép tải 3D trên mobile/reduced-motion |
| Usability | Bắt đầu mock/đến chờ tải ≤3 phút; complete/report ≤5 phút; tìm nguyên nhân lỗi ≤2 phút | Ít nhất 5 người mới; báo median/range và task failures; không dùng developer tự chạy làm số liệu duy nhất |

Các ngưỡng phần cứng (dose, nhiệt độ/cold handling, speed/stop, lực gripper, payload, docking, accuracy) do profile/thiết bị/recipe đã chọn quyết định, cần số đo và owner duyệt trước live tests. Không sao chép fixture trên làm tiêu chí nghiệm thu máy thật.

## 8. Report, artifacts và lệnh kiểm tra

Mỗi campaign có manifest và bảng assertion đọc được bằng máy, summary người đọc, event journal, pose/joint/process traces, native command receipts/results, faults, engine logs và ảnh/video khi có ích. Timestamps ghi sim time/wall time và clock mapping; engine/version/image digest/license/model source được giữ trong manifest. Raw data có checksum, nơi lưu, retention và redaction policy; screenshot không thay raw trace.

Từ baseline tiếp tục chạy các lệnh có thật trong [package.json](../../../package.json): `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:e2e -- ui.spec.ts`, `pnpm test:runtime-e2e`. Lệnh cuối mở runtime artifact đã pin trên cổng test theo script, kiểm S01 thật; Playwright thường có thể skip S01 khi thiếu token. Skip không là PASS tích hợp.

Plan triển khai phải thêm runner headless/campaign command và suites cho mock, Gazebo, LinuxCNC, hardware conformance vào repository sở hữu chúng; ghi tên lệnh thực tế khi đã có, không trình bày lệnh chưa tồn tại như đang dùng được. Suites dự kiến: scenario determinism/domain, world/compiler parity, transform/units, navigation/arm/process adapters, transport recovery, browser run/replay, migration và evidence validator. Test meaningful behavior ở boundary, tránh snapshot mirror implementation.

Môi trường kiểm không dùng các cổng robot đang vận hành 1880/1884; không start/stop trial. Không tự import/apply candidate lên thiết bị chỉ để tạo evidence. Docs-only change hiện tại cần kiểm link, requirement/scenario cross-reference và tính trung thực của baseline; không chạy physics/hardware để đánh dấu hoàn tất tài liệu.

## 9. Truy vết giao hàng

| Nhóm yêu cầu | Scenarios | Bằng chứng chính |
|---|---|---|
| UX-01…UX-20 | Browser tasks, FD01, BV01, SYS04–SYS06 | E2E, usability notes, perf capture, keyboard/2D fallback |
| DT-01…DT-05; UX-13…UX-20 | ARM01, FD03/04/08, SYS01/04/06 | Theo architecture; geometry/frame parity, provenance/freshness, immutable manifests và residual prediction/actual |
| FD-01…FD-08 | FD01–FD08 | Source journal, planner/pose/contact traces, allocation/cargo assertions |
| BV-01…BV-08 | BV01–BV08, ARM01–ARM06 | Recipe/process measurements, cup ownership, resource/command traces |
| ARM-* / HW-* | ARM01–ARM06 và BV01/05/07 | Theo [arm/hardware](arm-hardware.md); controller logs và hồ sơ thiết bị đúng scope |
| SIM-* | FD03/04/07, BV01/04/05, ARM03/04 | Theo [simulation](simulation.md); engine launch/clock/model/trace evidence |
| CORE-* | SYS01–SYS06 và các scenario domain | Theo [contracts](architecture-contracts.md); schemas, ownership, transport, reconciliation |
| QA-01…QA-12 | Toàn bộ campaign | Evidence validator, coverage matrix, negative cases, gate decision |

Definition of done của từng task là code/config/docs cần thiết + test thích hợp + evidence hoặc blocker cụ thể. Một task dựng adapter có thể hoàn tất khi conformance đạt, nhưng task chạy backend/thiết bị thật vẫn mở cho đến khi có bằng chứng tương ứng. Không đánh hoàn tất checkbox kiểm chứng chỉ vì đã có scene, nút hoặc interface.
