# Nghiên cứu R2a — tay máy thực tế, mô phỏng từ web, UI gọn

- **Ngày:** 2026-11-12 · **Phục vụ:** [spec R2a](../superpowers/specs/2026-11-12-realistic-arm-web-ui-design.md)
- **Cách làm:** đọc codebase (`source/main 5af719b`, `lab/main 83cfa1a`) và tra nguồn upstream. Mục ghi **CHƯA KIỂM** là chưa mở được trang gốc hoặc chưa chạy thử; spike M00 phải xác nhận trước khi dùng.

## 1. Engine và model tay máy

| Chủ đề | Kết quả | Nguồn |
|---|---|---|
| MuJoCo | 4.0.1 (2026-11-11), 4.0.0 (2026-11-06), 3.17.0 (2026-10-22). Từ 4.0 tách `mujoco-core` (chỉ cần numpy, không GL), `mujoco-studio` (viewer), `mujoco` (meta). Wheel cp311 cho macOS arm64 và manylinux x86_64/aarch64. Apache-2.0. 4.0.1 sửa lỗi solver phân kỳ do 4.0.0 đưa vào | [releases](https://github.com/google-deepmind/mujoco/releases), [changelog](https://mujoco.readthedocs.io/en/latest/changelog.html), [PyPI](https://pypi.org/simple/mujoco-core/) |
| Thay đổi 4.0 | Bỏ `composite`/plugin `cable`, đổi `sidesite`, compiler chặt hơn, RK4 đổi kết quả. Không đụng MJCF tay máy thường; binding Python không có thay đổi phá vỡ | changelog |
| Tính lặp lại | "Tất định và tái lập", nhưng chỉ bit-exact trong **cùng phiên bản, cùng kiến trúc** | [computation](https://mujoco.readthedocs.io/en/latest/computation/index.html) |
| Menagerie | Có xArm7 + kẹp (`xarm7.xml`, `hand.xml`; actuator vị trí kp 1500/1000/800, lực ±50/30/20; má kẹp là hộp), Lite 6, UR5e, Robotiq 2F-85. **Không có xArm 6, không có Gripper G2**. BSD-3/BSD-2/Apache-2.0 | [menagerie](https://github.com/google-deepmind/mujoco_menagerie) |
| Nguồn UFACTORY | `xarm_ros2` (BSD-3): `urdf/xarm6`, `urdf/gripper`, `meshes/xarm6`, `config/link_inertial`, `kinematics`. Bảng D-H, khối lượng và trọng tâm từng link được công bố (không có tensor quán tính trong trang) | [xarm_ros2](https://github.com/xArm-Developer/xarm_ros2), [D-H xArm 6](https://docs.supportarticle.ufactory.cc/support_articles/developer/kinematic-and-dynamic-parameters/xArm_Series/xarm-6.html) |
| Tiền lệ của hãng | `ufactory_robot_viewer`: three.js + MuJoCo WASM 3.15.0, xArm 6 + Gripper G2, MJCF sinh từ URDF, gắp **không dùng ràng buộc weld**. `ufactory_genesis`: URDF `xarm6`, `gripper_g2`. Nguồn mesh G2 có phần chưa truy được (cần đọc NOTICE) | [viewer](https://github.com/xArm-Developer/ufactory_robot_viewer), [genesis](https://github.com/xArm-Developer/ufactory_genesis) |
| Controller xArm giả lập | Image Docker `danielwang123321/uf-ubuntu-docker` chạy firmware + Studio, chỉ linux/amd64, đẩy lần cuối 2024-08; chạy trên Apple Silicon và mô phỏng lực: CHƯA KIỂM | [hướng dẫn](https://docs.supportarticle.ufactory.cc/support_articles/software/how-to-install-ufactory-studio-in-docker.html) |
| Gắp bằng tiếp xúc | `implicitfast`; bước ≤ 2 ms (hằng số thời gian `solref` ≥ 2× bước); nón ma sát elliptic, `impratio` lớn, `condim=4`; má kẹp là hộp, cốc là khối nguyên thủy vì mesh va chạm thành bao lồi; `mj_step(..., nstep=N)` là cách chia bước chuẩn | [modeling](https://mujoco.readthedocs.io/en/latest/modeling.html), [XML](https://mujoco.readthedocs.io/en/latest/XMLreference.html) |
| Quỹ đạo, IK | Ruckig 0.19.4 (MIT; không có wheel Linux aarch64; bản cộng đồng chỉ state-to-state), mink 1.4.0 (Apache-2.0; kéo `mujoco` meta), TOPP-RA (chỉ wheel Linux x86_64). Không có lựa chọn TypeScript nào được kiểm | [ruckig](https://github.com/pantor/ruckig), [mink](https://github.com/kevinzakka/mink) |
| Chất lỏng | MuJoCo: "ngoài phạm vi". Genesis có SPH/MPM nhưng hiệu năng CPU ở tick 20 ms CHƯA KIỂM | [fluid](https://mujoco.readthedocs.io/en/latest/computation/fluid.html) |

**Các engine khác (đều bị loại cho mục tiêu "Mac arm64 + container Linux chỉ CPU + gắp tiếp xúc"):**

| Engine | Lý do |
|---|---|
| Drake 1.58 | Contact tốt nhưng pip macOS arm64 chỉ hỗ trợ Python 3.12–3.14 (worker ghim 3.11), nặng. Lựa chọn thứ hai |
| Genesis 1.4.6 | Cần PyTorch và Python ≥ 3.12 |
| Isaac Sim/Lab | Không có macOS, cần RTX |
| Newton | macOS chỉ CPU, dựng trên MuJoCo Warp: không thêm gì khi không có GPU NVIDIA |
| Gazebo Jetty | Không cài bằng pip; GUI macOS không ổn định |
| PyBullet 3.2.7 | Không có wheel macOS arm64; dự án đứng yên |
| SAPIEN/ManiSkill | macOS chỉ CPU, cần Vulkan SDK |
| Webots R2025a | Vẫn là bản ổn định mới nhất; không headless trên macOS, Linux cần `xvfb-run`. Giữ làm backend hồi quy |

## 2. Mô phỏng từ web, process cục bộ, Cloud Run

| Chủ đề | Kết quả | Nguồn |
|---|---|---|
| Công cụ tương tự | Foxglove (WebSocket, mặc định `127.0.0.1:8765`), Viser (WebSocket + msgpack, three.js), Meshcat/Drake (WebSocket, 64 Hz), Webots `--stream` (w3d), Gazebo (websocket :9002, giới hạn `publication_hz`) đều **truyền trạng thái, vẽ trong trình duyệt**. Chỉ Isaac Sim truyền pixel (WebRTC, cần GPU) | [foxglove](https://docs.foxglove.dev/docs/sdk/websocket-server), [viser](https://arxiv.org/html/2507.22885v1), [drake](https://drake.mit.edu/doxygen_cxx/structdrake_1_1geometry_1_1_meshcat_visualizer_params.html), [webots](https://raw.githubusercontent.com/cyberbotics/webots/master/docs/guide/web-streaming.md), [gazebo](https://gazebosim.org/docs/ionic/web_visualization/) |
| MuJoCo WASM | npm `@mujoco/mujoco` chính thức (4.0.1), README ghi "still a WIP", một luồng trừ khi bật COOP/COEP, không có cam kết tất định so với native. Chỉ hợp làm chế độ xem trước | [README wasm](https://raw.githubusercontent.com/google-deepmind/mujoco/main/wasm/README.md) |
| Trang HTTPS gọi loopback: Chrome/Edge | Từ 142 (2025-10-28) hỏi quyền cho `fetch`; 145 tách quyền `loopback-network` ("Apps on device"); 147 thêm WebSocket. `fetch(url,{targetAddressSpace:'loopback'})` khai đích; IP literal và `localhost` được miễn chặn mixed content. Header `Access-Control-Allow-Private-Network` đã bỏ. Trang `127.0.0.1` gọi `127.0.0.1` không bị ảnh hưởng. Chính sách doanh nghiệp có thể chặn | [blog](https://developer.chrome.com/blog/local-network-access), [guide](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access), [147](https://developer.chrome.com/release-notes/147) |
| Firefox | Hạn chế mạng cục bộ cho mọi người dùng từ 151, có hỏi quyền; loopback là origin an toàn | [mozilla](https://support.mozilla.org/en-US/kb/control-personal-device-local-network-permissions-firefox) |
| Safari | Lỗi WebKit 171934 còn mở: trang HTTPS không gọi được `http://127.0.0.1` | [bug](https://bugs.webkit.org/show_bug.cgi?id=171934) |
| Tiền lệ | Colab local runtime: Jupyter trên localhost với `allow_origin` đúng một origin + token. Figma agent cần quyền Chrome mới | [colab](https://research.google.com/colaboratory/local-runtimes.html), [figma](https://help.figma.com/hc/en-us/articles/34458998159511-Local-network-access-in-Figma) |
| Cloud Run | Service gen2: SSE và WebSocket chạy được; timeout request tối đa 60 phút (client phải nối lại); hệ file trong RAM; cho phép tiến trình con; tối đa 8 vCPU/32 GiB; affinity chỉ best-effort nên trạng thái trong RAM cần `max-instances=1`. Job và worker pool không có URL. "Cloud Run instances" (Preview 2026-08) là singleton có URL: chưa đánh giá | [websockets](https://docs.cloud.google.com/run/docs/triggering/websockets), [timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout), [contract](https://docs.cloud.google.com/run/docs/container-contract), [affinity](https://docs.cloud.google.com/run/docs/configuring/session-affinity) |
| Chi phí | 1 vCPU/2 GiB ở Singapore (Tier 2): khoảng 0,095 USD/giờ tính theo instance, khoảng 0,146 USD/giờ tính theo request. Số lấy từ trang tổng hợp, chưa đọc được trang giá gốc: CHƯA KIỂM | [pricing](https://cloud.google.com/run/pricing) |
| Xác thực trên cloud | IAP gắn thẳng vào service (người nội bộ), ID token Firebase/Identity Platform, hoặc service công khai với bearer token riêng + CORS allowlist | [IAP](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run) |
| An toàn runtime cục bộ | Bind 127.0.0.1 không chặn được trang web trong chính trình duyệt của người dùng: phải kiểm `Origin`, kiểm `Host` (chống DNS rebinding), CORS theo origin chính xác, token trong header (không cookie, không URL) | [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) |

## 3. Mẫu UI của công cụ robot

| Công cụ | Luôn hiện | Ẩn sau thao tác | Nguồn |
|---|---|---|---|
| Foxglove | Panel + thanh phát lại | Sidebar trái/phải (`[` `]`), tab Problems, tab Performance chỉ khi bật debug | [docs](https://docs.foxglove.dev/docs/visualization/introduction) |
| Rerun | Viewport giữa, timeline dưới | Blueprint trái, Selection phải, mỗi bên một nút ẩn | [docs](https://rerun.io/docs/getting-started/configure-the-viewer) |
| MuJoCo simulate | Viewport | Panel trái/phải (Tab), overlay F1–F4; Space, mũi tên, `+`/`-` | [docs](https://mujoco.readthedocs.io/en/latest/programming/samples.html) |
| Isaac Sim | Viewport, toolbar | Stage, Property theo đối tượng chọn; F7 ẩn UI, F khung hình | [docs](https://docs.isaacsim.omniverse.nvidia.com/6.2.0/gui/reference_user_interface.html) |
| Webots | Viewport, toolbar có tốc độ và thời gian ảo | Scene tree ẩn được; overlay trong View > Optional Rendering | [docs](https://raw.githubusercontent.com/cyberbotics/webots/master/docs/guide/the-user-interface.md) |
| UR PolyScope X | Thanh điều khiển robot ở chân trang (trạng thái, tốc độ, play) | Panel đa nhiệm ở sidebar; Operator Screen riêng | [manual](https://www.universal-robots.com/manuals/EN/HTML/SW10_12/Content/prod-usr-man/complianceUR5e/PolyX_SW/psx_polyX_overview.htm) |
| InOrbit | Chỉ báo "Live" đổi màu khi mất kết nối; robot lỗi xếp đầu | Widget sắp xếp được | [docs](https://www.inorbit.ai/docs) |

Nguyên tắc rút ra (dùng ở spec §6.4): tiết lộ dần tối đa hai mức và đặt tên cửa theo nội dung ([NN/g](https://www.nngroup.com/articles/progressive-disclosure/)); không tách UI theo vai trò mà theo tần suất việc ([Nielsen 2026](https://jakobnielsenphd.substack.com/p/progressive-disclosure)); mã lỗi chỉ để chẩn đoán, lỗi đặt cạnh nguồn và không chỉ báo bằng màu ([NN/g](https://www.nngroup.com/articles/error-message-guidelines/)); chế độ phải có ít nhất hai dấu hiệu ([NN/g](https://www.nngroup.com/articles/modes/)).

## 4. Số đo từ codebase

| Đo | Giá trị | Chỗ đo |
|---|---|---|
| Chiều cao trang Digital twin sau một run `WB-BV01` | 4043 px ở bề rộng 1440 | `lab/test-results/irsim-evidence/webots-coffee.png` |
| Khung 3D | khoảng 680 × 450 px, tức khoảng 24 % một màn hình 1440 × 900 (đo trên ảnh, sai số vài chục px) | cùng ảnh |
| Telemetry một run 99 s chạy ở 64× | 3516 mẫu ghi, 165 mẫu tới trình duyệt | cùng ảnh, dòng "streamed 165" |
| Nhịp ghi telemetry | 10 Hz thời gian mô phỏng (`TELEMETRY_RATE_TICKS=5`), đẩy mỗi 100 ms, mỗi lần chỉ mẫu mới nhất của từng đối tượng | `v2/telemetry.ts:6`, `v2/event-stream.ts:10,55` |
| Bước tự chạy | trình duyệt gửi `step{ticks:25}`, runtime chạy 25 tick liền nhau, rồi trình duyệt tự chờ cho đủ 0,5 s/tốc độ | `lab/src/ui/workspace.ts:36,270`, `v2/scenario-runner.ts:404` |
| Nhịp cập nhật hình ở 1× | khoảng 2 lần/giây. **Suy ra từ code, chưa đo:** 5 mẫu của một lô 25 tick được ghi trong vài ms, lần đẩy 100 ms kế tiếp chỉ gửi mẫu cuối | hai dòng trên |
| Origin được nhận | `http://127.0.0.1:4175`, `http://127.0.0.1:4176`; bind `127.0.0.1` | `packages/lab-runtime/src/gateway.ts:11,42,89` |
| Máy phát triển | Docker 29.8.2 đang chạy, có `gcloud`, `uv`, `python3.11` | `which`, `docker info` |
