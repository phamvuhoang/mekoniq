# B06 Source workflow and continuous MuJoCo cell — implementation report

Status: DONE_WITH_CONCERNS — implementation, verification, clean Source export and Lab pin are complete; ready for independent review. No qualification acceptance claim. All evidence remains `accepted:false`, dynamics `not_calibrated`.

## Scope and implementation

Work is confined to the authorized `codex/web-lab-to-physical` Source/Lab worktrees. Bases are Source `9f68476f784cfe58bf7eaa66969656b9e3d266f9` and Lab `da6f6084c9df9d523f28eefde90355fd7c7c58d0`. Original checkouts, trial/web, operational ports, cloud/hardware, push/deploy/main merge were not used. The B06 brief and controller rulings are the requirements source. B07 UI/offline replay and B08 comparison are outside this implementation.

The implementation reuses the reviewed B05 factory, worker, step/commit boundary and recorder. It adds the actual Source sequence: recipe/order and cup binding; physical nozzle birth; admitted pick command and actual grasp/lift; matched robot/current load-stop dock admission; contact release plus sustained receiver check; Source custody confirmation; full arm withdrawal interlock; real navigation and recipient confirmation; Source-correlated physical recipient removal; return and second cup. No transfer placement, weld, synthetic arrival, mock receiver fallback or invented served count is used.

`CoffeePlantPorts.custodyEvidence:'correlated'` is optional and Source-only. It requires `bindLedger` while retaining the real arm snapshot. Absent-field legacy behavior, including existing `arm:null` ports, remains unchanged. The correlated path routes custody only through CupLedger. Late program completion after an already-confirmed transfer cannot revive the old transfer, and pure physical observations do not contaminate device heartbeat sequence counters. Cancellation/stop observations remain consumable while motion is interlocked.

The new producers are `mujoco_world_arm` and `mujoco_world_tray`, with fidelity `modeled` and observer IDs `mujoco-world-arm:arm-1` / `mujoco-world-tray:amr-1`. They are independent logical evaluations of current native observations, sharing one run/boot/scene/clock/substep provenance. They are not independent hardware sensors. Single observations and pairs validate pending command/transfer/cup/payload/epoch/device/recipient identities, exact world clock/phase semantics and same-snapshot provenance. A differing observer string or event ID is not authority. Staged observations drain only after a successful public tick commit.

The dock policy is ten consecutive actual samples within 0.01m XY, 0.02rad yaw, 0.01m/s and 0.02rad/s. Receiver receipt needs 25 consecutive actual support/contact/polygon-margin/relative-motion samples, relative speed ≤0.01m/s and 0.005m COM margin plus prop radius. A support coordinate reference alone is insufficient. Both giver and receiver are freshly evaluated from the committed snapshot when paired. Coordinator receipt freshness remains 500,000,000ns; no cached booleans are retimestamped after a pause.

Cup IDs map to admitted preallocated prop slots. Birth/removal commands bind actual Source journal events and pending identities before native mutation. Birth occurs only at the nozzle; recipient removal requires confirmed customer ownership and a Source `CupHandedOff` event. Custody transfer does not change prop identity or pose. Inactive/wrong/duplicate/held placements are refused. Physical lost/unknown state is separate from the last confirmed Source owner.

## Declared navigation policy and physical identity

New fixture `coffee-delivery-cell-v1` preserves all eight B05 physical/program/project/handoff files byte-for-byte. The original B05 fixture and its direct ten-offset evidence remain unchanged. The final world scene for seed7 is `0b0aba092565d46f9895dad0e0e93638cc4022e6e236904caa491b6174abb18d`.

`grid-diff-world-v4` is an assumed world-only controller policy. It admits exact signed bounds `[-0.6,-0.6]..[6,4]` on the existing open floor/no-wall fixture, preserving the full hull and all obstacle/swept checks. Every translation uses 0.004m leg tolerance; actual arrival uses 0.008m position, 0.016rad yaw, the existing stopped velocities and five consecutive samples. Dock hold remains separately ten samples. The assumed design braking deceleration is 0.25m/s² under the unchanged 0.5m/s² command acceleration bound.

The terminal internal staging point is goalXY + 0.20*[cos(goalYaw),sin(goalYaw)]. The controller turns to goal yaw there and follows a feedback-controlled negative-velocity step to the unchanged Source goal. There is no generic reverse lattice expansion, goal retry or pose snap. Already near-goal poses retain their existing behavior. Staging and the appended terminal leg require full-footprint pose, turn, bounds and swept-corridor checks against the same obstacles; impossible staging cannot fall back to an unchecked leg.

Travel direction and body orientation remain distinct for reverse heading feedback, asymmetric swept footprints, stopping corridors, invalid rear beams and turns. Actual matching full 360-beam rear coverage must be fresh and usable; rear invalid/stale/missing/partial/future data and dynamic rear obstacles block motion. LiDAR is not claimed to see the low nozzle stand. Guards check the step the follower can actually select after same-tick retirement, preventing the first reverse command from bypassing a rear check.

