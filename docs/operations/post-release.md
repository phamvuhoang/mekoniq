# Post-release operations

**Owners.** Support owner: _named by the operator before go-live_. Escalation (cloud, robots, payments, e-invoice): _named by the operator_. This repository does not assign people; a release without these names is not handed over.

**Daily.** Open the operations dashboard (`deploy/observability/dashboards.json`): sync backlog and lag, expired relay commands, dead-letter and unknown jobs, unknown payments/invoices, unapplied funds, channel orders waiting, database quota ratio (70 % warn / 85 % critical). Resolve each item by its stated action; unknown states are reconciled by *querying* the other side.

**Weekly.** `pnpm cloud:budget` with real provider readings; confirm a verified backup exists off-site; review quarantined journal entries and conflicts; check robot firmware/map revisions against the commissioned profile.

**Monthly.** Restore drill (`backup-restore.md`) and record RPO/RTO; key and secret rotation check (`secrets.md`); dependency/licence audit and SBOM (`scripts/release-security.mjs --sbom`).

**On change.** Every release goes through `pnpm release:dry-run` and `verify-release`; migrations are expand-only until clearance (`rolling-upgrade.md`); a rollback is `rollback.md`.

**Monitoring that exists:** SQL alerts and dashboards definitions, load/capacity artifacts, the security and bundle scans. **That does not exist yet:** alert delivery (paging/email), a hosted uptime probe, hosted Free usage readings, a scheduled backup job.
