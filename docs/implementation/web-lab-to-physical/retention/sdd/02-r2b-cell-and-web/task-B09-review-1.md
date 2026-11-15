# B09 independent task review 1

**Spec compliance: CHANGES REQUIRED.** R74/R75 and process ownership are substantially implemented, but I1 and I2 leave required recovery/ownership boundaries open. R76 legitimately defers actual container execution; that deferral is not itself an implementation finding or a qualification pass.

**Task quality: CHANGES REQUIRED.** One independently reproduced concurrency/resource-lifetime defect and one missing retained-state validation defect require fixes. No Critical finding. Two Important findings. No separate Minor finding.

Reviewed Source `714e37f9b8251663c3d7a3d3e668a0c35ca2d493..f419bdc0ef522f037e4a7717374e9135fbe5fce8` and Lab `4741edfcda3b421197235c50daed7c09b340bedf..701ad719c43572c2981a2542f4c6bbec51f656e5` using the supplied complete 224176-byte and 3397-byte packages, once in bounded passes. Requirements, dispatch and full implementer report were read first. This is the task gate, not whole-branch qualification.

## Critical

None found.

## Important

### I1 — Re-resolve and reserve cold reclaim ownership after asynchronous admission

**Location:** `packages/lab-runtime/src/v2/gateway.ts:287`, `:307`, `:314`, `:320`, `:326`, `:330`.

The handler snapshots `entry` before awaiting the reclaim body and disk lookup. The cold path later decides whether to open a runner and whether to use a queue from that stale snapshot. The `reclaiming` flag only covers the work currently executing; it cannot detect another reclaim that completed while this request was awaiting its body.

Concrete interleaving:

1. A reaches a cold run with `entry === undefined`, then waits for its request body.
2. B reclaims the same run to completion and installs its runner in `runs`.
3. A's body arrives. The active reclaim flag has cleared, but A still uses its captured `undefined` entry, opens a second runner, and replaces B's map entry.
4. Shutdown closes only the second runner. B's runner is no longer tracked.

The bounded protocol probe below reproduced **two HTTP-handler 200 outcomes, two factory opens and only one close**. This is an ownership bug even though R75 prevents a replacement physical world: the first retained runner's Source/file resources are orphaned. It also creates independent per-entry queues for the same logical run; work admitted on the displaced entry can overlap the replacement's recovery. The data-root lease cannot be described as covering *all* owned run resources through close when a resource has been lost from the map.

The stale lookup seam predates this change, but B09 explicitly owns reclaim execution ordering and complete process/resource ownership; the new per-entry queue does not close the cold case. This is an in-scope requirement failure, not a demand to rewrite unrelated code.

**Required change:** reserve/serialize by run ID before selecting the live entry, re-resolve it at execution, and hold the reservation through durable epoch publication and run installation. Preserve private proof validation and never replace an existing runner without owning its full close. Add a delayed-body or delayed-lookup two-reclaim regression that checks single construction, increasing epochs, current-entry checks and complete close accounting. Do not solve it by creating a second world or granting motion on reclaim.

### I2 — Validate required retained arm/world state before opening recovery resources

**Location:** `packages/lab-runtime/src/v2/scenario-runner.ts:129`–`:131`, `:183`, `:203`, `:216`; dependency `packages/lab-runtime/src/v2/checkpoint.ts:4`.

The new reclaim guard checks only that a checkpoint exists and, for a shared world, that `cp.world` is truthy. It does not validate the required retained coffee/arm state. `readCheckpoint` only JSON-parses; the manifest hash comparison validates the saved manifest identity, not the checkpoint's state fields.

An otherwise identity-matching arm checkpoint with its `coffee` member missing passes the new guard and skips the entire `if (c.coffee)` attachment branch, including the frozen arm ports and `RECLAIM_PLANT_UNAVAILABLE` marking. It can therefore enter recovery without the required arm state rather than refusing before Source opening/persistence. Similarly, `world: {}` satisfies the new world presence test even though its retained snapshot/identity is absent; the retained-world branch treats the object as a restart and skips retained arm-report reconstruction when its snapshot is absent.

