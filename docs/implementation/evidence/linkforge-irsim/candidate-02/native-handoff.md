# Bàn giao native (Linux/ROS 2/Gazebo/Nav2, MoveIt/LinuxCNC) — candidate-02

Tài liệu này ghi lại **những gì bằng chứng portable (LinkForge shadow + IR-SIM 2D) đã khẳng định và chưa khẳng định**, để nhóm chạy native trên Linux tiếp nhận mà không phải suy diễn. Nó không đổi ID/trạng thái gate cũ và không ghi đè ledger hiện hữu (`lab/config/simulation-compatibility.json`, `source/docs/implementation/verification.md`).

## 1. Trạng thái gate

| Gate | Trạng thái | Nguồn |
|---|---|---|
| G-LF1, G-LF2, G-IR1, G-IR2, G-INT1 | `tested`, `accepted: false` | `qualification.json` của candidate này (reviewer chưa xác nhận) |
| G-IR3 | `not_run`, `accepted: false` | IR07 `not_run` có lý do (plant giới hạn 0.5 m/s, chỉ có unit test oracle quét); các case IR02/03/05/06/08/09/10 `tested`. Reviewer có thể quyết định đọc IR07 là `tested` theo §3 (oracle quét độc lập) — xem README |
| G-NATIVE-AMR (Gazebo/Nav2) | `not_run` | Không có host Linux/ROS 2; `lab-sil.mjs doctor --backend gazebo_nav2` trên host ghi nhận là `not_run` (plan 02) |
| G-NATIVE-ARM (MoveIt2/Gazebo, LinuxCNC) | `not_run` | `linuxcnc_sim` `installed:false` trên host ghi nhận (plan 03); không xuất SRDF có ngữ nghĩa |
| G-HW | `blocked_external` | Không có robot, calibration đo, hay xác nhận chủ trách nhiệm |
| R-MOCK, R-SIM, G-SIM-NAV, G-SIM-ARM, G-SIM-E2E, G-HW-READY, G-HW-ACCEPT | Giữ nguyên theo `lab/config/simulation-compatibility.json` | Bằng chứng 2D không thay thế |

## 2. Định danh đầu vào (hash SHA-256)

### 2.1 Fixture Serve (`source/robotics/navigation-2d/fixtures/serve-demo-v1`, manifest `802902b194932b08…`)

| File | SHA-256 (16 ký tự đầu) | Bytes |
|---|---|---|
| serve-project.json | 5ca48410be47efe5 | 11028 |
| serve-fleet-project.json | 8204f39a1a39db6c | 15742 |
| serve-enclosed-project.json | 90a73f17da8eea57 | 11457 |
| serve-noisy-project.json | e3f247fe423f9ec0 | 11028 |
| serve-components.json | 07cae981082cc084 | 63686 |
| serve-sensor-model.json | b93879192cf9b9e5 | 2646 |
| restaurant-10-tables.json | 8276f8ef026b1708 | 4872 |
| navigation-policy.json | 7a0a75ed094c57a4 | 1050 |
| navigation-scene.json | 4aff7df1b8daa33b | 12909 |
| navigation-scene-two-robot.json | 3cedbc43e631cffe | 18473 |

Hash đầy đủ nằm trong `manifest.json` của fixture. Geometry là **minh họa**: kích thước, khối lượng, nhịp LiDAR và số tia là giả định đầu vào; inertia được suy ra. Không có giá trị đo hay khóa theo nhà cung cấp.

### 2.2 Mô hình vật lý, URDF và name-map (từ báo cáo validation trong campaign)

| Robot | `physicalModelDigest` (robot-physical-model/1) |
|---|---|
| robot02 (serve-fleet-v1) | `b77a7fc332c5377171688249c6cd8fc0e55f8ee8453261f5d92e122e3bda2231` |
| amr-1 (Serve: serve-demo-v1 / serve-noisy-v1 / serve-enclosed-v1 — ba bản project, cùng robot) | `23af68a3dc3648018723aed6ce70860074cc3b0a4596d94be653cb3d1d9a9925` · `98d2fc18f0e6f61a8fd229f9dbd2451f779e24543c5d1619f068e4543a782c2e` · `4f8c67cf4a5bcabcbe44a6cc27d5c69068169d0c391d1cf818b58cbee39058c7` |
| robot01 (serve-fleet-v1) | `80bfe9799dc118bed5d5159fd7885b91fd3fd4dc0bcd5699a19960905d3aeee5` |

Nguồn: các blob `navigation-model-2d` trong `campaign/engineering/blobs/`; mỗi `runs/*/report.json` khóa đúng model digest của run đó. Report validation LinkForge (`inputUrdfRef`, `nameMapRef`, `referenceUrdfRef`) được sinh trong suite `lf`/`lf-py` và hành trình Lab (`lab-e2e-journey`, ảnh `irsim-assembly-validated-*`); chúng nằm trong store tạm của từng test, không được chép vào candidate này. Tái tạo: mở Serve trong Lab (`lab:irsim`) → Compile → Validate, hoặc `pnpm exec vitest run tests/integration/engineering/linkforge*.test.ts`.

