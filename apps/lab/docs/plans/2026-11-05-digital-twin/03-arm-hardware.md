# Plan 03 — Arm controller và hardware gates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LinuxCNC/QtVCP controller simulation kết nối coffee twin, và bộ tích hợp/commissioning có ranh giới hardware rõ ràng.

**Architecture:** Controller package trong source sở hữu local authority, machine adapter và HMI; Lab dùng typed integration bridge ngoài servo loop. Geometric checker của plan02 là điều kiện full R-SIM, safety controller độc lập cho phần cứng.

**Tech Stack:** LinuxCNC, QtVCP/PyQt5/Python, shared source contracts/TypeScript, Debian Linux; IgH/lcec chỉ khi hardware profile được kiểm chứng.

**Spec:** [arm-hardware](../../specs/2026-11-05-digital-twin/arm-hardware.md) và [contracts](../../specs/2026-11-05-digital-twin/architecture-contracts.md).

## Global Constraints

- Platform/domain/contracts/adapters đặt trong `source/`; trải nghiệm, project editor/viewer đặt trong `lab/`.
- Không sửa `trial/`, không chạm robot đang chạy hoặc cổng `1880`/`1884`; dev UI/runtime vẫn `4175`/`4176`.
- Mỗi run khóa mode, backend versions, model/world/recipe revision và seed.
- UI Việt/Nhật/Anh, giữ nhận diện navy/lime.
- Hardware sign-off không được thay bằng software simulation evidence.

**Ngày:** 2026-11-05 · **Trạng thái:** kế hoạch chưa thực thi.
**Spec authority:** [arm-hardware.md](../../specs/2026-11-05-digital-twin/arm-hardware.md). Tất cả file/lệnh mới dưới đây là **đề xuất sẽ tạo ở implementation**, không phải source/test hiện có hay bằng chứng đã pass. Đường dẫn tính từ workspace `robot/`, trừ khi command ghi working directory. Không đổi `trial/`, `web/` hoặc robot/cổng vận hành 1880/1884.

## 1. Thứ tự và điều kiện bắt đầu

Thực hiện sau shared `/lab/v2` contract, AssetRevision/RunManifest và evidence envelope của plan nền tảng. Dùng cùng schema và run store, không tạo hệ thống identity/readiness thứ hai. Có thể song song dựng Linux simulation package và model fixtures sau khi contract đã chốt. Hardware stages phụ thuộc mua thiết bị, risk assessment và người có trách nhiệm; không chặn MVP simulation.

Ưu tiên sản phẩm đã chốt: coffee cell gồm máy pha, đá/sữa và arm phục vụ. Các arm tests phải dùng coffee pickup/handoff fixtures; không cần thêm quy trình nấu ăn vào MVP. Không coi PUMA reach/limits là thông số quầy cà phê hoặc gripper/cup thật.

Mỗi task tạo commit review được trong repository sở hữu file. `source/` sở hữu adapter/controller/schema mới; `lab/` sở hữu viewer/scenario/UX. Ban đầu controller là module tự chứa trong source, xuất artifact cài độc lập; chưa bắt buộc tách repo.

## 2. Tasks có đầu ra cụ thể

### A01 — Chốt model/units và fixture oracle

**Owner:** controls + robotics · **Requirements:** ARM-01, ARM-03.
**Dependencies:** AssetRevision schema chung và agreed evidence format.

- [ ] Tạo fixtures/tests theo yêu cầu của task; xác nhận test thiếu behavior đang red trước implementation.
- [ ] Hiện thực đúng files/boundary dưới đây; không nới authority hoặc readiness để làm test pass.

Tạo:

- `source/integrations/arm-controller/models/puma560-reference/manifest.json`
- `source/integrations/arm-controller/models/puma560-reference/modified-dh.json`
- `source/integrations/arm-controller/models/puma560-reference/frames.json`
- `source/integrations/arm-controller/models/puma560-reference/reference-poses.json`
- `source/integrations/arm-controller/tests/test_model_units.py`
- `source/integrations/arm-controller/docs/model-conventions.md`

