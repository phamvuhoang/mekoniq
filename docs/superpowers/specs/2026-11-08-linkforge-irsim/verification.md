# Kiểm chứng, gates và bảo toàn chức năng

Thuộc [spec chính](README.md). Toàn bộ cases/gates bên dưới là **yêu cầu tương lai**, hiện `not_run` cho integration. Probe thư viện ở research không đóng gate này.

## 1. Ba trạng thái độc lập

- **Implemented:** code/contracts/docs đã có trên candidate commits, build/typecheck thành công.
- **Tested:** assertions đã chạy trên đúng candidate, có log/exit code và artifact hashes. Skipped/not_run không phải pass.
- **Accepted:** reviewer có thẩm quyền xác nhận phạm vi dựa trên evidence đủ và baseline compatibility. Không tự nâng từ số test xanh.

Kết quả mission (`completed|cancelled|needs_attention`) khác kết quả test (`pass|fail|not_run`). Ca no-path/cancel/collision có thể pass oracle khi mission không hoàn thành. `execution=not_run` bắt buộc có blocker; assertion sai sau khi đã chạy là fail. Worker mất dữ liệu/evidence gap ảnh hưởng coverage là inconclusive/fail theo assertion, không biến thành pass nhờ renderer vẫn chạy.

## 2. Gate definitions

| Gate | Evidence tối thiểu | Điều kiện pass/tested | Điều không được suy ra |
|---|---|---|---|
| G-LF1 | Serve physical fixture + model hash + mapped URDF + report | Đúng topology/shapes/inertials, parity đầy đủ, assumptions hiển thị | Không chứng minh độ bền, dynamics hoặc thông số measured |
| G-LF2 | Negative matrix LF02–LF06 | Lỗi gốc được adapter phát hiện, kể cả parser sửa/bỏ dữ liệu; issues có IDs gốc | Không chỉ assert upstream is_valid=false |
| G-IR1 | FD01 domain journal + plant trace + report | Ba chặng tới bếp/bàn/parking, load/handoff độc lập, telemetry đúng frame/time | Không dùng env.done/arrive để tăng served |
| G-IR2 | Hai models/drives, một world, reservation events và separation trace | Cả hai robot thực chuyển động, đúng mapping, không tranh ownership vùng, không starvation trong fixture | Không suy general fleet deadlock freedom |
| G-IR3 | Obstacle/collision/cancel/no-path + repeatability + replay | Oracles IR02–IR10 có evidence đầy đủ; playback không phát command | Không chứng minh physical stopping distance/safety |
| G-INT1 | Browser từ assembly→validation→run→report/replay + pin identity | Cùng hashes xuyên source/worker/Lab; UI và backend khớp; NR rows pass | Không đổi R-MOCK thành accepted |
| G-NATIVE-AMR | Linux/ROS2/Gazebo/Nav2, target image/robot description hashes | Native tests thực chạy và review riêng | 2D evidence không thay thế |
| G-NATIVE-ARM | MoveIt2/Gazebo cho arm phù hợp, LinuxCNC path riêng khi áp dụng | Controller/physics/contact evidence đúng engine | Xuất SRDF không đủ |
| G-HW | Robot identity, calibration, kiểm thử safety/motion và xác nhận chủ trách nhiệm | Đúng robot/config/environment thực | Mac simulation không đủ |

G-NATIVE trong đề xuất là nhóm hai native gates trên. Không đổi gate IDs/status cũ; bảng này là mapping scope mới, không ghi đè các ledger hiện hữu.

## 3. Scenario và oracle cụ thể

All fixture dimensions, noise, speeds và thresholds là test data có provenance `assumed`. Test suite không được đọc chính assertion result do controller tự báo để kết luận pass; kiểm từ input, observed trace và journal độc lập.

