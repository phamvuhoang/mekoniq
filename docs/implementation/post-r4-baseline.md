# Baseline sau R4 và sau lần gộp repo (E00 của R5)

Chụp ngày 2026-11-25 trước khi R5 đổi bất kỳ file nào dưới `source/`. Đây là tuple để E01–E21 so sánh.

## Git

| Mục | Giá trị |
|---|---|
| Nhánh làm việc | `main` (người dùng chốt làm thẳng trên `main`, thay cho nhánh `r5/hardware-electrical` của plan) |
| `main` so với `origin/main` | bằng nhau, `b37347f2e794b3e72c19664a0ef9400d9f3a5a8d`; cây sạch |
| Commit source (đường dẫn ngoài `apps/lab`) | `b37347f2e794b3e72c19664a0ef9400d9f3a5a8d` |
| Commit Lab (`apps/lab`) | `dfa9c532a9570708e89f1dfb904f725144d1e368` |
| Push / deploy | Không. R5 chỉ commit cục bộ; push `main` là deploy production và cần lệnh riêng |

## Pin và cloud

`apps/lab/config/source-runtime.lock.json`: `sourceCommit` `0650ecbd126ee4b0b6004412942d5109e5b253a6`, `schemaHash` `353b06e2bbbbf84f7b4cf0ce8e7f8be5091c95a296ba02f9081fa4e9c4cc1cd2`, `artifactSha256` `5cf17557…716f`, `portableToolsDigest` `5292583e…c4be`.

`GET https://mekoniq-lab-runtime-ojykcqdkja-as.a.run.app/lab/v2/health`: `sourceCommit` `0650ecbd…`, cùng `schemaHash`. Pin = Cloud Run, đúng trạng thái trên `main`. Hai hostname `lab.mekoniq.app` và `mekoniq.app` đều trả HTTP 200 (M8, M9 đã chạy). `robot/CLAUDE.md` đã mô tả repo gộp (M10).

## Guard

- `tests/unit/mujoco-native-probe.test.ts`: 44/44 đạt (hash năm schema đóng băng và 25 fixture xArm trong `r2a-arm-baseline.json` khớp giá trị ghim).
- Guard của record R4 trong cây (`docs/implementation/evidence/virtual-commissioning/v16-r4-candidate-02-0650ecbd-lab-de4d0c3-2026-11-25/`): cây chỉ giữ JSON và `index.json`; guard cần archive thô ở `robot/evidence-archive/r4-chain-0650ecbd/`. R5 không chạy lại guard này ở E00; record R4 không bị đổi.

## Catalog

13 linh kiện, 0 báo giá, `catalog.json` sha256 `8f4bb55f323b8b26907fc5986ef0062e4569f278ff9260f5af841425acfd37b4`. Linh kiện: `amr-chassis-ref`, `battery-24v-ref`, `caster-ref`, `cup-ref`, `drive-wheel-ref`, `eversys-cameo`, `gripper-jaw-ref`, `orientalmotor-blv-r`, `phidgets-frc4115`, `service-tray-ref`, `slamtec-rplidar-s2`, `ufactory-gripper-g2`, `ufactory-xarm6`.

## Câu hỏi cho Hoàng Anh

Chưa có xác nhận nào về sáu câu hỏi ([roadmap §4.1](../../../docs/2026-11-25-R5~/02-roadmap.md)). Theo plan, E00–E02 và phần code của E03 không phụ thuộc; hồ sơ HW-A được nhập theo mặc định và commit message ghi rõ danh sách chưa được Hoàng Anh xác nhận.
