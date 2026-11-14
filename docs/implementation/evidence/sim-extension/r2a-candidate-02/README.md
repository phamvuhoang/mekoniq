# r2a-candidate-02 — bằng chứng sau code review R2a

Bản ghi do recorder tạo trên hai cây sạch, kiểm định danh trước và sau mỗi lần ghi. `qualification.json` và mọi artifact được giữ nguyên; trạng thái `tested` là kết quả kiểm thử, còn `accepted:false` cho tới khi người duyệt chấp nhận bằng sidecar riêng. Chưa tạo `acceptance.json`.

Chuỗi cùng commit: `candidate-09` → `r1-candidate-07` → `r11-candidate-04` → `r2a-candidate-02`; R-MOCK ở `lab/docs/implementation/evidence/sim-extension-r2a/regression-02`. Chuỗi được ghi ngoài cả hai repo, không commit xen giữa.

## Định danh

| Mục | Giá trị |
|---|---|
| Source | 4f893ac6fb75dff414a3ee42a726defb7935c734 |
| Lab | a6ec316fb3ac2f71afff25e6fa77e931f4439e00 |
| Artifact Lab | 55dd3585fb386953512554ca52d54c9463e7028286a64a66425a4f5dbe8e6270 |
| Schema | 9e6ebfffc4aef0f3df686316881b672d96ac892d7df023701b38c398d979bff4 |
| Portable tools | 3d9c0b5f3e60e89327362c0c59bba8ceca4af55b0f08c44da0fbd23f3070bb1d |
| Native tools | 982b7498a5ee1a67e8a9d07468533f3571e68a9d732c76abe7769dc4749835a4 |
| Bắt đầu | 2026-11-14T00:31:31.769Z |
| Kết thúc | 2026-11-14T00:40:24.684Z |

## Gate

| Gate | Trạng thái | Accepted | Case |
|---|---|---|---|
| G-MA1 | tested | false | MA01, MA02, MA03 |
| G-MA2 | tested | false | MA04, MA05, MA06, MA07, MA08 |
| G-RT1 | tested | false | RT01, RT02, RT03, RT04 |
| G-RT2 | tested | false | RT05 |
| G-UI1 | tested | false | UI01, UI02, UI03, UI04 |
| G-INT4 | tested | false | UI05, INT15, INT16 |
| G-REG3 | tested | false | REG03 |
| G-CLOUD1 | blocked_external | false | CL01 |

## Case

| Case | Trạng thái | Bằng chứng | Ghi chú |
|---|---|---|---|
| MA01 | tested | suite:ma-static, suite:ma-rtb, suite:ma-py |  |
| MA02 | tested | suite:ma-worker, suite:ma-py |  |
| MA03 | tested | suite:ma-py, suite:ma-ports, suite:ma-worker |  |
| MA04 | tested | suite:ma-programs, suite:ma-contact |  |
| MA05 | tested | suite:ma-bv01 |  |
| MA06 | tested | suite:ma-faults | ruled 2026-11-13: with the pads' friction lowered the cup slips during the lift, so the transfer is refused at the lift check (TRANSFER_REJECTED, run needs_attention) and CUP_DROPPED latches when the cup leaves the pads; the case is an explicit failure at the lift check and/or CUP_DROPPED, never completed, the gripper never commanded open. The weakened-joint fault runs on a temporary copy of the worker root; the occupied-stand run ends in ARM_COLLISION before the worker's occupied refusal, which is proven at worker and ports level |
| MA07 | tested | suite:ma-bv01 |  |
| MA08 | tested | suite:ma-bv01, suite:ma-contact |  |
| RT01 | tested | suite:rt-remote |  |
| RT02 | tested | suite:lab-rt-unit |  |
| RT03 | tested | suite:rt-paced | ruled 2026-11-13: on the fixed-step runner, paced and unpaced evidence are identical for the same action sequence and the unpaced golden is unchanged with no wall-clock call; a paced run cannot reproduce the 500-tick golden (a paced step carries at most 50 ticks) |
| RT04 | tested | suite:lab-e2e-remote-origin |  |
| RT05 | tested | suite:rt-container | the image is built by the recorder for this machine's architecture from the recorded commit; a container run is never evidence for G-MA1/G-MA2 (D50); linux/amd64 has only run under emulation, where MJ-BV01 stops with PLANT_UNSTABLE (cause unknown), and real amd64 hardware is untested |
| CL01 | not_run |  | blocked_external: no Cloud Run deployment has been ordered (D60); CL01 runs on a deployed service only, and its producer and record format belong to that deployment work |
| UI01 | tested | suite:lab-ui-unit, suite:lab-e2e-twin-layout |  |
| UI02 | tested | suite:lab-ui-unit, suite:lab-e2e-twin-layout, suite:lab-e2e-twin-polish |  |
| UI03 | tested | suite:lab-ui-unit, suite:lab-e2e-twin-transport, suite:lab-e2e-twin-polish |  |
| UI04 | tested | suite:lab-ui-unit, suite:lab-e2e-brand-accessibility, suite:lab-e2e-twin-layout, suite:lab-e2e-twin-workspace |  |
| UI05 | tested | suite:lab-arm-unit, suite:lab-e2e-arm-mesh, suite:lab-e2e-arm-cell, suite:lab-e2e-mujoco-mesh-fallback | ruled 2026-11-13: the launcher-level check is the MuJoCo launcher spec (mujoco-mesh-fallback); the plan's mock-launcher e2e was replaced by UI-only browser specs (arm-mesh, arm-cell). The 3D view also draws the cell's two supports (assumed geometry of the simulated cell) and an illustrative mount and legs that are not simulated |
| INT15 | tested | suite:lab-e2e-mujoco-coffee, suite:lab-arm-unit |  |
| INT16 | tested | suite:regress, suite:ma-faults, suite:lab-e2e-irsim-journey, suite:lab-e2e-webots-coffee, record:mock-regression | the mock e2e on the new UI is the R-MOCK regression of the same commit (mock-regression.json) |
| REG03 | tested | record:linkforge-irsim, record:mock-regression, record:r1, record:r1.1 |  |

