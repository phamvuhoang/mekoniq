# Triển khai W00–W04

Branch: `feat/w00-w04-production-foundation`, tách từ `62a98bd`; làm trực tiếp trong repository `source`, không dùng worktree. `trial` và `web` được giữ nguyên.

Review bổ sung ngày 2026-10-31: xem [13 bản sửa và kiểm chứng](review-repair-verification.md). Gate A vẫn chưa được chấp nhận.

## Chạy local

Dùng Node.js theo `.node-version` (24.22.2), pnpm 10.32.1 và Docker. Không cần tài khoản hosted.

```sh
pnpm install --frozen-lockfile
pnpm doctor
pnpm supabase:start
pnpm local:bootstrap
pnpm dev:cloud
```

Supabase riêng của dự án: API 57421, PostgreSQL 57422, mail sink 57424; Next.js 3400. `pnpm local:bootstrap` tạo cấu hình local, owner Auth, membership và venue trống; lệnh không ghi đè file cấu hình có sẵn. Đọc tài khoản tại `.lab/bootstrap/owner-credentials.json` (quyền 0600), không đưa file này vào Git. Giữ service key ngoài bundle. Database application role chỉ có quyền trong transaction theo scope. Supabase Auth sở hữu phiên; membership/permission do ứng dụng kiểm theo từng venue.

Để xem tablet trong trình duyệt bằng dữ liệu **fixture riêng**, mở hai terminal:

```sh
MEKONIQ_DEV_LAB=1 pnpm dev:coordinator
MEKONIQ_DEV_LAB=1 pnpm dev:tablet
```

Mở http://127.0.0.1:3452. Coordinator fixture chạy loopback 3451, gọi cùng domain/router/SQLite và simulator. Đây là công cụ development trong `tests/support`, không phải coordinator triển khai tại nhà hàng. Build tablet release yêu cầu enrollment/native transport; không tự nhận fixture hoặc actor do query string khai báo.

## Kiểm thử

```sh
pnpm contracts:check
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm test:e2e
pnpm test:acceptance -- continuity --software-only
.venv/bin/python -m pytest tests/contracts/test_schema_python.py -q
```

Tạo `.venv` bằng `python3 -m venv .venv`, rồi cài `requirements-dev.txt` trước kiểm Python. Playwright cần Chromium tương ứng hoặc `PLAYWRIGHT_CHROMIUM` chỉ tới browser sẵn có. Xem cấu hình Playwright để biết cổng test.

`pnpm test:acceptance -- continuity` là gate đầy đủ: thiếu chứng cứ Android nhiều thiết bị/soak thì **fail**, dù các ca phần mềm đạt. `--software-only` là lựa chọn tường minh dành cho phát triển, không đổi trạng thái nghiệm thu thiết bị.

Android: xem `docs/operations/tablet-provisioning.md`; build qua Gradle wrapper, SDK/JDK đã khóa. Runner lifecycle yêu cầu hai serial test được enroll; không chọn thiết bị/robot đang vận hành.

## Phạm vi và giới hạn

Luồng hiện có: menu có version, phiên bàn/order, KDS theo phần, allocation/giao tay hoặc simulator, ca tiền mặt, bill snapshot; isolated capture/đối soát, signed settlement grants, maintenance/import và controlled handoff. Customer claim không settlement; historical import không tạo live effect. Provider và robot thật thuộc wave sau.

Các lệnh phần cứng/provider chưa có prerequisite phải thất bại rõ ràng. Không có deploy hosted, robot thật, SMTP production, commissioning hoặc RPO/RTO production trong kết quả local. Xem [kết quả kiểm tra](verification.md), `evidence/`, `gates/A-continuity.md` và `tablet-support-matrix.json` cho phạm vi từng phép đo.
