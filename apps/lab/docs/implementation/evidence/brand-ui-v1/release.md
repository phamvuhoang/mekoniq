# Brand UI 1.0.1 — release receipt

## Phạm vi

Implementation trên ba nhánh `feat/brand-ui-v1`; preview Cloud/Lab và gói kiểm thử local. Chưa merge main, push hoặc promote production trong đợt brand UI này. Không chạy migration Supabase; không sửa secrets hay operational Node-RED.

Code cuối: Lab `c806dcc`, Source `8a52cb6`, Trial `23cc7ce` (full SHA ở index; commit docs riêng có thể mới hơn).

Canonical input commit `3f31af9` ở Source. `release.json` có full SHA và hash của 22 payload files; bốn bản consumer (Lab, Cloud, Tablet, Trial) phải trùng byte. `check:brand` chạy trong build/app build và Trial test.

## Kiểm tại local

Dùng Node 24.22.2, pnpm 10.32.1. Tại từng repo:

```sh
# Source
pnpm check:brand
pnpm typecheck
pnpm lint
pnpm contracts:check
pnpm test:unit
pnpm build
# E2E dùng Supabase local + harness test; không dùng hosted production DB
pnpm test:e2e

# Lab
pnpm check:brand
pnpm check:source
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:twin-e2e

# Trial — chỉ dịch vụ smoke cô lập, không npm start production
npm test
node scripts/smoke-review.js
```

Lab offline package tại `lab/releases/brand-ui-v1-macos-arm64`: 73 file, BV01 mock đã chạy thành công, browser chỉ truy cập loopback. Đây không phải kiểm OS network-off trên máy Linux sạch. Fonts/logo được đóng gói local.

Source Android debug APK build thành công với SDK local; chưa có tablet được kết nối/enroll để xác minh WebView và native offline persistence. Không dùng APK build để gọi Android acceptance pass.

## Preview và production

| App | Preview | Production hiện tại |
|---|---|---|
| Lab | [Preview](https://mekoniq-pcioivxhv-henry-projects.vercel.app), `dpl_GCMxdN65ZPfmVBEsiJF7S64o83xr`, code `c806dcc` | `dpl_8mrCQrioNr5KxJemSLsipT69TdxY`, code `357d669`, chưa đổi |
| Cloud | [Preview](https://mekoniq-61bz7zou2-henry-projects.vercel.app), `dpl_DE1JV5PgvJeuWmrvk7jrgAEAkkHi`, code `d9ebd82` | `dpl_CcBZLcno1LHvP3YvZu4GY8KQyhf2`, code `5c86337`, chưa đổi |
| Trial | Isolated Node-RED + static export/package | Chưa cập nhật runtime vận hành |

Cloud preview pin `d9ebd82`; diff từ đó đến Source `8a52cb6` chỉ gồm Tablet screens/style/test. `apps/cloud-web`, shared packages, scripts và lockfile trùng byte (git diff exit 0), nên preview vẫn đúng code Cloud cuối.

Preview giữ Vercel protection. Lab HTTP home và brand receipt trả 200 qua authenticated CLI, release bytes khớp. Browser remote đã kiểm sáu route Lab và Cloud home/login/anonymous admin redirect bằng cookie protection do CLI cấp cho account đang đăng nhập. Đã đợi font và ảnh decode, kiểm dark background/no horizontal overflow/no page errors. Không tắt protection; không đăng nhập app bằng account khách hàng hay ghi hosted DB.

## Rollback

Lab baseline `357d669` đã được dựng lại từ git archive sạch và mở bằng Chrome qua static localhost: main hiển thị, không page error. [Receipt](rollback-lab.json). Dùng dependency lock hiện có; đây là rehearsal local, không chuyển alias production.

Trial đã rehearse restore baseline `6298f83` rồi phục hồi 56 public files, kiểm hash và brand checker; [receipt](trial/rollback.json). Export tạm giữ nguyên ba Web-specific files; package giữ đủ 22 brand hashes.

Khi rollout production được yêu cầu, promote từng preview đã xác minh; nếu lỗi, quay alias về deployment ở bảng trên. Không reset DB, journal, device enrollment hoặc robot state. Cloud rollback dùng deployment đang live trước đợt này; thao tác chuyển alias chưa chạy. Trial restore toàn bộ static release cùng phiên bản trong maintenance window, không restore context/credential bằng gói UI.

## Các phần còn cần nghiệm thu

- Native Android/WebView trên thiết bị được enroll: `blocked_external`, cần thiết bị.
- Preview authenticated app workflow: chưa chạy trên hosted DB; anonymous redirect đã pass remote, local auth/guest/RBAC được kiểm bởi E2E.
- Manual 200% browser zoom, toàn bộ dialog focus return và guided usability: chưa ghi nhận nghiệm thu đầy đủ. Responsive/reduced-motion/keyboard probes đã có phạm vi riêng trong logs.
- Production promotion, Trial operational smoke, Cloud production rollback switch: `not_run` trong phạm vi implementation này.
- Native ROS/Gazebo/LinuxCNC, safety và hardware: giữ nguyên trạng thái từ roadmap; brand UI không cung cấp thêm bằng chứng vật lý.
