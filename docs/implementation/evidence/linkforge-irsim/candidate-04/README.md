# LinkForge + IR-SIM — candidate-04 (qualification portable)

Bản ghi do `scripts/record-irsim.mjs` tạo trên source `d14d831f6903d0cd1f8dc3db8258cb4425ab9cfe`, kiểm bằng `pnpm test:acceptance -- linkforge-irsim` (`LAB_IRSIM_EVIDENCE_DIR=<thư mục này>`). Thay thế candidate-03 (xóa khỏi cây, còn trong lịch sử git cùng `native-handoff.md`: cổng native/hardware nằm ngoài phạm vi bản ghi này và không đổi). Mọi gate `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted. Bản ghi này là đầu vào REG01 của `sim-extension/r1-candidate-01`.

IR07 vẫn là oracle quét độc lập (`swept_oracle`), không khẳng định va chạm rời rạc của engine; ghi chú nằm nguyên văn trong `qualification.json`.

| Gate | Trạng thái | accepted | Case |
|---|---|---|---|
| G-LF1 | tested | false | LF01 |
| G-LF2 | tested | false | LF02, LF03, LF04, LF05, LF06 |
| G-IR1 | tested | false | IR01 |
| G-IR2 | tested | false | IR04 |
| G-IR3 | tested | false | IR02, IR03, IR05, IR06, IR07, IR08, IR09, IR10 |
| G-INT1 | tested | false | INT01, INT02, INT03, INT04 |
