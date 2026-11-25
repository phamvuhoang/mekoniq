# Plan 01 — review remediation and software completion

Scope confirmed by owner: fix R01–R12 in [review](../../reviews/2026-11-05-plan-01-code-review.md), the backup corruption test, and all remaining Plan 01 software. Human, Linux and hardware evidence gates remain separate. This does not implement Plans 02/03 or claim physical validation.

Authority: [Plan 01](01-foundation-mock.md) and its linked specifications. Existing evidence is historical until regenerated against the repaired source and pinned runtime.

## Work packages

1. Coffee: R01–R05; capacity/headspace; plausible quantity observations; milk policy metadata and persistent readiness; pickup timeout and recoverable interlock behavior.
2. Runtime: R06/R07/R11/R12; immutable input hashes; session reclaim; delayed/reordered observations; speed limits; mixed food/coffee workload and contention campaign.
3. Lab: R08–R10; evidence staleness; reset/run speed; actionable recovery; render independence; measured frame-time harness.
4. Arm: geometric swept collision checker with declared model/tolerance; modeled following error/stop/reset preserving uncertain cup custody.
5. Packaging and regression: deterministic backup mutation; offline distribution with pinned dependencies/assets; clean runtime export/import; full regression and acceptance evidence.
6. Independent review: inspect fixes and integration boundaries, resolve findings, rerun affected checks and record residual external gates honestly.

## Integration rules

- Each change has behavior regression coverage. Runtime and UI APIs are coordinated before integration.
- Source remains the business/journal authority. Mock models cannot establish physical grip, spill, safety or hardware readiness.
- No operational services, trial, shared branches or running robots are changed. Source-owned Supabase may be started for its integration tests and stopped afterwards.
- A reset creates a new immutable run; it does not erase journal/cup history or retry uncertain effects.
- New source code must be committed locally before producing the clean runtime pin. Nothing is pushed or merged by this plan.
- Acceptance rows become pass only from executed checks. Human studies, host cold reboot/network disconnection, fresh Linux and hardware gates remain explicitly unrun until their required evidence exists.
