# Task brief B04a — Source payload experiment/campaign and web data boundary

Original parent task: B04 in workspace docs/2026-11-13-web-lab-to-physical/plans/01-r2b-mobility.md. Controller split this into sequential B04a source and B04b Lab tasks to keep the numerical/campaign review separate from UI rendering/import. Parent B04 is complete only when both pass review; all original exit criteria remain.

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

## Owned implementation scope

- Create source/robotics/simulation-mujoco/campaigns/payload-v1.json, source/scripts/lab-mujoco.mjs and source/packages/lab-runtime/src/v2/simulation3d/payload-campaign.ts.
- Implement registered load/speed/friction experiment admission and required server-owned fault cases; update compiler/profile/session contracts narrowly where needed. Reuse reviewed B02/B03 runtime/recorder, no alternate physics runner or weaker reader.
- Extend only the mobile navigation telemetry path with actual free-payload entities/poses and admitted geometry identity needed by B04b. This is a simulation payload, not invented business cup custody. Preserve original run/boot/tick/sequence and physics_sim provenance, using only committed observations.
- Expose named capability/readiness/experiment IDs suitable for the B04b preset; browser requests may select registered IDs, never supply paths/code/arbitrary physics JSON. Profile change creates a new run identity, not a live-world edit.
- Add meaningful source tests for campaign/admission/telemetry and actual profile probes. No Lab UI implementation in this subtask; clean source commit/export then Lab pin/sync/check/typecheck required.

## Required campaign interface and evidence

CLI: `node scripts/lab-mujoco.mjs run --campaign payload-v1 --out DIR` and `verify --input DIR`.
Export `verifyPayloadCampaign(root:string):Promise<PayloadCampaignVerdict>` from payload-campaign.ts, with `{expectedRuns:number,completedCases:number,missingArtifacts:string[],faultCases:{id:string,detected:boolean,falseServed:boolean}[],issues:string[]}`. CLI verify and tests use this same bounded readback function, never a summary-trusting duplicate.

Campaign contains 18 recorded runs: 3 seeds × 3 load profiles for turning (9), 3 additional repeats of the same seed/profile (3), 2 brake, 2 friction, and 2 faults (worker kill/ACK loss). Each run has actual artifacts and source journal; schema/compiler/quota negative cases are additional and do not substitute for any of the18. Preserve complete input identity/source commit/engine/seed/profile/controller/stop policy and injection method. Verify actual artifacts, expected case keys, repeats, coverage and fault result/no false served; missing/corrupt/skip/wrong seed or profile cannot pass. A stress run correctly detected as a fault may pass its case assertion while its mission is unsuccessful. CLI exit0=allcaseassertionspass,1=failure,2=missingprerequisite.

Cases MJ01–MJ07 from contracts §9 remain the coverage authority. Load profiles are the B01 admitted empty/cup-center/cup-offset fixtures (not new invented hardware claims). B03 evidence/metrics definitions are authoritative; no zero or unavailable value is upgraded to measured success. Numerical variant probes must be actual engine checks; protocol doubles only establish lifecycle contracts and may not stand in for forces/contact measurements. Fault injection must stay test/server-owned and process-specific; no global pgrep/kill.

Source required test: tests/integration/mujoco-payload-campaign.test.ts, plus focused changed-seam tests. Use fresh temporary campaign output, not historical evidence. Test verify missing run, unexplained skip, wrong seed/profile, corrupt artifacts, and incorrect expected fault. Campaign actual recording should occur once at the source commit used for the exported pin; do not call a dirty development run qualification. It remains development/experimental evidence and accepted:false until B10 criteria and reviewer acceptance.

## Data handoff for B04b

navigation2d/runner.ts has independent record()/entities() paths; scenario-runner/projectSamples() does not automatically publish mobile props. The Lab's existing observed cup route is TwinSample observed.positionM/quaternionXyzw→entity.plant→TwinPoses.cups. Publish free payload with admitted collider/geometry and immutable input digest, without using xArm global cup dimensions or fabricated coffee-ledger IDs. Pose coordinate system stays canonical map/base; conversion to Three belongs to Lab. Empty load means genuinely no payload, not a hidden center cup. Provide a small typed/validated additive seam and identify its exact fields in the report.

B04b will register browser physics schemas, admit the new provider and display/replay geometry. Do not silently loosen existing Lab import validation just to enable the provider now. Pin-generated contract bodies must be generated through sync script; preserve old reports and navigation bytes. B04b needs a report describing concrete selector IDs, commands, geometry/profile access, live payload telemetry, report optional physics fields, campaign paths and launcher prerequisites.

## Registered experiment/profile admission risk
B02b compiler intentionally pins baseline physics byte SHA9a0940dcff41e56a21bf38bed4c4984d55200cfa736c6507ecced8e5df96a1d3 and center load; worker session's closed measurementLock currently requires probeId=b02a-locked. B04's required empty/offset/speed/friction cases need an explicit additive server-owned experiment registry/selector; this task may modify compiler/profile admission and targeted worker tests to support those registered inputs. Do not set b02a-locked on changed numerical values or weaken admission to arbitrary browser paths/profile JSON. Retain baseline profile/probe bytes. Each changed physics variant gets a new frozen identity and its own bounded finite/repeat probe evidence before campaign interpretation; same solver/clock pin remains. Record variant provenance, raw profile digest and own measurement/probe id honestly. Speed-only changes belong to controller policy and run identity, not a fake physics hash change. Review B02b final report/source for its actual selector seam.


PhysicsEvidence profile identities are the exact admitted profile file-byte SHA256s from the engine refs (not profile.digest or numericalInputsDigest). B03 brief/report documents this contract ruling. Campaign/reader/browser comparisons must use the same identities; still validate each profile document digest separately.

