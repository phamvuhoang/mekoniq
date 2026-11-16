# MEKONIQ Robot Lab

Lab thiết kế và mô phỏng nghiệp vụ robot giao món, giữ nhận diện navy/lime và ba ngôn ngữ Việt/Nhật/Anh của MEKONIQ. [Kế hoạch kinh doanh gốc](public/business-plan.html) được lưu nguyên bản.

Bản hiện tại có cấu hình robot, mô hình 3D/2D và lắp ráp, sơ đồ kết nối chức năng, BOM, ước tính năng lượng, trình sửa mặt bằng, báo cáo/replay và xuất candidate dự thảo. Digital Twin v2 chạy giao món, cà phê và chiến dịch hai AMR qua **domain, SQLite journal và dispatcher trong source**, với backend mock AMR/arm/coffee. S01 v1 vẫn có luồng xác nhận tải và giao món riêng. Mô hình web không chứng minh robot thật, động lực học hay an toàn vật lý.

Bản ghi lịch sử Plan 01: đã hoàn thiện R01–R12 và 18 mục phần mềm còn thiếu. Vòng kiểm chứng của đợt đó trên source/runtime `c1d1ea7` đã qua toàn bộ lệnh CI tương đương, browser, offline và 41 acceptance tests: 96/106 dòng có bằng chứng pass, không còn `NOT_IMPLEMENTED`. Mười dòng còn lại thuộc gate người dùng/Linux hoặc fidelity vật lý. Xem [bản ghi remediation](docs/reviews/2026-11-05-plan-01-remediation.md) và [bằng chứng](docs/implementation/evidence/digital-twin-v2/mock-report.md); **R-MOCK chưa accepted**.

## Nhánh R2b và bản ghi R2a lịch sử

Nhánh `codex/web-lab-to-physical` giữ UI và runtime pin của B00–B09. B00R2 nhập chứng cứ lịch sử từ source `11d25b47a18adafb88ac21adc249499109996bc5` / Lab `a7449541e118d01f65af0ad1466e0c963a173f3c`; các bản ghi R2a đó vẫn gắn runtime source `4f893ac6fb75dff414a3ee42a726defb7935c734`. Revision đang dùng lấy từ [`config/source-runtime.lock.json`](config/source-runtime.lock.json), không lấy từ metadata cloud/production hoặc compatibility record lịch sử.

Image R2b vẫn `null` (chưa build), WEB05 `not_run` theo R76 vì Docker không phản hồi; B00R2 chỉ kiểm bản ghi đã lưu và không triển khai hay chạy lại cloud/native/browser/Docker. Kết quả R2a không thay cho qualification R2b hoặc nghiệm thu con người (`accepted:false`, `not_calibrated`). Source giữ mission/journal/custody; Lab chỉ mô phỏng/replay, không có đường Lab → phần cứng.

<a id="shared-cell-final-recording"></a>

## Shared cell, replay và bằng chứng ngày16/11/2026

Bản ghi đo dùng Source `981e234` / Lab `d4c3032`, runtime `8eb111…`, build `2c1e9f30…`; commit công bố tài liệu sau đó là identity khác. [Trạng thái cuối](../source/docs/implementation/web-lab-to-physical/final-recording-status.md), [tái hiện đúng tuple](../source/docs/implementation/web-lab-to-physical/reproduce-final-recording.md) và [giới hạn từng profile](../source/docs/operations/native-profile-case-matrix.md) giữ kết quả thật và mọi lần thất bại. Đây là mô phỏng phần mềm, `accepted:false`/`not_calibrated`, chưa nghiệm thu Linux/native/phần cứng hay ra mắt công khai.

### Một world tay máy + AMR + hai cốc

Cần Node24.22.2/pnpm10.32.1, runtime đã import đúng pin và các môi trường Python3.11 đúng lock trong Source sibling (`.venv-mujoco`, `.venv-irsim`). Launcher kiểm dependency/closure/port; không tự cài, tải, đổi mô hình hay chuyển sang backend khác.

```sh
pnpm check:source
pnpm lab:mujoco -- --mujoco-mobile
```

