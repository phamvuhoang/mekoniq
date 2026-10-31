# W00–W04 execution ledger

Plan: docs/superpowers/plans/2026-10-30-production-implementation-plan.md
Branch: feat/w00-w04-production-foundation (base 62a98bd); no worktree.

- User authorized W00–W04 against existing approved architecture. No redesign gate.
- W00-T01 health RED: outage incorrectly returned 200. GREEN: actual Next.js returns live 200/ready503.
- W00-T02/T03: schema generation, canonical signing bytes TS/Python and exact-money tests passed (agent evidence).
- W00-T04: file SQLite/PostgreSQL17 tests: reopen/dedup, 20 concurrent retries, payload conflict, authority/scope rollback passed.
- W00-T05: real child SIGKILL after SQLite commit returns unknown; restart/retry preserves one event. Before-commit exception rolls back.
- Environment: Node24.22.2 locally under /tmp, pnpm10.32.1, PostgreSQL17.6, Supabase CLI2.118.0. Local project mekoniq-w00-w04 uses 57421/57422/57424; no trial ports touched.
- Android SDK/JDK21: two dedicated API33 emulators exercised signed pinned TLS, real APK commands, restart/dedup and explicit transport partition. Physical tablet/AP and 24-hour qualification remain outstanding.
- Ruling: optional CommitBatch.expectedReads validates read dependencies at commit without incrementing unrelated aggregate versions. Reason: catalog publish/read race. Cost if wrong: wire/native compatibility adjustment; old batches remain compatible, new schema and native validator updated together.
- Ruling: journal producer is store/coordinator identity rather than requesting peer; original actor and operation remain provenance. Reason: signature must verify against producer's key. Cost if wrong: fixture/device enrollment adjustment; no existing production data in source.

## Final implementation rulings

- Snapshot scope revision joins aggregate read-set CAS to reject phantom allocation/catalog changes. Repeated operations retain their original receipt and command fingerprint.
- Persisted owner identity/epoch guards shared writes; only allowlisted recipient observations may commit away from the owner. Enrollment cannot reset authority on restart.
- Configuration ACK follows a verified uploaded ConfigurationApplied fact. Cloud ownership/policy and original intent cursors advance transactionally from signed accepted facts, never from an unverified peer request.
- Settlement grant Return proves the complete signed receipt set before reconciliation can release the reserved right. Restored grants/effects remain unknown until controlled recovery.
- Native checkpoints have signed cursors and short expiry; restore stages an inactive database and requires recovery before shared operations. Mission queues are FIFO and canceling a queued mission preserves the active trip.
- Test-only managed-device receivers, fixture actors and HTTP coordinator stay outside release. Keystore permits prehashed TLS signing (DIGEST_NONE); domain signatures still use SHA-256 and private keys remain nonexportable.

All 28 task evidence files point to the final verification record. 26 tasks have local verification; W01-T05 and W04-T06 retain mandatory external qualification. No later wave, physical robot commissioning, hosted deployment, merge or push is included.

Final implementation revision: `b04440ea7e7206c24a08fb317668f9cd925ab019`. Final combined verification: 14 unit, 7 TypeScript contract, 115 integration, 14 Python contract, 6 browser, 23 continuity software, 17 native JVM and 6 Android instrumentation checks passed. Full Gate A intentionally remains unaccepted.
