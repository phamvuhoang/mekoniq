# Spike M00 — xArm 6 giữ pose và gắp cốc trong MuJoCo (R2a)

- **Ngày:** 2026-11-12 · **Máy:** Apple M2 Pro, macOS (Darwin 25.5.0), Python 3.11 (uv venv) · **Engine:** `mujoco==3.17.0` (chọn), đối chiếu `mujoco-core==4.0.1`
- **Spec:** [§6.1, D35/D38/D41/D43/D44/D45](../superpowers/specs/2026-11-12-realistic-arm-web-ui-design.md) · **Plan:** M00 · MJCF, script và bản clone của hãng nằm ngoài cây git (scratch); bản đầy đủ nhúng bên dưới
- **Kết luận: ĐẠT cả chín tiêu chí trên máy này** (macOS arm64, cũng đúng trong container linux/arm64). **Rủi ro mở, chưa kiểm:** trong container linux/amd64 chạy qua giả lập Rosetta, cùng MJCF và script, chuỗi gắp–đặt hỏng 10/10 lần trên cả 3.17.0 và 4.0.1 (mục "linux/amd64"). Đây không phải tiêu chí theo §6.1-7, nhưng phải chạy lại trên một máy amd64 thật trước khi dùng các tham số tiếp xúc dưới đây cho Cloud Run.

## Phiên bản (D35)

| Gói | Phát hành (PyPI, giờ upload) | Cài được | Ghi chú |
|---|---|---|---|
| `mujoco-core` 4.0.1 | 2026-11-11T16:18Z | có (`mujoco-core==4.0.1`, kéo numpy 2.4.6) | mới 1 ngày, chưa đủ 4 tuần |
| `mujoco-core` 4.0.0 | 2026-11-06T15:33Z | — | 6 ngày |
| `mujoco` 3.17.0 | 2026-10-22T23:34Z | có (kéo absl-py, etils, fsspec, glfw, numpy, pyopengl, typing-extensions, websockets, zipp) | bản 3.17 duy nhất trên PyPI |

Quy tắc D35: 4.0.x chưa có bản vá ≥ 4 tuần → **pin `mujoco==3.17.0`** (pip `mujoco`, import `mujoco`). MJCF ở cuối biên dịch **không đổi** trên 4.0.1 (cùng chuỗi XML; `m.nbody=16`, `m.ngeom=13` trên cả hai). Tiêu chí 2, 3, 4 chạy lại trên 4.0.1: cùng kết luận, số đo lệch ở chữ số thứ 3–4 (bảng dưới). Không dùng phần tử nào bị đổi ở 4.0 (`composite`, plugin `cable`, `sidesite`).

## Nguồn hãng (tiêu chí 1, D38)

Clone `--depth 1` nhánh mặc định, mỗi repo vào thư mục riêng; chỉ đọc file như dữ liệu (`python -I`), không chạy script/xacro nào của hãng.

| Repo | Nhánh | Commit | License |
|---|---|---|---|
| `xArm-Developer/xarm_ros2` | humble | `ac736c92b02de7ca7e0be6f737d77d46707464d8` (2026-10-20) | BSD-3-Clause, `LICENSE` (Copyright (c) 2018, UFACTORY Inc.), sha256 `685e81e0cd30124e24e834ea2bf39bfead4efc9907d021bc9d1ae0f2dcea1431`. `xarm_description/package.xml` ghi `<license>TODO: License declaration</license>`: license gói con không khai riêng, áp license gốc repo |
| `xArm-Developer/ufactory_genesis` | main | `82e094e4e57deec51d76a9c86d7830905f2b3ecc` (2026-10-29) | `LICENSE` MIT (code, "Copyright (c) 2026 Daniel Wang"); `NOTICE` nói tài sản dưới `assets/urdf/` "not pure original MIT-only", nguồn gốc xarm_ros2 "typical BSD-3 … full copy not vendored". Chỉ dùng để **đối chiếu**, không lấy giá trị hay file nào |
| `xArm-Developer/ufactory_robot_viewer` | main | `beeadf45f7e96afc5281cb2ea7ff2a63a816a5d7` (2026-11-04) | Không dùng (mô hình của nó là bản sao GLB từ ufactory_genesis @4012a34, theo `public/models/xarm6/SOURCE.md`) |

File dùng (tất cả trong `xarm_ros2@ac736c9`, `xarm_description/`):

| File | sha256 | Lấy gì |
|---|---|---|
| `urdf/xarm6/xarm6.urdf.xacro` | `73afc631fde21296af2f60f037e26234a294113f6e6a22e09dec43bc8b461593` | giới hạn khớp mặc định (dòng 4–9), `velocity="3.14"` (dòng 114, 145, 176, 207, 237, 268), quán tính `link_base` (dòng 67–73), `<dynamics damping="1.0" friction="1.0"/>`, chọn mesh `xarm6_1305` khi `model_num ≥ 1305` (dòng 15–21), file quán tính mặc định `xarm6_type6_HT_BR2` (dòng 46) |
| `config/kinematics/default/xarm6_default_kinematics.yaml` | `9e02c7ec66a06574d27cddebacfb294b8259b4e8b43cfc05d3bf38e8f358eac1` | gốc khớp xyz/roll |
| `config/link_inertial/xarm6_type6_HT_BR2.yaml` | `ee278042008ad01e0fbc95a3ce0c270c898fe73bb46793c8a54daf34234c0f5c` | khối lượng, trọng tâm, tensor quán tính link 1–6 |
| `config/xarm6/joint_limits_1305.yaml` | `db51c8e0b4b80bc378a8b16ae7e185e394393efb6eda89feb8c9cc9f41c096eb` | lực khớp 179.4445/179.4445/92/81.558/30.6/30.6 N·m |
| `urdf/gripper/xarm_gripper.urdf.xacro` | `e1987b755501636b7ba32518d98ecb5fc8c6d2c4b1c45a49d332d6672f22c8cb` | G2 = cùng macro G1, chỉ đổi đuôi mesh `_g2`/`dae` (dòng 9–13); khớp, trục, giới hạn 0–0.85 rad, effort 50, velocity 2, mimic, quán tính (dòng 23–223), `joint_tcp` z = 0.172 (dòng 227–228) |
| `urdf/xarm_device_macro.xacro` | `571dd90dd5ae4d8aa549686a253050e0576d0ef29755121cd2d7a95b24649eda` | `link_eef` trùng gốc `link6` (dòng 240–243), tay kẹp gắn vào `link_eef` (dòng 257) |
| `meshes/xarm6_1305/visual/link_base.stl` | `479e88e779dcb811721d70ce0463c20cc22d8db196fa6c61af2e3f0d06c2dc28` | mesh hiển thị (STL nhị phân), 3000 tam giác |
| `meshes/xarm6_1305/visual/link1.stl` | `25fdfe132e46c5f5cf8ea8bfdeb52b5f7bfd4765179a6299fd9e2276ea3152b9` | mesh hiển thị (STL nhị phân), 5814 tam giác |
| `meshes/xarm6_1305/visual/link2.stl` | `d9fdfbb44a966f9c48479b8d015c98af396ad643c0a65d87219342c59d322d82` | mesh hiển thị (STL nhị phân), 5830 tam giác |
| `meshes/xarm6_1305/visual/link3.stl` | `48336e399ce49b8575da43c8053f7e0a07ec6774a11f57276aa1c0e327143a81` | mesh hiển thị (STL nhị phân), 6816 tam giác |
| `meshes/xarm6_1305/visual/link4.stl` | `29d52195102bc5a01f29d97d2f0c8a32883a8050a2a29447ee9f70d7bad67943` | mesh hiển thị (STL nhị phân), 4860 tam giác |
| `meshes/xarm6_1305/visual/link5.stl` | `25272c881b50cf1d69d1a675fc2801a3e83e51186e3c999599ca482e50c0d771` | mesh hiển thị (STL nhị phân), 11270 tam giác |
| `meshes/xarm6_1305/visual/link6.stl` | `7604bde7881dc09ce16db57007bfc03e3885abe9d12da18e63b91cb1569d6d4f` | mesh hiển thị (STL nhị phân), 4046 tam giác |
| `meshes/gripper/xarm/base_link_g2.dae` | `d46f7e336755a7fd58ebee4b3eab2c6eca7eec611358fc6bf5f683e63efd7575` | mesh hiển thị G2 (COLLADA do Blender 4.0 xuất, 2026-02-26), 50415 tam giác |
| `meshes/gripper/xarm/left_finger_g2.dae` | `69c888529def394ddf00edfb11db061d300c586e6df681a33c894af5be14a59b` | mesh hiển thị G2 (COLLADA do Blender 4.0 xuất, 2026-02-26), 4852 tam giác |
| `meshes/gripper/xarm/left_inner_knuckle_g2.dae` | `f12e642f44ce4a5b0c9bb2ed5c2cf4f9ea0a22b5e87839c29490e8eee6171b86` | mesh hiển thị G2 (COLLADA do Blender 4.0 xuất, 2026-02-26), 7324 tam giác |
| `meshes/gripper/xarm/left_outer_knuckle_g2.dae` | `b791ec24aae545a5dd70aefd12ddac6bdbecf74388ca2f655b34b140ae7da80b` | mesh hiển thị G2 (COLLADA do Blender 4.0 xuất, 2026-02-26), 444 tam giác |
| `meshes/gripper/xarm/right_finger_g2.dae` | `c2914ea791f520253e5536b0078f4e7e3b7b16112eb3dab21db2f5029c150b36` | mesh hiển thị G2 (COLLADA do Blender 4.0 xuất, 2026-02-26), 4852 tam giác |
| `meshes/gripper/xarm/right_inner_knuckle_g2.dae` | `9e73e1fb4e65bc79dbaf2d8fe86fa835c67faa1e5ab08a8a55bec3b9023a1aa3` | mesh hiển thị G2 (COLLADA do Blender 4.0 xuất, 2026-02-26), 7324 tam giác |
| `meshes/gripper/xarm/right_outer_knuckle_g2.dae` | `d9ed7ed551136ecd57fe733c5e9c7e7fa70e10345e26441452122b6bba061f55` | mesh hiển thị G2 (COLLADA do Blender 4.0 xuất, 2026-02-26), 444 tam giác |

- **Đối chiếu:** `ufactory_genesis/assets/urdf/xarm6/xarm6_1305.urdf` (URDF đã khai triển, sha256 `73e03c904b18c70e489205c4d8c57242a6577d53b7b0ecb1f9384b487e2cb5ad`) khớp **37/37** giá trị đã chép (gốc khớp, rpy, effort, velocity, khối lượng, trọng tâm, quán tính, base) với sai lệch ≤ 1e-9 (`crosscheck.py`); giới hạn ±2π của nó ghi `±6.2832`.
- **STL G2 sau chuyển** (không phải file của hãng; M02 sinh lại từ các DAE đã hash ở trên bằng `python3 -I -B meshinfo.py dae2stl <file>_g2.dae <file>_g2.stl` (script nhúng ở cuối ghi chép, không tham số khác) rồi so với sha256 dưới. Chuyển lần hai vào thư mục mới cho đúng các byte này (`shasum -a 256 -c`: 7/7 OK)):
  - `base_link_g2.stl` 50415 tam giác: `2aa35bd24370722bf2c0bc1b383cc5d97a818e769e61cc687fd752529a898e65`
  - `left_finger_g2.stl` 4852 tam giác: `1ca636e4e35dfade0ed3ec074add5e53b0937aac4149969d464726e3a00b1060`
  - `left_inner_knuckle_g2.stl` 7324 tam giác: `c13cdebffd518e2519f0b44561394a549164e5ae5fca1a4b8552b8aeb944f2a5`
  - `left_outer_knuckle_g2.stl` 444 tam giác: `0e432c39574957b02b753ba5415fe6f9b5298c095fc8b321f33457212954ded7`
  - `right_finger_g2.stl` 4852 tam giác: `9a76cf4400c6df370d68434ac08eccf6ea93a1443f46f6eb9c130b0a59e6b6e9`
  - `right_inner_knuckle_g2.stl` 7324 tam giác: `f50fd91ce7076e57aabbfd1160d6138d83df12f31e5ff12497029354d335a344`
  - `right_outer_knuckle_g2.stl` 444 tam giác: `fef06b38e7abdce85d16638784ac0077cd094962a38176092cfb3f09b0518d97`
