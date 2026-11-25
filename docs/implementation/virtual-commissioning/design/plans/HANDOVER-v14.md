# Handover V14 — sau V13 (21/11/2026)

> **Đã thay checkpoint (22/11):** V14–V15 đã làm và V11–V13 được sửa lần hai sau review `REVIEW-v11-v13-2026-11-22.md`; xem [HANDOVER-v16.md](HANDOVER-v16.md). Phần dưới giữ nguyên như lịch sử của thời điểm 21/11.

**R4.4 (V11–V13) xong phần phần mềm** trên nhánh `r4/virtual-commissioning` của hai repo; chưa push, chưa deploy, mọi record `accepted:false`. Chi tiết, rulings, số đo và việc chặn: [LEDGER-v11-v13.md](LEDGER-v11-v13.md).

## Checkpoint

| Thành phần | Revision |
|---|---|
| Source (runtime) | `def9c240` (V11 `5c28b38a`, V12 `cedda186`, V13 `a358cf90`, sửa sau review `def9c240`); HEAD `a17c38e6` (chỉ thêm evidence) |
| Lab | pin `89fe293` (pin `def9c240`), HEAD `89fe293`; UI V12–V13 ở `312b645`, `ea7eae0` |
| Study `perception-gap-v1` | 92/92, verify exit 0 ở `def9c240`; raw `robot/evidence-archive/r4-perception-gap-v1-def9c240/`; tóm tắt `source/docs/implementation/evidence/virtual-commissioning/v12-perception-gap-def9c240-2026-11-21/` (bản `cedda186` đã bị thay thế, có `SUPERSEDED.md`) |

Review cuối (reviewer độc lập) và đợt sửa `def9c240`: xem mục "Final review" trong [LEDGER-v11-v13.md](LEDGER-v11-v13.md). Các Important đã sửa test-first: cam kết ở lúc bắt đầu hạ (không phải lúc bắt đầu job), số liệu study lấy từ report, phục hồi không làm sập run, retry không bỏ qua approach, verifier ràng buộc profile/run/commit/nudge.

## Đã chạy trên engine thật (ở `def9c240`)
21/21 ca tích hợp: BEL (belief_ground_truth seed 7 phục vụ 2; từ chối `BELIEF_OUT_OF_REGION`/`BELIEF_STALE` trước mọi chuyển động), rig 20 mm + study, REC01 (phục hồi thành công), REC02 (`RECOVERY_EXHAUSTED`), REC04 (cốc bị đẩy khỏi giá → `RECOVERY_FACTS_MISSING`, không bước phục hồi, không mở kẹp, phục vụ 0), REC05 (cell belief + chính sách: 3 seed + 5 fault giữ baseline). Hồi quy R2b: `mujoco-cell-bv01` 3/3, `mujoco-cell-faults` 5/5, `mujoco-arm-bv01` 2/2; pytest worker 316/316; unit source 1434 passed (2 file cần `MEKONIQ_RETAINED_INPUTS`, môi trường). Lab: unit 839 passed (1 skipped), e2e `mujoco-belief` 1/1.

## Chặn / chưa làm (cần quyết định hoặc điều kiện ngoài)
- **REC06 vẫn bị chặn, đã đo lại sau sửa:** với cam kết ở đúng lúc bắt đầu hạ, lực ≤14,0 N bị kẹp hấp thụ (vẫn nhấc được); 14,2 và 14,4 N đẩy cốc ra khỏi giá (REC04, không phục hồi); 14,4 N theo +y: mở kẹp, lùi, rồi không có belief mới (cốc ra khỏi vùng nhìn) → gọi người. Không có lực nào cho kẹp hụt mà cốc còn trong tầm nhìn. Preset `world-cup-nudge-v1` giữ 14,4 N; trình duyệt không chọn được. REC01/02 dùng lỗi kẹp mở-giữ của rig (tùy chọn chỉ cho test, không phải trường request).
- **WEB10 (mẫu replay `belief-recovery`) bị chặn:** không có run chọn được từ trình duyệt nào có phục hồi. Quyết định của người dùng: (a) bỏ mẫu; (b) sinh mẫu bằng harness với lỗi kẹp mở-giữ và ghi rõ nhãn không tái lập được từ web.
- **CLD01 ca R4.4 đã viết, CLD02 chưa chạy:** `not_run: docker_daemon_down` (OrbStack tắt). CLD03 `not_run: deploy_order_pending`.
- REC03 (stale → chờ → fresh) chỉ có unit test và run profile mất mẫu (`BELIEF_STALE`); biến thể REC04 "cốc còn giữa hai má" chỉ có unit test; worker-loss/lost-ack/cancel-held chạy trong REC05.
- V14–V15 (R4.5) chưa mở: cần dữ liệu đo hoặc lịch phần cứng. Còn lại của R4: V16 (qualification, regression, G-CLOUD2).
- Minor hoãn (xem ledger): lớp ghost Lab bỏ qua `complete/issues` và tuổi tối đa; `medianTicks` không so được giữa chế độ; z của belief là z thật; chưa kiểm lệch sinh cốc với truth trong verifier; không có test băm cho "fixed_program giữ byte R2b".

## Phát hiện từ study (không chỉnh, không xếp hạng)
Chương trình cố định lệch 20 mm: 4/10 nhấc được (4 làm rơi cốc, 2 dừng `unknown`, 14 tiếp xúc ngoài dự kiến); chế độ belief: 7–8/10, phần còn lại do cổng sweep ARM03 (`ARM_COLLISION`, link-1/link-4) từ chối trước khi chuyển động (phụ thuộc hướng lệch của seed 3, 4) hoặc dừng tay máy `unknown`. Không điểm belief nào có kẹp hụt. Điểm `stale-nudge` (không chính sách phục hồi): 0/10 nhấc được.

## Giữ
Lịch lỗi drive là input của run; Python `-B`, `PYTHONDONTWRITEBYTECODE=1`, `-p no:cacheprovider`; một spec e2e một launcher (`--ui-port 42455 --runtime-port 42456`); campaign cần cây sạch (chạy từ worktree sạch khi còn sửa code; symlink `node_modules` và `.venv-mujoco`, thêm vào `.git/info/exclude`).
