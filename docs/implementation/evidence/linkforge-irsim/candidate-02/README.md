# LinkForge + IR-SIM — candidate-02 (qualification portable)

Bằng chứng do `source/scripts/record-irsim.mjs` ghi, kiểm bằng guard `pnpm test:acceptance -- linkforge-irsim` (`LAB_IRSIM_EVIDENCE_DIR=<thư mục này>`). Mọi gate mới ở trạng thái `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted. Native/hardware: xem [native-handoff.md](native-handoff.md).

## Định danh

| | Giá trị |
|---|---|
| Source commit | `fc21c1ee700499e624f229f9e336efeb88f2c7e7` (sạch; closure portable `d383331a0abae825…`, native `11814623733136e8…`) |
| Lab commit / pin | `da43998ea42f51a7b01bfcd9929a01104a6670ef` / pin source `fc21c1e`, artifact `fc8542864110c591…`, schema `e71730bb20e21310…` |
| Portable tools digest | `d383331a0abae82527ce3f58782ddb225d79a4defa38a3fdf37a0e771ea2210b` |
| Candidate id | candidate-02 |
| Ghi lúc | 2026-11-09T12:16:49.423Z → 2026-11-09T12:35:12.318Z (identityStable true; Node v24.22.2, darwin 25.5.0 arm64) |

## Kết quả

### Gate (chỉ reviewer mới ghi accepted)

| Gate | Trạng thái | accepted | Case |
|---|---|---|---|
| G-LF1 | tested | false | LF01 |
| G-LF2 | tested | false | LF02, LF03, LF04, LF05, LF06 |
| G-IR1 | tested | false | IR01 |
| G-IR2 | tested | false | IR04 |
| G-IR3 | not_run | false | IR02, IR03, IR05, IR06, IR07, IR08, IR09, IR10 |
| G-INT1 | tested | false | INT01, INT02, INT03, INT04 |

G-IR3 là `not_run` **theo thiết kế của bộ ghi**: một gate chỉ `tested` khi mọi case của nó `tested`, và IR07 là `not_run` có lý do (xem bảng case); 7 case còn lại của G-IR3 đều `tested`. Reviewer độc lập (2026-11-09) lưu ý rằng spec §3 IR07 chấp nhận "oracle quét độc lập **hoặc** command guard phát hiện", và unit test `swept_oracle` (suite `ir`) đáp ứng mức đó; đọc IR07 là `tested` kèm ghi chú (như IR04) sẽ làm G-IR3 `tested`. Đây là quyết định đảo ruling C02 nên để reviewer con người quyết; bản ghi hiện tại chọn cách **không nói quá**.

### Case (verification.md §3)

| Case | Trạng thái | Bằng chứng | Lý do not_run |
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
| IR04 | tested | suite:ir, campaign:IR-FD07, campaign:IR-RIG-ZONE |  |
| IR05 | tested | suite:ir, campaign:IR-FD01-cancel |  |
| IR06 | tested | suite:ir, campaign:IR-RAW-PAIR-CONTACT |  |
| IR07 | not_run | — | thin-wall tunnelling cannot be produced on the real plant: the worker caps /v/ at 0.5 m/s (1 cm per 20 ms tick against a 0.6 m footprint); covered by the B03 swept-oracle unit tests only |
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

### Campaign `c02-qualification` (provider `irsim_2d`, 25 run, status `completed`, complete true)

| Run | Scenario | Fixture | Seed | Kết quả | Outcome |
|---|---|---|---|---|---|
| 001-IR-FD01-serve-demo-v1-s11-r1 | IR-FD01 | serve-demo-v1 | 11 | pass | completed / tick 2706 |
| 002-IR-FD01-serve-demo-v1-s11-r2 | IR-FD01 | serve-demo-v1 | 11 | pass | completed / tick 2706 |
| 003-IR-FD01-serve-demo-v1-s11-r3 | IR-FD01 | serve-demo-v1 | 11 | pass | completed / tick 2706 |
| 004-IR-FD01-serve-noisy-v1-s11-r1 | IR-FD01 | serve-noisy-v1 | 11 | pass | completed / tick 2706 |
| 005-IR-FD01-serve-noisy-v1-s11-r2 | IR-FD01 | serve-noisy-v1 | 11 | pass | completed / tick 2706 |
| 006-IR-FD01-serve-noisy-v1-s11-r3 | IR-FD01 | serve-noisy-v1 | 11 | pass | completed / tick 2706 |
| 007-IR-FD01-serve-demo-v1-s12-r1 | IR-FD01 | serve-demo-v1 | 12 | pass | completed / tick 2945 |
| 008-IR-FD01-serve-demo-v1-s13-r1 | IR-FD01 | serve-demo-v1 | 13 | pass | completed / tick 2735 |
| 009-IR-FD01-serve-demo-v1-s14-r1 | IR-FD01 | serve-demo-v1 | 14 | pass | completed / tick 2897 |
| 010-IR-FD01-serve-demo-v1-s15-r1 | IR-FD01 | serve-demo-v1 | 15 | pass | completed / tick 2702 |
| 011-IR-FD01-serve-demo-v1-s16-r1 | IR-FD01 | serve-demo-v1 | 16 | pass | completed / tick 3053 |
| 012-IR-FD01-serve-demo-v1-s17-r1 | IR-FD01 | serve-demo-v1 | 17 | pass | completed / tick 2686 |
| 013-IR-FD01-serve-demo-v1-s18-r1 | IR-FD01 | serve-demo-v1 | 18 | pass | completed / tick 3046 |
| 014-IR-FD01-serve-demo-v1-s19-r1 | IR-FD01 | serve-demo-v1 | 19 | pass | completed / tick 2719 |
| 015-IR-FD03-serve-demo-v1-s21-r1 | IR-FD03 | serve-demo-v1 | 21 | pass | completed / tick 3119 |
| 016-IR-FD03-serve-demo-v1-s21-r2 | IR-FD03 | serve-demo-v1 | 21 | pass | completed / tick 3119 |
| 017-IR-FD04-serve-enclosed-v1-s22-r1 | IR-FD04 | serve-enclosed-v1 | 22 | pass | needs_attention / tick 876 |
| 018-IR-FD04-blocked-serve-demo-v1-s23-r1 | IR-FD04-blocked | serve-demo-v1 | 23 | pass | needs_attention / tick 1736 |
| 019-IR-FD07-serve-fleet-v1-s31-r1 | IR-FD07 | serve-fleet-v1 | 31 | pass | completed / tick 5920 |
| 020-IR-FD07-serve-fleet-v1-s31-r2 | IR-FD07 | serve-fleet-v1 | 31 | pass | completed / tick 5920 |
| 021-IR-RIG-ZONE-serve-fleet-v1-s32-r1 | IR-RIG-ZONE | serve-fleet-v1 | 32 | pass | completed / tick 1676 |
| 022-IR-RIG-ZONE-serve-fleet-v1-s32-r2 | IR-RIG-ZONE | serve-fleet-v1 | 32 | pass | completed / tick 1676 |
| 023-IR-FD01-cancel-serve-demo-v1-s33-r1 | IR-FD01-cancel | serve-demo-v1 | 33 | pass | cancelled / tick 424 |
| 024-IR-FD01-workerkill-serve-demo-v1-s34-r1 | IR-FD01-workerkill | serve-demo-v1 | 34 | pass | needs_attention / tick 1250 |
| 025-IR-RAW-PAIR-CONTACT-serve-fleet-v1-s35-r1 | IR-RAW-PAIR-CONTACT | serve-fleet-v1 | 35 | pass | — (raw drive, chỉ assertions.json) |

Kiểm lại: `node scripts/lab-irsim.mjs verify --input <thư mục này>/campaign` (exit 0 khi mọi run.json/report khớp digest). INT03 (hai world song song, concurrency 2, số tiến trình con trở về baseline) nằm trong suite `batch`, không phải trong campaign này (campaign chạy concurrency 1).

### Suite

| Suite | Repo | Loại | Exit | Tóm tắt |
|---|---|---|---|---|
| lf | source | vitest | 0 | passed 34, failed 0, skipped 0, total 34 |
| lf-py | source | pytest | 0 | passed 34, failed 0, skipped 0, total 34 |
| cmp | source | vitest | 0 | passed 29, failed 0, skipped 0, total 29 |
| cmp-py | source | pytest | 0 | passed 40, failed 0, skipped 0, total 40 |
| parity-py | source | pytest | 0 | passed 9, failed 0, skipped 0, total 9 |
| ir | source | vitest | 0 | passed 77, failed 0, skipped 0, total 77 |
| evi | source | vitest | 0 | passed 48, failed 0, skipped 0, total 48 |
| int | source | vitest | 0 | passed 28, failed 0, skipped 0, total 28 |
| batch | source | vitest | 0 | passed 5, failed 0, skipped 0, total 5 |
| lab-unit | lab | vitest | 0 | passed 51, failed 0, skipped 0, total 51 |
| lab-e2e-journey | lab | playwright | 0 | passed 1, failed 0, skipped 0, total 1 |
| lab-e2e-fleet | lab | playwright | 0 | passed 1, failed 0, skipped 0, total 1 |

Lệnh: `licenses` (`portable-licenses.mjs --check`, exit 0), `performance` (`measure-irsim.mjs`, exit 0).

### Hiệu năng (performance.json; host Apple M2 Pro, 10 CPU, 16 GiB, Python 3.11.15, IR-SIM 2.12.0)

| Chỉ số | Giá trị | Mục tiêu | Đạt |
|---|---|---|---|
| per-tick p50 / p95 / max (ms) | 5.14 / 9.72 / 11.38 | p95 ≤ 20 | true |
| realtime factor (tổng simMs/wallMs, không phải median) | 3.30 | ≥ 1 | true |
| worker RSS max (MiB) | 121.7 | ≤ 1024 | true |

Workload: IR-FD07 trên serve-fleet-v1, 3000 tick (60 s mô phỏng), 2 robot (robot01 360 tia, robot02 180 tia; spec tham chiếu nói 360 tia mỗi robot — robot02 ở đây 180 tia theo fixture). Đo trên một host; không phải baseline chu kỳ vật lý.

### Ảnh chụp (INT04, 18 ảnh, `screens/`)
`irsim-{assembly-validated,twin-completed,twin-replay}-{desktop,tablet}-{vi,ja,en}.png` — bằng chứng UI, không phải bằng chứng backend.

## Cách kiểm lại

```sh
# từ source/
LAB_IRSIM_EVIDENCE_DIR=docs/implementation/evidence/linkforge-irsim/candidate-02 pnpm test:acceptance -- linkforge-irsim
node scripts/lab-irsim.mjs verify --input docs/implementation/evidence/linkforge-irsim/candidate-02/campaign
# từ source/, regression Lab (R-MOCK guard, báo SOURCE_REVISION_STALE sau khi commit evidence — đúng thiết kế)
LAB_V2_REGRESSION_DIR=../lab/docs/implementation/evidence/linkforge-irsim/candidate-02/regression LAB_V2_REQUIRE_LAB_FIXTURES=1 pnpm exec vitest run tests/acceptance/lab-v2-mock.acceptance.test.ts
```

## Giới hạn

- Mọi gate mới chỉ `tested`; `accepted:false`, `acceptedBy:null`. Reviewer xác nhận package (traceability, report/replay, ảnh, identity sạch, lock/license, rollback, blocker ngoài) rồi mới ghi accepted — guard từ chối `accepted:true` không có `acceptedBy`.
- IR07 `not_run`: plant giới hạn |v| ≤ 0.5 m/s (1 cm/tick với footprint 0.6 m); chỉ có unit test oracle quét (xem ghi chú G-IR3 ở trên).
- Không phải bằng chứng cho Gazebo/Nav2, MoveIt2/LinuxCNC, calibration, khoảng dừng vật lý, cảm biến thật, lặp lại bitwise xuyên nền tảng, phần cứng hay venue. Xem [native-handoff.md](native-handoff.md).
- Regression Lab (physical-robot-lab, 18 bước, guard R-MOCK 41/41) được ghi tại Lab `c35b93c` / pin source `37b9e8a`; các commit source sau đó chỉ đổi recorder/guard/test và một sửa lỗi trong `worker-client.ts` (close() không còn chờ pipe stdio) — artifact runtime đổi hash, schema và portable tools digest không đổi. Không ghi lại; reviewer muốn bản ghi đúng commit thì chạy lại recorder (~15 phút).
- candidate-01 (source 594b8e7) đã bị thay thế: nó ghi INT03/G-INT1 `tested` mà chưa có bằng chứng concurrency 2, và guard siết chặt từ chối nó (`SUITE_MISSING:batch`). Còn trong lịch sử git.
- R-MOCK, R-SIM, G-SIM-*, G-HW-* giữ nguyên trạng thái trong `lab/config/simulation-compatibility.json`.
