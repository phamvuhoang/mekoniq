# Task brief B09

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

## Task B09 — Gói web runtime, persistence và một writer

**Files:**

- Modify `source/deploy/lab-runtime/{Dockerfile,build.sh,README.md}`; thêm variable `LAB_DATA_DIR` default `/tmp/runs`, Linux persistent profile đặt `/data/runs`.
- Create `source/deploy/lab-runtime/single-host/compose.yaml`, `proxy.conf`, `README.md`, `source/docs/operations/lab-runtime-single-host.md`.
- Modify gateway/session/run ownership ở `source/packages/lab-runtime/src/v2/` trong đúng seam R2a, không mở hardware providers trong image.
- Test `source/tests/integration/lab-runtime-persistent.test.ts`, `source/tests/security/lab-run-writer.test.ts`; mở rộng test container hiện có cho new sets.

**Interfaces:** config operator-owned, exact Host/Origin, TLS proxy, one runtime instance và named volume. Writer identity `{runId,sessionId,controlEpoch}`; mutation khác writer bị `RUN_WRITER_CONFLICT`; read/report/SSE được dùng theo quyền session hiện có. Chuyển writer chỉ qua operation explicit có epoch tăng; không takeover tự động khi disconnect.

- [ ] Test hai token race cùng run chỉ một writer; read stream không block stop/action; pin mismatch chặn create. Bearer không lưu URL/query/localStorage, cookie path/CSRF cũ còn kiểm.
- [ ] Build image clean gồm mobility/cell assets/closures; manifest capabilities đúng, không quảng cáo Webots/ROS/hardware. `LAB_DATA_DIR` validate directory writable và persist; `/tmp` vẫn cho ephemeral demo R2a.
- [ ] Test kill container giữa run: chunks committed đọc được khi mở lại, run active không tự tiếp tục, unknown/interrupted đúng; saved finished run replay được. Không hứa restore `mjData` từ workflow checkpoint.
- [ ] Proxy config tắt buffering SSE, timeout khai rõ, forward Host theo allowlist; health/readiness, key rotation/re-pair, drain/stop và export runbook. Không mount Docker socket/host devices vào runtime container.
- [ ] Chạy local container E2E trên architecture máy; WEB05 tested chỉ ở arch đã chạy. WEB06 public HTTPS và Cloud Run smoke chờ đích deploy/người dùng giao; ghi reviewable deployment files hoàn chỉnh trước hành động external.
- [ ] Commit `build: package a persistent single-host simulation runtime`; re-pin nếu closure/runtime đổi. Không sửa record G-CLOUD1 cũ.

```ts
const results = await Promise.all([writerA.step(runId),writerB.step(runId)]);
expect(results.filter(r=>r.ok)).toHaveLength(1);
expect(results.filter(r=>r.code==='RUN_WRITER_CONFLICT')).toHaveLength(1);
expect(await engineStepCount(runId)).toBe(1);
```

`writerA/writerB` là hai client HTTP thật trong `lab-run-writer.test.ts` ghép nối session khác nhau; `engineStepCount` đọc instrumentation protocol-double chỉ trong test security. WEB05 engine integration kiểm riêng actual worker, không dùng số đếm double làm bằng chứng physics.

```sh
perl -e 'alarm 300; exec @ARGV' pnpm exec vitest run tests/security/lab-run-writer.test.ts
perl -e 'alarm 900; exec @ARGV' pnpm exec vitest run tests/integration/lab-runtime-persistent.test.ts tests/integration/lab-runtime-container.test.ts
```


## Ownership/persistence preflight
- Current gateway intentionally returns 404 for another session's run; reclaim with proof restores view/reconcile only and must not resume a world. New writer conflict must not silently grant unrelated sessions read access or promote reclaim proof into motion authority. Scope explicit transfer to an authenticated current writer plus verified recipient session, with epoch fencing; preserve private-run behavior for sessions lacking run authority. If two-token test needs readers, establish their explicit authorization before racing writes. Escalate any conflict between old ownership contract and proposed transfer API before weakening it.
- Single process action queue already serializes a run, SSE is separate. Persistence also needs one runtime process owning its data root (not just one HTTP session); named-volume multi-container race must be refused, not two engines reading same checkpoint. Distinguish process lock from per-run writer epoch.
- Dockerfile has inline shell entrypoint; no entrypoint.sh currently. build.sh assembles a clean source export context and enforces closure. Extend operator-owned data dir and actual new fixture closure; keep immutable image build and source identity. Existing arm64 Linux-on-Mac build is local container evidence, not native-amd64 qualification.

