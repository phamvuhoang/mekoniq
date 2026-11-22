# Handover V16 — sau V15 (22/11/2026)

R4.1–R4.5 xong phần phần mềm trên nhánh `r4/virtual-commissioning` của hai repo; chưa push, chưa deploy, mọi record `accepted:false`. V16 (qualification R4, regression chuỗi, G-CLOUD2) chưa bắt đầu.

## Checkpoint

| Thành phần | Revision |
|---|---|
| Source | `a01c2a75` (sửa review V14–V15, R01–R09) trên `5d016ddf` (R4.5: V14 + V15); `c1a79540` (sửa verifier study); evidence study ở `0a32b3cd` |
| Lab | HEAD = commit sửa review (pin `a01c2a75`); `b74beda` (UI + pin `5d016ddf`); `6003474` (pin `c1a79540`) |
| Study `perception-gap-v1` | 92/92, verify exit 0 ở `c1a79540`; raw `robot/evidence-archive/r4-perception-gap-v1-c1a79540/`; tóm tắt `source/docs/implementation/evidence/virtual-commissioning/v12-perception-gap-c1a79540-2026-11-22/` (bản `def9c240` đã `SUPERSEDED.md`) |

**Cho V16:** study được ghi ở tuple `c1a79540`, còn runtime hiện tại là `5d016ddf`; V16 ghi lại chuỗi ở tuple cuối cùng của nó nên không cần dùng lại số này. Nội dung chi tiết, rulings, số đo: [LEDGER-v14-v15.md](LEDGER-v14-v15.md) và [LEDGER-v11-v13.md](LEDGER-v11-v13.md).

## R4.5 làm được và không làm được
- Nhập log đo (CSV + sidecar, fail-closed), dự đoán từ bench headless, nhận dạng có biên, revision mới chỉ cho bản ghi đo thật + đạt validation + trong biên + tách được tham số; mức model theo nhóm trong health, manifest của bench report và Lab.
- G-CAL1 (tự kiểm công cụ): quán tính rotor J3 và cản khớp phục hồi trong 0,3 % / 0,5 % (dung sai 5 % khai trước). **`torque.scale` chưa được chứng minh** (ruling 7). G3 vẫn `not_run`; chưa có revision `calibrated` nào; mọi nhóm của cả hai plant là `assumed`.
- Gate R4.5 cho V16: truyền `--calibration-selftest` chỉ khi có artifact tự kiểm đã ghi; chưa có recorder cho nó (V16 viết). Không truyền thì G-CAL1 `not_run` (`r45_not_opened`) và không chặn đóng R4.

## Chặn / chưa làm
- Giữ nguyên từ HANDOVER-v14: REC06 (không có lực nudge nào cho kẹp hụt mà cốc còn trong tầm nhìn), WEB10 mẫu `belief-recovery` (quyết định: bỏ, hay sinh bằng harness với nhãn không tái lập được từ web), CLD01 R4.4 ca đã viết / CLD02 chưa chạy (`docker_daemon_down`), CLD03 `deploy_order_pending`.
- V16 còn: bảng CASES/GATES R4, recorder `record-sim-extension-r4.mjs`, WEB07–WEB09, chuỗi regression (Lab → IR-SIM → r1 → r1.1 → r2a → r2b → campaign R4 → r4), `r4-qualification.md`, đề xuất cập nhật `CLAUDE.md`.
- Đã lưu ý: `tests/unit/{web-replay-capture,cell-campaign-actual-reader}` cần `MEKONIQ_RETAINED_INPUTS` (môi trường).

## Giữ
Python `-B`, `PYTHONDONTWRITEBYTECODE=1`, `-p no:cacheprovider`; một spec e2e một launcher (`mujoco-*.spec.ts`, `--ui-port 42455 --runtime-port 42456`); campaign cần cây sạch (worktree sạch, symlink `node_modules`, `apps/*/node_modules` và `.venv-mujoco`); export runtime cần cây sạch.