Mở `http://127.0.0.1:4175`, vào Twin, ghép nối bằng mã một lần in ở terminal. Trong Scenario, chọn **Coffee delivery · simulated physical cell** (`mujoco-cell`), đợi readiness rồi tạo run. Quan sát tick 0 và tốc độ mục tiêu1×. Auto-run/Play tiến đồng hồ Source; Pause/Resume theo view đã biết. Chọn Overview/Cell/FollowAMR để đổi camera. Ảnh chỉ chứng minh phần đang nhìn thấy; custody cần mẫu/report Source tương ứng.

Trong Setup, chọn Coffee delivery, Cup falls after an impact hoặc Dock drift after an impact rồi tạo run mới. Đổi thí nghiệm không sửa run cũ. Nguồn giữ journal/custody, kết quả unknown/needs_attention không được tự resend hoặc respawn để coi thành công. Reset/new trial có runId mới. Không có đường Lab→robot thật.

Lựa chọn1× là mục tiêu gửi bước; số measured mới là tốc độ quan sát. Lượt production 185 giây đạt0.47188883×, nhịp vẽ thực p95 300.2 ms so với mục tiêu33ms, worker IPC4.837ms so với15ms và pause tới receipt cuối2797.283ms so với500ms. UI acknowledgement3322.858ms là lượng khác. Public capture reader còn từ chối `CAPTURE_ACTIVE_DRAWING_DURATION`; không quảng bá live realtime/1×. Lượt ghi này phục vụ1cốc, chưa chứng minh một mission live hai cốc hoàn tất. Ba nominal headless có served 2 là scope Source khác.

Lượt launcher trên checkout isolated đã khởi động, health 200 và xuất package H7, rồi thất bại khi mở trang replay thứ hai. Diagnostic giữ riêng quan sát Vite dependency path. Lượt full stock sau đó trên cặp active sạch đã pass 1 case browser với assertions giữ nguyên và cleanup mã 0. Toàn bộ lỗi/setup cũ vẫn được giữ theo đúng layout. Same-build production browser có 1 case pass, strict replay/story có 5 case pass ở scope riêng; các mục tiêu hiệu năng production vẫn thất bại.

### Xem lại đúng dữ liệu đã ghi

Bấm **Export replay**, giữ nguyên ZIP, giải nén vào thư mục mới rồi mở **Explore recordings** (`/#replay`). Mở Replay files, nhập nguyên thư mục đã giải nén và kiểm run/horizon. Kéo cursor từng tick; thay camera và VI/JA/EN. Trang này được chọn trước runtime client và không được gửi`/lab`/EventSource/WebSocket. Các kiểm từ chối file thiếu/sai/hash hỏng, keyboard/reduced-motion/2D, viewport390/1024/1440 và axe được ghi riêng trong production replay.

Replay trong tab Report chỉ có dữ liệu report. Khi report không ghi world pose chính xác, UI hiện`WORLD_NOT_RECORDED_IN_REPORT`; không dùng pose live hoặc suy diễn vật lý để lấp chỗ thiếu. Package replay mới có world/physics samples đã hash. ZIP dài đo tớiH4515/prefixCovered:true/streamFinalized:false, khác view pausedH4520; không kéo horizon để ép khớp. Fault/KPI cuối không trở thành số đo ở cursor trước đó.

Có thể chỉ phục vụ production UI để xem bản ghi, không mở runtime:

```sh
pnpm build
pnpm exec vite preview --host 127.0.0.1 --port 4175 --strictPort
# Mở trực tiếp http://127.0.0.1:4175/#replay
```

Các production checks thực dùng cùng Vite preview/config qua API sở hữu riêng; lệnh CLI trên đã kiểm các cờ qua `vite preview --help`, còn workflow browser thực dùng preview API. First-load strict replay được kiểm tự động trên Chromium 157, không là cold-boot/mất mạng hệ điều hành/máy mới hay mọi trình duyệt đã qualified.

### Gói offline và mock

`node scripts/build-offline.mjs --out <new-dir>` và `./start` là gói **offline mock** có Node/UI/runtime/schema và license; không đóng gói hay qualification một host MuJoCo/ROS/LinuxCNC. Complete current mock đã chạy builder và ba offline journeys; producer xoá gói tạm trong finally nên bằng chứng giữ log/rawbrowser/ảnh, không tuyên bố còn archive gói tạm. Replay package là đường chỉ đọc dữ liệu đã ghi; chạy physics mới vẫn cần môi trường worker đúng pin. Xem phần gói offline bên dưới cho lệnh và giới hạn cùng OS/ISA.

