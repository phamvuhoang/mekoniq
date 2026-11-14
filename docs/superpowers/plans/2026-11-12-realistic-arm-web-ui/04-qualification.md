# Gói 04 — Qualification và bản ghi R2a: Q01–Q02

Đọc [README](README.md) và [spec](../../specs/2026-11-12-realistic-arm-web-ui-design.md) §6.4, D70, D71 trước. Mẫu là X08 của [plan R1.1](../2026-11-10-webots-arm/01-tasks.md).

---

### Task Q01: Bảng `r2a`, recorder và guard

**Files:**
- Modify: `scripts/sim-extension-qualification.mjs`, `scripts/record-sim-extension.mjs`, `scripts/export-lab-runtime.mjs`, `tests/acceptance/sim-extension.acceptance.test.ts`
- Test: `tests/unit/sim-extension-qualification.test.ts`

**Interfaces:**
- Consumes: `qualify(input, table)`, `check(m, read, table)`, `TABLE_R11`, `GATES_R11`, kiểm REG02 (`sim-extension-qualification.mjs:101-138`), recorder R1.1 (`--release r1.1 --r1-record DIR --mock-regression DIR`).
- Produces:
  ```js
  export const GATES_R2A={'G-MA1':['MA01','MA02','MA03'],'G-MA2':['MA04','MA05','MA06','MA07','MA08'],'G-RT1':['RT01','RT02','RT03','RT04'],'G-RT2':['RT05'],
   'G-UI1':['UI01','UI02','UI03','UI04'],'G-INT4':['UI05','INT15','INT16'],'G-REG3':['REG03'],'G-CLOUD1':['CL01']};
  export const TABLE_R2A   // SUITES/CASES theo spec §6.4: mỗi case trỏ tới file test của nó ở gói 01–03
  // checkQualification: m.release==='r2a' → check(m,read,TABLE_R2A)
  // recorder: --release r2a --r11-record DIR --mock-regression DIR [--blocked G-MA1,G-MA2,G-RT2,G-INT4 --blocked-reason TEXT]
  ```
  REG03 là `tested` chỉ khi bản ghi R1.1 đưa vào là của **cùng commit**, mọi gate của nó `tested`, và nó mang bản ghi R1, IR-SIM, R-MOCK cùng commit (kiểm sha như REG02). `G-CLOUD1` luôn được ghi `blocked_external` trừ khi có file kết quả CL01. `--blocked` chỉ nhận các gate của phần A và chỉ khi `docs/research/2026-11-mujoco-arm-spike.md` kết luận TRƯỢT; gate bị chặn ghi `blocked` kèm lý do, case của nó `not_run`. Bản ghi mang `r11-record.json` (bản sao, kiểm sha).

- [ ] **Step 1: Unit fail trước:** bảng `r2a` ánh xạ đúng từng case của spec §6.4 vào gate ở Interfaces; REG03 `not_run` khi bản ghi R1.1 khác commit, `failed` khi bản ghi R1.1 có gate không `tested`; `G-CLOUD1` là `blocked_external` khi thiếu kết quả CL01 và không làm bản ghi thất bại; `--blocked G-RT1` bị từ chối; `--blocked G-MA1` khi ghi chép spike kết luận ĐẠT bị từ chối; guard từ chối `accepted:true`; suite thiếu file kết quả → `SUITE_RESULT_MISSING`; bản ghi `r1` và `r1.1` hiện có vẫn qua `checkQualification`.
- [ ] **Step 2:** Viết bảng, recorder, guard; `export-lab-runtime.mjs` đưa tool `mujoco_worker` và license của nó vào `portableSimulationTools`. `pnpm test:unit -- tests/unit/sim-extension-qualification.test.ts` xanh. Commit `feat: r2a qualification table, recorder and guard`, Lab re-pin, cả hai cây sạch.


**Đã chốt khi thực thi (lệch so với plan, ghi ngày 2026-11-13):** trong bản phát hành `r2a`, `G-CLOUD1` luôn là `blocked_external` (CL01 `not_run`, lý do: chưa có lệnh deploy); recorder và guard không có đường nào biến nó thành `tested`, và guard từ chối một bản ghi `r2a` có `G-CLOUD1` khác. Thứ tạo kết quả CL01 và định dạng bản ghi của nó thuộc phần việc deploy mà người dùng chưa ra lệnh. Mọi bản ghi nền của `r2a` (R1.1, và R1, IR-SIM, R-MOCK mà nó mang) phải cùng commit source **và** cùng commit Lab với bản ghi đang ghi. Recorder (mọi bản phát hành) kiểm môi trường trước khi chạy suite nào: Docker khi có suite container (`DOCKER_UNAVAILABLE`), venv Python cần dùng (`PYTHON_ENV_MISSING:<venv>`), và trên macOS màn hình bị khóa khi có bước mở ứng dụng Webots (`SCREEN_LOCKED`); image do recorder dựng bị xóa khi lần ghi kết thúc.

