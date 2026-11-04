# Node-RED bridge (optional, cloud-side or developer machine)

An example flow that watches the venue's **allocations** (kitchen output ready for a table) and asks for **one delivery mission per session** through the MEKONIQ automation API.
Node-RED is **not** part of the restaurant: it needs no server there, and it is not required for any feature. Run it on a developer machine or in your own cloud, against the sandbox venue first.

What the flow can and cannot do:

- It talks only HTTPS to `/v1/automation/venues/:venueId/…` with a **service-account token** (role `integration`: `relay.write`, `mission.write`, `order.read`). It has no database, MQTT, robot IP, payment or refund access, and the API has no endpoint for them.
- The venue decides. If `robot.delivery` is off for the venue the answer is `FEATURE_DISABLED`; if no capable robot (trays + the venue's current map) is reported, the flow does nothing and the delivery stays with staff.
- The command id is `delivery-<session>`. A restarted flow or a replayed poll asks for the same mission, once. `pending` / `unknown` are followed with the **same** id (`GET …/commands/:operationId`), never a new one.

## Run it (sandbox venue only)

```sh
export MEKONIQ_BASE_URL=https://<your-sandbox-deployment>
export MEKONIQ_VENUE_ID=<sandbox venue id>
export MEKONIQ_MAP_REVISION=<the venue's current map revision>
export MEKONIQ_TOKEN=<access token of a service account with role integration>   # never put it in flows.json
npx node-red --userDir ./nodered-sandbox   # then import integrations/node-red/flows.json
```

Create the service account as a normal Supabase user with a `venue_membership` of role `integration` for that one venue. Revoke it by deactivating the membership: the next request is `401`.