B03 interval metric convention: aggregate contacts/durations exclude raw tick0 priming and cover(0,lastTick]; raw tick0 remains initial observation, initial pose/slipbaseline/max tilt may includeit. Tick0-only interval metricisunavailable. Preserve the producer window labels ratherthan reinterpretingasN+1logicalintervals.

## Expected-fault coverage interpretation

The two worker-kill/ACK-loss cases intentionally can produce terminal incomplete physics with an explicit unknown advanced-tick gap. `completedCases` counts validated case assertions, not successful missions. Nominal cases require full verified coverage; expected fault cases require the declared injected fault/reason, correct last committed horizon/known unknown gap, no false served or resend/respawn, and valid retained raw artifacts. Do not require complete:true for an intentionally lost-ACK interval, and do not let expected incompleteness excuse missing/hash-corrupt/traversal/malformed artifacts or unrelated gaps. Classify reader issues and match only case-declared terminal gaps; a summary saying expected_fault is not evidence. Preserve source journal proof and actual injection provenance.

## Speed-input identity preflight

Current source MOBILE_CONTROLLER_POLICY identifies grid algorithm/ramp behavior and does not contain a numeric speed cap. Actual speed is constrained by NavigationPolicy.parameters.maxLinearMps/maxAngularRadps, wheel limits and the project's entitySpeedLimitMps; projectNavigationModel bakes effective limits into its kinematics/digest. A registered speed experiment must bind those actual applied inputs and new run/scene/policy/projection identity. Do not fake a physics-profile change or change the controller algorithm version when the algorithm is unchanged; retain the canonical fixture mechanics-file identity when mechanics are unchanged. The compiled physical-model file embeds current input provenance and may legitimately change; preserve that provenance and report every derived identity that changed.

B08 consumer must compare declared speed experiments using explicit allowed input differences and unchanged mechanical/controller-algorithm invariants. It must never broadly ignore all policy/model differences: if the observed changed fields exceed the registered experiment declaration, return incomparable/changed inputs, not a causal speed effect. Final B04a registry/API determines the exact admitted fields; explain them in its report.

Controller clarification after code preflight: navigation-compiler.ts compares each projected model.inputs to current project/world/assembly. Do not substitute stale canonical.inputs or relax that equality to keep a derived file hash stable. Stable mechanics means canonical-physical-model.json fixture bytes plus independently validated mechanics shape. Current-input physical-model file/modelDigest, rebound load file/digest and navigation projection may change even for speed-only input. Carry all those identities and field-level declared differences; B08 distinguishes provenance-only fields from genuine mechanics changes. Default omitted selector must preserve existing center compilation behavior.

## Controller ruling — actual cup-fall coverage (2026-11-14)
B03 monitor/threshold regression alone cannot satisfy MJ04 actual cup-fall. Preserve all original18 campaign runs. Add one supplementary actual-engine cup-fall run, so final registry/verify expectedRuns=19 and completedCases=19 when all19assertionspass; document18original+1requiredsupplement. This supersedes the earlier exact18 wording/example, consistent with contracts minimum18 andMJ04. FaultCases includes observed cup-fall along with workerkill/ACKloss. Do not substitute schema doubles or remove a friction/brake run.

A naturally falling registered brake case with retained actualtrace may satisfy the fall assertion without adding a disturbance; if that path is used report the concretecoverage and casecount tocontroller. Otherwise add a minimal closed server-owned perturbation registry: bounded finite force/impulse, once, knownprop/frame/duration/tick, applied via engineintegration. No qpos/teleport, no ledgerdrop, no fixture rewriting, no arbitrary browser forcevectors/paths/JSON. Bind perturbationidentity and declaredparameters to case/runinputs and archive actual injectionprovenance. Preserve unchangedbaseline profile/numerics. Invalidrequest refusal beforeengine mutation, no repeat/resend afterunknown. Retain finite actualcontacts/pose and stop-policy LOAD_FELL/no false served proof. Dose is selected by retained boundedprobe, not a hardware claim. B06 may reuse this narrowly named simulationfault seam.

Sharedprotocolnote: optionaldisturbance additions to mekoniq-sim3d/1 must be refused beforemutation by unsupportedprovider/mode (including arm-only/Webots), notsilentlyignoredwithsuccessfultick. Preservelegacyrequestbytes/defaultbehavior; addfocusedcrossprovidernegativeonly as needed.

Implementer selected a narrower server-only workerlaunch payloadPerturbationId exactCLIoption, notasharedrequestfield. This fits the registeredfault ruling; shared-protocolnote above is conditional, no wireextensionrequired. Bind option/tick/frame/force/duration toimmutable case/runidentity andreceipt; rejectinarm-onlymode beforecreation, clearappliedforceaftertheinterval, anddonot reinjectonduplicate request. Finalreport/probe supplies actualselecteddose andtests, nothardwarecapability.

## Controller ruling — braking observation window
The registered server-only payload-brake-observation-v1 completion policy may retain five additional committed zero-target observation ticks after business cancellation, in the same world. Bind policy to case, manifest and configuration; retain unchanged B03 stopped-hold criteria and default provider paths. Business cancellation timing may remain unchanged, but physical run completion/slot closure must not be reported prematurely to one-tick consumers or reopen/report readers. Every tail tick follows normal validation, durability and commit; faults/lost ACK terminate without retry/respawn. No new dispatch or confirmation during tail. Test single-tick stepping and interrupted tail in addition to the campaign batch. A tail that does not satisfy measured stopped hold leaves the metric unavailable; five commanded zeros alone are not proof of stopping.
