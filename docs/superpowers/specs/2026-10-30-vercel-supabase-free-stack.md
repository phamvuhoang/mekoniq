# MEKONIQ — Next.js/Vercel, Supabase Free và giao diện tablet

Ngày: 2026-10-30. Quyết định stack theo yêu cầu người dùng; **chưa có mã ứng dụng hoặc cloud deployment**. Tài liệu này thay lựa chọn NestJS/container/PostgreSQL 18 trong thiết kế ban đầu, giữ các yêu cầu nghiệp vụ, offline, bảo trì và preset `trial-service` đã duyệt.

## 1. Stack được chọn

| Vai trò | Lựa chọn |
|---|---|
| Web quản trị và web khách | Next.js App Router, React, TypeScript |
| API | Next.js Route Handlers trên Vercel, Node.js runtime; domain package độc lập framework |
| Database | Supabase PostgreSQL; baseline SQL tương thích PostgreSQL 17; local/hosted phải cùng major đã xác minh |
| Identity cloud | Supabase Auth; RBAC/venue scope, device identity và quyền offline của MEKONIQ |
| Realtime Internet | Supabase Realtime, notification có scope; dữ liệu và receipt vẫn lấy từ journal/API |
| Tệp | Supabase Storage; private buckets cho map/chứng từ, signed upload/download |
| Job nền | Durable outbox trong PostgreSQL; consumer chạy từng batch qua Next.js route; Supabase Cron + pg_net đánh thức khi có job |
| Tablet | HTML/CSS và TypeScript biên dịch thành JavaScript, Vite đóng bundle; Capacitor/Kotlin/SQLite/Keystore cho bản vận hành offline |
| Robot | Executor native hoặc Python/ROS 2 như spec đã duyệt |
| Development | Next.js local + Supabase CLI/container + tablet/native lab; không bắt buộc tài khoản cloud để viết mã |

