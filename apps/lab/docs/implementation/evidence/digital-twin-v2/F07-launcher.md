# F07 — Mock launcher, install và runtime artifact: bằng chứng

> **Bằng chứng lịch sử của pin `2be6d15`.** Các kết quả và mục chưa chạy bên dưới mô tả lần kiểm đầu tiên. Gói offline, runtime pin và kiểm chứng Plan 01 hiện tại nằm trong [mock-report](mock-report.md), [bản ghi release](plan01-offline-release.json) và [remediation](../../../reviews/2026-11-05-plan-01-remediation.md). Không dùng số đo khởi động ấm này làm bằng chứng cho cold boot hoặc máy mới.

Ngày chạy: 2026-11-05 (UTC 02:10–02:30). Người chạy: agent (không phải người dùng thật).

## Host

- macOS 26.5, Apple M2 Pro, 10 CPU, 16 GiB RAM.
- Node v24.22.2 (nvm), pnpm 10.32.1, Google Chrome (Playwright `executablePath` mặc định).
- Profile người dùng hiện có (dependencies đã cài, cache Vite `node_modules/.vite` có sẵn). **Không** phải profile mới.

## Artifact và pin

| | Giá trị |
|---|---|
| Source commit (clean, `dirty:false`) | `2be6d1591f4c481cef60fcb6058782544a5ca2d7` |
| schemaHash | `3b632d1ec0ef38dedef0a1e96b80109ebdda185cd713b47309924a48d3a3ed4e` |
| artifactSha256 | `cee29acaeb5286292a1bc0ee6f8a2664ddfe56f982e76d784ad934145af66d47` |
| protocol | `protocolMajor:2`, `protocolMajors:[1,2]` |
| Pin trước (rollback) | source `a07877718196ffc88832044fad97b027cedd53f4`, artifact `eda2c7d7…f5f3`, protocol 1 — giữ trong `.runtime/rollback.lock.json` |

Lệnh: `cd source && node scripts/export-lab-runtime.mjs <tmp>/artifact-2be6d15` (checkout sạch, không `--allow-dirty`), rồi `cd lab && node scripts/import-runtime.mjs <tmp>/artifact-2be6d15 && pnpm check:source` → `Verified source 2be6d15…; protocol 1/2; Node 24`.

`--clean-checkout` (source dirty): đã chạy khi source có thay đổi chưa commit → artifact `dirty:false` từ `HEAD` 8133e55 qua worktree tạm, `pnpm install --frozen-lockfile --offline`, 7,6 s; worktree đã xóa (`git worktree list` chỉ còn checkout chính).

## Kết quả kiểm thử (đều chạy trên host trên)

| Lệnh | Kết quả |
|---|---|
| `pnpm exec vitest run tests/integration/mock-launcher.test.ts` | 9/9 pass: Node/OS không hỗ trợ, thiếu runtime (*preview only*), artifact hỏng/bẩn, cổng bận (tiến trình giữ cổng vẫn sống), cổng 1880/1884 bị từ chối, backend mock thiếu/backend lạ, Ctrl-C chỉ dừng tiến trình con của launcher (tiến trình bystander vẫn sống, hai cổng được giải phóng), không có kết nối ra ngoài loopback, giao dịch import + rollback, tương thích lock [1,2] với health v1 |
| `pnpm test:mock-e2e` | FD01 (`twin-recovery.spec.ts`) 1 pass, BV01 (`coffee-journey.spec.ts`) 1 pass, qua `start-mock.mjs` thật và journal source thật; 24,7 s tổng |
| `pnpm test:twin-e2e` | 3 spec: 5 + 1 + 1 pass |
| `pnpm test:runtime-e2e` (S01 v1 trên artifact protocol 1/2) | 1 pass |
| `pnpm exec playwright test ui.spec.ts` | 12 pass |
| `pnpm typecheck`, `pnpm test:unit` (63), `pnpm test:integration` (35 pass, 1 skip có sẵn: measure), `pnpm build` | pass |
| Ctrl-C thật trên `pnpm lab:mock` (SIGINT gửi cho cả process group như terminal) | thoát, không còn tiến trình `vite`/`runtime.mjs`, cổng 4175/4176 trống |

## Không tải mạng khi khởi động

Không có môi trường "tắt mạng" thật. Thay vào đó: hook `--import` (qua `NODE_OPTIONS`, kế thừa bởi launcher, runtime và Vite) ghi lại và chặn mọi `net.Socket.connect`/`dns.lookup` tới host không phải loopback. Với runtime **thật** đã pin (`start-mock.mjs --boot-only`): 0 lần kết nối ra ngoài. Hook không phủ binary esbuild (Go) do Vite khởi động. Launcher không gọi `pnpm`/`npm` và dừng `DEPENDENCIES_NOT_INSTALLED` nếu thiếu `node_modules`.

## Boot-to-ready (10 lần khởi động)

Cấu hình: `node scripts/start-mock.mjs --data-dir <thư mục tạm mới> --boot-only`, mỗi lần tiến trình mới, journal mới; cache hệ điều hành và cache Vite đã ấm; không tính cài dependencies. "Ready" = runtime in mã ghép nối, `/lab/v2/health` khớp lock và đủ backend mock, UI trả HTTP 200 (lấy mẫu mỗi 100 ms).

| Lần | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Launcher (ms) | 455 | 453 | 455 | 486 | 449 | 457 | 457 | 453 | 458 | 455 |
| Wall, gồm khởi động Node (ms) | 566 | 547 | 551 | 608 | 553 | 555 | 556 | 547 | 552 | 548 |

p95 (nearest rank, n=10) wall = **608 ms**; mục tiêu đề xuất ≤ 30 s sau install. Đây là khởi động ấm trên một host macOS, không phải cold boot sau khởi động lại máy hay profile mới; chưa gắn nhãn đạt cho mục tiêu trên máy sạch.

## Chưa chạy (`not_run`)

- **Profile macOS mới và Linux** (`not_run`): không có host Linux hay profile sạch. Launcher từ chối hệ điều hành khác macOS/Linux (`UNSUPPORTED_OS`, đã test bằng giá trị `win32`); trên Linux chỉ là suy luận (runtime là Node thuần, SQLite `node:sqlite`).
- **Tắt mạng thật sau install** (`not_run`): chỉ có kiểm bằng hook như trên.
- **Cài bản offline đóng gói sẵn dependencies/assets** (`not_run`): chưa có gói release offline; máy mới cần mạng một lần cho `pnpm install --frozen-lockfile`.
- **Usability 3/5 phút với người dùng** (`not_run`): không được agent đo.
- **Cold boot sau khởi động lại máy** (`not_run`).
