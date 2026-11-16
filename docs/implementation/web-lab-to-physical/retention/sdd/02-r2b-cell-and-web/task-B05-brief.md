# Task brief B05

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/02-r2b-cell-and-web.md

## Global Constraints

- Chỉ bắt đầu implementation phụ thuộc R2a sau B00; không sửa spec/plan/code R2a trong lần soạn tài liệu này.
- Node 24.22.2; pnpm 10.32.1; portable workers Python 3.11; `PYTHONDONTWRITEBYTECODE=1` khi chạy pytest. Python ROS dùng bản của profile distro, không ép rclpy vào venv portable.
- Nền vật lý là engine pin của R2a đã bàn giao; snapshot nghiên cứu là `mujoco==3.17.0`. Không tự nâng lock ở B02.
- Một logical tick 20 ms; 10 substeps × 2 ms là baseline MuJoCo; tốc độ UI chỉ thay pacing.
- Source là authority mission/journal/custody, Lab chỉ simulation/replay. Không thêm Lab→hardware route.
- Một active world MuJoCo/runtime; một ACK đang bay; lost ACK → unknown, không resend hoặc respawn tiếp tục cùng run.
- New fields optional/versioned; mock BV01 golden, IR-SIM chunks, Webots bytes, archive readers và R2a behaviors giữ theo baseline.
- Geometry/units SI và frame đúng contract; dynamics `not_calibrated`; vendor files có commit/sha256/license/NOTICE.
- UI dùng `tr(vi,ja,en)`, giữ a11y/reduced-motion/2D/no-runtime path; không thêm framework/browser engine.
- Không sửa `trial/`, `web/`, cổng 1880/1884, runtime data hoặc evidence lịch sử để vượt gate.
- Mỗi mutation ở đúng repo; source runtime/schema/tool commit → export sạch → Lab re-pin commit. Không Git ở workspace root.
- Candidate tự động luôn `accepted:false`; human sidecar gắn hash/profile; skip là not_run.
- Task chuẩn bị không deploy, provision host trả phí, ký commissioning thật hoặc chạy robot. Các hành động đó cần đích/phạm vi người dùng giao khi thực thi.

## Execution context
All source/ and lab/ paths are relative to /Users/hoangpham/source/prv/robot/.worktrees/web-lab-to-physical/. Never edit original main checkouts. Read specs at /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical. User authorized implementation on new worktrees on 2026-11-14; original doc-only wording refers to authoring, not current authorization. No push/deploy/native hardware execution. Use Node 24.22.2 and PYTEST_ADDOPTS="-p no:cacheprovider" with PYTHONDONTWRITEBYTECODE=1 for workers.

## Task B05 — World seam và spike handoff chung engine

**Files:**

- Create `source/packages/contracts/schemas/lab-world-scene-v1.schema.json`.
- Create `source/packages/lab-runtime/src/v2/simulation3d/{world-ports,world-step,world-scene}.ts`.
- Modify `source/packages/lab-runtime/src/v2/{scenario-runner,capabilities}.ts`, `v2/navigation2d/readiness.ts`, `v2/beverage/coffee-ports.ts` ở seam được test.
- Create `source/robotics/simulation-mujoco/mujoco_worker/{compile_world,world_engine}.py`.
- Create fixture `source/robotics/simulation-mujoco/fixtures/coffee-delivery-world-v1/`, gồm project, `lab-world-scene.json`, `handoff-policy.json`, `programs.json`, README.
- Test `source/tests/unit/world-step.test.ts`, `source/tests/integration/mujoco-world-rig.test.ts`, `source/robotics/simulation-mujoco/tests/test_world.py`.

**Interfaces:** `WorldPlantPorts`, `WorldPortsFactory`, `WorldPlantBindings` theo contracts §3; thêm `RunProviders.worldPorts` factory chỉ dành set `composition:'single_world'`. Factory nhận `WorldFactoryInput` chứa manifest/runId/directory/state/context/newBootId, trả world + AMR adapters + coffee ports + committed snapshot getter; không nhận transport URL từ browser. `stepWorldOnce(port, tick, append)` trả snapshot ACK sau append/commit; `append` nhận snapshot, là callback durable recorder do source cung cấp.

