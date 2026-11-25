# Plan 02/03 remediation — 2026-11-06

Đã sửa **R01–R12** của [code review](2026-11-06-plan-02-03-code-review.md). Reviewer độc lập đã kiểm lại diff và reproduction, kết luận không còn finding chặn trong phạm vi này. Đây là kết quả review phần mềm; không đóng gate Linux, physics, controller hay hardware.

## Revision và phạm vi

- Source `feat/lab-digital-twin-v2`: baseline `14d62c471fed0560d6a84921371240e6f4470e6f` → **`a89a077ed12648931a857333f899e3d6c1ea9719`**.
- Lab `feat/robot-lab`: baseline `a0a02d205a0996fdc160269b8c742cb6c1f70dcb`; thay runtime lock/compatibility metadata và bổ sung review/evidence, không sửa UI.
- Export source sạch bằng Node **24.22.2**; artifact **`fe49fcea31da67630fa50e6fe75418967092cee57ab9144959413a529129ce15`**. Schema giữ **`8b398544fdeb8127da0697a086283f055126075696a573dd4e8be40b00d56881`**, 29 schema, protocol 1/2.
- Giữ các feature branch hiện tại; không merge/push, không thay `trial`, không chạm ports 1880/1884. Coordinator commit/export sau khi implementer kết thúc; không có writer đồng thời trên cùng file.

## Findings đã đóng

| ID | Sửa và bằng chứng hồi quy |
|---|---|
| R01 | Artifact đầu vào từ chối cache/file không được ký; installer copy theo manifest và verify lại stage. Cache sinh sau install chỉ hợp lệ khi toàn bộ bytecode khớp source đã xác minh được compile lại, không unmarshal cache. Regression chạy installer và import từ release thực, kiểm cache giả và cache hợp lệ/optimized. |
| R02 | Signed `policyRevision` tăng đơn điệu; kiểm candidate, signer và offline window trước thay policy. Installer serialize/publish atomic; rollback release không hạ trust revision. Regression revoke → replay policy → artifact ký bởi revoked key vẫn bị từ chối. |
| R03 | AUTO_RUN chỉ completed sau execution đã quan sát rồi normal terminal; initial idle, abort, native errors không là success. Stage cần native acknowledgment và `stat.file` đúng. Error collector có lock, phân loại trước mọi outcome query, kể cả reconcile RPC trước periodic tick. |
| R04 | Restart reconcile cả accepted unfinished effects, gồm nonterminal pause. `not_found` giữ unknown qua nhiều lần restart, gate owner mới và không resend. Pending start không bị ghi đè/chuyển owner chỉ vì interpreter còn idle. |
| R05 | Write deadline tách khỏi read deadline; real socket sống qua hai chu kỳ renew 7 giây. `select`, send deadline và `SO_SNDTIMEO` xử lý backpressure/partial frame trên macOS; partial frame đóng connection. |
| R06 | Bootstrap package path trước imports. Test copied package chạy actual entry point/service với native API stub; clean exported artifact `bridge/run.py --help` exit 0 từ cwd độc lập, startup thiếu LinuxCNC exit 2 đúng prerequisite. |
| R07 | Nạp/verify digest compiled `bindings.json`, map/frame/finite pose; truyền binding/yaw/map identity vào production SourceSession. Regression dùng Python compiler thật và so execute target với output compiler. |
| R08 | Load/handoff chỉ confirm sau barrier hoàn tất đúng participants/deadline. Missing/error/wrong/late/never-resolving ACK giữ custody chưa confirm, served=0 và attention. Regression qua production domain/journal/adapter; loop không bị promise treo chặn. |
| R09 | Cache giữ source receipt, sequence và sim timestamp; clock tick không tạo sample mới. Thiếu/stale/gap coverage chặn clearance/no-contact; contact đã quan sát vẫn fail. Python SceneLoop thật → canonical TS validator/ingest → campaign artifact kiểm fresh/stale/missing; metadata receipt ở companion event. |
| R10 | ARM trace giữ boot/epoch, receipt/provider monotonic và diagnostic codes. SEQ_GAP, reordered sequence, identity/time gap, stale/unknown, nonfinite pose chặn ARM03. Live capability hết hạn; trace là copy và checker dùng snapshot bất biến. Sequence nhảy vì event xen kẽ không bị coi nhầm là mất status. |
| R11 | Static FD01/FD02 khởi động SceneLoop với schedule rỗng; shutdown join loop. Test qua actual worker main/collection step, chỉ thay boundary ROS/thread không có trên host. |
| R12 | Hai socket bind private rồi chgrp/0660 trước listen, lặp lại sau restart. Unit dùng group Lab/HMI riêng, runtime directory 0711, state 0700. Missing/same groups hoặc provisioning lỗi làm startup fail. Linux UID isolation có test riêng, chưa chạy trên macOS. |

