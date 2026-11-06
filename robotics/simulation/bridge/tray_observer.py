"""Independent modeled receiver: measured world cup pose inside the pinned tray,
measured stationary robot, fresh localization. No giver release/completion input.
"""
import copy
import math
import time


def _vec(v):
    return isinstance(v, (list, tuple)) and len(v) == 3 and all(type(x) in (float, int) and math.isfinite(x) and abs(x)<=100 for x in v)


def validate_beverage_fixture(config):
    if not isinstance(config, dict) or set(config) != {"cups", "trays"}:
        raise ValueError("BEVERAGE_FIXTURE_INVALID")
    if not isinstance(config["cups"], list) or not isinstance(config["trays"], list) or not 1 <= len(config["cups"]) <= 100 or not 1 <= len(config["trays"]) <= 100:
        raise ValueError("BEVERAGE_FIXTURE_BOUNDS")
    ids, slots, models = set(), set(), set()
    from .protocol import ID, NAMESPACE
    for cup in config["cups"]:
        if set(cup) != {"fixtureId", "gazeboModel", "positionM"} or not ID.fullmatch(cup["fixtureId"]) or not NAMESPACE.fullmatch(cup["gazeboModel"]) or not _vec(cup["positionM"]) or cup["fixtureId"] in ids or cup["gazeboModel"] in models:
            raise ValueError("BEVERAGE_CUP_INVALID")
        ids.add(cup["fixtureId"]); models.add(cup["gazeboModel"])
    for tray in config["trays"]:
        key = (tray["robotId"], tray["slot"])
        if (set(tray) != {"robotId", "slot", "offsetM", "dockPositionM", "toleranceM"} or not ID.fullmatch(tray["robotId"]) or type(tray["slot"]) is not int or not 1 <= tray["slot"] <= 100 or key in slots
                or not _vec(tray["offsetM"]) or not _vec(tray["dockPositionM"]) or type(tray["toleranceM"]) not in (float, int) or not math.isfinite(tray["toleranceM"]) or not 0 < tray["toleranceM"] <= .1):
            raise ValueError("BEVERAGE_TRAY_INVALID")
        slots.add(key)
    if len(config["cups"]) > 100 or len(config["trays"]) > 100:
        raise ValueError("BEVERAGE_FIXTURE_BOUNDS")
    return copy.deepcopy(config)


