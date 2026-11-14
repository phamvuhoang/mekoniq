# r11-candidate-04 — bằng chứng sau code review R2a

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
| Bắt đầu | 2026-11-14T00:27:40.043Z |
| Kết thúc | 2026-11-14T00:31:31.250Z |

## Gate

| Gate | Trạng thái | Accepted | Case |
|---|---|---|---|
| G-WA1 | tested | false | WA01, WA02, WA03 |
| G-WA2 | tested | false | WA04, WA05, WA06, WA07, WA08 |
| G-INT3 | tested | false | INT13, INT14 |
| G-REG2 | tested | false | REG02 |

## Case

| Case | Trạng thái | Bằng chứng | Ghi chú |
|---|---|---|---|
| WA01 | tested | suite:arm-static, suite:arm-py |  |
| WA02 | tested | suite:arm-worker |  |
| WA03 | tested | suite:arm-worker, suite:arm-py |  |
| WA04 | tested | suite:arm-programs |  |
| WA05 | tested | suite:arm-bv01 |  |
| WA06 | tested | suite:arm-faults |  |
| WA07 | tested | suite:arm-bv01 |  |
| WA08 | tested | suite:arm-bv01, suite:lab-arm-unit |  |
| INT13 | tested | suite:lab-e2e-webots-coffee, suite:lab-arm-unit |  |
| INT14 | tested | suite:arm-static, suite:arm-regress, suite:arm-faults |  |
| REG02 | tested | record:linkforge-irsim, record:mock-regression, record:r1 |  |

## Suite

| Suite | Kết quả máy đọc | Log |
|---|---|---|
| arm-static | {"passed": 20, "failed": 0, "skipped": 0, "total": 20} | suites/arm-static.log |
| arm-py | {"passed": 78, "failed": 0, "skipped": 0, "total": 78} | suites/arm-py.log |
| arm-worker | {"passed": 5, "failed": 0, "skipped": 0, "total": 5} | suites/arm-worker.log |
| arm-programs | {"passed": 25, "failed": 0, "skipped": 0, "total": 25} | suites/arm-programs.log |
| arm-bv01 | {"passed": 7, "failed": 0, "skipped": 0, "total": 7} | suites/arm-bv01.log |
| arm-faults | {"passed": 11, "failed": 0, "skipped": 0, "total": 11} | suites/arm-faults.log |
| arm-regress | {"passed": 16, "failed": 0, "skipped": 0, "total": 16} | suites/arm-regress.log |
| lab-arm-unit | {"passed": 28, "failed": 0, "skipped": 0, "total": 28} | suites/lab-arm-unit.log |
| lab-e2e-webots-coffee | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-webots-coffee.log |

## Giới hạn

Webots dùng fixture `arm-ref-3d-v1` với tham số `assumed`, `not_calibrated`; gắp cốc là sự kiện trạng thái. Không suy ra lực gắp, trượt cốc, tải thật, an toàn người, LinuxCNC/MoveIt hay robot sản phẩm. MuJoCo có bản ghi R2a riêng.

Một phép đo phần mềm không đóng gate native, thiết bị hay phần cứng. Các lần chấp nhận candidate cũ không chuyển sang bản ghi này.