Manifest ghi origin commit/hash, modified DH, inch/degree source, SI output, joint order/sign, TCP/base frames và `reference_only`. Tạo FK oracle độc lập với implementation dự định dùng; fixture có nominal, unit conversion, quaternion/order, near singularity, unreachable và joint-limit cases. Lưu tolerances numeric theo spec; không điền payload/gear/brake MEKONIQ bằng PUMA defaults.

**Future check**, từ `source/integrations/arm-controller/`:

```sh
python3 -m unittest discover -s tests -p 'test_model_units.py'
```

- [ ] Thực thi các checks nêu trên, lưu raw logs/expected-actual và review diff trước commit; thiếu Linux/backend ghi blocked_external cho check phụ thuộc.

**Exit:** conversion hai chiều và independent FK residual pass; model fields thiếu được thể hiện unknown; controls review DH/frame. Không cần hardware.

### A02 — LinuxCNC simulation package tái lập

**Owner:** controls + DevOps · **Requirements:** ARM-02, HW-05.
**Dependencies:** A01; Linux VM/PC sạch.

- [ ] Tạo fixtures/tests theo yêu cầu của task; xác nhận test thiếu behavior đang red trước implementation.
- [ ] Hiện thực đúng files/boundary dưới đây; không nới authority hoặc readiness để làm test pass.

Tạo:

- `source/integrations/arm-controller/README.md`
- `source/integrations/arm-controller/configs/sim/puma560/mekoniq.ini`
- `source/integrations/arm-controller/configs/sim/puma560/machine.hal`
- `source/integrations/arm-controller/configs/sim/puma560/puma560-dh.hal`
- `source/integrations/arm-controller/configs/sim/puma560/tool.tbl`
- `source/integrations/arm-controller/programs/demo-six-axis.ngc`
- `source/integrations/arm-controller/packaging/dependencies.lock.json`
- `source/integrations/arm-controller/scripts/smoke-sim.sh`
- `source/integrations/arm-controller/tests/test_linuxcnc_sim.py`

Pin Debian architecture/image checksum, LinuxCNC/package/source, Python/Qt/QtVCP, virtual HAL and model. Dùng native simulation trên stock Linux kernel khi thích hợp; không yêu cầu IgH/lcec/physical NIC để khởi động. Không quảng cáo VM timings là IPC realtime evidence. Hỗ trợ terminal run và GUI smoke; chọn phiên bản chính thức sau kiểm compatibility, không coi branch 2.9 trong nguồn tham khảo là lock đã chọn.

**Future checks**, Linux host, working directory `source/integrations/arm-controller/`:

```sh
bash scripts/smoke-sim.sh --profile configs/sim/puma560/mekoniq.ini --evidence-dir /tmp/mekoniq-arm-sim-evidence
python3 -m unittest discover -s tests -p 'test_linuxcnc_sim.py'
```

- [ ] Thực thi các checks nêu trên, lưu raw logs/expected-actual và review diff trước commit; thiếu Linux/backend ghi blocked_external cho check phụ thuộc.

**Exit:** start/home/run/pause/resume/stop và controller fault chạy với virtual HAL; log ghi process/version/profile/backend; absent hardware không bị report fail của software test. Chưa mở đường hardware.

### A03 — Local command arbiter và controller bridge

**Owner:** controls + backend/security · **Requirements:** ARM-05..ARM-07.
**Dependencies:** A02; shared auth/evidence schemas.

- [ ] Tạo fixtures/tests theo yêu cầu của task; xác nhận test thiếu behavior đang red trước implementation.
- [ ] Hiện thực đúng files/boundary dưới đây; không nới authority hoặc readiness để làm test pass.

Tạo:

- `source/integrations/arm-controller/bridge/{__init__,protocol,arbiter,linuxcnc_port,journal,service}.py`
- `source/integrations/arm-controller/tests/test_arbiter.py`
- `source/integrations/arm-controller/tests/test_bridge_protocol.py`
- `source/integrations/arm-controller/tests/test_bridge_recovery.py`
- `source/packages/contracts/schemas/arm-command.schema.json`
- `source/packages/contracts/schemas/arm-observation.schema.json`
- `source/integrations/arm-controller/packaging/systemd/mekoniq-arm-bridge.service`

