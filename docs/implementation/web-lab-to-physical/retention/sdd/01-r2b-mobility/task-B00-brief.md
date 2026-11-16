# Task brief B00

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/01-r2b-mobility.md

## Global Constraints

- Chỉ bắt đầu implementation phụ thuộc R2a sau B00; không sửa spec/plan/code R2a trong lần soạn tài liệu này.
- Node 24.22.2; pnpm 10.32.1; portable workers Python 3.11; `PYTHONDONTWRITEBYTECODE=1` khi chạy pytest. Python ROS dùng bản của profile distro, không ép rclpy vào venv portable.
- Nền vật lý là engine pin của R2a đã bàn giao; snapshot nghiên cứu là `mujoco==3.17.0`. Không tự nâng lock ở B02.
- Một logical tick 20 ms; 10 substeps × 2 ms là baseline MuJoCo; tốc độ UI chỉ thay pacing.
- Source là authority mission/journal/custody, Lab chỉ simulation/replay. Không thêm Lab→hardware route.
- Một active world MuJoCo/runtime; một ACK đang bay; lost ACK → unknown, không resend hoặc respawn tiếp tục cùng run.
- New fields optional/versioned; mock BV01 golden, IR-SIM chunks, Webots bytes, archive readers và R2a behaviors giữ theo baseline.
- Geometry/units SI và frame đúng contract; dynamics `not_calibrated`; vendor files có commit/sha256/license/NOTICE.
- UI dùng `tr(vi,ja,en)`, giữ a11y/reduced-motion/2D/no-runtime path; không thêm framework/browser engine.
- Không sửa `trial/`, `web/`, cổng 1880/1884, runtime data hoặc evidence lịch sử để vượt gate.
- Mỗi mutation ở đúng repo; source runtime/schema/tool commit → export sạch → Lab re-pin commit. Không Git ở workspace root.
- Candidate tự động luôn `accepted:false`; human sidecar gắn hash/profile; skip là not_run.
- Task chuẩn bị không deploy, provision host trả phí, ký commissioning thật hoặc chạy robot. Các hành động đó cần đích/phạm vi người dùng giao khi thực thi.

## Execution context
All source/ and lab/ paths are relative to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/. Never edit original main checkouts. Read specs at /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical. User authorized implementation on new worktrees on 2026-11-14; original doc-only wording refers to authoring, not current authorization. No push/deploy/native hardware execution. Use Node 24.22.2 and PYTEST_ADDOPTS="-p no:cacheprovider" with PYTHONDONTWRITEBYTECODE=1 for workers.

## Task B00 — Khóa baseline sau R2a

**Files:** Create `source/docs/implementation/post-r2a-baseline.md` khi R2a đã bàn giao; không sửa candidate R2a. Read `source/scripts/record-sim-extension.mjs`, `lab/config/source-runtime.lock.json`, R2a candidate và các acceptance sidecar.

**Interfaces:** consumes release tuple R2a; produces baseline gồm source/Lab/pin/schema/closure/engine/fixture/golden digests, gate status và open limitations. Không có runtime API mới.

- [ ] Chụp trạng thái và HEAD từng repo; ghi actual tuple, không copy `5e3029e` từ tài liệu nghiên cứu.
- [ ] Đọc qualification cuối và guard bằng command hiện có; kiểm pin Lab cùng source và record source/Lab đúng tuple. Thiếu R2a candidate: giữ trạng thái chưa bàn giao, chỉ làm tài liệu độc lập.
- [ ] Đọc golden tests hiện có và ghi tên/hashes; không tạo golden từ output sau refactor.
- [ ] Ghi những khác biệt mới với research snapshot, đặc biệt schema, clock/substeps, slip, image và arm ports.
- [ ] Commit riêng tài liệu baseline sau khi R2a không còn đang record. Không tự đưa candidate nghiên cứu thành accepted.

```sh
git -C source status --short
git -C lab status --short
git -C source rev-parse HEAD
git -C lab rev-parse HEAD
# Cwd source; LAB_SIMEXT_EVIDENCE_DIR do người thực thi đặt vào candidate R2a thực vừa đọc.
perl -e 'alarm 180; exec @ARGV' pnpm test:acceptance -- sim-extension
```

**Exit:** baseline review được; các gate thiếu phân rõ task nào bị chặn. R2a hoàn thành từng phần không đủ mở B05/B06 nếu arm chưa tested.

