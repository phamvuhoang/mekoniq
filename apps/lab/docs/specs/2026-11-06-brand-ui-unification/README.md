# MEKONIQ — Đồng bộ UI Lab, Source và Trial

Ngày: 06/11/2026 · Trạng thái: **implemented; qualification theo profile**.
Đây là yêu cầu thiết kế. Kết quả code, test và phần chưa nghiệm thu được ghi riêng tại [evidence](../../implementation/evidence/brand-ui-v1/README.md); không suy production acceptance từ trạng thái spec.

**Mục tiêu:** ba sản phẩm có cùng nhận diện MEKONIQ, nền tối theo hướng Lab, thao tác và trạng thái dễ nhận biết; giữ nguyên hành vi vận hành của từng sản phẩm. Slogan: **Intelligence in Motion.**

- [Inventory và baseline](inventory.md)
- [Verification và acceptance](verification.md)
- [Implementation plans](../../plans/2026-11-06-brand-ui-unification/README.md)
- [Manifest logo gốc](assets-manifest.json)

## 1. Quyết định kiến trúc

Đã cân nhắc ba hướng:

| Hướng | Lợi ích | Chi phí / rủi ro | Quyết định |
|---|---|---|---|
| Sửa màu độc lập ở ba repo | Nhanh cho một màn hình | Drift màu, font và trạng thái; khó kiểm phiên bản | Không chọn |
| Một thư viện React cho mọi app | Component tập trung | Lab và Tablet là DOM/TypeScript, Trial là HTML/Node-RED; buộc viết lại nhiều UI | Không chọn |
| Token + assets + CSS component chung, adapter theo stack | Đồng nhất hình thức, build/offline độc lập | Cần export có version/hash và kiểm drift | **Chọn** |

Nơi sở hữu implementation: `source/packages/ui/brand/`. Đây là package đang tồn tại, không thêm framework. Lab và Trial nhận **bản export được commit**, không import xuyên repo ở runtime, không CDN, không cần checkout Source để build. Cloud và Tablet dùng cùng CSS gốc trong monorepo. Việc export brand độc lập với pin `lab-runtime`: đổi logo không tự thay pin runtime/schema.

Một lần phát hành brand tạo `release.json` gồm `schemaVersion`, `brandVersion` (SemVer), `sourceCommit` (commit của đầu vào), `files[{path,sha256,bytes}]`. Manifest không tự hash chính nó. Hash tính trên byte file; file ổn định, không nhúng thời gian build vào CSS. Export chỉ cập nhật allowlist brand; từ chối ghi đè file lạ trong thư mục đích. Consumer kiểm toàn bộ file/hash/version trong CI, chạy được khi không có Source. Nâng brandVersion khi thay nội dung; không sửa file vendor bằng tay.

## 2. Phạm vi

| ID | Yêu cầu |
|---|---|
| UI-01 | Năm màu cốt lõi và hai màu logo giữ đúng HEX do người dùng cung cấp |
| UI-02 | Các app dùng semantic tokens, theme tối mặc định từ lần paint đầu |
| UI-03 | Logo gốc đúng tỷ lệ, không vẽ lại Q hoặc tạo wordmark bằng font UI |
| UI-04 | Typography, khoảng cách, radius, focus và component states nhất quán |
| UI-05 | Toàn bộ sáu workspace Lab được chuyển; màu overlay/telemetry vẫn có ý nghĩa |
| UI-06 | Source gồm Cloud public/login, toàn bộ backoffice, guest và Tablet/Android WebView |
| UI-07 | Trial gồm index, setup, station, robot, table, map; giữ hành vi LAN/offline |
| UI-08 | Lỗi, cảnh báo, disconnected, stale, mock/native không chỉ phân biệt bằng màu |
| UI-09 | Responsive, keyboard, contrast, reduced motion và in giấy có tiêu chí rõ |
| UI-10 | Asset/font local, export có hash, build độc lập, rollback được từng repo |
| UI-11 | Kiểm thử UI không đổi API, quyền, payload, custody, acknowledgement hoặc business state |
| UI-12 | Có screenshot matrix và evidence theo đúng commit; chỉ pass khi đã chạy |

Ngoài phạm vi: đổi navigation nghiệp vụ, thêm dashboard/tính năng mới, light-theme toggle, DB migrations, API redesign, engine simulation, hardware/HMI LinuxCNC, marketing website `web/` và presentation HTML cũ. `web/demo` là downstream export của Trial: kiểm compatibility riêng, không sửa thủ công hoặc phát hành website trong task này.

