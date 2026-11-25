# Nghiên cứu — từ R2b/R3 tới bàn thử nghiệm vận hành ảo

**Kiểm ngày 2026-11-19.** Phân biệt ba loại: **quan sát repository** (đọc code, Git, spec/plan, evidence tại workspace), **thông tin upstream** (đọc trực tiếp từ trang, file hoặc API của nguồn trong ngày 19/11, qua hai lượt tra cứu độc lập), và **đề xuất/suy luận** của bộ tài liệu này. Phần nghiên cứu ban đầu không chạy simulation mới và không đo; lượt kiểm sẵn sàng cùng ngày có đo và được ghi riêng ở [§1.1](#11-kiểm-lại-sau-khi-r3-đã-push-và-deploy-1911). Không cài hay nâng package nào. Mục nào không kiểm được ghi ở [§8](#8-không-kiểm-được).

Nhiều nguồn dưới đây ra đời sau tháng 6/2026 (Intrinsic Core, dự án balance-machine, MuJoCo 3.12–4.0). Chúng được đọc từ nguồn, không lấy từ trí nhớ.

## 1. Baseline từ repository

| Hạng mục | Trạng thái đọc được ngày 19/11 |
|---|---|
| source `main` | `33847b9` (commit ghi sáu profile chuẩn bị của R3); record ghi ở `3d8c2a8`; guard chạy ở `4e7789d` |
| lab `main` | `4b57a9a`, pin runtime `3d8c2a8`; cây sạch |
| Record trong cây | IR-SIM `candidate-11`, `r1-candidate-09`, `r11-candidate-06`, `r2a-candidate-04`, `r2b-candidate-03`; mọi guard đạt |
| Gate R2b | G-MJ1, G-CELL1, G-WEB1, G-X1, G-REG4 `tested`; G-HOST1 `blocked_external` |
| R3 | Sáu profile chuẩn bị đã ghi, `nativeReady:false`; native và phần cứng chặn bên ngoài |
| Chấp nhận | Không có sidecar nào; mọi record `accepted:false` |
| Hiệu năng cell | Probe 12,75–14,45 ms/tick; capture 185 giây đạt 0,993×; ba lần capture bị loại vì khoảng tick đứng trên 500 ms, nguyên nhân chưa điều tra |
| Push và deploy | Hai nhánh `main` trùng `origin/main`; runtime Cloud Run báo commit `3d8c2a8` (xem §1.1). File trạng thái 19/11 và `CLAUDE.md` còn ghi "chưa push" và pin `4f893ac`; chúng được viết trước khi push |
| Chưa làm | Native Linux, phần cứng, người ký |

Nguồn: [trạng thái 19/11](../../../../docs/implementation/web-lab-to-physical/status-2026-11-19.md), `lab/config/source-runtime.lock.json`, Git log hai repo.

Các cải tiến gần đây đã đọc trong [bộ R2b/R3](../../../../../docs/2026-11-13-web-lab-to-physical/README.md) và [plan 04](../../../../../docs/2026-11-13-web-lab-to-physical/plans/04-merge-and-closeout.md): AMR MuJoCo có tải với servo bánh hữu hạn lực; evidence vật lý bền; cell một world tay máy–AMR với custody liên tục; replay package và UI; semantic study ba engine; persistence một host; gói chuẩn bị Linux và hai nhánh tay máy; rồi đợt hiệu năng (một lần ghi bền mỗi tick, nén ngoài đường tick, scan LiDAR chỉ ở tick công bố, display dựng từ checkpoint, vòng hiển thị của Lab).

### 1.1 Kiểm lại sau khi R3 đã push và deploy (19/11)

Lượt kiểm này trả lời câu hỏi "R4 đã sẵn sàng bắt đầu chưa". Mỗi dòng là kết quả của lệnh chạy trong ngày, trừ dòng ghi nguồn khác.

| Hạng mục | Cách kiểm | Kết quả |
|---|---|---|
| Hai repo | `git status`, `git rev-parse HEAD origin/main` | Sạch; source `33847b9` và Lab `4b57a9a` trùng `origin/main` |
| Pin của Lab | `pnpm check:source` | Đạt ở `3d8c2a8`. Source HEAD đi trước pin ba commit (một commit test, hai commit ghi record), không đổi runtime |
| Build và test nền | `pnpm typecheck` ở hai repo; pytest của worker MuJoCo; unit test workspace của Lab | Đều exit 0; 126 test Python và 34 test workspace đạt |
| Runtime local | Báo cáo chạy tay do người dùng gửi | `MJ-CELL-BV01` hoàn thành ở tick 10.850 (217,0 giây), phục vụ 2; tốc độ thật 0,7–0,9× |
| Chi phí tick của cell | `node scripts/native-sim/tick-cost-probe.mjs --ticks 1500 --seed 1 --chunk 25` | 13,3 ms/tick (20,0 giây tường cho 30 giây mô phỏng); 1,12 lần fsync mỗi tick, p95 4,2 ms |
| Runtime cloud | `GET /lab/v2/health` của dịch vụ Cloud Run | 200; `sourceCommit` `3d8c2a8`, schema hash trùng pin của Lab; quảng bá `MJ-CELL-BV01`, `MJ-FD01`, `MJ-BV01`, ba world experiment và xuất replay cho cell |
| Cell trên Cloud Run x86-64 | Không kiểm được | Cần khóa truy cập. Repo mới có bằng chứng `MJ-BV01` ngày 14/11 |
| Tính năng actuator gốc | [probes/native-actuator-probe.py](probes/native-actuator-probe.py) trên `.venv-mujoco` (MuJoCo 3.17.0, arm64), model một khớp | Bảng dưới |
| Đường dẫn trong plan | Script đối chiếu mọi Create/Modify với hai repo | 214 tham chiếu sau khi thêm các bước cloud và bản ghi mẫu. File Modify nào chưa có đều do một task trước đó tạo; không file Create nào đã tồn tại |
| Docker | `docker info` | Đang chạy; cần cho CLD01 |

| Thử trên actuator gốc | Kết quả |
|---|---|
| `pid` với `ki=0` so với `position` cùng `kp`, `kv` | Trùng bit trên 500 bước |
| `pid` với `ki>0`, `imax`, `slewmax` | Hữu hạn và hội tụ; trạng thái tích phân nằm trong `act` |
| `delay="0.004"` với `nsample="8"` | Đáp ứng dời đúng 2 substep |
| Đổi `actuator_delay` lúc chạy thành 0,008 | Dời đúng 4 substep |
| Có bộ đệm trễ, `delay="0"` | Trùng bit với actuator không có bộ đệm |
| `dcmotor` với `nominal` | Biên dịch được, chạy hữu hạn |
| Bit nhóm trong `disableactuator` | Lực actuator bằng 0 sau khi tắt |
| Đổi `forcerange` lúc chạy | Lực bị kẹp theo giá trị mới |
| Hai lần chạy trong cùng tiến trình | Trùng bit |

Các kết quả này mới có trên model một khớp và một kiến trúc. V01 vẫn phải lặp lại trên model thật của cell, qua đường worker, và đo chi phí.

**Hai việc phải làm trước V01:**

1. **Sửa lỗi hiển thị của baseline.** Run cell đã hoàn thành mất hình 3D khoảng nửa giây sau lần đọc cuối. `frame()` trong `lab/src/ui/workspace.ts` cho cặp world/view hết hạn sau 500 ms với mọi trạng thái khác `running`, trong khi `refreshWorld()` đã dừng ticker khi run kết thúc. Đã tái hiện ở mức unit bằng một bản sao tạm của test workspace: ngay lúc hoàn thành frame có world; 600 ms sau `world` là `undefined` và cảnh không còn entity nào của cell. Lỗi nằm ở Lab, không cần đổi source hay pin. Mọi demo của R4 kết thúc bằng một run hoàn thành, nên việc này đứng trước ([V00](plans/01-drive-and-cil.md#task-v00--khóa-baseline-sau-r2br3)).
2. **Đo cell trên Cloud Run.** Chạy `MJ-CELL-BV01` trên dịch vụ đang deploy, ghi phục vụ, tick cuối và ms/tick. Đây là số còn thiếu để biết lớp drive có bao nhiêu dư địa trên cloud.

Cập nhật sau khi V00 chạy và được review cùng ngày: việc 1 đã sửa cho run `completed` ở Lab `260f4aa` (chưa push). Review cho thấy run `cancelled` và `needs_attention` vẫn mất hình theo cùng cơ chế, và một lần đọc cuối hỏng vẫn làm mất khung cuối; phần đó đã được sửa tiếp ở Lab `65a4593` ([V00 — phần làm thêm](plans/01-drive-and-cil.md#v00--phần-làm-thêm-sau-review-ngày-1911-đã-xong)). Ca cốc rơi vẫn trống hình vì một quy tắc có từ trước và để lại cho V09. Việc 2 còn `not_run` vì chưa có khóa truy cập. Chi phí tick đo thêm ba lần cho 15,1–16,6 ms/tick; phần không tính ghi bền ổn định ở 10,2–11,0 ms/tick, phần dao động là độ trễ fsync.

Tốc độ 0,7–0,9× của lần chạy tay thấp hơn 0,993× của capture đã ghi. Lần chạy tay đi qua tự động hóa trình duyệt; nguyên nhân chênh lệch chưa được tách. V00 đo lại theo cách của capture.

## 2. Phát hiện từ code

| ID | Quan sát và nguồn | Hệ quả cho R4 |
|---|---|---|
| F01 | Khớp xArm dùng actuator `position` của MuJoCo với `kp`/`kv` trong `physics.json` (J1–J2 6000/150 … J6 500/14), `armature` 0,1; kẹp cũng là actuator vị trí. `mujoco_worker/compile.py` | "Drive" hiện là servo lý tưởng ngầm định; mọi gain là giả định |
| F02 | Bánh dùng actuator `velocity`, gain 2 N·m·s/rad; mỗi substep worker đặt lại `forcerange` theo đường mô-men (6 N·m tới 10 rad/s, về 0 ở 20 rad/s) và mô-men phanh riêng; có đếm substep bão hòa. `mobile_engine.py`, `drive.py` | Một phần của drive đã có; R4 tổng quát hóa, không viết lại |
| F03 | ACK mang trạng thái thật của engine; không có encoder, trễ hay trạng thái enable. Identity của plant ghi "seed is identity only: no stochastic engine, noisy sensors or actors". `mujoco-mobile.ts` | Controller chưa từng gặp thiết bị không lý tưởng; thành phần ngẫu nhiên đầu tiên phải có stream PRNG có tên |
| F04 | Mỗi tick là 10 lần `mj_step` trong vòng lặp Python của ba engine, `ctrl` giữ suốt tick, một request đang bay | Điểm chèn drive là giữa các substep, trong chính ba vòng lặp này |
| F05 | `pid-v1` có bản TS và oracle Python độc lập (G-ALG2) nhưng "no plant uses it yet"; README thuật toán hứa đưa vào vòng tốc độ bánh ở Release 2; R2B-D06 hoãn thành thí nghiệm | Xem quyết định cơ chế ở [§5](#5-các-hướng-đã-cân-nhắc) |
| F06 | Có `FaultScheduleEntry` (trigger theo thời gian mô phỏng hoặc phase, `durationMs`), ba danh mục lỗi mock, danh mục native, và trình soạn trong Lab (`lab/src/ui/fault-schedule.ts`). Nhưng run MuJoCo mobile từ chối mọi lịch lỗi trong project (`FAULT_SCHEDULE_UNSUPPORTED`, `navigation2d/runner.ts`), chế độ simulation chỉ nhận lỗi native trên entity, và cell từ chối project lệch digest fixture (`mujoco-world-ports.ts`). Đường MuJoCo chỉ có ba nhiễu loạn đăng ký phía server | Dùng lại shape mục lịch và trình soạn, nhưng lịch lỗi drive phải là **input của run**, không nằm trong project. Thiếu lớp drive/cảm biến/kênh lệnh và báo cáo lỗi |
| F07 | `PAYLOAD_EXPERIMENTS` là registry đóng. `mujocoExperimentId` là trường của engineering project, đọc lúc compile, tạo bundle và run mới; run request chỉ có `worldExperimentId` cho cell. `payload-experiments.ts`, `engineering/mujoco-compiler.ts` | Mẫu cho thí nghiệm drive và khay: chọn ở engineering project với run mobile, ở run request với run dựng scene tại runtime (cell, bench) |
| F08 | Route tạo run gọi `simulationFactory(input, providers)` và nhận `ScenarioRun`; `worldExperimentId` là trường tùy chọn. `v2/gateway.ts` | Bench run đi qua cùng route; không cần endpoint mới |
| F09 | Chương trình arm lấy nguyên văn waypoint fixture ("No IK at run time"). Trong workflow cốc sinh **đúng tại điểm danh định**; 5 mm là biên chấp nhận của worker (`session.py`), và rig B05 đã thử lệch tới mức đó. `solvePose` và kiểm sweep ARM03 có sẵn ở TS | Gắp theo niềm tin làm được mà không cần thư viện mới; muốn thấy giá trị của nhận thức phải có rig cho lệch lớn hơn |
| F10 | Kẹp hụt **không** chốt tay máy: chương trình chạy tiếp và hoàn tất với `objectPresent:false`. Cốc mất sau khi đã kẹp thì chốt `CUP_DROPPED`. Không có thử lại. `cell-adapters/src/mock-arm.ts` (`completeContact`) | Điểm phục hồi hợp lệ là lúc xác nhận kẹp cho biết không có cốc giữa hai má; cốc mất sau khi kẹp giữ nguyên hành vi chốt |
| F11 | `CellAdapter` có `execute` idempotent, `cancel`, `observe`, `reconcile`; `CellCommand` có `stage_program`, `start_job`, `pause_job`, `resume_job`, `cancel_job`, `query_outcome` | Không cần hợp đồng `WorkcellJob` |
| F12 | Giao thức G3 và `assessCalibration` tồn tại; không có đường nhập log, không có bước fit; `SourceRef.kind` có `manufacturer`/`measured`/`derived`/`assumed` | R4.5 thêm đường vào, bước fit và hàm mức model |
| F13 | Compiler MuJoCo mobile từ chối actor: `MODEL_UNSUPPORTED: mobile actors require an explicit physical proxy`; `actorUpdates` đã có trên wire | Biến thể "khách đi ngang" cần proxy khai báo |
| F14 | Khay đỡ 0,40 × 0,46 m; cốc bán kính 0,04 m, 0,32 kg, ma sát 0,6; load profile nhận tối đa 8 prop. Má kẹp mở hết 88,9 mm (`openingMaxM`) | Ba cốc vừa về hình học. Cận trượt Coulomb `μ·g` khoảng 5,9 m/s², nhiều khả năng vượt gia tốc mà đường mô-men giả định cho phép. Khe hở mỗi bên giữa má kẹp và cốc khoảng 4,5 mm: sai lệch ngang lớn hơn mức đó có thể làm má chạm cốc khi tiếp cận |
| F15 | Lab không có helper vẽ đồ thị; có `tr(vi, ja, en)`, workspace có tab, có trình soạn lịch lỗi | Đồ thị bằng SVG nội tuyến; không thêm thư viện |
| F16 | Biên hiệu năng của cell mỏng (bảng §1) | Mọi chi phí thêm ở đường tick phải đo |
| F17 | Runtime có PRNG có tên `xoshiro128**`, một stream mỗi actor. `v2/random.ts` | Nhiễu LiDAR và sai số nhận thức rút số ở TS; worker không cần PRNG |
| F18 | Recorder physics theo chunk bất biến, có hash, quota, reader fail-closed; `PhysicsTickRecord` là schema đóng | Evidence theo trục là trường tùy chọn cộng thêm |
| F19 | Repo đã dùng tên `sil` cho lane mô phỏng native (`v2/sil/`) | R4 gọi cấp mới là CIL để không lẫn; ánh xạ sang thuật ngữ chuẩn ở §3.1 U19 |
| F20 | Recorder bền theo chunk chỉ có cho run mobile (`openPhysicsRecorder`) và cho cell một world (`world-evidence-v1`); run arm-only giữ trace trong bộ nhớ có trần. Xuất replay package chỉ có cho run một world (`REPLAY_PROVIDER_UNSUPPORTED` với loại khác) | R4 không mở rộng xuất replay. Dữ liệu mới theo recorder sẵn có của từng loại run; bench và belief có recorder riêng nhỏ |
| F21 | `jointDynamics.damping` và `frictionloss` của tay máy là **một giá trị chung** cho sáu khớp; khớp bánh có `damping` và `armature` bằng 0 cố định trong compiler | Nhận dạng chỉ fit được giá trị chung đó, quán tính rotor từng khớp và hệ số mô-men từng trục; tham số riêng từng khớp hay của bánh cần đổi compiler |

## 3. Nguồn upstream đã kiểm

Kết luận kiến trúc rút ra từ các nguồn là **suy luận của bộ tài liệu này**, không phải bảo đảm của nhà cung cấp.

### 3.1 Dự án PLC + MuJoCo, engine và các chuẩn liên quan

| ID | Nguồn | Điều xác nhận được | Tác động |
|---|---|---|---|
| U01 | [eliasrhoden/balance-machine](https://github.com/eliasrhoden/balance-machine) | Máy cân bằng bóng trên thanh: PLC S7-1200 G2, servo SINAMICS S210, LiDAR TF-Luna, RP2350-ETH; PLC–drive qua PROFIdrive telegram 105; điều khiển tầng (PID vị trí bóng → góc đặt → điều khiển vị trí P có feed-forward vận tốc → drive đóng vòng tốc độ). Tạo 07/11/2026, commit cuối 15/11/2026. **Không có giấy phép** | Chỉ lấy khái niệm; không dùng code |
| U02 | [program.cs](https://github.com/eliasrhoden/balance-machine/blob/main/simulation/src/program.cs), [simotion.cs](https://github.com/eliasrhoden/balance-machine/blob/main/simulation/src/simotion.cs) | Logic PLC không đổi vì mô phỏng đứng **sau telegram**: ứng dụng C# đọc tag telegram ra, bước FMU, ghi tag telegram vào; README: "everything on the PLC side does not notice that it's a simulation", "no simulation bits". Đồng bộ bằng bước đơn tại mỗi điểm đồng bộ bus: FMU bước 4 ms, MuJoCo một `mj_step` | Seam đúng là **hợp đồng lệnh/phản hồi của thiết bị**. Đồng hồ ảo một chủ sở hữu là thứ Lab đã có |
| U03 | [Parameters.xml](https://github.com/eliasrhoden/balance-machine/blob/main/simulation/DriveSimDesigner_SERVO.Parameters.xml), [robot.xml](https://github.com/eliasrhoden/balance-machine/blob/main/mujoco-robot/robot.xml) | Ghép **một chiều**: FMU dùng tải nội bộ; MuJoCo chỉ bám vị trí của FMU qua một actuator vị trí; không có mô-men hay tốc độ từ MuJoCo quay về model drive. Tiếp xúc bị tắt, bóng là khớp trượt. Vị trí bóng được ghi thẳng vào tag PLC. MJCF sinh bằng onshape-to-robot | R4 đi xa hơn một bước: giới hạn của drive tác động trong vật lý và tải vật lý quay lại drive |
| U04 | README của U01 | Tác giả không mô phỏng giao tiếp TCP giữa PLC và RP2350; FMU không có trong repo vì không được phân phối | Phù hợp nhận định của tài liệu đề xuất |
| U05 | [eliasrhoden/Fusion2Mujoco](https://github.com/eliasrhoden/Fusion2Mujoco) | Script xuất từ Autodesk Fusion; vòng động học kín thành `<equality>`; chỉ khớp quay và trượt, không có actuator, giới hạn hay cấu hình va chạm. MIT; 4 commit ngày 25/01/2026; chỉ Windows | Theo dõi cho tay máy tự chế có cơ cấu vòng kín; không thuộc R4 |
| U06 | [MuJoCo 3.17 — actuator](https://mujoco.readthedocs.io/en/3.17.0/XMLreference.html#actuator-general), [forcerange](https://mujoco.readthedocs.io/en/3.17.0/modeling.html#cforcerange) | Actuator tổng quát có gain/bias/dynamics; lối tắt `position`, `velocity`, `intvelocity`, `damper`, `motor`. Lực `kv` bị kẹp bởi `forcerange`. `armature` là quán tính rotor phản ánh; `frictionloss` là ma sát khô | Nền của drive hiện tại |
| U07 | [actuator/pid](https://mujoco.readthedocs.io/en/3.17.0/XMLreference.html#actuator-pid), [actuator/dcmotor](https://mujoco.readthedocs.io/en/3.17.0/XMLreference.html#actuator-dcmotor), mã nguồn engine tại tag 3.17.0 | Engine đang ghim **đã có** actuator `pid` (từ 3.12.0, 20/08/2026). Luật lực: `kp·(u_pos − length) + kv·(u_vel − velocity) + u_ff + ki·z`, rồi kẹp bởi `forcerange`; `slewmax` giới hạn tốc độ đổi của setpoint vị trí; `imax` dừng tích lũy tích phân; trạng thái nằm trong `mjData.act`; chạy được với `implicitfast`. Mỗi actuator `pid` nhận nhiều ô `ctrl` (mặc định hai: vị trí, vận tốc), nên phải lập chỉ mục theo `actuator_ctrladr`. Cũng đã có `dcmotor` (từ 3.7.0): tham số hóa được từ hằng số motor và điện trở, hoặc từ ba số datasheet (điện áp danh định, mô-men khóa rotor, tốc độ không tải); có bão hòa mô-men/dòng và trạng thái nhiệt | Vòng lặp và giới hạn của drive nên dùng actuator gốc. Dòng điện và nhiệt có đường gốc khi có datasheet motor |
| U08 | [MuJoCo 3.17 — delay](https://mujoco.readthedocs.io/en/3.17.0/modeling.html#cdelay), mã nguồn engine tại tag 3.17.0 | Trễ là tính năng gốc (từ 3.5.0): `nsample`, `delay`, `interp` trên actuator và sensor. Với actuator, tín hiệu bị trễ là `ctrl` trước khi vào luật actuator. `nsample` cố định lúc compile; `actuator_delay` đổi được lúc chạy trong sức chứa của bộ đệm. Bộ đệm là `mjData.history`, thuộc trạng thái vật lý; trễ dương nhỏ nhất là một timestep | Ứng viên cho trễ lệnh, kể cả lỗi đổi trễ lúc chạy; spike so với hàng đợi phía worker |
| U09 | [actuatorgroupdisable](https://mujoco.readthedocs.io/en/3.17.0/XMLreference.html#option-actuatorgroupdisable), [simulation — thay đổi lúc chạy](https://mujoco.readthedocs.io/en/3.17.0/programming/simulation.html#sichange) | Nhóm actuator 0–30 tắt được lúc chạy; actuator bị tắt "will produce no force" và trạng thái của nó không được tích phân tiếp. Tham số thực như `actuator_gainprm`/`biasprm` được ghi là an toàn khi đổi lúc chạy; `actuator_forcerange`, `dof_frictionloss` an toàn theo quy tắc chung (suy ra, tài liệu không nêu riêng) | Bật/tắt trục bằng nhóm actuator; phanh bằng ma sát khớp; spike xác nhận trên engine |
| U10 | [MuJoCo 3.17 — sensor](https://mujoco.readthedocs.io/en/3.17.0/modeling.html#csensor) | Thuộc tính `noise` "does not affect the simulation"; không có thuộc tính lượng tử | Lượng tử encoder và nhiễu phải do lớp của MEKONIQ làm |
| U11 | [MuJoCo 3.17 — simulation](https://mujoco.readthedocs.io/en/3.17.0/programming/simulation.html#sisimulation) | Đặt `ctrl` giữa `mj_step1` và `mj_step2`, hoặc dùng `mjcb_control` | Chèn giữa các substep là cách dùng được tài liệu mô tả |
| U12 | [mujoco.sysid README @3.17.0](https://github.com/google-deepmind/mujoco/blob/3.17.0/python/mujoco/sysid/README.md) | Gói nhận dạng chính thức, có từ 3.5.0, **nằm trong wheel 3.17.0**; cần cài thêm `mujoco[sysid]` (scipy, matplotlib, plotly…). Bình phương tối thiểu phi tuyến có biên, Jacobian sai phân, rollout theo lô, khoảng tin cậy; phần trễ/gain/bias của phép đo "API is not yet final" | Phương án cho R4.5; chưa chọn, xem §5 |
| U13 | [reproducibility](https://mujoco.readthedocs.io/en/3.17.0/computation/index.html#pireproducibility), [changelog](https://mujoco.readthedocs.io/en/latest/changelog.html) | Tất định "within a single version, on the same architecture". 3.17.0 ngày 22/10/2026. 4.0.0 ngày 06/11/2026: actuator bão hòa bởi `actuatorfrcrange` không còn đóng góp đạo hàm ẩn; tách gói. 4.0.1 ngày 11/11/2026 sửa lỗi gây phân kỳ của 4.0.0 | Giữ pin 3.17.0; nâng engine là candidate riêng |
| U14 | [FMI 3.0.2](https://fmi-standard.org/docs/3.0.2/), [FMPy](https://pypi.org/project/FMPy/) | FMI hiện hành 3.0.2. Co-simulation: FMU mang solver riêng, chỉ trao đổi tại điểm giao tiếp; thuật toán điều phối không thuộc chuẩn. Binary theo bộ nền tảng. FMPy 0.3.32 (BSD-2) chỉ chạy FMU có binary của host; không có đường remoting trên macOS | Lane FMU cần FMU có binary cho host của worker |
| U15 | [DriveSim Designer, sổ tay 02/2026](https://cache.industry.siemens.com/dl/files/781/109999781/att_1356177/v1/DriveSim_Designer_sys_man_0226_en-US.pdf) | FMI 2.0 co-simulation, **chỉ Windows** 32/64 bit; cần giấy phép lúc chạy (dùng thử 30 ngày hoặc thuê bao một năm). Ở chế độ tải ngoài, FMU đọc tốc độ/vị trí và trả mô-men; bước giao tiếp nên bằng nửa chu kỳ bộ điều khiển tốc độ (62,5 µs cho 125 µs). Không mô hình nhiệt, từ, điện áp nguồn | Không chạy được trong worker macOS/Linux; bước giao tiếp nhỏ hơn substep 2 ms nhiều lần |
| U16 | [CiA 402](https://www.can-cia.org/can-knowledge/cia-402-series-canopen-device-profile-for-drives-and-motion-control), [máy trạng thái](https://www.nanotec.com/eu/en/products/manual/m/c5-usb-en/p/general%2Fds402_power_state_machine.html), [controlword](https://icube-robotics.github.io/ethercat_driver_ros2/developer_guide/cia402_drive.html) | CiA 402-2 nay là IEC 61800-7-201; tám trạng thái nguồn; reset lỗi là sườn lên của bit 7; chế độ CSP/CSV/CST | Tham chiếu cho máy trạng thái (§3.3) |
| U17 | [ros2_control Jazzy](https://control.ros.org/jazzy/doc/getting_started/getting_started.html), [mock components](https://control.ros.org/jazzy/doc/ros2_control/hardware_interface/doc/mock_components_userdoc.html) | Controller giữ nguyên khi đổi plugin phần cứng; `GenericSystem` phản chiếu lệnh thành trạng thái, có `disable_commands` để giả mất phản hồi. Ở trạng thái INACTIVE giao diện lệnh vẫn được ghi | Tiền lệ cho seam "cùng controller, đổi thiết bị". Quy tắc của R4 chặt hơn: lệnh tới trục chưa enabled bị bỏ và được ghi nhận |
| U18 | [ZLAC8015D — tài liệu RS485 V1.04 (bản lưu)](https://fabacademy.org/2025/labs/rwanda/students/reginald-itiseng/Final_Project/motor%20driver%20data%20sheets/485_help.pdf) | Driver bánh hub phổ biến: CANopen (CiA 301/402) và Modbus RTU; chế độ vị trí/vận tốc/mô-men; phản hồi vị trí theo count, vận tốc 0,1 vòng/phút, nhiệt độ motor; số vạch encoder mặc định 1024; các cờ lỗi; thời gian mất liên lạc mặc định 1000 ms | Điểm tham chiếu khi chọn giá trị `assumed`; **không** phải phần cứng đã chọn |
| U19 | [Hướng dẫn của Siemens dẫn VDI/VDE 3693](https://cache.industry.siemens.com/dl/files/864/109963864/att_1277519/v1/Guideline_VC_SIMIT_PSA_MCD_V1.0.0.pdf) | MiL: không có chương trình điều khiển thật; SiL: toàn phần mềm, có chương trình điều khiển; HiL: có bộ điều khiển thật | CIL của R4 tương ứng SiL; cấp L4 của đề xuất tương ứng HiL |

### 3.2 Intrinsic Core và OMTS

| ID | Nguồn | Điều xác nhận được | Tác động |
|---|---|---|---|
| U21 | [intrinsic-ai/intrinsic-core](https://github.com/intrinsic-ai/intrinsic-core), [bài công bố 22/09/2026](https://www.intrinsic.ai/blog/posts/introducing-intrinsic-core) | Công khai, Apache-2.0; release mới nhất 20261022.0. README: "an open, local runtime, SDK, and hardware agnostic, real-time control framework for industrial robotics". Mô phỏng bằng Gazebo; executive của behavior tree viết bằng luật CLIPS | Dự án có thật và đang hoạt động |
| U22 | [Getting Started](https://github.com/intrinsic-ai/intrinsic-core/blob/main/developer_resources/learn/tutorials/getting_started.md) | Ubuntu 26.04; x86-64; "ARM architectures are strictly unsupported at this time"; tối thiểu 32 GiB RAM (khuyến nghị 64); k3s, Helm, Istio, Bazel; OMTS có nhận thức cần GPU rời. README nêu thêm Ubuntu 24.04/22.04: hai tài liệu không khớp nhau | Không chạy trên máy phát triển hiện có |
| U23 | [Issue #11](https://github.com/intrinsic-ai/intrinsic-core/issues/11), [bài diễn đàn](https://intrinsic.discourse.group/t/intrinsic-core-omts-on-arm64/26) | Hỗ trợ ARM64 là issue còn mở. Bản chạy thử trên máy Apple của cộng đồng dùng fork trong **máy ảo Linux arm64**, CPU; không có đường macOS | Sửa nhận định "chạy trên Mac mini ARM": đó không phải macOS |
| U24 | [Danh sách tutorial](https://github.com/intrinsic-ai/intrinsic-core/blob/main/developer_resources/learn/tutorials/README.md) | "Coming Soon": camera, kết nối ROS, thêm robot qua ROS 2 Control, hiệu chuẩn camera và workcell | Đúng như tài liệu đề xuất nêu |
| U25 | [OMTS — kiến trúc](https://github.com/intrinsic-ai/intrinsic-omts/blob/main/docs/ARCHITECTURE.md), [behavior_tree.proto](https://github.com/intrinsic-ai/intrinsic-core/blob/main/intrinsic_apis/intrinsic/executive/proto/behavior_tree.proto) | "Open Machine Tending Solution", Apache-2.0. Chu trình năm cây con trong một vòng lặp. Cây **không có định dạng file**: dựng bằng Python thành protobuf. Node: sequence, parallel, selector, fallback, loop, retry (`max_tries`, node phục hồi), task… | Học cấu trúc; không có định dạng để nhập/xuất trực tiếp |
| U26 | [motions.py](https://github.com/intrinsic-ai/intrinsic-omts/blob/main/src/behaviors/motions.py), [vision.py](https://github.com/intrinsic-ai/intrinsic-omts/blob/main/src/hardware/vision.py) | Mỗi chuyển động tới tiếp xúc là `Fallback[ Retry(max_tries=2, phục hồi = lùi về điểm chờ), phương án dự phòng ]`; chuỗi nhận thức là `Retry(max_tries=3)` có chờ 1 giây. Vị trí trả phôi được ngẫu nhiên hóa mỗi chu trình để buộc định vị lại | Tiền lệ cho phục hồi có giới hạn và cho study có lệch vị trí. Con số là của OMTS, không phải số đã kiểm cho MEKONIQ |
| U27 | [world_concepts.md](https://github.com/intrinsic-ai/intrinsic-core/blob/main/developer_resources/learn/platform_introduction/world_concepts.md) | "During simulation, we have multiple separate world models": belief world, simulated world và model nội bộ của simulator; belief chỉ đổi qua skill; hai trạng thái "can differ … if a pose estimator returns a bad estimate" | Xác nhận khái niệm belief world |
| U28 | README bộ ước lượng pose trong `intrinsic_perception` | Nhận thức dùng SAM 3 + FoundationStereo + FoundationPose trên TensorRT. Mã suy luận FoundationPose dùng ở đây là bản Apache-2.0 của nvidia-isaac; trọng số theo NVIDIA Open Model License; SAM 3 theo giấy phép riêng của Meta, có điều kiện truy cập. Không có trọng số trong repo | Giấy phép model phải rà từng cái. Sai số nhận thức ở OMTS đến từ ước lượng trên ảnh render; không thấy núm chèn sai số |
| U29 | [executive_service.proto](https://github.com/intrinsic-ai/intrinsic-core/blob/main/intrinsic_sdk/intrinsic/executive/proto/executive_service.proto), [extended_status.proto](https://github.com/intrinsic-ai/intrinsic-core/blob/main/intrinsic_apis/intrinsic/util/status/extended_status.proto) | Điều phối từ ngoài qua `ExecutiveService`: tạo, chạy, tạm dừng, tiếp tục, hủy, đọc trạng thái; "there can be at most one operation". Lỗi là `ExtendedStatus` có thành phần, mã, mức và cây nguyên nhân | Khớp `CellAdapter` hiện có. Ý tưởng lỗi có chuỗi nguyên nhân được dùng trong báo cáo lỗi của R4 |
| U30 | Tài liệu agent đi kèm repo và danh sách image nền | Ghi log có cấu trúc, đóng gói bản ghi và replay được ghi là thuộc bản Enterprise; trên Core có sự kiện executive và log thường | Không có nguồn evidence tương đương chuẩn của Lab |
| U31 | Cây `intrinsic_hardware`, `third_party` | Module phần cứng trong cây: Universal Robots, KUKA, ABB; không có file nào cho xArm/UFACTORY. Cầu `ros2_control` chỉ cho tay máy điều khiển vị trí, không có I/O số | Cell xArm của MEKONIQ không có đường sẵn |
| U32 | [Issue #19](https://github.com/intrinsic-ai/intrinsic-core/issues/19) | Dịch vụ spawn vật thể không có trong Core; tạo vật thể ở cả belief và mô phỏng chỉ tạo ở belief | Vòng đời cốc của MEKONIQ không tái hiện được như hiện tại |
| U33 | [Robotics & Automation News 23/09/2026](https://roboticsandautomationnews.com/2026/09/23/intrinsic-open-sources-core-industrial-robotics-technology/105036/) | Flowstate, các model AI nâng cao và dịch vụ cloud công nghiệp vẫn là thương mại; OMTS là bản đầu của một loạt dự kiến | Phạm vi mã mở có giới hạn |

### 3.3 Ánh xạ trạng thái drive sang CiA 402

Chỉ để tham khảo khi viết adapter thật; R4 không tuyên bố tương thích.

| Trạng thái R4 | Trạng thái CiA 402 tương ứng |
|---|---|
| `disabled` | Not ready to switch on, Switch on disabled |
| `ready` | Ready to switch on, Switched on |
| `enabled` | Operation enabled |
| `quick_stop` | Quick stop active |
| `fault` | Fault reaction active, Fault |

`faultReset` của R4 theo sườn lên, cùng nghĩa với bit 7 của controlword. Chế độ `csp`/`csv` của R4 tương ứng mode 8 và 9; mode 10 (CST) chưa có.

### 3.4 Thư viện đã xem và không dùng trong R4

`py_trees` 2.6.0 (BSD-3) và `BehaviorTree.CPP` 4.11.0 (MIT) cho behavior tree; `mink` 1.4.0 và `pin-pink` 4.4.0 (Apache-2.0, phụ thuộc `qpsolvers` có phân loại LGPL) cho IK vi phân; `opencv-python` 5.1 có `ArucoDetector` và `open3d` 0.20 cho ước lượng pose từ ảnh render; FMPy cho FMU. Không cái nào cần cho phạm vi R4: phục hồi là một bảng quy tắc, IK đã có và đã đối chiếu, sai số nhận thức là mô hình tham số, FMU là lane hoãn.

## 4. Đối chiếu hai tài liệu đề xuất

| Nhận định trong đề xuất | Kết quả kiểm | Ghi chú |
|---|---|---|
| Tác giả giữ nguyên logic PLC giữa mô phỏng và phần cứng | Đúng | Cách làm: thay thiết bị sau telegram (U02). Vị trí bóng được ghi thẳng vào tag, tức đường cảm biến bị bỏ qua |
| Mô phỏng dùng MuJoCo, FMU DriveSim Designer, C# nối PLCSIM Advanced; TCP với RP2350 chưa mô phỏng | Đúng | Thêm: ghép vật lý–drive là một chiều (U03); repo không có giấy phép (U01) |
| Fusion2Mujoco xuất MJCF/URDF; MJCF biểu diễn được vòng kín | Đúng | Model của balance-machine lại sinh bằng công cụ khác (U03) |
| MuJoCo cho đặt điều khiển trước mỗi bước hoặc qua callback | Đúng | U11 |
| DriveSim Designer cung cấp FMU co-simulation | Đúng | Chỉ Windows, cần giấy phép lúc chạy (U15) |
| MuJoCo của MEKONIQ dùng bộ điều khiển vị trí với `kp`, `kv` giả định | Đúng | F01 |
| Cần lớp drive viết thêm để có trễ, PID, giới hạn dòng | **Một phần** | Engine đang ghim đã có trễ, actuator `pid` và `dcmotor` (U07, U08). Thứ còn thiếu là máy trạng thái, lượng tử, watchdog và lỗi |
| Ước lượng V1–V5 là 20–31 ngày công | Thấp | Chưa gồm evidence, campaign, hồi quy, qualification, yêu cầu UI và phần nhận thức; xem [README §8](README.md#8-ước-lượng) |
| Intrinsic Core mã mở Apache-2.0, công bố 22/09/2026 | Đúng | U21 |
| Yêu cầu: Ubuntu 26.04, x86-64, 32/64 GiB, k3s, Bazel, Gazebo, GPU cho nhận thức | Đúng | U22 |
| Có thử nghiệm cộng đồng trên ARM Mac mini | Đúng một phần | Là máy ảo Linux arm64 dùng fork (U23) |
| Một số tutorial ROS còn "Coming Soon" | Đúng | U24 |
| OMTS dùng behavior tree có retry/fallback cho chuyển động tiếp xúc | Đúng | U25, U26 |
| OMTS tách belief world và thế giới mô phỏng | Đúng | U27 |
| Giấy phép Apache-2.0 không bao trùm model và dependency | Đúng | U28; riêng FoundationPose dùng ở đây là bản dùng thương mại được |
| Nên có hợp đồng `WorkcellJob`/`WorkcellResult` | Không cần | `CellAdapter` đã có (F11) và khớp `ExecutiveService` (U29) |
| Intrinsic có thể làm backend cho cell xArm | Chưa có đường | Không có xArm, không spawn được vật thể trên Core, không có logging có cấu trúc trên Core (U30–U32) |

## 5. Các hướng đã cân nhắc

### 5.1 Hướng tổng thể

| Hướng | Ưu điểm | Chi phí/giới hạn | Quyết định |
|---|---|---|---|
| A. Thêm engine và runtime ngoài: FMU drive, PLCSIM, Intrinsic Core làm backend | Gần với hai dự án tham chiếu | Cần Windows và giấy phép cho FMU; cần Linux x86-64 32 GiB+ cho Intrinsic; không có xArm; thêm authority và clock thứ hai; không chạy trên máy phát triển | Không chọn. Ghi thành lane hoãn có điều kiện mở |
| **B. Lớp gốc trên stack MuJoCo hiện có** | Chạy trên máy hiện tại; giữ một engine, một clock, một authority; dùng actuator gốc của engine; mọi đường cũ giữ byte | Phải tự viết máy trạng thái, kênh phản hồi, lỗi, belief; model sai số là giả định | **Chọn**, chia bốn đợt có gate và một đợt tùy chọn (R4.5) |
| C. Chỉ làm UI: cho chỉnh `kp`/`kv` và chọn nhiễu loạn có sẵn | Rẻ nhất | Controller vẫn không gặp thiết bị không lý tưởng; không có CIL; không có seam cho adapter thật | Không chọn. Phần UI của hướng này được dùng lại trong R4.2 và R4.3 |

### 5.2 Từng chủ đề

| Chủ đề | Các phương án | Chọn | Vì sao |
|---|---|---|---|
| Vòng lặp và giới hạn của drive | (a) actuator gốc của MuJoCo: `position`/`velocity`, `pid` khi cần tích phân; (b) định hình tham chiếu để vòng lặp chạy trên phản hồi lượng tử; (c) tự tính mô-men qua actuator `motor` | (a), với (b) là phương án dự phòng do spike ghi lại | (a) ít mã nhất, ổn định số do engine lo, model lý tưởng trùng bit hiển nhiên. (b) chỉ cần khi vòng lặp của chính MEKONIQ chạy trên encoder thô, tức trường hợp firmware tự viết, chưa có đích |
| Vị trí controller | Worker Python; runtime TS; browser | Runtime TS | Controller là logic của MEKONIQ, cần thuần và kiểm được ở nơi runner đang sống; browser không đóng vòng servo |
| Trễ lệnh | `delay` gốc của engine; hàng đợi phía worker | Spike quyết định; mặc định hàng đợi phía worker | Lỗi `command-delay` cần đổi trễ lúc chạy; `delay` gốc là thuộc tính của model |
| Sai số nhận thức | Mô hình tham số; camera render + ước lượng pose; runtime ngoài | Mô hình tham số | Trả lời "controller chịu sai số bao nhiêu" mà không thêm chuỗi phụ thuộc; tham số của nó là thứ sẽ hiệu chuẩn khi có camera |
| Phục hồi | Bảng quy tắc; thư viện behavior tree; executive ngoài | Bảng quy tắc | Một quy trình, vài loại thất bại đã biết |
| Ranh giới workcell | Hợp đồng mới; `CellAdapter` hiện có | `CellAdapter` | Đã có đủ `execute`/`cancel`/`reconcile` |
| Nhận dạng tham số | Bộ tối ưu nhỏ ở TS chạy lại bench; `mujoco.sysid`; thư viện tối ưu khác | Bộ tối ưu nhỏ ở TS | Không thêm dependency, chạy đúng đường bench của bàn chỉnh. `mujoco.sysid` cần thêm scipy/matplotlib/plotly vào một venv, rollout của nó không đi qua lớp trạng thái của worker, và phần trễ đo "API is not yet final". Mở lại khi cần tốc độ hoặc khoảng tin cậy đầy đủ, trong venv công cụ riêng |
| Đồ thị | SVG nội tuyến; thư viện đồ thị | SVG nội tuyến | Vài đường gấp khúc, cần a11y và hoạt động offline |

## 6. Điều chỉnh có chủ ý so với đề xuất gốc

| Đề xuất gốc | Xử lý trong R4 | Vì sao |
|---|---|---|
| Lớp drive tự viết gồm PID, trễ, giới hạn dòng | Dùng actuator gốc của engine cho vòng lặp và giới hạn; chỉ viết máy trạng thái, kênh lệnh/phản hồi, watchdog, lỗi | U07, U08: engine đang ghim đã có |
| Mô phỏng dòng điện/nhiệt "nếu có dữ liệu" | Không có trường; ghi đường `dcmotor` gốc cho lúc có hằng số motor | Chưa có hằng số motor có nguồn; số 0 giả gây hiểu sai |
| Năm cấp kiểm thử L1–L5 | Giữ, thêm ánh xạ sang MiL/SiL/HiL | U19; tránh gọi L3 là HIL |
| PID auto-tuning | Hoãn; thay bằng gợi ý gain từ quán tính | Model chưa hiệu chuẩn |
| Studio lỗi thay cho fixture định sẵn | Danh mục đóng có tham số trong biên, không phải lỗi tự do | Giữ quy tắc browser chỉ gửi dữ liệu đã đăng ký |
| Demo khay: "tăng tốc quá nhanh → cốc trượt" | Biến thể có oracle Coulomb; chấp nhận kết quả "không trượt" | F14 và bài học B04a |
| Bốn nhãn model: Illustrative, Nominal, Calibrated, Qualified | Thêm Giả định; tách Qualified thành trục riêng | Phần lớn tham số hiện là giả định; qualified là tính chất của record |
| DriveAdapter trung lập, sau đó adapter CAN/RS485, ros2_control, LinuxCNC, FMU | Hợp đồng lệnh/phản hồi có schema là "DriveAdapter trung lập"; adapter thật nằm ngoài Lab và ngoài R4 | R3-D10: Lab không có đường tới phần cứng |
| `WorkcellJob`/`WorkcellResult` và adapter mock kiểu OMTS | Không thêm; ghi bảng ánh xạ | F11 |
| Belief world và chèn sai số nhận thức trên MuJoCo hiện có | Làm, là R4.4 | Không cần runtime ngoài |
| Behavior Tree & Recovery Lab | Chính sách phục hồi dạng bảng, có cấu trúc tương đương | Một quy trình; U25 cho thấy không có định dạng cây để trao đổi |
| Intrinsic Linux PoC, nhận thức FoundationPose, CNC Machine Tending Lab | Lane hoãn với điều kiện mở cụ thể | U22, U30–U32; chưa có host |
| Demo "Physical AI Workcell" có bật/tắt sai số camera, trễ, lệch cốc, lực kẹp, vật cản, retry | Phần lớn có trong R4: sai số và trễ nhận thức, lệch cốc, lực kẹp yếu, thử lại; vật cản bất ngờ cho tay máy thì hoãn | Planner tránh vật cản lúc chạy là dự án riêng |

## 7. Câu hỏi mở chuyển thành việc kiểm

- **Actuator gốc có đủ cho drive không?** Trên model một khớp thì có ([§1.1](#11-kiểm-lại-sau-khi-r3-đã-push-và-deploy-1911)). V01 kiểm trên model thật của cell: actuator `pid` với `ki > 0`, bật/tắt trục, phanh bằng ma sát khớp, đổi `forcerange` lúc chạy; trùng bit ở model lý tưởng; chi phí mỗi tick.
- **Cell có chạy hết và giữ được tốc độ trên Cloud Run x86-64 không?** Chưa có số. V00 đo cell hiện tại; CLD03 đo lại sau mỗi lần deploy có lớp drive.
- **Cell có giữ được 1× khi thêm lớp drive không?** V03 đo bằng `tick-cost-probe`; vượt ngân sách thì giới hạn số trục hoặc chạy headless.
- **Chương trình cố định chịu được lệch bao nhiêu, và gắp theo niềm tin chịu được sai số bao nhiêu?** Study `perception-gap-v1` trả lời bằng quần thể run; không đoán trước.
- **Ba cốc có trượt trong cấu hình hiện tại không?** Biến thể B đo và so với cận Coulomb.
- **Tín hiệu bench có đủ kích thích để nhận dạng tham số không?** Tự kiểm công cụ ở V15; không đạt thì mở rộng danh mục tín hiệu, không nới dung sai.
- **Khoảng tick đứng trên 500 ms đến từ đâu?** Chưa điều tra ở R2b; nên tìm trước khi R4 ghi capture web.
- **Host Linux, phần cứng, dữ liệu đo, người ký?** Chưa có, và chưa có lịch phần cứng. Các lane phụ thuộc giữ `not_run`/`blocked_external` có lý do; R4.5 thành đợt tùy chọn; không task nào của R4 chờ chúng.

## 8. Không kiểm được

- `MJ-CELL-BV01` chạy hết trên Cloud Run x86-64 ở commit `3d8c2a8`, và chi phí tick ở đó: cần khóa truy cập của dịch vụ; trong repo không có bằng chứng.
- Nguyên nhân tốc độ 0,7–0,9× của lần chạy tay ngày 19/11 so với 0,993× của capture đã ghi.

- Nguyên văn VDI/VDE 3693 (trang của VDI không truy cập được); định nghĩa MiL/SiL/HiL lấy qua hướng dẫn của Siemens dẫn chuẩn này.
- Giá giấy phép DriveSim Designer; bản mới hơn 02/2024 của sổ tay DriveSim Engineer.
- Cấu hình ánh xạ telegram phía TIA Portal của balance-machine (file lưu trữ nhị phân).
- Quy tắc đổi số vạch encoder sang count mỗi vòng của ZLAC8015D từ tài liệu hãng.
- Việc ghi log có cấu trúc vắng mặt lúc chạy trên Intrinsic Core: không chạy thử; nguồn là tài liệu đi kèm và danh sách image.
- xArm có chạy được qua cầu `ros2_control` của Intrinsic hay không.
- Điều khoản dùng thương mại của giấy phép SAM.
- Nội dung bài của The Robot Report về Intrinsic Core (trang từ chối truy cập tự động).
