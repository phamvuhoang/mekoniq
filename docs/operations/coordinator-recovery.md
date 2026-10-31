# Controlled coordinator recovery

A timeout never creates a new owner. Keep disconnected peers in capture mode. Do not clear idempotency receipts, producer counters, grants or robot occupancy to make recovery appear clean.

1. Inventory all enrolled devices, their received/applied cursors, original signed journal exports, open bills, collection grants, loaded trays, robot goals and reservations. Identify missing sources explicitly.
2. Restore into inactive/empty storage using the runtime's authenticated encrypted archive workflow. Keep the passphrase separate from the archive. Verify manifest/signature/hash before writes. Restore does not restore an absent private key or enroll a replacement device automatically.
3. Pull the original-ID journal tail from surviving sources. Pending external effects from a restored backup are unknown; query the executor/provider before any resend. Grants restored without a complete receipt inventory remain locked.
4. Reconcile robot state using a fresh challenge and signed executor query proof bound to scope, command, map and control epoch. A manager note or a completed goal does not prove cargo was unloaded.
5. Request handoff only to an enrolled replacement. Complete device checkpoints, then collect signed fencing proofs from the old coordinator and every executor, bound to the handoff nonce/checkpoint and increasing epochs.
6. Activate only after durable fencing/epoch ACK and no unknown resources. After the old owner uploads its final activation, refresh the replacement’s signed provisioning grant. The grant installs active ownership, finalized resource snapshots and original journal receipts atomically; it never replays commands or external effects. Keep the replacement inactive until that installation succeeds. Missing old owner without verifiable fencing remains isolated/manual; this release does not implement timeout election.

Grant expiry does not return collection rights. The recipient must durably return the grant with signed exhaustive receipt inventory; verify original observations and reconcile before assigning another collector. Lost devices require an explicit verified recovery workflow, not a checkbox.

The local release supports a bounded complete handoff package: at most 1,000 original applied journal entries, 10,000 snapshots and 4 MiB. A pending journal, missing receipt metadata, unavailable historical producer key or an oversized checkpoint blocks handoff provisioning explicitly. Do not truncate history or clear receipts to bypass this limit. Larger histories require a separately qualified paginated checkpoint transfer before use; this release fails closed.
