# Nghiên cứu LinkForge + IR-SIM cho MEKONIQ Lab

Ngày kiểm tra: **2026-11-08**. Phạm vi: đọc code, tài liệu chính thức, metadata package và chạy probe trong hai virtual environment tạm trên macOS arm64. Đây là **bằng chứng nghiên cứu**, không phải implementation/acceptance của tích hợp.

Đọc tiếp: [spec](../superpowers/specs/2026-11-08-linkforge-irsim/README.md), [plan](../superpowers/plans/2026-11-08-linkforge-irsim/README.md), [kết quả probe](2026-11-08-linkforge-irsim/probe-results.json).

## 1. Kết luận

Đề xuất tích hợp qua adapter là phù hợp. Có thể bắt đầu trên Mac, giữ MEKONIQ sở hữu model, world, mission, journal và evidence. Tuy nhiên, cần sửa một số giả định trước khi giao việc cho coding agent:

1. **Đã có compiler URDF/SDF**. Dùng đầu ra hiện tại cho shadow validation; chưa cần viết lại generator.
2. **LinkForge không phải validator nguyên trạng của URDF đầu vào**. Trong bản 1.6.0 đã thử, parser bỏ phần tử lỗi và thay inertia không hợp lệ bằng tensor tối thiểu. `is_valid=true` có thể áp dụng cho model đã bị thay đổi. Cần validation của MEKONIQ, đổi tên có truy vết và kiểm tra parity trước/sau parse.
3. **Backend simulation hiện bị gắn với Linux/native** ở cả readiness và UI. Chỉ thêm tên `irsim_2d` vào dropdown không đủ.
4. **ResolvedAssembly hiện chỉ giữ một drive binding**. Cần mở rộng có version/opt-in trước khi chạy hai AMR engineering khác nhau; không được dùng drive của robot cuối cho cả fleet.
5. **Catalog LiDAR hiện là candidate chưa có model**. Demo phải bổ sung hình học, mount, sensor parameters có nguồn giả định rõ; chưa thể dùng catalog entry như thông số đã xác minh.
6. IR-SIM mô phỏng chuyển động/cảm biến; controller, quyền mission, xác nhận tải/giao, timeout và recovery vẫn cần thiết kế. `env.done()` không phải bằng chứng giao món thành công.

## 2. Baseline mã nguồn

| Thành phần | Baseline đã đọc | Nhận xét |
|---|---|---|
| `source` | `37cf02db2a6363bc07c251213a64caac0bdfc6c6`, `main`, sạch trước nghiên cứu | Có engineering và native providers |
| `lab` | `d503f06b5c0e5f4065c4dd845c87cfd367bfdbb7`, `main`, sạch trước nghiên cứu | Có assembly editor, Twin, report/replay, mock/offline launcher |
| Runtime mà Lab pin | `899a83769726aa6840c40a32fb0e89d17a137cb7` | Khác source HEAD; `pnpm check:source` xác nhận pin hợp lệ, không tự repin |
| Schema trong pin | `7f93a1e1d27b345a64e766c8d67df93a3dc2bbffd92aa7ee16754bccbfc6f222` | Protocol major 1/2 |
| `lab/feat/robot-lab` | Là ancestor của `lab/main` | Không checkout/merge lại nhánh lịch sử |
| `source/feat/lab-digital-twin-v2` | Tip `f82b2057cae89b0029968212753df01f86f334ad`, không là ancestor của `main` | `main` có commit tích hợp `5c86337`; các backend/native-campaign/native-providers đã đối chiếu không có diff. Không suy mọi commit nhánh cũ đã merge chỉ từ ancestry; A00 chụp inventory trước phát triển |

Các điểm bám code, tính từ `source/`:

