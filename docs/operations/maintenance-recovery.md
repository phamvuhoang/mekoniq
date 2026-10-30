# Maintenance and historical receipt recovery

For cloud-only maintenance, keep provisioned POS/KDS/coordinator operating on LAN. Retain unacknowledged journal; do not re-enter transactions already captured by the application.

Before a full shutdown, prepare the actual enrolled-device checkpoint inventory. Drain new work, resolve cargo/grants and compare checkpoints. Missing devices or changed inventory block a clean entry. Export original signed journals and durable receipts through the encrypted archive workflow; verify a readable copy and hold its password separately.

Use pre-numbered paper receipts from `../templates/maintenance-receipts.csv` while all apps are unavailable. Record actual occurrence time/confidence, items, quantities, amounts, payment evidence, fulfillment and staff. Unknown bank confirmation remains unknown.

After restoration:

1. Validate bounded CSV/JSON rows. Review duplicate source keys, changed contents, repeated payment references and missing evidence.
2. Preview totals by currency and deferred stock exceptions. Import does not cook, move a robot, capture payment or issue an invoice.
3. An authorized manager approves the exact content hash. Apply one receipt per atomic transaction; interrupted batches retain their cursor and resume with original operation IDs.
4. Re-importing renamed/reordered files does not repeat receipts. Same source with changed amounts is a conflict. Amend applied rows with a reason instead of overwriting them.
5. Link late device sources to paper references only when their financial contents match. Preserve both original provenance records and investigate mismatches.
6. Reconcile cash, grants, pending external payments and resource ownership, then resume service. Do not declare a complete financial day while a source is missing.

The software suite is separate from physical Android shutdown/24h recovery qualification and production backup RPO/RTO testing.
