# Plan 01 code review — F01–F08 / R-MOCK

Ngày review: 2026-11-05. Kết luận: **request changes**. Chưa nên merge nguyên trạng; chưa có cơ sở nghiệm thu R-MOCK. Review này không sửa implementation hoặc thay acceptance status.

## Phạm vi và revision

- Lab: `4323f3d..dfa05c25694ea339e44bc2b4f0ce1e69fedc274f`.
- Source: `e3b616a..e15281409065a19669532dc1c659529d65b3959f`.
- Runtime đang pin `d473d87`; đã kiểm `packages/` không khác giữa pin và source HEAD. Không yêu cầu repin chỉ vì commit acceptance-test thay đổi.
- Đối chiếu [Plan 01](../plans/2026-11-05-digital-twin/01-foundation-mock.md), [contracts](../specs/2026-11-05-digital-twin/architecture-contracts.md), [verification](../specs/2026-11-05-digital-twin/verification.md), evidence và ledger local.
- Review độc lập coffee domain/production integration, runtime/recovery/telemetry, Lab UI/project/artifact/report và test backup đang thất bại.
- Không coi 18 rows NOT_IMPLEMENTED là lỗi mới; không yêu cầu chạy Gazebo/LinuxCNC/hardware trong review Plan 01. Các lỗi dưới đây nằm trong behavior hiện đã expose/claim hoặc integration với production domain.

Severity: P2 = lỗi chức năng cần sửa trong chu kỳ này; P3 = hardening ưu tiên thấp. Không có finding nào ở đây chứng minh robot/servo thật đã thực thi lệnh; runtime hiện chỉ mock.

## R01 — P2: Cup removal bị reject, giữ trạng thái cốc đã xác minh

**Code:** [job.ts](../../../source/packages/domain/src/beverage/job.ts), dòng 26–30; [module.ts](../../../source/packages/domain/src/beverage/module.ts), dòng 67–82.

`Coffee.ObserveCup(present:false)` chỉ chuyển job sang attention nếu đang `dispensing`; ở `cup_verified` hoặc `started` nó bị reject. Vì toàn bộ decision bị từ chối, `cup.present` vẫn true và job vẫn hợp lệ để chạy.

**Repro:** verify cup → sensor báo lấy cốc ra → `Coffee.StartJob` → `Coffee.StartStep`. Qua production registry và authorization: removal trả `CUP_ABSENT`, nhưng StartJob/StartStep accepted, tạo một brew effect, `cup.present:true`. Cũng cần kiểm removal khi verifying/ready_for_pickup.

**Hậu quả:** domain vẫn cấp việc dựa trên điều kiện đã mất. Mock plant có guard độc lập nên đây chưa phải bằng chứng dispense vật lý; guard đó không sửa được truth và admission của domain.

**Sửa / regression:** lưu observation vắng cốc, vô hiệu hóa cup verification theo state; chặn preparation/quality/transfer cần cup cho tới khi có evidence hợp lệ mới. Test removal trước start, giữa steps và trước quality/pickup.

## R02 — P2: Transfer không kiểm arm readiness/fault/freshness

**Code:** [module.ts](../../../source/packages/domain/src/beverage/module.ts), dòng 168–185, đặc biệt 183.

`Cup.RequestTransfer` lấy arm và phát `start_job` sau acquire lease mà không gọi `interlock(c, arm)`. Path brew đã kiểm interlock, nhưng pick/place thì không.

**Repro:** bound observer cập nhật arm thành `fault`, sau đó request cup→arm. Cả observation fault và request transfer accepted; request tạo một execution effect. Đây không phải deferred collision hoặc stop model.

**Sửa / regression:** kiểm readiness, fault, freshness và các interlock phù hợp trước ghi transfer/effect, cho cả pick và place. Fault/offline/stale phải không tạo effect, không giữ lease mới do một request đã bị từ chối.

## R03 — P2: Order hai cốc bị chặn sau cốc đầu do đếm trùng

**Code:** [module.ts](../../../source/packages/domain/src/beverage/module.ts), dòng 54–56.

`open` đếm mọi job không cancelled/quarantined, gồm cả job đã quality-confirmed/delivered; sau đó cộng thêm `ticket.prepared`, dù lượng prepared đã đại diện cho chính các job ấy.

**Repro:** kitchen line quantity=2, prepared=1, một coffee job delivered và resources đã giải phóng. Reserve cốc thứ hai trả `JOB_EXCEEDS_ORDER` thay vì accepted.

**Sửa / regression:** phân biệt jobs còn giữ capacity chưa được ghi prepared với jobs đã ghi prepared; test prepare/deliver từng cốc của cùng order line, gồm cả cancel/remake đúng quantity ledger.

