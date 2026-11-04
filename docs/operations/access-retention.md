# Access and retention

**Access.** Staff reach tenant data only through `venue_membership` (role per venue, `chain.*` and payment/invoice operator rights are owner/manager-level and checked per venue). Integrations use the `integration` role with three rights. Devices use signed grants bound to tenant, venue, epoch and permissions. A branch manager never gains another branch through a chain report or rollout call. Revoking = deactivating the membership (next request `401`) or the device enrollment (epoch bump).

**What is personal data.** Customer profiles, consents and loyalty accounts (`customer.read` only), invoice buyer data (name, tax code, email, address), channel order contents, guest table sessions. Customer erasure keeps the financial references that must remain (bill totals, payment ids) and drops the personal fields.

**Retention (defaults, configurable per deployment).**

| Data | Keep | Then |
|---|---|---|
| Bills, payments, refunds, cash movements, shift ledgers, invoice records | as long as the venue's accounting rules require (set by the venue's accountant; not decided here) | export, then archive |
| Journal / audit entries | with the financial data they explain | archive with it |
| Relay commands, job rows, provider events, webhook dedupe | 90 days after final status | purge (jobs/relay carry no personal data beyond what the venue already holds) |
| Quarantined channel payloads (`external_order_conflict`) | 30 days | purge |
| Guest sessions and tokens | session lifetime (the revision bump kills them) | purge |
| Storage objects (menu images, attachments) | while referenced; orphans are collected by the `storage.gc` job | delete |

These are defaults to be confirmed with the operator; nothing here is legal advice and no purge job beyond `storage.gc` exists yet.
