# MEKONIQ developer guide (automation and channels)

Audience: people wiring Node-RED, scripts or a partner system to a MEKONIQ venue. Everything here is the cloud API; there is nothing to install at the restaurant. **Try everything on a sandbox venue first.**

## 1. What an integration is allowed to do

An integration is a normal Supabase user whose `venue_membership` has role `integration` for exactly the venues it serves. Its rights are `relay.write`, `mission.write`, `order.read` — no payments, refunds, configuration, stations or robot transport. The cloud checks them, and the venue's coordinator checks them again before it acts. There is no endpoint that reaches a robot, an MQTT topic or the database; a command can only be a *request* that the venue accepts or rejects (including `FEATURE_DISABLED` when the venue has switched the feature off).

Revoking access: set the membership inactive. The next request is `401`.

## 2. Endpoints (all under `/v1/automation/venues/:venueId`, `Authorization: Bearer <token>`)

| Method | Path | Purpose |
|---|---|---|
| POST | `/commands` | `{type, operationId, payload}` — `type` is one of `Mission.Create`, `Mission.Cancel`. Returns `202 pending` until the venue answers. |
| GET | `/commands/:operationId` | Result of a command **you** sent: `pending`, `unknown`, `accepted` or `rejected` (+ `code`). |
| GET | `/events?kind=&after=` | What the venue has applied for `allocation`, `fulfillment`, `mission` or `robot`, 100 per page (`next` is the cursor), with `appliedAt` = age of the data. |

`operationId` (1–128 chars of `A-Z a-z 0-9 _ -`) is **required and chosen by you**, from the thing that triggered you (`delivery-<session>`). The same id is the same command: a replay returns the stored command and never creates a second mission. `pending` and `unknown` mean "ask again with the same id" (`GET /commands/:operationId`), never "send a new one".

Errors: `403 PERMISSION_DENIED | SCOPE_DENIED` (role or venue), `409 FEATURE_DISABLED | FEATURE_DRAINING` (venue policy), `400 COMMAND_NOT_RELAYABLE | INVALID_OPERATION_ID`, `429 RATE_LIMITED`, `401` (bad or revoked token).

## 3. Limits and compatibility

- **Rate limit:** at most 50 unanswered commands per integration per venue (`RATE_LIMITED` beyond that; a re-send of an existing `operationId` is not counted). Poll `/events` no faster than every 5 seconds.
- **Evolution:** within `/v1`, fields and error codes may be *added*; none is removed or changes meaning. Treat unknown fields as ignorable and unknown `status` strings as "not final". A breaking change ships as `/v2` with `/v1` kept for at least one release. Command payloads follow the domain schema of the venue's release; an unsupported payload comes back as `rejected` with a code, it is not dropped.
- The SDK (`integrations/sdk`) mirrors these endpoints; `tests/contract/automation-scopes.test.ts` fails if a route or the client drifts.

## 4. SDK

```ts
import {createClient, submitAndResolve, readyDeliveries, deliveryCommand} from './integrations/sdk/src/client';
const client = createClient({baseUrl: process.env.MEKONIQ_BASE_URL!, token: process.env.MEKONIQ_TOKEN!});
const allocations = await client.listEvents(venueId, 'allocation');
for (const group of readyDeliveries(allocations.records)) {
  const result = await submitAndResolve(client, deliveryCommand(venueId, group)); // pending/unknown are followed with the same operationId
}
```

`deliveryCapableRobots(robots, mapRevision)` is the capability check the example flow uses: no robot with trays on the venue's current map means "leave it to staff".

## 5. Receiving and sending signed webhooks (channels)

Partners post orders to `/v1/channels/:provider/webhooks` with headers `x-mekoniq-key-id`, `x-mekoniq-timestamp` (ms), `x-mekoniq-signature = v1=HMAC-SHA256(secret, "<timestamp>.<raw body>")`. Sign the exact bytes you send; the timestamp must be within 5 minutes. `integrations/sdk/src/webhook-verifier.ts` has `signRequest` and `verifyRequest`. `202 received` means stored, **not** accepted by the restaurant — poll `GET /v1/channels/:provider/merchants/:merchantId/orders/:externalId` (signed the same way over an empty body) for `accepted | rejected | expired`. Real channels stay disabled until their W10 certification; only `sandbox-channel` is available.

## 6. Node-RED

See `integrations/node-red/README.md`. The example flow polls allocations, checks robot capability, and asks for one delivery per session. Credentials come from the Node-RED environment; nothing secret is in `flows.json`.