**Phạm vi refactor bắt buộc:** `scenario-runner.ts` hiện khởi tạo MockPlant, lấy dock/poses từ `cp.plant`, và `tick()` tăng clock rồi gọi `plant.advance(); coffee.advance()`. Tách view/checkpoint/adapters khỏi mock stepping cho world path. Giữ default mock branch; new branch chỉ tăng clock sau ACK/persist đúng. Không chỉ ghi đè `cp.plant.robots[].pose` sau khi MockPlant đã phát arrival.

- [ ] Viết golden regression trước seam: BV01 mock outcome, R2a arm ports behavior, dispatch count/custody/events; world dispatcher missing factory phải từ chối, không rơi xuống arm-only.
- [ ] Viết `world-step.test.ts`: prepare/step/append/commit mỗi thứ đúng 1 lần theo thứ tự; mất ACK không append/commit; append thất bại không commit và caller không được retry engine. Chạy fail.
- [ ] Định nghĩa shared physical-world bindings cho RobotAdapter và CoffeePlantPorts. Arm program được tách command preparation khỏi observation commit; coffee mock được advance đúng một lần, không tự tiến physics. Cùng snapshot cấp actual AMR dock, arm joints, props cho source.
- [ ] Compiler world ghép model trước khi `MjModel` được tạo; namespace IDs; bỏ tray support tĩnh cũ đúng ID, thay tray body con AMR. Sinh home/dock/waypoints từ scene mới, so FK/IK/sweep và không initial collision.
- [ ] Run rig nhỏ: AMR dock yên → arm gắp/đặt → rút → AMR đi 1 m; một cup free body. Ghi cup pose/velocity/contacts/custody qua mọi tick, xác nhận worker count=1 và total physics substeps=10×logical steps cộng priming đã khai.
- [ ] Rig 10/10 lần cùng cấu hình với offsets seed ±5 mm nếu còn trong miền fixture; không NaN, không prop jump, đúng receiver window. Không đạt: lưu probe, dừng full-cell, vẫn bàn giao B04/replay. Không đổi sang weld.
- [ ] Focused tests + legacy golden; commit `feat: coordinate arm and AMR through one MuJoCo world`; re-pin.

Thuật toán core mới trong `world-step.ts` phải thể hiện rõ thứ tự này; validation ACK chi tiết tiếp tục thuộc worker client:

```ts
export async function stepWorldOnce(
  port: WorldPlantPorts,
  tick: number,
  append: (snapshot: Sim3DSnapshotV1) => Promise<void>,
): Promise<Sim3DSnapshotV1> {
  const command = port.prepareTick(tick + 1);
  if (command.targetTick !== tick + 1) throw new Error('WORLD_TARGET_TICK_INVALID');
  const snapshot = await port.step(command);
  if (snapshot.tick !== tick + 1) throw new Error('WORLD_ACK_TICK_INVALID');
  await append(snapshot);
  await port.commit(snapshot);
  return snapshot;
}
```

