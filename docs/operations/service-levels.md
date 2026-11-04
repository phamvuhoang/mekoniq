# Service levels and how they are measured

**Nothing here is promised until a measured artifact says so.** Targets come from the approved design; results come from `pnpm test:load` / `pnpm test:load:free` artifacts under `.lab/load/` (git-ignored, one per commit) and are read by `tests/support/load-report.ts`, which refuses a missing, stale (> 6 h) or wrong-commit report.

| Target | Value | Measured by | Current honest state |
|---|---|---|---|
| Local ACK (coordinator commit) p95 | ≤ 500 ms | `pnpm test:load` (20 logical tablets, 100 tables, 10 seeded robots, 10 commands/s, deterministic seed) | measured in-process only — no tablet, radio or WebSocket |
| Order → kitchen visible p95 | ≤ 1 000 ms | same run (commit + kitchen read, in process) | in-process only; LAN transport not included |
| Duplicate financial effects | 0 | same run (a retried cash payment after a lost ACK) | measured |
| Free-profile capacity | projected 30-day DB / egress / Realtime below the 85 % critical ratio | `pnpm test:load:free` (1 venue, 3 tablets, 20 tables, 100 orders/day, 7 simulated days) | local projection from measured bytes per order; hosted numbers unmeasured |
| Production recovery | RPO ≤ 5 min, RTO ≤ 30 min | a real restore drill (W11-T03) | not measured; a Free project has no PITR |
| 24 h soak, spike, battery/temperature, real Wi-Fi | — | physical tablets (Gate A) | not done |

Alerts and dashboards: `deploy/observability/` (SQL-based, no paid log drain). Cloud pause or quota errors are treated as "cloud unavailable": journals are kept and eligible LAN work continues; no keep-alive pings are used to dodge a pause.

Rejected requests are never counted as successful latency. A compressed clock is not a soak. The report states what was and was not measured (`unmeasured`, `claim`).