## Suite

| Suite | Kết quả máy đọc | Log |
|---|---|---|
| ma-static | {"passed": 36, "failed": 0, "skipped": 0, "total": 36} | suites/ma-static.log |
| ma-rtb | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/ma-rtb.log |
| ma-py | {"passed": 43, "failed": 0, "skipped": 0, "total": 43} | suites/ma-py.log |
| ma-worker | {"passed": 3, "failed": 0, "skipped": 0, "total": 3} | suites/ma-worker.log |
| ma-ports | {"passed": 15, "failed": 0, "skipped": 0, "total": 15} | suites/ma-ports.log |
| ma-programs | {"passed": 2, "failed": 0, "skipped": 0, "total": 2} | suites/ma-programs.log |
| ma-contact | {"passed": 44, "failed": 0, "skipped": 0, "total": 44} | suites/ma-contact.log |
| ma-bv01 | {"passed": 15, "failed": 0, "skipped": 0, "total": 15} | suites/ma-bv01.log |
| ma-faults | {"passed": 17, "failed": 0, "skipped": 0, "total": 17} | suites/ma-faults.log |
| rt-remote | {"passed": 15, "failed": 0, "skipped": 0, "total": 15} | suites/rt-remote.log |
| rt-paced | {"passed": 14, "failed": 0, "skipped": 0, "total": 14} | suites/rt-paced.log |
| rt-container | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/rt-container.log |
| regress | {"passed": 35, "failed": 0, "skipped": 0, "total": 35} | suites/regress.log |
| lab-rt-unit | {"passed": 51, "failed": 0, "skipped": 0, "total": 51} | suites/lab-rt-unit.log |
| lab-ui-unit | {"passed": 75, "failed": 0, "skipped": 0, "total": 75} | suites/lab-ui-unit.log |
| lab-arm-unit | {"passed": 48, "failed": 0, "skipped": 0, "total": 48} | suites/lab-arm-unit.log |
| lab-e2e-remote-origin | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-remote-origin.log |
| lab-e2e-twin-layout | {"passed": 9, "failed": 0, "skipped": 0, "total": 9} | suites/lab-e2e-twin-layout.log |
| lab-e2e-twin-polish | {"passed": 10, "failed": 0, "skipped": 0, "total": 10} | suites/lab-e2e-twin-polish.log |
| lab-e2e-twin-transport | {"passed": 7, "failed": 0, "skipped": 0, "total": 7} | suites/lab-e2e-twin-transport.log |
| lab-e2e-twin-workspace | {"passed": 5, "failed": 0, "skipped": 0, "total": 5} | suites/lab-e2e-twin-workspace.log |
| lab-e2e-brand-accessibility | {"passed": 9, "failed": 0, "skipped": 0, "total": 9} | suites/lab-e2e-brand-accessibility.log |
| lab-e2e-arm-mesh | {"passed": 7, "failed": 0, "skipped": 0, "total": 7} | suites/lab-e2e-arm-mesh.log |
| lab-e2e-arm-cell | {"passed": 6, "failed": 0, "skipped": 0, "total": 6} | suites/lab-e2e-arm-cell.log |
| lab-e2e-mujoco-coffee | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-mujoco-coffee.log |
| lab-e2e-mujoco-mesh-fallback | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-mujoco-mesh-fallback.log |
| lab-e2e-irsim-journey | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-irsim-journey.log |
| lab-e2e-webots-coffee | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-webots-coffee.log |

