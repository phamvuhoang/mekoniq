# Quyết định triển khai và chi phí nếu cần đổi

Các quyết định dưới đây được ghi khi thực hiện trên hai branch hiện tại. Không quyết định nào nâng mock/protocol double thành native/hardware evidence.

1. use current branches rather than new worktrees — explicit user request — cost if wrong: changes share working tree and require file-scoped staging.
2. manually extract Ixx/Nxx/Rxx task briefs — skill script only recognizes Task N headings — cost if wrong: re-extract brief if plan changes.
3. readiness lives under existing /lab/v2 namespace — keeps pairing/origin protections — cost if wrong: client URL update.
4. required scenario backends determine admission; preserve all-enabled default manifest — aligns matrix/CLI/runtime and fixes false readiness — cost if wrong: consumers expecting unused backend denial must adapt.
5. readiness POST accepts project with CSRF for role/world validation while GET remains environment-only — source admission must bind actual project, not just backend availability — cost: one additional API shape to maintain.
6. preserve legacy standalone barrier ACK while requiring correlated proof for combined transfer — existing FD protocol remains compatible — cost: two proof kinds, combined runner must reject legacy proof.
7. capability-denial test now uses registered FD01 instead of retired placeholder C01 — scenario-scoped admission must resolve a real scenario first — cost: test fixture name changes; no production denial was loosened.
8. optional armTickMap explicitly maps controller sample indices to run ticks — replay cannot compare unlike clocks/indices — cost: nativeproducer must supply mapping or UI remainsnot_run.
9. native UI follows autonomous engine telemetry and refuses mock step/auto-run — Gazebo advertises step:false — cost if wrong: add explicit per-backend stepping capability later.
10. native create failure preserves attempt directory — journal may contain issued effects — cost: abandoned attempts require explicit operator retention cleanup.
11. N01 same-volume VM budget is140GiB (120VM+20system), split-volume120+20 — preserve host reserve without double allocation — cost: conservative admission may require larger disk.
12. fault duration ends the injection window, not its persistent physical/domain consequence — silently restoring a lost cup/reboot would fabricate recovery — cost: users must explicitly reconcile or start a new run.
13. stage custom QtVCP screen and rewrite package paths in a private smoke config — copied INI relative paths otherwise break native launch — cost: staged config differs in paths/display and must be captured separately.
14. GUI close is manual_verification_required/not_run until independent checklist — process exit cannot prove operator tasks — cost: operator must add actual action evidence, never a false GUI pass.
15. v2 installed artifacts must retain declared nonempty schemas on launch/rollback/repackaging; v1 legacy fixtures may omit them — preserve old protocol while enforcing v2 pinned contracts — cost: corrupted/old incomplete v2 package requires trusted reinstall.

## N05 — SIM grip và bằng chứng độc lập

1. Add optional acquire `simulationScene` pin to negotiate immutable run/world identity before accepting scene updates. Without this extension the first arbitrary scene would choose its own authority context. Cost if wrong: peer compatibility requires schema/profile re-pin; old bridges intentionally block.
2. Separate virtual-grip events from command completion and persist their own outbox. Cost if wrong: receiver/driver needs to consume actual proof events instead of completion flags; N06 integration must not discard them.
3. Reuse exact settled journal identity only for lost/unknown physical observations after a confirmed transfer. It never creates a new pending transfer or grants custody. Cost if wrong: overly restrictive old-correlation logic can hold a run for reconcile; it cannot silently move domain ownership.
4. Treat translated DH-derived poses and separately modeled chassis/tray sweeps as portable reference geometry, with native Cartesian interpolation/IK/trace still not_run. The old whole-footprint robot extrusion is unsuitable for native handoff checks because it merges tray contact with the chassis. Cost if wrong: a native trajectory or transformed fixture may still collide and must fail the native gate.
5. Keep physics cup geometry/position coupling explicitly modeled. `cup_pose` is only a world effect; independently observed occupancy, giver proof and dock remain required. Cost if wrong: native pose/sensor timing or carry orientation needs a later native correction; no pass is inferred from the ACK.

Force current process identity for recovery proof rather than accepting the normal one-second boot cache or inventing a fallback. Cost if wrong: an unavailable /proc/process probe, or an older bridge/journal lacking the new identity metadata, holds recovery for explicit reconciliation. It does not confirm custody from uncertain continuity. The source/controller runtime artifact must be re-pinned together before combined native execution.