## Chạy giao diện

Dùng **Node.js 24** và **pnpm 10.32.1**; phiên bản Node nằm trong `.node-version`/`.nvmrc`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Mở **http://127.0.0.1:4175**. Thiết kế, mặt bằng, lưu IndexedDB và xuất dự thảo dùng được khi chưa mở runtime. `pnpm build ` tạo website tĩnh trong `dist/`. Trình xem 3D tải khi cần; điện thoại mặc định dùng 2D. Catalog là giả định thiết kế, giá còn thiếu hiển thị rõ; preset Valetudo không tự nhận thông số cơ khí chưa đo.

## Chạy digital twin mock bằng một lệnh

Lần đầu trên máy mới (cần mạng một lần để tải dependencies đúng lockfile; runtime source được cài từ artifact đã export):

```sh
pnpm install --frozen-lockfile        # Node 24 (.node-version), pnpm 10.32.1
node scripts/import-runtime.mjs <artifact-dir>   # artifact export từ source sạch, xem bên dưới
pnpm check:source
```

Sau đó, mỗi lần dùng (không cần mạng):

```sh
pnpm lab:mock
```

Launcher chạy **runtime source đã pin** (chỉ backend `mock_amr`, `mock_coffee`, `mock_arm`; không kết nối robot thật) trên `127.0.0.1:4176` và giao diện trên `127.0.0.1:4175`, rồi in mã ghép nối một lần ngay trong terminal. Mở http://127.0.0.1:4175, vào **Twin**, nhập mã (hết hạn sau 5 phút, không nằm trong URL, không lưu vào dự án hay journal), chọn FD01 giao món, BV01 cà phê, food + cup hoặc chiến dịch hai AMR. Các đơn trong twin dùng chính sách nhân viên scripted của scenario; tải/giao vẫn phải đi qua confirmation trong source. Journal nằm trong `runs/` (không commit). `Ctrl-C` chỉ dừng runtime và UI mà launcher đã khởi động.

Launcher không tự tải hay cài gì khi khởi động, không mở bản mô phỏng thay thế khi thiếu runtime, và không bao giờ dừng tiến trình khác. Nó dừng với mã lỗi rõ ràng:

| Thông báo | Nghĩa và cách xử lý |
|---|---|
| `UNSUPPORTED_NODE` | Không phải Node 24. Dùng phiên bản trong `.node-version` (`nvm use`). |
| `UNSUPPORTED_OS` | Chỉ hỗ trợ macOS và Linux (Linux chưa kiểm trên máy mới). |
| `RUNTIME_NOT_INSTALLED` … *preview only* | Chưa cài runtime. Lab chỉ mở ở chế độ xem trước (thiết kế, mặt bằng; không có run/kết quả). Cài bằng `import-runtime.mjs`. |
| `ARTIFACT_HASH_MISMATCH` | Artifact trong `.runtime/` bị sửa. Import lại từ export sạch. |
| `DIRTY_SOURCE_ARTIFACT` | Artifact build từ source có thay đổi chưa commit; bị từ chối. Export lại từ source sạch. |
| `RUNTIME_PROTOCOL_V2_REQUIRED` | Lock đang trỏ artifact chỉ có protocol v1 (S01). Import artifact v2. |
| `DEPENDENCIES_NOT_INSTALLED` | Chạy `pnpm install --frozen-lockfile` một lần. |
| `PORT_IN_USE:4175/4176` | Có tiến trình khác giữ cổng (ví dụ `pnpm dev`/`pnpm runtime ` đang chạy). Tự dừng tiến trình đó; launcher không dừng giúp. Kiểm tra: `lsof -nP -iTCP:4176 -sTCP:LISTEN`. |
| `BACKEND_UNAVAILABLE:<id>` / `NON_MOCK_BACKEND_ENABLED:<id>` | Runtime không bật đủ backend mock hoặc bật backend ngoài danh sách mock; launcher dừng runtime vừa mở. |
| `RUNTIME_IDENTITY_MISMATCH` | Runtime đang chạy không khớp commit/schema trong lock. |