## R04 — P2: Recipe lặp nguyên liệu chỉ ghi tiêu hao bước đầu

**Code:** [resources.ts](../../../source/packages/domain/src/beverage/resources.ts), dòng 53–57 và 65–76.

`reserveStock()` gắn toàn bộ resource vào `recipe.steps.find(...)`, tức step đầu tiên có kind tương ứng. Sau completion đầu, reservation thành consumed; bước sau cùng nguyên liệu không còn reservation để ghi stock movement.

**Repro:** recipe được `parseRecipe` chấp nhận, gồm `milk-a` 80 mL + `milk-b` 80 mL, tổng resource 160 mL. On-hand ban đầu 2000 mL; sau hai measured completions chỉ còn 1920 mL, thay vì 1840 mL. Bước hai tạo 0 stock movements.

**Sửa / regression:** phân bổ reservation/consumption theo từng step hoặc theo quantity remaining, giữ dedup job+step+ingredient; kiểm conservation giữa measured dispense, movements và reservation còn lại. Nếu muốn cấm repeated ingredient steps, schema/recipe admission phải reject rõ trước run, không âm thầm ghi thiếu tồn kho.

## R05 — P2: Giao thủ công tăng served nhưng bỏ quên coffee job/cup/resources

**Code:** [module.ts](../../../source/packages/domain/src/beverage/module.ts), dòng 154–158 và 262–280; path hiện có [fulfillment/handoff.ts](../../../source/packages/domain/src/fulfillment/handoff.ts), dòng 4–10.

Quality confirmation xuất normal fulfillment readiness, nên đường manual delivery vẫn nhận được cốc này. Coffee lifecycle chỉ được nối vào `Mission.ConfirmStop`, chưa có manual fulfillment hook.

**Repro:** coffee ready_for_pickup → waiter chỉ có `fulfillment.write`, qua `authorizeVenueCommand` → manual allocation → `Fulfillment.HandOff`. Kết quả accepted/served=1, nhưng CoffeeJob vẫn ready_for_pickup, cup vẫn owner cell. Machine/nozzle leases của một job thực chưa được giải quyết.

**Hậu quả:** khách đã được ghi nhận phục vụ nhưng custody/job/resource khác truth; quầy có thể bị giữ resource vô thời hạn hoặc xử lý cốc đã giao như cốc còn tại quầy.

**Sửa / regression:** một transaction human handoff phải cập nhật fulfillment, cup movement, job completion và resources; hoặc chặn manual path cho coffee tới khi có supported command. Không âm thầm thành công một phần. F04 đã yêu cầu manual/operator handoff với human provenance.

## R06 — P2: Lệnh mới tự xóa localization loss lúc robot idle/đang chờ

**Code:** [mock-amr.ts](../../../source/packages/lab-runtime/src/v2/backends/mock-amr.ts), dòng 125–138, đặc biệt 138.

Fault đặt robot stale, nhưng khi không có executing goal thì không phát observation để source giữ mission. `execute()` kế tiếp không kiểm condition này và tự đặt `r.stale=false`.

**Repro:** FD01 seed 42 → start → inject localization-lost trước order đầu → step tới cuối. Kết quả completed, served=1, attention rỗng, ba execute effects, pose valid. Chưa có action/evidence nào khôi phục localization. Cùng vấn đề xảy ra ở khoảng chờ load/handoff.

**Sửa / regression:** giữ localization-loss condition cho tới explicit recovery evidence, chặn dispatch/arrival khi chưa resolve. FD08 phải test cả idle, waiting-stop và đang di chuyển.

## R07 — P2: Telemetry mất thay đổi trạng thái trong cùng simulation tick

**Code:** [twin-projection.ts](../../../source/packages/lab-runtime/src/v2/twin-projection.ts), dòng 7–12; [telemetry.ts](../../../source/packages/lab-runtime/src/v2/telemetry.ts), dòng 9–16.

Sample identity là `seq=tick`; recorder và publisher dedup theo bootId+seq. Fault/confirm/action có thể thay state mà không tăng simulation tick, nên sample mới bị bỏ.

**Repro:** FD01 đang di chuyển → pause tick 125 → localization-lost. Snapshot: stale, moving=false. `telemetry.latest()`: vẫn cùng object cũ, valid, moving=true, seq=125. Khi pause, lỗi tồn tại vô hạn trong stream/report telemetry, không chỉ chậm một frame.

**Sửa / regression:** sample sequence phải độc lập sim time và tăng khi publish state mới. Giữ `simTimeNs` để định vị thời gian; kiểm action-boundary samples và reconnect cursor khi nhiều trạng thái cùng tick.