`WorldPlantPorts` và `Sim3DSnapshotV1` được import từ contracts/interface ở spec. Caller giữ serialized action queue, pending operation journal và terminal failure latch; helper này không được dùng làm retry function. Clock R2a arm-only không bị đổi nhờ shared helper.

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/world-step.test.ts tests/unit/bv01-mock-golden.test.ts tests/unit/mujoco-arm-ports.test.ts
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 300; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_world.py -q
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/integration/mujoco-world-rig.test.ts
```


## Controller integration notes
Read B01/B02/B03 reports for actual contracts. Mobile fixed caster spheres are a declared friction approximation, not invented ball joints. Cell mobile load begins empty: arm cell props become the shared free cups as mock production spawns them, so do not also initialize a payload cup on the tray. Keep nozzles and support colliders, remove only the replaced static tray collider. Cup support can change from nozzle to gripper to AMR tray; load-slip window begins at confirmed tray receipt, not initial nozzle pose.
Current source projectSamples already emits actual arm props as individual TwinSampleV2 observations in map frame; preserve that API and derive cell ownership from source custody, not just contact. World source lifecycle still has MockPlant-backed dock getters/checkpoint fields, which must read the shared committed world rather than emitting mock arrivals and overwriting them afterward. Arm base/tray height transforms must be used consistently by FK/IK, collision and browser; no invisible pose correction.

## Concrete source seams checked
- scenario-runner.ts attach() builds MockPlant + MockAmrAdapter and uses cp.plant for receiver/dock/collision robot positions. recover() resets robot poses to source point bindings and reports lost through MockPlant; world path must instead retain last observed snapshot, mark stale/unknown, refuse automatic world resume, and avoid this pose reset.
- Mutable mock fields also feed confirmStop(stale), fault injection, schedule(), distance/collision views and telemetry. World branch should read committed observations and keep its adapter/checkpoint state explicit; no MockPlant.advance or mock arrival in the world path.
- Existing mujoco-arm-ports.ts due() removes props as soon as st.trays gains an entry, which is intentional for R2a's mock AMR but incorrect for world delivery. New world placement logic must keep cup on free mobile tray and remove only after source confirmed recipient pickup.
- MockArmPlant.watchContact currently recognizes restingOn==='tray' and only counts that support (no relative-motion window). Reuse command/choreography machinery through an additive explicit world-specific release-observation gate or parameter; do not fake restingOn='tray' from a single new-world contact or weaken R2a tests. B06 owns full 25-tick receiver correlation policy.
- Generic navigation adapter implementation is reusable, but firmware/model event labels currently hardcoded IRSIM_AMR. New provider's actual descriptor must be explicit while the legacy default stays identical.

B00R integrates newer R2a collision corrections: mujocoProgramSet adds gripperBackM and conservative palm half-diagonal radius; checkArmSweep covers the palm behind TCP. Use that corrected proxy for world FK/IK/sweeps. B01 reach-only feasibility does not certify this enlarged/accurate palm corridor. Do not restore old smaller proxy to make the world rig pass.

B03 recorder/readback integration: initial rawtick0 includesdeclaredpriming; logical interval metrics cover(0,lastTick], whileinitialpose/max tilt mayusetick0. Sharedworld mustretain durableACK→append→logicalcommit andrecord explicitadvancedgap oninvalid/failedappend withoutengine retry. Extend admission context/streamschema additivelyforactual arm/cell contactIDs andlaterinteractionrecords; mobile-only strictreader cannot besilentlybypassedforworld. Preserve existingmobileartifacts andprimingclockconvention.

## Active prop lifecycle versus mobile admission

Existing arm engine.py preallocates prop bodies, keeps absent slots parked with contacts disabled, and reports only `in_scene` props; placements activate/remove them. B03 mobile PhysicsAdmission intentionally requires the fixed load-profile prop set on every tick. A cell starting with an empty tray then spawning coffee cups therefore needs an explicit additive active-prop admission/lifecycle rule—do not pass empty-load admission forever, weaken all mobile validation, or infer allowed IDs/presence from the first untrusted snapshot. Bind known prop/slot-to-cup mapping to admitted cell inputs and verify birth/removal against recorded source-owned interaction events. Parked inactive slots are not visible payloads or transport load metrics. Preserve each active cup's prop identity through nozzle→gripper→tray→recipient; a custody transfer is not a placement. Review how the existing arm port maps source cup IDs to preallocated slots before selecting the new world mapping. B05 rig can provide explicit placement records; B06 supplies the full source/custody sequence.

## Global MuJoCo options need an explicit world profile
Static preflight: arm compile.py184 sets global cone=elliptic and impratio fromarmphysics; mobile compile_mobile.py202 leavescone/impratio atengine defaults, while explicitlysettingNewton/iterations/tolerance. A single MjModel cannot retain conflictingglobaloptions forboth originalworlds. Define andrecordanexplicitnewworld numericalpolicy, keeporiginalarm/mobileprofilesunchanged, andproveits behaviorwiththe10rigtrials andboundedmobileobservations. Do notinheritb02a-lockedidentityorclaimbit-identicalmobilephysicsforachangedglobaloption; sameengine/timestepremainsrequired. Preserve per-geom/paircontactparameters through namespaceddefaultclasses or explicitvalues so mergingXML cannot silentlyreplacearmgrip defaultswithmobile defaults. Mobiletrayfriction maydifferfromR2astatictray; recordactualmixedcontactpolicy.

ArmEngine constructor currently mj_resetDataKeyframe+mj_forward only, whereas MobileEngine/session hasdeclared20mspriming. Sharedworld mustdeclareitsoneprimingpolicy, countsubsteps once, andkeepB03rawtick0/windowsemantics; don'tinvoke both engines' initializationsteps. Existingxarmcoffeeproject haslegacyassetRefnamearm-puma-reference but armCollisionProfile, fixturecomponent andXARM6_SI determineactualxArm identity. Newworld identity mustbindactualmodel, notinferPUMAfromlegacydisplayassetname.

## Tick-commit failure seam
Extend world-step/caller failure checks to commit failure after a successful durable append, not only lostACK/append failure. Retain the durable snapshot and pendingoperation/horizon evidence; never send the same worldstep again or restart the engine to retry. Caller must latch unknown/incomplete as appropriate and ensure reload is read-only/stale. Keep commanded/prepared intent separate from observed joint/prop/AMR state: preparing the next target cannot manufacture arrival, grip or release before a validated committed observation.

Shared Sim3DSnapshot permits optional arms for legacymobile. World admission must validate the arm/robot identities, joint-vector/model expectations and activeprops needed by its commit consumers beforeappend/commit; a valid tickalone is insufficient. Existing workerclient envelope checks stayauthority forrun/boot/request/scene/clock. Addfocusedworld-negative tests only, preserve oldarm/mobilepaths.

## Existing shared-engine slot and cup-input checks
Current navigation2d/runner.ts slotsOf already aliases mujoco_arm, mujoco_3d and reserved mujoco_cell to mujoco_engine. Reuse that process-wide capacity boundary for the world provider; do not create a second pool. Existing worker-client.close waits for the owned process exit/stream finalization; release the slot only after world teardown is established, not merely after sending stop or seeing a failed request. Test admission against an active legacy arm/mobile run and while world close is pending.

B01 already aligned mobile free cup with R2a: mass0.32kg=empty0.02+drink0.3, cylinder radius0.04m/height0.1m. Keep one admitted free prop identity/material/inertia throughout the new world; there is no need to invent a different cup to make handoff easy. The arm's old static tray friction1.0 versus mobile receiver defaults remains an explicit new-world contact choice as noted above.

## Rig evidence versus B06 workflow scope
Run the bounded physical handoff rig before investing in the full cell workflow. Its traces can establish actual bilateral grip, release/support settling, withdrawal and AMR transport, but observed contact stage is not automatically source business custody. If a rig uses a narrow test context rather than the complete source workflow, label that explicitly. B06 owns final source-correlated giver/receiver receipts, MJ-CELL-BV01 served2 and the workflow fault matrix. B05 still must implement/test the world factory/step/commit seams and preserve mock/arm golden behavior; do not advertise the complete cell scenario before B06. Report rig10/10 or the retained concrete failure, never substitute a weld or synthetic custody field.

## Initial shared-world probe and layout ruling
The first actual shared-MjModel probe at B01 dock found original pick pose link4/chassis penetration4.34mm and regenerated placeApproach link4/5 upper-tray penetration up to8.80mm; home/lift/place endpoints were free of nonfloor contact. Raw development probe is /tmp/mekoniq-b05-probe. B01 reach-only feasibility therefore does not establish a corridor.

Controller permits bounded changes to the NEW world dock, waypoints or arm placement, with explicit physically consistent FK/scene/source/render transforms and retained configuration identities. Original vendor/arm/mobile geometry/profiles stay intact; no smaller palm proxy, removed receiver supports or genuine-contact exemptions. Freeze a viable candidate before the10-trial rig. Escalate a coupled design choice if alternatives fail; do not silently reorder the required dock→pick/place→withdraw→transport workflow.

## Additive lifecycle/evidence interface rulings
Use optional worldInteractions on the existing step payload for world-only birth/removal intents. Bind each one-to-one to propPlacements, admitted cup/prop identity, unique eventId, legal lifecycle and targetTick; existing envelope retains run/boot/request/scene identity. Old arm/mobile modes reject the field before mutation. Source records pending intent before sending, and durable observed lifecycle only after validated ACK. Worker validates physical lifecycle, never custody; handoff/grip/release do not place a prop. B05 explicit rig event IDs are rig provenance; B06 must supply actual journal correlation. Preserve immutable bounded/hash-covered interaction records with before/after poses, reason and command/event/tick references. A bounded manifest/admission block may declare/index lifecycle but cannot substitute for missing records. Test absent/duplicate/wrong-binding/tick/outside-world intents and preserve fixed mobile admission.

WorldPlantBindings may require source-only evidence ports (append/fail/finish), constructed from admitted scene/config at the world factory, never from the initial ACK. These are not browser or wire API. Temporary observationTick/nowMs during commit is allowed to timestamp staged callbacks; public clock/observations/telemetry/cup ledger and durable business events must not expose partial commit state. Commit failure keeps last committed public state/stamp plus durable ACK/pending horizon, terminal/stale/no retry/no event drain. Do not assume no-drain rolls back a callback that already persisted an event; handle any such immediate-persistence seam explicitly and test it. Agent owns source schema/types/versioned docs/report; controller updates external design examples after final interface names are settled.

## Final production-fixture rig gate

The direct10/10 trials establish feasibility. Inspection found one cup in the direct model versus two preallocated slots in production (nq28/nv26 versus35/32;29/26 versus30/27 bodies/geoms). The support reference is10mm above the tray body origin, explaining relativeZ; existing traces also have measured XY/joint drift, whose unique cause is not established. After remaining source seams and physical behavior stabilize, run the same10 declared nozzle offsets through the actual production IPC worker plus world recorder. Keep frozen choreography/oracles/offsets, record model/config/commands/native counters, and audit quotas/readback. Retain direct and failed/representative runs separately. Do not add a causality-isolation trial or full Source served2 workflow solely for this issue; B06 owns the latter. Freeze/hash final inputs before the gate and commit/export/pin afterwards.

## Final interface and completion clarifications

World-only pose consistency may compare quaternion representations sign-invariantly with tolerance1e-10 while retaining finite/unit checks and original raw values. Free-joint versus matrix conversion produced a measured~6e-16 representation difference; preserve rejected ACK/gap attempts and test q/−q, small perturbation, outside-tolerance and invalid inputs. This is not physics retuning or weakened identity validation.

Source navigation bindings come from independently admitted world metadata and are checkpointed with scene identity for read-only recovery. Goals use the actual AMR base dockpose/yaw, not tray center or default legacy yaw0. Preserve last actual pose and old bindings on their respective paths. Stage direct CoffeeDriver source.submit/store callbacks as well as helper callbacks so failed world commit cannot publish partial business state. Worker PID/model dimensions/substep counters may be recorded as bounded provenance; run/boot/request/scene remain authority, PID is descriptive.

The production10-trial campaign started under frozen policy SHA59f324285e224158d3ac4690adb2c4226b9a0021be9a3d3d0433dd891f2723cf. A recorder-only self-review correction is permitted afterwards: active durable prefix must not be advertised as a finished run after a crash with a later unresolved send. Preserve readable prefix and distinguish active/incomplete from corruption/gaps; do not change legacy mobile semantics. Add a targeted crash-prefix regression and read finished artifacts with the final reader. Reuse this physical gate only if final model, commands, physics and record bytes are unchanged and post-freeze diff is solely manifest completion lifecycle, with explicit before/after hashes. Other changes require reassessment of affected evidence; never silently call the tested code hash identical.
