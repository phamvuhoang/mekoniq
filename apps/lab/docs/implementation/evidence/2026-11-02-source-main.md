# Cập nhật Robot Lab theo source/main W05/W06

Ngày: 2026-11-02. Yêu cầu: dùng code W05/W06 đã merge vào main và xóa worktree cũ.

## Kết quả

- Baseline main đã có W05/W06: `5ea8db8` (PR #1).
- Ghép main vào runtime branch, sửa hai điểm tương thích, rồi fast-forward source/main local. Runtime hiện ở commit `a2f271c446cc83800787279ce0be7d9aae6e6889`; chứa toàn bộ ancestry của baseline W05/W06.
- Đăng ký workspace `packages/lab-runtime` trong pnpm-lock.yaml; frozen-lockfile install check qua.
- Lab import artifact sạch, pin commit/schema/hash mới. Export cuối từ clone tạm của committed main rồi tự xóa clone, không đổi file next-env.d.ts đang có chỉnh sửa của người dùng.
- Xóa `source/.worktrees/robot-lab-runtime` và `/private/tmp/mekoniq-robot-lab-work/lab`. Mỗi repo còn một checkout chính; commit lịch sử/nhánh được giữ. Journal và ghi chú local cũ được lưu tại `lab/runs/worktree-archive-2026-11-02/`, không commit.

## Tương thích W06

S01 cũ bị từ chối `MAP_BINDING_STALE`, rồi `OBSERVER_NOT_BOUND` sau khi sửa binding. Root cause là fixture chưa có binding epoch và harness dùng actor chung cho observations.

- Fixture tạo `bindingRevision` bằng đúng world revision đã dùng để biên dịch waypoints.
- Robot observations dùng actor server-owned `simulator:sim-1` trên owner device `lab-coordinator`; browser không được chọn actor.
- Giữ nguyên code admission, ownership, reservation và observer checks của production.
- Thêm regression chạy đủ kitchen → table → parking với world revision 7, kiểm mọi dispatched target có revision 7. Test đã FAIL với fixture cũ và PASS sau sửa.

## Artifact

- Source commit: `a2f271c446cc83800787279ce0be7d9aae6e6889`.
- Schema SHA-256: `5049b69bb68ce666f3fb9f7f0616aa97411c8114d5cd7253d99506af884118a7`.
- Runtime SHA-256: `cb0dea9200b24ade7915f00fd2f664b61a06e2e57b52e3a528d3e8bc44f1870d`.
- Protocol 1, Node 24.22.2, dirty=false. Xem [lock](../../../config/source-runtime.lock.json).

## Kiểm chứng

| Phần | Kết quả |
|---|---|
| Source Lab runtime, simulation, W06 admission/review regressions, contracts, adapters | 118 PASS |
| Python agent/hardware-profile/schema tests | 178 PASS; Python 3.13 local, không phải target 3.12/Gazebo |
| Source typecheck và contracts:check | PASS |
| Lab unit/integration | 42 PASS |
| Lab build/typecheck/check:source | PASS |
| Browser S01 với artifact mới | PASS; tải/giao, travel/wait, replay, report, candidate |

```sh
# source, Node 24
pnpm exec vitest run tests/integration/lab-runtime*.test.ts tests/integration/simulated-delivery.test.ts tests/integration/app-simulator.test.ts tests/integration/robot-admission.test.ts tests/integration/robot-review-repairs.test.ts tests/contracts tests/adapters
pnpm typecheck
pnpm contracts:check
PYTHONPATH=robotics/agent .venv/bin/python -m pytest robotics/agent/tests tests/hardware tests/contracts/test_schema_python.py -q

# lab, Node 24
pnpm test
pnpm build
pnpm check:source
pnpm test:runtime-e2e
```

Đây là cập nhật baseline và tương thích runtime. Code Valetudo/Android/ROS/Gazebo đã có trong source nhưng chưa tự mở thêm backend Lab hoặc tạo bằng chứng chạy robot thật. Các báo cáo ngày 2026-11-01 giữ nguyên để lưu lịch sử. Commit mới chỉ ở local, chưa push.
