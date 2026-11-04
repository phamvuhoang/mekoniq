# Backup and restore

**Policy:** `deploy/profiles/backup-policy.json` (status `not_configured`: it declares the plan, it is not evidence). A Free Supabase project has no managed daily backup or PITR to rely on, so the logical export is the backup. A backup inside the same project is not off-site.

## What a backup contains (`scripts/backup-restore-lib.mjs` → `createBackup`)

`public.sql` (structure + data of the app schema, no owners), `manifest.json` (schema `mekoniq-backup-1`: time, commit, every migration with its sha256, each file with size and sha256, row counts per table, **Auth inventory** = ids/emails/created-at only — no hashes, no tokens —, **Storage object manifest** with `copied` flags, the *names* of the secrets needed), and `storage/` object copies (`scripts/export-storage.mjs`; an object whose bytes do not match the manifest hash stops the export). Not included: secrets and private keys, sessions/refresh tokens, provider-managed schemas.

Encrypt the directory (age/GPG) and move it to storage **outside** the project before it counts as a backup.

## Verify

`node scripts/backup-verify.mjs <dir>` — manifest present and complete; every file present, size and sha256 equal; no stray file; every Storage object present and intact; no credentials in the Auth inventory. Any problem exits 1.

## Rehearse a restore

`node scripts/restore-rehearsal.mjs [dir]` (local Supabase): backup → verify → restore into a scratch database → neutralise live effects → compare with the manifest (rows, forced RLS, app role without BYPASSRLS) → drop the scratch database. The source database is never written. A local rehearsal's elapsed time is **not** an RTO.

## Restore for real (production)

1. New environment (never over the damaged one). Re-create the platform schemas through Supabase; restore **Auth** users with their ids (the inventory tells you which; passwords/sessions come from the platform's own Auth restore or users reset them) so `venue_membership` keeps its foreign keys.
2. Load `public.sql`; re-grant usage on `public` as the platform default does; the app role must not have BYPASSRLS.
3. **Neutralise before anything runs** (`neutralizeLiveEffects`): pending relay commands are expired (an old command can never be pulled), in-flight jobs become `unknown` and are reconciled by *querying* the other side (provider, e-invoice, channel), never replayed. Tokens are not restored.
4. Copy Storage objects back from the object copies; run the garbage collector's reconciliation.
5. Tablets re-sync from their own journals; duplicates are absorbed by the unique operation/entry ids, gaps are repaired by the devices (`tests/integration/upgrade-recovery.test.ts`, first test).
6. Record the drill: start/end times, data loss window (newest restored entry vs. newest entry the tablets still hold), problems.

## Not proven here

Production RPO ≤ 5 min / RTO ≤ 30 min need a drill on the real project with the real tooling; so do Auth login after a platform restore, independent encrypted storage and its key custody, and the cost/schedule of the target. Until a drill report exists, recovery for production is **not accepted** (Free functional use is not blocked by it).
