# Payment provider acceptance

What is implemented and verified locally, and what a real provider still has to prove.

## Implemented (provider-agnostic, exercised against an emulator)

- **Intent first, provider second.** `createPaymentIntent` stores the intent (our UUID is the reference the provider echoes), then calls the provider. A webhook that beats our own response still finds the intent; a provider failure leaves it `created` and reconciliation asks by the same id — a second payment is never created.
- **Webhook = hint, query = truth.** Signature on the raw bytes + timestamp window → de-duplicate by event id → tenant from our reference → **query the provider** → bind merchant, currency and exact amount (and payee when known).
  - exact → `captured`, forwarded to the venue as `Payment.RecordProvider` (idempotent by payment reference);
  - same merchant, other amount/currency → `unapplied` (money kept and listed at `GET …/payments/unapplied`; never applied to the bill, never deleted);
  - another merchant → ignored as not ours (`FOREIGN_MERCHANT_EVENT`);
  - failed/expired → closed; pending/not found → wait. A throwing query is `503` so the provider retries; the event is processed once.
- **The venue has the last word.** If the bill cannot take the capture (closed, voided) the relay receipt is `rejected` and the intent becomes `unapplied` with `VENUE_REJECTED:<code>`; a lapsed relay (venue offline) is resent. A bill already fully paid records the extra as the bill's unapplied amount.
- **Refunds** go through the provider: ≤ captured − refunded, one in flight, a lost answer is `unknown` and **queried by the same refund id**, a 429 retries the same id.
- **VietQR**: `vietQrPayload` / `parseVietQr` (EMVCo/NAPAS structure, CRC-16/CCITT-FALSE). A QR on screen asks for payment; it is never a payment. Without a verified provider fact the customer's "I paid" stays a claim for a manager to verify (`Payment.Claim` / `Payment.VerifyManual`).
- Money in a sandbox/simulation profile cannot be marked real: profiles other than `production_approved` do not run in a `release` runtime (`INTEGRATION_RUNTIME`), and the emulator is never evidence.

## Not done — needs a chosen provider (profile `payment-provider`, draft)

1. Provider, merchant sandbox, official create/query/refund API and version, webhook signature/timestamp/event-id rules, bank/payee binding rules (see `profile-onboarding.md`).
2. An adapter implementing `PaymentProvider` and, if its scheme is not `mekoniq-hmac-sha256-v1`, the verification scheme **from that provider's documentation** (until then its webhooks are refused with `SIGNATURE_SCHEME_UNSUPPORTED`).
3. Recorded sandbox vectors (provenance `recorded`, redacted, hashed), a run against the provider's sandbox with the report in `docs/implementation/evidence/`, then merchant acceptance for `production_approved`.
4. VietQR: acceptance of the generated codes by real bank apps (the layout follows the public structure; no bank app has scanned it here) and the bank/BIN binding of the venue's account.
5. Venue-side recording of a provider refund in the bill ledger is still the staff's `Refund.Record`; the cloud keeps its own refund ledger per intent.
