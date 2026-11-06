"""The worker's scene loop (SIM-05/06/07): one iteration per WORLD tick (/clock, never wall time). Each tick it tells Gazebo what the scenario
scripts (actor velocities, blocker placements, worker-scoped faults, each once) and reports what Gazebo shows (ground-truth pose telemetry per
robot, a contact-sensor liveness report plus every contact, footprint separation between robots). Everything leaves as protocol events; the
orchestrator decides what they mean. Ports are injected: RosPorts on Linux, fakes in tests."""
import math
import time

from actors.blocker import BlockerSchedule
from actors.scenario import SIL_FAULTS, actor_schedules, tick_commands
from metrics.contact import contacts_from_message
from metrics.separation import corners, footprint_gap
from .telemetry import TelemetryStream, pose_from_gz

TICK_NS = 20_000_000
PROVIDER = "gazebo_nav2"
# Who applies which fault: the worker touches the world (scene actors, blockers, a kidnapped robot); the orchestrator touches its own
# observation/telemetry/link path. The union is the catalog; nothing is applied twice.
WORKER_FAULTS = ("blocker-on", "blocker-off", "pedestrian-cross", "localization-lost")
ORCHESTRATOR_FAULTS = ("sensor-stale", "sensor-drop", "disconnect", "reboot", "map-changed", "duplicate-observation", "reorder-observation")
assert set(WORKER_FAULTS) | set(ORCHESTRATOR_FAULTS) == set(SIL_FAULTS) and not set(WORKER_FAULTS) & set(ORCHESTRATOR_FAULTS)


