# Incident response (first hour)

1. **Stop the bleeding without losing facts.** Revoke the credential in question (membership inactive / device enrollment / channel credential `revoked` / provider key). Do *not* delete rows: journals and receipts are the evidence and the way back.
2. **Robots first.** Use the robot stop request from the web/tablet (it is a *request*, not a safety stop). Physical E-stop and the venue's manual procedure stay the safety mechanism. Do not hand a robot to a second dispatcher.
3. **Money.** Pause provider calls by disabling the profile (catalog status) or the venue's `payment.provider` feature; unknown payments/invoices are resolved by *querying* the provider, never by repeating the call (`reconcilePaymentIntents`, `reconcileInvoices`). Unapplied funds are listed at `/v1/venues/:id/payments/unapplied`.
4. **Contain a leak.** Rotate per `secrets.md`, redeploy, run `node scripts/release-security.mjs` on the new build, review `sync_inbox` rows with status `quarantined` and the audit trail for the affected tenant.
5. **Tell people.** The venue owner immediately; affected customers and the authorities as the venue's legal duties require (this repository does not decide that).
6. **Record.** Timeline, who did what, evidence links, follow-up tasks; add a regression test in `tests/security/` for the cause.

Known gaps: no automated alert routing is configured (see W11-T02 dashboards); incident contacts and the on-call owner are a deployment decision.
