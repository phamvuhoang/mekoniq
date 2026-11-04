# E-invoice and accounting export acceptance

Implemented and verified locally against an emulator; **no e-invoice provider is selected**, so nothing here has been issued to a real provider or checked against tax-authority rules. This system is not a general ledger and has no payroll.

## Flow

1. A cashier/manager taps **Request e-invoice** on the tablet (`Invoice.Request`): needs the `einvoice` module switched on and a **closed** bill; the buyer (name, optional 10/13-digit tax code, email, address) is validated; the bill's money and tax lines are frozen into the request. One request per bill. It works offline and simply waits as "requested — not issued yet".
2. The cloud collects requests the venue synced (`collectInvoiceRequests`) and issues them (`issueInvoice`) only through an **enabled** profile. The row is claimed as `unknown` **before** the call. A lost answer is therefore followed only by `query` with the same `requestKey`; a second `issue` happens only after the provider says it never saw the request (`not_found` → `draft`). A 429 proves nothing happened (back to `draft`).
3. `issued` exists only with the provider's invoice id **and** code. The answer goes to the venue as `Invoice.Record` (idempotent; resent when the relay lapses); the tablet then shows the lookup code. A rejection carries the provider's reason. A total the lines cannot add up to (tax above the total) is rejected locally and never sent.
4. Adjust / cancel (`invoice.operate`): only for an issued invoice, idempotent by key, through the provider's own operations (a provider without them → `UNSUPPORTED_BY_PROVIDER`); a cancelled invoice is final; nothing is deleted. A refund of an issued invoice requires a matching adjustment (`refundNeedsAmendment`).
5. A historical bill invoiced outside this system is linked with `Invoice.LinkExternal` — status `external`, never `issued`.
6. `GET /v1/venues/:venueId/accounting/export?businessDate=…&format=csv`: one line per closed bill of the venue's local business date (schema `mekoniq-accounting-1`: subtotal, discount, service, tax, total, paid, refunded, invoice status/code), cells escaped against formula injection, header with the freshness verdict (`complete=false` when the venue's sync is behind).

## Not done — needs a chosen provider (profile `einvoice-provider`, draft)

- Provider, sandbox, certificate/secret handling (managed store; nothing is stored in this repository), official issue/query/adjust/cancel schemas and version, the provider's uniqueness/reference semantics, buyer-data rules (e.g. tax code ↔ registered name), tax-authority/legal rules confirmed by the venue's accountant.
- Line-level invoice content: the current invoice carries one net-of-tax summary line plus the tax amount; per-item lines and per-line tax rates depend on the provider's schema.
- Recorded sandbox vectors and the provider/legal acceptance report (`docs/implementation/evidence/`), then `production_approved`.
- Real e-invoice export formats for a specific accounting package; the export here is a neutral CSV.
