# Open-RMF / MassRobotics boundary (optional)

MEKONIQ is the **sole dispatcher** of its robots. Nothing in the product requires Open-RMF or MassRobotics, and nothing here opens a second control path.

## Ownership mapping

| Concern | Owner |
|---|---|
| Who may command a robot, in what order, with which epoch | MEKONIQ (mission state machine, `controlEpoch`, the venue coordinator's journal) |
| Traffic between MEKONIQ robots in a venue | MEKONIQ (`Zone.Reserve` / fleet admission) |
| Observing pose, state, battery from outside | optional, read-only export (`integrations/robot-observation`) |
| Commanding a robot from an external fleet manager (Open-RMF) | **not supported**; needs its own approved use case, a profile, a conformance run and a decision about who is the dispatcher for that robot — never both |

## MassRobotics-style observation

`massRoboticsObservationCapabilities()` returns `commandMotion: false`. `observationFrom()` builds a neutral record from what MEKONIQ already knows; `ObservationSink.publish` is the only interface a consumer gets — nothing is received. Field names must be aligned with the exact version of the official standard before any consumer is connected; until then it is an internal export format.

## If a future use case wants RMF

1. Write the use case (which robots, which venue, who is the dispatcher).
2. Give the robot an adapter profile whose `RobotAdapter` is the *only* thing that issues motion, with RMF behind it as a client of that adapter — the adapter keeps `controlEpoch` and the journal.
3. Prove with the common conformance suite (navigation, cancel, reboot, map change, epoch) and a supervised run.
