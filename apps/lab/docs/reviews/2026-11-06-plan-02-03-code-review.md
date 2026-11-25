# Code review Plan 02 và Plan 03

Cập nhật sau review: findings R01–R12 được xử lý trong source `a89a077`; xem [remediation và kiểm chứng](2026-11-06-plan-02-03-remediation.md). Nội dung bên dưới giữ nguyên kết quả review tại baseline.

Ngày review: 2026-11-06. Quyết định tích hợp: **request changes — chưa merge hai nhánh hiện tại**. Các findings bên dưới là lỗi trong đường đã triển khai; không quy việc thiếu Linux/ROS/Gazebo/LinuxCNC thành lỗi code. Review không sửa implementation, không merge/push và không đổi acceptance ledger.

## Phạm vi

- Source `feat/lab-digital-twin-v2`, HEAD `14d62c471fed0560d6a84921371240e6f4470e6f`; Plan 02: `c1d1ea7..0101d6c`, Plan 03: `0101d6c..14d62c4`.
- Lab `feat/robot-lab`, HEAD `a0a02d205a0996fdc160269b8c742cb6c1f70dcb`; review các thay đổi Plan 02/03 từ `730bd1c` và runtime đang pin.
- Đối chiếu [Plan 02](../plans/2026-11-05-digital-twin/02-simulation.md), [Plan 03](../plans/2026-11-05-digital-twin/03-arm-hardware.md), [simulation](../specs/2026-11-05-digital-twin/simulation.md), [arm-hardware](../specs/2026-11-05-digital-twin/arm-hardware.md), [contracts](../specs/2026-11-05-digital-twin/architecture-contracts.md), [verification](../specs/2026-11-05-digital-twin/verification.md).
- Hai checkout sạch khi bắt đầu. Source giữ nguyên; Lab chỉ thêm tài liệu review này.

Điểm đúng cần giữ: production domain/journal là nguồn nghiệp vụ, backend thiếu không fallback mock, hardware vẫn khóa, protocol/schema pin được kiểm, evidence ngoài Linux được ghi `not_run`. Các điều này không bù được các lỗi fail-open hoặc integration dưới đây. P1 = cần sửa trước tích hợp; P2 = lỗi chức năng cần sửa trong đợt này. Không có finding nào chứng minh robot thật đã chuyển động.

## R01 — P1: Artifact chấp nhận và chạy Python bytecode không được ký

