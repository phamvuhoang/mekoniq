# candidate-09 — bằng chứng sau code review R2a

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
| Bắt đầu | 2026-11-13T23:43:57.221Z |
| Kết thúc | 2026-11-14T00:02:33.918Z |

## Gate

| Gate | Trạng thái | Accepted | Case |
|---|---|---|---|
| G-LF1 | tested | false | LF01 |
| G-LF2 | tested | false | LF02, LF03, LF04, LF05, LF06 |
| G-IR1 | tested | false | IR01 |
| G-IR2 | tested | false | IR04 |
| G-IR3 | tested | false | IR02, IR03, IR05, IR06, IR07, IR08, IR09, IR10 |
| G-INT1 | tested | false | INT01, INT02, INT03, INT04 |

## Case

| Case | Trạng thái | Bằng chứng | Ghi chú |
|---|---|---|---|
| LF01 | tested | suite:lf, suite:lf-py |  |
| LF02 | tested | suite:lf, suite:lf-py |  |
| LF03 | tested | suite:lf, suite:lf-py |  |
| LF04 | tested | suite:lf, suite:lf-py |  |
| LF05 | tested | suite:lf, suite:lf-py |  |
| LF06 | tested | suite:lf, suite:lf-py |  |
| CMP01 | tested | suite:cmp, suite:cmp-py, suite:parity-py |  |
| CMP02 | tested | suite:cmp, suite:cmp-py, suite:parity-py |  |
| CMP03 | tested | suite:cmp, suite:cmp-py, suite:parity-py |  |
| CMP04 | tested | suite:cmp, suite:cmp-py, suite:parity-py |  |
| CMP05 | tested | suite:cmp, suite:cmp-py, suite:parity-py |  |
| IR01 | tested | suite:ir, campaign:IR-FD01 |  |
| IR02 | tested | suite:ir, campaign:IR-FD03 |  |
| IR03 | tested | suite:ir, campaign:IR-FD04, campaign:IR-FD04-blocked |  |
| IR04 | tested | suite:ir, campaign:IR-FD07, campaign:IR-RIG-ZONE | zone contention is proven by the campaign-only rig IR-RIG-ZONE; source-driven IR-FD07 missions are serialized by the venue-movement reservation (both robots move, one at a time) |
| IR05 | tested | suite:ir, campaign:IR-FD01-cancel |  |
| IR06 | tested | suite:ir, campaign:IR-RAW-PAIR-CONTACT |  |
| IR07 | tested | suite:ir | swept_oracle only: the independent swept check finds a thin wall crossed between two ticks; the real plant caps \|v\| at 0.5 m/s (1 cm per 20 ms tick against a 0.6 m footprint) so tunnelling cannot be produced there and no engine discrete collision is claimed |
| IR08 | tested | suite:ir, suite:cmp-py, campaign:IR-FD01 |  |
| IR09 | tested | suite:ir, suite:cmp-py, campaign:IR-FD01 |  |
| IR10 | tested | suite:ir, campaign:IR-FD01-workerkill |  |
| SEN01 | tested | suite:cmp-py, suite:ir |  |
| SEN02 | tested | suite:cmp-py, suite:ir |  |
| EVI01 | tested | suite:evi |  |
| EVI02 | tested | suite:evi |  |
| EVI03 | tested | suite:evi |  |
| INT01 | tested | suite:lab-e2e-journey, suite:lab-e2e-fleet |  |
| INT02 | tested | suite:int, suite:lab-unit |  |
| INT03 | tested | suite:int, suite:batch, campaign:* |  |
| INT04 | tested | suite:lab-e2e-journey, suite:lab-e2e-fleet |  |

## Suite

| Suite | Kết quả máy đọc | Log |
|---|---|---|
| lf | {"passed": 34, "failed": 0, "skipped": 0, "total": 34} | suites/lf.log |
| lf-py | {"passed": 34, "failed": 0, "skipped": 0, "total": 34} | suites/lf-py.log |
| cmp | {"passed": 29, "failed": 0, "skipped": 0, "total": 29} | suites/cmp.log |
| cmp-py | {"passed": 40, "failed": 0, "skipped": 0, "total": 40} | suites/cmp-py.log |
| parity-py | {"passed": 9, "failed": 0, "skipped": 0, "total": 9} | suites/parity-py.log |
| ir | {"passed": 77, "failed": 0, "skipped": 0, "total": 77} | suites/ir.log |
| evi | {"passed": 50, "failed": 0, "skipped": 0, "total": 50} | suites/evi.log |
| int | {"passed": 29, "failed": 0, "skipped": 0, "total": 29} | suites/int.log |
| batch | {"passed": 5, "failed": 0, "skipped": 0, "total": 5} | suites/batch.log |
| lab-unit | {"passed": 53, "failed": 0, "skipped": 0, "total": 53} | suites/lab-unit.log |
| lab-e2e-journey | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-journey.log |
| lab-e2e-fleet | {"passed": 1, "failed": 0, "skipped": 0, "total": 1} | suites/lab-e2e-fleet.log |

## Giới hạn

IR07 vẫn là oracle quét độc lập (`swept_oracle`); không suy ra khả năng phát hiện va chạm rời rạc của engine. LinkForge là shadow validator; mọi gate native và phần cứng vẫn ngoài phạm vi.

Một phép đo phần mềm không đóng gate native, thiết bị hay phần cứng. Các lần chấp nhận candidate cũ không chuyển sang bản ghi này.
