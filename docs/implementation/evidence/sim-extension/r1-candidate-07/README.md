# r1-candidate-07 — bằng chứng sau code review R2a

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
| Bắt đầu | 2026-11-14T00:02:34.888Z |
| Kết thúc | 2026-11-14T00:27:38.779Z |

## Gate

| Gate | Trạng thái | Accepted | Case |
|---|---|---|---|
| G-ALG1 | tested | false | ALG01, ALG02, ALG03, ALG05 |
| G-ALG2 | tested | false | PID01, PID02, PID03 |
| G-WB1 | tested | false | WB01, WB02, WB08 |
| G-WB2 | tested | false | WB03, WB04, WB05, WB06, WB07 |
| G-INT2 | tested | false | INT11, INT12 |
| G-REG1 | tested | false | REG01 |

## Case

| Case | Trạng thái | Bằng chứng | Ghi chú |
|---|---|---|---|
| ALG01 | tested | suite:alg-ts, suite:alg-py, algorithm:ALG01 |  |
| ALG02 | tested | suite:alg-ts, suite:alg-py, algorithm:ALG02 |  |
| ALG03 | tested | suite:alg-ts, suite:alg-py, algorithm:ALG03 |  |
| ALG05 | tested | suite:alg-ts, suite:alg-py, algorithm:ALG05 |  |
| ALG04 | not_run |  | R3: the joint trace needs a running LinuxCNC bridge |
| PID01 | tested | suite:alg-ts, suite:alg-py, algorithm:PID01 |  |
| PID02 | tested | suite:alg-ts, suite:alg-py, algorithm:PID02 |  |
| PID03 | tested | suite:alg-ts, suite:alg-py, algorithm:PID03 |  |
| WB01 | tested | suite:wb-static, suite:wb-py, suite:wb-worker |  |
| WB02 | tested | suite:wb-static, suite:wb-py, suite:wb-worker |  |
| WB08 | tested | suite:wb-py, suite:wb-worker |  |
| WB03 | tested | suite:wb-mission, campaign:WB-FD01 |  |
| WB04 | tested | suite:wb-fleet, campaign:WB-FD07 | source-driven WB-FD07 missions are serialized by the __venue_movement__ reservation (both robots move, one at a time); there is no zone-contention rig for Webots in Release 1, so zone contention is not proven here |
| WB05 | tested | suite:wb-faults, campaign:WB-FD01-cancel, campaign:WB-FD01-enginekill |  |
| WB06 | tested | suite:wb-evidence, suite:wb-batch, campaign:WB-FD01, campaign:WB-FD07 |  |
| WB07 | tested | suite:wb-evidence, campaign:WB-FD01, campaign:WB-FD07 |  |
| INT11 | tested | suite:lab-e2e-webots-journey, suite:lab-e2e-webots-fleet |  |
| INT12 | tested | suite:wb-worker, suite:int-regress, suite:lab-unit |  |
| REG01 | tested | suite:int-regress, record:linkforge-irsim, record:mock-regression |  |

## Suite

| Suite | Kết quả máy đọc | Log |
|---|---|---|
| alg-ts | {"passed": 26, "failed": 0, "skipped": 0, "total": 26} | suites/alg-ts.log |
| alg-py | {"passed": 16, "failed": 0, "skipped": 0, "total": 16} | suites/alg-py.log |
| wb-static | {"passed": 25, "failed": 0, "skipped": 0, "total": 25} | suites/wb-static.log |
| wb-py | {"passed": 78, "failed": 0, "skipped": 0, "total": 78} | suites/wb-py.log |
| wb-worker | {"passed": 14, "failed": 0, "skipped": 0, "total": 14} | suites/wb-worker.log |
| wb-mission | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/wb-mission.log |
| wb-fleet | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/wb-fleet.log |
| wb-faults | {"passed": 10, "failed": 0, "skipped": 0, "total": 10} | suites/wb-faults.log |
| wb-evidence | {"passed": 2, "failed": 0, "skipped": 0, "total": 2} | suites/wb-evidence.log |
| wb-batch | {"passed": 4, "failed": 0, "skipped": 0, "total": 4} | suites/wb-batch.log |
| int-regress | {"passed": 52, "failed": 0, "skipped": 0, "total": 52} | suites/int-regress.log |
| lab-unit | {"passed": 38, "failed": 0, "skipped": 0, "total": 38} | suites/lab-unit.log |
| lab-e2e-webots-journey | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-webots-journey.log |
| lab-e2e-webots-fleet | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-webots-fleet.log |

## Giới hạn

Các tham số vật lý của plant 3D và mô hình PID là `assumed`, chưa hiệu chuẩn. ALG04 thuộc R3 và còn `not_run`; kết quả không xác nhận drive, robot thật hay bridge LinuxCNC.

Một phép đo phần mềm không đóng gate native, thiết bị hay phần cứng. Các lần chấp nhận candidate cũ không chuyển sang bản ghi này.