| File/module hiện có | Tái sử dụng | Khoảng thiếu cần xử lý |
|---|---|---|
| `packages/contracts/schemas/engineering-{component,project,bundle}.schema.json` | SI, `Scalar`, `SourceRef`, links/joints, geometry, provenance, hash | Chưa có projection/navigation/validation report contracts; profile enum đóng |
| `packages/lab-runtime/src/engineering/assembly.ts` | `resolveAssembly`, `linkWorldPoses`, `prepareEngineeringCompileInput` | `models.drive` là singleton; `models.sensor` theo instance; export asset bỏ qua mesh collision |
| `robotics/simulation/compiler/engineering.py` | URDF mỗi entity, SDF, scene/frames/controllers/manifest | ID link chứa `/`; URDF generator hiện chưa xuất sensor semantic đầy đủ |
| `robotics/simulation/compiler/models.py` | World validation, SI transform, primitive bounds | Footprint hiện là AABB/radius; không tự có polygon chính xác hoặc nhận thức chiều cao LiDAR |
| `packages/lab-runtime/src/engineering/gateway.ts` | Bundle ownership, closure, staging, hash và admission | Bundle profile phải khớp backend set; không gán `runnable=true` của native cho IR-SIM |
| `packages/lab-runtime/src/v2/{capabilities,readiness,gateway,scenario-matrix}.ts` | Server-owned backend sets, paired session, factory | Readiness dùng `mode==='simulation'` để yêu cầu Linux; cần policy theo provider |
| `packages/lab-runtime/src/v2/{session,scenario-runner}.ts` | SourceSession, domain/journal, ScenarioRun | Mock runner gắn MockPlant; native lifecycle chuyên native. Cần runner IR-SIM riêng, tái sử dụng domain/dispatcher |
| `packages/lab-runtime/src/v2/backends/{simulated-navigation,zone-bridge}.ts` | Command correlation, unknown/no-retry, reservation authority | Gazebo adapter gắn Nav2; IR-SIM phải có adapter riêng |
| `packages/lab-runtime/src/v2/{telemetry,report}.ts` | Bounded SSE/ring, canonical outcome | Telemetry report còn nhãn mock cố định; ring lossy không đủ làm trajectory oracle |
| `../lab/src/ui/workspace.ts` | Selector backend set, scenario controls, inspector | Mode simulation hiện chặn manual step/play kiểu mock; cần clock capabilities |
| `../lab/src/viewer/{twin3d,engineering-scene}.ts` | Renderer ROS→Three `(x,z,-y)` | Cần layers LiDAR/footprint và hiển thị obstacle geometry thật; biểu tượng bàn chưa là vật cản |
| `scripts/export-lab-runtime.mjs`, `../lab/scripts/{import-runtime,sync-engineering-contracts,build-offline}.mjs` | Clean artifact/pin và schema sync | Export hiện mô tả simulation tools là Linux, phân phối riêng; Python workers Mac cần metadata riêng |

`WorldRevision` trong đề xuất tương ứng với **`LabProjectV2.world`**, identity `{id, revision, hash}`; `ResolvedAssembly` có **`assemblyDigest`**, chưa có trường `assemblyRevisionId`. Không tạo ID giả để lấp khoảng trống này.

`robotics/catalog/components/slamtec-rplidar-s2.json` có `links/joints/ports/models=[]`, SKU `null`, status `candidate`. Hình MEKONIQ Serve ba khay/hai thanh nghiêng cần fixture engineering cụ thể; không lấy dáng renderer làm bằng chứng đã có collision geometry.

## 3. Kiểm chứng thư viện

| Thuộc tính | LinkForge | IR-SIM |
|---|---|---|
| Package đã xác minh trên PyPI và cài trong probe | `linkforge-core==1.6.0` | `ir-sim==2.12.0` |
| Ngày phát hành quan sát | 2026-11-07 | 2026-10-04 |
| Python tối thiểu khai báo | 3.11 | 3.10 |
| Python thực chạy probe | 3.11.15 | 3.11.15 |
| License package | Apache-2.0 | MIT |
| Dependencies đáng chú ý | PyYAML >=6.0.3 | NumPy, SciPy, Shapely >=2.1.2, Matplotlib, PyYAML, ImageIO, Loguru |
| Lựa chọn đầu tiên | Headless core, không Blender | Headless, không keyboard/ORCA extras |