R75 explicitly requires missing required retained state to fail closed. The existing new test deletes the whole `cp.world`, which catches only the easiest case; the actual arm test checks an intact checkpoint and cannot establish this failure boundary. This finding is from code inspection, not a new native run.

**Required change:** validate the minimum retained state appropriate to the admitted arm/world profile before constructing Source/plant/recovery objects or writing a checkpoint. Distinguish legitimately unavailable historical coverage from absent required state, return a stable recovery refusal, and preserve the original bytes on refusal. Cover missing coffee/arm state and missing required world snapshot/identity, while retaining ordinary direct-runner reopen compatibility outside explicit `reclaimOnly`.

## Important verified behavior

- **Independent session identity and private access:** `v2/gateway.ts:117`–`:125` creates a public UUID independent of the bearer key. The writer view exposes that public ID, and readable checks gate the changed report/display/SSE/download paths. Readers are explicitly granted and cannot acquire writer control through the writer route, archive or replay mutation. No listing endpoint is added.
- **Queued actions and transfer:** `v2/gateway.ts:65`–`:85`, `:288`–`:304`, `:332`–`:348` centralize writer/epoch/session checks and serialize actions/transfers on an existing entry. Start/resume checks authority again after async readiness. Epoch zero retains the documented original-writer omission compatibility; later writer mutations require the epoch. Former-creator expiry checks the current owner inside the queue. This existing-entry behavior is sound; I1 is the unreserved cold-entry case.
- **Durable fencing:** `v2/reclaim-store.ts:18` writes metadata through a staging file, file sync, rename and directory sync; no session secret is introduced into that metadata. It is separate from the process lease. Reclaim clears readers, advances the epoch and retains read/reconcile-only control. No disconnect-triggered writer takeover is added.
- **Origin/CSRF/CORS:** `src/gateway.ts:86` adds the control epoch only to v2 CORS. The writer route remains behind the existing Origin and cookie CSRF checks. The new real HTTP tests exercise independent tokens, private 404, explicit readers, transfer/stale epochs, session expiry and CSRF/Origin failures. No URL/query/localStorage credential channel is added by the diff.
- **Data-root exclusion:** `v2/data-root.ts:7`–`:23` acquires a dedicated SQLite write transaction after local-directory/lock validation, with no PID-based takeover or lock-file deletion. `src/gateway.ts:54` acquires it before `prepareV2`; `cli.ts` moves provider construction into that callback. Local filesystem assumptions and lack of multi-host/NFS qualification are explicit. This is separate from writer epochs.
- **R63 public shutdown:** `src/gateway.ts:125` onward stops admission, starts server closure, calls `beginClose`, ends streams/destroys responses, waits admitted handlers, closes run resources, then releases the lease. `v2/event-stream.ts:40` onward retains the handler lifetime through pending journal IO. The held public download/read, worker-close and SSE-read tests exercise the actual public close entry point. The recorded SSE RED demonstrates the original premature release and the final suite passes it. I1 still prevents a general all-owned-resource claim for overlapping cold reclaims.
- **R75 intact-state recovery:** `scenario-runner.ts:131`, `:146`, `:153`, `:216`, `:236`, `:441`, `:503`, `:544` select frozen ports before coffee-provider creation, skip ordinary initialization/new telemetry, mark derived poses stale and reconcile with unknown observations. Ordinary direct opens keep their default behavior. The recorded actual Darwin arm test checks child exit, retained arm state and scene bytes, and repeated reclaim without respawn. Mobile/world tests cover existing no-respawn behavior and missing whole checkpoint/world. I2 limits malformed/incomplete retained-state admission.
- **Portable image closure:** Dockerfile includes `/app/catalog`, uses quoted operator data directory and portable-only engineering. `engineering/runtime-options.ts:41` onward skips native Python/compiler registration only under the explicit portable option; `engineering/gateway.ts:128` publishes actual registered profiles. `prepare-catalog.mjs` materializes committed fixture catalog/models. The compile/refuse-native test exercises TypeScript mobile compilation without a native Python helper requirement.
- **Deployment shape:** compose/proxy/runbook provide one local volume, nonroot processes, read-only roots, no devices/socket, no automatic restart, exact forwarded Host, TLS files, SSE buffering off and explicit timeouts. The runtime's healthcheck uses its permitted loopback Host. Runbook covers key rotation, re-pairing, drain/stop, preserved-volume recovery, export and offline backup. Proxy execution remains untested and is stated as such.
- **Pin:** Lab diff changes only Source commit/artifact SHA and generated source headers; schema and portable-tool digests remain unchanged. Root separately verified clean heads and the actual runtime SHA `75beea81c09f7330a03faa14b68e3fb6db8cf0aa5dc60b3138497a1562987f91`. No new Lab-to-hardware route is present.

