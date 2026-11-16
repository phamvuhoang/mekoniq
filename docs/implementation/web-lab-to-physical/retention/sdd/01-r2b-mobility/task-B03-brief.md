# Task brief B03

Original plan: /Users/hoangpham/source/prv/robot/docs/2026-11-13-web-lab-to-physical/plans/01-r2b-mobility.md

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

## Task B03 — Physics recorder, metric độc lập và fail-closed reader

**Files:**

- Create `source/packages/lab-runtime/src/v2/simulation3d/{physics-evidence,physics-metrics}.ts`.
- Modify `source/packages/lab-runtime/src/v2/navigation2d/runner.ts`, `v2/report.ts`, worker `mobile_engine.py`/`snapshot.py` và validators.
- Test `source/tests/unit/physics-metrics.test.ts`, `source/tests/integration/physics-evidence.test.ts`, `source/robotics/simulation-mujoco/tests/test_contact_metrics.py`.

**Interfaces:** consumes `PhysicsTickRecord`; produces `openPhysicsRecorder(options)`, `readPhysicsEvidence(root,manifest)`, `loadDisplacementM`/`integrateNormalImpulse` như spec. Recorder có `append(record)`, `flush()`, `finish(reason)`; options chứa directory/identity/maxBytes/maxTicks/chunkTicks; reader trả `{complete,records,gaps,issues}`. `append` sau tick duplicate/gap phải từ chối hoặc ghi gap explicit, không đảo thứ tự.

- [ ] Test impulse, tray-relative slip, missing series và support change; đọc lại có thiếu/corrupt/hash/path escape/decompression bomb/quota và kill giữa chunk/manifest phải incomplete.
- [ ] Test contact lực/map frame bằng hộp đứng trên sàn, contact thoáng qua ở substep giữa vẫn xuất hiện; actual engine kiểm impulse tích phân đúng mẫu.
- [ ] Implement physics writer/reader bounded; tái dùng helper compression/hash/confinement hiện có, không đổi format navigation cũ. Sidecar publish atomic; crash không làm `complete:true`.
- [ ] Gắn append sau ACK và trước logical commit cho mobile; append lỗi terminal suspend, không retry tick. Report metrics chỉ từ artifact reader đã validate.
- [ ] Negative test thiếu contact samples nhưng telemetry còn mượt phải báo coverage fail. Report không có physics vẫn import được.
- [ ] Focused tests; commit `feat: record and verify payload physics traces`; re-pin.

