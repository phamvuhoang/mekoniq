# Gate A — continuity qualification

Gate status: **not accepted**. Software-only run: **22/22 behavioral scenarios passed**, plus the registration check (23/23 total). Software checks and actual Android/device qualification are reported separately. An injected clock and a Node simulator do not establish physical tablet, Wi-Fi, robot or 24-hour soak behavior.

## Run and inspect

```sh
pnpm test:acceptance -- continuity --software-only
pnpm test:acceptance -- continuity
```

The first command runs developer software coverage. The second also requires mandatory Android evidence and fails while that evidence is `not_run`. Reports are written under `.lab/continuity/software-report.json` or `gate-report.json`; subprocess JSON reports identify the exact behavior test and number of executed assertions. The registry rejects missing scenario IDs and a named test filter that executes no tests.

## Software scenario mapping

| Cases | Behavior exercised |
| --- | --- |
| O01–O03 | Real SQLite restaurant journey during WAN outage, dropped local ACK, actual PostgreSQL commit with lost cloud receipt and durable retry |
| O04–O05 | Separate device SQLite files during LAN partition, blocked shared commands, original signed captures and explicit same-table conflict after recovery |
| O06 | Recipient-local settlement, lost/duplicate submission, expiry, signed durable closure, original source-journal merge and manager reconciliation |
| O07–O08 | Actual child-process SIGKILL after SQLite COMMIT and real SQLite page-limit storage failure |
| O09/O19 | Signed PostgreSQL ingest, sequence gaps, continuous receipts and raw unsupported-schema quarantine |
| O10–O11 | Explicitly simulated executor reboot/unknown result and expired-command rejection before any adapter attempt |
| O12–O13 | Cached applied revision, feature drain rules, offline privilege expiry/capture-only behavior using an injected clock |
| O14–O18 | Stable source-key import, changed receipt conflict, late-device source linking, no live effects and actual SIGKILL/resume between receipt transactions |
| O20–O21 | Unknown robot blocking handoff; software runtime-health timeout and unavailable-owner ACK denial |
| O22 | AES-GCM encrypted SQLite archive, original signed IDs/receipts/counter restoration and pending robot effects restored as unknown without resend |

## Required external qualification

Mandatory Android scenarios are O01, O02, O04, O06, O07, O08, O13, O21 and O22. They require the supported APK and enrolled device pair, including real suspend/stop/storage behavior. O13 additionally requires a 24-hour wall-clock soak. Hardware robot validation remains a separate later gate; software reports label robot execution `simulated` and hardware `not_run`.

Latest integration evidence must be read from the report generated against the current branch. Do not convert `not_run` to `passed`, reuse earlier trial results as platform acceptance, or mark Gate A complete from software-only output.
