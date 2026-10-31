# Supabase Free operations

Run `pnpm supabase:start` for isolated local Auth, PostgreSQL 17, Realtime, Storage and mail. Local success does not verify hosted quota or production recovery.

`deploy/profiles/supabase-free.json` records the dated planning budget. Recheck provider pricing and account dashboard before deployment; organization quotas include other projects. `pnpm cloud:budget` reports unknown for absent measurements. Supply a measured JSON file with `--measurements path.json`; each metric needs `used`, `source`, and `measuredAt`. Application counters are estimates unless reconciled with provider usage.

Uploads go directly to the private Storage bucket. The server reserves project capacity, signs a scoped two-hour upload URL, then verifies MIME, size and streamed SHA-256 before marking the manifest ready. Signed downloads expire after 60 seconds. Interrupted uploads keep pending/missing metadata; local bytes stay until a matching hash receipt. New uploads stop at the reservation cap. Never delete financial facts or unacknowledged journals to reduce usage.

Warnings begin at 70%; critical at 85%. Reduce nonessential hints/telemetry and investigate usage. A paused project, unavailable Storage, or failed DB commit must not produce an ACK. The venue coordinator continues eligible LAN work and resumes HTTP journal catch-up after restoration.

Install Cron through migrations. Provision vault secrets `mekoniq_jobs_url` and `mekoniq_jobs_hmac` only on the intended deployment. Use an HTTPS jobs endpoint; keep its secret server-side. The scheduler wakes only due jobs; it is not a keep-alive for Free projects. Local `pnpm jobs:run` uses the same bounded route, HMAC nonce contract, and venue scope.

Use independent encrypted logical database and Storage backups; same-project Storage is not an off-site backup. Restore and capacity acceptance belong to W11. Production invitations/reset mail require custom SMTP; local mail stays in the mail sink. No account purchase or hosted deployment is performed by these scripts.