V4 terminal arrival retains the same goal while the previous-sent-command ramp reaches exact zero. The actual pose/both-speed window is reevaluated each tick; leaving it does not retain a sticky arrival latch. Sensor, no-progress and deadline checks remain active before the single Source arrival. Legacy/default routes and IDs and archived v1/v2/v3 metadata remain supported; the live cell fixture/readiness uses v4.

## Normal bootstrap, evidence and recovery

The normal portable bootstrap/dispatcher constructs the configured verified world factory for the exact single-world engine/set. Readiness checks fixture/project/closure/lock/policy/clock/capacity and actually creates one shared model with inactive props and no business effects. The common engine slot and exclusive probe gate remain held through actual worker close, including abort/failure. Only successful exact identities cache; mutable prerequisites and capacity recheck each request. A missing provider is not inferred ready from arm capability. Normal configured native tests use no manually injected world ports; the full campaign uses an explicit Source-only factory seam.

World commands retain Source-owned `worldControl` context describing the selected program/stage/waypoint/transfer/held-prop proxy/interlock. It cannot supply allowed collision pairs. The reader derives pair/region permission from admitted scene/program files and validates Source journal correlation. Phase/contact intervals merge only when allowed-pair sets are equal, preserving allowed→forbidden boundaries.

`world-full-capsule-v1` checks every consecutive actual arm-joint interval against current full admitted AMR geometry/pose. It is separate from all-substep native contact aggregates and does not prove AMR-versus-fixed-stand clearance by itself. Full Source native cases separately inspect actual contacts involving all AMR and fixed cell bodies. Legacy ARM03 retains its truthful bounded-cache `EVIDENCE_TRUNCATED`/`not_run` result.

The Source-only `world_durable_v1` policy retains 16 derived collision/trace/prop/debug rows in hot state, preserving current state, stats/counters, immutable first failure, commands, programs, gripper/custody, rollback and failure horizons. Every live sweep and complete raw durable world observation remain. Legacy default 4096 behavior is unchanged.

A world report captures one trusted public horizon H, critical arm state, manifest, Source journal/effects and business view within the action queue. Recorder capture serializes immutable chunk references and exact synced tail without flush/finish/republish/repair. Materialization happens outside that short boundary and cannot include an ACK at H+1. Reconstructed traces are transient, content-addressed and cover `all_world_ticks`; tracking statistics remain explicitly `active_program_ticks`. Full reconstructed state is not written back to checkpoints. Normal gateway reports expose the same scoped worldSweep, not only the campaign CLI.

`prefixCovered`, `streamFinalized`, publication status and business `outcome.status`/served are distinct. A closed H40 stream can be finalized with served0/needs_attention. Read-only reopen uses only the retained admitted bundle and trusted horizon, never the latest fixture or a respawned worker. Missing/corrupt/ambiguous/oversize data yields explicit unavailable/incomplete/not_run. Bounds remain 30,001 observations, 256KiB per line and 400MiB inflated stream; trusted Source journal is additionally capped at 10,000 entries/16MiB. The B05 durable failure horizon and publication-cleanup guarantees remain intact.

Registered physical faults admit one fixed preset from server-owned campaign configuration: dock drift while the actual gripper is closed before release, or cup fall during actual supported transport. ID/revision/force/frame/duration/target/phase are fixed by registry; arbitrary browser forces/body IDs are refused. Source WorldPending durably stores the exact WorldTickCommand, including its one-shot intent. Native receipt.requestDigest is reproducibly verified as hashJson(command); there is no separate pending.requestDigest field. Receipt requestId must equal world-(targetTick+2), with run/boot/scene bound to the trusted checkpoint snapshot/admission and native receipt. The worker consumes before applying, clears forces in finally, and never resends after unknown ACK. Dock drift uses 2000N map-X for ten substeps; cup fall uses [30,0,30]N map for ten substeps. These are registered disturbances, not natural slip. Actual violation, Source latch and next physical command ticks are reported separately; no earlier physical or hardware stop is claimed.

## Freeze04 actual campaign results

All3nominal and5fault assertions passed on the exact frozen source. Native suite exec85208 exited0; every test used its exact OwnedProcesses cleanup/actual-close assertion. No product, schema, fixture or test input changed. The final read-only audit rechecked all73 source hashes and hashed469 original case files. Full identities, commands, outcomes, receipts, timelines and every artifact path/size/hash are in `evidence-B06/freeze04-campaign-summary.json` (SHA256 `71dc35a83411389c2046ed16c9923616c29cc01ddb57667e98ed2296027465fb`).

| Case | Directory | Public tick / Source outcome | Test wall seconds |
|---|---|---|---:|
| nominal7 | `/tmp/mekoniq-b06-nominal-7-1iGdiu` | 10850 / completed, served2 | 357.010 |
| nominal42 | `/tmp/mekoniq-b06-nominal-42-KPRuax` | 10850 / completed, served2 | 367.978 |
| nominal99 | `/tmp/mekoniq-b06-nominal-99-niKNMg` | 10850 / completed, served2 | 366.876 |
| dock-drift | `/tmp/mekoniq-b06-world-dock-drift-v1-7-6VFzUV` | 1700 / needs_attention, served0 | 57.272 |
| cup-fall | `/tmp/mekoniq-b06-world-cup-fall-v1-7-J19pL7` | 2375 / needs_attention, served0 | 88.521 |
| cancel-held | `/tmp/mekoniq-b06-cancel-held-7-TIvdkq` | 1700 / cancelled, served0 | 61.438 |
| worker-loss | `/tmp/mekoniq-b06-worker-loss-7-B70dWY` | 1700 / needs_attention, served0 | 62.352 |
| lost-ack | `/tmp/mekoniq-b06-lost-ack-7-IujrGW` | 1700 / needs_attention, served0 | 61.768 |