Lab không bao giờ dùng cổng `1880`/`1884` (`FORBIDDEN_PORT`). `--ui-port/--runtime-port/--data-dir/--root` chỉ dành cho kiểm thử; runtime source chỉ nhận trình duyệt từ `127.0.0.1:4175`. `node scripts/start-mock.mjs --boot-only` khởi động tới trạng thái sẵn sàng rồi dừng (đo boot-to-ready). Hệ điều hành đã kiểm: macOS (Apple Silicon); Linux chưa kiểm, xem [bằng chứng F07](docs/implementation/evidence/digital-twin-v2/F07-launcher.md).

## Tay máy MuJoCo (`pnpm lab:mujoco`) và hộp runtime

```sh
pnpm lab:mujoco                      # runtime đã pin + backend mujoco_arm trên các mock; UI 127.0.0.1:4175
pnpm test:mujoco-e2e -- mujoco-coffee.spec.ts          # MJ-BV01 thật từ UI (một spec mỗi lần chạy launcher)
pnpm test:mujoco-e2e -- mujoco-mesh-fallback.spec.ts   # chặn file STL: tay máy vẽ bằng chuỗi khớp, ghi chú ARM_MESH_UNAVAILABLE
```

`lab:mujoco` chạy runtime đã pin với `MEKONIQ_LAB_MUJOCO=1`: tay máy xArm 6 + kẹp G2 là plant MuJoCo (khối lượng và giới hạn danh định của nhà sản xuất, mọi tham số khác giả định, `not_calibrated`; không phải phần cứng). Trước khi mở cổng, launcher kiểm closure công cụ đã pin trong `../source` (`PORTABLE_TOOLS_MISMATCH`), `<source>/.venv-mujoco` đúng lock (`MUJOCO_PYTHON_MISSING`, `MUJOCO_LOCK_MISMATCH:…`; đổi bằng `--mujoco-python`) và `--data-dir` nằm ngoài mọi thư mục công cụ (`DATA_DIR_IN_TOOL_ROOT`: worker chạy trong thư mục run và engine ghi `MUJOCO_LOG.TXT` vào đó khi cảnh báo). Không cài gì, không thay bằng backend khác; health phải có `mujoco_arm` sống và capability `sim3d_arm_contact_v1` (`MUJOCO_PROVIDER_UNAVAILABLE`, `CAPABILITY_MISSING`). Các mã `RUNTIME_NOT_INSTALLED`, `PORT_IN_USE` như `lab:mock`.

Trên trang **Twin**, bấm chip runtime để mở **hộp runtime**: chọn **Máy này** (runtime của trang khi mở từ launcher, hoặc `http://127.0.0.1:4176` khi Lab mở từ web) hoặc **Địa chỉ khác** (`https://…`), nhập mã một lần rồi bấm **Ghép nối runtime**. Lab chỉ liên lạc runtime khác origin sau một thao tác bấm. Hộp hiện commit Lab ghim và commit runtime báo; khác nhau thì `RUNTIME_PIN_MISMATCH` chặn mọi nút chạy. Preset `mujoco-coffee` (MJ-BV01, seed 42) bắt đầu ở tốc độ 1×.

## Tải tự do trên Serve · MuJoCo

```sh
pnpm lab:mujoco -- --mujoco-mobile
```

Tùy chọn này bật thêm `mujoco_3d`, catalogue Serve đã pin và compiler kỹ thuật. Launcher kiểm cả `.venv-mujoco` và Python hỗ trợ compiler `.venv-irsim` theo lock (đổi bằng `--irsim-python`); thiếu điều kiện thì dừng trước khi mở cổng. Lệnh `pnpm lab:mujoco` không có tùy chọn vẫn là đường tay máy cũ, không cần compiler/catalogue di động.

Ghép nối, chọn **MuJoCo · cốc trên robot Serve** (`mujoco-payload`), rồi chờ readiness. Mặc định là `payload-center-v1`, seed 7, tốc độ phát 1×. Lần chạy bắt đầu tại quan sát create/tick 0 đã commit; bấm Play để tiến đồng hồ nguồn. Bộ chọn chỉ có bảy thí nghiệm đã đăng ký: khay trống, cốc giữa/lệch tâm, giới hạn chậm/nhanh, tham số vật liệu thấp/cao. Đổi lựa chọn tạo project/bundle/run mới; × chỉ đổi nhịp phát, không đổi giới hạn vận tốc của mô hình.