## R08 — P2: Replay cà phê giữ trạng thái cuối của cốc/job/arm

**Code:** [workspace.ts](../../src/ui/workspace.ts), dòng 40–43; [coffee-cell.ts](../../src/twin/coffee-cell.ts), dòng 50–72.

Replay frame chỉ thay AMR poses, giữ nguyên final `view.tick`, served, coffee jobs/cup owners và report. Arm inspector luôn chọn sample cuối.

**Repro:** harness chạy TwinWorkspace thật với completed coffee view, tick=1000, cup customer:table-1. Replay cursor về 0, recorded events tại cursor chỉ có cup registration; scene vẫn hiển thị cốc tại bàn khách, tick 1000 và served=1. Đây là fixture kiểm boundary của workspace, không phải video/screenshot tự suy diễn.

**Sửa / regression:** dựng projection của toàn bộ display state tại cursor; chọn joint/measurement/cup ownership theo timestamp. Test BV01 tại trước brew, sau brew, trên arm, trên robot và sau customer handoff; không thay event history bằng final state.

## R09 — P2: Freshness đổi nhưng scene/inspector không repaint

**Code:** [workspace.ts](../../src/ui/workspace.ts), dòng 56–60.

Ticker repaint scene chỉ khi applied-sample/epoch counters tăng. Data freshness phụ thuộc thời gian và link state, vốn có thể đổi khi không nhận sample mới.

**Repro:** sau 1 giây sample silence nhưng heartbeat còn sống, chip đã báo `stale 1.0 s (AGE_EXCEEDED)`, frame được tính là stale, nhưng AMR DOM vẫn `data-source="observed"` và inspector chưa đổi. Đã kiểm bằng actual workspace harness với browser stubs; không là browser performance measurement.

**Sửa / regression:** repaint khi freshness category/link state đổi, đồng bộ scene, inspector và status chip; không cần full redraw mỗi heartbeat nếu state chưa đổi. Test stale, disconnect và recovery với zero new pose samples.

## R10 — P2: Human-wait KPI trộn arrival của các mission

**Code:** [Lab compare.ts](../../src/reports/compare.ts), dòng 10–12; [source comparison.ts](../../../source/packages/lab-runtime/src/v2/comparison.ts), cùng thuật toán.

Một biến `arrived` dùng chung cho mọi MissionArrived. Arrival sau ghi đè arrival trước; confirmation đầu xóa biến khiến confirmation thứ hai bị bỏ.

**Repro với valid synthetic journal:** A arrive 1s, B arrive 2s, A load 3s, B load 4s. KPI trả 1s/1 stop; đúng theo định nghĩa là 4s/2 stops. FD07 seed 3 mặc định serialize các stops và không tái hiện lỗi này; không ghi là default scenario failure.

**Sửa / regression:** correlate arrival và confirmation theo mission/stop/allocation; thêm overlapping-stop, partial handoff và cancelled-stop tests. Sửa cả hai copies hoặc chia sẻ một implementation.

## R11 — P2: Khoảng cách giữa robot thực chất gồm khoảng cách đến tường

**Code:** [mock-amr.ts](../../../source/packages/lab-runtime/src/v2/backends/mock-amr.ts), dòng 88; metric definition ở [compare.ts](../../src/reports/compare.ts).

`clearance()` gồm world boundaries/furniture/robots; số đó được report thành `minSeparationM` giữa robot. Khi chỉ có một robot, KPI vẫn available.

**Repro:** FD01 một AMR báo minSeparationM=0.5961917627576756, available=true, samples=1, dù KPI định nghĩa cần hai robot. Với hai robot, tường gần hơn có thể quyết định metric thay cho khoảng cách robot pair.

**Sửa / regression:** tách robot-pair separation và world clearance, units/definition rõ; một robot phải unavailable/SINGLE_ROBOT cho inter-robot metric. Dùng fixture biết trước khoảng cách pair và obstacle.

## R12 — P3: SSE còn sống sau khi pairing session hết hạn

**Code:** [gateway.ts](../../../source/packages/lab-runtime/src/v2/gateway.ts), dòng 100–101; [event-stream.ts](../../../source/packages/lab-runtime/src/v2/event-stream.ts), dòng 37–47.

Session chỉ kiểm khi mở stream; không truyền expiry/authorization predicate xuống stream để đóng kết nối khi quyền đọc hết hạn.

**Repro:** mở telemetry qua gateway loopback trên cổng ephemeral, tăng injected clock 3.600.001 ms. GET snapshot mới trả 401, SSE cũ vẫn phát heartbeat data. Đã đóng server/temp journal của review sau test.