Exact run / boot / scene identities:

- nominal7: run `9821d890-85d2-41f0-91f8-d070ab7c222a`; boot `941a44c4-43aa-49c5-aae3-c34baa735609`; scene `0b0aba092565d46f9895dad0e0e93638cc4022e6e236904caa491b6174abb18d`.
- nominal42: run `604fd23e-6baf-4b95-a2fa-49dcd0598282`; boot `d0921d94-dc50-463f-a339-fc1532416a64`; scene `6d23339a2c8031fc84d1a7b792708cd71447ec4eeb5e40dd5e086155272dffe8`.
- nominal99: run `bc0a2c15-01bc-4084-9a90-d040534d86ae`; boot `6caea6e6-5dc8-49e4-8488-362e8929a65c`; scene `8df07343d5ab4458a6583adab406ad8e35d34a4416a313833d2d5c27c7d31da7`.
- dock-drift: run `59cf2da1-63d5-4b30-a630-818a46cb4569`; boot `10c05d4a-c734-44c7-86c8-85a2718996b9`; scene `6340342d0b426196d50af51f16ac7209260cb83f39c4a4336fa22c04b2c957cf`.
- cup-fall: run `2d8c4707-4bd2-455e-a2c8-1cc3ddb365ca`; boot `ad6f9c18-f620-4c13-bf23-c0a0d56efcd9`; scene `9e1ac027a9bab166753936d242e923f808285b6edddffc5eeb02eeb68f51b04b`.
- cancel-held: run `f86bfa06-8e33-4f0c-ac2f-1171dda16e4f`; boot `0e597dfe-b49b-4257-9c7b-4b95595cfa43`; scene `0b0aba092565d46f9895dad0e0e93638cc4022e6e236904caa491b6174abb18d`.
- worker-loss: run `cd400e14-cccd-4a0a-b31e-0a641d89fbc5`; boot `938fa085-9832-4718-98c2-ea1223a7ff07`; scene `0b0aba092565d46f9895dad0e0e93638cc4022e6e236904caa491b6174abb18d`.
- lost-ack: run `77a6834c-aceb-4f5d-b76e-81c22316966d`; boot `e9a55511-d6fb-4c8d-a753-b9c74a91c981`; scene `0b0aba092565d46f9895dad0e0e93638cc4022e6e236904caa491b6174abb18d`.

Each nominal run completed217simulated seconds, both physical picks/places/deliveries/returns, four Source custody confirmations, two recipient handoffs and four Source-correlated birth/removal interactions. Stable free-body IDs remain cup-1/cup-2; maximum observed cup step is0.0099136114m. Runtime committed-prefix and finalized-archive geometry/native results match exactly:10850/10850 geometric intervals withzero uncertain/failure and52446 native interval aggregates withzero unexpected contacts. Actual AMR↔arm/stand contact pairs are empty through both routes/returns.

Closed-case audits (`freeze04-seed7-audit.json`, `freeze04-seed42-audit.json`, `freeze04-seed99-audit.json`) additionally check all10850 command deltas and wheel limits and all six original Source arrival events against five preceding actual snapshots within8mm/16mrad/.01m/s/.02rad/s, withzero sent velocity at each arrival. MaxΔv=.010000000000000009, maxΔω=.030000000000000027 and maxwheel5.606432rad/s. This audits original observations/Source validation; it does not retimestamp historical receipt freshness. Raw0..H contains52450contact aggregates because it includes four expected wheel/caster↔floor priming contacts at0. The named full sweep covers intervals1..H and reports52446. Root independently audited the four priming contacts of all3seeds; see `freeze04-root-priming-audit-7-42.json` and `freeze04-root-priming-audit-99.json`.

Fault results retain their distinct physical evidence:

