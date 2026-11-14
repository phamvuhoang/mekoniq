# Physics evidence v1: B03 recording and metric convention

The optional `RunReport.physicsEvidence` block carries the v1 manifest, SHA-256 of
its serialized inline manifest, independently verified completeness/issues, and
metrics recomputed from the published chunks. Chunk paths are relative to the
run's `physics/` directory. It is outside `canonicalOutcome`; old reports have no
new default metrics. Lab admits the optional shape; mobile UI/archive activation
remains B04.

`identity.loadProfileDigest` and `identity.physicsProfileDigest` are the exact
file-byte SHA-256 values in the admitted scene engine profile refs. The canonical
profile document digest and numericalInputsDigest remain separate validations.
`metricsPolicyDigest` is the byte SHA-256 of the separately admitted mobile
observation/stop policy. The scene digest additionally binds the navigation stop
velocity thresholds/hold count and the actual model drive-frame transform.

Each acknowledged mobile observation is structurally checked against admitted
robot, prop, support and geometry IDs, 20 ms clock / ten 2 ms substeps, unit
quaternions and consistent orientation fields. It is appended to a fsynced WAL
before the logical tick commits. Immutable gzip chunks are sealed at bounded
intervals, then the manifest is atomically published. A WAL tail/write intent is
not published evidence. An unacknowledged, malformed or unpersistable advanced
tick is an explicit gap and terminal unknown, never retried or respawned. The
stateful experimental stop monitor runs once after validation and durable append,
before source outcome observations. Startup uncertainty remains latched.

The physics and navigation quotas are each at most 100 MiB, including writer
metadata and orphan accounting, so configuring either above its cap is refused
on this provider. Initialization and each atomic metadata publication are checked
using UTF-8 byte lengths, including simultaneous old-target and temporary-file
bytes. Healthy writes reserve a worst-case terminal reason and one gap manifest;
impossible budgets refuse before publication. Terminal/reopen writes obey the
same cap, even when the terminal can only remain in memory/checkpoint. Physics caps include 30,000 ticks, 2,000 chunks, 256 KiB lines,
16 MiB compressed / 64 MiB inflated chunks and 400 MiB total inflation. The reader
checks sizes before reading, confines regular files, verifies hashes before
bounded inflation, and checks every record and contiguous coverage. A report's
`complete:true` is a claim until that verification succeeds.

MuJoCo primes one real 20 ms interval before logical tick zero. Its raw tick-zero
contacts are retained unchanged. Aggregate contact peak/impulse use the logical
interval **(0, lastTick]**, excluding that priming interval. A tick-zero-only
report has unavailable interval metrics. Maximum tilt and load displacement
include the initial pose/reference; threshold duration counts only positive-tick
20 ms intervals. Tilt comes from the actual chassis quaternion. Wheel residuals
compare integrated wheel odometry to actual base pose transformed through the
admitted `driveFrameInBase`, with wrapped yaw difference.

Load displacement is maximum XY displacement from the first sample in its fixed
support coordinates. The support ID remains a coordinate reference after loss
of contact, never a custody/receipt claim. Missing/changed prop or support and
missing relative poses are unavailable. Future cell receipt-gated windows are
additive work, not implemented here. Stop distance is maximum actual drive-frame
path length over completed zero-target windows beginning while moving, ending
at the registered velocity threshold hold. Missing verified navigation coverage,
withdrawn stop targets or unfinished stops are unavailable, never zero. No
metric may report nonfinite overflow as available.

Native tests check a resting box's contact-force sign/map frame, all ten actual
mobile substeps' integrated impulses, and a transient contact gone by the final
substep. These establish implementation behavior, not calibrated robot safety.
A malicious producer can delete a contact and rewrite the whole hash chain;
without an external anchor, artifact hashes cannot detect that forgery.