```ts
import {expect, test} from 'vitest';
import {integrateNormalImpulse} from '../../packages/lab-runtime/src/v2/simulation3d/physics-metrics';
test('integrates every substep instead of using the last force', () => {
  expect(integrateNormalImpulse([0,10,20,0],0.002)).toBeCloseTo(0.06,12);
  expect(() => integrateNormalImpulse([Number.NaN],0.002)).toThrow('CONTACT_FORCE_INVALID');
});
```

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/unit/physics-metrics.test.ts tests/integration/physics-evidence.test.ts
PYTHONDONTWRITEBYTECODE=1 perl -e 'alarm 180; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests/test_contact_metrics.py -q
```


## Integration risk identified before implementation
The legacy navigation runner currently updates checkpoint/tick state around navigation-recorder append; adding a separate physics append after that is insufficient for the new commit ordering. Inspect B02 mobile path and make the new provider's physics ACK → validate → durable append → logical commit invariant explicit. Preserve legacy branches and golden bytes. An append failure after the engine advances is terminal with an evidence gap, never retry the engine step. A protocol double can verify ordering but cannot qualify physics contact forces. Read the B02 report for the actual new engine/session/snapshot APIs.

## Durable ordering and quota preflight
- Existing navigation/evidence.ts append buffers records, then immutable chunks publish every chunkTicks; merely awaiting that append is not durable observation persistence. New physics append must make observations durable before the new path commits its logical tick (e.g. fsynced bounded internal WAL followed by immutable chunk sealing). Public evidence stays bounded immutable chunk refs; do not create one permanent chunk per tick and exceed the 2,000-chunk/stream cap. A crash tail that has not published into the hashed manifest is explicitly incomplete/gapped per spec, never automatically continued by re-spawning the engine. Reader/report must use verified published coverage; a live buffer is not evidence.
- Navigation and physics quotas are each 100 MiB by default and combined no more than 200 MiB/run, including chunks/orphans/metadata accounted by writer. Check configured limits too; increasing one cannot evade combined cap.
- Legacy navigation append ordering/format stays byte-compatible; apply the stronger commit ordering to the new mobile/world path. Report() already serializes with action queue; flush physics before generating read-back metrics.
- Check old RunReport canonicalOutcome/outcomeDigest and Lab report-shape compatibility: adding an optional block must not alter a legacy report hash. New physics block is admitted/validated, not silently dropped by browser import.

## B02a support-observation semantics
B02a LoadObservation.supportId identifies the declared support coordinate reference, and poseInSupport continues to be computed after contact is lost. It is not evidence that the prop is currently resting on that support. Actual final-state contact plus relative-velocity hint is snapshot.props[].restingOn; sustained receipt must independently evaluate contact/polygon/relative-motion window and not accept merely a non-null loads.supportId. Keep the coordinate reference for tray-relative displacement/fall analysis, but distinguish current support contact explicitly in reader/policy/UI.

## Reader and artifact constraints checked against B01
B01 PhysicsEvidenceV1 currently contains one physics stream and chunk refs {path,sha256,bytes}, coverage {firstTick,lastTick,complete}, identity run/boot/scene/load/physics digests, gaps, terminalReason, metricsPolicyDigest and assumptions. Its schema bounds are deliberately broad (chunks<=10000; samples and saturatedSubsteps<=100); B03 must additionally enforce actual admitted profile semantics (10 substeps, one AMR, canonical unique contact pairs/prop IDs, correct tick/time and unit quaternions). A syntactically valid claim complete:true is not a verification result. Apply the stricter reader/writer caps in this brief; do not silently consume all schema-legal allocation sizes.
Do not require a nonempty contact array on every tick: genuine airborne motion may have none. Missing physics tick/required contact fields and invalid contact samples are coverage/shape failures; deleting a contact while rewriting the whole hash chain is not cryptographically detectable without an external anchor. Preserve the evidence trust limitation. Contact sign/substep completeness must also have actual engine tests; protocol doubles cannot prove it.
Use B02b's separate hashed observation/stop policy for policy identity, rather than mutating B02a locked numerical inputs. B05/B06 will add interaction stream support and activate slip/drop windows only after receipt for cell cups; B03 must leave an additive seam without prebuilding world workflow.

B02b integration finding: existing navigation recorder requires scan.tick==snapshot.tick; MuJoCo correctly caches LiDAR at 5-tick cadence. New provider-scoped admission must require exactly floor(snapshot.tick/publishEveryTicks)*publishEveryTicks with original matching sample time/IDs, record only publications, reject stale/future/missing next publication. Legacy branch unchanged. Implementer notified; B03 consumes this seam.

B02b review fixes add mobile observation validation before source observer events and a persisted startup-create latch for unknown create/start ACKs. Consume the final reviewed API/report: initial physics recording failure after world creation must remain terminal/unknown and may not clear startup uncertainty or enable same-run respawn. Existing ask() explicit refusal delivery label alone is not proof of no engine mutation; numerical/priming errors can occur after advancement.

## Process isolation scheduling inherited from B00R
Original qualification pipeline may still be active at /Users/hoangpham/source/prv/robot/.qualification/r2a-final-20261114-xqub7yqk/progress.json. Its tests retain global worker kill/empty selectors: do not launch real native workers while active. Controller will inform you when read-only progress confirms completion. Pure recording/schema/unit/bytecode-free in-process Python metric tests may proceed, but no worker command/module processes or browser runtime servers that affect the original. Preserve required real-engine tests for first free window; not_run is not pass. Use the corrected B00R test-owned process helpers once available.

## Fault tick ordering versus intermediate B02b tests

Ruling: B03's stronger ACK→structural validation→durable observations→logical commit order supersedes the intermediate B02b expectation that a malformed physics ACK advances logical tick. For structurally invalid/missing physics or durable append failure after engine advancement, preserve last committed logical tick, explicitly record next/known-advanced tick as a gap and terminal unknown, and never observe cancellation/valid telemetry or resend/respawn. Preserve B02b cancellation/startup invariants and update only the fault-horizon assertion with a new gap/pending-operation assertion. A structurally valid snapshot that crosses an experimental cutoff (e.g. BASE_TIPPED/LOAD_FELL) can be durably recorded and its observed tick committed, but stop monitoring must still precede source outcome confirmation. Cost if wrong: report horizons and legacy fault consumers diverge; scope the stronger path to new mobile/world and retain explicit logical vs known-advanced evidence checks.
The current tests/integration/mujoco-mobile-lifecycle.test.ts first two tests assert stopped.tick==moving.tick+1 for missing/bad-clock physics. That was correct before durable physics existed; do not retain this by committing malformed physics. Keep its no-cancel/no-valid-new-observation/no-respawn assertions; adapt the horizon check as ruled above and test last logical tick plus explicit advanced gap. Existing stop monitor is stateful and must run once per accepted observation (not once in validation then again in commit). Separate schema/semantic observation validation from experimental cutoff evaluation as needed. New-record invalidity cannot silently become a valid empty stream.

## Concrete metric/admission seams
Derive expected robot/prop/support IDs, clock/substeps and model drive-frame transform from admitted scene/load/profile bytes, not by trusting whichever IDs appear in the first observation. Physics base.poseMap is the actual base frame; wheel odometry is drive frame. A wheel residual must transform actual base pose by the pinned model's driveFrameInBase (or join same-tick verified navigation actual drive pose); do not compare base XY to drive odometry and invent constant slip. Tick/boot/scene joins need explicit matching. Stop-distance windows require the verified navigation command/actual velocity series and registered stopped thresholds/hold count; if absent, unavailable with a reason, never infer stop from a pretty trajectory or use zero. Keep legacy canonicalOutcome bytes unchanged (new evidence optional, no new default metric block for old runs). B04 consumes these truthful read-back metrics and can add display-only summaries without changing their definitions.

Metric edge checks: sum/integration overflow must not yield Infinity as available. Tilt is derived from actual chassis orientation (base.poseMap.quaternionXyzw); redundant roll/pitch fields cannot override that orientation. Validate their admitted semantics or compute independently and reject contradictions. Test rotated supports with constant poseInSupport, nonzero drive-frame offsets, support/prop identity changes, empty/missing series and wrapped yaw; these catch plausible-looking but wrong charts.

Scheduling update2026-11-14T00:41Z: original progress.json confirms entire pipeline ended00:40:25Z with allsteps exit0. Native-worker hold is released; use only corrected owned-process helpers, fresh test directories and unused ports. Original artifacts remain read-only. Required native checks can now run normally/sequentially.

## Profile identity ruling

Ruling: PhysicsEvidenceV1 identity.loadProfileDigest and physicsProfileDigest bind the exact admitted file-byte SHA-256 in scene.engine.loadProfileRef.sha256 / physicsProfileRef.sha256; metricsPolicyDigest binds the separately admitted observation/stop policy bytes for B03. SceneDigest remains canonical scene digest. Profile documents' own canonical digest and numericalInputsDigest remain independently validated inside those files, never substituted for the file hash. This resolves the previously unspecified identity-field ambiguity and matches the B02b navigation evidence engine refs. Cost if wrong: readers/campaigns would disagree on profile identity; document the semantics in source, tests and versioned contract docs before any B03 artifact is accepted.

## Initial priming interval metric boundary

B02 session.py explicitly primes one20ms native step during create and labels its end tick0; engineTime=(logicalTick+1)*20ms, source simTimeNs=logicalTick*20ms. Tick0 raw contact aggregates therefore describe a real priming interval, not a zero-duration force. Preserve worker priming behavior and locked numerical profile/probe bytes; scoped contact-observation changes required by the original B03 task remain allowed and must be explained/verified. Interval impulse/duration metrics must explicitly distinguish initial observation from the logical run [0,T]: exclude priming by documented default or label a metric window that deliberately includes it. Never silently add an extra20ms to a logical duration or zero out the actual raw tick0 contacts. Add a boundary test; initial pose/slip baseline can still use tick0. Report the final convention so B04/B07 consumers do not reinterpret it.

Final convention: Ruling: aggregate contact/interval metrics cover logical intervals(0,lastTick], excluding tick0 priming; preserve rawtick0, and mark tick0-only interval metrics unavailable. Pose/slipbaseline andmax tilt may includeinitialstate; threshold durationscountpositive-tick intervals only. B03 implementer proposed andcontrollerapproved; boundarytest/docrequired, no schemaorphysicsretune. Costifwrong: downstreamB04/B07 summariescouldincludeextra20ms/primingimpulse; explicitwindowmetadata/rulepreventsambiguity.