| ID | Fixture/trigger | Expected và oracle |
|---|---|---|
| LF01 | Serve chassis, 2 bánh, 3 khay, 2 support nghiêng, LiDAR | Một connected tree/entity; parity sets/transforms/inertials pass; assumption badges còn nguyên |
| LF02 | Bỏ một joint, thêm root, tạo cycle/unknown child | Fail đúng topology, source link/joint IDs trong issues; không có reference artifact được đánh validated |
| LF03 | Inertia negative, non-finite, non-positive-definite, triangle inequality sai | MEKONIQ raw check fail; case âm bị LF parser đổi thành stability floor vẫn fail `LF_IMPORT_MUTATION` nếu chạy diagnostic path |
| LF04 | Tên `chassis/body`, `a:b`, `a_b`; input parser drop link | Name map collision-free/truy ngược; loss detection qua tập IDs/graph, không chỉ count |
| LF05 | Missing inertia, missing collision, LiDAR frame không tồn tại | Missing theo scope bị chặn/inconclusive; không mass/inertia mặc định; sensor check attribution đúng |
| LF06 | Shadow timeout, missing venv, đổi model sau report | Không làm mock/native compile fail; không cache report dưới input mới; not_run/failed rõ |
| CMP01 | Box biết kích thước; root lệch axle; yaw 0, ±π/2, π | Transform input→engine→UI round-trip <=1e-9; renderer DTO <=1e-6; không flip y hai lần |
| CMP02 | Khay/thanh nhô sau chassis, sphere/cylinder nghiêng, mesh-only | Hull bao mọi primitive bound; asymmetry giữ nguyên; mesh-only bị chặn, không point fallback |
| CMP03 | Hai variant width 0.54/0.58 m, corridor 0.60 m, margin 0.02 m mỗi bên, các part khác hẹp hơn | Clearance 0.02/-0.02 m, case hẹp có đường thẳng, rộng bị no_path; fixture khác có khay rộng 0.65 m thì cả hai bị chặn |
| CMP04 | Obstacle rectangle tại corner, table point+handoff, target enclosed/out-of-world | Center mapping đúng; target trong obstacle/outside bị admission reject; enclosed nhưng free target được admit rồi controller no_path |
| CMP05 | Cùng inputs compile 2 lần; đổi world/model/beam count/policy | Same canonical/bytes hashes nếu cùng toolchain; từng thay đổi invalidates đúng outputs; old bundle bất biến |
| IR01 / IR-FD01 | Kitchen→table05→parking, explicit scripted staff actor | Không served trước load/handoff; completion leg đủ tolerance/dwell; path distance từ observations, không từ planned path |
| IR02 / IR-FD03 | Pedestrian đi ngang tại tick 100, v=0.5 m/s, radius=0.25 m | Dừng/đổi đường theo sensor, không physical overlap; sau khi người rời tiếp tục đúng mission. Timeout 6000 ticks; actual dynamic observation refs bắt buộc |
| IR03 / IR-FD04, IR-FD04-blocked | Static free goal bị bao kín; dynamic obstacle chặn lâu | no_path và blocked/timeout phân biệt; zero served; reason/domain attention và timestamps đúng |
| IR04 / IR-FD07 | Hai robot đối diện corridor có entry/exit clear, goals ở hai đầu | Một zone owner tại mọi tick; đủ footprint clearance; sau release robot kia tiến; cả hai hoàn thành trong 12,000 ticks cho campaign |
| IR05 | Cancel giữa đường; duplicate cancel; cancel ACK bị mất | Bounded sim stop, một terminal event, không handoff/served giả; lost ACK→unknown; không tự replay command |
| IR06 | Collision chủ động trong worker integration fixture với control guard disabled **chỉ trong test** | Engine overlap event có IDs/tick, controller báo attention, oracle expected collision pass; config này không được admission trong UI production |
| IR07 | Obstacle mỏng 0.002 m nằm giữa hai poses, controller step dài đi xuyên | Independent swept oracle hoặc command guard phát hiện; không claim engine discrete collision đã thấy nếu chỉ guard thấy; không no-contact pass thiếu coverage |
| IR08 | Same seed+locks+scene, 3 runs mới; một ca noise gaussian stddev=0.01 m | Discrete events/states/ticks bằng nhau; pose <=1e-9, scan <=1e-6; khác seed đổi noisy scan, không buộc business outcome khác |
| IR09 | Pause/getState/repeated step request/resume; speed 1× và 4× | Tick đứng yên khi pause/read; exact duplicate không advance lần hai; trace normalized bằng nhau giữa pacing |
| IR10 | Kill worker trước/sau ACK; late snapshot, invalid sequence/world/boot | Run suspended/unknown, no resend; giữ journal/cargo/reservation, replay gap; reclaim read/reconcile không motion |
| SEN01 | Wall biết tọa độ, LiDAR offset+yaw, miss/below_min/invalid | Range tới mặt tường trong 1e-5 m; ray transform độc lập; JSON không NaN/Inf, null có beam state |
| SEN02 | Unsupported noise/rate/latency/dropout/tilt; stale scan | Preflight reject hoặc explicit unsupported; không dùng defaults để báo sensor supported |
| EVI01 | SSE bị backpressure/disconnect, durable write bình thường | Full run artifacts đủ tick horizon; SSE dropped không làm metrics thay đổi |
| EVI02 | Corrupt/missing chunk, quota exhausted | Hash/coverage check fail/inconclusive, không complete verification; old evidence immutable |
| EVI03 | Import/report/replay và seek mọi cursor | 0 robot/cell/worker effects; business và sensors chỉ từ samples <=cursor; gaps hiển thị unavailable |
| INT01 | Edit chassis khi run đang chạy, reset/rerun, backend change | Active inputs bất biến; current design stale; new run IDs/hash đúng, không đổi provider run cũ |
| INT02 | Flags off, missing worker, native selected on Mac | Mock/editor còn dùng được; IR/native unavailable đúng reason; no fallback/no hardware access |
| INT03 | Batch 20 sequential runs, max concurrency 2; hai run khác seeds/worlds | Output directory độc lập; không collision ID/RNG/clock contamination; child count trở về baseline sau close |
| INT04 | Browser VI/JA/EN, desktop/tablet/mobile/2D/WebGL loss | Không lost controls/data; UI pose tại sample tick khớp backend <=1e-6; labels có scope/provenance |