**Giới hạn impact:** hiện local synthetic mock, không chứng minh rò dữ liệu production hoặc quyền điều khiển. Tuy nhiên session lifetime không nhất quán, và stream giữ resources sau khi quyền hết hạn.

**Sửa / regression:** timer/deadline hoặc auth predicate kết thúc stream, dọn registration; test expiry trong lúc stream mở, không chỉ expiry khi reconnect.

## Test backup đang thất bại — lỗi test có sẵn, không phải finding mới của Plan 01

[upgrade-recovery.test.ts](../../../source/tests/integration/upgrade-recovery.test.ts), dòng 79, thay byte 100 bằng literal `X` mà không bảo đảm byte đó thay đổi. Failure record lưu đúng assertion dòng 80: expected empty reasons to match corrupt public.sql.

Đã tái hiện verifier của cả base và HEAD với valid backup manifest/temp file:

| Original byte 100 | Mutation | Base / HEAD |
|---|---|---|
| X | ghi X | file không đổi; reasons=[] |
| Y | ghi X | corrupt public.sql (sha256) |
| X hoặc Y | XOR 1 | corrupt public.sql (sha256) |

Diff của backup verifier/helpers/test so với base trống. Đây là bằng chứng xác định rằng corruption injection có thể là no-op và test có thể false-fail. Không cần 100 dumps để chứng minh lỗi này. Chưa đo phân bố byte của các pg_dump thực; không khẳng định tỷ lệ 1/62 hay toàn bộ hai failures trước đó đã được quy hoàn toàn về cùng nguyên nhân.

Khuyến nghị đổi corruption injection sang `const damaged=Buffer.from(bytes); damaged[100] ^= 1`, assert bytes khác original, rồi chạy focused test và full integration gate. Đó là sửa độ đúng của test, không waive verifier hay đánh suite cũ thành green. Review không thực hiện patch này và không khởi động Supabase.

## Kiểm chứng trong lượt review

Dùng Node 24.22.2:

- Source: 8 focused files contracts, streams, mock, recovery, report, coffee job/recovery/transfer: **77 pass, 1 skip**; 36,68 giây. Skip không được tính pass.
- Lab: toàn bộ unit/integration hiện có: **100 pass, 1 skip**; 1,80 giây.
- Reviewer Lab chạy thêm 5 focused files: 46 pass; đây là subset, không cộng vào con số tổng.
- Domain reproductions qua actual production registry + authorization, temporary in-memory snapshots; stock reproduction qua actual recipe validator/reservation/consumption. Không đánh đồng với hardware hoặc whole HTTP journey.
- Runtime reproductions dùng source runner và temp SQLite fixtures. Workspace reproductions dùng actual bundled UI modules với browser stubs; metric overlap dùng synthetic journal và ghi rõ giới hạn.
- SSE expiry dùng một ephemeral loopback server rồi đóng. Backup reproduction không cần DB. Không bật Supabase/Docker/Gazebo/LinuxCNC, không chạm ports 1880/1884.
- Không rerun toàn bộ CI-equivalent suite hoặc human/clean-host acceptance; failure trong report cũ vẫn là open gate. Không sửa production code, tests, locks, branches hoặc acceptance ledger.

## Đánh giá các rulings và thứ tự xử lý

Giữ scope Plan 01, dùng Node 24, không fake Linux/hardware, không accept R-MOCK, dùng real exported runtime cho UI tests, giữ Kitchen.Ready precedence và coffee feature gate là các quyết định phù hợp. Source branch local riêng không cần xóa chỉ vì chưa dùng worktree. Shared packages ở pin/HEAD bằng nhau là đủ giải thích pin hiện tại; acceptance-test HEAD vẫn phải ghi đúng revision trong evidence.

Generated schema/hash import với hand-mirrored Lab TS types là một trade-off đã ghi nhận; review này không phát hiện type mismatch cụ thể để yêu cầu revert ruling. Không coi việc chưa có 18 rows là hoàn tất R-MOCK, cũng không dùng chúng làm lý do bỏ qua các lỗi trong paths đã triển khai.

Ưu tiên sửa domain truth/admission R01–R05, mock fault behavior R06–R07, replay/freshness R08–R09; sửa KPI R10–R11 trước khi dùng báo cáo so sánh bố trí/năng suất. R12 là hardening. Mỗi fix cần regression thể hiện trigger ở trên. Sau đó sửa corruption test bằng mutation chắc chắn thay byte, chạy lại CI gate và cập nhật evidence. Merge một phần sau review khác với nghiệm thu R-MOCK: 18 phần thiếu và human/Linux/performance gates vẫn cần trạng thái riêng.
