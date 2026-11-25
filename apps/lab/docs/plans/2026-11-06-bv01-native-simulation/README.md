# BV01 & Native Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện BV01 dùng chung mock/native, có evidence đến Lab và qualification trên UTM hai VM.

**Architecture:** Source giữ domain, journal, workflow và adapter; Lab hiển thị và cấu hình. Native coordinator ở Ubuntu VM; arm bridge ở Debian VM qua SSH Unix socket forwarding; không tạo framework điều khiển remote mới.

**Tech Stack:** Node 24.22.2, pnpm 10.32.1, TypeScript, Python, SQLite/PostgreSQL, UTM ARM64, Ubuntu 24.04/Jazzy/Harmonic/Nav2, Debian 12/LinuxCNC/QtVCP.

**Spec:** [Spec](../../specs/2026-11-06-bv01-native-simulation/README.md), [contracts](../../specs/2026-11-06-bv01-native-simulation/contracts-and-evidence.md), [verification](../../specs/2026-11-06-bv01-native-simulation/verification.md).

## Global Constraints

- Node 24.22.2; pnpm 10.32.1; dependencies khóa theo lockfile, không nâng major để hoàn thành task.
- Business authority/contracts/adapters ở `source/`; presentation/project UX ở `lab/`.
- Không sửa `trial/`, không chạm robot hoặc cổng `1880`/`1884`; UI/runtime loopback `4175`/`4176`.
- Mỗi run khóa mode, seed, backend versions, model/world/recipe/profile revisions và clock domains.
- UI Việt/Nhật/Anh; mọi nhãn kết quả phải nêu provenance và không nâng simulation thành hardware evidence.
- Native test thiếu môi trường ghi `not_run` với blocker; test đã chạy sai assertion ghi `fail`.
- Không export dirty source; không ghi secrets, VM disk, SSH private key hoặc signing key vào Git.
- Không xóa dữ liệu host để provision VM; storage và RAM preflight phải đạt trước khi tải image lớn.

## Trạng thái tại thời điểm lập kế hoạch

Baseline đã nghiên cứu: source `a89a077`, lab `3a92e65`; không phải revision nghiệm thu các task mới. Host M2 Pro/16 GiB chỉ còn 4,4 GiB disk, UTM chưa cài. **Provisioning hiện blocked_external: storage**, chưa có VM run nào. Không copy kết quả baseline thành kết quả task mới.

## Workstreams và dependencies

| Plan | Tasks | Có thể bắt đầu | Đầu ra |
|---|---|---|---|
| [01 — Golden path và evidence](01-golden-path.md) | I01–I05 | Ngay trên Mac | Ports/custody, BV01 mock, controller report, readiness/fault schedule |
| [02 — UTM và native](02-native-simulation.md) | N01–N06 | N01 sau storage; N02/N03 độc lập I02 | Hai VM, standalone qualification, tunnel, virtual grip, combined runner |
| [03 — Release acceptance](03-release-acceptance.md) | R01–R03 | R01 baseline; R02 sau I03; R03 sau N03 | PG, offline/usability, signed amd64 qualification |
| [UTM operational runbook](utm-runbook.md) | Provisioning và smoke commands | Storage/guest images sẵn sàng | Hướng dẫn triển khai cụ thể, không giả định đã chạy |

Thứ tự chính: I01→I02→I03→I04→I05; N01→N02/N03→N04; I01/I02+N03→N05; I02/I03+N02/N04/N05→N06. R01 làm sớm; R02 sau mock/report và pin; R03 sau controller packaging/native. N04 sửa clock trước combined, không cần chờ UI fault editor.

Sprint 1 lấy I01–I03, R01 và N01/N03 làm mục tiêu; sprint 2 lấy N02/N04–N06 và R02. I04/I05 không được làm chậm xử lý bug golden path; R03 phụ thuộc target/signing station. Đây là sequencing, không cam kết hoàn thành trong 2–4 tuần. Re-estimate sau standalone smoke: actual package compatibility, transforms/IK, renderer, VM headroom và transport.

## Quy trình mỗi task

Các paths bắt đầu `source/` hoặc `lab/` tính từ workspace; viết tắt `v2/` là `source/packages/lab-runtime/src/v2/`, và `sil/` ở N06 là thư mục `v2/sil/`; Git/test chạy từ đúng repo. File ghi “new” là deliverable tương lai, không được coi là hiện có. Trước sửa, đọc AGENTS và giữ thay đổi người dùng; riêng artifact báo cáo source đang uncommitted phải giữ nguyên.

1. Viết regression test về invariant/behavior nêu trong task; chạy focused command và lưu RED. Với provisioning, RED là preflight thiếu dependency/resource, không là test giả.
2. Implement đúng interface đã pin; chạy GREEN cùng command và các caller ảnh hưởng. Môi trường thiếu thì chỉ hoàn tất portable portion, giữ native checkbox trống.
3. Review diff, contracts/backward compatibility, ghi evidence và commit riêng trong repo tương ứng. Commit message mỗi task ở phần Exit. Không `git add .` trên workspace có thay đổi khác.
4. Sau source commit sạch, export/import pin theo R02 và chạy browser trên pin mới. Không tick Lab task dựa trên runtime source chưa export.

## Truy vết yêu cầu → task → verification

| Requirement | Task chịu trách nhiệm | Cases |
|---|---|---|
| BVI-01 | R01, N01, R02 | V13–14, manifests |
| BVI-02 | I02, N06 | V01, V12 |
| BVI-03 | I01, I02, N05 | V02–03, V11 |
| BVI-04 | I02, N05 | V02–03, V11 |
| BVI-05 | I03 | V04 |
| BVI-06 | I04, N06 | V05 |
| BVI-07 | I05, N06 | V06, V08, V12 |
| BVI-08 | R02 | V14 |
| BVI-09 | N01–N03 | V07–10 |
| BVI-10 | N04–N06 | V11–12 |
| BVI-11 | I03, R02–R03 | Gate decisions và scope |
| BVI-12 | R01–R03 | V13–16 |

Không có task nào trong bộ này tự cho phép hardware/live mode. P1 designer/capacity/ROI được hoãn có chủ đích theo spec; không phải missing task trong scope hiện tại.

## Implementation checkpoint

Portable code and final qualification: source `f82b2057cae89b0029968212753df01f86f334ad`, Lab code/pin `66445c5acf24f90cc17449bae561dbc45965eba7`. See the [HTML report](../../implementation/evidence/bv01-native-simulation/implementation-report.html), [test manifest](../../implementation/evidence/bv01-native-simulation/qualification-final.json), and [review resolutions](../../implementation/evidence/bv01-native-simulation/review-resolution.md).

I01–I05 and portable N02–N06 are implemented/tested. Full R01 PostgreSQL qualification passed. R02 has clean pin, browser and macOS ARM64 offline evidence; clean target/network-off/usability remain open. N01 two-VM provisioning and R03 signed clean-amd64 qualification remain blocked_external. No native/hardware/release acceptance is inferred.