Chọn cốc trong danh sách rồi bấm **Fit** để nhìn giữa các khay trên điện thoại. Serve và khay dùng hình học được compiler tiếp nhận; cốc tự do dùng kích thước và pose nguồn, không có suy luận chủ sở hữu cốc cà phê. Không có vật lý phía trình duyệt. Mọi động lực học còn `not_calibrated`; định vị là `ground_truth`. Tham số ma sát thấp 0.3 bị quy tắc lấy lớn nhất che ở tiếp xúc sàn 0.8/cốc 0.6, nên không gọi đây là “sàn trơn”.

Hủy khi clock đang tạm dừng sẽ ghi yêu cầu hủy trước, rồi chỉ tiến clock của cùng run đến khi nguồn quan sát dừng (tối đa 10 giây mô phỏng). Một yêu cầu Pause tiếp theo dừng quá trình quan sát này. Kết quả attention/unknown/pending giữ theo nguồn. Không thêm đuôi quan sát chiến dịch; quãng dừng tính từ mục tiêu 0 sau ramp, không phải từ cú bấm Hủy, và có thể thiếu cửa sổ năm mẫu.

Nhập lại một case chiến dịch đã ghi bằng thư mục công khai chỉ đọc:

```sh
node scripts/export-payload-replay.mjs /path/to/campaign/cup-fall /tmp/new-payload-replay
LAB_PAYLOAD_REPLAY_DIR=/tmp/new-payload-replay pnpm test:mujoco-e2e -- --mujoco-mobile mujoco-payload.spec.ts
```

Exporter chỉ sao chép report, project đã compile, bundle và các chunk được ràng buộc bằng hash; không sao chép journal, signing key hay trạng thái worker. Trong Report, chọn **Import evidence folder** rồi mở bản đã nhập. Pose/hình học được kiểm schema, digest và liên kết model/load; số đo tổng hợp đã nhập luôn ghi `IMPORTED_METRICS_NOT_RECOMPUTED`, không nhận là đã tính lại. Cốc rơi dừng ở pose cuối đã ghi, không tự chạy tiếp tới sàn. Khung dây thể hiện quan sát `stale/PLANT_NOT_LIVE`, không phải hình học thay thế. Fault và số đo cuối không xuất hiện như phép đo ở cursor trước đó. Bộ stress trực tiếp và catalogue offline đầy đủ thuộc B07.

## Gói offline có sẵn Node

Trên máy build đúng hệ điều hành/kiến trúc đích, dùng Node 24, dependencies đã cài và runtime đã import/kiểm. Build lại UI sau mỗi lần đổi runtime pin:

```sh
pnpm check:source
pnpm build
node scripts/build-offline.mjs --out /tmp/mekoniq-lab-offline
```

Đường dẫn output phải chưa tồn tại. Builder đóng gói UI/dependencies đã compile, runtime và schema đã pin, Node đang dùng, lockfile và license vào một thư mục có manifest SHA-256. Gói macOS/Apple Silicon cần build riêng với gói Linux hoặc kiến trúc khác.

Chép nguyên thư mục sang máy cùng hệ điều hành/kiến trúc rồi chạy:

```sh
cd /path/to/mekoniq-lab-offline
./start
# tương đương: ./bin/node ./start.mjs
```

`./start` dùng Node trong gói; không cần Node, pnpm, npm hay tải mạng trên máy nhận. Mở `http://127.0.0.1:4175`, nhập mã ghép nối in trong terminal. Runtime dùng cổng 4176, dữ liệu mặc định ở `runs/` trong gói; có thể chọn `./start --data-dir /path/to/runs`. UI phải giữ cổng 4175 để khớp origin được runtime cho phép. Launcher kiểm manifest/platform, từ chối cổng đang dùng và chỉ dừng tiến trình nó đã tạo.

Gói lịch sử Plan 01 cho macOS/Apple Silicon có [descriptor, checksum và nguồn runtime](docs/implementation/evidence/digital-twin-v2/plan01-offline-release.json). Binary `releases/mekoniq-lab-plan01-macos-arm64-c1d1ea7.tar.gz` không nằm trong checkout Git này. Dùng builder ở trên để tạo một gói mock mới theo pin hiện tại; nếu có đúng gói lịch sử, giải nén rồi chạy `./start`. Gói này đã qua kiểm khởi động; các hành trình FD01/BV01 đã qua browser với bản offline cùng code/pin. Kiểm không có package manager trong `PATH` đã qua. Cài trên máy mới, ngắt mạng hệ điều hành, cold boot và Linux vẫn cần bằng chứng riêng.

