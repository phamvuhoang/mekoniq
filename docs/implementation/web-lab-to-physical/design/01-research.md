# Nghiên cứu — từ implementation R2a tới web Lab và Linux

**Kiểm ngày 2026-11-13.** Phân biệt ba loại: **quan sát repository**, **thông tin upstream**, **đề xuất/suy luận**. Lần này đọc code, Git, spec/plan, evidence và tài liệu chính thức; không chạy lại simulation, không đo FPS mới, không thử Linux và không deploy.

## Cập nhật bằng chứng R2a — 2026-11-14, 09:00 ICT

Phần nghiên cứu ngày 13/11 bên dưới giữ nguyên như snapshot lịch sử. Đọc lại local `source/main 11d25b47a18adafb88ac21adc249499109996bc5`, `lab/main a7449541e118d01f65af0ad1466e0c963a173f3c` cho thấy bằng chứng mới; đây là đọc artifact đã lưu, không phải lần chạy cloud mới của task R2b.

- [CL01 Cloud Run](../../evidence/cloud-run/mekoniq-2026-11-14/README.md): runtime pin `4f893ac6fb75dff414a3ee42a726defb7935c734`, image `linux/amd64` digest `fbdf4bb5c1af4ffd15c01550b4508b6df0ad3b4d69e444e5469cfe2b52e4b009`; HTTP MJ-BV01 hoàn tất tick 4800, served=2. Lần kiểm cuối ghi 00:55:53–00:57:13 UTC. Qualification R2a gốc không bị sửa; G-CLOUD1 có bằng chứng bổ sung `tested`, chưa accepted.
- [Kiểm production bằng Chrome](../../evidence/production/r2a-2026-11-14/README.md): Lab HTTPS chạy qua Cloud Run, MJ-BV01 hoàn tất tick 4810, served=2. Khác tick với HTTP do kích thước nhóm bước; không phải phép đo CPU hay nhịp 1×. [Walkthrough R2a](../../../../artifacts/mekoniq-r2a-demo-guide.html) là tài liệu demo offline, không phải runtime replay hoặc engine trong browser.
- Lần giả lập amd64 trên Mac thất bại vẫn được giữ. Bằng chứng cloud mới chứng minh ca R2a này chạy được trên amd64 thật ở pin đã ghi; chưa xác định nguyên nhân khác biệt với giả lập và chưa thay thế bộ L01 gồm 10 grasp trials, 3 seeds, fault cases, inventory/clock/performance hay campaign R2b.
- Runtime hiện hành R2b nằm trên worktree riêng và có pin khác. Không suy từ kết quả R2a thành B04/B05/B06 đã hoàn thành, quyền deploy bản mới, hoặc robot thật đã được kiểm. Giới hạn RAM/session/restart của dịch vụ R2a vẫn cần xử lý ở B09 cho mục tiêu phiên dài.

## 1. Baseline từ repository

