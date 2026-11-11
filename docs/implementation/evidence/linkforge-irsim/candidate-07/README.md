# LinkForge + IR-SIM — candidate-07 (qualification portable)

Bản ghi do `scripts/record-irsim.mjs` tạo trên source `9b8f92f1c76cd7283030e46adf93f2d6527cb4bd`, kiểm bằng `pnpm test:acceptance -- linkforge-irsim` (`LAB_IRSIM_EVIDENCE_DIR=<thư mục này>`). Thay thế candidate-06 (ghi trên `fa857d9`, xóa khỏi cây, còn trong lịch sử git; chưa từng có sidecar acceptance; `native-handoff.md` nằm trong lịch sử của candidate-03: cổng native/hardware nằm ngoài phạm vi bản ghi này và không đổi). Ghi lại vì sau review R1.1 runtime đổi ở commit `9b8f92f` (readiness không smoke run đang giữ engine; seed engine ghi đúng giá trị engine nhận; tay máy dừng thì giữ nguyên vị trí thực); không gate hay case nào đổi trạng thái. Mọi gate `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted: reviewer Henry đã chấp nhận sáu gate ngày 2026-11-11 trong sidecar `acceptance.json`. Bản ghi này là đầu vào REG01 của `sim-extension/r1-candidate-05` và REG02 của `sim-extension/r11-candidate-02`.

IR07 vẫn là oracle quét độc lập (`swept_oracle`), không khẳng định va chạm rời rạc của engine; ghi chú nằm nguyên văn trong `qualification.json`.

| Gate | Trạng thái | accepted | Case |
|---|---|---|---|
| G-LF1 | tested | false | LF01 |
| G-LF2 | tested | false | LF02, LF03, LF04, LF05, LF06 |
| G-IR1 | tested | false | IR01 |
| G-IR2 | tested | false | IR04 |
| G-IR3 | tested | false | IR02, IR03, IR05, IR06, IR07, IR08, IR09, IR10 |
| G-INT1 | tested | false | INT01, INT02, INT03, INT04 |