- `physicalModelDigest`: digest của `robot-physical-model/1` (nguồn sự thật phía source).
- `inputUrdfRef.sha256`: byte URDF nhập vào LinkForge sau khi đổi tên qua name-map.
- `nameMapRef`: bảng hai chiều `l_`/`j_`/`s_` + SHA-256 của ID nguồn (UTF-8); không trùng, truy ngược được. Mọi issue trong report đã được dịch về ID gốc.
- `referenceUrdfRef`: URDF tham chiếu do LinkForge xuất lại, so với input theo precision khai báo (geometry/pose ≤1e-6 m/rad, mass ≤1e-6 kg).
- `referenceSrdfRef`: **null** theo thiết kế — không giả SRDF có ngữ nghĩa (nhóm cộng tác/disable-collision cần MoveIt Setup Assistant trên mô hình thật).

### 2.3 Robot description ROS hiện có (chưa được candidate này kiểm)

| File | SHA-256 (16) |
|---|---|
| robotics/description/urdf/restaurant_robot.urdf.xacro | 79ecdea19835e399 |
| robotics/description/config/geometry_sim.yaml | 36e71eb4b204fccf |

LinkForge shadow kiểm **URDF sinh từ engineering project** (fixture Serve), không kiểm xacro này. Khi chạy native, cần đối chiếu hai mô hình (footprint, bánh, cảm biến) trước khi coi kết quả 2D là tham chiếu.

### 2.4 Công cụ portable

| Công cụ | Pin | Closure digest |
|---|---|---|
| LinkForge (shadow worker `linkforge_worker`) | theo `robotics/model-validation/requirements.lock` | xem `identity.json` của campaign |
| IR-SIM | 2.12.0 (`ir-sim==2.12.0`, numpy 2.4.6, shapely 2.2.0, matplotlib 3.11.2) | `portableToolsDigest` trong `lab/config/source-runtime.lock.json` |

License inventory: `robotics/{model-validation,navigation-2d}/licenses.json`, kiểm bằng `node scripts/portable-licenses.mjs --check`.

## 3. Phạm vi đã kiểm và giả định

Đã kiểm (phần mềm, trên macOS, worker Python thật):
- Topology/shape/inertial của mô hình Serve qua LinkForge, ma trận lỗi LF02–LF06 phát hiện được cả lỗi mà parser upstream âm thầm sửa/bỏ.
- Điều hướng 2D: FD01 ba chặng, hai robot cùng world với reservation vùng (rig `IR-RIG-ZONE` cho tranh chấp; mission từ source được tuần tự hóa bởi `__venue_movement__`), obstacle/collision/cancel/no-path, lặp lại theo seed, replay không phát lệnh.
- Hành trình browser assembly→validation→run→report/replay với cùng hash xuyên source/worker/Lab.

Không kiểm và **không được suy ra**:
- Dynamics, độ bền, thông số đo; stopping distance/safety vật lý; cảm biến thật (LiDAR 2π của IR-SIM trùng tia 0/N-1, sample-time pose).
- Worker giới hạn |v| ≤ 0.5 m/s nên IR07 (tunnelling) `not_run` có lý do.
- Lặp lại bitwise xuyên nền tảng; general fleet deadlock freedom.
- Gazebo/Nav2 costmap/planner, MoveIt2 collision planning, LinuxCNC loop, grip/cup sensor.

## 4. Bước chạy native khi có Linux (profile cũ, không đổi)

1. Host Linux với ROS 2 + Gazebo (plan 02): `node scripts/lab-sil.mjs doctor --backend gazebo_nav2 --json` phải ra `ok` trước; rồi `lab-sil.mjs run --campaign <id> --out <dir>` và `lab-sil.mjs verify --input <dir>`. Ghi image digest + robot description hash (mục 2.3) vào evidence.
2. Arm: `lab-sil.mjs doctor --backend linuxcnc_sim`; controller PoC theo `lab/docs/implementation/evidence/digital-twin-v2/plan03-arm-hardware.md`. MoveIt2 cần SRDF sinh từ mô hình thật, không lấy từ candidate này.
3. Đối chiếu: cùng fixture Serve (mục 2.1) và cùng `physicalModelDigest` (mục 2.2); khác hash = khác đầu vào, không so sánh kết quả.
4. Chỉ sau khi native tests thực chạy và được review riêng, G-NATIVE-* mới đổi khỏi `not_run`. G-HW cần robot thật, calibration đo và xác nhận chủ trách nhiệm.

Không promote LF reference generator; Gazebo/Nav2 và MoveIt/LinuxCNC qualification vẫn tách riêng.
