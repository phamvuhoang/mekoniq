# V07 repair closeout — 2026-11-20

The V01–V07 software findings and their review follow-ups are fixed. Continue with [HANDOVER-v08.md](HANDOVER-v08.md). This is a software handover, with all qualification records accepted:false; human acceptance and production deployment are separate.

| Identity | Revision |
| --- | --- |
| Qualified Source runtime / Lab pin |34cf316b822da231b869ff052527630d8450c3c2 |
| Source retention scanner follow-up |3411b832caf74b1a390c9749146da2afb7c632bf (no runtime change) |
| Qualified Lab UI |6973aa21fc708dd99e04ebfd3051a7a193a90ace |
| Lab pin commit |7357cb0845b5de626018bdcabda1b529b18f2905 |

- [Resolution map](resolution-map.md) links every original finding and additional final-review finding to its repair.
- [Qualification](qualification.md) states exact checks, revisions, carried evidence and limits; [inspection](qualification-inspection.md) preserves prerequisite diagnostics and retained-corpus recovery.
- [Execution ledger](execution-ledger.md), [nine rulings](RULINGS.md), `reports/`, `reviews/`, `briefs/` preserve the task and review history. Earlier reports remain observations at their original revisions. Final receipt review supersedes pending language in earlier review rounds.
- `receipts/` holds small command/readback receipts; the draft archive `r4-v07-closeout-final-record.tar.gz` holds raw logs, browser images, exact review diffs and complete design snapshot. Final transfer/closure receipts and RESTORE.md identify archived bytes.
- `spec/` is a copy of the workspace design through this closeout. Its historical relative source/Lab links assume the original sibling-repository workspace layout. Use the canonical handover above for current checkpoints. The original review is preserved unchanged.
- `transport-observer/` records one collection's independently reviewed exact file+match hash classifications for synthetic test literals in six source diffs. It does not relax the committed scanner or classify live credentials. Unmatched bytes still use that scanner.

Source fullunit1250/1250; Lab769/769; realcookie/CSRFControl1/1; CLD01finalarm64 pass; CLD02nativeamd64 266/266; cil-v2 38/38 (producerb74755e9, correctedreaderdead/34); freshbench-v2 16/16 at34. General hosted CI remains red with49 unchanged failure entries and the broad security suite remains environment-blocked; neither is represented as a pass. CLD03 not_run/deploy_order_pending, no main push/deploy/human signature or physical calibration.

Backup replacement:102simulation signing keys were present in three newly uploaded raw CIL draft assets. Public-key-only verification copies preserve journals/signatures with before/after member maps. Four campaign archives were authenticated-downloaded/restored8794files1417514426bytes, then the three raw assets were removed and absence verified. Original local evidence is unchanged. Prior authorized draft readers could have downloaded originals; deletion cannot revoke those copies. No unauthorized access or production credential disclosure was established.

Final record archive authenticated-restored694files43,435,920bytes; see [backup receipt](receipts/final-record-backup-receipt.json), [exact-byte screening receipt](receipts/final-record-exact-transfer-scan.json) and [restore guide](RESTORE.md). Source package SHA b49b332d141a132d301e6dd9682f3d92ecc33a522b6bd4779b6439e82876497f.

Final independent review: **ready to begin V08; no open findings**. [Full scoped review and closure note](reviews/final-review-round-1.md) preserves the sequence and exact evidence examined. The final Source document push and publication of active inventory/ref metadata are recorded by the separate closure receipt to avoid embedding a commit's own hash inside itself.