Brace notation ở đây chỉ danh sách filename sẽ tạo. Implement fixed local socket, bounded frames/queue, allowlisted program IDs/hash, epoch/lease/owner, durable command outcome và single error consumer. No arbitrary HAL/MDI/file/network endpoint. Lock owner với authoritative state và deny simultaneous writers; lifecycle ACK/completion/unknown tách biệt. Reconcile pending commands sau crash; không replay physical-effect command. Định nghĩa stale threshold và disconnect response trong profile trước test.

Arm schemas là specialized payload refs của `cell-command.schema.json`/`cell-observation.schema.json` do foundation tạo. Reuse `source/packages/cell-adapters` contracts/registry từ F04; không tạo adapter registry hoặc authority envelope thứ hai.

**Future checks**, từ `source/`:

```sh
pnpm contracts:generate
pnpm contracts:check
pnpm test:contracts
```

**Future checks**, từ `source/integrations/arm-controller/`:

```sh
python3 -m unittest discover -s tests -p 'test_arbiter.py'
python3 -m unittest discover -s tests -p 'test_bridge_protocol.py'
python3 -m unittest discover -s tests -p 'test_bridge_recovery.py'
```

- [ ] Thực thi các checks nêu trên, lưu raw logs/expected-actual và review diff trước commit; thiếu Linux/backend ghi blocked_external cho check phụ thuộc.

**Exit:** concurrent local/Lab start có đúng một owner; duplicate ID không double execute; restart/timeout/expired lease/oversize message/supplied URL rejected hoặc reconciled có audit. Python tests với fake controller chỉ chứng minh bridge; A02 Linux integration mới chứng minh command mapping.

### A04 — QtVCP HMI đi chung arbiter

**Owner:** controls UI · **Requirements:** ARM-05, ARM-07.
**Dependencies:** A03.

- [ ] Tạo fixtures/tests theo yêu cầu của task; xác nhận test thiếu behavior đang red trước implementation.
- [ ] Hiện thực đúng files/boundary dưới đây; không nới authority hoặc readiness để làm test pass.

Tạo:

- `source/integrations/arm-controller/hmi/mekoniq_arm/mekoniq_arm.ui`
- `source/integrations/arm-controller/hmi/mekoniq_arm/mekoniq_arm_handler.py`
- `source/integrations/arm-controller/hmi/mekoniq_arm/mekoniq_arm.qss`
- `source/integrations/arm-controller/tests/test_hmi_actions.py`
- `source/integrations/arm-controller/docs/hmi-acceptance.md`

Hiển thị mode/backend, owner, model/profile, six actual/commanded joints, homing, program, fault và telemetry freshness. Joint jog/home chỉ ở HMI local và chỉ khi owner/state policy cho phép. Disable stock QtVCP write actions bypass arbiter; role UI không được coi là safety boundary. HMI crash không tự acquire owner/start lại. Fullscreen/translation/touch kiểm bằng GUI smoke và screenshots; simulator không chứng minh enabling device thật.

**Future check**, từ `source/integrations/arm-controller/`:

```sh
python3 -m unittest discover -s tests -p 'test_hmi_actions.py'
```

- [ ] Thực thi các checks nêu trên, lưu raw logs/expected-actual và review diff trước commit; thiếu Linux/backend ghi blocked_external cho check phụ thuộc.

**Exit:** local HMI + bridge concurrent test trong Linux runtime pass; đường command bypass bị loại; screenshots và operator flows review được.

### A05 — Nối Lab runtime, viewer và Beverage handoff

**Owner:** platform + Lab · **Requirements:** ARM-01, ARM-04, ARM-06..ARM-09.
**Dependencies:** A03; root v2 runtime, Beverage state machine; SIM-05/Task 6 geometric checker của [plan 02](02-simulation.md) trước full R-SIM acceptance. Có thể dựng wiring/controller PoC trong khi checker được xây song song.

- [ ] Tạo fixtures/tests theo yêu cầu của task; xác nhận test thiếu behavior đang red trước implementation.
- [ ] Hiện thực đúng files/boundary dưới đây; không nới authority hoặc readiness để làm test pass.

Tạo:

- `source/packages/lab-runtime/src/v2/arm/adapter.ts`
- `source/packages/lab-runtime/src/v2/arm/session.ts`
- `source/tests/integration/lab-v2-arm.test.ts`
- `source/tests/integration/lab-v2-arm-collision-evidence.test.ts`
- `source/tests/security/lab-v2-arm-authority.test.ts`
- `lab/src/twin/arm/arm-view.ts`
- `lab/src/twin/arm/arm-telemetry.ts`
- `lab/tests/integration/arm-evidence.test.ts`
- `lab/tests/e2e/arm-simulation.spec.ts`
- `source/integrations/arm-controller/tests/fixtures/coffee-handoff.json`

Resolve provisioned provider ID, check profile/model/capability before dispatch, preserve immutable backend set. Viewer chỉ render observations đúng source timestamp; source arm emits pose/gripper/transfer evidence, Beverage domain confirm ownership. Không để joint animation tự hoàn tất pickup/serve. Missing Linux backend là unavailable, không fallback mock trong cùng run. Reuse unit/frame adapter và log source provenance; không copy motion authority vào browser.

Consume geometric collision checker do **plan 02 Task 6 / SIM-05 sở hữu**; không viết thêm checker trong LinuxCNC bridge. A05 cấp joint trace, frame/model/scene hashes, cup attach/detach transform và transfer phase; nhận checked path intervals, geometry pairs, separation/collision và coverage policy để làm ARM03 evidence. Bắt buộc self-collision, arm–scene/fixture/AMR và attached-cup swept path trên cả trajectory; collision planning tự động và dynamics không bắt buộc. Test nominal clear path, self-collision, cup/fixture collision giữa hai endpoints, phase-specific allowed contact, geometry revision mismatch và checker unavailable. Không có checker/geometry/trace đủ thì ARM03 `not_run`/`blocked_external`, full R-SIM bị chặn, không fallback sang viewer overlap hay controller success.

Coffee fixtures có brew-ready/complete, ice/milk completed theo recipe, cup presence/identity, gripper secure, nhận ly ready và cleaning/interlock freshness. Negative cases: brew ACK nhưng chưa hoàn tất, cup/grip lost, ice jam, milk empty, stale cleaning/cold-handling metadata và cancel khi arm đang giữ ly. Mỗi case giữ source cup ownership cho tới khi reconcile được; không tự release khi browser disconnect. Numeric physical temperature/payload/force limits để unknown đến khi vendor/measured profile có dữ liệu; fixture amounts/timings chỉ là simulation.

**Future checks**, từ `source/`:

```sh
pnpm typecheck
pnpm test:integration
pnpm test:security
```

**Future checks**, từ `lab/` sau khi script/runtime v2 đã có:

```sh
pnpm typecheck
pnpm test:integration
pnpm test:e2e -- arm-simulation.spec.ts
pnpm build
```

**Exit full R-SIM:** ARM01..ARM06 có evidence đúng fidelity, **ARM03 pass với geometric checker và attached-cup swept-path coverage**; BV01/BV07 handoff không auto-confirm thiếu observation. ARM03 absent/not_run/blocked_external chặn R-SIM. Controller integration PoC có thể review riêng với scope hẹp và ARM03 chưa chạy, nhưng không được gọi là full simulation release. Dynamic force/torque/fluid và hardware evidence không bắt buộc ở R-SIM; report ghi rõ các phần đó chưa chạy.

### A06 — Export controller package và release evidence

**Owner:** DevOps + QA · **Requirements:** HW-05.
**Dependencies:** A01..A05.

- [ ] Tạo fixtures/tests theo yêu cầu của task; xác nhận test thiếu behavior đang red trước implementation.
- [ ] Hiện thực đúng files/boundary dưới đây; không nới authority hoặc readiness để làm test pass.

Tạo:

- `source/scripts/export-arm-controller.mjs`
- `source/integrations/arm-controller/packaging/release-manifest.schema.json`
- `source/integrations/arm-controller/scripts/install-sim.sh`
- `source/integrations/arm-controller/scripts/verify-install.sh`
- `source/integrations/arm-controller/docs/restore-runbook.md`
- `source/integrations/arm-controller/tests/test_release_manifest.py`
- `source/integrations/arm-controller/packaging/trust-policy.json`
- `source/integrations/arm-controller/scripts/verify-signature.py`
- `source/integrations/arm-controller/tests/test_release_trust.py`