IR-FD07 timeout 12,000 ticks là scenario override có hash; run quota 30,000 ticks vẫn giữ. Các IDs `IR-*` là variants mới có revision/basedOn riêng; schedules/maxTicks của FD legacy không đổi. Mọi override policy phải được manifest khóa, không ghi đè global policy object trong bộ nhớ.

## 4. Fidelity và metrics

IR-SIM release profile: geometry=`modeled/conservative`, planar kinematics=`modeled`, lidar raycast=`modeled`, rigidBody3d/actuator torque/contact dynamics/arm/grasp/SLAM=`unsupported`, calibration=`not_calibrated`. LinkForge report là model consistency, không simulator execution. Không dùng từ physics verified cho toàn robot từ một boolean `dynamics`.

Metrics dùng full durable trace: travelled distance (m), mission duration/queue/human wait (s sim time), min polygon separation (m), blocked duration (s), collision episodes và completion reason. Collision episode là một cặp objects từ clear→overlap tới clear; không đếm lặp mỗi tick. Unknown/missing pose/sensor coverage tạo unavailable cho metric liên quan. Min separation chỉ một robot thì robot–robot metric unavailable. Collision evidence nêu `engine_discrete`, `swept_oracle` hoặc `safety_envelope` để không trộn ba loại.

Performance target trên Mac arm64 tham chiếu đã ghi model CPU/RAM, fixed scene 10 bàn, 2 robots, 360 beams/robot, publish 10 Hz: realtime factor median >=1 ở 1×; end-to-end step p95 <=20 ms trong steady-state 60 s; RSS <=1 GiB/worker; UI theo NR12 desktop p95<=33 ms, tablet emulated 2D<=50 ms. Đây là target cần đo, chưa có số đo mới. Nếu không đạt, giới hạn feature/cadence công bố có version và chạy lại gates; không đổi dt hoặc giảm fidelity âm thầm.