## 3. Palette và semantic tokens

### 3.1 Primitive brand (bắt buộc giữ nguyên)

| CSS token | HEX | Vai trò |
|---|---|---|
| `--mekoniq-deep` | `#071D21` | Nền app / Deep Teal |
| `--mekoniq-motion` | `#B9FB75` | CTA / Motion Green |
| `--mekoniq-iq` | `#63DCC5` | Kết nối và trạng thái active / IQ Aqua |
| `--mekoniq-accent` | `#FF9F68` | Warning và điểm nhấn / Energy Orange |
| `--mekoniq-paper` | `#F6F8F4` | Chữ chính / Paper White |
| `--mekoniq-logo-dark` | `#0B2A2D` | Biến thể nền logo |
| `--mekoniq-logo-orange` | `#FFAA76` | Chấm Q trong logo; không thay bằng accent |
| `--mekoniq-secondary-dark` | `#0D2B2E` | Surface tối |
| `--mekoniq-ink` | `#143034` | Chữ trên nền sáng/in giấy |
| `--mekoniq-muted` | `#547078` | Màu bổ trợ; không phải chữ phụ theme tối |
| `--mekoniq-forest` | `#2B8169` | Màu bổ trợ trên nền sáng |
| `--mekoniq-light` | `#EDF4F0` | Nền sáng bổ trợ/in giấy |
| `--mekoniq-tray` | `#292F30` | Vật liệu robot, không phải surface UI |
| `--mekoniq-metal` | `#99A6A4` | Vật liệu robot, không phải disabled token |

### 3.2 Semantic dark theme v1

| Token | Giá trị | Quy tắc |
|---|---|---|
| `--mq-bg` | `var(--mekoniq-deep)` | Nền chính |
| `--mq-surface` | `var(--mekoniq-secondary-dark)` | Card/panel |
| `--mq-surface-raised` | `#102F34` | Menu/dialog/hover secondary |
| `--mq-text` | `var(--mekoniq-paper)` | Nội dung chính |
| `--mq-text-muted` | `#A8C2C6` | Mô tả, metadata, placeholder có label riêng |
| `--mq-border` | `#29474D` | Separator trang trí, không làm dấu hiệu duy nhất của control |
| `--mq-control-border` | `#65858B` | Input/control cần nhận diện đường biên |
| `--mq-primary` | `var(--mekoniq-motion)` | CTA và selected accent |
| `--mq-on-primary` | `var(--mekoniq-deep)` | Chữ/icon trên CTA |
| `--mq-info` | `var(--mekoniq-iq)` | Running, connected; kèm chữ |
| `--mq-success` | `var(--mekoniq-motion)` | Hoàn tất đã xác nhận; kèm chữ/icon |
| `--mq-warning` | `var(--mekoniq-accent)` | Attention, retry, blocked external; kèm reason |
| `--mq-danger` | `#FFAAA0` | Failure/destructive; giữ tông đỏ của Lab, không biến thành xanh |
| `--mq-on-danger` | `var(--mekoniq-deep)` | Chữ trên nút destructive filled |
| `--mq-focus` | `var(--mekoniq-iq)` | Outline 2px, offset 3px trên nền tối |

Màu dẫn xuất `surface-raised`, text-muted, border và danger là **UI extension**, không sửa palette logo. Focus trên nền sáng/inverse dùng Deep Teal. Hover CTA giữ màu gốc, thêm inset border Deep Teal 2px; active thêm inset border 3px, không scale hoặc dịch chuyển nút. Secondary hover dùng raised surface. Không giảm opacity toàn card để biểu diễn offline/unknown; giữ nội dung đọc được.

Badge dùng nền surface, chữ theo status, border cùng status nếu có ý nghĩa; không dùng các pill nền sáng hiện tại của Trial với chữ trắng. Link trong văn bản dùng Aqua + underline. Nút disabled dùng surface-raised/text-muted, `disabled` thật hoặc `aria-disabled` kèm chặn hành động đúng control; có lý do khi cần. Loading giữ độ rộng nút, nhãn đang xử lý, `aria-busy`; không gửi lại command.

### 3.3 Contrast đã tính từ HEX (sRGB)

