"""Pure control logic of the engineering physics worker (no ROS imports): lifecycle ordering and cleanup, one writer per joint, epoch framing and the bounded evidence queue.
The Gazebo/Nav2/ros2_control wiring that calls these functions is native-only and is exercised on a qualified target, not here."""

STAGES = ["validate", "resolve", "compile", "doctor", "spawn_paused", "load_controllers", "verify_identity", "ready", "run", "stop", "flush", "archive"]


class EvidenceGap(RuntimeError):
    pass


def check_epoch(sample, active_epoch):
    if sample["epoch"] != active_epoch:
        raise RuntimeError("EPOCH_MISMATCH")


class EvidenceQueue:
    """Bounded durable-evidence queue. When full the world is paused and the run fails: samples are never dropped while a pass is still possible."""

    def __init__(self, limit, pause_world):
        self.limit, self.pause_world, self.items, self.failed = limit, pause_world, [], False

    def put(self, sample):
        if len(self.items) >= self.limit:
            self.failed = True
            try:
                self.pause_world()
            except Exception as error:  # failing to pause also stops the run
                raise RuntimeError("EVIDENCE_GAP_PAUSE_FAILED") from error
            raise EvidenceGap("EVIDENCE_GAP")
        self.items.append(sample)

    def drain(self):
        out, self.items = self.items, []
        return out


def assert_single_writer(authority):
    """authority: [{"joint", "controller"}]. A joint with two writers (gz DiffDrive and ros2_control, say) is a configuration error."""
    seen = {}
    for entry in authority:
        joint, controller = entry["joint"], entry["controller"]
        if joint in seen and seen[joint] != controller:
            raise RuntimeError(f"JOINT_WRITER_CONFLICT:{joint}")
        seen[joint] = controller


class Lifecycle:
    """validate -> ... -> archive. Each stage may register a cleanup for a process this run created; a failure runs them newest first and nothing else."""

    def __init__(self, monotonic, startup_timeout_s):
        self.monotonic, self.timeout, self.failed = monotonic, startup_timeout_s, None
        self.index, self.cleanups, self.started = -1, [], monotonic()

    def enter(self, stage, owns=None):
        if self.failed:
            raise RuntimeError(f"LIFECYCLE_FAILED:{self.failed}")
        if STAGES.index(stage) != self.index + 1:
            raise RuntimeError(f"STAGE_ORDER:{stage}")
        if STAGES.index(stage) <= STAGES.index("ready") and self.monotonic() - self.started > self.timeout:
            self.fail("STARTUP_TIMEOUT")
            raise RuntimeError("STARTUP_TIMEOUT")
        self.index += 1
        if owns:
            self.cleanups.append(owns)

    def fail(self, reason):
        self.failed = reason
        while self.cleanups:
            self.cleanups.pop()()


class SimClock:
    """Simulation clock in integer nanoseconds. Pause freezes integration only; wall-clock watchdogs are separate and keep running."""

    def __init__(self):
        self.sim_ns, self.paused = 0, False

    def pause(self):
        self.paused = True

    def resume(self):
        self.paused = False

    def advance(self, dt_ns):
        if dt_ns < 0:
            raise RuntimeError("CLOCK_REGRESSION")
        if not self.paused:
            self.sim_ns += dt_ns