- Dock drift: registered force/actual violation/Source latch1679, nextphysical command1680, final1700. DOCK_OUT_OF_TOLERANCE and TRANSFER_UNKNOWN, served0, Sourceownerarm and actualheldcup retained with closed gripper commands after the disturbance. Geometry1700intervals andnative8590interval aggregates pass.
- Cup fall: force2347; three consecutive actual tray-relative below-threshold observations produce violation/latch2370; nextcommand2371, final2375. LOAD_FELL and PHYSICAL_UNKNOWN, served0. Sourceownerrobot is last-confirmed only; physicalparentnull/statuslost. Geometry2375intervals passes, while native contact result correctly remainsFAIL for the actual floor↔cup contact2375 (12802aggregates,oneunexpected). The fault assertion passes because it detects and holds the physical loss; the native failure is not promoted or hidden.
- Cancel while held: cancel at1700, served0, CELL_CANCELLED modeled arm latch, closed gripper command and actual heldcup snapshot preserved. Cancellation itself advances no native step; the snapshot stays unchanged and no physical/hardware stop ACK is inferred. Stream finalization is complete while the business outcome iscancelled.
- Worker loss: a real exact-owned worker is killed; Source stays at1700, pending1701 remains sent/acknull, terminal WORKER_LOST, WORLD_UNKNOWN/ACTION_INTERRUPTED, served0. Sourceownerarm remains lastconfirmed, physicalparentnull/statusunknown. Another step cannot resend; reopen does not call the factory again or add a cup. Stream remainsincomplete with its explicit1701gap.
- Lost ACK: test drops the bridge result after a real native effect. The retained response proves actual1701 with cup stillheld; Sourcepublic1700/pending1701sent/acknull remainunknown with ACK_TIMEOUT and noresend. Reopen does not create another world or cup. The actual extra response is retained outside the public world stream and is never promoted into a committed receipt.

Worker/ACK cases can check the known public1700prefix but retain `complete:false`, `streamFinalized:false` and terminal/gap metadata; they are not complete-world qualification passes. Fault timeline files distinguish observed violation, Source decision and next physical command. Modeled requested/acknowledged/observed stop labels do not assert an earlier AMR physical stop or hardware ACK.

Commands were the two frozen commands in the campaign summary, with explicit Node/Python environment and `B06_SOURCE_IDENTITY` from freeze04.identity. Nominal suite wall1093.04s (test bodies1091.87s); fault suite wall332.48s (test bodies331.35s). Per-case wall includes setup, Source stepping, report/readback and assertions. Nominal end-to-end achieved ratios are0.608×/0.590×/0.591× (217simseconds divided by357.010/367.978/366.876wallseconds). Worker+IPC is not separately measured. These are actual Source cases, not native-only FPS or a1×/browser qualification.

## Freeze04 and exact source bytes

- Payload SHA256: `d7360b57a8a2a424e609a84e905f52741afe625b13758153dbafc6c2ba3bd162`.
- Stored JSON file SHA256: `3795090492037cdbecc078cee3415f5345fb8dbeb9ebf3d48a52de6ddd818ae9`.
- Tracked patch SHA256: `cc60cac5a22d5add554eaafc2caa5cbf8d3046c837d4a00c3a3aa3a9c0db3c96`.
- Complete 73-file byte archive: `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/b06-freeze04-source-g__45ifr/source-bytes.tar.gz`, SHA256 `d9dc20259f0cacb563367b5c87305d1bb8c6047270a3cd25638886f3a5a41d83`.

Inventory payload identity is SHA256 of UTF-8 `json.dumps(inventory,indent=2)` excluding terminal LF; the stored JSON adds one LF. Campaign `sourceCommit` carries baseSHA+B06:payloadSHA and identifies the dirty development snapshot, not a committed SHA. The archive includes every changed/untracked path and all inventoried physical inputs; Git base supplies other unchanged dependencies. Every archived byte was read back against its inventory hash. Root independently verified all73 file/archive hashes, no unlisted changes and all8 physical equalities (`freeze-04-root-audit.json`), then all469 originalcase files/179970442B, two frozen logs and all73 committed6db8997inputs again (`freeze04-root-final-campaign-audit.json`). No input changes are made during the matrix.

Freeze03 source reproducibility was also closed additively: original tracked patch + root29-file exact untracked supplement + seven separately recovered files reconstruct all73 hashes. Root's complete reconstruction is `/tmp/b06-freeze03-reconstructed-source-kxmlzv3a`, audit SHA `37efa37550e2fb82e5ea00ff66346b002c044eca007d82c5cd6ae00456b7debb`. Original freezes were not rewritten. Prior payload/file hash distinctions remain documented in their inventories and recovery pointers.

## Final commits, export and Lab pin

- Source implementation: `6db89974fe44bddc72f7828ee00508d86aa725f3` — `feat: deliver coffee through a continuous MuJoCo cell`. All73 inventoried frozen input bytes match this commit.
- Source final head: `c49d5bfea6087811ace89874c092d0d62001eead` — `fix: bound runtime manifests at 256 KiB`. This adds only the packaging correction described below; all73 native inputs also match this final head.
- Lab final head: `b11768f581cb310993123e8e3d2da3390d1fad82` — `chore: pin source runtime c49d5bf`.
- Both worktrees are clean on `codex/web-lab-to-physical`. No push, deploy or merge occurred. Review ranges are Source9f68476..c49d5bf and Labda6f608..b11768f.

Fresh clean export: `/tmp/b06-runtime-export-final-6ps9kk4c`. Runtime artifactSHA256 `5dfd9ce815f5ba27fbe2d228d7df4b81fa61588df17dfab72a089db64d2eaf2b`; schemaHash `a149a3a724dc811841e976a5e0dc343c88a608b638bc451bf8eed04395d13f80`; portable tool digest `43c5b81d47ce5f1957714201624e1d20c9d1032b140326047fa2dcdc6c8c87f3`; compact manifest65810B/SHA256 `57baa5f3da68f8eedf9bb6c1eebf7c577d37f5b92bd99d3b794a67a6791435c0`, dirty:false.

