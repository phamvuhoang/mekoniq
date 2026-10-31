# Durable software and Android test lab

The Node lab runs the production module registry and command processor against separate SQLite files. SQL has WAL/FULL durability, scoped operation fingerprints, producer counters, aggregate/read-set CAS, a venue revision guard, journal/audit/outbox and receipts. PostgreSQL tests use the dedicated Supabase 17 database through `mekoniq_app`, never its bypass role for tenant assertions.

`Lab.partition()` controls the test transport and routes isolated capture into peer databases. It is software fault injection, not proof that an Android LAN works. Snapshots are cached before LAN partition; grant spending/return does not read the coordinator while isolated. Recovery verifies original source signatures and preserves raw journals. Cloud sync uses the real W02 PostgreSQL ingestion path. Independent HTTP/UI tests exercise Next.js, Auth, Storage and the browser coordinator fixture.

`kill-after-local-commit` launches a child process using the same persisted test identity and kills it with SIGKILL after COMMIT, before client ACK. Retry uses the original operation ID. `storage-failure.test.ts` uses SQLite's real page limit to produce SQLITE_FULL; signer failure is a separate rollback case. Test keys are generated in memory, never production keys.

Do not interpret fake-clock 24-hour advancement as soak evidence. Native instrumentation, paired TLS, service stop/Doze, actual storage/power loss, physical tablets and native robot goals each require their own artifact. `scripts/android-lab.mjs` fails prerequisite checks when the required enrolled test devices are absent.

Ports 1880/1884 and robot IPs are excluded. Each fixture closes only the processes/files it created. Test-only Note handler, seed methods, fixture HTTP actor headers and simulator controls are not registered in release application routes.