## Đầu vào, khôi phục và báo cáo Twin

Mỗi run khóa project, seed, scenario, recipe, model, adapter và profile bằng revision/hash. **Reset** lưu báo cáo, archive run cũ rồi tạo run mới ở tick 0 với đúng đầu vào đã khóa. Chọn tốc độ chạy 1/4/16/64× chỉ đổi nhịp gửi step; đồng hồ mô phỏng vẫn 20 ms/tick. Giới hạn AMR `(0, 0.5] m/s` là đầu vào cho lần chạy mới và được áp dụng ở admission/plant.

Sau khi runtime/phiên khởi động lại, ghép nối lại rồi chọn **Mở lại chỉ xem/đối soát**. Proof riêng được giữ trong browser, không nằm trong report/export. Runtime chỉ cho xem và đối soát, giữ journal/custody và không chạy lại motion. Project/seed lấy từ record đã lưu trong source; thiếu đầu vào thì Lab chặn reset và lưu evidence thay vì dùng preset khác. Nếu có nhiều đối tượng cần đối soát, phải chọn rõ robot/job rồi xác nhận. Đối soát ghi kết quả native/mock; không tự gỡ attention hoặc xác nhận cargo.

Replay dựng trạng thái cup/job/measurement/arm và served theo cursor; dữ liệu chưa được ghi tại thời điểm đó hiển thị unavailable. Evidence đã lưu không đổi; chỉnh model/world/recipe/profile đánh dấu phạm vi cũ cần chạy lại. KPI correlate human wait theo mission/stop và allocation cuối; báo cáo tách queue wait, travel và thời gian process cell, với chu kỳ chưa hoàn tất là unavailable. Một AMR không có KPI khoảng cách giữa các robot.

Arm mock dùng capsule sweep bảo thủ. Project có `armCollisionProfile` khai báo frame SI, revision model và chiều cao minh họa mới có phạm vi fixture/AMR scene; project cũ chỉ có self/injected-obstacle scope. Hình học thiếu hoặc khoảng sweep chưa giải được không tạo clearance pass. Xem [phạm vi tương thích và fidelity](docs/simulation-compatibility.md).

## Chạy S01 qua source

Runtime được cài riêng trong `.runtime/` và khóa bằng commit/schema/SHA-256 tại [source-runtime.lock.json](config/source-runtime.lock.json). Thư mục runtime và journal không commit vào Git.

Nếu runtime đã được cài trong máy này:

```sh
pnpm check:source
pnpm runtime
```

Giữ terminal này mở. Trong Lab chọn **Kịch bản**, nhập pairing token được in trong terminal (dùng một lần, hết hạn sau 5 phút), rồi tạo run. Trình tự:

1. Bắt đầu → tiến đồng hồ 1 giây → robot đến bếp.
2. Xác nhận tải → tiến 1 giây → robot đến điểm giao bàn.
3. Xác nhận giao → tiến 1 giây → robot về parking.
4. Mở Kết quả, lấy báo cáo; có thể xuất báo cáo hoặc candidate dự thảo kèm tham chiếu bằng chứng.

Mỗi bước di chuyển hoàn tất bằng observation của source simulator. Việc tăng đồng hồ không xác nhận thay con người. Fault injection hỗ trợ blocked/clear, offline/online, reboot và duplicate completion; đây là lỗi nghiệp vụ/giao thức giả lập, không chứng minh khoảng dừng vật lý. Hủy không tự giải quyết hàng còn trên robot.

Runtime chỉ bind `127.0.0.1:4176`; Vite proxy cùng origin. Không dùng cổng vận hành `1880`/`1884`. Cookie/CSRF và ownership bảo vệ run theo phiên. Khi khởi động lại runtime cần pairing lại. Twin v2 có reclaim chỉ xem/đối soát bằng proof như trên; S01 v1 không dùng giao thức reclaim này. Journal cũ vẫn nằm trong `runs/`, không tự gửi lại lệnh.