## Giới hạn

RT05 chạy image `linux/arm64` trên máy ghi. Image `linux/amd64` chỉ được chạy riêng dưới giả lập và vẫn gặp `PLANT_UNSTABLE`; CL01 qua HTTP trên Cloud Run x86-64 thật đã đạt với cùng pin (`../../cloud-run/mekoniq-2026-11-14/README.md`). Recorder hiện vẫn cố định G-CLOUD1 `blocked_external`, CL01 `not_run`; kết quả cloud được lưu riêng, không sửa qualification. Kiểm tay trình duyệt được ghi riêng trong `manual/README.md`.

Một phép đo phần mềm không đóng gate native, thiết bị hay phần cứng. Các lần chấp nhận candidate cũ không chuyển sang bản ghi này.

## MuJoCo, image và số đo

MuJoCo `3.17.0`, fixture `xarm6-g2-v1` (xArm 6 + Gripper G2), nguồn hãng `xArm-Developer/xarm_ros2@ac736c92b02de7ca7e0be6f737d77d46707464d8`, BSD-3-Clause. Đây là mô hình được mô phỏng; asset minh họa trong dự án Lab không phải tay máy vật lý mới.

| Phép đo | Giá trị | Nguồn |
|---|---|---|
| Host: tick / thời gian tường | [4800, 4800] / [10321, 8755] ms | suites/ma-bv01.log |
| Host: ms/tick | 2.150, 1.824 | suites/ma-bv01.log |
| Trượt cốc tối đa | 2.808930 mm (ngưỡng 5 mm) | suites/ma-bv01.log |
| Container | linux/arm64, 4800 tick, 9463 ms, 1.971 ms/tick | suites/rt-container.log |
| Nhịp 1× | 1; [5, 15] giây mô phỏng trong 10.003 giây tường | suites/lab-e2e-mujoco-coffee.log |

Image do recorder dựng: `sha256:9b1b549034bdcbbd3a8fd9cbd94f71c0082bef174f1b6d5c42751db7091d6e58`, revision `4f893ac6fb75dff414a3ee42a726defb7935c734`. Số đo phụ thuộc máy và tải, không phải thông lượng của Cloud Run.

## Tham số `assumed` (chưa hiệu chuẩn, `not_calibrated`)

Khối lượng, quán tính, gốc khớp, giới hạn khớp, `velocity`, `effort` và mesh là **số danh định của hãng** (file `xarm_ros2` đã ghim). Mọi tham số sau là **giả định** (spike M00, `docs/research/2026-11-mujoco-arm-spike.md`; `physics.json` và `cell-layout.json` của fixture đều có `provenance: "assumed"`):

