# Restore the unpublished V07 closeout backup

Draft release ID452762939; tag `r4-v07-evidence-backup-20261120`, repository `phamvuhoang/mekoniq`. Keep the draft unpublished. This backup is not human acceptance or production deployment. All qualification records remain `accepted:false`.

## Current inventory

Download to a new directory using an authenticated GitHub account that can read the draft:

```sh
mkdir /tmp/NEW-r4-v07-download
gh release download r4-v07-evidence-backup-20261120 --repo phamvuhoang/mekoniq --dir /tmp/NEW-r4-v07-download
cd /tmp/NEW-r4-v07-download
shasum -a 256 -c ACTIVE-SHA256SUMS
```

`ACTIVE-SHA256SUMS` names the current downloadable artifacts and closure metadata. Old `HISTORICAL-SHA256SUMS`, `CAMPAIGNS-B74755E9-SHA256SUMS` and raw CIL `.members.json` files are historical observations; their raw CIL archive names are intentionally no longer downloadable. Do not use those old inventories as the current restore plan. `SUPERSEDED-RAW-ASSETS.json` records the removed asset IDs/hashes. The safe campaign, native and final-record receipts record actual authenticated download checks, beyond this recovery recipe.

| Scope | Use |
| --- | --- |
| Current CIL actual producerb74755e9 / corrected readerdead3cc3 or34cf316b | `r4-cil-v2-b74755e9-verification.tar.gz` and matching `.members.json` |
| Current bench producer34cf316b | `r4-bench-v2-34cf316b.tar.gz` and matching index |
| Historical CIL | `r4-cil-v1-4b36956-verification` / `r4-cil-v1-5e93570-verification` archive/index pairs |
| Final logs, screenshots, design, ledger, review diffs | `r4-v07-closeout-final-record.tar.gz` and matching index |
| Final native CLD02 | `r4-cld02-34cf316b.zip`, its readback receipt; workflow44774073866 |
| Earlier baseline/bench/container and V01–V07 ledgers | Other retained archive/index pairs, preserving their original identities |

Four current/safe campaign archives restored8,794files1,417,514,426bytes. Final record restores694files43,435,920bytes; its archive SHA-256 is `b49b332d141a132d301e6dd9682f3d92ecc33a522b6bd4779b6439e82876497f`. Native ZIP SHA-256 is `063a3b4df7ab9ea3822505280b24f946a8b606bc0b5a9e687601e7a04ec798c9`, with30inner checksums.

## Extract and verify

From a workspace containing the backed-up Source checkout, use a new destination and receipt for each archive. Unset PYTHONOPTIMIZE because the bounded extractor uses assertions. Do not write into an original evidence directory.

```sh
env -u PYTHONOPTIMIZE PYTHONDONTWRITEBYTECODE=1 python3 -B source/docs/implementation/web-lab-to-physical/retention/tools/record-archive.py extract /tmp/NEW-r4-v07-download/r4-cil-v2-b74755e9-verification.tar.gz /tmp/NEW-r4-v07-download/r4-cil-v2-b74755e9-verification.members.json /tmp/NEW-r4-cil-v2-verification /tmp/NEW-r4-cil-v2-restore-receipt.json
```

The extractor checks archive digest, safe paths/member types, every file size/hash/mode and total membership. Dependency symlinks are descriptors only; they are never followed or materialized. Absolute provenance paths in the index do not select extraction destinations. Its checked-in SHA-256 is `aa306d43017a023e40d296b4b7bf73ee5600b663f42ec058f21f0744c5c37c43`.

Then use Node24.22.2/pnpm10.32.1 with the committed portable tool prerequisites. From Source34cf316b or a later docs/retention-only descendant:

```sh
node scripts/lab-mujoco.mjs verify --input /tmp/NEW-r4-cil-v2-verification
```

The current CIL record must verify38/38; the final bench must verify16/16. Historical5e93570 verifies26/26 with that checker. Historical4b36956 has an older registry lacking the current hostArch/oracle identity and is correctly rejected by the current checker in both original and projected form. Use its producer checkout `4b36956190caaaedadf1651714cf775a54154e54` with its prerequisites for26/26. Independent public-key verification also checked1,429journal signatures across29runIDs. Neither copying nor compressing turns historical records into new coverage.

## Signing-key representation and access

Three raw CIL draft assets contained102run-local EC signing keys. They were replaced with the separately named `-verification` copies after independently checking public keypairs, unchanged original local members, ordinary semantic readers, inventories and exact transport bytes. Authenticated replacement downloads and restores completed before the three raw assets were removed; their absence was verified afterward.

Each verification copy keeps only public `kty/crv/x/y`, preserves journal/signature bytes, reseals dependent inventories, and includes `verification-copy.json` mapping every original member to the projected bytes. It supports offline verification; it cannot resume or sign runs and is not byte-identical to the original. Original local records were not changed. No unauthorized access or production credential disclosure was established. Authorized draft readers could have downloaded originals while available, and deleting remote assets cannot revoke those copies.

The final log archive contains six reviewed source diffs with synthetic test strings. `reviewed-record-scan.py` and `final-record-reviewed-source-matches.json` classify only exact file hashes and exact detector-match hashes; all remaining bytes use scanner3411b832. Twenty-one negative/positive checks and an independent pre-transfer hash review are retained. This transport classification does not alter the committed scanner or runtime.

## Code and readiness

Both code repositories are backed up on `r4/virtual-commissioning`. Qualified runtime/pin34cf316b, Source retention-tool3411b832, LabUI6973aa21. Later Source closeout commits contain documents/transport-observer records only. Read the tracked handover at `source/docs/implementation/evidence/virtual-commissioning/v07-closeout-2026-11-20/HANDOVER-v08.md`, then the V08 task in its spec snapshot. Final closure metadata records the branch refs actually pushed.

General platform CI remains red with49unchangedfailureentries; broad security has explicit prerequisite failures. Local Source1250/1250, Lab769/769, native266/266, CLD01 and realcookieControl passed in their stated scopes. CLD03 is not_run/deploy_order_pending; no main deployment or human acceptance occurred. Existing launchers and Supabase were preserved.
