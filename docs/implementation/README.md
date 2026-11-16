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

Recorder cần cây source và Lab sạch, Lab pin đúng commit source, không có cache dưới portable tool root, và phải chạy dưới `caffeinate -dims` với màn hình mở khóa khi có Webots. Recorder R2a đã tự tắt pytest cache provider; không cần biến môi trường khắc phục tạm.

Các bản ghi lịch sử R2a sau code review (source `4f893ac`, Lab `a6ec316`), cùng định danh trong toàn bộ chuỗi:

- [LinkForge + IR-SIM candidate-09](evidence/linkforge-irsim/candidate-09/README.md).
- [R1 candidate-07](evidence/sim-extension/r1-candidate-07/README.md), Webots và thuật toán.
- [R1.1 candidate-04](evidence/sim-extension/r11-candidate-04/README.md), tay máy Webots.
- [R2a candidate-02](evidence/sim-extension/r2a-candidate-02/README.md), MuJoCo xArm 6, runtime web và UI; regression R-MOCK tại `lab/docs/implementation/evidence/sim-extension-r2a/regression-02`.
- [Cloud Run mekoniq / CL01](evidence/cloud-run/mekoniq-2026-11-14/README.md): đã deploy theo lệnh người dùng, image amd64 cùng pin; health, ghép nối, mock, nối lại stream và MJ-BV01 đều đạt trên x86-64 thật. Guard `cloud-run` xác nhận **G-CLOUD1 `tested` qua bản bổ sung**, ràng buộc SHA-256 của đúng qualification R2a và source/Lab pin. Qualification gốc giữ trạng thái legacy `blocked_external`/`not_run`; không sửa dữ liệu đã ghi.
- [Cập nhật production R2a](evidence/production/r2a-2026-11-14/README.md): source và Lab đã push, Vercel READY, health đạt; Chrome tự động từ Lab production tới Cloud Run chạy `MJ-BV01` hoàn tất, phục vụ 2 và archive run thử. Bằng chứng này có phạm vi riêng với kiểm tay HTTPS tới loopback.

Mọi gate của IR-SIM, R1, R1.1 và bảy gate cục bộ R2a đều `tested`; G-CLOUD1 được kiểm riêng bằng bản bổ sung Cloud Run. ALG04 còn `not_run` (thuộc R3); kiểm tay Chrome, Firefox, Safari trên bản Lab HTTPS mới còn `not_run`. Chưa có sidecar `acceptance.json` cho các bản ghi này; các lần chấp nhận candidate cũ không chuyển sang bản mới. Bản ghi bị thay thế được xóa khỏi cây và giữ trong lịch sử Git.

Ghi R2a: `--release r2a --r11-record <dir> --mock-regression <dir>`, cần Docker cho RT05. Các README ghi rõ định danh, giới hạn, tham số `assumed` và số đo. Mọi thay đổi runtime/schema/tool phải được commit và ghim lại trước khi ghi; sau đó chỉ thêm bằng chứng và cập nhật tài liệu ngoài tool root.

Bằng chứng thô từ nay: archive thô lớn hơn 5 MB không commit vào Git. Lưu ngoài Git tại `robot/evidence-archive/<candidate>/` trên máy ghi, sao lưu theo nơi người dùng chỉ định; trong Git chỉ giữ index ghi đường dẫn tương đối, kích thước và sha256 của từng archive. `.gitignore` bỏ qua `docs/implementation/evidence/**/raw/*.tar.gz`; file đã theo dõi (ví dụ `post-n1-final-recording/raw/`) không bị ảnh hưởng. Archive `final-recording/raw/` cũ đã gỡ khỏi cây, cách lấy lại ở [raw.REMOVED.md](evidence/web-lab-to-physical/final-recording/raw.REMOVED.md).


## Nhánh phát triển R2b hiện tại

Nhánh `codex/web-lab-to-physical` giữ các thay đổi B00–B09 và nhập nguyên bản chứng cứ R2a từ source `11d25b47a18adafb88ac21adc249499109996bc5` / Lab `a7449541e118d01f65af0ad1466e0c963a173f3c`. Các bản ghi, hướng dẫn demo và metadata cloud/production phía trên là snapshot lịch sử; runtime của chúng vẫn là source `4f893ac6fb75dff414a3ee42a726defb7935c734`. HTTP CL01 hoàn thành tick 4800 / phục vụ 2; Chrome production hoàn thành tick 4810 / phục vụ 2. Tất cả giữ `accepted:false` và mô hình `not_calibrated`; qualification gốc giữ G-CLOUD1 `blocked_external`, guard bổ sung kiểm bản ghi riêng.

Runtime R2b hiện tại được xác định bằng `lab/config/source-runtime.lock.json`, không lấy từ metadata triển khai R2a. Image trong `deploy/lab-runtime/mekoniq.env.example` thuộc snapshot R2a. Image R2b vẫn `null` (chưa build); WEB05 giữ `not_run` theo R76 vì Docker không phản hồi. Lần nhập B00R2 chỉ kiểm dữ liệu đã lưu, không chạy lại cloud, browser, engine/native hay Docker; không đóng gate hoặc xác nhận R2b hoàn tất. Source giữ authority mission/journal/custody; Lab chỉ mô phỏng và replay. Qualification cuối và nghiệm thu con người còn riêng.

## Phạm vi và giới hạn

Luồng hiện có: menu có version, phiên bàn/order, KDS theo phần, allocation/giao tay hoặc simulator, ca tiền mặt, bill snapshot; isolated capture/đối soát, signed settlement grants, maintenance/import và controlled handoff. Customer claim không settlement; historical import không tạo live effect. W05–W11 thêm POS đầy đủ, robot Valetudo/ROS 2/VDA 5050, kho, nhân sự, khuyến mãi, CRM, đặt bàn, chuỗi, kênh online sandbox, SDK/Node-RED và khung provider; provider, robot và hạ tầng hosted thật vẫn chưa có (xem evidence từng task).

Các lệnh phần cứng/provider chưa có prerequisite phải thất bại rõ ràng. Không có deploy hosted, robot thật, SMTP production, commissioning hoặc RPO/RTO production trong kết quả local. Xem [kết quả kiểm tra](verification.md), `evidence/`, `gates/A-continuity.md` và `tablet-support-matrix.json` cho phạm vi từng phép đo.

Guard Cloud bổ sung: `LAB_CLOUD_EVIDENCE_DIR=docs/implementation/evidence/cloud-run/mekoniq-2026-11-14 LAB_SIMEXT_EVIDENCE_DIR=docs/implementation/evidence/sim-extension/r2a-candidate-02 pnpm test:acceptance -- cloud-run`. Guard R-MOCK đã chạy 41/41 trên commit được ghi, với log tại `lab/docs/implementation/evidence/sim-extension-r2a/mock-acceptance-02/`; bản mặc định lịch sử có thể vẫn báo `SOURCE_REVISION_STALE` khi so với HEAD khác.
