# External channel acceptance (Zalo, marketplaces, external POS)

## Implemented and verified locally (sandbox channel emulator only)

- **Received is not accepted.** `202 received` = stored and handed to the venue. The channel-facing status is `awaiting_restaurant` until the **venue itself** accepts (`channelStatus`); `accepted` only from the venue's own decision. The outbound "restaurant accepted" call is refused (`NO_VENUE_ACK`) whatever queued it unless the cloud record was moved by the venue; the channel's idempotency key belongs to (order, kind), so two jobs cannot act twice.
- Partner replay → stored answer; signed-but-different replay → quarantined (`409`); forged / tampered / expired-timestamp / wrong-merchant → refused before the database.
- Venue silent: hold (re-relay until the order's own deadline) or reject (`VENUE_UNAVAILABLE`); at the deadline the channel is told expired, and a late venue acceptance is flagged `attention`, not hidden.
- **Cancellation by the channel** (`POST /v1/channels/:provider/cancellations`, signed): relayed once as `ExternalOrder.Cancel`; the venue cancels a received order, or an accepted one under the normal order-cancel rules — food already made or allocated is **refused** (`REQUIRES_DISPOSITION` / `FULFILLMENT_ACTIVE`), reported as `cancelStatus: refused` with the code.
- Separate states for external cancellation, restaurant rejection and expiry; connector registry: an unregistered or non-emulator channel is `PROVIDER_NOT_ENABLED`; a release runtime runs none of the emulators.

## Not done — needs a chosen channel (profiles `zalo-mini-app`, `delivery-marketplace`: draft)

1. App registration / partner agreement, official API + version, webhook signature scheme, permission scopes, approval flow, status transitions, retry rules, sandbox account (see `profile-onboarding.md`).
2. The concrete connector, registered in `integrations/channels/src/registry.ts` with its profile — written from that documentation (modifiers/notes mapping, source totals kept for comparison only, never overwriting our own price).
3. A recorded sandbox callback trace, the acceptance report, then `production_approved`. The Mini App bundle/SDK build is only started once a real registration exists (`MiniAppBridge` is inert until then).
4. **External POS-only venues** (the "robot with an existing POS" preset): routing a "ready" signal from an external POS into fulfilment/delivery without internal billing is **not implemented**; it needs the chosen POS's integration contract.
5. Partial fulfilment mapping (an unavailable line) is not supported: orders are accepted or rejected whole.