Nguồn: [LinkForge package metadata](https://pypi.org/pypi/linkforge-core/1.6.0/json), [IR-SIM package metadata](https://pypi.org/pypi/ir-sim/2.12.0/json), [LinkForge core pyproject](https://github.com/arounamounchili/linkforge/blob/v1.6.0/core/pyproject.toml), [IR-SIM pyproject](https://github.com/hanruihua/ir-sim/blob/v2.12.0/pyproject.toml).

`source/robotics/simulation/requirements-dev.txt` hiện pin PyYAML 6.0.2, thấp hơn yêu cầu core mới. Giữ workers trong venv riêng; không nâng toàn bộ native toolchain để cài LinkForge. Các pin trên là **ứng viên đã probe**, chưa phải dependency được nghiệm thu với MEKONIQ. A00 phải sinh lock đầy đủ, hashes và kiểm tra trên target host. Không dùng `latest` trong build.

### LinkForge: kết quả quan trọng

Probe dùng robot hai links và một fixed joint, primitive box với inertia do builder sinh. Sau đó sửa từng yếu tố trong XML rồi gọi `read_urdf()` và `RobotValidator().validate()`:

| Ca | Quan sát thực tế 1.6.0 | Hệ quả |
|---|---|---|
| Model hợp lệ | 2 links, 1 joint; valid | API cơ bản hoạt động |
| Xóa joint | Hai root; invalid `multiple_roots` | Có topology validation |
| Đặt `ixx=-1` | Parser thay `ixx` thành `1e-9`; validator trả valid, không issue | Phải kiểm số liệu gốc và parity; không cho parser sửa âm thầm |
| Link đổi thành `chassis/body` | Parser bỏ link đó và joint; 1 link/0 joint còn lại vẫn valid | Đổi tên trước import; đối chiếu tập ID và graph, không chỉ số lượng |
| Xóa inertial | Valid kèm cảnh báo missing inertia | Policy MEKONIQ phải quyết định mức chặn theo scope |

Probe negative ban đầu **fail kỳ vọng** vì hai ca sai vẫn `valid`. Đã truy nguyên trong package: `_parse_inertial_element` bắt lỗi rồi dùng `InertiaTensor.stability_floor()`; `_build_robot_from_stream` bỏ links/joints lỗi. Kết quả này được giữ nguyên trong JSON nghiên cứu. Không sửa thư viện trong lượt này. Xem [parser inertia](https://github.com/arounamounchili/linkforge/blob/v1.6.0/core/src/linkforge/core/parsers/xml_base.py), [URDF parser](https://github.com/arounamounchili/linkforge/blob/v1.6.0/core/src/linkforge/core/parsers/urdf_parser.py), [validation API](https://linkforge.readthedocs.io/en/latest/reference/api/validation.html).

Composer có `RobotBuilder`, `build`, `export_urdf`, `export_srdf`; `read_urdf` nhận path hoặc XML. Dùng Composer khi cần dựng model từ canonical data để kiểm chéo; không tự `.mass()` rồi chấp nhận inertia tính từ visual geometry như dữ liệu đo. SRDF cần semantic policy riêng; xuất được XML không chứng minh MoveIt chạy. [Composer API](https://linkforge.readthedocs.io/en/latest/reference/api/composer.html), [SRDF](https://linkforge.readthedocs.io/en/latest/reference/api/srdf.html).

### IR-SIM: kết quả quan trọng

Probe tạo YAML hai diff-drive robots trong một environment, polygon bất đối xứng, một tường và LiDAR offset 0.1 m. `irsim.make(path, headless=True, seed=17)` hoạt động; 10 lần `env.step({'r1':[0.2,0], 'r2':[0.1,0]})` với `step_time=0.02` cho displacement 0.04/0.02 m và stamp 0.2 s. Beam giữa đo xấp xỉ 2.8 m ban đầu, 2.76 m cuối; `get_msg()` giữ snapshot cũ độc lập. Hai lần tạo environment mới cho kết quả bằng nhau trong probe này. Đây chưa chứng minh deterministic navigation có noise, crowd hoặc đa nền tảng.

Các quyết định rút ra từ [EnvBase API](https://ir-sim.readthedocs.io/en/stable/api/irsim/env/env_base/index.html), [messages source](https://github.com/hanruihua/ir-sim/blob/v2.12.0/irsim/msg/messages.py), [LiDAR API](https://ir-sim.readthedocs.io/en/stable/api/irsim/world/sensors/lidar2d/index.html) và package thực chạy:

- `get_msg()` trả dataclasses và NumPy arrays, không phải JSON sẵn dùng. `LaserScan` message không có trường `valid`; dùng `use_inf=True` rồi chuyển các special values sang JSON finite/null + trạng thái beam rõ ràng.
- Diff-drive nhận vận tốc thân `[v, omega]`. Wheel radius/separation cần cho validation/đổi wheel rates; không tự sinh slip, torque hoặc battery model.
- Polygon giữ offset với origin robot trong probe; vẫn cần ca yaw và footprint nhô sau trong compiler tests.
- LiDAR object cập nhật trong step; `scan_time` không đủ làm scheduler. Adapter phải chọn cadence công bố và mô tả acquisition assumptions.
- Environment có RNG riêng khi truyền seed, nhưng context parameters vẫn có binding trong process. Chọn một process cho một world/run để cách ly lifecycle và tài nguyên; nhiều robot của cùng run ở chung environment. [RNG](https://github.com/hanruihua/ir-sim/blob/v2.12.0/irsim/util/random.py), [environment state](https://github.com/hanruihua/ir-sim/blob/v2.12.0/irsim/config/env_param.py).

IR-SIM 2.12.0 **có** planar contact mode dùng mass/friction/inertia. Spec chủ động chọn `collision_mode: stop` trong giai đoạn này, chỉ claim planar kinematics/raycast/geometric collision. Không đồng nhất contact 2D với động lực học robot 3D. Built-in dash/RVO/ORCA và planners là các lựa chọn thuật toán, không thay Nav2 qualification. [Release 2.12.0](https://github.com/hanruihua/ir-sim/releases/tag/v2.12.0), [YAML reference](https://ir-sim.readthedocs.io/en/stable/yaml_config/configuration.html).

## 4. Baseline checks đã chạy

Dùng Node **24.22.2** qua PATH riêng cho lệnh; shell mặc định đang là Node 26.3.0. Không đổi cấu hình hệ thống.

| Repo | Lệnh/phạm vi | Kết quả |
|---|---|---|
| source | `pnpm contracts:check` | Pass |
| source | `pnpm exec vitest run tests/contracts/engineering-contracts.test.ts tests/unit/engineering-assembly.test.ts tests/integration/lab-v2-mock.test.ts tests/integration/lab-v2-stream.test.ts tests/integration/lab-v2-bv01-ports.test.ts` | 5 files; **66 pass, 1 skipped** |
| lab | `pnpm check:source` | Pin/schema/protocol 1/2 được xác nhận |
| lab | `pnpm exec vitest run tests/unit/engineering-assembly.test.ts tests/unit/report-replay.test.ts tests/integration/engineering-storage.test.ts tests/integration/simulation-capability.test.ts` | 4 files; **26 pass** |

Ca skipped là phép đo opt-in telemetry latency/memory, chỉ chạy khi `LAB_V2_MEASURE` được đặt. Không tính là pass và không có benchmark mới. Chưa chạy full regression, browser, offline fresh-machine, native hay hardware trong nghiên cứu này.

Bằng chứng lịch sử `lab/docs/implementation/evidence/physical-robot-lab/release-2026-11-07-r3/acceptance.json` có 96 pass, 4 not_run UNSUPPORTED_FIDELITY, 5 NEEDS_HUMAN, 1 BLOCKED_EXTERNAL. Không thay đổi **R-MOCK chưa accepted**, gate Linux hoặc hardware từ những checks chọn lọc trên.

## 5. Các lựa chọn và phần chưa kiểm chứng

| Cách làm | Chi phí/rủi ro | Quyết định |
|---|---|---|
| Projection từ MEKONIQ → hai adapter; LinkForge shadow | Giữ contracts/domain, cần worker isolation và parity | Chọn |
| Đổi generator chính sang LinkForge ngay | Rủi ro mất vendor tags, IDs, sensor/semantics và thay hash toàn bộ | Hoãn; chỉ xem lại sau matrix parity và native gate |
| Đợi Gazebo/ROS2 cho mọi thử nghiệm | Fidelity native tốt hơn cho use case tương ứng, phụ thuộc Linux | Giữ đường native song song; không chặn phát triển 2D trên Mac |

Còn phải kiểm: geometry Serve đủ ba khay/thanh nghiêng, sensor mount/range có nguồn, schema multi-drive, controller policy trong nhà hàng, semantics delay/dropout, cross-run process isolation, deterministic noisy replay, tải dài hạn và phân phối workers. Plan đặt task và oracle cho từng mục; không cần câu trả lời về hardware để bắt đầu A00–B01.

Thông tin license lấy từ [core license](https://github.com/arounamounchili/linkforge/blob/v1.6.0/core/LICENSE), [Blender/root license](https://github.com/arounamounchili/linkforge/blob/v1.6.0/LICENSE) và [IR-SIM license](https://github.com/hanruihua/ir-sim/blob/v2.12.0/LICENSE). Đóng gói core, giữ notices/license và inventory dependencies/assets; Blender extension không thuộc đợt phân phối đầu. Đây là inventory kỹ thuật cho release, không phải kết luận pháp lý cho mọi cách phân phối.

Quy ước SI/frame theo [ROS REP-103 nguồn chính thức](https://github.com/ros-infrastructure/rep/blob/master/rep-0103.rst); special ranges theo [REP-117](https://github.com/ros-infrastructure/rep/blob/master/rep-0117.rst). Trang ros.org bị access denied khi nghiên cứu nên đã đọc bản nguồn chính thức trên GitHub.