Regression chạy red trước sửa và green sau sửa. ARM03 có 16 case mới; SIL review có 19 case mới. Bridge/release kiểm Unix socket, native API stub, installer và artifact thật; test double không phải evidence controller/physics.

## Lỗi phát hiện thêm và review độc lập

- Continuous jog vẫn chạy khi owner release/expiry/revoke hoặc bridge restart: lưu durable joint intent, stop trước nhả ownership; stop lỗi giữ intent và gate owner mới.
- Worker warm-up cần chờ clock/Nav2: startup poll có budget, không cache unavailable tạm thời. Real stdio regression phát hiện transport timeout ngắn hơn startup budget; capability request dùng deadline còn lại, command bình thường giữ deadline cũ. Khởi tạo SceneNode được serialize.
- Reviewer phát hiện reconcile RPC trước error drain và metadata sensor sai trong canonical observed. Đã sửa, reviewer chạy lại reproduction độc lập. Missing pose dùng observed:null, không còn {} vi phạm schema.
- Reviewer cuối xác nhận R01–R12 đã được xử lý, không có finding chặn còn lại trong diff đã review. Reviewer kiểm diff/test và targeted reproduction; broad check do coordinator chạy bên dưới.

## Quyết định triển khai cần giữ

- Trust policy revisionless/expired cần trusted provisioning recovery; không tự hạ revision hoặc lấy policy từ artifact. Không có private/production key trong repo; test dùng khóa tạm. Xem [restore runbook](../../../source/integrations/arm-controller/docs/restore-runbook.md).
- Hai channel dùng group triển khai riêng; client không thuộc cả hai group hoặc dùng service UID. Không đổi profile/schema để cấu hình ACL. Xem [bridge deployment](../../../source/integrations/arm-controller/docs/bridge-deployment.md).
- ARM continuity dùng receipt/provider monotonic và staleMs; UTC phục vụ audit. Phân tích lịch sử không hết hạn vì chạy muộn; capability live có hết hạn.
- CI Node job tạo Python venv để test compiler/worker Python → TypeScript là bắt buộc, không skip vì thiếu interpreter.

## Kiểm chứng cuối

Source check chạy trên commit sạch a89a077; Lab check sau import đúng artifact trên, với source/UI/tests Lab giữ nguyên baseline và runtime lock mới. Commit tài liệu sau đó không thay input thực thi đã kiểm. Lệnh/log/checksum và danh tính nằm trong [validation manifest](../implementation/evidence/digital-twin-v2/plan02-03-remediation/manifest.json).

| Bộ | Kết quả |
|---|---|
| Source contracts / typecheck / lint / build | exit 0 |
| Source unit + contracts + arm security | 25 files, **114 passed** |
| Source SQLite integration | 49 files, **406 passed, 1 skipped** |
| Python agent/hardware/schema/simulation | **267 passed, 1 skipped** |
| Python arm-controller | **108 passed, 1 skipped**, 11 subtests passed |
| Lab check:source / typecheck / build | exit 0 |
| Lab unit/integration | **161 passed, 1 skipped** |
| Browser trên pin mới | **3 passed**: service journey, arm simulation, coffee journey |
| Clean exported arm entry point | --help exit 0; controller startup **not_run**, exit 2 thiếu LinuxCNC |

Không chạy full Postgres integration vì Docker/Supabase không hoạt động trên host. ROS 2/Gazebo/LinuxCNC, Linux systemd/UID isolation, GUI, clean Linux install, ký release bằng khóa thật và hardware vẫn blocked_external/not_run. Skip không được tính thành pass của gate. Arm artifact smoke là development artifact **unsigned**, không phải release đã ký hay controller acceptance. Các khoảng trống/deferred minors ngoài R01–R12 trong handover Plans 02/03 không được coi là đã đóng bởi báo cáo này.
