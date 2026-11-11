# Triển khai W00–W11

Toàn bộ W00–W11 đã merge vào `main` (W00–W04 từ `feat/w00-w04-production-foundation`, W05–W06 qua PR #1, W07–W08 và W09–W11 merge sau đó). `trial` và `web` được giữ nguyên. Trạng thái từng task: [plan index](../superpowers/plans/2026-10-30-plan-index.json); tổng hợp: [Gate D](gates/D-full-scope.md), [production release](gates/production-release.md).

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
pnpm test:adapters && pnpm test:providers && pnpm test:security
pnpm test:e2e
pnpm test:acceptance -- continuity --software-only
pnpm test:acceptance -- release-manifest
pnpm test:acceptance -- first-shift
pnpm test:load            # và pnpm test:load:free (~4 phút)
.venv/bin/python -m pytest robotics/agent/tests tests/hardware tests/contracts/test_schema_python.py -q
```

Công cụ vận hành (chỉ local/dry-run): `pnpm release:dry-run`, `pnpm release:verify`, `node scripts/release-security.mjs`, `node scripts/migrate-release.mjs --plan`, `node scripts/restore-rehearsal.mjs`, `node scripts/verify-completion.mjs`. Xem `docs/operations/`.

Tạo `.venv` bằng `python3 -m venv .venv`, rồi cài `requirements-dev.txt` trước kiểm Python. Playwright cần Chromium tương ứng hoặc `PLAYWRIGHT_CHROMIUM` chỉ tới browser sẵn có. Xem cấu hình Playwright để biết cổng test.

`pnpm test:acceptance -- continuity` là gate đầy đủ: thiếu chứng cứ Android nhiều thiết bị/soak thì **fail**, dù các ca phần mềm đạt. `--software-only` là lựa chọn tường minh dành cho phát triển, không đổi trạng thái nghiệm thu thiết bị.

Android: xem `docs/operations/tablet-provisioning.md`; build qua Gradle wrapper, SDK/JDK đã khóa. Runner lifecycle yêu cầu hai serial test được enroll; không chọn thiết bị/robot đang vận hành.

## Mô phỏng: LinkForge + IR-SIM, Webots 3D (R1)

Chỉ chạy local, không chạm robot thật; mọi gate ở mức `tested`, `accepted: false` (chỉ reviewer mới ghi accepted).

```sh
node scripts/lab-irsim.mjs doctor --provider webots                 # cần Webots R2025a ở /Applications/Webots.app và .venv-webots
node scripts/lab-irsim.mjs run --provider webots --campaign r1-qualification --out <dir> --concurrency 1
node scripts/record-sim-extension.mjs --release r1 --out docs/implementation/evidence/sim-extension/<candidate> \
  --candidate-id <candidate> --irsim-record <linkforge-irsim candidate> --mock-regression <lab regression dir>
LAB_SIMEXT_EVIDENCE_DIR=docs/implementation/evidence/sim-extension/<candidate> pnpm test:acceptance -- sim-extension
```

Recorder cần cây source và Lab sạch, Lab pin đúng commit source, không có `__pycache__` dưới `robotics/`, và phải chạy dưới `caffeinate -dims` (máy ghi tự ngủ khi không có người dùng; một run Webots đang chạy lúc đó thành `RUN_TIMEOUT`). Bản ghi mới nhất: `evidence/sim-extension/r1-candidate-05/` (R1) và `evidence/sim-extension/r11-candidate-02/` (R1.1, tay máy Webots), mỗi bản kèm `README.md` (gate, giới hạn), trên nền `evidence/linkforge-irsim/candidate-07/`. ALG04 là `not_run` (thuộc R3).

## Phạm vi và giới hạn

Luồng hiện có: menu có version, phiên bàn/order, KDS theo phần, allocation/giao tay hoặc simulator, ca tiền mặt, bill snapshot; isolated capture/đối soát, signed settlement grants, maintenance/import và controlled handoff. Customer claim không settlement; historical import không tạo live effect. W05–W11 thêm POS đầy đủ, robot Valetudo/ROS 2/VDA 5050, kho, nhân sự, khuyến mãi, CRM, đặt bàn, chuỗi, kênh online sandbox, SDK/Node-RED và khung provider; provider, robot và hạ tầng hosted thật vẫn chưa có (xem evidence từng task).

Các lệnh phần cứng/provider chưa có prerequisite phải thất bại rõ ràng. Không có deploy hosted, robot thật, SMTP production, commissioning hoặc RPO/RTO production trong kết quả local. Xem [kết quả kiểm tra](verification.md), `evidence/`, `gates/A-continuity.md` và `tablet-support-matrix.json` cho phạm vi từng phép đo.