Commands: `node scripts/export-lab-runtime.mjs /tmp/b06-runtime-export-final-6ps9kk4c` from clean Source; then from Lab `node scripts/import-runtime.mjs <export>`, `node scripts/sync-engineering-contracts.mjs`, bounded `pnpm check:source`, `pnpm typecheck`, pin commit, and a final committed `pnpm check:source`. All passed. Logs: `export-ruling54-final.log`, `lab-import-ruling54-green.log`, `lab-sync-final.log`, `lab-check-source-final.log`, `lab-typecheck-final.log`, `lab-check-source-committed.log`. Exact final identities are in `final-integration-summary.json`.

Packaging ruling54 was necessary: the original clean6db8997 export had a legitimate compact65810B manifest, exceeding the unchanged65536B Lab cap. That failed export `/tmp/b06-runtime-export-cxrjd0ye` and `lab-import-final.log` remain unchanged. Both Source export and Lab import now use an explicit256KiB UTF-8 byte ceiling, including terminalLF. All closure paths/hashes, schema/provenance fields and notes remain unchanged; structural/count/path/digest limits remain4096closure entries/256schemas/512path characters. Source refuses oversize before emitting its manifest; Lab refuses cap+1 before destination/pin/artifact mutation. The cost is up to256KiB parse input instead of64KiB, still bounded. No unrelated importer refactor or native input change occurred.

Focused RED→GREEN: `source-manifest-bound-red.log` → `source-manifest-bound-green.log` (four passes, one optional clean-worktree testnot_run; includes actual standalone bundled runtime startup); `lab-manifest-bound-red.log` → `lab-manifest-bound-green.log` (7/7). Valid65537B and exact262144B accept;262145B refuses without mutation; malformed/tampered/path/schema/dirty-source checks remain. Source packaging typecheck/lint passed (`typecheck-packaging.log`, `lint-packaging.log`). Actual fresh export/import/check/type passed.

The final export differs from the retained failed export only in sourceCommit/artifactSha256. Runtime bytes are identical after replacing only the literal embedded Source commit6db8997→c49d5bf; no other normalization is used (`packaging-ruling54-runtime-equivalence.json`). This packaging-only change was explicitly authorized without a physics rerun. The3+5 native cases remain recorded against Freeze04, never relabeled as executions on a different tuple. B10 still records required qualification on its final clean tuple.

## B07a typed API and retained-input handoff

B07a should reuse the Source capture/admission seams below; B07b owns UI/render/performance wiring. No new observation-only factory or browser-provided authority is needed.

| Boundary | Exact Source path and types/functions |
|---|---|
| Normal runtime entry | `packages/lab-runtime/src/v2/navigation2d/readiness.ts`: `portableSimulationFromOptions`; `simulation3d/mujoco.ts`: configured `mujocoFromOptions`; exact set `engineering-mujoco-cell-v1`, scenario `MJ-CELL-BV01`, composition `single_world` |
| Consistent report | `packages/lab-runtime/src/v2/scenario-runner.ts`: `ScenarioRun.report():Promise<RunReport>` and serialized capture; normal gateway `v2/gateway.ts` GET `/lab/v2/runs/:id/report` already returns this report |
| Deferred world reconstruction | `v2/beverage/coffee-ports.ts`: `WorldReportSource{journal,businessEpochMs}`, `ArmReportCapture.materialize()`, `ArmReportMaterialization`, optional Source-only `CoffeePlantPorts.armReportState(publicCommittedTick,source)`; `v2/scenarios/coffee.ts`: `captureArmEvidence` |
| Trusted prefix | `v2/simulation3d/world-evidence.ts`: `WorldPrefixAuthority{runId,bootId,sceneDigest,admissionDigest,publicCommittedTick}`, `WorldPrefixCapture`, `WorldPrefixRead`; owned recorder `capture(authority,requestedTick?)`; `captureWorldPrefixDisk`, `materializeWorldPrefix` |
| Admitted archive | Same module: `prepareWorldAdmission(scene,files):WorldAdmission`, `readWorldEvidence(directory,admission)` for ordinary finalized-archive semantics. `world-arm-report.ts`: `readRetainedWorldAdmission`, `retainedWorldArmReports`, `materializeWorldArmReport`, explicit unavailable fallback |
| Full geometry/native review | `v2/simulation3d/world-sweep.ts`: `WorldSweepAuthority`, `WorldSourceJournal`, `WorldSweepResult`, `evaluateWorldSweep`, `readWorldSweep`, `WORLD_SWEEP_SOURCE_LIMITS`; program/region derivation in `world-control.ts` |
| Report surfaces | `v2/report.ts`: `RunReport.worldSweep` and `manifest.worldExtent`; `v2/beverage/arm-plant-report.ts`: `WorldArmTraceScope`, `ArmReportBlock.worldTrace`, content-addressed trace/props references, `readArmTrace`/`readArmProps` hash checks |
| Actual twin samples | `v2/twin-projection.ts`: `ProjectionInput.world/worldStale`, `projectSamples`; AMR/free cups use `origin:physics_sim`, provider `mujoco_3d`, actual poses/held/restingOn and stale WORLD_UNKNOWN after failure |
| Wire shapes | `packages/contracts/generated/navigation2d.ts` plus `schemas/{lab-world-scene-v1,world-evidence-v1,sim3d-worker-v1}.schema.json`; transfer producers/world provenance in `lab-transfer-evidence.schema.json`; twin additions in `twin-sample-v2.schema.json` |

