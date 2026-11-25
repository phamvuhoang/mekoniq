### Task 4: Repair Lab lifecycle, validation, recovery and test isolation

Additional audited residuals: duplicate control-unread test ID should become unique run-scoped IDs; independent exports may share base.id/revision+1 with different digests, so define and display digest-based identity accurately in all languages or implement an explicit revision identity policy. Preserve per-axis tuned provenance. For cross-tab proofs, read-merge-write of one localStorage object can still lose simultaneous updates; use independently keyed per-run entries (with migration/read compatibility) or an equivalent concurrency-safe design, not only refresh-before-write. Known base keep() already preserves open/unread entries; add regression beyond eight rather than duplicate the logic. Runtime mutation deadline must not enable automatic resend; unknown create may lack a recoverable UUID: it acquires no engine and remains under the existing session/open-run policy; only a successfully started idle worker is covered by the resource lease. State that outcome honestly.

Task 2 produces optional TuningResult.wheelMeasurement: quantity=wheel_angular_speed, inertiaAssumption=straight_line_no_slip, and comparison from verified wheel/chassis observations at a specific tick (null for older/absent evidence). Display the actual tick/sampling scope; a final-tick comparison is not peak slip over the whole bench and does not prove no slip during a fast step. Read the generated final type rather than invent fields.

**Files:** Lab `src/ui/{control-panel,workspace,svg-plot}.ts`, `src/control/workbench.ts`, `src/scenarios/controls.ts`, runtime client/target modules, styles; `tests/unit/*control*`, workspace/proof tests, `tests/e2e/{mujoco-control,remote-origin}.spec.ts`, launcher tests and `scripts/run-mujoco-e2e.mjs` (use actual existing runner filename).

**Interfaces:** Consume generated source contracts and server-owned bench assumptions. Bind request continuations/history/marks/proofs to original runtime and session generation. All network operations have bounded deadlines with preserved unknown-outcome recovery; do not replay mutation on timeout.

- [ ] Failing tests for late create from A after retarget to B, re-pair and unreadable 404, two tabs merging/pruning proofs, and stale response after disconnect. Reclaim with valid proof before treating ownership 404 as absent; support close when pin mismatch without enabling new runs.
- [ ] Failing tests for stalled step/report/trace/archive: Stop resolves to a recoverable state within a bounded request deadline; preserve proof and known result. Late responses cannot mutate the new session's state.
- [ ] Failing tests for malformed health nested loops/bounds and successful malformed tuning/trace JSON. Validate shape/semantics/run identity before accepting/archiving, keep reread available. Share generated source schema where feasible.
- [ ] Failing test: read result + failed archive + Close must retain result/export/A-B. Preserve all unresolved open/unread entries beyond 8 while bounding completed history. Rereading an older result must display the result. Mark/prune against current storage; resolve cross-tab proof clobbering.
- [ ] Close remaining UI debt in touched flow: correct keyboard-shortcut help for Control, meaningful plot accessible names, sticky banner/focused controls visible at 390/1024/1440 and wheel trapezoid layout, hide orphan close when unpaired, display failed free-engine action in Control, draft source attribution after gain changes.
- [ ] Read and display wheel angular-speed/no-slip assumption from server with all three translations. Do not silently infer body speed from the wheel trace.
- [ ] Make launcher test ports isolated/configurable rather than requiring existing 4175/4176 listeners to stop. Same-origin cookie/CSRF e2e uses allowed origin AND public host, asserts cookie/no bearer/CSRF on mutations. Keep remote bearer coverage too.

```ts
expect(runtimeB.calls).not.toContainEqual(expect.objectContaining({runId: runtimeARunId}));
expect(savedProofAfterUncertainResponse).toBeDefined();
expect(historyAfterClosingReadRun[0].tuning).toEqual(readResult);
```

- [ ] Run Lab typecheck/full unit suite, all launcher tests, same-origin Control and paced twin e2e with screenshots. Commit UI and test fixes; do not touch existing listeners.


Cross-interface note: createBenchRun writes a bundle/empty trace and creates a run entry but acquires no engine. The host idle lease starts only after successful start/confirmed progress. For unknown CREATE without UUID, do not promise that the run entry is archived after60s: it remains bounded by existing session/open-run policy. For unknown START/STEP, a successfully started idle worker is covered by the60s resource lease. No automatic resend/adoption after either uncertainty. Source defaults now use explicit control revision2 and exhausted-route-correction policy; consume server profile/controller metadata generically instead of assuming only one revision1 controller. New final bench evidence is bench-v2; bench-v1 stays historically bound.