- Bộ điều khiển vị trí: `kp`/`kv` J1 6000/150, J2 6000/150, J3 5000/100, J4 2000/40, J5 2000/30, J6 500/14; `armatureKgM2` 0,1 mỗi khớp; `maxAccelerationRadS2` [6, 6, 6, 8, 8, 8]; `speedFraction` 0,5.
- `jointDynamics` damping 1, frictionloss 1: trích từ `<dynamics>` trong xacro của hãng nhưng là thiết lập mô phỏng Gazebo, nên ghi `assumed` (không phải đặc tính đo được của khớp).
- Tay kẹp: `kp` 20, `kv` 0,5, `forceRangeNm` 1,2, `armatureKgM2` 0,002, `closedRad` 0,85, `commandRateRadPerTick` 0,04, `mimicSolref` [0,004, 1]; `forceN` 13,15 N mỗi má và `openingMaxM` 88,9 mm là số đo của spike trên mô hình này, không phải số của sản phẩm.
- Má kẹp: hai hộp 24 × 4 × 40 mm (tâm ±24 mm, z 40 mm trên `left_finger`/`right_finger`); lòng bàn tay: hộp 75 × 102 × 112 mm. Va chạm tay kẹp chỉ qua các hộp này.
- Tiếp xúc: `condim` 4, `impratio` 10, `solimp` [0,9, 0,95, 0,005], `solref` [0,01, 1]; ma sát má kẹp [1, 0,02, 0,0001], ma sát cốc [0,6, 0,005, 0,0001], ma sát giá đỡ (bệ, khay, sàn) 1 (`world3d.supportFriction`).
- Trạm: bệ vòi tâm (0,49, 0, 0,05) m cỡ 0,1 m; khay tâm (0,35, 0,35, 0,03) m cỡ 0,2 × 0,2 × 0,06 m; cốc bán kính 0,04 m, cao 0,1 m, 0,02 kg rỗng + 0,3 kg đồ uống; `approachM` 0,12, `liftM` 0,15; pose gắp/đặt trong `cell-layout.json`.
- `capsuleRadiusM`/`capsuleSegmentsM`: chỉ dùng cho capsule sweep TS (ARM03), không phải va chạm của engine.
- Ngưỡng `mujocoArm` của oracle profile (`reachTolRad` 0,01, `settleTicks` 10, `followTolRad` 0,05, `followTicks` 10, `repeatJointRad` 1e-9, `gripSettleTicks` 25, `dropTicks` 50, `liftMinM` 0,14, `slipTolM` 0,005, `fkTolM` 1e-5) là **ngưỡng kiểm thử ban đầu chọn từ spike M00**, không phải năng lực đo được của tay máy nào.
- Trạm cà phê trong Lab (`coffee-cell-project.json`: đế tay máy cao 0,7 m, thân AMR 0,6 m) là minh họa; asset thiết kế `arm-puma-reference` của Lab không phải tay máy được mô phỏng.

Capsule ARM03 hiện bao cả lòng bàn tay phía sau TCP: `gripperBackM=0.181`, bán kính `0.063302843538` m và chiều trước TCP `0.025` m. Các kích thước này bao hình học giả định của mô hình, không thay thế kiểm chứng va chạm của một thiết bị thật.

## Không được suy ra

Không suy ra lực kẹp hay ma sát thật, cốc đổ/tràn, tải thật, độ lặp lại xArm thật, hành vi firmware, an toàn người, độ trễ mạng ngoài phép đo đã ghi hay an toàn cloud nhiều người dùng.

## Điều kiện ghi và sửa lỗi trước bản này

Máy được giữ thức bằng `caffeinate -dims`; Docker chạy và phiên đồ họa mở khóa. Không đặt `PYTEST_ADDOPTS`: recorder tự tắt cache provider. Các bản sửa gồm capsule gripper ARM03, từ chối fault không hỗ trợ, giải phóng run hết phiên trước readiness, thoát chế độ xem trên màn hình cảm ứng, pytest không ghi cache, bộ định danh hỗ trợ cây Git lớn, export ổn định sau Python editable install và bốn test Python dùng `-B`.

Hai lượt chuẩn bị trước chuỗi này được giữ ngoài repo: một lượt dừng do giới hạn bộ đệm Git `ENOBUFS`; lượt kế tiếp hoàn tất hồi quy nhưng được thay thế khi phát hiện hash chứa metadata `.egg-info`. Chúng không được dùng làm bằng chứng cho commit hiện tại.

## Cloud Run bổ sung sau lệnh deploy

[CL01 trên project mekoniq](../../cloud-run/mekoniq-2026-11-14/README.md) đã đạt trên x86-64 thật với cùng runtime và pin. Guard `cloud-run` kiểm bản bổ sung gắn với SHA-256 của chính `qualification.json` này; G-CLOUD1 là `tested` qua bản bổ sung, chưa accepted. Bảng gate/case phía trên phản ánh nguyên trạng recorder legacy. Lý do cố định “no Cloud Run deployment has been ordered” trong JSON không mô tả trạng thái hiện tại; không sửa JSON để thay lịch sử của recorder.
