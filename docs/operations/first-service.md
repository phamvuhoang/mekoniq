# First software service walkthrough

1. Start dedicated Supabase local and the explicit development fixture coordinator/tablet UI described in `../implementation/README.md`. Confirm the UI says simulation. Real service requires enrolled Android devices and qualified hardware.
2. Open POS, open table session, select cached rice/tea and place the order. Keep the basket until an accepted receipt; an unknown result is retried with its original operation ID.
3. Open KDS. Mark the correct station's quantity ready. Allocate only unallocated ready portions. Choose manual handoff or an explicitly simulated robot.
4. Confirm loading only after arrival at the load stop. Confirm the correct mission/stop/revision at handoff. Navigation acceptance alone is not arrival; physical cargo remains held through cancel/return.
5. Open a cash shift, prepare the immutable bill, record actual cash and verify change. Close only when balance is zero and no unresolved grant/payment/work remains. Customer transfer claims do not verify money.
6. Inspect local/venue/cloud ACK labels and pending outbox. Run software WAN/partition tests before trying outage behavior on enrolled tablets. A local commit does not mean the venue or cloud received it.

Do not point fixture tools at trial or live robots. Real robot commissioning and provider payment acceptance are outside W00–W04.