All `v2/...` shorthand paths above are under `packages/lab-runtime/src/`. H is obtained from the authorized Source run/checkpoint inside its action boundary; a caller-supplied H/run/boot/scene is not a trust source. Capture must remain short and serialized, while materialization stays outside that boundary. Reuse exact captured Source journal/business epoch, not a new journal query after capture. Prefix reads never flush/finish/repair, publish H+1 or recover/respawn a world. Keep prefixCovered, streamFinalized/publication and business outcome independent. Ordinary archive readers retain their existing complete semantics. Keep legacy mobile PhysicsAdmission strict; world active props require the separate admitted lifecycle.

Concrete complete seed7 inputs (same structure for all8case directories in the campaign summary):

- Run root: `/tmp/mekoniq-b06-nominal-7-1iGdiu/` with trusted `run.json`, original `nominal-source-journal.json`, captured `nominal-report.json`, and finalized `world-full-sweep.json`.
- Exact admitted inputs: `mujoco-world/bundle/lab-world-scene.json`; follow its files/models/programs/handoff references inside that retained bundle, including blobs. Do not substitute the latest installed fixture when reading this run.
- Durable world stream: `world-evidence/manifest.json` and its immutable `world-*.ndjson.gz` chunk references. Source owns the captured pending tail for a live prefix; offline code must not read a changing WAL without the capture seam.
- Full arm trace: `arm-trace-64f10abcdecb1fbc9bb760c7237a085a55cbb9f5751915cff9131b0f8e1be00c.json`, SHA64f10abcdecb1fbc9bb760c7237a085a55cbb9f5751915cff9131b0f8e1be00c,10851samples.
- Full cup trace: `arm-props-trace-b001afaa893b5d423117492a4db7b877a8e5838ed99cd79d72307fbcea794123.json`, SHAb001afaa893b5d423117492a4db7b877a8e5838ed99cd79d72307fbcea794123,10851samples. Resolve each report's own reference/hash rather than assuming these example names. Tracking stats cover1290active-program samples in this case; they do not describe the10851sample window.

The saved nominal report was captured before close, so its scope truthfully has prefixCovered:true/streamFinalized:false even though the separately finalized world manifest is now complete. Preserve that capture-time status. The report's signed extent is min[-.6,-.6],max[6,4], controller `grid-diff-world-v4` version4/hash02a23c9f74f6d8ab79a1521adeae45f9a406d0716886b2336a2f6a776b3cc787. B07b must use this signed origin/extent for viewport and geometry, actual world free-cup poses rather than custody anchors, and distinct Source owner versus physical lost/unknown. A support coordinate reference is not contact evidence. No native/hardware or1×readiness may be inferred from these modeled data.

## Verification and TDD evidence

Commands run from Source with Node24.22.2/pnpm10.32.1 and explicit PATH. Python/native runs use `.venv-mujoco`, `PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS='-p no:cacheprovider'`. Long commands use bounded Perl alarms and owned caffeinate. Logs below are under `evidence-B06/`.

| Check | Result and log |
|---|---|
| Source contracts/type/lint | Exit0: `contracts-final-v4.log`, `typecheck-final-v4.log`, `lint-final-v4-fixed.log`; one test-only prefer-const issue was fixed |
| Focused Source regressions | 220/220 across23 files in `focused-pre-freeze04.log` before the terminal-ramp correction |
| Final affected controller/golden/security | 42/42 in `world-v4-final-controller-regression.log`, including13 world tests and18 unchanged legacy controller tests |
| Python worker | 116/116 in `python-final-v4.log` |
| Normal configured native bootstrap/report/readiness | 5/5 in `native-readiness-final-v4.log`, including abort/no-cache/slot-through-close, report/action race and actual post-ACK rollback/reopen |
| Actual factory seams | 3/3 in `native-seams-final-v4.log`; ten unchanged direct B05 rig cases filtered `not_run` |
| Actual legacy MJ-BV01 | Two tests/three native runs pass in `r2a-mj-bv01-final-v4.log`; seed42 actual/command/cup repeat differences0; ARM03 unchanged |
| Full Source nominal/fault matrix | 3/3 nominal and5/5 fault assertions pass, `native-freeze04-nominal.log` / `native-freeze04-faults.log` |

Focused command: `perl -e 'alarm 240; exec @ARGV' pnpm exec vitest run` with the23 named B06/legacy files in the frozen log inventory. Final controller command uses `world-navigation-preflight`, `navigation2d-controller`, `bv01-mock-golden` and `mujoco-world-authority` (150s bound). Python command: `perl -e 'alarm 120; exec @ARGV' .venv-mujoco/bin/python -m pytest robotics/simulation-mujoco/tests -q`. Native readiness/seams/legacy files each run serially under300/180/240s bounds.