- Engineering dependency check: new mobile compiler is TypeScript, but existing engineeringFromOptions requires Python PyYAML and native compiler root for its default native profiles. Original MuJoCo Docker image only has MuJoCo lock/root and schemas. Add complete pinned required catalog/helper closure/dependencies, or implement explicit portable-only engineering that advertises only actual available compilers and blocks unavailable native profiles. Do not claim mobile runtime works because arm-only image starts. Exercise compile→readiness→mobile run from image itself.

## Local container prerequisite check
On 2026-11-14, docker info succeeded: server29.8.2, aarch64 Linux, 10CPUs, 8392671232 bytes RAM, context orbstack. This is a Linux VM/container on the Mac and must be labelled accordingly; it is not evidence for native amd64. Recheck live state before container tests; do not prune unrelated containers/images/volumes.

## Cross-process lock preflight
Node24 node:sqlite DatabaseSync is alreadyused bypackages/sync/src/storage/sql-store.ts andCupLedger. A dedicatedSQLitefile witha connection-held write transaction is onepossiblelocal-filesystem processlock withoutanothernative dependency; notarequirementtopickthisimplementation. Official SQLite transactions permit onlyonesimultaneouswriter andBEGINIMMEDIATE returnsSQLITE_BUSY whenanotherwriterholds it (https://www.sqlite.org/lang_transaction.html); rollback-mode locking is described at https://www.sqlite.org/lockingv3.html . Treat thataslockmechanismresearch, notexecutionevidence.

Do notbasecross-container ownershiponlyonPID/starttime files: bothnamespacesmayhavePID1, andonecontainercannotproveanother'sdeathfromitsown/proc. Requirednamed-volume two-container/process race and crash-release tests mustexerciseactualownership beforeanyworldstart. Persistentcorrupt/uncertain lock statefailsclosed; neverdeletea live/unknownlock to make startupwork. Separatedata-rootprocesslock fromrunwriter epoch andfromsourcejournaltransactions; noautomaticmotiontakeoverafterlockreacquisition. Documentlocalnamed/bindfilesystem assumptions ratherthanclaimmulti-host/NFSlocking. Holdownershipuntilallworkers close, includingstartupfailure.

## Public shutdown ordering from B07a scoped review (ruling63)
Ruling: B07a scoped review closes I1–I4 but carries unchanged public gateway shutdown ordering to B09 drain/stop ownership work. Current parent g.close awaits server.close before internal v2.close, so a held active response can delay reaching new abort/destroy cleanup; current active-shutdown claim is internal-only, not proved for public close. B09 must test public g.close with held download/pending owned IO and fix ordering so request admission stops, owned responses/captures abort and settle, workers close, then data-root ownership releases; preserve exact ownership and legacy lifecycle. Cost if wrong: until B09, graceful shutdown may wait for active clients and cannot be advertised as promptly aborting them; deferral must remain visible and close before final runtime qualification.

Read task-B07a-review-2.md Out-of-Scope Observations and final fix1report. Concrete unchanged dependency is `packages/lab-runtime/src/gateway.ts:119`; new internal download cleanup is v2/gateway.ts:319 at reviewed5e09a48. Exercise the PUBLIC gateway close API while an admitted asset response is held, including an aborted/pending owned read and an active worker where applicable. Do not satisfy this by draining clients before calling close or only calling internal v2.close. Bound actual completion and retain process/data-root ownership until all own worker/file activity is finished. This is part of existing drain/stop and ownership requirements, not a general server rewrite.

## Latest Docker prerequisite observation (2026-11-15)
Root read-only docker info did not complete under the intended15s Perl alarm; exact owned shell55349/client55359 were fingerprinted then TERM-stopped, exit143, both confirmed gone. No daemon/container/volume action. Partial blank/zero formatted stdout is not valid Docker metadata; availability is currently unknown. The earlier29.8.2/arm64/orbstack inventory is historical. See evidence-B09/root-docker-prerequisite-incomplete.json. Recheck with an effective owned-subprocess timeout before actual container work; do not restart/stop unrelated daemon or containers to manufacture a pass. Portable implementation can progress while diagnosing a concrete local prerequisite.

## Controller ruling74 — explicit authority API
Ruling: B09 may add an opaque public sessionId distinct from the bearer/cookie secret and a writer-only POST /runs/:runId/writer with operation grant_read or transfer, recipientSessionId and expected controlEpoch. Recipient must be an active paired session in this runtime; do not add a session listing endpoint. Explicit grant gives only run-scoped read/report/SSE/display/download authority; unrelated sessions still see private404. Transfer preserves authorized readers, changes the one writer and monotonically increments epoch; no disconnect/expiry/reclaim automatically acquires motion authority. X-Lab-Control-Epoch may be omitted only by the original epoch0 writer before any transfer; supplied mismatches are always refused, and every later writer mutation requires the current epoch. Authority check and mutation/transfer must be linearizable at execution, not only HTTP admission, including queued actions and session expiry. Preserve read-only reclaim/reconcile and existing proof-owner replay/archive housekeeping without extending it to granted readers or allowing resume. Validate Origin/CSRF and CORS for the additive route/header; expose public writer/epoch state without bearer/reclaim secrets. Cost if wrong: credential disclosure, stale queued writes or former-owner expiry could violate privacy/control; independent IDs, real two-session HTTP races, delayed-action/transfer and expiration/reclaim regressions must prove these boundaries. This adds simulation authority only, never Lab hardware control.

## Controller ruling75 — cold reclaim must not create an arm world
Ruling: B09 explicit gateway reclaim may pass a server-owned reclaimOnly provider option, requiring an existing identity-validated checkpoint and selecting retained/frozen arm ports before any coffeePorts or worker/world creation. Actual Mac MuJoCo test proved public close released its child, but cold arm reclaim spawned a new child before holdForReclaim; this violates read-only recovery. Keep ordinary direct-runner R2a reopen semantics unchanged outside the explicit reclaim path. Missing checkpoint/fresh or missing required retained state fails closed; no new world, normal physical initialization, scene/bundle rewrite, substituted boot identity or synthetic motion/contact observations during reclaim. Preserve committed state/report references, explicit unknown/unavailable coverage and Source-only reconciliation. Cost if wrong: a recovery-only mode could lose report fidelity or accidentally alter legacy/native lifecycle; focused actual arm cold/repeated reclaim and no-checkpoint refusal, owned-PID cleanup, plus relevant existing world/mobile no-respawn regressions must verify the seam. Keep the observed failing run/log; do not modify original historical recordings.

## Controller ruling76 — unavailable Docker and deferred WEB05 execution
Ruling: B09's implementation may enter independent review and downstream portable preparation after its clean export/pin, while actual container WEB05 execution remains not_run/blocked_environment. Repeated Docker prerequisite observations produced no valid server metadata (two effective owned-child timeouts and an earlier root attempt requiring explicit owned-process cleanup); the final owned client60963 timed out15.013s and TERM-exited143 without daemon/container/volume changes. Do not reset unrelated Docker or repeat stalled attempts. Keep image identity null/unbuilt, distinct from clean runtime export artifact. Carry actual arm/mobile/cell image compile/readiness/run, competing named-volume containers, crash-release/committed chunks and finished replay into B10 final qualification; execute only when the Docker prerequisite is available, otherwise hand off the open gate explicitly. L00 must treat current R2b image origin as unresolved/nativeReadyfalse, separately from historical R2a images. Cost if wrong: container-only closure, permissions, filesystem or lifecycle defects may remain until execution; reviewed deployment code, portable-only compiler checks, actual Mac worker lifecycle and local process races reduce but do not replace that missing proof. This changes verification sequencing, not the acceptance threshold; no WEB05/native/TLS/cloud/hardware pass is inferred.