| Foreground / background | Ratio xấp xỉ | Kết luận cho chữ nhỏ |
|---|---:|---|
| Paper / Deep | 16.29:1 | Đạt |
| Deep / Motion | 14.19:1 | Đạt, dùng cho CTA |
| Aqua / Deep | 10.42:1 | Đạt |
| Orange / Deep | 8.63:1 | Đạt |
| Muted Teal / Deep | 3.29:1 | **Không đạt**, không dùng cho caption nhỏ |
| UI muted / Raised | 7.57:1 | Đạt |
| Control border / Raised | 3.57:1 | Đạt cho đường biên control |
| Danger / Raised | 7.79:1 | Đạt |
| Orange / Paper | 1.89:1 | **Không đạt** |
| Paper / Motion | 1.15:1 | **Không đạt**, không dùng chữ trắng trên CTA |

Đây là kiểm tra cặp màu lý thuyết, chưa phải kết quả accessibility của UI render. Test phải tính contrast trước khi làm tròn và xét nền thực sau alpha/overlay. Text thường ≥4.5:1; text lớn theo định nghĩa WCAG ≥3:1. [Nguồn: W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Dấu hiệu cần để nhận diện control/trạng thái ≥3:1 với màu kề; separator trang trí không đồng nghĩa với control border. [Nguồn: W3C Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## 4. Logo, font và layout

### Logo

Các file người dùng cung cấp đã được sao chép nguyên byte vào `assets/`; xem checksum trong manifest. Đây là reference cho spec, không phải asset được app sử dụng sẵn.

- Header rộng: `MEKONIQ_Horizontal_White_Transparent_v2.png`, CSS width 170–200px, height auto. Trên màn hẹp dùng icon SVG 36–40px với accessible name MEKONIQ; không ép logo ngang co nhỏ dưới 140px.
- Icon/favicon: `MEKONIQ_Icon_Transparent.svg`. Có thể tạo favicon raster ở bước implementation bằng asset pipeline, giữ nguồn gốc và hash; không tạo logo mới.
- Wordmark rời: `MEKONIQ_Wordmark_White_Transparent.png` khi icon đã hiện bên cạnh. Không ghép thêm chữ MEKONIQ bằng CSS.
- SVG horizontal và wordmark hiện chứa `<text font-family="DejaVu Sans,Arial,sans-serif">`, chưa outline: giữ file làm nguồn nhưng dùng PNG đã cung cấp cho render ổn định. Sau này thay bằng outlined SVG chỉ khi có asset được chốt; không tự đổi nét chữ.
- Không filter/recolor/stretch/crop artwork. File logo DeepTeal có nền chỉ dùng trên nền DeepTeal; bản trắng trong suốt dùng trên nền tối. Không đặt logo trắng lên Paper.
- Clear space ngoài hộp asset tối thiểu 8px ở header, 16px ở login. Brand link có accessible name; ảnh trang trí trong link đã có tên dùng alt rỗng để tránh đọc lặp.
- Slogan đúng `Intelligence in Motion.` ở login/home/about; không chiếm toolbar vận hành hoặc dịch tùy ý.

### Typography, spacing, motion

- Font UI: **Be Vietnam Pro 400/700**, tận dụng WOFF2 Latin/VI và OFL đã có trong Source/Trial; self-host qua export. Không thêm Google Fonts/CDN. Japanese fallback: `"Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif`; không khẳng định font JP được bundle. Font số/code: **JetBrains Mono 500** local đang có ở Trial, xuất chung kèm license.
- Body 16px/1.5; Lab/table dense được 14px/1.5; caption tối thiểu 12px/1.5; h1 28–32px/1.2; h2 20px/1.35. Weight chỉ 400/700; giá trị số dùng tabular-nums. Tôn trọng zoom, không khóa user-scalable.
- Spacing: 4, 8, 12, 16, 24, 32, 48px. Radius: input/button 10px, panel 16px, modal 20px, badge 999px. Padding panel 24px desktop, 16px mobile. Header 72px desktop/64px mobile, có thể cao hơn khi text wrap; không cắt bản dịch.
- Button thông thường ≥44×44px; Tablet/Trial primary ≥56px chiều cao, **giữ mức 72/92px** hiện có của command buttons. Khoảng cách touch controls ≥8px. 44px là policy sản phẩm, không gán nhầm là ngưỡng AA 24px của [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- Transition chỉ color/background/opacity 120–180ms; không blur/glassmorphism, không CTA nhảy khi hover, không animation logo vô hạn. `prefers-reduced-motion: reduce` bỏ animation trang trí và smooth scroll; telemetry vẫn cập nhật dữ liệu cần thiết.
- Lab giữ cấu trúc topbar/workspace/inspector; Cloud giữ route và permission; Tablet/Trial giữ nhóm thao tác theo vai trò. Đồng bộ component, không buộc mọi app chung sidebar.

## 5. Component contract

CSS chung dùng prefix `mq-`, token prefix `--mq-`; không global reset vào DOM bên thứ ba. `tokens.css` chỉ khai báo variables; `components.css` chứa `.mq-button`, `.mq-field`, `.mq-panel`, `.mq-badge`, `.mq-alert`, `.mq-table`, `.mq-brand`, `.mq-skip-link`. App tự giữ layout và events. Class cũ được alias có thời hạn trong từng app; không đổi `data-action`, ID hoặc locator nghiệp vụ chỉ để đổi style.

| Component | States / hành vi bắt buộc |
|---|---|
| Button | Primary/secondary/destructive; default/hover/focus/pressed/disabled/loading; icon có tên; không biến Stop/Cancel thành CTA xanh |
| Field/select/checkbox | Label rõ, helper/error liên kết aria-describedby, invalid qua aria-invalid; checkbox không bị CSS text-input kéo full width; browser autofill và select option đọc được |
| Navigation | Current qua aria-current, keyboard focus; mobile wrap/collapse có nút mở thật, không chỉ hover; không thay điều kiện permission |
| Dialog/menu | Focus vào vùng hợp lệ, Escape theo semantics hiện tại, trả focus cho trigger; không che thao tác quan trọng |
| Table | Header đúng, row focus/selected nhìn thấy, vùng overflow có label và cuộn keyboard; trang không overflow ngang |
| Toast/banner | Error role alert; thông tin thường role status; offline/stale luôn có chữ, không tự mất trước khi đọc |
| Chart/map/3D | Giữ màu vật lý/occupancy/axis khi có ý nghĩa; palette UI không đổi geometry/material calibration; legend, kiểu nét/marker, dữ liệu tương đương trong DOM |

Verification state không suy ra từ màu: `implemented`, `verified_mock`, `verified_native`, `accepted`, `not_run`, `blocked_external`, `failed` luôn hiện nhãn và reason phù hợp; không đổi pass/fail hoặc runtime capability để đạt screenshot. Run pending và completed phải khác nhãn dù cùng dùng accent.

## 6. Responsive, offline và print

Theme tối áp dụng ở root trước render/hydration (`color-scheme: dark`); không phụ thuộc localStorage hoặc OS để tránh flash sáng. Không thêm theme toggle trong v1.

Breakpoints tham chiếu: <768px compact, 768–1199px tablet, ≥1200px desktop. Ở 390px logo/icon, language và trạng thái không đè nhau; không che bàn phím ảo bằng fixed CTA. Header/toolbar wrap được; table và canvas được cuộn trong vùng riêng. Lab canvas có 2D/WebGL fallback và control DOM; không yêu cầu render chữ 3D thay thế DOM để đạt accessibility.

Logo, CSS và font phải load từ cùng app và hoạt động offline trong chế độ app vốn hỗ trợ. Next build không fetch font remote. Android WebView nhận CSS từ Tablet bundle; native launch icon/splash giữ nguyên trong phạm vi này. In bill/report dùng `@media print`: Paper/white background + Dark Ink, bỏ nền trang trí/shadow, giữ tổng tiền/trạng thái/QR đúng. Không invert ảnh món ăn hoặc QR bằng CSS.

## 7. Acceptance và rollout

Chuyển lần lượt Foundation → Lab → Source Cloud/Tablet → Trial → qualification. Các app pin cùng `brandVersion` trước nghiệm thu đồng bộ. Mỗi repo có commit/release riêng để rollback; không yêu cầu thay DB hoặc deploy đồng thời. Trial chỉ chạy trong môi trường cô lập theo `trial/docs/testing.md`; không khởi động Node-RED production hay publish flow ra robot.

Spec hoàn thành khi tài liệu có đủ mapping và plan. Implementation chỉ được gọi hoàn thành khi UI-01…12 có evidence theo [verification](verification.md). Native/hardware/usability gates đang có không được đóng bằng việc đổi theme.