class TrayObserver:
    def __init__(self, config, *, run_id, world_revision, boot_id, robots, monotonic_ns=time.monotonic_ns):
        self.config = validate_beverage_fixture(config)
        self.run_id, self.world_revision, self.boot_id, self.robots, self.now = run_id, world_revision, boot_id, dict(robots), monotonic_ns
        self.pending, self.previous, self.emitted, self.seq = {}, {}, set(), 0
        self.freshness_ns = 500_000_000

    def bind(self, identity):
        from .protocol import validate_args
        validate_args("bind_transfer", identity)
        if identity["runId"] != self.run_id or identity["worldRevision"] != self.world_revision:
            raise ValueError("TRAY_PIN_MISMATCH")
        if not any(c["fixtureId"] == identity["fixtureId"] for c in self.config["cups"]):
            raise ValueError("CUP_FIXTURE_UNKNOWN")
        entity = self.robots.get(identity["robotId"])
        if not any(t["robotId"] == entity and t["slot"] == identity["slot"] for t in self.config["trays"]):
            raise ValueError("TRAY_UNKNOWN")
        prior = self.pending.get(identity["transferId"])
        if prior and prior != identity:
            raise ValueError("TRANSFER_IDENTITY_CONFLICT")
        self.pending[identity["transferId"]] = copy.deepcopy(identity)

    def _fresh(self, receipt, clock):
        return isinstance(receipt, dict) and type(receipt.get("simTimeNs")) is int and type(receipt.get("receivedMonotonicNs")) is int and 0 <= clock-receipt["simTimeNs"] <= self.freshness_ns and 0 <= self.now()-receipt["receivedMonotonicNs"] <= self.freshness_ns

    def _position(self, receipt, clock):
        if not self._fresh(receipt, clock):return None
        try:
            p=receipt["value"]["position"];v=[p["x"],p["y"],p["z"]]
            return v if _vec(v) else None
        except (KeyError, TypeError):return None

    @staticmethod
    def _yaw(receipt):
        try:
            q=receipt["value"]["orientation"]
            if not all(type(q.get(k)) in (float,int) and math.isfinite(q[k]) for k in ('x','y','z','w')):return None
            if abs(sum(q[k]**2 for k in ('x','y','z','w'))-1) > .001:return None
            return math.atan2(2*(q['w']*q['z']+q['x']*q['y']),1-2*(q['y']**2+q['z']**2))
        except (KeyError,TypeError):return None

    def readiness(self, clock, poses, localization):
        codes=[]
        for cup in self.config["cups"]:
            if clock is None or self._position(poses.get(cup["gazeboModel"]),clock) is None:codes.append("CUP_POSE_MISSING_OR_STALE")
        for tray in self.config["trays"]:
            ns=next((ns for ns,entity in self.robots.items() if entity==tray["robotId"]),None)
            if clock is None or self._position(poses.get(ns),clock) is None:codes.append("TRAY_POSE_MISSING_OR_STALE")
            loc=localization.get(ns)
            if clock is None or not self._fresh(loc,clock) or loc["value"].get("valid") is not True:codes.append("TRAY_LOCALIZATION_MISSING_OR_STALE")
        return {"available":not codes,"reasonCodes":sorted(set(codes)),"producer":"gazebo_tray","fidelity":"modeled"}

    def sample(self, clock, robots, cups, localization):
        out, stationary = [], {}
        for ns, receipt in robots.items():
            pos=self._position(receipt, clock);yaw=self._yaw(receipt);old=self.previous.get(ns)
            if pos is None or yaw is None:
                self.previous.pop(ns,None)
                continue
            # Cached pose can be reused for occupancy, but never supplies a new stationary pair.
            if old and receipt["sequence"] == old[0]:stationary[ns]=old[4];continue
            dt=receipt["simTimeNs"]-old[1] if old else 0
            # 0.02 m/s and 0.02 rad/s are modeled standstill tolerances. Wrapped
            # angle distance avoids treating a tiny +/-pi crossing as a full turn.
            angular_delta=abs(math.atan2(math.sin(yaw-old[3]),math.cos(yaw-old[3]))) if old else math.inf
            stable=bool(old and 0 < dt <= self.freshness_ns and math.dist(pos,old[2])/(dt/1e9) <= .02 and angular_delta/(dt/1e9) <= .02)
            self.previous[ns]=(receipt["sequence"],receipt["simTimeNs"],pos,yaw,stable);stationary[ns]=stable
        for identity in list(self.pending.values()):
            ns=identity["robotId"];robot=self._position(robots.get(ns),clock);loc=localization.get(ns)
            if robot is None or not stationary.get(ns) or not self._fresh(loc,clock):continue
            value=loc["value"]
            if value.get("valid") is not True or not _vec(value.get("positionM")) or math.dist(robot[:2],value["positionM"][:2]) > .05:continue
            tray=next(t for t in self.config["trays"] if t["robotId"]==self.robots[ns] and t["slot"]==identity["slot"])
            dock_error=math.dist(robot[:2],tray["dockPositionM"][:2])
            if dock_error > .05:continue
            fixture=next(c for c in self.config["cups"] if c["fixtureId"]==identity["fixtureId"])
            receipt=cups.get(fixture["gazeboModel"]);cup=self._position(receipt,clock)
            if cup is None:continue
            yaw=self._yaw(robots[ns])
            if yaw is None:continue
            ox,oy,oz=tray["offsetM"];center=[robot[0]+ox*math.cos(yaw)-oy*math.sin(yaw),robot[1]+ox*math.sin(yaw)+oy*math.cos(yaw),robot[2]+oz]
            if math.dist(cup,center) > tray["toleranceM"]:continue
            key=(identity['transferId'],receipt['sequence'])
            if key in self.emitted:continue
            self.emitted.add(key);self.seq+=1;now=self.now();entity=self.robots[ns]
            out.append({"observationId":f"tray:{self.boot_id}:{self.seq}","runId":self.run_id,"cupId":identity['cupId'],"transferId":identity['transferId'],"commandId":identity['commandId'],"payloadHash":identity['payloadHash'],"deviceId":entity,"observerId":f"gazebo-tray:{self.boot_id}","bootId":self.boot_id,"controlEpoch":identity['controlEpoch'],"seq":str(self.seq),"producer":"gazebo_tray","fidelity":"modeled","phase":"receive","parent":f"robot:{entity}/tray:{identity['slot']}","grip":None,"clockDomain":f"gazebo-monotonic:{self.boot_id}","observedMonotonicNs":str(receipt['receivedMonotonicNs']),"receivedMonotonicNs":str(now),"quality":"valid"})
        return out
