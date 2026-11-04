# Secrets and keys

Server-only (Vercel environment, never in a client bundle — `scripts/release-security.mjs` fails a release whose public assets mention them):

| Secret | Used for | Rotation |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | admin client (device provisioning, Storage) | rotate in Supabase, update Vercel, redeploy; old key is dead on rotation |
| `DATABASE_URL` (role `mekoniq_app`, no BYPASSRLS) | all request-time SQL through the transaction pooler | change the role password, update Vercel; `DATABASE_ADMIN_URL` is for migrations/tests only and is never deployed |
| `JOB_HMAC_SECRET` (≥32 chars) | signs the cron → `/internal/jobs` wake-ups | rotate in Vercel and the Supabase vault entry `mekoniq_jobs_hmac` together |
| `DEVICE_GRANT_PRIVATE_KEY` (ES256 JWK) | signs offline grants, configuration publications, relay authorisations | issue a new key id, publish its public half to enrolled devices, keep the old *public* key to verify history; signatures made with a rotated key grant nothing new |
| `CHANNEL_SECRET_MASTER` (≥32 chars) | derives per-credential channel/emulator webhook secrets | rotating invalidates every derived secret: re-issue channel credentials first |
| provider credentials (payment, e-invoice, channel) | named in a profile's `credentialRefs`, read from the environment | per provider; never in the repository, fixtures or flows |

Rules: preview deployments use separate values and never the production database; a missing production secret makes readiness fail (it is not skipped); logs and error bodies carry codes only (`tests/security/session.test.ts`); test keys live under `tests/` and are refused by the release scan; secrets are never printed by scripts.