Các HEAD/pin trong [README](README.md#3-những-gì-đã-có-và-những-gì-chưa-có) là snapshot, không phải release pin cho implementation tương lai. Task B00 phải chụp lại sau R2a.

| Evidence trong snapshot 13/11 | Source / Lab ghi bằng chứng | Kết quả và giới hạn |
|---|---|---|
| [LinkForge/IR-SIM candidate-07](#h-lf07) | `9b8f92f…` / `26a679d…` | 6 gate tested; acceptance sidecar của Henry; native/hardware/MuJoCo ngoài phạm vi |
| [R1 candidate-05](#h-r105) | cùng cặp commit | 6 gate tested, sidecar accepted; ALG04 chưa chạy; WB-FD07 tuần tự hóa mission qua reservation, chưa chứng minh tranh chấp tự do |
| [R1.1 candidate-02](#h-r1102) | cùng cặp commit | 4 gate tested, sidecar accepted; chỉ giữ suite results và screenshot, không giữ report/arm trace từng run; sidecar còn ghi trace cap 4.000 mẫu chưa có marker |
| R2a tại HEAD | source mới hơn Lab pin | Code fixture/worker/gateway/UI/recorder đã có; chưa có candidate trong cây; không coi tests trong lịch sử là qualification HEAD |

`qualification.json` của các candidate cũ vẫn `accepted:false`; chữ ký/chấp nhận nằm trong `acceptance.json` gắn hash record. Không sửa JSON cũ để “đồng bộ trạng thái”.

Các spec/plan đã đối chiếu: [LinkForge/IR-SIM](../../../superpowers/specs/2026-11-08-linkforge-irsim/README.md), [contracts](../../../superpowers/specs/2026-11-08-linkforge-irsim/contracts.md), [workers](../../../superpowers/specs/2026-11-08-linkforge-irsim/workers-runtime.md), [verification](../../../superpowers/specs/2026-11-08-linkforge-irsim/verification.md), [plan](../../../superpowers/plans/2026-11-08-linkforge-irsim/README.md); [R1 spec](../../../superpowers/specs/2026-11-10-simulation-extension-design.md), [plan](../../../superpowers/plans/2026-11-10-simulation-extension/README.md); [R1.1 spec](../../../superpowers/specs/2026-11-10-webots-arm-design.md), [plan](../../../superpowers/plans/2026-11-10-webots-arm/README.md); [R2a spec](../../../superpowers/specs/2026-11-12-realistic-arm-web-ui-design.md), [plan bốn gói](../../../superpowers/plans/2026-11-12-realistic-arm-web-ui/README.md). Các ghi chú “đã chốt khi triển khai 13/11” trong R2a được ưu tiên hơn lời hứa ban đầu của plan đó.

## 2. Phát hiện từ implementation

| ID | Quan sát và nguồn code | Hệ quả cho bộ mới |
|---|---|---|
| F01 | [PlantPort](../../../../packages/lab-runtime/src/v2/navigation2d/plant.ts) chỉ bọc worker/identity cho AMR. [Dispatcher](../../../../packages/lab-runtime/src/v2/navigation2d/readiness.ts) chọn nhánh arm trước, rồi nhánh AMR. `scenario-runner.ts` và `navigation2d/runner.ts` vẫn là hai runner | Chọn đồng thời `mujoco_arm` và AMR mới chưa tạo co-simulation. R2b.2 cần seam cho một world, có test đếm đúng một step |
| F02 | [MuJoCo engine](../../../../robotics/simulation-mujoco/mujoco_worker/engine.py) chỉ có arm cell. `compile_cell`, `session`, `snapshot` gắn với scene arm, không có chassis/wheel plant | R2b phải thêm compiler mobility và loại scene mới; không chỉ thêm catalog entry |
| F03 | [sim3d schema](../../../../packages/contracts/schemas/sim3d-worker-v1.schema.json) đã có `velocities`, `jointTargets`, `gripperTargets`, `propPlacements`, snapshot `robots/arms/props` | Giữ envelope `mekoniq-sim3d/1`; mở optional data cho dynamics và ownership vật lý, tránh protocol mới khi không cần |
| F04 | [MuJoCo arm ports](../../../../packages/lab-runtime/src/v2/simulation3d/mujoco-arm-ports.ts) đặt cốc tại vòi và đưa ra khỏi cảnh khi custody chuyển sang AMR mock; khay là support tĩnh; allowed contacts hiện không giới hạn theo phase | R2b.2 thay semantics ở **set mới**: khay thuộc chassis, cốc tiếp tục là free body; phép chạm phải gắn phase và pair cụ thể. R2a giữ nguyên |
| F05 | [Navigation evidence](../../../../packages/lab-runtime/src/v2/navigation2d/evidence.ts) có bốn stream cố định; pose3d chỉ z/roll/pitch; quota 100 MiB và 30.000 tick. SSE là lossy | Không gắn metrics contact vào SSE rồi gọi đó là bằng chứng. Thêm artifact physics có schema/limits/coverage riêng, giữ bốn stream cũ |
| F06 | [compareRuns](../../../../packages/lab-runtime/src/v2/comparison.ts) cố ý trả `delta:null` khi backend/fidelity/scenario khác. [Residuals](../../../../packages/lab-runtime/src/v2/residuals.ts) có scope/clock/calibration riêng | Không dùng trực tiếp hai module này để xếp hạng MuJoCo/Webots/IR-SIM. Tạo semantic study riêng; cùng engine/profile mới A/B định lượng |
| F07 | [pid-v1](../../../../packages/lab-runtime/src/v2/control/pid.ts) có oracle nhưng chưa là wheel controller. R2a dùng position actuator | “PID vào plant” là lựa chọn thiết kế cũ, không phải tính năng người dùng cần để xem tải. Đề xuất velocity servo giới hạn lực trước; PID thành experiment độc lập |
| F08 | [MuJoCo lock](../../../../robotics/simulation-mujoco/requirements.in) pin 3.17.0. [Spike M00](../../../research/2026-11-mujoco-arm-spike.md) và [image notes](../../../../deploy/lab-runtime/README.md) ghi arm64 hoàn tất, amd64 giả lập hỏng lần gắp đầu với BADQACC/PLANT_UNSTABLE | Không quy kết lỗi chắc chắn do Rosetta. Cần thử native amd64 trước khi quảng cáo Cloud Run; giữ engine pin đã được R2a qualify |
| F09 | [Build image](../../../../deploy/lab-runtime/build.sh) và recorder yêu cầu source sạch; image chỉ mang mock và MuJoCo arm, không mang IR-SIM/Webots/algorithm | Bộ mới nằm ngoài repo đang chạy. Runtime image cho R2b cần cập nhật closure có chủ ý; không mặc định Linux image có mọi backend |
| F10 | [Target client](../../../../../lab/src/runtime/target.ts), [fetch SSE](../../../../../lab/src/runtime/fetch-event-source.ts), [sample buffer](../../../../../lab/src/twin/sample-buffer.ts), [twin3d](../../../../../lab/src/viewer/twin3d.ts), các panel của R2a đã giải quyết kết nối/viewport cơ bản | Kế thừa UI R2a; chỉ thêm flow chạy, phase, tải, replay. Không thiết kế lại toàn Lab lần nữa |
| F11 | [Replay](../../../../../lab/src/reports/replay.ts) không import runtime client; [evidence store](../../../../../lab/src/reports/evidence.ts) có saved/imported reports | Đây là nền cho demo xem ngay không cần runtime. Cần manifest+chunk đóng gói và coverage, không phát lại bằng engine mới |
| F12 | [Native factory](../../../../packages/lab-runtime/src/v2/sil/native-providers.ts) hardcode fixture BV01 và PUMA/LinuxCNC; [SIL CLI](../../../../packages/lab-runtime/src/v2/sil/cli.ts) trả `ENGINEERING_LIFECYCLE_UNAVAILABLE` cho engineering sets | R3 không thể chỉ “chạy native có sẵn” để đạt parity với xArm/Serve hiện tại. Cần nối lifecycle engineering; legacy smoke vẫn có giá trị trong phạm vi cũ |
| F13 | [Catalog](../../../../packages/lab-runtime/src/v2/capabilities.ts) còn đánh dấu `moveit_gazebo_arm`/`engineering_coffee_process` chưa implement. [Vendor lock](../../../../robotics/manipulation/vendor.lock.json) pin **humble**, chỉ nhập description như dữ liệu; qualification native `not_run` | Asset pin không phải driver pin. Nhánh xArm native cần commit Jazzy/submodules/config/license riêng và kiểm lại model |
| F14 | [engineering-amd64 lock](../../../../robotics/simulation/profiles/engineering-amd64.lock.json) có packages/digests `null`, cấm linuxcnc-uspace; [native environment](../../../engineering-lab/native-environment.md) chưa qualified | Tách môi trường ROS và LinuxCNC; không cài CNC vào profile engineering rồi bỏ guard |
| F15 | [Commissioning](../../../operations/robot-commissioning.md) và [calibration](../../../engineering-lab/calibration-protocol.md) đã có validator, signature, measured-data policy; chassis instances chưa có thông số nhà cung cấp | Dùng lại ladder và validator. Không điền S100/ZLTECH hay sức tải từ suy đoán; chưa chốt hardware là trạng thái hợp lệ |
| F16 | Fix HEAD R2a: clock kiểm tổng substeps, slip đo trong TCP frame, report tách design asset khỏi simulated arm | R2b phải carry các regression này. Không tính slip bằng vị trí world hay dùng assetRef trang trí làm identity của plant |

## 3. Nguồn upstream kiểm lại

Các quyết định kiến trúc dưới đây là **suy luận của bộ tài liệu**, không phải bảo đảm từ vendor. Không cài/nâng package trong lần nghiên cứu này.

| ID | Nguồn chính thức | Điều xác nhận được và tác động |
|---|---|---|
| U01 | [MuJoCo changelog](https://mujoco.readthedocs.io/en/latest/changelog.html) | 4.0.1 ngày 11/11/2026 sửa lỗi sparse Cholesky của 4.0.0 có thể làm solver sai/phân kỳ; 3.17.0 ngày 22/10 vẫn là pin R2a. Có bản mới không đủ lý do đổi engine giữa bàn giao |
| U02 | [MuJoCo 3.17 — computation](https://mujoco.readthedocs.io/en/3.17.0/computation/index.html) | Actuator và soft-contact có mô hình riêng; lực tiếp xúc mô phỏng không là lực đã đo. Chọn servo hữu hạn và ghi tham số tiếp xúc; kiểm load/slip trên fixture, không tuyên bố safety |
| U03 | [MuJoCo 3.17 — simulation](https://mujoco.readthedocs.io/en/3.17.0/programming/simulation.html) | `mjModel`/`mjData` là trạng thái engine; tính tái lập phụ thuộc cấu hình/đường tính. Lưu observations để replay; checkpoint workflow không tự đủ khôi phục world sau crash |
| U04 | [Gazebo — ROS pairing](https://gazebosim.org/docs/harmonic/ros_installation/) | Tài liệu nay khuyên bộ mới Lyrical/Jetty/Ubuntu 26.04 cho dự án mới, nhưng Jazzy/Harmonic/24.04 vẫn là cặp hỗ trợ. Giữ pin repo cho R3 để kiểm một biến tại một thời điểm |
| U05 | [xarm_ros2 nhánh Jazzy](https://github.com/xArm-Developer/xarm_ros2/blob/jazzy/ReadMe.md) | Hãng có nhánh Jazzy/Ubuntu 24.04, hỗ trợ Harmonic; ghi rõ các plugin mimic/realsense cũ chưa hỗ trợ. Fake hardware, Gazebo và driver thật là các đường khác nhau. G2/mimic cần spike riêng, không suy từ mesh đẹp |
| U06 | [ros2_control Jazzy — diff drive](https://control.ros.org/jazzy/doc/ros2_controllers/diff_drive_controller/doc/userdoc.html) | Có odometry và giới hạn vận tốc/gia tốc/jerk. Hợp đồng motion limit có thể dùng để đối chiếu với native; không cần sao chép controller ROS vào browser |
| U07 | [LinuxCNC 2.9 — getting LinuxCNC](https://linuxcnc.org/docs/2.9/html/getting-started/getting-linuxcnc.html) | `linuxcnc-uspace` có thể chạy SIM trên kernel thường; vận hành máy cần realtime phù hợp. SIM pass không là chứng minh latency/stop của máy thật |
| U08 | [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract) | Đích x86_64, manifest multi-arch cần linux/amd64; filesystem ghi không bền qua instance. Không dùng arm64 pass làm CL01; giữ export run và crash semantics |
| U09 | [Cloud Run session affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity) | Affinity là best effort, có thể chuyển instance. `max-instances=1`/cookie affinity không thay giao thức ownership hoặc lưu trạng thái. Cloud Run service chỉ là demo phiên ngắn khi chưa có kiến trúc session bền |
| U10 | [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access?hl=en) | Chrome 142 triển khai quyền truy cập mạng cục bộ. Web HTTPS → loopback phải bắt đầu bằng thao tác người dùng; không giả định mọi browser tương đương. Kiểm browser matrix tại release |
| U11 | [Nav2 Jazzy Collision Monitor](https://docs.nav2.org/jazzy/configuration_and_development/configuration_guide/core_servers/collision_monitor/configuring_collision_monitor_node/) | Có tầng giảm tốc/dừng theo sensor; chính tài liệu nêu không cung cấp chứng nhận hard realtime safety. Nhánh physical vẫn cần watchdog/E-stop độc lập và người chịu trách nhiệm |

Trang ROS Jazzy install trực tiếp bị lớp chống bot từ chối trong lần tra cứu; không dùng trang bị chặn làm bằng chứng đã đọc. Pairing OS/ROS dựa trên U04 và U05. Các thông số sản phẩm thật, version gói apt và latency host chưa có bằng chứng mới.

## 4. Ba hướng kiến trúc đã cân nhắc

| Hướng | Ưu điểm | Chi phí/giới hạn | Quyết định |
|---|---|---|---|
| Hoàn thành backlog engine cũ: PID, tải, bảng ba engine, LinuxCNC | Ít đổi roadmap | Trải nghiệm cà phê vẫn bị tách arm/mock AMR; LinuxCNC không đại diện xArm | Không chọn làm trục chính |
| **MuJoCo chung world + web trạng thái + native profile riêng** | Tận dụng R2a; có handoff vật lý liên tục; giữ source authority và đường tới Linux | Cần seam runner, fixture dock và evidence mới | **Chọn**, chia increment có gate |
| Chuyển engine sang browser WASM hoặc pixel-stream engine khác | Có thể giảm cài đặt hoặc tăng hình ảnh | Đổi authority/clock/worker; thêm đường xác thực model; R2a không tái dùng trọn vẹn | Hoãn; replay giải quyết nhu cầu xem ngay với chi phí thấp hơn |

## 5. Thay thế các mục cũ có chủ ý

| Mục cũ | Xử lý mới | Vì sao |
|---|---|---|
| R2 M00 probe/version/venv từ đầu | Dùng closure R2a; probe chỉ cho wheel/load và kiến trúc chưa kiểm | Tránh reset kết quả M00 đã có |
| PID TS điều khiển mô-men bắt buộc | Không thuộc baseline R2b; experiment riêng khi có câu hỏi điều khiển | Chưa có model drive thực; tăng số biến cần tune mà chưa tăng giá trị demo |
| Chỉ report tilt/contact | Thêm vật tải nhìn thấy, metric có định nghĩa, timeline fault, click tới khung hình | Số liệu cần giúp người dùng hiểu chuyện gì đã xảy ra |
| So sánh IR-SIM/Webots/MuJoCo bằng compareRuns | Báo cáo semantic study, chỉ rõ fidelity/corridor; không rank | Code hiện chặn cross-backend có chủ ý |
| R3 tuyệt đối không thêm adapter | Giữ reuse legacy; cho phép adapter/lifecycle **mới có tên rõ** cho xArm engineering | `moveit_gazebo_arm` thực tế chưa có |
| LinuxCNC là gate bắt buộc duy nhất cho arm | Hai profile độc lập; cả hai được chuẩn bị, thực chạy riêng | Người dùng chưa chọn hardware |
| Có Linux là sẵn sàng physical | Linux → native SIM → dossier → commissioning có robot | SDK/model/firmware/geometry thật còn thiếu |
| Cloud Run là đích live mặc định | Local hiện tại; Linux một runtime qua HTTPS cho phiên dài; Cloud Run service demo tùy chọn | CPU gap và instance lifecycle chưa được giải quyết bằng cấu hình hiện tại |

## 6. Câu hỏi mở chuyển thành việc kiểm, không thành giả định ngầm

- **R2a cuối cùng bàn giao commit/gate nào?** B00 đọc lại record, closure và pin; thiếu gate liên quan thì chỉ increment phụ thuộc bị chặn.
- **AMR/khay hiện tại có dock trong tầm xArm không?** B01/B05 kiểm hình học và IK; tạo fixture mới có provenance, không kéo dài arm hoặc dịch tray ngầm.
- **Cốc chuyển động ổn định trên native amd64 không?** L01 kiểm cả M00 recipe và full MJ-BV01; không hạ ngưỡng để qua.
- **G2 chạy trong stack Jazzy thế nào?** L03 kiểm driver/controller/mimic/contact; fake joint pass không đóng gate contact.
- **Linux host, reviewer, thiết bị thật, thông số/chữ ký?** Chưa có; task chuẩn bị vẫn làm được. Các gate native/physical phụ thuộc giữ `not_run`/`blocked_external` có lý do.

## 7. Tham chiếu evidence lịch sử

Ba candidate trong bảng snapshot đã được thay thế ở commit `086121c73afcdb08240c393dcd87a6f1de861b58`; các file được giữ trong lịch sử Git. Đọc lại ngày 14/11 tại commit acceptance `3c30a49b4d7d023abe8ec83a22ff103a82a0e2c5` xác nhận source ghi bằng chứng `9b8f92f1c76cd7283030e46adf93f2d6527cb4bd` và Lab `26a679dacac7065b8daa70e94d662a5cb6a98e5a`. Acceptance của các candidate này không áp dụng cho pin R2b mới.

<a id="h-lf07"></a>
**LinkForge/IR-SIM candidate-07:** `docs/implementation/evidence/linkforge-irsim/candidate-07/README.md` tại commit trên; sáu gate tested, reviewer acceptance trong sidecar, native/hardware ngoài phạm vi.

<a id="h-r105"></a>
**R1 candidate-05:** `docs/implementation/evidence/sim-extension/r1-candidate-05/README.md`; sáu gate tested, ALG04 not_run, raw campaign được ghi.

<a id="h-r1102"></a>
**R1.1 candidate-02:** `docs/implementation/evidence/sim-extension/r11-candidate-02/README.md`; bốn gate tested, có suite results/ảnh nhưng không giữ report hoặc arm trace từng run.

Ví dụ đọc trong repository source, không đổi checkout:

```sh
git show 3c30a49b4d7d023abe8ec83a22ff103a82a0e2c5:docs/implementation/evidence/linkforge-irsim/candidate-07/README.md
```

Thay đường dẫn bằng một trong hai đường dẫn còn lại để xem record tương ứng. Không chuyển liên kết lịch sử sang candidate mới rồi giữ nguyên tuyên bố cũ.

## 8. Kết quả B04a bổ sung ngày 14/11 — tham số vật liệu và cửa sổ dừng

Worktree source `681b8adb8ed473f7195062773b23fabc3b922cd5` đã ghi campaign payload 19 ca và đọc lại độc lập đạt; review task đã đạt ở phạm vi B04a. Biến thể giảm tham số ma sát geom từ 0,6 xuống 0,3 không tự tạo tiếp xúc bánh–sàn ít ma sát hơn: sàn trong fixture vẫn 0,8, cốc 0,6. MuJoCo lấy giá trị lớn hơn theo từng thành phần khi hai geom cùng priority; contact pair khai riêng có quy tắc riêng. Vì vậy UI/comparison phải phân biệt input đã đổi và hiệu ứng thực đo được. [MuJoCo3.17 — Contact parameters](https://mujoco.readthedocs.io/en/3.17.0/modeling.html#contact-parameters).

Metric B03 `stopDistanceM` bắt đầu khi plant nhận target bằng 0, sau phần ramp của controller. Nó không phải toàn bộ quãng đường từ lúc người dùng bấm hủy đến lúc robot dừng. Campaign phanh giữ thêm cửa sổ quan sát thực để đủ hold samples; UI sẽ giữ đúng định nghĩa này. Đây là phép đo mô phỏng chưa hiệu chuẩn, không phải khoảng cách phanh của thiết bị thật.

## Bổ sung ngày 15/11/2026: OCI local cho R2b

Tài liệu Docker cho phép một build dùng nhiều exporter, với Buildx và BuildKit từ 0.13; OCI exporter ghi image layout, còn Docker exporter/`--load` nạp image vào image store. Điều này hỗ trợ chuẩn bị đường build local không cần push registry. Cần driver hỗ trợ exporter và kiểm config identity giữa các output; đây là thiết kế áp dụng từ tài liệu, chưa là lượt build/load đã chạy. [Exporters overview](https://docs.docker.com/build/exporters/), [OCI and Docker exporters](https://docs.docker.com/build/exporters/oci-docker/), [Buildx build reference](https://docs.docker.com/reference/cli/docker/buildx/build/).

Quyết định92 giữ riêng platform-manifest digest, config digest và filesystem quan sát. RepoDigests vắng không được thay bằng tag; association local phải có artifact/hash/config/rootfs phù hợp. Docker prerequisite và qualification native vẫn mở.