## Fault schedule

- Faults thuộc project revision đã khóa, snapshot ghi hash; không tạo run configuration thứ hai có thể thay đổi. Chi phí nếu sai: cần migration project/schema.
- Schema fault schedule được mirror chính xác ở Lab và so với runtime pin. Chi phí nếu sai: client cũ phải re-pin trước khi dùng schema mới.

## Native coordinator và review cuối

1. CLI và gateway dùng cùng CoffeeDriver/domain/cup ledger; FD giữ navigation runner riêng, BV01 dùng combined provider. Chi phí: hai composition phải tiếp tục giữ cùng contract và required-backend registry.
2. Native pause/step/autoplay chưa được provider hỗ trợ nên UI từ chối trước effect. Chi phí: chỉ quan sát autonomous telemetry; thêm stepping cần capability mới.
3. Reopen native journal là read-only và không tự acquire/replay chuyển động. Chi phí: outcome không chắc chắn cần operator disposition/reconcile trước run mới.
4. Shared fault schedule được kiểm target/phase và ghi intent trước injection. Controller restart dùng policy server-owned, chờ operator đổi boot/epoch thật; không trao shell hay operator socket cho browser. Chi phí: restart native cần thao tác ngoài UI và deadline rõ ràng.
5. Negative fault oracle chỉ chấp nhận một fault đã khai báo, kiểm identity/schedule đầy đủ và coverage trước injection. Chi phí: mỗi negative case cần config/run riêng; không suy ra physics sau khi mất provider.
6. Fake workers mang nhãn protocol_double; các assertion physics cũ được giữ ở pure assessment tests. Chi phí: test adapter không còn được dùng làm bằng chứng native.
7. Các lần full suite bị lỗi hoặc chủ động dừng được lưu riêng; chỉ exact-HEAD cuối mới dùng cho qualification. Chi phí: thời gian chạy lại suite, không tái dùng JSON cũ.
8. Whole-branch review đọc các task ổn định song song với N06 fix, rồi nhận final committed delta trước verdict. Chi phí: reviewer phải kiểm lại các boundary bị delta thay đổi.
9. Native worker/agent/resource closure được export và snapshot; controller inventory phải khớp cùng profile/code. Chi phí: mọi thay đổi byte được pin cần export/re-pin mới, kể cả thay environment lock sau qualification.
10. Delivery domain đã xác nhận tạo physical table projection idempotent trong journal, không giả sensor observation. Chi phí: giữ correlation recovery và table transform trong fixture.
11. Native report giữ clock origin/business epoch cùng raw provider timestamps; replay và CSV chuẩn hóa theo run ticks. Chi phí: report cũ thiếu mapping không được suy đoán timeline native.
12. Autonomous hold làm tăng revision khi state thay đổi; SSE heartbeat lấy snapshot và polling dùng revision. Chi phí: thêm snapshot request, không tăng revision cho từng telemetry poll.
13. Native wire deadline đo controller wall clock qua lease renewal, uncertainty ≤250 ms và skew ≤5 s cộng uncertainty; SQLite giữ expiry đầu tiên. Chi phí: mạng chậm/đồng hồ lệch bị chặn, cần đồng bộ host/VM; retry không được gia hạn command.

14. Browser qualification bắt được panel đóng khi đổi fault; lưu disclosure state qua render thay vì ép locator hoặc mở lại panel trong test. Chi phí: duy trì một UI state boolean, không thay domain/fault authority.
15. Full-suite exporter fixture phải copy cả helper nhập tĩnh; sửa fixture, không nới assertion clean-source/cleanup. Chi phí: fixture phải theo dependency closure của exporter.

16. Sửa browser journey để refresh readiness sau khi đổi project, dùng nút hiện có; không cho snapshot cũ authorize run. Chi phí: thêm một thao tác kiểm tra trước Start.
17. Khi host ENOSPC và Docker restart, giữ failed attempt và chạy suite tuần tự sau khi services healthy; chỉ xóa artifact superseded do task tạo. Chi phí: thêm thời gian qualification, không đánh đồng môi trường hồi phục với suite pass.