**Code:** [verify-signature.py:135](../../../source/integrations/arm-controller/scripts/verify-signature.py#L135), dòng 135–140; [install-sim.sh:67](../../../source/integrations/arm-controller/scripts/install-sim.sh#L67).

Verifier bỏ toàn bộ thư mục `__pycache__` khỏi phép kiểm file ngoài manifest, nhưng installer `cp -R` sao chép cả chúng vào release. Python có thể nạp `.pyc` hợp lệ trong cache thay cho source đã ký.

**Repro:** export sạch HEAD với khóa Ed25519 tạm, thêm `bridge/__pycache__/__init__.cpython-313.pyc` dạng unchecked-hash chứa marker vô hại; không sửa file đã ký. Verifier trả `ok:true, filesChecked:43`; installer thành công; `import bridge` từ release đã cài in `UNSIGNED_PYC_EXECUTED`. Primary reviewer chạy lại verifier/import và nhận cùng kết quả.

**Hậu quả:** quyền sửa nội dung artifact trước install đủ để chèn code thực thi, dù không có signing key. Đây là bypass integrity, nghiêm trọng hơn deferred minor về point encoding.

**Sửa:** reject bytecode/cache không nằm trong manifest khi nhận artifact; copy đúng allowlist đã xác minh và không cho dữ liệu chưa ký tham gia Python import. Regression phải import từ release thực sau cài, không chỉ assert hash source.

## R02 — P1: Replay trust policy cũ có thể mở lại khóa đã revoke

**Code:** [verify-signature.py:174](../../../source/integrations/arm-controller/scripts/verify-signature.py#L174), dòng 174–182.

`verify_policy_update()` kiểm chữ ký bằng khóa active hiện tại và sự tồn tại của `cachedAt`, nhưng không kiểm thứ tự/version của metadata so với policy đã cài. Một policy cũ đã ký vẫn hợp lệ nếu signer còn active.

**Repro:** policy hiện tại ngày 07/11 revoke `test-key-2027`, vẫn giữ `test-key-2026` active. Gửi lại fixture policy ngày 06/11 được ký bởi `test-key-2026`, trong đó khóa 2027 active. Hàm trả `ok:true`; installer sẽ thay policy hiện tại bằng bản mở lại khóa revoked. Primary reviewer chạy lại phép xác minh với clock 07/11 và xác nhận.

**Sửa:** signed policy revision tăng đơn điệu, lưu mốc đã chấp nhận và từ chối replay/downgrade; kiểm validity của candidate trước thay policy. Thêm regression revoke → replay metadata cũ → artifact dưới khóa revoked vẫn phải bị từ chối.

## R03 — P1: LinuxCNC port coi idle là job completed dù chưa chạy hoặc vừa abort

**Code:** [linuxcnc_port.py:49](../../../source/integrations/arm-controller/bridge/linuxcnc_port.py#L49), dòng 49–51; `run()` dòng 63–64, `cancel()` dòng 68.

`run()` đặt `current` ngay sau `auto(AUTO_RUN)` bất đồng bộ. Bất kỳ lần poll idle tiếp theo nào đều ghi completed nếu không có joint fault. Không có điều kiện đã quan sát execution, và cancel không gắn terminal reason riêng cho job gốc.

**Repro:** chạy actual `LinuxcncPort` với stub module LinuxCNC: (a) run rồi controller còn idle → outcome completed; (b) đã running → cancel/abort → idle → outcome job gốc vẫn completed. Đây là test boundary của port, không phải controller run trên Linux.

**Sửa:** tách trạng thái command accepted, execution observed và normal terminal; abort/rejection/error không được thành success. Regression cần kiểm job gốc sau cancel và delayed start acknowledgement.

## R04 — P1: Bridge restart bỏ qua job đã ACK nhưng chưa có terminal outcome

**Code:** [arbiter.py:58](../../../source/integrations/arm-controller/bridge/arbiter.py#L58), dòng 58–61.

Khi controller boot không đổi, `start()` chỉ reconcile unknown và pending send chưa có answer. Job accepted chưa terminal không thuộc hai nhóm đó. Trong khi ấy một instance LinuxcncPort mới mất `current/done` đang giữ trong RAM.

**Repro:** journal có stage/start accepted, chưa terminal; khởi tạo lại arbiter cùng controller boot và mất outcome mapping trong port. Kết quả `pendingReconciled:[]`, `reconcileRequired:false`, job cũ vẫn running, owner mới acquire được. Khi controller idle lại, đường mới không bị gate bởi outcome chưa reconcile.

**Sửa:** recover mọi accepted unfinished effect trên cả same-boot restart; không cho writer mới đi qua cho đến khi query có kết quả đáng tin hoặc ghi unknown cần xử lý. Không tự resend start.

## R05 — P1: Write timeout làm rớt client khỏe sau 500 ms không gửi command

**Code:** [service.py:104](../../../source/integrations/arm-controller/bridge/service.py#L104), dòng 104–106; `_serve()` dòng 126–140.

`conn.settimeout(0.5)` dùng chung socket với reader `makefile()`. Sau reply, lần đọc command tiếp theo có cùng timeout; `_serve` bắt OSError và drop client. Nhận telemetry liên tục không làm reader có command mới.

**Repro:** actual BridgeService, fake controller, status 20 Hz, acquire hợp lệ trả accepted. Sau 0,8 giây không gửi command, `len(service.clients)==0`. Hai client hiện renew khoảng 7 giây, nên kết nối bình thường chết trước renewal.

**Sửa:** dùng cơ chế giới hạn thời gian ghi không thay read deadline, hoặc thiết kế I/O loop có idle policy độc lập. Test giữ kết nối qua nhiều chu kỳ renewal cùng telemetry.

## R06 — P1: Entry point được systemd gọi không import được package bridge

**Code:** [run.py:9](../../../source/integrations/arm-controller/bridge/run.py#L9), dòng 9–12; path setup ở dòng 36; [systemd unit:17](../../../source/integrations/arm-controller/packaging/systemd/mekoniq-arm-bridge.service#L17).

Unit chạy trực tiếp `python3 .../bridge/run.py`, nhưng `from bridge...` xuất hiện trước `sys.path.insert`. Chạy `.venv/bin/python integrations/arm-controller/bridge/run.py --help` trên HEAD đã lỗi `ModuleNotFoundError: No module named 'bridge'`, trước cả kiểm LinuxCNC. Primary reviewer xác nhận lại lỗi.

**Sửa:** module/package entry point đúng, hoặc bootstrap path trước import. Kiểm chính invocation được unit sử dụng từ working directory độc lập, với artifact đã export.

## R07 — P1: SIL gửi robot vào tâm bàn thay vì handoff pose đã compile

**Code:** [campaign.ts:85](../../../source/packages/lab-runtime/src/v2/sil/campaign.ts#L85); đường seed bindings ở [session.ts:68](../../../source/packages/lab-runtime/src/v2/session.ts#L68).

Campaign truyền project thô vào SourceSession, không sử dụng `bindings.json` do compiler tạo. Với `restaurant-v2.json`, compiler tính table-1 handoff `(6.123552, 2.318708, yaw=-0.348771)`; execute thực gửi `(7,2,yaw=0)`, nằm trong table collider `[6.6,7.4] × [1.6,2.4]`.

**Repro:** fixture thật + production SourceSession + worker protocol double chỉ ghi lại execute target. Primary reviewer chạy lại và thấy target `(7,2,0)`. Chưa chạy Nav2 thật, nhưng tọa độ target/collider và việc bỏ compiled binding đã được xác định.

**Sửa:** dùng compiled semantic bindings cùng map identity/yaw khi tạo production binding. Test phải so target gửi xuống adapter với compiler output, không chỉ assert mission completed trên double.

## R08 — P1: Thiếu barrier ACK vẫn xác nhận load/handoff và tăng served

**Code:** [campaign.ts:137](../../../source/packages/lab-runtime/src/v2/sil/campaign.ts#L137), dòng 137–141.

Promise `awaitTransferBarrier()` bị bỏ; lỗi `backend.barrier()` cũng được đổi thành `{acks:[]}` rồi tiếp tục `Mission.ConfirmStop`.

**Repro:** FD01 qua production SourceSession, chỉ thay worker barrier reply thành `{acks:[]}`. Run kết thúc `completed`, `served:"1"`; cả hai barrier vẫn pending, missing `amr-1`; mọi business assertion pass. Primary reviewer chạy lại và xác nhận.

**Sửa:** chỉ commit confirmation khi barrier hoàn tất; missing/error/timeout phải giữ transfer unresolved và ghi attention. Regression kiểm cả business journal/custody và barrier log khi không có ACK.

## R09 — P1: Cache sensor cũ được phát lại như phép đo mới còn sống

**Code:** [scene_loop.py:89](../../../source/robotics/simulation/bridge/scene_loop.py#L89), dòng 89–90, 106; cache ở [nav2_session.py:73](../../../source/robotics/simulation/bridge/nav2_session.py#L73), dòng 73–83.

Callback ROS giữ pose/contact values mà không giữ receipt time/sequence. Mỗi world-clock tick lấy lại cache rồi tạo telemetry seq/time mới, quality valid. Một empty contact message đã từng đến khiến liveness `alive:true` mãi.

**Repro:** cấp một pose và empty contact message, sau đó chỉ tăng clock 60 giây, không cập nhật sensor; SceneLoop vẫn phát valid pose và alive contact sensor. Điều này có thể làm no-contact/separation có vẻ đủ bằng chứng trong lúc feed đã mất.

**Sửa:** giữ receipt/freshness của phép đo gốc, không làm mới tuổi bằng clock tick; chỉ ghi liveness/metric khi đủ coverage và sensor còn sống. Test sensor silence với world clock vẫn chạy.

## R10 — P1: ARM03 nhận trace mất mẫu là trajectory đầy đủ

**Code:** [arm/session.ts:79](../../../source/packages/lab-runtime/src/v2/arm/session.ts#L79), dòng 79–84; `collisionEvidence()` dòng 97–112.

Session biến mỗi status nhận được thành tick liên tiếp, chỉ kiểm actualRad có sáu phần tử. Nó không giữ `SEQ_GAP`, age, boot/epoch continuity hoặc dùng `staleMs`. Checker sau đó kiểm đường nội suy giữa các endpoints như thể trace đầy đủ.

**Repro do primary reviewer chạy:** hai status cùng joints, cách nhau 60 giây; status sau seq=100, `reasonCodes:["SEQ_GAP:98"]`. Evidence trả ARM03 pass, một interval, ba evaluations, uncertain=0, mọi assertion pass. Đây là mất coverage rõ ràng, không chỉ vấn đề màu stale trên UI. Đường đi thực trong khoảng trống có thể khác đường nội suy.

**Sửa:** chuyển gap/freshness/boot/epoch vào trace, kiểm coverage theo policy có bound, trả not_run/blocked khi không chứng minh được khoảng trống. Không đồng nhất seq gap thông thường do event xen kẽ với dropped-status marker; cần xử lý đúng giao thức. Thêm regression explicit SEQ_GAP, mất feed, restart và time gap quá ngưỡng.

## R11 — P2: FD01/FD02 không khởi động telemetry SceneLoop

**Code:** [nav2_session.py:369](../../../source/robotics/simulation/bridge/nav2_session.py#L369), dòng 369–375; [sil/cli.ts:11](../../../source/packages/lab-runtime/src/v2/sil/cli.ts#L11).

SceneLoop chỉ được tạo khi có `--scenario`; CLI khai báo FD01/FD02 `scenario:null`. Vì thế real worker cho hai scenario static không phát telemetry/contact/liveness/separation của SceneLoop, dù được liệt kê là supported. Verifier sẽ nhận zero telemetry và từ chối physics evidence.

**Sửa:** luôn chạy collection loop; actor/blocker/fault schedules có thể rỗng. Test main/worker wiring cho static scenario, không chỉ test SceneLoop được tạo trực tiếp.

## R12 — P2: Socket permissions chặn các client theo deployment đã mô tả

**Code:** [service.py:57](../../../source/integrations/arm-controller/bridge/service.py#L57); [systemd unit:10](../../../source/integrations/arm-controller/packaging/systemd/mekoniq-arm-bridge.service#L10), dòng 10–14.

Service chạy bằng `mekoniq-arm` và chmod cả hai socket thành 0600. Unit mô tả desktop HMI đi qua group `mekoniq-arm` và connector Lab là `mekoniq-lab`; hai danh tính khác UID không có quyền kết nối. Installer/service không provisioning ACL, và mỗi restart unlink/rebind làm mất ACL đặt trên socket cũ.

**Sửa:** provisioning riêng quyền cho local.sock và bridge.sock tại mỗi lần tạo, đồng thời giữ cách ly hai owner kinds. Test đúng danh tính triển khai; chạy tất cả dưới cùng UID vừa che lỗi access vừa mất ý nghĩa phân quyền theo kênh.

## Kiểm chứng mới trong lượt review

Dùng Node 24.22.2 cho Node checks và `source/.venv/bin/python` cho Python:

| Check | Kết quả |
|---|---|
| Source contracts:check | exit 0 |
| Lab check:source | exit 0; pin đúng `14d62c4`, schema `8b398544…`, protocol 1/2 |
| Source 10 focused TS integration/security files | 48 passed |
| Lab toàn bộ Vitest | 161 passed, 1 skipped |
| Python agent/hardware/schema/simulation | 263 passed, 1 skipped |
| Python arm-controller | 86 passed |

10 focused TS files: `lab-v2-arm-collision-evidence`, `beverage-handoff`, `beverage-simulator`, `coffee-simulation-evidence`, `coffee-simulation-resources`, `lab-v2-sil-campaign`, `lab-v2-sil-physics`, `lab-v2-sim-clock`, `lab-v2-sim-recovery`, `lab-v2-arm-authority`. Các test con reviewer chạy thêm không cộng vào tổng để tránh đếm trùng.

Không chạy lại toàn bộ typecheck/lint/build, Postgres integration hoặc browser e2e trong lượt review này; bảng xanh người triển khai cung cấp không được nhận là kết quả chạy mới của reviewer. Không chạy Linux/ROS/Gazebo/LinuxCNC/controller/GUI/clean-install thật; không chạm operational ports 1880/1884. Các reproduction dùng production code tại boundary, protocol doubles/stub controller khi cần, và prefix tạm cho installer. Không nâng chúng thành physics/controller/hardware validation.

Các harness/data tạm tại thời điểm review:

- `/tmp/plan02-review-repro.mts`: goal binding và missing barrier ACK.
- `/tmp/robot-review-arm-trace.mts`: explicit gap và false-pass ARM03.
- `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/arm-review-7covul4x`: signed artifact/key/policy tạm và installed prefix cho hai release reproductions. Khóa này chỉ phục vụ test, không phải release key và không đưa vào repo.

## Quyết định và các giới hạn đã công khai

Không merge Plan 02 hay Plan 03 nguyên trạng. Sửa R01–R10 trước khi xét tích hợp; sửa R11–R12 để đường static SIL và deployment đúng khả năng đã expose. Sau sửa cần regression phản ánh trigger của từng finding, export/re-pin artifact sạch và chạy lại checks đúng HEAD mới.

Giữ `G-SIM-*`, `CONTROLLER-POC`, `R-SIM` và hardware theo bằng chứng thực. `software_complete_tested_not_run_on_linux` là mô tả phạm vi phần mềm đã test, không phải gate controller đã đạt. Các lỗi trên tồn tại độc lập với Linux chưa sẵn sàng; vì vậy bổ sung disclaimer không đủ để đóng chúng.

Chấp nhận việc báo not_run, hardware=false, Node 24 và tách mock model/reference model. Khoảng trống BV01 controller-backed, grip=null, ARM03 chưa vào RunReport và UI còn đọc shape mock đã được công khai: vẫn là phần triển khai chưa hoàn tất để đạt full R-SIM, không tự biến thành accepted chỉ vì unit tests xanh. Review chưa tìm thấy finding Lab UI mới đủ chắc ngoài khoảng trống đã khai báo đó.

Một nghi vấn chưa đưa thành finding: capability Gazebo được lấy/cached ngay khi worker vừa spawn, có thể đóng stack đang warm-up trước readiness. Cần bounded-startup test/Linux evidence để kết luận; không dùng nghi vấn này làm căn cứ cho verdict hiện tại.