Export revision/checksums/SBOM/licenses/model lock từ checkout sạch; ký canonical manifest bằng release signing key Ed25519 do CI/offline signing station giữ, artifact chỉ chứa key ID/signature và public trust metadata; artifact không phụ thuộc sibling checkout đang chỉnh sửa. Per-machine identity và calibration tách khỏi image; không clone credentials. Install default SIM, không có commissioning flag từ Lab import. App/config rollback kiểm riêng với machine calibration compatibility. Installer verify signature + per-file hash + allowlisted key trước extract/activate; trust policy có key rotation/revocation và expiry, cache signed trust metadata cho offline installs với validity window được quản trị chốt. Thiếu/expired/revoked trust fail closed; recovery theo signed offline package, không bypass bằng checkbox. Test tampered manifest/file, wrong key, revoked/expired key, signed old version chưa được phép downgrade, và last-known-good rollback với calibration tương thích. Machine credential keys tách release signing keys; private keys không có trong image hoặc repo.

**Future command**, từ clean `source/`:

```sh
node scripts/export-arm-controller.mjs /tmp/mekoniq-arm-controller-artifact
```

**Future commands**, trên Linux test host, sau khi giải nén artifact:

```sh
bash scripts/install-sim.sh --prefix /opt/mekoniq-arm-sim
bash scripts/verify-install.sh --prefix /opt/mekoniq-arm-sim
```

- [ ] Thực thi các checks nêu trên, lưu raw logs/expected-actual và review diff trước commit; thiếu Linux/backend ghi blocked_external cho check phụ thuộc.

**Exit:** máy Linux sạch cài/rerun/restore được, checksum reject tamper, hardware mode vẫn khóa; report ghi rõ software SIL achieved và hardware chưa nghiệm thu. Không dùng “production ready” cho artifact SIM.

## 3. Optional dynamics/planning spike — ngoài đường găng MVP

Phần optional này chỉ gồm dynamic forces/torque/plant feedback/fluid hoặc automatic collision-aware planning. Geometric self/scene/attached-cup swept-path checker của ARM03 đã là requirement R-SIM bắt buộc tại A05 + plan 02 Task 6, không thuộc phần optional.

Phối hợp plan simulation để tránh hai control owners. Nếu cần arm physics, trước hết tạo proposal trong `source/integrations/arm-controller/docs/physics-coupling.md` và tests tại `source/integrations/arm-controller/tests/test_physics_coupling.py`. Chốt model mass/inertia/contacts, engine/timestep, sim-time stepping, feedback latency, actuator approximation và reset semantics. Replay joint trace chỉ đủ geometric/collision observation; muốn dynamics claim phải làm closed-loop plant contract và validate model.

MVP cross-engine coordination giữ 1× + business barriers của architecture spec; không triển khai accelerated LinuxCNC hoặc deterministic lockstep. Plan simulation sở hữu Gazebo/cell physics implementation; arm package chỉ sở hữu controller-side coupling contract và tests.

Nếu cần MoveIt, tạo ADR `source/integrations/arm-controller/docs/moveit-controller-boundary.md` trước code. Bắt buộc xác định FollowJointTrajectory adapter, timing/interpolation ownership, cancellation, tolerances và exclusive authority. Spike không mở browser raw joint control và không biến ROS graph thành safety system.

## 4. Hardware work packages — chỉ sau gate tương ứng

