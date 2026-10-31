# Cloud review repairs

Scope: review findings 1, 12 and 13 on `feat/w00-w04-production-foundation`, baseline `1713276`. No trial service, hosted project, Git branch or worktree was changed.

## Finding 1: provisioning identity delegation

Root cause: selecting `actorId` loaded the selected membership's complete role permissions without checking whether the authenticated caller could delegate that identity or those permissions. A manager could select an owner and obtain a signed wildcard grant attributed to the owner.

Repair: cross-identity provisioning requires the explicit `identity.delegate` permission (or owner wildcard), uses the caller's permissions for the requested venue, and requires every delegated permission to be within that set. Selecting another owner is denied, including when the caller is an owner. Manager roles include explicit delegation for ordinary staff provisioning; self provisioning remains unchanged. Staff actor references and chef station assignments come from the selected active membership.

## Finding 12: garbage collection starvation

Root cause: successful object deletion changed `missing` back to `missing`, leaving the same oldest twenty rows eligible for every batch.

Repair: successful physical deletion transitions the locked manifest to terminal `collected`. Future GC batches exclude it; signing and finalizing the same upload ID fail with `ASSET_COLLECTED`. Failed object deletion leaves the reservation intact. The existing one-day grace after upload expiry prevents still-valid signed upload URLs from recreating a collected object.

## Finding 13: resumable upload quota

Root cause: the quota function counted only pending and ready manifests. An early finalize changed an unuploaded object to missing, releasing its reservation while its original two-hour upload URL remained valid.

Repair: every uncollected manifest remains reserved, including missing, rejected and expired uploads, until physical cleanup succeeds. Renewing an existing resumable upload preserves the reservation. Finalize cannot revive a collected row or report successful completion when its final conditional update failed. This policy conservatively charges rejected and abandoned assets until GC; a deployment already over budget blocks new reservations rather than silently discarding existing reservations.

## Verification

Actual PostgreSQL 17, local Supabase Auth and private Storage were used in project `mekoniq-w00-w04`, API 57421 / DB 57422. No SQL or Storage response mocks were used. The quota boundary uses small actual uploaded objects plus manifest-only reservations within the per-object size constraint; it does not upload a gigabyte of filler data.

RED: the six-case regression suite failed four cases and passed two before implementation: owner impersonation, absent delegation controls, repeated selection of the same twenty GC rows, and a second upload accepted after missing finalize. An initial quota fixture exceeded the per-manifest size constraint; it was corrected to multiple legal reservations before recording the quota failure.

GREEN command:

```sh
PATH=/tmp/mekoniq-node24/node_modules/node/bin:$PATH pnpm test:integration -- tests/integration/cloud-review-fixes.test.ts tests/integration/storage-free-profile.test.ts tests/integration/device-grants.test.ts
```

The six new cases also cover owner self provisioning, valid staff delegation, caller permissions from another venue, owner-to-owner impersonation denial, 21-object GC progress, collected ID rejection, original signed URL upload after missing finalize, quota preservation during retry, and expired reservation renewal. Workspace TypeScript checking and scoped ESLint passed. Final rerun counts are recorded below.

## Additive migration

New file: `supabase/migrations/20261031000100_cloud_storage_reservations.sql`. Existing deployed migrations were preserved. The new migration extends the status constraint and replaces the reservation function, retaining its restricted execution grants.

Applied locally in one transaction using the following command from `source/` (only the dedicated local project is permitted):

```sh
PATH=/tmp/mekoniq-node24/node_modules/node/bin:$PATH node --input-type=module <<'JS'
import postgres from 'postgres';
import {readFileSync} from 'node:fs';
const sql = postgres('postgresql://postgres:postgres@127.0.0.1:57422/postgres', {max: 1});
try {
  await sql.begin(tx => tx.unsafe(readFileSync('supabase/migrations/20261031000100_cloud_storage_reservations.sql', 'utf8')));
} finally {
  await sql.end();
}
JS
```

Apply once per database through the normal migration ledger; the raw command above records the dedicated local verification application. No reset was used.

Final result: **16/16 integration tests passed across three files in 9.01 seconds** (six new regressions, five existing device tests and five existing Storage tests). No Next HTTP server or browser test was started during this repair.