---

### Task Q02: Ghi lại các bản ghi nền và ghi `r2a-candidate-01`

**Files:**
- Evidence: `docs/implementation/evidence/linkforge-irsim/candidate-<n+1>/`, `docs/implementation/evidence/sim-extension/r1-candidate-<n+1>/`, `docs/implementation/evidence/sim-extension/r11-candidate-<n+1>/`, `docs/implementation/evidence/sim-extension/r2a-candidate-01/`; Lab: regression mới dưới `lab/docs/implementation/evidence/`
- Modify: `robotics/simulation-mujoco/README.md`, `CLAUDE.md` của workspace (đường dẫn bản ghi mới nhất, lệnh `lab:mujoco`, venv `.venv-mujoco`)

**Interfaces:**
- Consumes: recorder của Q01; chuỗi ghi của R1.1.
- Produces: bốn bản ghi cùng commit; `r2a-candidate-01/README.md`.

- [ ] **Step 1:** Cả hai cây sạch, Lab ghim đúng HEAD của source, không có `__pycache__` dưới tool root. Ghi ngoài cây, theo thứ tự, dưới `caffeinate -dims`; mỗi lệnh phải exit 0 mới chạy lệnh sau (`S` là thư mục ngoài cả hai repo, `N` là số candidate kế tiếp của từng dòng):
  ```sh
  (cd ../lab && node scripts/record-regression.mjs --suite physical-robot-lab --out $S/regression)
  node scripts/record-irsim.mjs --out $S/candidate-N --candidate-id candidate-N
  node scripts/record-sim-extension.mjs --release r1 --out $S/r1-candidate-N --candidate-id r1-candidate-N --irsim-record $S/candidate-N --mock-regression $S/regression
  node scripts/record-sim-extension.mjs --release r1.1 --out $S/r11-candidate-N --candidate-id r11-candidate-N --r1-record $S/r1-candidate-N --mock-regression $S/regression
  node scripts/record-sim-extension.mjs --release r2a --out $S/r2a-candidate-01 --candidate-id r2a-candidate-01 --r11-record $S/r11-candidate-N --mock-regression $S/regression
  ```
  Khoảng 2,5 giờ máy; Webots chiếm màn hình trong hai bước giữa. Bản ghi exit 1/2 không sửa tay: sửa nguyên nhân, ghi candidate kế tiếp.
- [ ] **Step 2:** Kiểm tay và ghi vào `$S/r2a-candidate-01/manual/`: Lab đã deploy (hoặc bản build phục vụ qua HTTPS) nối `http://127.0.0.1:4176` trên Chrome và Firefox, có ảnh hộp hỏi quyền và ảnh run `completed`; ảnh thông báo trên Safari. Chưa làm được thì ghi rõ `not_run` và lý do.
- [ ] **Step 3:** Chép năm bản ghi vào cây, xóa các candidate bị thay thế trong cùng commit, viết README cho bản ghi R2a: định danh (commit, pin Lab, bản MuJoCo, commit các repo hãng), bảng gate/case, mọi tham số `assumed`, số đo thời gian tick và tỉ lệ nhịp, mục "Không được suy ra" của spec §6.4, trạng thái `G-CLOUD1`. Chạy guard: `LAB_SIMEXT_EVIDENCE_DIR=docs/implementation/evidence/sim-extension/r2a-candidate-01 pnpm test:acceptance -- sim-extension` và `LAB_IRSIM_EVIDENCE_DIR=… pnpm test:acceptance -- linkforge-irsim`. Commit `docs: record sim-extension r2a-candidate-01 …` (source) và `docs: record … R-MOCK regression` (Lab).
- [ ] **Step 4:** Cập nhật `CLAUDE.md` của workspace và chỉ mục `docs/implementation/README.md`. Báo cáo: gate nào `tested`, gate nào `blocked`/`blocked_external`, mọi `not_run`. Không push, không deploy.

**Ghi lại sau code review (2026-11-14):** tăng số candidate của cả bốn dòng và dùng thư mục regression Lab mới. Mọi thay đổi dưới tool root, kể cả `robotics/simulation-mujoco/README.md`, phải được commit và ghim lại Lab **trước Step 1**. README của worker trỏ tới chỉ mục bằng chứng ổn định; cập nhật chỉ mục và các README của bản ghi sau khi ghi, tránh đổi closure portable khiến launcher từ chối pin. Recorder R2a từ commit `0a0d21f` đã tự tắt pytest cache provider; không cần đặt `PYTEST_ADDOPTS` để tránh lỗi cache của lần ghi trước.