def _half(footprint):
    lo, hi = footprint["min"], footprint["max"]
    return ((hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2)


class SceneLoop:
    def __init__(self, ports, scenario, robots, *, run_id, boot_id, emit, tick_ns=TICK_NS, beverage=None, world_revision=None):
        self.ports, self.emit, self.tick_ns = ports, emit, tick_ns
        self.robots = [dict(r) for r in robots]                      # [{namespace, entityId, footprint}]
        self.by_entity = {r["entityId"]: r["namespace"] for r in self.robots}
        self.schedules = actor_schedules(scenario)
        self.blockers = BlockerSchedule(scenario["blockers"])
        self.faults = [dict(f, fired=False) for f in sorted(scenario["faults"], key=lambda f: f["atTick"])]
        self.streams = {r["entityId"]: TelemetryStream(run_id, PROVIDER, boot_id) for r in self.robots}
        self.last_tick = None
        self.last_pose = {}
        self.last_contact = {}
        self.last_separation = None
        self.freshness_ns = 500_000_000
        from .tray_observer import TrayObserver
        self.tray_observer = TrayObserver(beverage, run_id=run_id, world_revision=world_revision, boot_id=boot_id, robots=self.by_entity_inverse(), monotonic_ns=time.monotonic_ns) if beverage else None

    def by_entity_inverse(self):
        return {r["namespace"]: r["entityId"] for r in self.robots}

    def tray_readiness(self):
        if not self.tray_observer:
            return {"available": False, "reasonCodes": ["TRAY_OBSERVER_UNCONFIGURED"]}
        poses = self.ports.poses() or {}
        localization = self.ports.localization() if hasattr(self.ports,"localization") else {}
        return self.tray_observer.readiness(self.ports.clock_ns(), poses, localization)

    def bind_transfer(self, identity):
        if not self.tray_observer:
            raise ValueError("TRAY_OBSERVER_UNCONFIGURED")
        self.tray_observer.bind(identity)
        return {"bound": True, "producer": "gazebo_tray", "fidelity": "modeled"}

    # ---- one world tick --------------------------------------------------------------------------------------------------------
    def step(self):
        clock = self.ports.clock_ns()
        if clock is None:
            self.emit("clock", {"status": "missing"})
            return None
        tick = int(clock // self.tick_ns)
        if self.last_tick is not None and tick <= self.last_tick:
            return None                                             # paused or stalled world: nothing new to script or to sample
        self.last_tick = tick
        self.emit("clock", {"simTimeNs": str(clock), "tick": tick})
        self._script(tick)
        self._faults(tick)
        poses = self.ports.poses() or {}
        self._telemetry(tick, clock, poses)
        localization = self.ports.localization() if hasattr(self.ports, "localization") else {}
        self.emit("dock-observation", {"simTimeNs":str(clock), "robots":{r["entityId"]:{"pose":poses.get(r["namespace"]),"localization":localization.get(r["namespace"]),"poseFresh":self._fresh(poses.get(r["namespace"]),clock),"localizationFresh":self._fresh(localization.get(r["namespace"]),clock)} for r in self.robots}})
        self._contacts(tick, clock)
        self._separation(tick, clock, poses)
        if self.tray_observer:
            localization = self.ports.localization() if hasattr(self.ports, "localization") else {}
            for observation in self.tray_observer.sample(clock, poses, poses, localization):
                self.emit("transfer-observation", observation)
        return tick

    def _script(self, tick):
        cmd = tick_commands(self.schedules, self.blockers, tick)
        for v in cmd["velocities"]:
            self.ports.set_velocity(v["model"], v["vx"], v["vy"])
        for p in cmd["poses"]:
            self.ports.set_pose(p["model"], p["x"], p["y"], p["z"])

    def _faults(self, tick):
        for f in self.faults:
            if f["fired"] or f["atTick"] > tick:
                continue
            f["fired"] = True
            fault = {k: v for k, v in f.items() if k != "fired"}
            if f["faultId"] in ("blocker-on", "blocker-off", "pedestrian-cross"):
                applied = "schedule"                                 # the blocker/actor schedule is the fault; announcing it keeps the ledger whole
            elif f["faultId"] in WORKER_FAULTS:
                ns = self.by_entity.get(f.get("entityId"), f.get("entityId"))
                applied = bool(self.ports.inject_fault(fault, ns))
            else:
                applied = False
            self.emit("fault", {"faultId": f["faultId"], "entityId": f.get("entityId"), "tick": tick, "applied": applied,
                                "scope": "worker" if f["faultId"] in WORKER_FAULTS else "orchestrator"})

    def _fresh(self, receipt, clock):
        if not isinstance(receipt, dict):
            return False
        sim, wall = receipt.get("simTimeNs"), receipt.get("receivedMonotonicNs")
        return (isinstance(sim, int) and isinstance(wall, int)
                and 0 <= clock - sim <= self.freshness_ns
                and 0 <= time.monotonic_ns() - wall <= self.freshness_ns)

    def _telemetry(self, tick, clock, poses):
        for r in self.robots:
            stream, receipt = self.streams[r["entityId"]], poses.get(r["namespace"])
            try:
                observed = pose_from_gz(receipt["value"]) if receipt is not None else None
            except (ValueError, KeyError, TypeError):
                observed = None
            quality = "unknown" if observed is None else "valid" if self._fresh(receipt, clock) else "stale"
            identity = (receipt.get("sequence"), quality) if receipt else (None, quality)
            if self.last_pose.get(r["entityId"]) == identity:
                continue                                            # do not turn cached values into another sensor sample
            self.last_pose[r["entityId"]] = identity
            sampled_at = receipt.get("simTimeNs") if receipt else None
            sample = stream.sample(r["entityId"], "map", sampled_at if isinstance(sampled_at, int) else int(clock), observed, quality=quality,
                                   reason_codes=[] if quality == "valid" else ["POSE_MISSING" if quality == "unknown" else "POSE_STALE"])
            self.emit("telemetry", sample)
            # Receipt metadata is companion evidence, not part of the canonical TwinAmrState pose shape.
            self.emit("pose-sensor", {"entityId": r["entityId"], "sampleSeq": sample["seq"], "tick": tick, "quality": quality,
                                      "sourceSimTimeNs": str(sampled_at) if sampled_at is not None else None,
                                      "sourceReceivedMonotonicNs": str(receipt["receivedMonotonicNs"]) if receipt else None,
                                      "sensorSequence": str(receipt["sequence"]) if receipt else None})

    def _contacts(self, tick, clock):
        msgs = self.ports.contacts() or {}
        for r in self.robots:
            receipt = msgs.get(r["namespace"])
            fresh = self._fresh(receipt, clock)
            samples, valid = [], False
            if receipt is not None:
                try:
                    samples = contacts_from_message(receipt["value"], tick, int(receipt["simTimeNs"]))
                    valid = True
                except (ValueError, KeyError, TypeError):
                    pass
            previous = self.last_contact.get(r["entityId"])
            new = receipt is not None and previous != receipt.get("sequence")
            gap = new and previous is not None and receipt["sequence"] != previous + 1
            if new:
                self.last_contact[r["entityId"]] = receipt.get("sequence")
            if fresh and valid and new:
                for s in samples:
                    self.emit("contact", {"pair": list(s.pair), "tick": s.tick, "simTimeNs": str(s.sim_time_ns), "point": list(s.point), "normal": list(s.normal),
                                          "depthM": s.depth, "provenance": s.provenance, "robot": r["entityId"]})
            self.emit("contact-sensor", {"robot": r["entityId"], "tick": tick, "simTimeNs": str(int(clock)), "alive": fresh and valid and not gap, "reasonCodes": ["CONTACT_SEQUENCE_GAP"] if gap else [], "contacts": len(samples) if fresh and valid else 0,
                                         "sensorSequence": str(receipt["sequence"]) if receipt else None,
                                         "sourceSimTimeNs": str(receipt["simTimeNs"]) if receipt else None,
                                         "sourceReceivedMonotonicNs": str(receipt["receivedMonotonicNs"]) if receipt else None})

    def _separation(self, tick, clock, poses):
        placed = []
        for r in self.robots:
            raw = poses.get(r["namespace"])
            try:
                p = pose_from_gz(raw["value"]) if self._fresh(raw, clock) else None
            except ValueError:
                p = None
            if p is not None:
                placed.append((r["entityId"], (p["xM"], p["yM"], p["yawRad"]), _half(r["footprint"])))
        if len(placed) < len(self.robots):
            return                                                  # a robot without a pose: no clearance is claimed for this tick
        identity = tuple(poses[r["namespace"]]["sequence"] for r in self.robots)
        if identity == self.last_separation:
            return
        self.last_separation = identity
        for i in range(len(placed)):
            for j in range(i + 1, len(placed)):
                (na, pa, ha), (nb, pb, hb) = sorted((placed[i], placed[j]), key=lambda e: e[0])
                self.emit("separation", {"tick": tick, "simTimeNs": str(int(clock)), "a": na, "b": nb, "gapM": footprint_gap(corners(*pa, ha), corners(*pb, hb)),
                                         "centreM": math.dist(pa[:2], pb[:2]), "provenance": "physics_sim"})

    # ---- thread entry ------------------------------------------------------------------------------------------------------------
    def run(self, stop_event, period_s=0.02):
        """Poll the world at about the tick period; `step` itself only advances on a new /clock value."""
        while not stop_event.is_set():
            try:
                self.step()
            except Exception as e:  # noqa: BLE001 - a scene error is reported, the worker keeps serving goals
                self.emit("scene-error", {"error": type(e).__name__})
            time.sleep(period_s)