Node.js 24 LTS dùng cho tooling và Vercel runtime khi profile hỗ trợ; pin Next.js, React, CLI và package patch trong lockfile tại W00. Không mặc định Supabase chạy major 18; `supabase/config.toml` phải khớp major của target, kiểm bằng `SHOW server_version`. [Supabase CLI config](https://supabase.com/docs/guides/local-development/cli/config).

`trial/data/public` tại baseline `5eda9b7c89d8c386891b79d56f5a9196afa23143` có `station.html`, `robot.html`, `table.html`, `setup.html`, CSS và JavaScript thuần; UI gọi Node-RED qua WebSocket. Source mới giữ hướng HTML cho tablet và hành vi quen thuộc, thay transport/session/storage bằng hợp đồng production. Browser đơn thuần không sở hữu native SQLite/LAN service; chế độ offline đầy đủ dùng app wrapper đã provision.

## 2. Cấu trúc và ranh giới runtime

```text
apps/cloud-web/                  Next.js; web quản trị/khách và HTTP API trên Vercel
  src/app/health/{live,ready}/    Route Handlers health
  src/app/v1/                    Route Handlers contracts công khai đã version
  src/app/internal/jobs/run/      Consumer batch có xác thực machine-to-machine
  src/app/(backoffice)/           Trang quản trị Next.js
  src/app/(guest)/                Menu/QR/online ordering Next.js
  src/server/modules/            Auth, enrollment, sync, relay, storage, chain, channels
  src/server/jobs/               Claim lease, dispatch, retry, reconcile, dead-letter
apps/tablet-web/                 HTML entry + CSS + DOM modules TypeScript
apps/tablet-android/             Bundle tablet-web và native plugins
packages/domain/                Domain/reducers dùng chung, không import Next.js hoặc DOM
packages/ui/                    DOM helpers, view models, CSS/tokens và i18n dùng cho tablet
packages/sync/                  SQLite/PostgreSQL ports, journal, HTTP sync
supabase/config.toml            Local config; Auth/Realtime/Storage/DB
supabase/migrations/            Một chuỗi migration cloud; không duy trì hai SQL nguồn
deploy/vercel/                  Environment/release/region profiles
deploy/profiles/                Quota, backup và capability của profile Free
```

HTML tablet dùng các route `/device`, `/pos`, `/kitchen`, `/fleet`, `/robot`, `/settings`; router cục bộ dựng screen bằng DOM và `textContent`, không nội suy dữ liệu người dùng vào HTML chưa sanitize. Fonts/audio/assets cần thiết nằm trong bundle. Không tải Next.js SSR/Server Actions để xử lý công việc trong LAN. Phần quản trị cloud có thể dùng React; domain, contract và view model giữ chung nguồn.

API public giữ `/v1/*`, health giữ `/health/*`; Next.js không bắt buộc đặt prefix `/api`. Route Handlers chỉ parse/authorize/call application service/serialize, không chứa bản domain thứ hai. Mọi mutation nghiệp vụ tại venue vẫn tới coordinator độc quyền, kể cả khi Internet tốt.

## 3. PostgreSQL, Auth và quyền offline

- Next.js dùng Supavisor transaction pooler với pool nhỏ, baseline một connection mỗi instance; tắt prepared statements nếu driver/pooler yêu cầu. Identity context dùng `SET LOCAL` trong transaction, không lưu session state qua request. Migration/backup dùng kết nối phù hợp riêng. [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres).
- Giữ NUMERIC(30,0), unique idempotency receipts, CAS, journal/audit/outbox cùng transaction. Domain schema không cho client ghi trực tiếp order/payment/ownership thông qua Data API. RLS bật trên bảng có thể truy cập; API role không BYPASSRLS.
- Supabase Auth xác thực user; MEKONIQ kiểm membership, role, venue và feature. Server dùng token đã xác minh, không chỉ decode JWT. Không tự xây password/refresh-token store cạnh tranh với Supabase Auth.
- Service/admin key chỉ ở backend cho thao tác admin đã giới hạn; không đưa vào `NEXT_PUBLIC_*`, HTML, APK hay robot. Device key và signed offline grant vẫn riêng; không kéo dài JWT Supabase đã hết hạn để giả online session.
- Coordinator có token Supabase hợp lệ có thể nhận Realtime. Khi không có token phù hợp, device đã enroll vẫn dùng signed HTTPS pull theo quyền device; không mint token giả hoặc mở public channel. Offline grant hết hạn chuyển capture-only như spec continuity.
- Invite/reset email thực cần custom SMTP khi người nhận ngoài team Supabase; local dùng mail sink. Không coi SMTP mặc định là đường email production. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## 4. Realtime và relay không mất lệnh

Lệnh từ web được lưu `pending` bền vững trước khi gửi hint. Coordinator pull command, validate owner/expiry/policy, commit ở SQLite rồi trả venue receipt. Cloud nhận durable receipt mới báo nhà hàng đã nhận. Mất hint không mất lệnh: pull định kỳ có cursor là đường phục hồi.

Supabase Realtime chỉ mang notification nhỏ như `scope/ref/revision/watermark`; payload không thay receipt hoặc journal. Private channel authorization/RLS gắn venue và user. Publisher cloud gộp hint theo venue tối đa một lần mỗi 5 giây, có trạng thái throttle trong DB để không nhân fanout khi nhiều Function chạy đồng thời. Coordinator pull catch-up giới hạn batch, có backoff khi cloud lỗi. POS/KDS/robot tại cùng LAN không cần mỗi thiết bị mở một subscription cloud.

Robot pose tick, heartbeat tần suất cao và status UI chủ yếu ở LAN. Cloud lưu mission/safety/business facts cần audit và telemetry đã giảm tần suất; không bỏ fact tài chính hoặc event an toàn để giảm quota. Realtime fanout được tính vào capacity test. [Supabase về missed events](https://supabase.com/kb/troubleshooting/realtime-postgres-changes-troubleshooting).

Thiết kế chọn Supabase cho realtime theo yêu cầu người dùng. Không dựa trên giả định Vercel vĩnh viễn không hỗ trợ WebSocket: tài liệu hiện tại đã có hỗ trợ, nhưng connection vẫn chịu lifecycle của Function. [Vercel WebSockets](https://vercel.com/docs/functions/websockets).

## 5. Job và tệp trong giới hạn serverless

Outbox nằm trong cùng transaction với dữ liệu nghiệp vụ. PostgreSQL claim job bằng lease/`FOR UPDATE SKIP LOCKED`; consumer xử lý tối đa 20 job hoặc 20 giây mỗi lượt, lưu checkpoint và trả kết quả. Job external unknown phải query/reconcile trước retry. Không dựa vào timer/process sống mãi hoặc promise chạy sau response để bảo đảm công việc.

Supabase Cron kiểm queue mỗi phút và chỉ dùng pg_net gọi `/internal/jobs/run` khi có việc đến hạn. Header HMAC có timestamp/nonce và secret lưu server-side; chặn replay và đặt timeout. Sau enqueue có thể gọi batch ngay theo cùng hợp đồng; Cron là đường phục hồi. Local runner dùng cùng consumer; cloud không cần daemon/container riêng, Vercel Queues hay Supabase Edge Functions để chạy baseline. Cron không dùng làm keep-alive giả cho Free project. [Supabase Cron](https://supabase.com/docs/guides/cron).

Map/chứng từ/CSV lớn upload trực tiếp Supabase Storage bằng signed URL, sau đó finalize manifest với scope/hash/size. Metadata commit và object upload không phải một transaction: giữ pending/missing state và garbage collection có TTL. Free profile đặt giới hạn mỗi file 20 MiB; preview/import đọc thành batch. HTTP sync giữ tối đa 1 MiB; không proxy blob qua Route Handler. Vercel Function có giới hạn payload 4.5 MB tại ngày đối chiếu. [Vercel limits](https://vercel.com/docs/functions/limitations).

## 6. Profile `supabase-free-compatible`

“Hobby của Supabase” trong yêu cầu được hiểu là **Supabase Free**. Free là điều kiện tương thích chức năng bắt buộc, không là cờ tắt nghiệp vụ. Bản đầy đủ và `trial-service` dùng cùng build, lựa chọn module bằng settings. Một project có thể chứa nhiều tenant theo RLS; không tạo project cho từng restaurant hoặc branch preview trả phí.

Snapshot quota để lập acceptance, phải đối chiếu lại khi deploy: database 500 MB; Storage 1 GB; egress thường 5 GB và cached egress 5 GB; Realtime 200 kết nối đồng thời/2 triệu message mỗi tháng; 50.000 MAU; tối đa 2 project active. Free có thể bị pause sau 1 tuần không hoạt động. [Supabase pricing](https://supabase.com/pricing).

Không dùng bắt buộc: read replica, PITR managed, image transformation trả phí, Supabase custom domain, log drain, platform audit log hoặc paid branching. App tự giữ audit nghiệp vụ; ảnh tối ưu trước upload; Vercel domain và URL Supabase chuẩn vẫn dùng được.

`deploy/profiles/supabase-free.json` chứa quota snapshot + phạm vi tính theo project/organization đã xác minh, ngưỡng cảnh báo 70% và 85%, nguồn/thời điểm đo. Capacity run đo DB bytes, objects, API/egress, Realtime fanout và tốc độ tăng journal. Dữ liệu chưa có phép đo ghi unknown, không ghi 0. Các module phải chạy được trong budget; không hứa toàn bộ tải 20 tablet/10 robot/10 command mỗi giây kéo dài cả tháng nằm trong Free.

Free fixture ban đầu: một venue, 3 tablet, một simulated robot, 20 bàn, 100 order/ngày; chạy tối thiểu 7 ngày dữ liệu mô phỏng, báo dung lượng và ngoại suy 30 ngày có hệ số overhead thực đo. Đây là workload test do MEKONIQ chọn, chưa phải mức tải đã đạt. Bộ load chuẩn lớn vẫn chạy riêng; vượt quota thì chưa đạt Free capacity ở workload đó.

Gần quota: giảm telemetry/hint không thiết yếu, báo quản trị và dừng nhận upload mới nếu không còn budget. Cloud không commit được thì không ACK hoặc xóa outbox; LAN tiếp tục, dữ liệu giữ tại thiết bị. Archive financial data chỉ theo retention/export đã kiểm restore, không xóa để làm test quota xanh. Project paused được trình bày như cloud unavailable; operator phục hồi project theo runbook.

## 7. Backup và điều kiện production

Free không có managed daily backup/PITR dùng làm prerequisite. Cung cấp `supabase db dump`/logical export được mã hóa ra vị trí độc lập, kèm Storage object manifest và bản sao tệp. Backup trong cùng Supabase project không là bản off-site đầy đủ. Auth/schema/config/keys cần inventory và restore rehearsal riêng. [Supabase backups](https://supabase.com/docs/guides/platform/backups).

Phân biệt hai kết quả: **Free functional/capacity acceptance** chứng minh phần mềm chạy với các dịch vụ Free; **production recovery acceptance** chứng minh RPO/RTO đã khai báo bằng restore thật. Mục tiêu RPO ≤5 phút/RTO ≤30 phút của production vẫn là gate riêng, có thể dùng chiến lược backup độc lập được kiểm chứng; không coi Free hoặc export thủ công tự đạt mục tiêu đó. Free-compatible build không ép nâng gói để khởi chạy, và không tự công bố SLA chưa đo.

Vercel deploy cho nhà hàng thương mại dùng gói cho phép commercial, baseline Vercel Pro. Yêu cầu Supabase Free không có nghĩa Vercel cũng miễn phí: Vercel Hobby giới hạn personal/non-commercial. Không mua hoặc tạo tài khoản trong lượt cập nhật tài liệu. [Vercel Hobby](https://vercel.com/docs/plans/hobby).

## 8. Local development và nghiệm thu

W00 tạo Next.js local + Supabase CLI với Auth/Realtime/Storage/DB thật, SQL migrations/seeds và mail sink. Không cần login/link project hosted để build/test phần mềm. Pin major/extensions và migrate cùng một nguồn ở local/staging/production. Preview Vercel dùng project test hoặc local contract fixtures, không tự nối production DB. [Supabase local](https://supabase.com/docs/guides/local-development/cli/getting-started).

Các wave có thể viết mã và chạy test local; hardware/provider/staging acceptance chỉ đạt khi chạy đúng môi trường. Kiểm offline bằng cách chặn đường tới backend local trong khi giữ LAN; POS/KDS/robot phải phối hợp trên tablet coordinator, không vô tình dựa vào máy dev như một server trong nhà hàng.

## 9. Task chịu trách nhiệm

| Task | Điều phải bàn giao |
|---|---|
| W00-T01/T04 | Next.js lifecycle, Supabase local, một migration source và transaction kernel |
| W01-T04 | HTML tablet, bundle offline và status/ACK bằng DOM |
| W02-T01/T02 | Supabase Auth, RLS, enrollment, offline grant và signed device pull |
| W02-T04/T05 | HTTP durable sync, Realtime hint/catch-up, bounded worker và Cron |
| W02-T06 | Supabase Storage, upload manifest, quota guards, profile Free |
| W03–W10 | Domain/UI theo stack mới, không thêm dependency paid bắt buộc |
| W11-T02/T03 | Capacity Free, pause/reconnect, logical backup/restore và SLO đo riêng |
| W11-T04/T05 | Vercel release + Supabase migration; Free profile thật và trial-service trên cùng build |

Không thay đổi yêu cầu ba chế độ offline, một owner cho bill/robot, replay không side effect hoặc chống thu tiền trùng khi đổi stack.
