# LinkForge + IR-SIM — candidate-08 (qualification portable)

Bản ghi do `scripts/record-irsim.mjs` tạo trên source `bb16724859ee8377be62389a851ac36ea4a0309a` (Lab `832c84fa0bdac2c18d44a4f102337533d1904436`, pin source `bb16724`, artifact `67a1a20cf12f7904…`; closure portable `6df2f71fc1638075…`), ghi lúc 2026-11-13T12:45:55.666Z → 13:03:47.949Z (identityStable true; Node v24.22.2, darwin 25.5.0 arm64), kiểm bằng `pnpm test:acceptance -- linkforge-irsim` (`LAB_IRSIM_EVIDENCE_DIR=<thư mục này>`). Mọi gate `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted, trong một sidecar `acceptance.json` riêng: **chưa có sidecar nào cho bản ghi này**. Bản ghi này là đầu vào REG01 của `sim-extension/r1-candidate-06`, REG02 của `sim-extension/r11-candidate-03` và REG03 của `sim-extension/r2a-candidate-01`.

Thay thế candidate-07 (ghi trên `9b8f92f`, xóa khỏi cây cùng sidecar `acceptance.json` của nó, còn trong lịch sử git; `native-handoff.md` nằm trong lịch sử của candidate-03: cổng native/hardware nằm ngoài phạm vi bản ghi này và không đổi). Lần chấp nhận của Henry ngày 2026-11-11 thuộc candidate-07 (cùng `r1-candidate-05` và `r11-candidate-02`), **không** chuyển sang bản ghi này. Ghi lại vì công việc R2a (tay máy MuJoCo, mô phỏng từ web, UI gọn) đổi runtime, và REG03 đòi bản ghi IR-SIM ghi lại trên cùng commit với `r2a-candidate-01`; không gate hay case nào đổi trạng thái.

IR07 vẫn là oracle quét độc lập (`swept_oracle`), không khẳng định va chạm rời rạc của engine; ghi chú nằm nguyên văn trong `qualification.json`.

| Gate | Trạng thái | accepted | Case |
|---|---|---|---|
| G-LF1 | tested | false | LF01 |
| G-LF2 | tested | false | LF02, LF03, LF04, LF05, LF06 |
| G-IR1 | tested | false | IR01 |
| G-IR2 | tested | false | IR04 |
| G-IR3 | tested | false | IR02, IR03, IR05, IR06, IR07, IR08, IR09, IR10 |
| G-INT1 | tested | false | INT01, INT02, INT03, INT04 |

| Suite | Pass / tổng |
|---|---|
| lf | 34 / 34 |
| lf-py | 34 / 34 |
| cmp | 29 / 29 |
| cmp-py | 40 / 40 |
| parity-py | 9 / 9 |
| ir | 77 / 77 |
| evi | 50 / 50 |
| int | 29 / 29 |
| batch | 5 / 5 |
| lab-unit | 53 / 53 |
| lab-e2e-journey | 1 / 1 |
| lab-e2e-fleet | 1 / 1 |

Campaign `c02-qualification`: 25 run, `completed`. Đo hiệu năng (`performance.json`, không phải gate): IR-FD07, 3000 tick (60 s mô phỏng), mỗi tick p50 / p95 / max 5.0 / 9.8 / 11.8 ms, realtime factor 3.16, RSS worker tối đa 121 MiB (IR-SIM 2.12.0, Python 3.11.15, Apple M2 Pro).