Meaningful RED→GREEN records include:

- Dock/receiver windows: `handoff-policy-red.log`, `handoff-policy-red-behavior.log` → `handoff-policy-green.log` (27 cases).
- Correlated routing/no legacy fallback and old ports: `custody-mode-red.log` → `custody-mode-green-fixed.log`; `heartbeat-counter-red.log` → `heartbeat-counter-green.log`; `settled-completion-red.log`, cancel/dock/failure negatives → the frozen focused suites.
- Strict world provenance and unchanged 500ms freshness/pause behavior: `world-provenance-red.log`, `world-provenance-braking-red.log` → `world-provenance-green-fixed.log`; final ledger regressions retained.
- Signed full-hull planning/precision/braking: navigation bounds/precision RED→GREEN and `world-braking-v2-red.log` → `world-braking-v2-green-final.log`; old route golden unchanged.
- Descriptive control/full-stream review and phase permissions: `world-control-red.log`, `world-sweep-red.log`, `world-sweep-quota-red.log`, `phase-boundary-red-fixture-fixed.log` → the named sweep/control/phase GREEN logs and frozen regressions, including >4096 changing scenes.
- Physical one-shot forces/admission: `world-force-red.log`, `disturbance-evidence-red.log`, old-mode negatives → `world-force-green-current.log` / Python116; exact fixed-preset input/receipt provenance in `fault-preset-provenance.json`.
- Stop tick and bounded hot state: `world-stop-tick-red.log` → `world-stop-tick-green.log`; `world-history-module-red.log`, `world-history-behavior-red.log` → `world-history-green.log`, including5000 changing worlds and critical-state/first-failure preservation.
- Prefix/capture/report: `world-prefix-api-red.log` → `world-prefix-green-fixed.log`; `world-normal-report-red.log`; live→reopen RED; `world-report-files-red.log`; actual `world-report-action-race-red.log` → final native normal report checks. They cover flush boundaries, missing/corrupt/oversize/write-intent data, immutable originals, concurrent H artifacts and H+1 exclusion.
- Terminal path: `world-terminal-observed-red.log` → GREEN under explicit staging; `world-terminal-sweep-red.log` proves the appended corridor check is needed. Broader turn-offset failure is retained below.
- Reverse guards/footprint: `world-reverse-red.log`, first-tick guard failure and `world-reverse-asymmetric-body-red.log` → `world-reverse-admission-green11.log`.
- Terminal command zero: `world-v4-arrival-ramp-red.log` reproduces a .212132rad/s one-tick jump → `world-v4-arrival-ramp-green.log`, with leave-window/no-premature-arrival/single-arrival/sensor/progress/deadline negatives.

Filtered/skipped checks are `not_run`, never passes. Whole unrelated platform suites/build/browser qualification were not run for this scoped backend change. B07b production browser/IPC/pause performance and B10 clean-tuple qualification remain separate.

## Retained development failures and diagnostics

These are immutable failed/interrupted/scoped development evidence, not nominal qualification passes:

