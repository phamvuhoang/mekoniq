# Local identity and fixed-coordinator bootstrap

Use only the dedicated local MEKONIQ project (API 57421, PostgreSQL 57422). This procedure does not create/link a hosted project or send production email.

1. Run `pnpm supabase:start` after installing the pinned workspace dependencies. The schema and app role must exist from the checked-in local migrations/seed.
2. Run `node scripts/bootstrap-local.mjs` from `source/`. It creates a new local venue and owner through real Supabase Auth, generates a P-256 server issuer, and exclusively writes `apps/cloud-web/.env.local`. It refuses to overwrite an existing environment or venue. Optional `BOOTSTRAP_ORGANIZATION_ID`, `BOOTSTRAP_VENUE_ID`, and `BOOTSTRAP_OWNER_EMAIL` choose the local fixture names.
3. The generated password is in `.lab/bootstrap/owner-credentials.json` (mode 0600), never command output. The managed-device trust anchor is `.lab/bootstrap/issuer-public.json`. Both locations are ignored by Git. Keep the private issuer and service key only in the server environment.
4. Start `pnpm dev:cloud` and sign in at `/login`. Device enrollment uses an authenticated manager session and the managed Android restrictions described in the tablet provisioning runbook. Enroll each native device key/epoch and certificate fingerprint before granting control.
5. Call `POST /v1/venues/:venueId/ownership/initialize` with `{deviceId}` exactly once for the selected enrolled coordinator. This creates the initial owner bound to both device ID and epoch; it cannot take over an existing owner after timeout.
6. `POST /v1/venues/:venueId/devices/:deviceId/provision` returns signed native authority, offline staff grant and pairing grant. An optional `{actorId}` selects an active staff membership; permissions and chef station assignments come from persisted membership, not request-provided roles. Reenrollment needs a fresh native epoch and a controlled handoff when the old epoch owns resources.
7. In `/admin/settings`, draft the station/table layout and optional explicitly simulated robot, preview a preset, then publish. Commands remain pending until the coordinator commits them. Catalog editing is available after stations have synced back; preparing a draft never changes applied prices.

Assign chef stations in the verified venue membership before provisioning their grants. Missing station scope denies kitchen writes. Offline expiry enters capture-only; expiry does not erase journals or transfer bill/robot ownership.

For production, provision a managed signing key, correct Auth/SMTP configuration and device restrictions through the release process. This local bootstrap is not a hosted deployment or hardware qualification.
