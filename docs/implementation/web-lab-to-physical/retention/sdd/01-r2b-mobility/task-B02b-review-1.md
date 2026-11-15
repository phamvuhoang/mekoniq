# B02b review 1

Reviewer /root/review_b02b; BASE eef984e, HEAD3e0c60e. Spec issues found; quality Needs fixes. No Critical. Two Important and one Minor.

1. **Validate mobile observations before publishing source events.** runner.ts427 observes/drains before mobile stop monitor432. A cancelling goal with stopped but missing physics emits cancelled; adapter.ts58-62 lost() cannot convert terminal cancelled to unknown. Focused reviewer experiment: fault PHYSICS_OBSERVATION_INVALID, events=[cancelled], goalState=cancelled, plantLost=true. Move validation before adapter observation/journal draining/valid telemetry and add pending-cancel runner regression. Preserve actual fault tick evidence without claiming observed cancellation.
2. **Startup ACK loss is not terminal.** runner.ts268 startPlant catch closes/releases/throws; started set only after success503; action catch538 records attention but no terminal startup marker. A fresh start can respawn same-run worker after create/start lost ACK. Persist uncertain startup loss and reject later start, including reopen; prove no second spawn.

Minor deferred: robotics/simulation-mujoco/README.md52 still says readiness/provider subsequent work and no mobile backend advertised, contradicting new source-provider section. B00R refresh owns documentation correction.

Strengths: explicit one-AMR/registered mechanical and hashed closure admission; shared slot and exclusive readiness gate; explicit controller ramp retains actual velocity checks; correct mobile provenance/identity and legacy defaults.

Cannot verify: controller-owned clean export/Lab pin/newer frozen upstream integration; B03 recorder and B04 UI separate tasks. Controller resolves export/pin after gate; B00R is scheduled.

Checks: supplied diff/report/log review; named outside-diff shared slot/readiness, worker close/ACK, controller cancellation/observations, support-frame production, scene limitations; recovered truncated CLI/runner context; only focused cancellation-invalid-physics experiment executed. No suites rerun, no checkout changes.

Controller independently checked startPlant/execute catch and adapter.observe/lost paths; findings apply to new provider despite existing shared runner implementation. Fix round1 dispatched to original b02b_mobile_provider; no fix by controller.