1. B05 Source choreography preflight `/var/folders/92/wsfpj2x14hd3690cwlp639900000gp/T/b06-source-preflight-DhM3bF`:2100ticks/42simseconds/305.55s wall, actual pick/place/withdrawal, NO_PATH2084. Old zero-origin map could not turn the full hull at dockx.35. It ran before correlated custody routing.
2. Correlated native01 `/tmp/mekoniq-b06-source-nominal-Go38qX`, interrupted2308: arrival/interlock ordering deadlocked after a real grasp; transfer observations also contaminated heartbeat counters. Both defects were fixed and tested.
3. Correlated native02 `/tmp/mekoniq-b06-nominal-7-v1gfCo`, interrupted2505: first placement/withdrawal/outbound prefix, before heartbeat correction. Retained partial hashes and exact owned cleanup; no full nominal claim.
4. Freeze01 `/tmp/mekoniq-b06-nominal-7-scxrs5`, interrupted3209/public3208: first table overshoot16.934mm, served0. A translation retired with3.9225mm remaining at actual.1435m/s. Ruling46 introduced the explicit assumed braking policy and actual stopped-linear retirement. No case reuse.
5. Freeze02 `/tmp/mekoniq-b06-nominal-7-naRZWg`, interrupted per controller performance ruling at public/durable3757/published3749: served1/return prefix only. Retained safe DB copy and partial inventory. No nominal pass.
6. Freeze03 seed7 `/tmp/mekoniq-b06-nominal-7-la2hyl`, run96d17736-43f9-4a1c-a235-93711fdc6e51/boot1474492a-747a-4f76-ba14-20a19c1e1ee5: failed5400ticks/108simseconds/182.598s test, served1, NO_PROGRESS beforesecondpick. Seeds42/99 and all5faults were not_run. Full5400geometry intervals and28432native contact aggregates passed independently; all60artifacts hashed. Read-only frozen-controller replay matched every one of5400 durable velocity commands exactly and showed final translation retired4884 at2.151mm error, then final turn shifted[+7.842,-4.226]mm and retired5190 at10.473mm error. Zero commands followed until blocked5362→Sourcefailure5363. Full segment/pose/requested/sent/no-progress timeline is in `return-freeze03-audit.json` and its referenced directory.
7. V3 forward staging `/tmp/b06-native-terminal-VIUl0T`, scene7300fc073011a3b6ec82ce284096b402392d245622277dafba917c31ce25a8f4: same Source goal reference after exact measured arm-joint/drive-pose prefix replay through3204, then chassis/base/c0 hit nozzle stand at4467 (10substeps,peak1052.915N,impulse8.077Ns). Staging itself overlaps the admitted stand. Arm geometry1263 intervals passed separately. Raw contacts/source archive remain in `native-terminal-v3-unsafe.json` and `native-terminal-v3-source.json`.
8. First v4 reverse probe `/tmp/b06-native-reverse-ZPMl2A`: clearance/convergence2131intervals, no unexpected contacts,0.444mm final error/12dock samples. It retained the old arrival-zero angular-ramp exception (.213sent/.0116actual→immediatezero), so it is not a full command-bounds pass.
9. Corrected v4 reverse probe `/tmp/b06-native-reverse-QzuG3W`, boot a8c536fa-2620-4c47-91fd-c194d0721c51:2138intervals, no unexpected/AMR-cell contacts; final5342,error0.443999mm,yawerror0.014205rad,actual v/ω nearzero,12strict dock samples. MaxcommandΔv=.010000000000000009 andΔω=.030000000000000027 (floating error only). Old physical-prefix command SHA00939c6c98164d137f46855f93e9631a7c874b68eb793b6aff42939c0aa8fb71. Script `/tmp/b06-native-reverse-02/replay.ts` SHA42ea9bf447f8dafc6a2d70cecd9969dd71f8e62f952178a7bf9df9aa00b06d4c. Only measured actual arm joints and AMR drive-map pose were compared for prefix equality (max0,tolerance1e-10); no whole-model/free-body bit equality, new Source receipts or qualification is claimed. Exact73-file loaded source archive is referenced by `native-reverse-v4-bounded-zero-source.json`.

The refined controller regression injects the exact retained XY displacement during a >2rad near-goal turn under the same stated lag for both policies, independently of step indices. A broader6mm turn-offset model still fails an earlier tiny connector and is retained as an uncovered robustness limit. The isolated test does not establish general convergence or calibrated dynamics; actual scoped and full native cases decide this fixture's feasibility.

## Performance, limitations and remaining work

Closed checkpoint3208 (`/tmp/mekoniq-b06-nominal-7-scxrs5/run.json`, SHA0d5f9dbfd70da8c8d2293838842317f6a9b7f67942ef46cb70f72ffefc24a8c4) was11,942,457B. The bounded critical projection is187,704B and critical-state deep equality/original immutability passed. Same-closed-input CPU medians were stringify41.742→.624ms, cloneCoffee52.119→.422ms, cloneArm47.078→.401ms (`bounded-checkpoint-cpu.log`, `/tmp/b06-critical-checkpoint-0cm8KB/summary.json`). These are CPU-only, not IO/physics/IPC claims.

Actual Source bounded probe `/tmp/mekoniq-b06-bounded-source-probe-7-HhU1em` ran2200ticks/44simseconds in75.172s stepping (~.585×), maxcheckpoint156378B, full2200sweep and11796native aggregate equality; served0 prefix only. Complete Source end-to-end pacing is reported in the campaign table above (.608×/.590×/.591×); worker+IPC was not separately measured. No1×/browser/workerIPC cause claim is made. B07b still owns production browser180s/IPC/pause performance; B10 owns clean final-tuple qualification. B05 unchanged direct rig is local handoff evidence, not the v4 route. No software run closes hardware/native-host/physical stopping or calibrated safety gates.

No required B06 engineering work remains. Actual diff/new modules and the narrow packaging diff were self-reviewed; all authorized integration gates above are complete. Independent review is the controller’s next gate. Concerns remain explicit: achieved Source pacing is about.59–.61× end-to-end, the broader turn-offset model is an uncovered general-controller robustness limit, dynamics are not_calibrated, and B07b/B10/native-host/hardware gates remain open as scoped. No accepted:true or hardware readiness is inferred.


## R1 addendum — concurrent publication fix

The initial report, recording identities and results above are preserved. I1 is addressed by publication-only Source `0624b5ad4645a5a7cc655b11084f5ce8d7e79a75` and Lab pin `4fabc5a5638d78a0289f09a9af240af858e98b4b`. Both worktrees are clean. Shared writeDurable/recorder, physics/controller/authority and valid trace/props bytes are unchanged. Scoped46/46 regressions, Source type/lint and actual clean export/Lab import/sync/check/type/pin pass; two retained-nominal report materializations reproduce the original trace/props hashes on a verified isolated copy without native execution. All469original campaign files remain unchanged. See `task-B06-fix-1-report.md` for exact RED/GREEN, preservation, validator/recording distinction, commands and artifact identities. These R1 heads supersede only the current pin/head fields in this handoff; original Freeze04 provenance is not relabeled.