## Evidence review and qualification limits

Read the retained B07a review-2 shutdown observation, B09 final regression log and the relevant retained failure/green logs: `sse-close-red.log`, `actual-worker-green2.log`, `reclaim-arm-green.log`, `reclaim-stale-red.log`, `mock-bv01-golden.log`. Final regression is 66 passed / 2 skipped, with the container tests explicitly **not_run**. BV01 focused results are 2 passed / 39 unselected, not a full acceptance campaign. The failing cold-arm run identifies PID 58485 before its fix; it remains a failure in the record.

Inspected `actual-worker-processes.json`: actual Darwin arm64 portable execution, exit 0, 4.635 s, four owned worker/probe identities, all `sameIdentityAliveAfterTest:false`. Run child 63777 belongs to the reported run and scene; the fixture source identity is `test`, not a qualification candidate. The public held-IO evidence uses doubles and must not be combined with this actual active-world close into a claimed physical held-IO/container test.

Inspected Docker prerequisite metadata: final client 60963 timed out after 15.013 s, TERM/143, blank server identity/version/architecture and no valid daemon inventory. Inspected the static context audit's explicit `STATIC_BUILD_CONTEXT_ONLY`, `dockerDaemonUsed:false`, null image ID, 158 files, 9 components, 3 required fixtures and export SHA. Its file inventory is a static closure inventory, not execution of the image; no claim depends on the fake Docker boundary's final success text.

Root's retained gate-log verification establishes contracts/type/lint/build/export and Lab import/sync/check/type at the reviewed heads; this review did not rerun them. Actual image build, mobile compile/readiness/run, completed cell, named-volume container exclusion, crash/chunk preservation and finished replay remain **not_run/blocked_environment** under R76. Image identity remains null/unbuilt. These are B10 acceptance gates; current R2b image origin must remain unresolved and `nativeReady:false`. Native amd64, public HTTPS/WEB06, Cloud Run and hardware remain unqualified. None of I1/I2 is excused by that verification deferral.

## Scope and unchanged boundaries

All 30 changed Source files and 3 Lab files were reviewed. Source scope includes all deployment files (Dockerfile, main README, build script, catalog materializer, three single-host files, operations runbook); CLI; engineering gateway/options; public/v2 gateway, data-root, event-stream, reclaim store; coffee ports/driver and scenario/navigation runner; every changed integration/security/unit test and the process child helper. Lab scope is the lock and two generated headers. No unexpected changes to trial/web, operational ports, physics locks, historical evidence, hardware providers, schemas, browser engine or UI framework appear in these packages.

**Cannot verify from diff:** completion of B00 and the original R2a handoff; full unchanged IR-SIM/Webots byte and archive-reader compatibility; all native provider setup/teardown failure paths; unchanged UI a11y/translations/reduced-motion/no-runtime behavior; global SI/frame/tick fidelity beyond the untouched configuration and focused recorded regressions. These belong to root's cross-task/whole-branch evidence, not new passes in this review. Existing machine-specific retained replay test paths remain the previously deferred whole-branch item, not a fresh B09 blocker.

