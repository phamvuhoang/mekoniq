# Rolling upgrade with old tablets offline

Tablets can be offline for hours or days and then push journals written under the *old* schema. The cloud therefore upgrades by **expand → migrate clients → contract**, never in one step.

1. **Expand** (`supabase/migrations`): add tables/columns/indexes/relaxed constraints; nothing old clients read or write is removed or retyped. `node scripts/migrate-release.mjs --plan` classifies each migration; the shipped set is expand-only (a test asserts it).
2. **Deploy** the new cloud build; old and new clients sync side by side. Unknown schema versions are kept raw in quarantine (never dropped) and applied when the upcaster exists.
3. **Contract** (drop/rename/retype/NOT NULL) only when `migrationAllowed` is true: every enrolled client is known and none has an unsynced journal (`unknownClients = 0 && pendingJournals = 0`). `--clearance` is the explicit, recorded override for a destructive plan.
4. **Rollback** is roll-forward: a bad migration stops the release before contract; the app can go back one build because the schema stayed backward compatible, and facts written meanwhile (bills, payments) stay.
5. **Restored cloud + old client**: after a restore to a checkpoint, an old tablet that sold offline since then pushes its journal again; entries already present are no-ops, missing ones apply once (`upgrade-recovery.test.ts`).