| Task | Proposed files | Entry / output |
|---|---|---|
| H00 — coffee native integration | `source/packages/cell-adapters/src/native/{profile,registry,device-port,coffee-machine,ice-dispenser,milk-dispenser}.ts`, `source/tests/integration/coffee-native-conformance.test.ts`, `source/integrations/arm-controller/docs/coffee-device-matrix.md` | F04 contract → profile/vendor matrix + conformance emulator; durable executor trên cell IPC, allowlisted operations, no blind brew retry. Driver cụ thể chỉ enable sau manual/SDK/firmware và observation mapping được xác nhận; khi chưa chọn hãng thì software contract ready, physical driver blocked_external |
| H01 — chọn IPC/drive stack | `source/integrations/arm-controller/docs/hardware-bom.md`, `configs/hardware/reference-drive/profile.json`, `ethercat/reference-drive/ethercat.xml` | Drive manual/ESI/firmware, electrical design, vendor modes; pin IgH/lcec/kernel/NIC, không copy sample cycle làm budget |
| H02 — shadow | `tests/hardware/test_shadow.py`, `docs/shadow-report-template.md` | Read-only connector + identity; test timestamps/unit/mapping/stale/disconnect, chứng minh zero actuation path; thu calibration dataset riêng rồi held-out shadow traces, dùng F06 residuals/coverage/drift với thresholds chốt trước, invalidate evidence đúng scope, không auto-tune |
| H03 — guarded HIL | `tests/hardware/test_drive_states.py`, `tests/hardware/test_watchdog_recovery.py`, `docs/hil-procedure.md` | Qualified bench/permissions; one drive rồi six drives; PDO/DC/enable/fault/no-restart, measured cycle/jitter/drop |
| H04 — FAT | `docs/fat-procedure.md`, `docs/fat-report-template.md`, `docs/safety-evidence-index.md` | Actual DH/calibration/tool/payload; limits, braking/holding, E-stop/guard/enabling, power loss, mechanical/thermal/accuracy/repeatability, installer restore |
| H05 — SAT/live | `docs/sat-procedure.md`, `docs/sat-report-template.md`, `docs/change-impact-matrix.md` | Site/layout/tool/revision accepted, real process handoff/recovery, operator training, local authorization and signatures |

H04/H05 phải bổ sung `docs/coffee-cell-qualification.md` và `configs/hardware/reference-drive/coffee-cell-profile.json`: hot surfaces/liquids, cup/gripper retention trong chuyển động/dừng, fill/mass và spill exposure, interaction với vòi/khay máy pha, food-contact/cleaning qualification, ice jam/milk depletion và milk-handling constraints. Controls/mechanical/safety và owner quy trình thực phẩm chốt giới hạn bằng vendor data + measurements; chưa có giới hạn thì không mở live. Physics/animation MVP không thay thermal/fluid, hygiene hoặc physical retention testing.

Hardware test commands phải do commissioning procedure tạo sau khi BOM/profile và risk assessment được phê duyệt; không đưa lệnh enable drive chung vào plan này. Những tests này không chạy trong CI thường hoặc trên robot vận hành. Lab chỉ nhận evidence từ accepted profile; contract không cho caller tự khai “HIL passed”.

**Dừng release** nếu còn geometry/tool/calibration unknown; drive/watchdog behavior chưa đo; safety validation thiếu; command outcome unreconciled; license distribution chưa review; FAT/SAT sai serial/config/site; hoặc evidence physics được gắn nhầm hardware source. Đổi firmware, controller kernel, brake/tool/payload/geometry hoặc safety parameters phải đi impact matrix và retest tương ứng.

## 5. Definition of Done

Full R-SIM release: A01..A06 và các dependencies plan 02 pass theo report có raw logs, hashes, fixture tolerances, model/backend provenance, negative tests, restart/restore evidence và limitations. ARM03 bắt buộc có geometric self/scene/attached-cup swept-path checker thực chạy; `not_run`/`blocked_external` ở ARM03 chặn full R-SIM. Scenario chưa có engine không là pass. PoC LinuxCNC controller có thể đạt gate hẹp riêng với phần controller/kinematics và ghi ARM03 chưa chạy, không được nâng thành R-SIM. Dynamics/force/torque/CFD vẫn optional. Plan [verification](../../specs/2026-11-05-digital-twin/verification.md) là scenario authority.

Hardware release: H00 coffee adapter conformance + vendor bench evidence và shadow/HIL/FAT/SAT evidence hợp lệ cho từng máy/tool/site, controls/electrical/mechanical/safety/QA ký xác nhận phạm vi; local commissioning/provisioning cho phép live. Hoàn tất docs, UI, LinuxCNC SIM hoặc physics không tự đạt gate này. **Tại ngày viết: toàn bộ tasks/gates trong plan này chưa được thực thi và chưa có claim qualified.**