### Cài hoặc cập nhật runtime

Revision runtime thực đang cài nằm trong [`config/source-runtime.lock.json`](config/source-runtime.lock.json): source commit, schema hash, artifact SHA-256 và protocol majors. Lab dùng protocol 1 cho S01 và 2 cho twin. `.runtime/rollback.lock.json` giữ đúng một pin trước đó; muốn quay xa hơn cần export/import revision cũ. Runtime không tự theo source HEAD. Pin hiện tại lấy từ lock này, không từ revision trong các báo cáo lịch sử. Kết quả đợt BV01 continuation nằm trong [evidence index](docs/implementation/evidence/bv01-native-simulation/README.md); [bản ghi Plan 01](docs/reviews/2026-11-05-plan-01-remediation.md) giữ hash và kết quả của đợt cũ.

Dùng Node 24, dependencies của source và một checkout sạch. Chạy **từ thư mục source**:

```sh
node scripts/export-lab-runtime.mjs /tmp/mekoniq-source-runtime-artifact
```

Nếu `../source/` có thay đổi chưa commit, thêm `--clean-checkout`: exporter tạo git worktree tạm tại `HEAD` đã commit, cài dependencies `--frozen-lockfile --offline` từ store pnpm cục bộ, export rồi xóa worktree; không đụng tới thay đổi đang làm dở. Không dùng `--allow-dirty` cho artifact sẽ import. Exporter cũng từ chối bundle import thứ khác ngoài built-in của Node hoặc chứa mẫu khóa bí mật.

Từ `lab/`:

```sh
node scripts/import-runtime.mjs /tmp/mekoniq-source-runtime-artifact
pnpm check:source
```

Importer là một giao dịch: kiểm metadata, protocol major (Lab hỗ trợ 1 và 2; major lạ bị từ chối `UNSUPPORTED_PROTOCOL`), SHA-256 runtime, băm lại các schema hợp đồng đi kèm so với `schemaHash`, chép vào `.runtime/<sha256>/` qua thư mục staging rồi mới đổi lock bằng một lần rename. Lỗi ở bất kỳ bước nào giữ nguyên lock và artifact cũ. Import lại cùng một SHA thì giữ nguyên thư mục đã kiểm hash. Bản ghi rollback chỉ được ghi (nguyên tử) sau khi lock mới đã thay xong. Importer từ chối artifact build từ source bẩn. Quay lại pin trước: `node scripts/import-runtime.mjs --rollback` (artifact cũ vẫn nằm trong `.runtime/`). Sau mỗi lần đổi lock, chạy `pnpm test`, `pnpm build ` và `pnpm test:runtime-e2e`. `pnpm check:source` kiểm tính toàn vẹn artifact đã pin, không kiểm đó có phải HEAD mới nhất hay không. Runtime đóng gói chạy độc lập, không đọc source đang được chỉnh sửa ở bên cạnh. Xem thêm [README runtime source](../source/packages/lab-runtime/README.md) và [bằng chứng cập nhật W11](docs/implementation/evidence/2026-11-04-source-w11.md).

## Kiểm thử

```sh
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test:e2e -- ui.spec.ts
pnpm test:runtime-e2e
pnpm test:mock-e2e
pnpm test:twin-e2e
pnpm build
```

`test:mock-e2e` chạy đúng `pnpm lab:mock` với journal tạm cho từng spec, tự lấy mã ghép nối từ terminal của launcher (không nhập tay, mã được che trong log) và chạy FD01 giao món (`twin-recovery.spec.ts`) và BV01 cà phê (`coffee-journey.spec.ts`) qua journal source thật, rồi `Ctrl-C` launcher. `test:twin-e2e` dùng cùng cách cho cả ba spec twin. `test:runtime-e2e` tự mở runtime đã pin với journal tạm, pairing, chạy hành trình thật trên trình duyệt và kiểm report/candidate, sau đó đóng đúng tiến trình và dọn journal của test. Cổng `4176` phải trống; script không tắt runtime của người dùng. Playwright dùng Chrome trên macOS; máy khác đặt `CHROME_PATH` tới Chromium/Chrome. Test S01 trong lệnh Playwright thông thường sẽ được skip nếu thiếu token; chỉ lệnh chuyên dụng ở trên kiểm được tích hợp runtime đầu cuối.

