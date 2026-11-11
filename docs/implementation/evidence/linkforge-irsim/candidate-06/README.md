# LinkForge + IR-SIM — candidate-06 (qualification portable)

Bản ghi do `scripts/record-irsim.mjs` tạo trên source `fa857d9bb1899e08c5e4f872ee9f3f3ef95fda08`, kiểm bằng `pnpm test:acceptance -- linkforge-irsim` (`LAB_IRSIM_EVIDENCE_DIR=<thư mục này>`). Thay thế candidate-05 (ghi trên `285bf53`, xóa khỏi cây, còn trong lịch sử git; `native-handoff.md` nằm trong lịch sử của candidate-03: cổng native/hardware nằm ngoài phạm vi bản ghi này và không đổi). Ghi lại vì closure portable và schema đổi ở R1.1 (D32); không gate hay case nào đổi trạng thái. Mọi gate `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted. Bản ghi này là đầu vào REG01 của `sim-extension/r1-candidate-03` và REG02 của `sim-extension/r11-candidate-01`. Bản ghi của candidate-05 và sidecar `acceptance.json` của nó nằm trong lịch sử git; candidate-06 **chưa được reviewer chấp nhận** (không có sidecar).

IR07 vẫn là oracle quét độc lập (`swept_oracle`), không khẳng định va chạm rời rạc của engine; ghi chú nằm nguyên văn trong `qualification.json`.

| Gate | Trạng thái | accepted | Case |
|---|---|---|---|
| G-LF1 | tested | false | LF01 |
| G-LF2 | tested | false | LF02, LF03, LF04, LF05, LF06 |
| G-IR1 | tested | false | IR01 |
| G-IR2 | tested | false | IR04 |
| G-IR3 | tested | false | IR02, IR03, IR05, IR06, IR07, IR08, IR09, IR10 |
| G-INT1 | tested | false | INT01, INT02, INT03, INT04 |