## 5. Regression bắt buộc

Giữ inventory NR01–NR12 tại [physical-lab compatibility](../../../../../lab/docs/specs/2026-11-06-physical-robot-lab/compatibility.md). Source/lab commits, pin, source artifact/schema hashes và external gate statuses phải được chụp trước A00, sau mỗi lần repin và trước qualification. Không thay old pass bằng skip để vượt gate.

| Nhóm | Bằng chứng phải giữ |
|---|---|
| Design/storage | Catalog/BOM/energy, assembly scene, autosave/import/export, undo/redo, legacy migration, original preservation |
| Runtime business | S01 v1, FD01/BV01 hai recipes, mixed/cup ledger, FD02/03/04/05/07, legacy campaign |
| Native compatibility | Gazebo/Nav2, coffee-simulation, LinuxCNC/PUMA, engineering arm profiles; portable tests pass, native tests chưa chạy giữ not_run |
| Clock/recovery | Input locks/reset, event cursor/SSE, freshness, fault schedule, cancel, reclaim view/reconcile |
| Evidence | Immutable saved/imported reports, replay transport-deny, human wait/KPI, export/candidate, compare scope |
| Distribution/UI | No-runtime preview, clean pin/import, mock launcher, Node-only offline bundle, VI/JA/EN/a11y/2D/performance |

Lệnh chuẩn sau implementation, chạy trong đúng repo và Node24:

```sh
# source/
pnpm contracts:check
pnpm typecheck
pnpm exec vitest run tests/contracts/engineering-contracts.test.ts tests/unit/engineering-assembly.test.ts tests/integration/lab-v2-mock.test.ts tests/integration/lab-v2-bv01-ports.test.ts tests/integration/lab-v2-stream.test.ts tests/integration/lab-v2-recovery.test.ts
# lab/
pnpm check:source
node scripts/sync-engineering-contracts.mjs --check
pnpm typecheck
pnpm test
pnpm build
pnpm test:runtime-e2e
pnpm test:mock-e2e
```

Đó là nhóm smoke/diagnostic; release phải chạy recorder hiện có `node scripts/record-regression.mjs --suite physical-robot-lab --out <fresh-evidence-dir>` trên source/Lab đã commit sạch với pin candidate. Thay `<fresh-evidence-dir>` bằng thư mục mới của candidate theo C03; không dùng default vì default có thể thay historical output. R-MOCK guard đọc explicit `LAB_V2_REGRESSION_DIR`; không dùng manifest cũ với code mới. Full CI cần dependencies/services như Supabase theo repo, thiếu thì ghi blocker và chưa release phạm vi phụ thuộc.

## 6. Evidence layout và review

Root mới `source/docs/implementation/evidence/linkforge-irsim/<candidate-id>/` khi qualification; mutable run data lớn ở `.lab/irsim/` không commit. Commit sanitized reports, fixture inputs, compact traces cần thiết, file hashes và đường dẫn artifacts phát hành. `<candidate-id>` là ID đã ghi trong manifest, không hardcode ngày nghiên cứu.

Manifest phải chứa: baseline/candidate source+Lab commits/pin, dirty=false, toolchains, lock hashes, requirement/test/gate mapping, command/exit/timestamps, pass/fail/skip/reasons, artifacts sha256/byte counts, platform, model/world/policy identities, acceptedBy/acceptedAt chỉ sau review. Secrets/session proofs không được export.

Reviewer kiểm riêng: (1) integration scope được chứng minh; (2) NR01–NR12 còn giữ; (3) các native/hardware/R-MOCK acceptance chưa được đóng. Final gate record ban đầu `accepted:false`, dù tất cả software assertions pass. Nếu change code/pin sau recording phải record candidate mới. Chỉ chỉnh spec không cập nhật gate ledger hiện hữu.