## Phạm vi và bước kế tiếp

Plan 01 hiện có phần mềm mock cho delivery, coffee, mixed workload, arm model, SSE/recovery, replay/evidence và gói offline. Source vẫn quyết định arrival, fulfillment, cup custody và effect; renderer không quyết định nghiệp vụ. Candidate chỉ là draft, không chứa credentials, quyền điều khiển hay hàng đợi mission.

**R-MOCK chưa được nghiệm thu.** Phần mềm, pin và vòng CI/browser cuối đã được kiểm; owner vẫn cần review bằng chứng. UX timing với ít nhất 5 người dùng mới, máy macOS mới, ngắt mạng thật, cold boot và Linux là gate riêng. Phép đo tablet 2D emulated trên Mac không thay phép đo thiết bị tablet thật. Plans 02/03, Gazebo/Nav2, LinuxCNC, native adapters, calibration và hardware/venue acceptance vẫn thuộc các gate tương ứng.

Code W00–W11 trong source không tự trở thành scenario hoặc backend Lab. Nấu ăn vẫn là roadmap; pha chế hiện có mock workflow với provenance minh họa/modelled. Xem [tiến độ](docs/implementation/progress.md), [remediation](docs/reviews/2026-11-05-plan-01-remediation.md) và [compatibility](docs/simulation-compatibility.md) trước khi dùng kết quả cho quyết định kỹ thuật.

## Tài liệu

- **[Đề xuất LinkForge + IR-SIM — 2026-11-08](docs/plans/2026-11-08-linkforge-irsim.md)**: nghiên cứu, spec và plan tích hợp model validation/2D navigation trên Mac. Đề xuất lịch sử; provider IR-SIM/LinkForge và các bản ghi phần mềm hiện có được nêu trong [trạng thái cuối](../source/docs/implementation/web-lab-to-physical/final-recording-status.md). R-MOCK, native và hardware vẫn có gate nghiệm thu riêng.
- **[Physical Robot Lab — lắp ráp và mô phỏng vật lý](docs/specs/2026-11-06-physical-robot-lab/README.md)**: đã có contracts/catalog, resolver/compiler, bundle gateway, trang Lắp ráp, lưu/nhập/xuất archive và đánh giá bằng chứng. Runtime engineering bật bằng các cờ opt-in; compile preview không phải một lần chạy vật lý. Xem [kế hoạch triển khai](docs/plans/2026-11-06-physical-robot-lab/README.md) và [bằng chứng, giới hạn hiện tại](docs/implementation/evidence/physical-robot-lab/README.md). Linux/Gazebo/MoveIt, G1–G3 và nghiệm thu phần cứng vẫn chưa hoàn thành.
- [Remediation Plan 01 và trạng thái các gate](docs/reviews/2026-11-05-plan-01-remediation.md).
- [Tương thích runtime và giới hạn bằng chứng](docs/simulation-compatibility.md); [record pin/hash máy đọc](config/simulation-compatibility.json).

- **[Đề xuất nâng cấp Digital Twin v2 — 2026-11-05](docs/specs/2026-11-05-digital-twin/README.md)**: food delivery + coffee cell (máy pha, đá/sữa, arm), mock/simulation/hardware; [bộ implementation plan](docs/plans/2026-11-05-digital-twin/README.md). Plan 01 có implementation mock; Plans 02/03 và các gate simulation/hardware giữ phạm vi riêng.

- [Giới thiệu Lab bằng hình ảnh — HTML tương tác, mở offline](../source/artifacts/robot-lab.html): 9 trang, Việt/Nhật/Anh; cấu hình robot, mặt bằng, S01, thử lỗi, replay và xuất draft.
- [Khảo sát Drone Lab/OOMWOO và code nền](docs/research/2026-11-01-baseline-and-references.md).
- [Spec sản phẩm, trải nghiệm, kiến trúc](docs/specs/2026-11-01-mekoniq-robot-lab.md).
- [Hợp đồng source và đường tới robot thật](docs/specs/2026-11-01-source-integration.md).
- [Plan L00–L11 và các gate nghiệm thu](docs/plans/2026-11-01-mekoniq-robot-lab.md).

`lab/` và `source/` là Git repository riêng. `trial/` cùng robot đang vận hành không bị thay đổi bởi Lab.
