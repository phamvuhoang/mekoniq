# Rollback

Rollback means **roll forward the data, step back the code**. Money, orders and journals written since the release stay.

1. **Stop new risk first.** Disable the affected feature in the venue configuration (it drains: accepted work finishes) or stop dispatching (`robot stop request`, hardware E-stop for safety).
2. **App back one build.** Re-deploy the previous Vercel deployment (`rollback` or promote the previous deployment id recorded in `rollback.previousDeploymentId`). `rollbackAllowed(current, previous)` must be true: the schema stayed expand-only and the two schema ranges overlap, so the previous build still reads the database and old/new tablets still sync.
3. **Never** restore an old financial snapshot over fresh sales. If data must be restored, do it into a new environment (`backup-restore.md`), neutralise live effects, and let tablets re-sync.
4. **Migrations are not reverted.** A bad expand migration is fixed by another expand migration; a failed migration stops the release before deploy.
5. **Tablets.** Keep the previous APK; downgrade only a tablet whose outbox is drained; the coordinator last.
6. **After.** Re-run `pnpm release:dry-run` against the rolled-back state, write the incident record (`incident-response.md`).
