"""SIM-only virtual grip. Actual output0 + actual SI pose, bounded scene receipts.
No controller completion, force measurement or domain authority is an input.
"""
import copy
import math
import time
from .sim_geometry import cup_center


def next_grip(*, close_output: bool, cup_in_zone: bool, fault: bool) -> str:
    return "fault" if fault else "held" if close_output and cup_in_zone else "empty" if close_output else "open"


def _vector(v, n=3):
    return isinstance(v, (list, tuple)) and len(v) == n and all(type(x) in (float, int) and math.isfinite(x) for x in v)


class SimGripper:
    def __init__(self, config, *, monotonic_ns=time.monotonic_ns):
        self.config, self.now = copy.deepcopy(config), monotonic_ns
        for k in ("freshnessMs", "graspToleranceM", "releaseToleranceM", "liftMinM", "dockToleranceM"):
            if not math.isfinite(config[k]) or config[k] <= 0:
                raise ValueError("SIM_GEOMETRY_INVALID")
        if not _vector(config["worldFromArmBaseM"]) or not _vector(config["trayPositionM"]) or not _vector(config["cupOffsetTcpM"]) or config["outputPin"] != 0 or config["freshnessMs"]>500:
            raise ValueError("SIM_GEOMETRY_INVALID")
        self.pin, self.scene, self.receipt, self.scene_seq = None, None, None, -1
        self.held, self.taken, self.seq, self.last, self.state, self.reason = None, set(), 0, None, "unknown", ["SCENE_UNBOUND"]
        self.last_output, self.uncertain = None, False

    def bind(self, run_id, world_revision, controller_epoch):
        # A new owner never inherits another run's virtual custody.
        if self.held and self.pin != (run_id, world_revision, controller_epoch):
            raise ValueError("SIM_CUP_RECONCILE_REQUIRED")
        if self.pin != (run_id, world_revision, controller_epoch):
            self.scene_seq = -1
            self.taken.clear()
        self.pin = (run_id, world_revision, controller_epoch)
        self.scene, self.receipt, self.last = None, None, None
        self.state, self.reason = "unknown", ["SCENE_MISSING"]

    def update(self, scene):
        if not self.pin or (scene["runId"], scene["worldRevision"]) != self.pin[:2]:
            raise ValueError("SIM_SCENE_PIN_MISMATCH")
        if not _vector(scene["cup"]["positionM"]) or scene["receiver"] is not None and not math.isfinite(scene["receiver"]["poseErrorM"]):
            raise ValueError("SIM_SCENE_GEOMETRY_INVALID")
        if self.held and self.held["id"] != scene["cup"]["id"]:
            raise ValueError("SIM_CUP_IDENTITY_MISMATCH")
        if int(scene["sceneSeq"]) <= self.scene_seq:
            raise ValueError("SIM_SCENE_SEQUENCE_REPLAY")
        self.scene, self.receipt, self.scene_seq = copy.deepcopy(scene), self.now(), int(scene["sceneSeq"])

    def telemetry(self):
        return {"state": self.state, "closeOutput": self.last_output, "producer": "linuxcnc_virtual_grip", "fidelity": "modeled", "reasonCodes": self.reason[:]}

    def sample(self, *, close_output, tcp_m, actual_joints_rad, command, controller_epoch, boot_id):
        self.last_output = close_output if type(close_output) is bool else None
        now, s = self.now(), self.scene
        if not self.pin or controller_epoch != self.pin[2] or not s or self.receipt is None or not 0 <= now-self.receipt <= self.config["freshnessMs"]*1_000_000:
            self.state, self.reason = "unknown", ["SIM_SCENE_STALE_OR_EPOCH"]
            return self._unknown(s, command, boot_id, now, close_output)
        if type(close_output) is not bool or not _vector(tcp_m) or not _vector(actual_joints_rad, 6):
            self.state, self.reason = "unknown", ["ACTUAL_OUTPUT_OR_POSE_MISSING"]
            return self._unknown(s, command, boot_id, now, close_output)
        if command.get("commandId") != s["commandId"] or not all(k in command for k in ("deviceId", "payloadHash", "controlEpoch")):
            self.state, self.reason = "unknown", ["SIM_COMMAND_MISMATCH"]
            return None
        if self.uncertain:
            self.state, self.reason = "unknown", ["SIM_CUP_RECONCILE_REQUIRED"]; return None
        tcp = [a+b for a, b in zip(tcp_m, self.config["worldFromArmBaseM"])]
        object_center = cup_center(actual_joints_rad, tcp_m, self.config["worldFromArmBaseM"], self.config["cupOffsetTcpM"])
        cup, faults = s["cup"], s["faults"]
        if self.held and self.held["id"] != cup["id"]:
            self.state, self.reason = "unknown", ["HELD_CUP_IDENTITY_MISMATCH"]; return None
        in_zone = cup["present"] and "missing_cup" not in faults and cup["id"] not in self.taken and math.dist(object_center, cup["positionM"]) <= self.config["graspToleranceM"]
        phase, parent, lift = None, None, False
        program = (command.get("programRef") or {}).get("id")
        if program not in ("cup-pick", "cup-place"):
            self.state, self.reason = "unknown", ["SIM_PROGRAM_NOT_COUPLED"]; return None
        if self.held:
            if "drop_cup" in faults:
                phase, self.state = "lost", "lost"; self.held = None
            elif "gripper_stuck" in faults:
                self.state, self.reason = "fault", ["GRIPPER_STUCK"]; return None
            elif close_output:
                self.state, phase = "held", "grasp" if program == "cup-pick" else None
                parent = f"arm:{self.config['armId']}/tcp"
                lift = object_center[2]-self.held["positionM"][2] >= self.config["liftMinM"]
            else:
                r = s["receiver"]
                ready = (r is not None and r["robotId"] == self.config["trayRobotId"] and r["slot"] == self.config["traySlot"] and r["stationary"] and r["localizationValid"] and r["poseErrorM"] <= self.config["dockToleranceM"] and r["trayPresent"]
                         and math.dist(tcp, self.config["trayPositionM"]) <= self.config["releaseToleranceM"])
                phase, self.state = ("release", "released") if ready else ("lost", "lost")
                parent = f"robot:{r['robotId']}/tray:{r['slot']}" if ready else None
                self.held = None
        else:
            self.state = next_grip(close_output=close_output, cup_in_zone=in_zone, fault="gripper_stuck" in faults)
            if self.state == "held" and program == "cup-pick":
                self.held = copy.deepcopy(cup); self.taken.add(cup["id"])
                phase, parent = "grasp", f"arm:{self.config['armId']}/tcp"
        self.reason = [] if self.state in ("held", "released", "open") else [self.state.upper()]
        return self._proof(s, command, boot_id, now, close_output, phase, parent, lift)

    def _unknown(self, s, command, boot_id, now, close_output):
        if (not self.held or not s or self.uncertain or command.get("commandId") != s["commandId"]
                or not all(k in command for k in ("deviceId", "payloadHash", "controlEpoch"))):
            return None
        self.uncertain = True
        return self._proof(s, command, boot_id, now, close_output, "grasp", None, False, quality="unknown")

    def _proof(self, s, command, boot_id, now, close_output, phase, parent, lift, quality="valid"):
        cup=s["cup"]
        identity = (s["commandId"], phase, parent, lift, quality)
        if phase is None or self.last == identity:
            return None
        self.last = identity; self.seq += 1
        return {"observationId": f"grip:{boot_id}:{self.seq}", "runId": s["runId"], "cupId": cup["id"], "transferId": s["transferId"], "commandId": command["commandId"], "payloadHash": command["payloadHash"],
                "deviceId": command["deviceId"], "observerId": f"linuxcnc-grip:{boot_id}", "bootId": boot_id, "controlEpoch": command["controlEpoch"], "seq": str(self.seq), "producer": "linuxcnc_virtual_grip", "fidelity": "modeled",
                "phase": phase, "parent": parent, "grip": {"closed": close_output, "objectPresent": self.held is not None} if type(close_output) is bool else None, "clockDomain": f"linuxcnc-monotonic:{boot_id}", "observedMonotonicNs": str(now), "receivedMonotonicNs": str(now), "quality": quality, "liftPoseReached": lift}
