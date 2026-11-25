# MEKONIQ Brand UI — Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement task-by-task. Steps use checkbox syntax. Chỉ dùng subagent-driven-development khi người dùng cho phép delegation.

**Goal:** Đồng bộ UI tối của Lab, Source và Trial theo nhận diện MEKONIQ, giữ hành vi hiện có.

**Architecture:** Source sở hữu tokens/assets/CSS không phụ thuộc framework; Lab/Trial dùng export có version/hash được commit. React và DOM/HTML giữ adapter tại app, không viết lại framework.

**Tech Stack:** Node 24.22.2, pnpm 10.32.1, TypeScript, Vite, Next.js/React, CSS variables, Node-RED static HTML, Vitest, Playwright, node:test.

**Spec:** [Brand UI specification](../../specs/2026-11-06-brand-ui-unification/README.md), [inventory](../../specs/2026-11-06-brand-ui-unification/inventory.md), [verification](../../specs/2026-11-06-brand-ui-unification/verification.md).

## Global Constraints

- Deep `#071D21`, Motion `#B9FB75`, Aqua `#63DCC5`, Accent `#FF9F68`, Paper `#F6F8F4`; chấm logo `#FFAA76`, nền logo `#0B2A2D`.
- Tối mặc định từ lần paint đầu; không theme toggle, không đổi API/DB/permission/command semantics.
- Asset/font local; horizontal/wordmark PNG đã cung cấp, Q SVG gốc; không redraw/recolor.
- Node 24.22.2 / pnpm 10.32.1 cho Source/Lab. Trial theo lockfile hiện có; không upgrade Node-RED trong migration.
- Text thường ≥4.5:1; UI cue cần thiết ≥3:1. Target ≥44×44px; Tablet/Trial primary ≥56px; giữ command buttons 72/92px.
- Giữ VI/JA/EN của Lab; VI/EN ở các app đang hỗ trợ. Không thay text nghiệp vụ bằng tiếng Anh đơn ngữ.
- Trial test chỉ 1891/1886/1892, môi trường tạm; giữ operational ports 1880/1884 nguyên trạng.
- Không stage các artifact chưa commit của Source; không chỉnh `web/demo` trực tiếp.
- Không đòi lại phê duyệt đã được cấp; kiểm phạm vi deploy của đợt thực thi. Người dùng đã yêu cầu implement; triển khai trên nhánh `feat/brand-ui-v1` của từng repo. Production rollout cần phạm vi phát hành riêng.

## Thứ tự thực hiện

| Plan | Tasks | Đầu ra | Dependency |
|---|---|---|---|
| [01 Foundation](01-foundation.md) | F01, F02 | Tokens/CSS/assets; export/checkers; gallery states | Không |
| [02 App migration](02-app-migration.md) | L01, S01, S02, T01 | UI cùng brandVersion, từng app có regression tests | F01/F02; đi theo thứ tự Lab → Cloud → Tablet → Trial |
| [03 Qualification](03-qualification-release.md) | Q01, Q02 | Evidence, offline/print, preview/release/rollback | Tất cả task migration |

Mỗi task ghi source/lab/trial commit nếu liên quan; không dùng một SHA đại diện ba repo. Ước lượng sơ bộ 8–13 ngày công: foundation 2, Lab 1–2, Cloud 2–3, Tablet 1–2, Trial 1–2, qualification 1–2. Đây là planning range, không cam kết; re-estimate sau baseline screenshots, đặc biệt Cloud chưa có global styling.

## Coverage và trạng thái

| Requirement | Task |
|---|---|
| UI-01, UI-03 | F01, F02 |
| UI-02, UI-04 | F01, L01, S01, S02, T01 |
| UI-05 | L01 |
| UI-06 | S01, S02 |
| UI-07 | T01 |
| UI-08, UI-11 | L01, S01, S02, T01, Q01 |
| UI-09 | F01, các app tasks, Q01 |
| UI-10 | F02, Q02 |
| UI-12 | Q01, Q02 |

Implementation đang được ghi nhận tại [evidence index](../../implementation/evidence/brand-ui-v1/README.md); trạng thái gốc của kế hoạch không thay cho kết quả kiểm thử. Các lệnh/tooling mới được ghi rõ `Create`; không coi chúng là có sẵn ở baseline. Test visual cần baseline review, không dùng cập nhật snapshot hàng loạt thay acceptance. Chỉ thêm test có giá trị kiểm hợp đồng, behavior hoặc a11y; không snapshot mọi selector CSS.
