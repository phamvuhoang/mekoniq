# xarm6-g2-v1

UFACTORY xArm 6 (bản 1305) với Gripper G2, dưới dạng một `engineering-component` cho plant MuJoCo của R2a (D38). Sinh bởi `scripts/generate-xarm6-fixture.mjs` từ file của hãng đã ghim; không sửa tay.

**Khối lượng và quán tính là số danh định của hãng; ma sát, hệ số điều khiển và má kẹp là giả định; chưa hiệu chuẩn.**

Cản và ma sát khớp (`jointDynamics`) là thiết lập mô phỏng Gazebo trong file của hãng, được lấy làm giả định (`source.kind` `assumed`, vẫn trích xacro của hãng), không phải đặc tính đo được của khớp.

## Nguồn từng nhóm số

| Nhóm | File | Nguồn |
|---|---|---|
| Gốc khớp J1..J6 (xyz, roll) | `component.json` | `xarm_description/config/kinematics/default/xarm6_default_kinematics.yaml` (rpy đổi sang quaternion, quay cố định trục X, Y, Z) |
| Giới hạn khớp, `velocity` | `component.json` | `xarm_description/urdf/xarm6/xarm6.urdf.xacro` (tham số macro `jointN_lower/upper_limit`, `velocity="3.14"`) |
| `effort` J1..J6 | `component.json` | `xarm_description/config/xarm6/joint_limits_1305.yaml` |
| Khối lượng, trọng tâm, quán tính link1..6 | `component.json` | `xarm_description/config/link_inertial/xarm6_type6_HT_BR2.yaml` (mặc định của xacro); base: `xarm6.urdf.xacro` |
| Khớp, giới hạn, mimic, quán tính tay kẹp | `component.json`, `physics.json` (`gripper.mimic`) | `xarm_description/urdf/gripper/xarm_gripper.urdf.xacro` (G2 dùng chung macro với G1, chỉ đổi mesh `_g2`/`.dae`); gắn vào `link6` qua `link_eef` gốc đơn vị (`xarm_device_macro.xacro`) |
| Mesh tay máy | `blobs/<sha256>.stl` | `xarm_description/meshes/xarm6_1305/visual/*.stl`, chép nguyên byte |
| Mesh tay kẹp | `blobs/<sha256>.stl` | `xarm_description/meshes/gripper/xarm/*_g2.dae`, đổi sang STL nhị phân (xem dưới) |
| Bảng modified D-H `XARM6_REFERENCE` | `packages/lab-runtime/src/v2/models/arm-kinematics.ts` | trang D-H xArm 6 của hãng (spike M00); `toolTranslation` = `joint_tcp` z 172 mm |
| `jointDynamics` (damping 1, frictionloss 1) | `physics.json` | `<dynamics>` trong xacro của hãng: giá trị mô phỏng Gazebo, ghi `assumed` |
| `kp`, `kv`, `armatureKgM2`, tay kẹp (`kp`, `kv`, `forceRangeNm`, `armatureKgM2`, `closedRad`, `commandRateRadPerTick`, `mimicSolref`), má kẹp, lòng bàn tay, `contact`, `capsuleRadiusM`, `maxAccelerationRadS2`, `speedFraction` | `physics.json` | giả định của spike M00 (`docs/research/2026-11-mujoco-arm-spike.md`, bảng "Tham số chọn"), chép nguyên; `solimp` ghi 3 số đầu, hai số cuối (0.5, 2) là mặc định của MuJoCo |
| `gripper.forceN` (13,15 N mỗi má), `gripper.openingMaxM` (88,9 mm) | `physics.json` | số đo của spike trên mô hình này, không phải số của sản phẩm |
| Bệ vòi, khay, cốc, pose gắp/đặt, `approachM`, `liftM` | `cell-layout.json` | giả định của spike M00 (bảng bố cục trạm); pose là pose TCP trong khung base, gắp ngang theo hướng bán kính, TCP vượt trục cốc `graspDepthM` 0,022 m, đáy cốc khi đặt cao hơn khay 2 mm |
| Waypoint | `programs.json` | `solvePose(XARM6_SI)` (seed nối tiếp từ `home` của spike, `rngSeed` 20261112); `home` là TCP (0,38, 0, 0,40) hướng như gắp; `pickApproach` = `pick` lùi `approachM` dọc trục tiếp cận, `lift` = `pick` + `liftM` theo z, `placeApproach` = `place` + `approachM` theo z |
| Trạm cà phê | `coffee-cell-project.json` | project `coffee-cell-v2` của Lab; `baseInMap` đặt khay của `cell-layout` lên điểm `coffee_pickup`, đế tay máy cao 0,7 m; thân AMR (`robotHeightM`, đùn lên) cao 0,6 m, thấp hơn mặt phẳng đế tay máy, khay của AMR (khay của `cell-layout`, mặt trên 0,76 m) đặt trên giá nâng phía trên thân; minh họa, chưa hiệu chuẩn |

## Mesh

- Tay máy: 7 STL nhị phân của hãng, tên blob là sha256 của file hãng.
- Tay kẹp: G2 trong `xarm_ros2` chỉ có DAE. Bộ sinh đọc DAE như dữ liệu XML: hình học thứ nhất, phần `<triangles>` duy nhất, chuỗi ma trận node của visual scene thứ nhất, đơn vị m; ghi STL nhị phân pháp tuyến 0, float32 little-endian, header 80 byte cố định. Tam giác có đỉnh xa gốc link hơn 0.3 m bị loại: chỉ `base_link_g2` có (300 tam giác lạc của spike M00). `manifest.json` ghi mỗi blob đã đổi cùng sha256 của DAE nguồn và số tam giác giữ/bỏ.
- Va chạm trong `component.json` chỉ có ở base và link1..link6 (cùng mesh hiển thị; MuJoCo lấy bao lồi). Va chạm tay kẹp là má kẹp và lòng bàn tay hộp giả định trong `physics.json`; khâu và ngón không có hình va chạm. Mesh va chạm `collision/*.obj` của hãng không dùng.

## License

Mọi file của hãng: `xArm-Developer/xarm_ros2` commit `ac736c92b02de7ca7e0be6f737d77d46707464d8`, BSD-3-Clause (`NOTICE`). Danh sách file, URL và sha256: `vendor-manifest.json`; bản sao nằm ở `robotics/catalog/documents/<sha256>` (nhập bằng `scripts/import-engineering-vendor.mjs`).

## Sinh lại

```sh
node scripts/import-engineering-vendor.mjs robotics/simulation-mujoco/fixtures/xarm6-g2-v1/vendor-manifest.json   # chỉ khi thiếu file trong robotics/catalog/documents
pnpm exec tsx scripts/generate-xarm6-fixture.mjs
```

Đầu ra tất định: số làm tròn 12 chữ số, khóa JSON sắp xếp. `tests/unit/xarm6-fixture.test.ts` sinh lại vào thư mục tạm và so từng byte; `tests/integration/xarm6-rtb.test.ts` so bảng D-H với Robotics Toolbox.
