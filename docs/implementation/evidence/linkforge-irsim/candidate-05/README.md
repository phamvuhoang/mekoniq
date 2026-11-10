# LinkForge + IR-SIM — candidate-05 (qualification portable)

Bản ghi do `scripts/record-irsim.mjs` tạo trên source `285bf53d18f7fc53ff6c46dfadb6a952395d86c1`, kiểm bằng `pnpm test:acceptance -- linkforge-irsim` (`LAB_IRSIM_EVIDENCE_DIR=<thư mục này>`). Thay thế candidate-04 (xóa khỏi cây, còn trong lịch sử git; `native-handoff.md` nằm trong lịch sử của candidate-03: cổng native/hardware nằm ngoài phạm vi bản ghi này và không đổi). Mọi gate `tested`, **`accepted: false`**; chỉ reviewer mới ghi accepted. Bản ghi này là đầu vào REG01 của `sim-extension/r1-candidate-02`.

IR07 vẫn là oracle quét độc lập (`swept_oracle`), không khẳng định va chạm rời rạc của engine; ghi chú nằm nguyên văn trong `qualification.json`.

| Gate | Trạng thái | accepted | Case |
|---|---|---|---|
| G-LF1 | tested | false | LF01 |
| G-LF2 | tested | false | LF02, LF03, LF04, LF05, LF06 |
| G-IR1 | tested | false | IR01 |
| G-IR2 | tested | false | IR04 |
| G-IR3 | tested | false | IR02, IR03, IR05, IR06, IR07, IR08, IR09, IR10 |
| G-INT1 | tested | false | INT01, INT02, INT03, INT04 |