No plan-mandated defect identified. I1/I2 contradict stated requirements rather than implementing a defective mandated design. The new ownership mechanism and portable-only compiler separation are appropriate; splitting security/queue branches into more readable helpers would be ordinary maintainability polish, not a blocking finding.

## Method and focused probe

No Git, index, HEAD, branch, product-source or portable-tool changes. No helpers. No routine suite, browser, native worker or container rerun. One justified bounded probe was executed for I1 only. It used the existing handler with protocol objects, a unique temporary directory, no worker, and removed its temporary data in `finally`.

Focused dependency reads were limited to named risks: `checkpoint.ts` to determine whether missing recovery fields were validated; the cut-off world-attachment block and CoffeeDriver constructor/report methods to check frozen provider creation and retained-state/report behavior; `mujocoFromOptions` setup to check that its owned startup describe process closes before provider setup returns. The latter has local `finally` close/cleanup; other native startup paths remain unverified.

Exact command (Source worktree):

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.2/bin:$PATH"
perl -e 'alarm 20; exec @ARGV' node --import tsx --input-type=module <<'EOF'
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createV2Gateway} from './packages/lab-runtime/src/v2/gateway.ts';
import {saveReclaim,proofHash} from './packages/lab-runtime/src/v2/reclaim-store.ts';
const root=await mkdtemp(join(tmpdir(),'b09-review-cold-race-'));
const id='12345678-1234-1234-1234-123456789abc',directory=join(root,'run');await mkdir(directory);
await saveReclaim(directory,{runId:id,proofHash:proofHash('proof'),schemaHash:'schema',input:{mode:'simulation',sourceCommit:'test'}});
let opens=0,closes=0,release,entered;
const waiting=new Promise(r=>entered=r), gate=new Promise(r=>release=r);
const g=createV2Gateway({directory:root,sourceCommit:'test',schemaHash:'schema',now:()=>0,pairingValid:()=>true,spendPairing(){},same:(a,b)=>a===b,readBody:async r=>{if(r.delay){entered();await gate;}return r.body;},send:(r,status,body)=>{r.result={status,body};},simulationFactory:async()=>{opens++;return {id,holdForReclaim:async()=>({run:{id},tick:1}),close:async()=>{closes++;}};}});
const response=()=>({setHeader(){},result:null});
try {
 const paired=response();await g({method:'POST',headers:{},body:{token:'pair'}},paired,'/lab/v2/sessions','http://127.0.0.1:4175');
 const req=delay=>({method:'POST',headers:{authorization:`Bearer ${paired.result.body.sessionToken}`},body:{proof:'proof'},delay});
 const a=response(),b=response(),path=`/lab/v2/runs/${id}/reclaim`;
 const pending=g(req(true),a,path,'http://127.0.0.1:4175');await waiting;
 await g(req(false),b,path,'http://127.0.0.1:4175');release();await pending;await g.close();
 console.log(JSON.stringify({scope:'protocol-only cold reclaim admission race',firstStatus:a.result.status,secondStatus:b.result.status,opens,closes,expectedMaxOpens:1,expectedAllOpenedClosed:true}));
}finally{release?.();await rm(root,{recursive:true,force:true});}
EOF
```

Exit 0, elapsed 0.866 s. Exact stdout:

```json
{"scope":"protocol-only cold reclaim admission race","firstStatus":200,"secondStatus":200,"opens":2,"closes":1,"expectedMaxOpens":1,"expectedAllOpenedClosed":true}
```

`expectedMaxOpens` and `expectedAllOpenedClosed` are expectation labels, not observed passing assertions. The observed `opens:2, closes:1` proves the resource accounting failure. The fixture omits physics/checkpoint bodies deliberately because the finding is gateway ownership, not engine recovery. There were no worker processes or adopted resources to clean. This report retains the command and output; it does not count the probe as an acceptance test.