- **Không dùng** mesh va chạm của hãng (`collision/*.obj` của xarm_ros2; 22 bao lồi của genesis là sản phẩm của repo đó): va chạm tay máy là capsule giả định, va chạm tay kẹp là má kẹp hộp và lòng bàn tay hộp giả định.
- Trang D-H của hãng ([xArm 6](https://docs.supportarticle.ufactory.cc/support_articles/developer/kinematic-and-dynamic-parameters/xArm_Series/xarm-6.html), đọc 2026-11-12): bảng modified D-H (mm, rad) `J1 (a 0, α 0, d 267, θ₀ 0)`, `J2 (0, −π/2, 0, T2)`, `J3 (a2, 0, 0, −T2)`, `J4 (77.5, −π/2, 342.5, 0)`, `J5 (0, π/2, 0, 0)`, `J6 (76, −π/2, 97, 0)`, `a2 = √(284.5²+53.5²)`, `T2 = −atan(284.5/53.5) = −1.3849179`. Trang in `a2 = 289.48866`; tính lại công thức được 289.48661 (tôi đọc trang qua công cụ tóm tắt nên chưa chắc chữ số in trên trang; script dùng công thức). Trang không ghi bảng áp cho phiên bản phần cứng nào; bảng khối lượng "Model 3" trên trang trùng (làm tròn) với `xarm6_type6_HT_BR2.yaml`.

**Tay kẹp (D38): chọn `g2`.** Mọi file G2 dùng tới đều ở `xarm_ros2@ac736c9` (BSD-3), có commit và sha256. Hai điều M01 phải biết:
1. G2 trong xarm_ros2 **chỉ có DAE**, không có STL; xacro G2 dùng lại nguyên khớp và quán tính của G1. Spike chuyển DAE → STL nhị phân bằng `meshinfo.py dae2stl` (hình học thứ nhất × chuỗi ma trận node, đơn vị m). Sáu mesh khâu/ngón sau chuyển trùng số tam giác và bao (±0.1 mm) với STL G1; `base_link_g2` có 50415 tam giác, trong đó **300 tam giác lạc** ở (−0.250, 0.473, 0.100) m, xa thân kẹp; M01 cần lọc chúng.
2. Bản G2 của ufactory_genesis (khớp `0.0606`/`0.075602`, TCP 0.1735, dựng lại từ file STEP "Gripper G2 AG1200 20250710") **không dùng**: license của STEP không ghi, NOTICE không kèm license thượng nguồn, và các STL đó khác xarm_ros2 (`base_link`, `left_finger`, `right_finger` khác sha256).

## Thiết lập

- MJCF viết tay (`scene.py`): `link_base` cố định tại gốc, 6 body lồng nhau theo gốc khớp của hãng (`quat = Rx(roll)`), `joint` trục z, `range` từ xacro, `armature`/`damping`/`frictionloss`; `inertial fullinertia` chép thẳng. Site `flange` ở gốc `link6`; tay kẹp là con của `link6`, site `tcp` ở z = 0.172.
- Tay kẹp theo đúng cấu trúc URDF: 6 khớp bản lề (`drive`, 2 ngón, 2 khâu trong, khâu ngoài phải), một actuator `position` trên `left_outer_knuckle_joint`, 5 ràng buộc `equality joint` thay cho `mimic` (hệ số 1). Má kẹp: hộp nửa kích thước (0.012, 0.002, 0.020) m, tâm (0, ∓0.024, 0.040) trong khung ngón, mặt ở |y| = 0.026 (mặt trong của `left_finger.stl` đo bằng `meshinfo.py`: y = −0.026 trên đoạn z 0.020–0.060). Độ mở tối đa (q = 0) giữa hai mặt má: 88.9 mm, cốc 80 mm.
- Tay máy: 6 actuator `position` (`kp`, `kv`, `forcerange` = lực khớp của hãng, `ctrlrange` = giới hạn khớp). Va chạm: capsule mỗi link (`contype 2, conaffinity 0`: chạm cảnh và cốc, không tự chạm), lòng bàn tay hộp (0.0375, 0.051, 0.056) quanh z 0.047.
- Cảnh: sàn phẳng z = 0 (đế tay máy đặt trên sàn), **bệ vòi** hộp 0.10 × 0.10 × 0.10 m tâm (0.49, 0) (mặt trên z 0.10), **khay** hộp 0.20 × 0.20 × 0.06 m tâm (0.35, 0.35) (mặt trên z 0.06). Cốc: `freejoint`, trụ r 0.04, h 0.10, 0.32 kg (0.02 + 0.30 giả định, phân bố đều: giả định), `condim 4`.
- Vật lý: `timestep 0.002`, `integrator implicitfast`, `cone elliptic`, `impratio 10`. Tick = đặt `ctrl` một lần, `mj_step(model, data, nstep=10)`.
- Quỹ đạo: IK số (DLS trên `mj_jacSite`, bước ≤ 0.2 rad, đa khởi đầu với `random.Random(0)`) cho 7 pose TCP; giữa hai waypoint dùng `quintic-sync-v1` (công thức trong brief, `vᵢ = 3.14`, `aᵢ = maxAccelerationRadS2`, `f = speedFraction`, làm tròn lên tick 20 ms). Chương trình: `home → pregrasp → grasp →` đóng kẹp (lệnh tăng 0.04 rad/tick tới 0.85, chờ 25 tick) `→ lift → preplace → place →` mở kẹp (giảm 0.04 rad/tick tới 0, chờ 100 tick) `→ retreat → home`, dừng 40 tick ở mỗi waypoint. 882 tick mỗi lần.
- Cốc lệch: `random.Random(seed)`, `dx, dy ~ U(−5, 5) mm` quanh tâm bệ, seed 1–10. Tay máy luôn đi tới pose danh định (không cảm biến vị trí cốc).
- `heldPropIds` = {cốc} khi trong `data.contact` có cặp (cốc, má trái) và (cốc, má phải).

Bố cục trạm trong khung base (m; khung TCP: z = hướng tiếp cận ngang, y = hướng đóng kẹp, x = xuống):

| Pose | TCP | z TCP | q (rad, từ IK, 3.17.0) |
|---|---|---|---|
| `home` | (0.38, 0, 0.40) | (1, 0, 0) | [0.000003, −1.147796, −0.32446, −3.141599, 0.09854, 0.00001] |
| `pregrasp` | (0.392, 0, 0.150) | (1, 0, 0) | [0.00001, −0.17134, 0.048777, −3.14158, 1.448234, 0.000009] |
| `grasp` (gắp ngang, TCP ở nửa chiều cao cốc) | (0.512, 0, 0.150) | (1, 0, 0) | [0.000005, 0.130551, −0.358581, −3.141585, 1.342766, 0.000009] |
| `lift` (+0.15) | (0.512, 0, 0.300) | (1, 0, 0) | [0.000002, −0.40233, −0.428403, −3.141592, 0.740063, 0.000008] |
| `preplace` | (0.365556, 0.365556, 0.262) | (0.7071, 0.7071, 0) | [0.785401, −0.282789, −0.398875, −3.14159, 0.889132, 0.000008] |
| `place` (đáy cốc cao hơn khay 2 mm) | (0.365556, 0.365556, 0.112) | (0.7071, 0.7071, 0) | [0.785404, 0.31095, −0.407014, −3.141584, 1.474732, 0.00001] |
| `retreat` | (0.280703, 0.280703, 0.112) | (0.7071, 0.7071, 0) | [0.785411, 0.171944, −0.025197, −3.141575, 1.717544, 0.000014] |

Tiếp cận theo hướng bán kính từ đế; TCP vượt trục cốc 0.022 m (`graspDepthM`) để tâm má (z ≈ 0.150 trong khung kẹp) nằm trên trục cốc và mặt cốc cách lòng bàn tay 7 mm (danh định; 2 mm khi dx = −5 mm). Tâm cốc khi gắp (0.49, 0, 0.15), khi đặt (0.35, 0.35, 0.11), cách trục J1 ≤ 0.512 m.

## Số đo theo tiêu chí

| # | Tiêu chí | Ngưỡng | Đo được (3.17.0) | Cách đo | |
|---|---|---|---|---|---|
| 1 | URDF, mesh, quán tính ở commit cố định, license, D38 | mọi file có license | 6 file mô tả + 7 STL + 7 DAE, đều `xarm_ros2@ac736c9` BSD-3; 37/37 giá trị khớp URDF khai triển của genesis; tay kẹp `g2` | bảng "Nguồn hãng" | ĐẠT |
| 2 | Biên dịch; giữ `home` 10 s | ≤ 0,005 rad, không NaN, không cảnh báo | lệch lớn nhất **0.003187 rad** (J3; J5 0.000866, các khớp khác ≤ 0.00022), không NaN, `data.warning` toàn 0, `time` 10.000 s | `run.py hold`: 500 tick, `ctrl = qpos = home` từ tick 0, lấy max \|q − home\| mọi tick | ĐẠT |
| 3 | `quintic-sync-v1` trọn chuỗi; bám đỉnh; dừng ở waypoint | ≤ 0,05 rad; ≤ 25 tick với ≤ 0,01 rad | bám đỉnh **0.0203 rad**; lệch lúc lệnh tới waypoint ≤ **0.0034 rad**, nên dừng trong **1 tick** ở cả 7 waypoint, 10/10 lần | `run.py trials`: max \|cmd − q\| mọi tick; dừng = tick đầu tiên sau lệnh cuối mà từ đó tới hết 40 tick dừng max \|q − q_wp\| ≤ 0.01 | ĐẠT |
| 4 | Gắp ngang 0,32 kg, nhấc 150 mm, mang trọn quỹ đạo; trượt; 10/10 với lệch ±5 mm; thả | trượt ≤ 5 mm; nằm yên ≤ 50 tick, lệch ≤ 10 mm | **10/10**: giữ bởi cả hai má ở mọi tick mang (0 tick mất); cốc nhấc **151.4 mm**; trượt max **3.42 mm**; nằm yên sau **19–20 tick**; lệch khay max **8.29 mm**; nghiêng ≤ 0.005°; tay máy không chạm gì | trượt = max ‖p_cốc trong khung TCP − giá trị lúc hết chờ đóng kẹp‖ từ đó tới hết dừng ở `place`; nằm yên = tick (tính từ lệnh mở) mà từ đó tới hết 100 tick cốc chạm khay, không chạm má, \|v\| < 5 mm/s, \|ω\| < 0.05 rad/s; lệch = khoảng cách xy tới tâm khay cuối cửa sổ mở | ĐẠT |
| 5 | Âm tính: má kẹp μ = 0,1 | cốc rơi, `heldPropIds` rỗng ≤ 25 tick | rỗng sau **6 tick**; cốc rơi 0.151 m xuống bệ (ở tick 25 đã rơi 0.151 m) | `run.py negative`: gắp, nhấc, chờ 40 tick ở `lift`, rồi đặt `geom_friction[pad][0] = 0.1` và đếm tick | ĐẠT |
| 6 | Hai lần cùng seed | ≤ 1e-9 rad | **0.0** rad (khớp) và 0.0 m (cốc), 882 tick; cả trong một process và giữa hai process | `run.py repeat` seed 3, chạy hai lần, so `.npy` | ĐẠT |
| 7 | p95 thời gian tick | ≤ 5 ms | p50 **0.123 ms**, p95 **0.252 ms**, max 0.471 ms (8820 tick) | `perf_counter` quanh `mj_step(nstep=10)`, 10 lần chạy tiêu chí 4 | ĐẠT |
| 8 | Flange: D-H (TS) so với engine, 20 pose | ≤ 1 mm | max **2.18 µm**, trung vị 1.07 µm | `fk_poses.py` (seed 20261112, q đều trong giới hạn, J1/J4/J6 trong ±π) → `fk_compare.mjs` (`forwardKinematics(toSI(XARM6))`) | ĐẠT |
| 9 | Mesh hiển thị | `STLLoader` đọc mọi file; ≤ 8 MB | **14 file, 117291 tam giác, 5.59 MB** (tay máy 7 STL 41636 tam giác 1.99 MB; G2 7 STL sau chuyển DAE 75655 tam giác 3.61 MB); three 0.180.0 `STLLoader.parse` đọc cả 14 | `stl_load.mjs` | ĐẠT |

Trên `mujoco-core 4.0.1` (cùng MJCF, cùng script): (2) 0.0031873 rad, không NaN, không cảnh báo; (3) bám đỉnh 0.0203 rad, dừng 1 tick; (4) 10/10, 0 tick mất, nhấc 151.4–151.5 mm, trượt max 3.42 mm, nằm yên 19–20 tick, lệch max 8.41 mm; (5) 6 tick; (6) 0.0 giữa hai process. Trace khớp seed 3 lệch so với 3.17.0 tối đa **4.92e-5 rad** (cốc 1.90e-5 m): không bit-exact giữa hai dòng, như tài liệu MuJoCo nói.

Theo từng seed (3.17.0):

| seed | lệch cốc (dx, dy) mm | tick mất giữ | nhấc mm | trượt mm | đóng kẹp ổn định (tick) | nằm yên (tick) | lệch khay mm |
|---|---|---|---|---|---|---|---|
| 1 | −3.656, 3.474 | 0 | 151.4 | 3.31 | 8 | 20 | 0.38 |
| 2 | 4.560, 4.478 | 0 | 151.4 | 3.42 | 8 | 19 | 8.29 |
| 3 | −2.620, 0.442 | 0 | 151.4 | 3.31 | 7 | 20 | 0.56 |
| 4 | −2.640, −3.968 | 0 | 151.4 | 3.32 | 8 | 20 | 0.87 |
| 5 | 1.229, 2.418 | 0 | 151.4 | 3.37 | 8 | 20 | 4.21 |
| 6 | 2.933, 3.220 | 0 | 151.4 | 3.39 | 8 | 19 | 6.22 |
| 7 | −1.762, −3.492 | 0 | 151.4 | 3.33 | 8 | 20 | 1.53 |
| 8 | −2.733, 4.623 | 0 | 151.4 | 3.33 | 8 | 20 | 1.49 |
| 9 | −0.370, −1.267 | 0 | 151.4 | 3.34 | 8 | 20 | 2.00 |
| 10 | 0.714, −0.711 | 0 | 151.4 | 3.35 | 8 | 20 | 2.81 |

Ghi chú:
- **Trượt 3.3–3.4 mm gần như không đổi theo seed**: phần lớn là lún của tiếp xúc mềm (`solref 0.01`, `solimp` rộng 5 mm) khi trọng lượng cốc chuyển từ bệ sang má, không phải trượt dần. Lực ép mỗi má lúc giữ ở `lift`: **13.15 N** (`squeeze.py`; actuator kẹp bão hòa 1.2 N·m).
- **Lệch khay** tăng theo `dx > 0`: lệch dọc hướng tiếp cận không được kẹp sửa và mang sang khay (seed 2: 8.29 mm, biên 1.7 mm so với ngưỡng). Lệch ngang (dy) bị kẹp tự căn giữa khi đóng; khe hở mỗi bên lúc mở là 4.45 mm, nên với \|dy\| > 4.45 mm đầu ngón đẩy nhẹ cốc lúc tiến vào.
- **Biên của tiêu chí 5:** cùng phép thử với μ = 0.2: cốc **không** rơi (tụt 0.36 mm trong 100 tick). Ngưỡng nằm giữa 0.1 và 0.2 với lực ép 13 N (2 × 0.1 × 13.15 = 2.6 N < 3.14 N trọng lượng; 2 × 0.2 × 13.15 = 5.3 N > 3.14 N). Hạ/tăng lực ép làm dịch ngưỡng này; tiêu chí 4 và 5 kéo lực ép về hai phía.
- **Ma sát cốc:** `propFriction` 0.6 đặt trên cốc, nhưng MuJoCo lấy max của hai geom cùng `priority`: cốc–bệ/khay/sàn thực tế là **1.0** (mặc định của bệ/khay/sàn). Cốc–má dùng ma sát má (`priority 1`). M0x nên đặt ma sát bệ/khay tường minh.
- Tick đo không gồm biên dịch model và IK. Cảnh nhỏ (một tay máy, 13 geom); không suy ra cho cảnh lớn hơn.
- Tiêu chí 8: sai số 2 µm đến từ `rpy ±1.5708` trong file của hãng (không phải π/2 đúng). Bảng D-H TS ghi `units {length:'mm', alpha:'rad', joint:'rad'}`, `thetaOffset` J2 = T2, J3 = −T2, `toolTranslation [0,0,0]`.
- Không kiểm: tay máy bị chặn (lỗi bám), quán tính riêng của đồ uống lỏng, va chạm tay kẹp ngoài má và lòng bàn tay (khâu và ngón không có hình va chạm).

## Thử chỉnh tham số (tiêu chí 2 và 4)

| Lần | Thay đổi | Kết quả |
|---|---|---|
| 1 | `kp` [2000, 2000, 1500, 800, 500, 300] | giữ `home`: J3 võng 0.0102 rad (> 0.005); `qfrc_bias` J3 tại `home` −15.3 N·m |
| 2 | `kp` [6000, 6000, 5000, 2000, 2000, 500], `kv` [150, 150, 100, 40, 30, 14] | giữ 0.0032 rad; giữ nguyên |
| 3 | kẹp `forcerange` 2 N·m, `solref 0.004 1`, `solimp 0.95 0.99 0.001` | trong lúc J1 quay sang `preplace`, má trái mất tiếp xúc 8–20 tick mỗi lần (cốc dịch 0.08 mm sang má phải, vượt độ lún mồi 0.03 mm); μ = 0.1 không làm rơi (ép ~22 N/má) |
| 4 | `solref` của ràng buộc khớp 0.02 → 0.004; cản khớp kẹp 0.02/0.1/0.5; `impratio` 1/3; `condim` 3/6; `multiccd`; `noslip_iterations 5`; `armature` kẹp 0.02 | không hết mất tiếp xúc |
| 5 | `speedFraction` 0.2 | còn 2–3 tick mất |
| 6 | `forcerange` 5 N·m | hết mất tiếp xúc nhưng tiêu chí 5 hỏng (μ = 0.1 không rơi) |
| 7 | `forcerange` 1.2, `solref 0.01 1`, `solimp 0.9 0.95 0.005` | 0 tick mất, tiêu chí 5 đạt (6 tick); nhưng với bệ (0.45, −0.20) tiếp cận theo bán kính, seed 2 lệch khay 10.3 mm (đầu ngón đẩy cốc 8.1 mm khi tiến vào, lệch ngang 5.95 mm > khe 4.45 mm) |
| 8 | tiếp cận cố định theo +x với bệ (0.45, −0.20) | IK ra cấu hình cổ tay khác, quỹ đạo khớp vung rộng: trượt 7–8 mm, lệch khay 17 mm: bỏ |
| 9 | bệ (0.49, 0) trên trục x, khay (0.35, 0.35), tiếp cận theo bán kính | **ĐẠT 10/10** (bảng trên) |
| 10 | Độ bền trên arm64: seed 11–20; `forcerange` 1.1/1.3; `solref` 0.009/0.011; ma sát má 0.8 | 60/60 lần giữ trọn, trượt ≤ 3.71 mm, nằm yên ≤ 21 tick, lệch khay ≤ 9.02 mm |

## linux/amd64 và linux/arm64 (tiêu chí 7, phần ghi thêm)

Docker (OrbStack) với `python:3.11-slim`, `pip install` trong container, mount script chỉ đọc, chạy 10 seed của tiêu chí 4:

| Nền | Gói | p50 / p95 / max tick | Kết quả gắp |
|---|---|---|---|
| linux/arm64 (gốc) | `mujoco==3.17.0` | 0.125 / **0.266** / 0.489 ms | 10/10, trượt ≤ 3.42 mm, lệch khay ≤ 8.40 mm |
| linux/arm64 (gốc) | `mujoco-core==4.0.1` | 0.126 / **0.269** / 6.57 ms | 10/10, như trên |
| linux/amd64 (giả lập Rosetta, CPU "VirtualApple", không có cờ avx2) | `mujoco==3.17.0` | 0.636 / 2.07 / 16.4 ms | **0/10**: cảnh báo `Linesearch objective is not convex`, rồi `Nan, Inf or huge value in QACC` từ lúc đóng kẹp hoặc nhấc; MuJoCo tự reset trạng thái |
| linux/amd64 (giả lập) | `mujoco-core==4.0.1` | 0.220 / 0.453 / 12.4 ms | **0/10**: không NaN, nhưng má mất tiếp xúc khi J1 quay (như lần 3 ở bảng trên); 9 seed trượt 22 mm–2.5 m, seed 2 giữ gần trọn (1 tick mất, trượt 3.42 mm) nhưng sau khi thả cốc không nằm yên trong 100 tick và lệch khay 25.4 mm |

Điều đã kiểm: cùng một trạng thái lưu từ tick 350 (đang giữ cốc), `mj_forward` + một tick trên arm64 và amd64 (4.0.1) cho cùng 4 tiếp xúc, độ lún trùng ở mọi chữ số in ra (10 chữ số), tổng trị tuyệt đối lực ràng buộc lệch 1e-8 N (`probe3.py`). Tick đầu của chuỗi cũng trùng tới ~1e-9. Hai trace tách nhau từ tick 0 ở mức 5e-7 m (cốc nằm trên bệ) và khác hẳn từ lúc đóng kẹp (tick 209: 8 tiếp xúc trên amd64, 4 trên arm64). Các thay đổi ở lần 4 và má gân (2 hoặc 3 thanh hộp mảnh), `solimp` rộng 0.01/0.02, `solref` 0.015/0.02 không làm amd64 giả lập đạt. **Chưa xác định** lỗi do giả lập hay do bản x86 của MuJoCo; chưa có máy amd64 thật để chạy. Số thời gian amd64 ở trên không phải tiêu chí (chạy qua giả lập).

## Tham số chọn (đầu vào của M01–M07)

| Tham số | Giá trị | Nguồn / căn cứ |
|---|---|---|
| bản MuJoCo, gói pip | `mujoco==3.17.0` (import `mujoco`); MJCF cũng biên dịch trên `mujoco-core==4.0.1` | D35, mục Phiên bản |
| commit hãng | `xarm_ros2` `ac736c92b02de7ca7e0be6f737d77d46707464d8`; đối chiếu `ufactory_genesis` `82e094e4e57deec51d76a9c86d7830905f2b3ecc`; `ufactory_robot_viewer` `beeadf45f7e96afc5281cb2ea7ff2a63a816a5d7` (không dùng) | tiêu chí 1 |
| tay kẹp | `g2` (mesh DAE của xarm_ros2, chuyển STL; khớp/quán tính của macro chung G1/G2) | D38 |
| bệ vòi | tâm (0.49, 0), hộp 0.10 × 0.10 × 0.10, mặt trên z 0.10 | assumed |
| khay | tâm (0.35, 0.35), hộp 0.20 × 0.20 × 0.06, mặt trên z 0.06 | assumed |
| pose TCP gắp / đặt | gắp (0.512, 0, 0.150), z TCP (1, 0, 0), x (0, 0, −1); đặt (0.365556, 0.365556, 0.112), z TCP (0.7071, 0.7071, 0), x (0, 0, −1); `graspDepthM` 0.022, `approachM` 0.12, `liftM` 0.15, `placeClearM` 0.002; `home` TCP (0.38, 0, 0.40) z (1, 0, 0) | assumed, bảng bố cục |
| `drinkMassKg` | 0.30 (cốc 0.32 kg) | brief |
| `kp[6]` | [6000, 6000, 5000, 2000, 2000, 500] N·m/rad | assumed; tiêu chí 2 |
| `kv[6]` | [150, 150, 100, 40, 30, 14] N·m·s/rad | assumed (≈ cản tới hạn với `armature`) |
| `armature[6]` | 0.1 kg·m² mỗi khớp | assumed (quán tính rotor qua hộp số) |
| cản / ma sát khớp | `damping 1.0`, `frictionloss 1.0` | xacro `<dynamics>` của hãng (giá trị Gazebo) |
| `forcerange` khớp | ±[179.4445, 179.4445, 92, 81.558, 30.6, 30.6] N·m | hãng, `joint_limits_1305.yaml` |
| kẹp | `position` trên `left_outer_knuckle_joint`: `kp 20`, `kv 0.5`, `forcerange ±1.2 N·m` (≈ 13.15 N mỗi má), `armature 0.002`; lệnh 0 (mở) / 0.85 (đóng), tốc độ lệnh 0.04 rad/tick; ràng buộc mimic `solref 0.004 1` | assumed |
| má kẹp | hộp nửa (0.012, 0.002, 0.020) m, tâm (0, ∓0.024, 0.040) trong khung ngón, `condim 4`, `priority 1` | assumed (D38: hộp) |
| `padFriction` | (1.0, 0.02, 0.0001) | assumed |
| `propFriction` | (0.6, 0.005, 0.0001) trên cốc; thực tế cốc–bệ/khay 1.0 (xem ghi chú) | assumed |
| `solref` | (0.01, 1) mọi geom | assumed |
| `solimp` | (0.9, 0.95, 0.005, 0.5, 2) mọi geom | assumed |
| `impratio` | 10 | assumed |
| `speedFraction` | 0.5 | assumed |
| `maxAccelerationRadS2[6]` | [6, 6, 6, 8, 8, 8] | assumed |
| `reachTolRad` | 0.01 | tiêu chí 3; lệch lúc tới ≤ 0.0034 |
| `settleTicks` | 10 | đo 1 tick; giữ như R1.1 |
| `followTolRad` | 0.05 | tiêu chí 3; bám bình thường 0.0203. Chưa đo trường hợp tay bị chặn |
| `followTicks` | 10 | như R1.1 (không đo lại) |
| `repeatJointRad` | 1e-9 | tiêu chí 6; đo 0.0 cùng bản, cùng máy. Giữa 3.17.0 và 4.0.1: 4.9e-5 |
| `gripSettleTicks` | 25 | đo 7–8 tick từ lệnh đóng tới khi cả hai má chạm và cốc < 1 mm/s |
| `dropTicks` | 50 | tiêu chí 4; đo 19–20 |
| `liftMinM` | 0.14 | đo 0.1514 với lệnh nhấc 0.15 |
| `slipTolM` | 0.005 | tiêu chí 4; đo ≤ 0.00342 |
| `fkTolM` | 1e-5 | tiêu chí 8; đo ≤ 2.18e-6 |
| `capsuleRadiusM[6]` | [0.049, 0.0485, 0.045, 0.045, 0.039, 0.039]; đoạn (khung link) l1 (0,0,−0.07)–(0,0,0), l2 (0,0,0)–(0.0535,−0.2845,0), l3 (0,0,0)–(0.0775,0.12,0), l4 (0,0,−0.16)–(0,0,0), l5 (0,0,0)–(0.076,0.06,0), l6 (0,0,−0.02)–(0,0,0) | assumed, từ nửa bề rộng bao của STL hiển thị |

Các số này là **ngưỡng và tham số kiểm thử ban đầu**, không phải năng lực đo của tay máy hay tay kẹp thật.

Lệnh: `venv-3/bin/python -I -B run.py hold|trials|negative|repeat '{}'` (cùng lệnh với `venv-4`); container: `docker run --platform linux/<arch> -v work:/work:ro python:3.11-slim sh -c "pip install <gói>; python -I -B /work/run.py trials '{}'"`.

## MJCF (`scene.build()` với tham số chọn, định dạng lại; biên dịch được trên 3.17.0 và 4.0.1)

```xml
<mujoco model="m00-xarm6-g2">
 <compiler angle="radian" autolimits="true"/>
 <option timestep="0.002" integrator="implicitfast" cone="elliptic" impratio="10"/>
 <default>
  <geom solref="0.01 1" solimp="0.9 0.95 0.005 0.5 2"/>
  <default class="arm">
   <geom contype="2" conaffinity="0" condim="3" group="3"/>
  </default>
  <default class="pad">
   <geom contype="1" conaffinity="1" condim="4" priority="1" friction="1 0.02 0.0001" group="3"/>
  </default>
  <default class="world">
   <geom contype="1" conaffinity="3" condim="3"/>
  </default>
 </default>
 <worldbody>
  <geom name="floor" class="world" type="plane" size="1 1 0.01"/>
  <geom name="stand" class="world" type="box" size="0.05 0.05 0.05" pos="0.49 0 0.05"/>
  <geom name="tray" class="world" type="box" size="0.1 0.1 0.03" pos="0.35 0.35 0.03"/>
  <body name="link_base">
   <inertial pos="0 0 0.09103" mass="2.7" fullinertia="0.00494875 0.00494174 0.002219 -3.5e-06 1.25e-05 1.67e-06"/>
   <body name="link1" pos="0 0 0.267" quat="1 0 0 0">
    <inertial pos="0.00022 0.02951 -0.0124" mass="2.3814" fullinertia="0.0058562 0.0050316 0.003536652 -1.79e-05 3.55e-06 -0.000888336"/>
    <joint name="joint1" axis="0 0 1" range="-6.28318530718 6.28318530718" armature="0.1" damping="1" frictionloss="1"/>
    <geom name="cap1" class="arm" type="capsule" fromto="0 0 -0.07 0 0 0" size="0.049"/>
    <body name="link2" pos="0 0 0" quat="0.707105482511 -0.707108079859 0 0">
     <inertial pos="0.03881 -0.22783 0.03496" mass="2.2675" fullinertia="0.028315776 0.0058 0.0273447 0.005 0.00066546 -0.0045741"/>
     <joint name="joint2" axis="0 0 1" range="-2.059 2.0944" armature="0.1" damping="1" frictionloss="1"/>
     <geom name="cap2" class="arm" type="capsule" fromto="0 0 0 0.0535 -0.2845 0" size="0.0485"/>
     <body name="link3" pos="0.0535 -0.2845 0" quat="1 0 0 0">
      <inertial pos="0.07041 0.11631 0.0107" mass="1.875" fullinertia="0.0063483 0.00379758 0.00595768 -0.0015397 0.00096858 0.00186567"/>
      <joint name="joint3" axis="0 0 1" range="-3.927 0.19198" armature="0.1" damping="1" frictionloss="1"/>
      <geom name="cap3" class="arm" type="capsule" fromto="0 0 0 0.0775 0.12 0" size="0.045"/>
      <body name="link4" pos="0.0775 0.3425 0" quat="0.707105482511 -0.707108079859 0 0">
       <inertial pos="-0.00018 0.01798 -0.02291" mass="1.3192" fullinertia="0.004896 0.00445694 0.00134332 -6.925e-06 -1.418e-05 -0.00023186"/>
       <joint name="joint4" axis="0 0 1" range="-6.28318530718 6.28318530718" armature="0.1" damping="1" frictionloss="1"/>
       <geom name="cap4" class="arm" type="capsule" fromto="0 0 -0.16 0 0 0" size="0.045"/>
       <body name="link5" pos="0 0 0" quat="0.707105482511 0.707108079859 0 0">
        <inertial pos="0.0651 0.03096 0.00315" mass="1.33854" fullinertia="0.00146378 0.00184192 0.002333524 -0.000450624 0.000284306 0.000130866"/>
        <joint name="joint5" axis="0 0 1" range="-1.69297 3.14159265359" armature="0.1" damping="1" frictionloss="1"/>
        <geom name="cap5" class="arm" type="capsule" fromto="0 0 0 0.076 0.06 0" size="0.039"/>
        <body name="link6" pos="0.076 0.097 0" quat="0.707105482511 -0.707108079859 0 0">
         <inertial pos="0 -0.00677 -0.01098" mass="0.17" fullinertia="9.3e-05 5.87e-05 0.000132 -0 -0 -3.6e-06"/>
         <joint name="joint6" axis="0 0 1" range="-6.28318530718 6.28318530718" armature="0.1" damping="1" frictionloss="1"/>
         <site name="flange" size="0.005"/>
         <geom name="cap6" class="arm" type="capsule" fromto="0 0 -0.02 0 0 0" size="0.039"/>
         <body name="gbase">
          <inertial pos="-0.00065489 -0.0018497 0.048028" mass="0.54156" fullinertia="0.00047106 0.00033072 0.00025642 3.9292e-07 2.6537e-06 -1.0975e-05"/>
          <geom name="palm" class="arm" type="box" size="0.0375 0.051 0.056" pos="0 0 0.047"/>
          <site name="tcp" pos="0 0 0.172" size="0.005"/>
          <body name="left_outer_knuckle" pos="0 0.035 0.059098">
           <inertial pos="2.9948e-14 0.021559 0.015181" mass="0.033618" fullinertia="1.9111e-05 6.6256e-06 1.3185e-05 -1.8803e-17 -1.1002e-17 -7.3008e-06"/>
           <joint name="left_outer_knuckle_joint" axis="1 0 0" range="0 0.85" armature="0.002" damping="0"/>
           <body name="left_finger" pos="0 0.035465 0.042039">
            <inertial pos="-2.4536e-14 -0.016413 0.029258" mass="0.048304" fullinertia="1.7493e-05 1.7225e-05 5.1466e-06 -4.2156e-19 6.9164e-18 4.6433e-06"/>
            <joint name="left_finger_joint" axis="-1 0 0" range="0 0.85" armature="0.002" damping="0"/>
            <geom name="pad_left" class="pad" type="box" size="0.012 0.002 0.02" pos="0 -0.024 0.04"/>
           </body>
          </body>
          <body name="left_inner_knuckle" pos="0 0.02 0.074098">
           <inertial pos="1.86600784688e-06 0.0220467847634 0.0261334672831" mass="0.0230125781257" fullinertia="6.09490024272e-06 6.01955084375e-06 5.0786200448e-06 6.0665132616e-11 7.19102670501e-11 -2.75316812992e-06"/>
           <joint name="left_inner_knuckle_joint" axis="1 0 0" range="0 0.85" armature="0.002" damping="0"/>
          </body>
          <body name="right_outer_knuckle" pos="0 -0.035 0.059098">
           <inertial pos="-3.1669e-14 -0.021559 0.015181" mass="0.033618" fullinertia="1.9111e-05 6.6256e-06 1.3185e-05 -1.8789e-17 1.0986e-17 7.3008e-06"/>
           <joint name="right_outer_knuckle_joint" axis="-1 0 0" range="0 0.85" armature="0.002" damping="0"/>
           <body name="right_finger" pos="0 -0.035465 0.042039">
            <inertial pos="2.5618e-14 0.016413 0.029258" mass="0.048304" fullinertia="1.7493e-05 1.7225e-05 5.1466e-06 -5.0014e-19 -7.5079e-18 -4.6435e-06"/>
            <joint name="right_finger_joint" axis="1 0 0" range="0 0.85" armature="0.002" damping="0"/>
            <geom name="pad_right" class="pad" type="box" size="0.012 0.002 0.02" pos="0 0.024 0.04"/>
           </body>
          </body>
          <body name="right_inner_knuckle" pos="0 -0.02 0.074098">
           <inertial pos="1.866e-06 -0.022047 0.026133" mass="0.023013" fullinertia="6.0949e-06 6.0197e-06 5.0784e-06 -6.0665e-11 7.191e-11 2.7531e-06"/>
           <joint name="right_inner_knuckle_joint" axis="-1 0 0" range="0 0.85" armature="0.002" damping="0"/>
          </body>
         </body>
        </body>
       </body>
      </body>
     </body>
    </body>
   </body>
  </body>
  <body name="cup" pos="0.49 0 0.15">
   <freejoint name="cup"/>
   <geom name="cup" class="world" type="cylinder" size="0.04 0.05" mass="0.32" friction="0.6 0.005 0.0001" condim="4"/>
  </body>
 </worldbody>
 <equality>
  <joint joint1="left_finger_joint" joint2="left_outer_knuckle_joint" polycoef="0 1 0 0 0" solref="0.004 1"/>
  <joint joint1="left_inner_knuckle_joint" joint2="left_outer_knuckle_joint" polycoef="0 1 0 0 0" solref="0.004 1"/>
  <joint joint1="right_outer_knuckle_joint" joint2="left_outer_knuckle_joint" polycoef="0 1 0 0 0" solref="0.004 1"/>
  <joint joint1="right_finger_joint" joint2="left_outer_knuckle_joint" polycoef="0 1 0 0 0" solref="0.004 1"/>
  <joint joint1="right_inner_knuckle_joint" joint2="left_outer_knuckle_joint" polycoef="0 1 0 0 0" solref="0.004 1"/>
 </equality>
 <actuator>
  <position name="a1" joint="joint1" kp="6000" kv="150" forcerange="-179.4445 179.4445" ctrlrange="-6.28318530718 6.28318530718"/>
  <position name="a2" joint="joint2" kp="6000" kv="150" forcerange="-179.4445 179.4445" ctrlrange="-2.059 2.0944"/>
  <position name="a3" joint="joint3" kp="5000" kv="100" forcerange="-92 92" ctrlrange="-3.927 0.19198"/>
  <position name="a4" joint="joint4" kp="2000" kv="40" forcerange="-81.558 81.558" ctrlrange="-6.28318530718 6.28318530718"/>
  <position name="a5" joint="joint5" kp="2000" kv="30" forcerange="-30.6 30.6" ctrlrange="-1.69297 3.14159265359"/>
  <position name="a6" joint="joint6" kp="500" kv="14" forcerange="-30.6 30.6" ctrlrange="-6.28318530718 6.28318530718"/>
  <position name="grip" joint="left_outer_knuckle_joint" kp="20" kv="0.5" forcerange="-1.2 1.2" ctrlrange="0 0.85"/>
 </actuator>
</mujoco>
```

## Sinh MJCF (`scene.py`)

```python
"""M00 scratch: hand-written MJCF for UFACTORY xArm 6 (1305) + Gripper G2 + cup-ref, values transcribed from xarm_ros2 @ac736c9.
Not committed. build(P) returns the XML text; P holds every ASSUMED parameter (see DEFAULTS)."""
import math

# ---- manufacturer values (xarm_ros2 humble ac736c92, xarm_description) ----
# joint origins: config/kinematics/default/xarm6_default_kinematics.yaml (xyz, roll); axes z; limits: urdf/xarm6/xarm6.urdf.xacro l.4-9,
# velocity 3.14 (xacro l.114 etc.); effort: config/xarm6/joint_limits_1305.yaml; damping 1.0 friction 1.0: xacro <dynamics> (Gazebo values)
J_ORIGIN = [((0, 0, 0.267), 0), ((0, 0, 0), -1.5708), ((0.0535, -0.2845, 0), 0), ((0.0775, 0.3425, 0), -1.5708), ((0, 0, 0), 1.5708), ((0.076, 0.097, 0), -1.5708)]
TWO_PI = 2 * math.pi
J_RANGE = [(-TWO_PI, TWO_PI), (-2.059, 2.0944), (-3.927, 0.19198), (-TWO_PI, TWO_PI), (-1.69297, math.pi), (-TWO_PI, TWO_PI)]
J_VEL = [3.14] * 6
J_EFFORT = [179.4445, 179.4445, 92.0, 81.558, 30.6, 30.6]
# link inertials: config/link_inertial/xarm6_type6_HT_BR2.yaml (xacro default, l.46); base: xarm6.urdf.xacro l.67-73
BASE_INERTIAL = ((0.0, 0.0, 0.09103), 2.7, (0.00494875, 0.00494174, 0.002219, -3.5e-06, 1.25e-05, 1.67e-06))
LINK_INERTIAL = [  # (com, mass, (ixx, iyy, izz, ixy, ixz, iyz))
    ((0.00022, 0.02951, -0.0124), 2.3814, (0.0058562, 0.0050316, 0.003536652, -1.79e-05, 3.55e-06, -0.000888336)),
    ((0.03881, -0.22783, 0.03496), 2.2675, (0.028315776, 0.0058, 0.0273447, 0.005, 0.00066546, -0.0045741)),
    ((0.07041, 0.11631, 0.0107), 1.875, (0.0063483, 0.00379758, 0.00595768, -0.0015397, 0.00096858, 0.00186567)),
    ((-0.00018, 0.01798, -0.02291), 1.3192, (0.004896, 0.00445694, 0.00134332, -6.925e-06, -1.418e-05, -0.00023186)),
    ((0.0651, 0.03096, 0.00315), 1.33854, (0.00146378, 0.00184192, 0.002333524, -0.000450624, 0.000284306, 0.000130866)),
    ((0, -0.00677, -0.01098), 0.17, (9.3e-05, 5.87e-05, 0.000132, -0.0, -0.0, -3.6e-06)),
]
# gripper: urdf/gripper/xarm_gripper.urdf.xacro (G2 only swaps mesh files, l.9-13); attached at link6 origin (xarm_device_macro.xacro l.240-243)
G_BASE = ((-0.00065489, -0.0018497, 0.048028), 0.54156, (0.00047106, 0.00033072, 0.00025642, 3.9292e-07, 2.6537e-06, -1.0975e-05))
G_TCP = 0.172  # joint_tcp l.227-228
G_RANGE, G_EFFORT_URDF, G_VEL = (0, 0.85), 50, 2
# (name, parent, pos, axis, inertial)  -- l.45-223
G_LINKS = [
    ('left_outer_knuckle', 'gbase', (0, 0.035, 0.059098), (1, 0, 0), ((2.9948e-14, 0.021559, 0.015181), 0.033618, (1.9111e-05, 6.6256e-06, 1.3185e-05, -1.8803e-17, -1.1002e-17, -7.3008e-06))),
    ('left_finger', 'left_outer_knuckle', (0, 0.035465, 0.042039), (-1, 0, 0), ((-2.4536e-14, -0.016413, 0.029258), 0.048304, (1.7493e-05, 1.7225e-05, 5.1466e-06, -4.2156e-19, 6.9164e-18, 4.6433e-06))),
    ('left_inner_knuckle', 'gbase', (0, 0.02, 0.074098), (1, 0, 0), ((1.86600784687907e-06, 0.0220467847633621, 0.0261334672830885), 0.0230125781256706, (6.09490024271906e-06, 6.01955084375188e-06, 5.07862004479903e-06, 6.06651326160071e-11, 7.19102670500635e-11, -2.75316812991721e-06))),
    ('right_outer_knuckle', 'gbase', (0, -0.035, 0.059098), (-1, 0, 0), ((-3.1669e-14, -0.021559, 0.015181), 0.033618, (1.9111e-05, 6.6256e-06, 1.3185e-05, -1.8789e-17, 1.0986e-17, 7.3008e-06))),
    ('right_finger', 'right_outer_knuckle', (0, -0.035465, 0.042039), (1, 0, 0), ((2.5618e-14, 0.016413, 0.029258), 0.048304, (1.7493e-05, 1.7225e-05, 5.1466e-06, -5.0014e-19, -7.5079e-18, -4.6435e-06))),
    ('right_inner_knuckle', 'gbase', (0, -0.02, 0.074098), (-1, 0, 0), ((1.866e-06, -0.022047, 0.026133), 0.023013, (6.0949e-06, 6.0197e-06, 5.0784e-06, -6.0665e-11, 7.191e-11, 2.7531e-06))),
]
# cup: robotics/catalog/components/cup-ref.json (r 0.04, h 0.1, 0.02 kg) + 0.30 kg assumed drink
CUP_R, CUP_H = 0.04, 0.1

DEFAULTS = dict(  # every value here is ASSUMED (tuned in the spike)
    kp=[6000, 6000, 5000, 2000, 2000, 500], kv=[150, 150, 100, 40, 30, 14], armature=[0.1] * 6,
    joint_damping=1.0, joint_frictionloss=1.0,               # xacro <dynamics> values, kept
    g_kp=20.0, g_kv=0.5, g_force=1.2, g_armature=0.002, g_damping=0.0,     # gripper drive actuator
    pad_half=(0.012, 0.002, 0.020), pad_center=(0, 0.024, 0.040),  # in finger frame, face at |y|=0.026 (finger STL inner face)
    padFriction=(1.0, 0.02, 0.0001), propFriction=(0.6, 0.005, 0.0001), solref=(0.01, 1), solimp=(0.9, 0.95, 0.005, 0.5, 2), impratio=10,
    pad_condim=4, drinkMassKg=0.30, eq_solref=(0.004, 1),
    # cell (base frame, arm base on floor at origin)
    stand_center=(0.49, 0.0), stand_half=(0.05, 0.05), stand_top=0.10,
    tray_center=(0.35, 0.35), tray_half=(0.10, 0.10), tray_top=0.06,
    capsule_r=[0.049, 0.0485, 0.045, 0.045, 0.039, 0.039],
    cup_xy=None, opt_extra='', flag_xml='', grip_two=False, pad_ribs=0, rib_half=(0.002, 0.002, 0.020),  # cup centre (x, y) on the stand; default = stand centre
)
CAPSULES = [((0, 0, -0.07), (0, 0, 0)), ((0, 0, 0), (0.0535, -0.2845, 0)), ((0, 0, 0), (0.0775, 0.12, 0)), ((0, 0, -0.16), (0, 0, 0)), ((0, 0, 0), (0.076, 0.06, 0)), ((0, 0, -0.02), (0, 0, 0))]
f = lambda *v: ' '.join(f'{x:.12g}' for x in v)

def inertial(i):
    (c, m, I) = i
    return f'<inertial pos="{f(*c)}" mass="{f(m)}" fullinertia="{f(*I)}"/>'

def build(P=None):
    P = {**DEFAULTS, **(P or {})}
    cup_xy = P['cup_xy'] or P['stand_center']
    cupm = 0.02 + P['drinkMassKg']
    arm = ''
    close = ''
    for i in range(6):
        (xyz, roll) = J_ORIGIN[i]
        q = (math.cos(roll / 2), math.sin(roll / 2), 0, 0)
        a, b = CAPSULES[i]
        lo, hi = J_RANGE[i]
        arm += (f'<body name="link{i+1}" pos="{f(*xyz)}" quat="{f(*q)}">{inertial(LINK_INERTIAL[i])}'
                f'<joint name="joint{i+1}" axis="0 0 1" range="{f(lo, hi)}" armature="{f(P["armature"][i])}" damping="{f(P["joint_damping"])}" frictionloss="{f(P["joint_frictionloss"])}"/>'
                f'<geom name="cap{i+1}" class="arm" type="capsule" fromto="{f(*a, *b)}" size="{f(P["capsule_r"][i])}"/>')
        close += '</body>'
    def pad(side):  # one box pad, or pad_ribs thin horizontal box ribs spread over the pad height (each one a near-point contact on the cup)
        sy = (-1 if side == "left" else 1) * P["pad_center"][1]
        if not P['pad_ribs']: return f'<geom name="pad_{side}" class="pad" type="box" size="{f(*P["pad_half"])}" pos="{f(0, sy, P["pad_center"][2])}"/>'
        n = P['pad_ribs']; h = P['pad_half'][0] - P['rib_half'][0]
        xs = [0.0] if n == 1 else [-h + 2 * h * k / (n - 1) for k in range(n)]
        return ''.join(f'<geom name="pad_{side}{"" if k == 0 else k}" class="pad" type="box" size="{f(*P["rib_half"])}" pos="{f(x, sy, P["pad_center"][2])}"/>' for k, x in enumerate(xs))
    gl = {}
    for (name, parent, pos, axis, inn) in G_LINKS:
        body = f'<body name="{name}" pos="{f(*pos)}">{inertial(inn)}<joint name="{name}_joint" axis="{f(*axis)}" range="{f(*G_RANGE)}" armature="{f(P["g_armature"])}" damping="{f(P["g_damping"])}"/>'
        gl[name] = body
    finger = lambda s: gl[f'{s}_finger'] + pad(s) + '</body>'
    gripper = (f'<body name="gbase">{inertial(G_BASE)}'
               f'<geom name="palm" class="arm" type="box" size="0.0375 0.051 0.056" pos="0 0 0.047"/>'
               f'<site name="tcp" pos="0 0 {G_TCP}" size="0.005"/>'
               + gl['left_outer_knuckle'] + finger('left') + '</body>' + gl['left_inner_knuckle'] + '</body>'
               + gl['right_outer_knuckle'] + finger('right') + '</body>' + gl['right_inner_knuckle'] + '</body></body>')
    arm = arm.replace('<geom name="cap6"', '<site name="flange" size="0.005"/><geom name="cap6"', 1)
    acts = ''.join(f'<position name="a{i+1}" joint="joint{i+1}" kp="{f(P["kp"][i])}" kv="{f(P["kv"][i])}" forcerange="{f(-J_EFFORT[i], J_EFFORT[i])}" ctrlrange="{f(*J_RANGE[i])}"/>' for i in range(6))
    acts += f'<position name="grip" joint="left_outer_knuckle_joint" kp="{f(P["g_kp"])}" kv="{f(P["g_kv"])}" forcerange="{f(-P["g_force"], P["g_force"])}" ctrlrange="{f(*G_RANGE)}"/>'
    if P['grip_two']:  # each side force-limited on its own outer knuckle, same command (ctrl[6] copied to ctrl[7] by the harness)
        acts += f'<position name="grip_r" joint="right_outer_knuckle_joint" kp="{f(P["g_kp"])}" kv="{f(P["g_kv"])}" forcerange="{f(-P["g_force"], P["g_force"])}" ctrlrange="{f(*G_RANGE)}"/>'
        pairs = [('left_finger', 'left_outer_knuckle'), ('left_inner_knuckle', 'left_outer_knuckle'), ('right_finger', 'right_outer_knuckle'), ('right_inner_knuckle', 'right_outer_knuckle')]
    else:
        pairs = [(n, 'left_outer_knuckle') for n in ['left_finger', 'left_inner_knuckle', 'right_outer_knuckle', 'right_finger', 'right_inner_knuckle']]
    eq = ''.join(f'<joint joint1="{a}_joint" joint2="{b}_joint" polycoef="0 1 0 0 0" solref="{f(*P["eq_solref"])}"/>' for a, b in pairs)
    sx, sy = P['stand_center']; shx, shy = P['stand_half']; st = P['stand_top']
    tx, ty = P['tray_center']; thx, thy = P['tray_half']; tt = P['tray_top']
    return f'''<mujoco model="m00-xarm6-g2">
<compiler angle="radian" autolimits="true"/>
<option timestep="0.002" integrator="implicitfast" cone="elliptic" impratio="{f(P['impratio'])}" {P['opt_extra']}>{P['flag_xml']}</option>
<default>
  <geom solref="{f(*P['solref'])}" solimp="{f(*P['solimp'])}"/>
  <default class="arm"><geom contype="2" conaffinity="0" condim="3" group="3"/></default>
  <default class="pad"><geom contype="1" conaffinity="1" condim="{P['pad_condim']}" priority="1" friction="{f(*P['padFriction'])}" group="3"/></default>
  <default class="world"><geom contype="1" conaffinity="3" condim="3"/></default>
</default>
<worldbody>
  <geom name="floor" class="world" type="plane" size="1 1 0.01"/>
  <geom name="stand" class="world" type="box" size="{f(shx, shy, st / 2)}" pos="{f(sx, sy, st / 2)}"/>
  <geom name="tray" class="world" type="box" size="{f(thx, thy, tt / 2)}" pos="{f(tx, ty, tt / 2)}"/>
  <body name="link_base">{inertial(BASE_INERTIAL)}
    {arm}{gripper}{close}
  </body>
  <body name="cup" pos="{f(cup_xy[0], cup_xy[1], st + CUP_H / 2)}"><freejoint name="cup"/>
    <geom name="cup" class="world" type="cylinder" size="{f(CUP_R, CUP_H / 2)}" mass="{f(cupm)}" friction="{f(*P['propFriction'])}" condim="4"/>
  </body>
</worldbody>
<equality>{eq}</equality>
<actuator>{acts}</actuator>
</mujoco>
'''

if __name__ == '__main__':
    import sys
    print(build())
```

## Harness đo (`run.py`; `hold`, `trials`, `negative`, `repeat`)

```python
"""M00 scratch: measuring harness. One tick = set ctrl once, mj_step(nstep=10) at 2 ms. Commands follow quintic-sync-v1.
usage: python -I run.py <mode> '<json overrides>'   modes: hold | trials | negative | repeat | gravity"""
import json, math, random, sys, time
sys.path.insert(0, sys.argv[0].rsplit('/', 1)[0])
import numpy as np, mujoco
import scene

TICK_S, NSTEP = 0.02, 10
ARM = 6

def tunables(over):
    T = dict(speedFraction=0.5, maxAccelerationRadS2=[6, 6, 6, 8, 8, 8], dwellTicks=40, gripSettleTicks=25, openDwellTicks=100,
             graspDepthM=0.022, approachM=0.12, liftM=0.15, placeClearM=0.002, gripClose=0.85, gripRate=0.04,
             home_tcp=[0.38, 0.0, 0.40], approachDir=None, home_seed=[0, 0, 0, 0, 1.5708, 0])
    T.update({k: v for k, v in over.items() if k in T})
    return T

def rot_side(a):  # gripper frame for a horizontal approach a: z=a, y horizontal (closing direction), x down
    z = np.array([a[0], a[1], 0.0]); z /= np.linalg.norm(z)
    y = np.array([-z[1], z[0], 0.0]); x = np.cross(y, z)
    return np.column_stack([x, y, z])

def ik(m, pos, R, seed):
    d = mujoco.MjData(m); q = np.array(seed, float)
    for it in range(2000):
        d.qpos[:ARM] = q; mujoco.mj_kinematics(m, d); mujoco.mj_comPos(m, d)
        sid = m.site('tcp').id; p = d.site_xpos[sid]; Rc = d.site_xmat[sid].reshape(3, 3)
        ep = pos - p; er = 0.5 * sum(np.cross(Rc[:, i], R[:, i]) for i in range(3))
        e = np.concatenate([ep, er])
        if np.linalg.norm(ep) < 1e-7 and np.linalg.norm(er) < 1e-7: break
        jp = np.zeros((3, m.nv)); jr = np.zeros((3, m.nv)); mujoco.mj_jacSite(m, d, jp, jr, sid)
        J = np.vstack([jp, jr])[:, :ARM]
        dq = J.T @ np.linalg.solve(J @ J.T + 1e-4 * np.eye(6), e)
        n = np.abs(dq).max(); q = q + (dq * 0.2 / n if n > 0.2 else dq)
        for i in range(ARM): q[i] = min(max(q[i], scene.J_RANGE[i][0]), scene.J_RANGE[i][1])
    return q, float(np.linalg.norm(ep)), float(np.linalg.norm(er)), it

def waypoints(m, P, T):
    sc, tc = np.array(P['stand_center']), np.array(P['tray_center'])
    cz = P['stand_top'] + scene.CUP_H / 2
    if T['approachDir']: ad = np.array(T['approachDir'], float); ag = ap = np.append(ad / np.linalg.norm(ad), 0)
    else: ag, ap = np.append(sc / np.linalg.norm(sc), 0), np.append(tc / np.linalg.norm(tc), 0)  # radial approach from the base
    Rg, Rp = rot_side(ag), rot_side(ap)
    grasp = np.array([*sc, cz]) + ag * T['graspDepthM']
    place = np.array([*tc, P['tray_top'] + scene.CUP_H / 2 + T['placeClearM']]) + ap * T['graspDepthM']
    up = np.array([0, 0, T['liftM']])
    targets = [('pregrasp', grasp - ag * T['approachM'], Rg), ('grasp', grasp, Rg),
               ('lift', grasp + up, Rg), ('preplace', place + up, Rp), ('place', place, Rp), ('retreat', place - ap * T['approachM'], Rp)]
    targets.append(('home', np.array(T['home_tcp']), rot_side([1, 0])))  # solved last, seeded from retreat: same wrist branch
    W, seed = {}, T['home_seed']
    for name, p, R in targets:
        q, ep, er, it = ik(m, p, R, seed)
        rng = random.Random(0); k = 0
        while (ep > 1e-6 or er > 1e-6 or max(abs(x) for x in q) > math.pi + 0.01) and k < 200:  # deterministic multi-start (random.Random(0)) when the chained seed fails or leaves +-pi
            k += 1; s2 = [rng.uniform(-1, 1), rng.uniform(-1.5, 1.5), rng.uniform(-3, 0), rng.uniform(-1.5, 1.5), rng.uniform(-1.5, 1.5), rng.uniform(-1.5, 1.5)]
            q, ep, er, it = ik(m, p, R, s2)
        if ep > 1e-6 or er > 1e-6: raise SystemExit(f'IK failed {name} ep={ep} er={er}')
        W[name] = q; seed = q
    return W, dict(grasp=grasp.tolist(), place=place.tolist(), ag=ag.tolist(), ap=ap.tolist())

def quintic(qa, qb, T):
    d = np.asarray(qb) - np.asarray(qa); f = T['speedFraction']
    t = max(max(1.875 * abs(d[i]) / (scene.J_VEL[i] * f), math.sqrt(5.7735 * abs(d[i]) / (T['maxAccelerationRadS2'][i] * f))) for i in range(ARM))
    n = max(1, math.ceil(t / TICK_S - 1e-9))
    return [np.asarray(qa) + d * (10 * u**3 - 15 * u**4 + 6 * u**5) for u in ((k / n) for k in range(1, n + 1))]

class Sim:
    def __init__(self, P, q0, grip0=0.0):
        self.m = mujoco.MjModel.from_xml_string(scene.build(P)); self.d = mujoco.MjData(self.m)
        self.d.qpos[:ARM] = q0; self.d.ctrl[:ARM] = q0; self.d.ctrl[6:] = grip0
        mujoco.mj_forward(self.m, self.d)
        g = lambda n: self.m.geom(n).id
        self.pl, self.pr, self.cup, self.stand, self.tray = g('pad_left'), g('pad_right'), g('cup'), g('stand'), g('tray')
        self.padL = {i for i in range(self.m.ngeom) if self.m.geom(i).name.startswith('pad_left')}; self.padR = {i for i in range(self.m.ngeom) if self.m.geom(i).name.startswith('pad_right')}
        self.arm_geoms = {g(f'cap{i}') for i in range(1, 7)} | {g('palm')}
        self.cupj = self.m.joint('cup').qposadr[0]; self.cupv = self.m.joint('cup').dofadr[0]
        self.tcp = self.m.site('tcp').id
        self.log = []; self.grip = grip0
    def contacts(self):
        s = set()
        for c in self.d.contact[:self.d.ncon]:
            s.add((min(c.geom1, c.geom2), max(c.geom1, c.geom2)))
        has = lambda a, b: (min(a, b), max(a, b)) in s
        armhit = any((a in self.arm_geoms) != (b in self.arm_geoms) for a, b in s)
        return dict(L=any(has(self.cup, p) for p in self.padL), R=any(has(self.cup, p) for p in self.padR), stand=has(self.cup, self.stand), tray=has(self.cup, self.tray), arm=armhit, n=self.d.ncon)
    def tick(self, cmd, label=''):
        self.d.ctrl[:ARM] = cmd; self.d.ctrl[6:] = self.grip
        t0 = time.perf_counter(); mujoco.mj_step(self.m, self.d, nstep=NSTEP); ms = (time.perf_counter() - t0) * 1000
        c = self.contacts()
        R = self.d.site_xmat[self.tcp].reshape(3, 3); cp = self.d.qpos[self.cupj:self.cupj + 3]
        rel = R.T @ (cp - self.d.site_xpos[self.tcp])
        self.log.append(dict(tick=len(self.log), label=label, cmd=list(map(float, cmd)), q=self.d.qpos[:ARM].tolist(), grip=float(self.d.qpos[ARM]),
                             cup=cp.tolist(), cupquat=self.d.qpos[self.cupj + 3:self.cupj + 7].tolist(), cupv=float(np.linalg.norm(self.d.qvel[self.cupv:self.cupv + 3])),
                             cupw=float(np.linalg.norm(self.d.qvel[self.cupv + 3:self.cupv + 6])), rel=rel.tolist(), held=c['L'] and c['R'], ms=ms, **{k: c[k] for k in ('L', 'R', 'stand', 'tray', 'arm', 'n')}))
    def warnings(self):
        return {i: int(self.d.warning[i].number) for i in range(len(self.d.warning)) if self.d.warning[i].number}

def run_program(P, T, W, sim, marks):
    q = W['home']
    def go(name):
        nonlocal q
        for c in quintic(q, W[name], T): sim.tick(c, 'move:' + name)
        q = W[name]; marks.append(dict(wp=name, arrive=len(sim.log) - 1))
        for _ in range(T['dwellTicks']): sim.tick(q, 'dwell:' + name)
    def grip(target, label, dwell):
        while abs(sim.grip - target) > 1e-12:
            sim.grip = target if abs(target - sim.grip) <= T['gripRate'] else sim.grip + math.copysign(T['gripRate'], target - sim.grip)
            sim.tick(q, label)
        marks.append(dict(wp=label, arrive=len(sim.log) - 1))
        for _ in range(dwell): sim.tick(q, label + ':settle')
    go('pregrasp'); go('grasp'); grip(T['gripClose'], 'close', T['gripSettleTicks'])
    go('lift'); go('preplace'); go('place')
    grip(0.0, 'open', T['openDwellTicks'])
    go('retreat'); go('home')

def analyse(sim, marks, W, geo, P, T):
    L = sim.log
    peak = max(max(abs(a - b) for a, b in zip(r['cmd'], r['q'])) for r in L)
    settle = {}
    for mk in marks:
        if mk['wp'] in W:
            qw = W[mk['wp']]; s = None
            seg = [r for r in L if r['tick'] > mk['arrive'] and r['label'] == 'dwell:' + mk['wp']]
            errs = [max(abs(a - b) for a, b in zip(r['q'], qw)) for r in seg]
            for k in range(len(errs)):
                if all(e <= 0.01 for e in errs[k:]): s = k + 1; break   # ticks after the command arrived
            settle[mk['wp']] = dict(ticks=s, errAtArrive=max(abs(a - b) for a, b in zip(L[mk['arrive']]['q'], qw)), errEnd=errs[-1])
    at = {mk['wp']: mk['arrive'] for mk in marks}
    out = dict(peakFollowRad=peak, settle=settle, ticks=len(L))
    cl = [r for r in L if r['label'] == 'close:settle']; cc = [r for r in L if r['label'] in ('close', 'close:settle')]
    gs = None  # ticks from the first close command until the cup is held by both pads and still (< 1 mm/s) for good
    for k in range(len(cc)):
        if all(r['held'] and r['cupv'] < 0.001 for r in cc[k:]): gs = k + 1; break
    out['gripSettle'] = gs; out['heldAfterClose'] = cl[-1]['held'] if cl else None
    ref = np.array(cl[-1]['rel'])  # cup centre in the TCP frame at the end of the grip settle
    carry = [r for r in L if at['close'] + len(cl) < r['tick'] <= at['place'] + T['dwellTicks']]
    out['slipM'] = max(float(np.linalg.norm(np.array(r['rel']) - ref)) for r in carry)
    out['heldAllCarry'] = all(r['held'] for r in carry)
    z0 = L[0]['cup'][2]
    out['liftM'] = L[at['lift']]['cup'][2] - cl[-1]['cup'][2]  # cup rise from grip end to arrival at 'lift'
    out['liftEndM'] = L[at['lift'] + T['dwellTicks']]['cup'][2] - z0
    op = [r for r in L if r['label'] in ('open', 'open:settle')]
    rest = None
    for k in range(len(op)):
        if all(r['tray'] and r['cupv'] < 0.005 and r['cupw'] < 0.05 and not r['L'] and not r['R'] for r in op[k:]): rest = k + 1; break
    out['dropTicks'] = rest
    end = op[-1]['cup']
    out['placeErrM'] = float(  # end of the open dwell, xy distance to the tray centre
        np.hypot(end[0] - P['tray_center'][0], end[1] - P['tray_center'][1]))
    out['placeZErrM'] = end[2] - (P['tray_top'] + scene.CUP_H / 2)
    fin = L[-1]['cup']; out['finalPlaceErrM'] = float(np.hypot(fin[0] - P['tray_center'][0], fin[1] - P['tray_center'][1]))
    w, x, y, z = op[-1]['cupquat']; out['cupTiltDeg'] = float(math.degrees(math.acos(min(1, 1 - 2 * (x * x + y * y)))))  # cup axis vs world z
    out['notHeldCarry'] = sum(1 for r in carry if not r['held'])
    out['armContactTicks'] = [r['tick'] for r in L if r['arm']][:5]
    out['armContactLabels'] = sorted({r['label'] for r in L if r['arm']})
    out['ms'] = [r['ms'] for r in L]
    out['nan'] = any(not np.isfinite(r['q']).all() for r in L)
    return out

def main():
    mode = sys.argv[1]; over = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    P = {**scene.DEFAULTS, **{k: v for k, v in over.items() if k in scene.DEFAULTS}}; T = tunables(over)
    m0 = mujoco.MjModel.from_xml_string(scene.build(P))
    W, geo = waypoints(m0, P, T)
    print(json.dumps(dict(version=mujoco.__version__, W={k: [round(x, 6) for x in v] for k, v in W.items()}, geo=geo)))
    if mode == 'hold':
        sim = Sim(P, W['home'])
        for _ in range(500): sim.tick(W['home'], 'hold')
        err = max(max(abs(a - b) for a, b in zip(r['q'], W['home'])) for r in sim.log)
        per = [max(abs(r['q'][i] - W['home'][i]) for r in sim.log) for i in range(6)]
        print(json.dumps(dict(holdMaxErrRad=err, perJoint=per, nan=any(not np.isfinite(r['q']).all() for r in sim.log), warnings=sim.warnings(), simS=sim.d.time, cupMovedM=float(np.linalg.norm(np.array(sim.log[-1]['cup']) - np.array(sim.log[0]['cup']))))))
    elif mode == 'trials':
        seeds = over.get('seeds', list(range(1, 11))); res = []; allms = []
        for s in seeds:
            rng = random.Random(s); off = (rng.uniform(-0.005, 0.005), rng.uniform(-0.005, 0.005))
            P2 = dict(P, cup_xy=(P['stand_center'][0] + off[0], P['stand_center'][1] + off[1]))
            sim = Sim(P2, W['home']); marks = []
            run_program(P2, T, W, sim, marks)
            a = analyse(sim, marks, W, geo, P2, T); allms += a.pop('ms')
            a.update(seed=s, offsetMm=[round(o * 1000, 3) for o in off], warnings=sim.warnings())
            res.append(a); print(json.dumps(a))
            if over.get('dump'): json.dump(sim.log, open(over['dump'] + f'-{s}.json', 'w'))
        ms = np.array(allms)
        print(json.dumps(dict(summary=True, n=len(res), ticksTotal=len(ms), p50=float(np.percentile(ms, 50)), p95=float(np.percentile(ms, 95)), max=float(ms.max()),
                              peakFollow=max(r['peakFollowRad'] for r in res), settleMax=max(v['ticks'] or 999 for r in res for v in r['settle'].values()),
                              slipMax=max(r['slipM'] for r in res), dropMax=max(r['dropTicks'] or 999 for r in res), placeErrMax=max(r['placeErrM'] for r in res),
                              liftMin=min(r['liftM'] for r in res), gripSettleMax=max(r['gripSettle'] or 999 for r in res), allHeld=all(r['heldAllCarry'] for r in res))))
    elif mode == 'negative':
        sim = Sim(P, W['home']); marks = []; q = W['home']
        for name in ('pregrasp', 'grasp'):
            for c in quintic(q, W[name], T): sim.tick(c)
            q = W[name]
            for _ in range(T['dwellTicks']): sim.tick(q)
        while sim.grip < T['gripClose']:
            sim.grip = min(T['gripClose'], sim.grip + T['gripRate']); sim.tick(q)
        for _ in range(T['gripSettleTicks']): sim.tick(q)
        for c in quintic(q, W['lift'], T): sim.tick(c)
        q = W['lift']
        for _ in range(T['dwellTicks']): sim.tick(q)
        held0 = sim.log[-1]['held']; z0 = sim.log[-1]['cup'][2]; t0 = len(sim.log)
        for p in sim.padL | sim.padR: sim.m.geom_friction[p][0] = over.get('lowFriction', 0.1)
        for _ in range(100): sim.tick(q)
        after = sim.log[t0:]
        first_empty = next((k + 1 for k, r in enumerate(after) if not r['held']), None)
        print(json.dumps(dict(heldBefore=held0, ticksToEmpty=first_empty, reheld=any(r['held'] for r in after[first_empty:]) if first_empty else None,
                              cupDropM=z0 - after[-1]['cup'][2], cupZend=after[-1]['cup'][2], dropAt25=z0 - after[24]['cup'][2], warnings=sim.warnings())))
    elif mode == 'repeat':
        s = over.get('seed', 3); traces = []
        for _ in range(2):
            rng = random.Random(s); off = (rng.uniform(-0.005, 0.005), rng.uniform(-0.005, 0.005))
            P2 = dict(P, cup_xy=(P['stand_center'][0] + off[0], P['stand_center'][1] + off[1]))
            sim = Sim(P2, W['home']); run_program(P2, T, W, sim, [])
            traces.append(np.array([r['q'] + r['cup'] for r in sim.log]))
        np.save(over.get('out', '/dev/null'), traces[0]) if over.get('out') else None
        print(json.dumps(dict(ticks=len(traces[0]), maxJointDiff=float(np.abs(traces[0][:, :6] - traces[1][:, :6]).max()), maxCupDiff=float(np.abs(traces[0][:, 6:] - traces[1][:, 6:]).max()))))
    elif mode == 'gravity':
        d = mujoco.MjData(m0); d.qpos[:6] = W['home']; mujoco.mj_forward(m0, d)
        print(json.dumps(dict(qfrc_bias_home=d.qfrc_bias[:6].tolist())))

if __name__ == '__main__':
    main()
```

## Mesh: thông tin STL và DAE → STL (`meshinfo.py`)

```python
"""M00 scratch: STL info (binary/ASCII): triangle count, bbox (m), bytes; DAE -> binary STL (first geometry, node matrix chain applied)."""
import struct, sys, os, hashlib
import xml.etree.ElementTree as ET
def stl_tris(path):
    b = open(path, 'rb').read()
    n = struct.unpack_from('<I', b, 80)[0] if len(b) >= 84 else -1
    if len(b) == 84 + 50 * n:
        return [struct.unpack_from('<9f', b, 84 + 50 * i + 12) for i in range(n)], 'binary'
    vs = [tuple(map(float, l.split()[1:4])) for l in b.decode('latin1').splitlines() if l.strip().startswith('vertex')]
    return [sum(vs[i:i+3], ()) for i in range(0, len(vs), 3)], 'ascii'
def info(path):
    t, kind = stl_tris(path)
    xs = [t9[k] for t9 in t for k in range(0, 9, 3)]; ys = [t9[k] for t9 in t for k in range(1, 9, 3)]; zs = [t9[k] for t9 in t for k in range(2, 9, 3)]
    return dict(file=path, kind=kind, tris=len(t), bytes=os.path.getsize(path), sha256=hashlib.sha256(open(path,'rb').read()).hexdigest(),
                bbox=[[min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]])
NS = '{http://www.collada.org/2005/11/COLLADASchema}'
def mat(a, b): return [[sum(a[i][k]*b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]
def dae2stl(src, dst):
    r = ET.parse(src).getroot()
    unit = float(r.find(f'{NS}asset/{NS}unit').get('meter', '1'))
    geo = r.find(f'.//{NS}library_geometries/{NS}geometry'); gid = geo.get('id'); mesh = geo.find(f'{NS}mesh')
    tri = mesh.find(f'{NS}triangles'); vin = [i for i in tri.findall(f'{NS}input') if i.get('semantic') == 'VERTEX'][0]
    stride = len(tri.findall(f'{NS}input')) and 1 + max(int(i.get('offset')) for i in tri.findall(f'{NS}input'))
    verts = mesh.find(f'{NS}vertices'); pos_id = verts.find(f'{NS}input[@semantic="POSITION"]').get('source')[1:]
    fa = [float(x) for x in mesh.find(f'{NS}source[@id="{pos_id}"]/{NS}float_array').text.split()]
    P = [fa[i:i+3] for i in range(0, len(fa), 3)]
    p = [int(x) for x in tri.find(f'{NS}p').text.split()]; off = int(vin.get('offset'))
    idx = p[off::stride]
    # matrix chain to the node that instances this geometry
    def walk(node, M):
        m = node.find(f'{NS}matrix'); M2 = mat(M, [[float(x) for x in m.text.split()][i*4:i*4+4] for i in range(4)]) if m is not None else M
        if any(ig.get('url') == '#' + gid for ig in node.findall(f'{NS}instance_geometry')): return M2
        for c in node.findall(f'{NS}node'):
            got = walk(c, M2)
            if got: return got
    I = [[1 if i == j else 0 for j in range(4)] for i in range(4)]
    M = None
    for n in r.find(f'.//{NS}library_visual_scenes/{NS}visual_scene').findall(f'{NS}node'):
        M = walk(n, I)
        if M: break
    tf = lambda v: [unit * (M[i][0]*v[0] + M[i][1]*v[1] + M[i][2]*v[2] + M[i][3]) for i in range(3)]
    out = bytearray(b'M00 dae2stl'.ljust(80, b' ')) + struct.pack('<I', len(idx) // 3)
    for k in range(0, len(idx), 3):
        out += struct.pack('<12fH', 0, 0, 0, *tf(P[idx[k]]), *tf(P[idx[k+1]]), *tf(P[idx[k+2]]), 0)
    open(dst, 'wb').write(out)
    return M
if __name__ == '__main__':
    import json
    if sys.argv[1] == 'dae2stl':
        print(json.dumps(dae2stl(sys.argv[2], sys.argv[3])))
    else:
        for f in sys.argv[2:]: print(json.dumps(info(f)))
```

## Đối chiếu với URDF khai triển (`crosscheck.py`)

```python
"""M00 scratch: compare the transcribed constants in scene.py with ufactory_genesis xarm6_1305.urdf (expanded URDF, read as data)."""
import sys, math, xml.etree.ElementTree as ET; sys.path.insert(0, sys.argv[0].rsplit('/', 1)[0])
import scene
r = ET.parse(sys.argv[1]).getroot(); bad = 0; n = 0
def chk(name, a, b):
    global bad, n; n += 1
    if any(abs(x - y) > 1e-9 for x, y in zip(a, b)) or len(a) != len(b): bad += 1; print('DIFF', name, a, b)
links = {l.get('name'): l for l in r.findall('link')}; joints = {j.get('name'): j for j in r.findall('joint')}
for i in range(6):
    j = joints[f'joint{i+1}']; o = j.find('origin'); lim = j.find('limit')
    chk(f'j{i+1} xyz', [float(x) for x in o.get('xyz').split()], scene.J_ORIGIN[i][0])
    chk(f'j{i+1} rpy', [float(x) for x in o.get('rpy').split()], [scene.J_ORIGIN[i][1], 0, 0])
    lo, hi = scene.J_RANGE[i]
    chk(f'j{i+1} limit', [float(lim.get(k)) for k in ('effort', 'velocity')], [scene.J_EFFORT[i], scene.J_VEL[i]])
    if abs(float(lim.get('lower')) - lo) > 1e-3 or abs(float(lim.get('upper')) - hi) > 1e-3: print('LIMIT (rounded in URDF)', i + 1, lim.get('lower'), lim.get('upper'), lo, hi)
    inn = links[f'link{i+1}'].find('inertial'); I = inn.find('inertia')
    chk(f'link{i+1} com', [float(x) for x in inn.find('origin').get('xyz').split()], scene.LINK_INERTIAL[i][0])
    chk(f'link{i+1} mass', [float(inn.find('mass').get('value'))], [scene.LINK_INERTIAL[i][1]])
    chk(f'link{i+1} I', [float(I.get(k)) for k in ('ixx', 'iyy', 'izz', 'ixy', 'ixz', 'iyz')], scene.LINK_INERTIAL[i][2])
inn = links['link_base'].find('inertial'); I = inn.find('inertia')
chk('base', [float(x) for x in inn.find('origin').get('xyz').split()] + [float(inn.find('mass').get('value'))] + [float(I.get(k)) for k in ('ixx', 'iyy', 'izz', 'ixy', 'ixz', 'iyz')],
    list(scene.BASE_INERTIAL[0]) + [scene.BASE_INERTIAL[1]] + list(scene.BASE_INERTIAL[2]))
print(f'{n} checks, {bad} differences')
```

## Tiêu chí 8: pose và flange MuJoCo (`fk_poses.py`)

```python
"""M00 scratch: 20 seeded joint poses (uniform in the xacro limits, J1/J4/J6 in +-pi) and the MuJoCo flange site position for each."""
import sys, json, random; sys.path.insert(0, sys.argv[0].rsplit('/', 1)[0])
import mujoco, scene
m = mujoco.MjModel.from_xml_string(scene.build()); d = mujoco.MjData(m); rng = random.Random(int(sys.argv[1]))
out = []
for _ in range(20):
    q = [rng.uniform(max(lo, -3.14159), min(hi, 3.14159)) for lo, hi in scene.J_RANGE]
    d.qpos[:6] = q; mujoco.mj_kinematics(m, d)
    out.append(dict(q=q, flange=d.site('flange').xpos.tolist(), flangeMat=d.site('flange').xmat.tolist()))
print(json.dumps(dict(version=mujoco.__version__, poses=out)))
```

## Tiêu chí 8: D-H qua `forwardKinematics` (`fk_compare.mjs`, chạy `pnpm exec tsx` từ thư mục `source`)

```js
// M00 scratch: flange position from the UFACTORY xArm 6 modified D-H table through lab-runtime forwardKinematics vs MuJoCo site_xpos.
// run: pnpm exec tsx <this file> <poses.json>   (cwd = source repo, so tsx resolves; nothing in the repo is changed)
import {readFileSync} from 'node:fs';
import {forwardKinematics,toSI} from '/Users/hoangpham/source/prv/robot/source/packages/lab-runtime/src/v2/models/arm-kinematics.ts';
const a2=Math.sqrt(284.5**2+53.5**2), T2=-Math.atan(284.5/53.5), H=Math.PI/2;
const j=(name,alpha,a,d,thetaOffset)=>({name,alpha,a,d,thetaOffset,min:-2*Math.PI,max:2*Math.PI,maxVelocity:3.14});
const XARM6={id:'xarm6-ufactory-dh',convention:'modified_dh',provenance:'illustrative_reference',mekoniqRobotCode:null,units:{length:'mm',alpha:'rad',joint:'rad'},
 joints:[j('J1',0,0,267,0),j('J2',-H,0,0,T2),j('J3',0,a2,0,-T2),j('J4',-H,77.5,342.5,0),j('J5',H,0,0,0),j('J6',-H,76,97,0)],
 toolTranslation:[0,0,0],tolerances:{fkPositionM:1e-6,fkAngleRad:1e-6,ikPositionM:0.001,ikAngleRad:0.0087266463}};
const m=toSI(XARM6), P=JSON.parse(readFileSync(process.argv[2],'utf8'));
const errs=P.poses.map(p=>{const f=forwardKinematics(m,p.q).flange.position;return Math.hypot(f[0]-p.flange[0],f[1]-p.flange[1],f[2]-p.flange[2]);});
const s=[...errs].sort((x,y)=>x-y);
console.log(JSON.stringify({mujoco:P.version,n:errs.length,maxM:s[s.length-1],medianM:s[Math.floor(s.length/2)],a2,T2,errsM:errs}));
```

## Tiêu chí 9: `STLLoader` (`stl_load.mjs`, three 0.180.0 cài vào scratch)

```js
// M00 scratch: parse every STL with three.js STLLoader (0.180.0), report triangles and bytes. run: node stl_load.mjs <three dir> <stl...>
import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {STLLoader}=await import(pathToFileURL(process.argv[2]+'/node_modules/three/examples/jsm/loaders/STLLoader.js').href);
const L=new STLLoader();let tris=0,bytes=0;const rows=[];
for(const f of process.argv.slice(3)){const b=readFileSync(f);const g=L.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));const n=g.getAttribute('position').count/3;
 if(!Number.isInteger(n)||n<=0)throw new Error('bad '+f);tris+=n;bytes+=statSync(f).size;rows.push([f.split('/').slice(-2).join('/'),n,statSync(f).size]);}
console.log(JSON.stringify({files:rows.length,tris,bytes,MB:bytes/1048576,rows}));
```

## Lực ép má (`squeeze.py`)

```python
"""M00 scratch: normal force per pad (sum over contact points) at the end of the lift dwell, seed 1, final parameters."""
import sys, random; sys.path.insert(0, sys.argv[0].rsplit('/', 1)[0])
import json, mujoco, numpy as np, run, scene
P = dict(scene.DEFAULTS); T = run.tunables({}); W, geo = run.waypoints(mujoco.MjModel.from_xml_string(scene.build(P)), P, T)
sim = run.Sim(P, W['home']); out = {}
orig = sim.tick
def tick(cmd, label=''):
    orig(cmd, label)
    if label == 'dwell:lift':
        f = {'pad_left': 0.0, 'pad_right': 0.0}
        for i, c in enumerate(sim.d.contact[:sim.d.ncon]):
            f6 = np.zeros(6); mujoco.mj_contactForce(sim.m, sim.d, i, f6)
            for g in (c.geom1, c.geom2):
                n = sim.m.geom(g).name
                if n in f: f[n] += f6[0]
        out.update(f, drive=float(sim.d.actuator_force[6]), q=float(sim.d.qpos[6]))
sim.tick = tick; run.run_program(P, T, W, sim, [])
print(json.dumps(out))
```

## So một trạng thái giữa hai nền (`probe3.py`)

```python
"""M00 scratch: save (mode=save) the full state at a tick of trial seed 1, or (mode=eval) load it and print contacts, constraint forces and one tick, to compare platforms."""
import sys, json; sys.path.insert(0, sys.argv[0].rsplit('/', 1)[0])
import mujoco, numpy as np, run, scene
P = dict(scene.DEFAULTS); T = run.tunables({})
if sys.argv[1] == 'save':
    W, geo = run.waypoints(mujoco.MjModel.from_xml_string(scene.build(P)), P, T)
    import random; rng = random.Random(1); off = (rng.uniform(-0.005, 0.005), rng.uniform(-0.005, 0.005))
    P2 = dict(P, cup_xy=(P['stand_center'][0] + off[0], P['stand_center'][1] + off[1])); sim = run.Sim(P2, W['home']); orig = sim.tick; st = {}
    def tick(cmd, label=''):
        orig(cmd, label)
        if len(sim.log) - 1 == int(sys.argv[3]): st.update(qpos=sim.d.qpos.tolist(), qvel=sim.d.qvel.tolist(), act=sim.d.act.tolist(), ctrl=sim.d.ctrl.tolist(), qacc_warmstart=sim.d.qacc_warmstart.tolist(), time=sim.d.time, cup_xy=list(P2['cup_xy']))
    sim.tick = tick; run.run_program(P2, T, W, sim, []); json.dump(st, open(sys.argv[2], 'w'))
else:
    st = json.load(open(sys.argv[2])); m = mujoco.MjModel.from_xml_string(scene.build(dict(P, cup_xy=st['cup_xy']))); d = mujoco.MjData(m)
    for k in ('qpos', 'qvel', 'ctrl', 'qacc_warmstart'): getattr(d, k)[:] = st[k]
    d.time = st['time']; mujoco.mj_forward(m, d)
    print('ncon', d.ncon, 'nefc', d.nefc)
    for c in d.contact[:d.ncon]: print(m.geom(c.geom1).name, m.geom(c.geom2).name, '%.9e' % c.dist, np.round(c.pos, 9).tolist())
    print('efc_force sum', '%.9e' % np.abs(d.efc_force).sum(), 'qacc', np.round(d.qacc[:8], 6).tolist())
    mujoco.mj_step(m, d, nstep=10); print('after tick cup', np.round(d.qpos[6 + 6:6 + 6 + 3] if False else d.qpos[m.joint('cup').qposadr[0]:m.joint('cup').qposadr[0] + 3], 9).tolist(), 'ncon', d.ncon)
```
