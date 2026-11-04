# First shift checklist

Run with a person who owns the venue and a named support contact. Nothing on this page has been performed on a real venue; the software journey that mirrors it is `tests/acceptance/first-shift.test.ts`.

**Open.** Devices paired, the coordinator tablet in kiosk/foreground, connection banner green on every tablet; cashier opens a shift with the real float; kitchen/bar screens show their stations; robots at parking, safety stop within reach.

**During.** Sell through every channel you enabled (POS, QR, kiosk); watch KDS tickets; send one supervised robot delivery per robot; take cash, a card terminal payment and (if enabled) a verified transfer; do one split bill and one refund with a manager. Pull the router's WAN cable for five minutes: selling continues, the banner says offline, the outbox grows and drains on reconnect. Pull the LAN uplink of one tablet: it keeps its own work and shows the isolated mode.

**Close.** Count cash; close the shift; the shift report must equal the ledger by method; the day's sales report equals the sum of closed bills; cloud report (after sync) equals the tablet report; nothing in `unapplied funds`, no `unknown` payment/invoice/job, no robot with a load.

**Record.** Totals, discrepancies, tickets raised, who accepted the day. A discrepancy is a finding, not a note.

**Post-shift.** Backup taken and verified; alerts reviewed (`deploy/observability`); the support owner and escalation contacts written in `post-release.md`.
