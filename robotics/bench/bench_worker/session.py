"""One bench session on one bus (contracts §3): the op order, the read-only gate, configure with readback, and `step` = 20 / cycleMs bus exchanges driven by the
command channel and the CiA 402 table. Step mode: no thread, no clock decides anything here (the TS side keeps the 20 ms tick).

Every gate before torque fails closed on its own (spec B1 §6): the op gates in `handle`, the command check in `_step`, and `_gate`, which sees every controlword
just before it goes on the bus and replaces any word that leads toward enable by 0x0000 while read-only, quick stop, a worker fault, a stale channel or a session
that is not started forbids it.

Worker latches (per axis; reported as state "fault" with the code; the stop sequence of stopseq rule 2 runs while one is set):
- COMMAND_TIMEOUT, OVERSPEED, FEEDBACK_LOSS: the worker's own checks (spec B1 5.2). A rising faultReset edge clears them once the cause is gone; in that same
  tick the table sends 0x0080 if the drive is in Fault, so one edge resets both.
- EXTERNAL_TRIP, for "no automatic restart" (BK-D11, KCF01), in two cases: (1) the drive left Operation enabled while the worker was still writing 0x000F;
  (2) an enable attempt did not succeed: the command asked to run (enable, no quickStop, no latch) for `channel.enableTimeoutTicks` ticks (default 100) while the
  axis was neither enabled nor in a drive Fault. Without (2), clearing the latch with motor power still absent would leave enable armed and the motor would
  start by itself when power returns.
  A rising faultReset edge on EXTERNAL_TRIP: if the drive is in Fault, the worker writes 0x0080 for one cycle and the latch stays; if not, the latch clears.
  So a drive that faulted after the trip needs two separate rising edges, the first for the drive, the second for the latch. Never 0x0080 without a rising
  edge, never a word toward enable while latched."""
import math
import platform
import re
import time

from . import BenchError
from .channel import CommandChannel
from .cia402 import ADVANCING, DISABLED, ENABLED, ENABLE_OPERATION, FAULT, QUICK_STOP, neutral_fault, neutral_state, next_controlword
from .stopseq import quick_stop_word
from .units import Unwrap32, position_from_raw, torque_from_raw, velocity_from_raw, velocity_to_raw

MAX_SPEED_RADS, MAX_TORQUE_PERMILLE = 30, 300      # the hard ceiling of B1 (spec B1 §6): changing it is a reviewed code change, never a flag
OVERSPEED_FACTOR = 1.2                             # the virtual drive's factor (spec B1 §5.2)
WORKER_VERSION = "1.0.0"   # the bench record carries it (worker.version); bump on any change of behaviour
CHANNEL_DEFAULTS = {"quickStopRestRadS": 0.05, "quickStopHoldMs": 2000, "wkcErrorCyclesToLoss": 5, "enableTimeoutTicks": 100}   # kit `channel` knobs: tuning for real hardware, not code
MODE_CODE = {"csv": 9, "pv": 3}
MAPPING = ("1C12", "1C13")                         # plus 1600-17FF and 1A00-1BFF
# Objects a kit may never write by SDO: store (1010), PDO mapping/assignment, and everything that commands motion or state. The same list is in
# packages/bench/src/contracts.ts `sdoForbidden` (KIT_SDO_FORBIDDEN); keep the two equal, each refuses on its own.
MOTION = ("1010", "6040", "6060", "60FF", "6071", "607A", "60B1", "60B2", "60FE")
WRITE_OPS = ("configure", "start", "silence", "imuConfigure")
ORDER = {"open": ("new",), "scan": ("open", "scanned"), "configure": ("scanned",), "start": ("configured",), "step": ("started",), "silence": ("started",)}


def _is_mapping(obj):
    i = int(obj[:4], 16)
    return obj[:4] in MAPPING or 0x1600 <= i <= 0x17FF or 0x1A00 <= i <= 0x1BFF


def _same_revision(expect, actual):
    if expect is None:
        return True
    try:
        return int(expect, 0) == int(actual)
    except (TypeError, ValueError):
        return str(expect) == str(actual)


def _hex(v):
    return f"0x{v:08X}"


class BenchSession:
    def __init__(self, kit: dict, bus, *, read_only: bool):
        self.kit, self.bus, self.read_only = kit, bus, read_only
        self.axes = kit["axes"]
        self.n = len(self.axes)
        b, lim, ch = kit["bus"], kit["limits"], kit["channel"]
        self.cycle_ms, self.cpt = b["cycleMs"], 20 // b["cycleMs"]
        self.max_speed = lim["maxSpeedRadS"]
        knobs = CHANNEL_DEFAULTS | {k: ch[k] for k in CHANNEL_DEFAULTS if k in ch}
        self.rest_rads, self.hold_ms, self.wkc_to_loss = knobs["quickStopRestRadS"], knobs["quickStopHoldMs"], knobs["wkcErrorCyclesToLoss"]
        self.enable_timeout, self.waiting, self.pulse = knobs["enableTimeoutTicks"], [0] * self.n, [False] * self.n
        self.channels = [CommandChannel(accel_rad_s2=lim["maxAccelRadS2"], max_speed_rad_s=min(self.max_speed, MAX_SPEED_RADS), cycles_per_tick=self.cpt,
                                        cycle_s=self.cycle_ms / 1000, watchdog_ticks=ch["watchdogTicks"], interpolation=ch["interpolation"]) for _ in self.axes]
        self.phase, self.tick, self.cycle_no, self.identity_ok, self.allowed = "new", 0, 0, False, set()
        self.sw, self.cw, self.latched, self.wkc_bad = [0] * self.n, [0] * self.n, [None] * self.n, [0] * self.n
        self.rest, self.qs_ms = [0] * self.n, [0] * self.n   # cycles in a row below quickStopRestRadS; ms since the quick-stop sequence began
        self.unwrap = [Unwrap32() for _ in self.axes]
        self.last = [None] * self.n                          # the last input of each axis that came with a good working counter
        self.read_ok = [False] * self.n                      # whether the latest exchange read that axis (good working counter)
        self.accepted = [{"enable": False, "quickStop": False, "faultReset": False} for _ in self.axes]
        self.fault_maps = [a.get("faultMap", {}) for a in self.axes]

    # ---- the op gates ----
    def handle(self, op: str, payload: dict, expected_tick: int) -> dict:
        if self.read_only and (op in WRITE_OPS or op == "step" and any(not isinstance(c, dict) or c.get("enable") is not False for c in payload.get("commands") or [])):
            raise BenchError("BENCH_READ_ONLY", f"{op} with a write or an enable in a read-only session")
        if op == "imuConfigure":
            raise BenchError("BENCH_ORDER_VIOLATION", "imuConfigure is an op of the sensors role")
        if op not in ("describe", "stop") and self.phase not in ORDER.get(op, ()):
            raise BenchError("BENCH_ORDER_VIOLATION", f"{op} in phase {self.phase}")
        if op == "step" and expected_tick != self.tick:
            raise BenchError("BENCH_ORDER_VIOLATION", f"expectedTick {expected_tick} but the session is at tick {self.tick}")
        return getattr(self, f"_{op}")(payload)

    def _describe(self, payload):
        return {"protocol": "mekoniq-bench/1", "role": "bus", "backend": self.kit["bus"]["backend"], "kitId": self.kit["id"], "kitDigest": self.kit["digest"],
                "readOnly": self.read_only, "phase": self.phase, "lockDigest": None,
                "version": WORKER_VERSION, "python": platform.python_version(), "pysoem": None}   # ponytail: no lock file before .venv-bench exists (K08); then its sha256

    def _open(self, payload):
        self.phase = "open"
        return {"interface": self.kit["bus"]["interface"]}

    # ponytail: reads one PDO (0x1600 / 0x1A00) and trusts that 0x1C12/0x1C13 assign it; read the assignment back when a drive with several PDOs reaches the bench
    def _read_map(self, pos, idx):
        n = self.bus.sdo_read(pos, f"{idx}:00", 1)
        return [f"{v >> 16:04X}:{v >> 8 & 0xFF:02X}" for v in (self.bus.sdo_read(pos, f"{idx}:{k:02X}", 4) for k in range(1, n + 1))]

    def _scan(self, payload):
        objects = payload.get("objects", [])   # read by SDO on every slave, e.g. 605A:00 for KCF05; reading is allowed in read-only mode
        if not isinstance(objects, list) or not all(isinstance(o, str) and re.fullmatch(r"[0-9A-F]{4}:[0-9A-F]{2}", o) for o in objects):
            raise BenchError("BENCH_ORDER_VIOLATION", f"scan objects must be 'XXXX:XX' (upper-case hex), got {str(objects)[:200]}")
        slaves = self.bus.scan()
        if len(slaves) != self.n:
            raise BenchError("BENCH_SLAVE_COUNT", f"{len(slaves)} slaves on the bus, the kit has {self.n} axes")
        by_pos = {a["slavePosition"]: a for a in self.axes}
        out, ok = [], {s["position"] for s in slaves} == set(by_pos)
        for s in slaves:
            a = by_pos.get(s["position"])
            match = a is not None and _hex(s["vendorId"]) == a["expect"]["vendorId"].upper().replace("0X", "0x") and _hex(s["productCode"]) == a["expect"]["productCode"].upper().replace("0X", "0x") \
                and _same_revision(a["expect"]["revision"], s["revision"])
            ok = ok and match
            out.append(s | {"vendorId": _hex(s["vendorId"]), "productCode": _hex(s["productCode"]), "axisId": a and a["axisId"], "identityMatches": match,
                            "rxPdo": self._read_map(s["position"], "1600"), "txPdo": self._read_map(s["position"], "1A00"),
                            # ponytail: 4-byte reads; SoemBus (K08) sizes and signs each object from the device profile
                            "objects": {o: self.bus.sdo_read(s["position"], o, 4) for o in objects}})
        self.identity_ok, self.phase = ok, "scanned"
        return {"slaves": out}

    # ---- configure: plan everything, refuse before the first write, then write and read back ----
    def _plan(self, a):
        lim = self.kit["limits"]
        own = {"6060:00": (MODE_CODE[self.kit["bus"]["mode"]], 1), "6072:00": (lim["maxTorquePermille"], 2), "607F:00": (abs(velocity_to_raw(lim["maxSpeedRadS"], a["units"])), 4)}
        plan = [(o, v, b) for o, (v, b) in own.items()]
        for w in a["sdoWrites"]:
            obj = w["object"].upper()
            if obj[:4] in MOTION or _is_mapping(obj):
                raise BenchError("BENCH_SDO_NOT_LISTED", f"{a['axisId']}: {obj} is never written from sdoWrites")
            if obj in own or obj == "6080:00":
                if own.get(obj, (None,))[0] != w["value"]:
                    raise BenchError("BENCH_LIMIT_EXCEEDED", f"{a['axisId']}: sdoWrites sets {obj}={w['value']}, the kit limits say {own.get(obj, ('-',))[0]}")
                continue
            plan.append((obj, w["value"], w["bytes"]))
        return plan

    def _configure(self, payload):
        self.phase = "failed"                                # any refusal below ends the session: the kit cannot change under it
        lim = self.kit["limits"]
        if lim["maxSpeedRadS"] > MAX_SPEED_RADS or lim["maxTorquePermille"] > MAX_TORQUE_PERMILLE or self.kit["bus"]["mode"] not in MODE_CODE:
            raise BenchError("BENCH_LIMIT_EXCEEDED", f"limits {lim['maxSpeedRadS']} rad/s, {lim['maxTorquePermille']} permille above the B1 ceiling {MAX_SPEED_RADS}, {MAX_TORQUE_PERMILLE}")
        if not self.identity_ok:
            raise BenchError("BENCH_IDENTITY_CHANGED", "the scanned slaves are not the kit's (vendor, product, position)")
        plans = [self._plan(a) for a in self.axes]
        self.allowed = {(a["slavePosition"], o) for a, p in zip(self.axes, plans) for o, _, _ in p}
        out = []
        for a, plan in zip(self.axes, plans):
            pos = a["slavePosition"]
            self.bus.map_pdo(pos, a["pdo"]["rx"], a["pdo"]["tx"])
            rx, tx = self._read_map(pos, "1600"), self._read_map(pos, "1A00")
            if rx != [o.upper() for o in a["pdo"]["rx"]] or tx != [o.upper() for o in a["pdo"]["tx"]]:
                raise BenchError("BENCH_PDO_MAP_REFUSED", f"{a['axisId']}: mapping reads back rx {rx} tx {tx}")
            for obj, value, size in plan:
                self._sdo_write(pos, obj, value, size)
            out.append({"axisId": a["axisId"], "rxPdo": rx, "txPdo": tx, "written": [{"object": o, "value": v} for o, v, _ in plan]})
        self.phase = "configured"
        return {"axes": out}

    def _sdo_write(self, pos, obj, value, size):
        if self.read_only:
            raise BenchError("BENCH_READ_ONLY", f"SDO {obj}")
        if obj.startswith("1010") or (pos, obj) not in self.allowed:
            raise BenchError("BENCH_SDO_NOT_LISTED", f"slave {pos}: {obj}")
        self.bus.sdo_write(pos, obj, value, size)
        back = self.bus.sdo_read(pos, obj, size)
        if back != value:
            raise BenchError("BENCH_SDO_READBACK_MISMATCH", f"slave {pos}: {obj} wrote {value}, read back {back}")

    def _start(self, payload):
        if self.phase != "configured":                       # its own gate, not only handle's order table
            raise BenchError("BENCH_ORDER_VIOLATION", f"start in phase {self.phase}")
        self.phase = "failed"
        self.bus.start(self.cycle_ms, self.kit["bus"]["sync"])
        self.phase = "started"
        return {"alState": "OP", "cycleMs": self.cycle_ms, "sync": self.kit["bus"]["sync"], "cyclesPerTick": self.cpt}

    # ---- step ----
    def _check(self, commands):
        if not isinstance(commands, list):
            raise BenchError("DRIVE_COMMAND_REQUIRED", "commands is not a list")
        by_id = {}
        for c in commands:
            ids = [a["axisId"] for a in self.axes]
            if not isinstance(c, dict) or c.get("axisId") not in ids:
                raise BenchError("DRIVE_AXIS_UNKNOWN", str(c)[:200])
            if c["axisId"] in by_id:
                raise BenchError("DRIVE_COMMAND_SEQ_INVALID", f"two commands for {c['axisId']}")
            if c.get("mode") != self.kit["bus"]["mode"]:
                raise BenchError("DRIVE_MODE_MISMATCH", f"{c['axisId']} is {self.kit['bus']['mode']}")
            if "seq" not in c or "target" not in c or not all(isinstance(c.get(k), bool) for k in ("enable", "quickStop", "faultReset")):
                raise BenchError("DRIVE_COMMAND_REQUIRED", f"{c['axisId']}: seq, target and boolean enable, quickStop, faultReset are required")
            self.channels[ids.index(c["axisId"])].check(c)
            by_id[c["axisId"]] = c
        missing = [a["axisId"] for a in self.axes if a["axisId"] not in by_id]
        if missing:
            raise BenchError("DRIVE_COMMAND_REQUIRED", ", ".join(missing))
        return [by_id[a["axisId"]] for a in self.axes]

    def _latch(self, i, code):
        if self.latched[i] is None:
            self.latched[i] = code
        self.channels[i].neutral()

    def _gate(self, i, cw, expired):
        cmd = self.accepted[i]
        if cw in ADVANCING and (self.read_only or self.phase != "started" or cmd["quickStop"] or not cmd["enable"] or self.latched[i] or expired):
            return 0x0000
        return cw

    def _step(self, payload):
        commands = self._check(payload.get("commands"))      # the whole tick is refused before anything changes
        edges = []
        for i, c in enumerate(commands):
            fresh = self.channels[i].accept(c)
            edges.append(fresh and c["faultReset"] and not self.accepted[i]["faultReset"])
            prev = self.accepted[i]   # a repeated seq keeps its command (as DriveGroup does), but may only tighten it: a quick stop or a disable is never ignored
            self.accepted[i] = c if fresh else prev | {"quickStop": prev["quickStop"] or c["quickStop"], "enable": prev["enable"] and c["enable"]}
            self.pulse[i] = edges[i] and self.latched[i] == "EXTERNAL_TRIP" and neutral_state(self.sw[i]) == FAULT   # R-a: reset the drive, keep the latch
            if edges[i] and self.latched[i] and not self.pulse[i] and self._cause_cleared(i):
                self.latched[i], self.wkc_bad[i] = None, 0
        rows, t0, stale = [], time.monotonic_ns(), [False] * self.n
        for k in range(self.cpt):
            outputs = []
            for i, a in enumerate(self.axes):
                target, expired = self.channels[i].cycle()
                stale[i] = expired
                state, cmd = neutral_state(self.sw[i]), self.accepted[i]
                if expired and state not in (DISABLED, FAULT):
                    self._latch(i, "COMMAND_TIMEOUT")
                if (self.latched[i] or not cmd["enable"]) and state in (ENABLED, QUICK_STOP):   # stopseq rule 2; a commanded quick stop is the table's (rule 1)
                    cw = self._quick_stop_word(i)
                elif self.latched[i]:
                    cw = 0x0080 if self.pulse[i] and k == 0 else 0x0000
                else:
                    self.qs_ms[i] = 0
                    cw = next_controlword(self.sw[i], cmd["enable"] and not expired, cmd["quickStop"], edges[i] and k == 0)
                cw = self._gate(i, cw, expired)
                if state != ENABLED or cw != ENABLE_OPERATION:
                    self.channels[i].neutral()
                    target = 0.0
                outputs.append({"controlword": cw, "targetRaw": velocity_to_raw(target, a["units"])})
            rows.append(self._exchange(outputs))
        for i, cmd in enumerate(self.accepted):   # R-b: an enable attempt that does not succeed latches instead of staying armed
            # a stale command (expired channel) asks for nothing: the gate already writes 0x0000, and the cause to report is the channel, not the drive
            asking = cmd["enable"] and not cmd["quickStop"] and not self.latched[i] and not stale[i] and neutral_state(self.sw[i]) not in (ENABLED, FAULT)
            self.waiting[i] = self.waiting[i] + 1 if asking else 0
            if self.waiting[i] >= self.enable_timeout:
                self._latch(i, "EXTERNAL_TRIP")
                self.waiting[i] = 0
        self.tick += 1
        return {"feedback": [self._feedback(i, self.tick - 1) for i in range(self.n)],
                "vendor": [{"axisId": a["axisId"], "statusword": self.sw[i], "errorCode": self.last[i] and self.last[i]["errorCode"]} for i, a in enumerate(self.axes)],
                "cycles": rows, "timing": {"cycleMs": self.cycle_ms, "exchanges": len(rows), "startMonoNs": t0, "endMonoNs": time.monotonic_ns()}}

    def _quick_stop_word(self, i):
        cw = quick_stop_word(self.sw[i], self.rest[i], self.qs_ms[i], rest_cycles_needed=self.cpt, hold_ms=self.hold_ms)
        self.qs_ms[i] += self.cycle_ms
        return cw

    def _cause_cleared(self, i):
        v = self.last[i] and velocity_from_raw(self.last[i]["velocityRaw"] or 0, self.axes[i]["units"])
        return {"OVERSPEED": v is not None and abs(v) < self.max_speed, "FEEDBACK_LOSS": self.wkc_bad[i] == 0,
                "EXTERNAL_TRIP": neutral_state(self.sw[i]) != FAULT}.get(self.latched[i], True)

    def _exchange(self, outputs):
        """One bus cycle in slave-position order; updates statuswords, unwrapped positions and the worker's own fault checks."""
        by_pos = sorted(range(self.n), key=lambda i: self.axes[i]["slavePosition"])
        inputs = self.bus.exchange([outputs[i] for i in by_pos])
        t = time.monotonic_ns()
        axes = []
        for i, inp in zip(by_pos, inputs):
            self.cw[i], self.read_ok[i] = outputs[i]["controlword"], inp["wkcOk"]
            if inp["wkcOk"]:
                self.wkc_bad[i] = 0
                # EXTERNAL_TRIP case (1) of the module docstring; a drive Fault latches in the drive itself
                if neutral_state(self.sw[i]) == ENABLED and outputs[i]["controlword"] == ENABLE_OPERATION and neutral_state(inp["statusword"]) not in (ENABLED, FAULT):
                    self._latch(i, "EXTERNAL_TRIP")
                self.sw[i], self.last[i] = inp["statusword"], inp
                self.unwrap[i].update(inp["positionRaw"])
                v = None if inp["velocityRaw"] is None else abs(velocity_from_raw(inp["velocityRaw"], self.axes[i]["units"]))
                self.rest[i] = self.rest[i] + 1 if v is not None and v < self.rest_rads else 0   # an unknown velocity is never "at rest"
                if v is not None and v > OVERSPEED_FACTOR * self.max_speed:
                    self._latch(i, "OVERSPEED")
            else:
                self.wkc_bad[i], self.rest[i] = self.wkc_bad[i] + 1, 0
                if self.wkc_bad[i] >= self.wkc_to_loss:
                    self._latch(i, "FEEDBACK_LOSS")
            axes.append((i, {"axisId": self.axes[i]["axisId"], "controlword": outputs[i]["controlword"], "statusword": inp["statusword"], "targetRaw": outputs[i]["targetRaw"],
                             "positionRaw": inp["positionRaw"], "velocityRaw": inp["velocityRaw"], "torqueRaw": inp["torqueRaw"]}))
        self.cycle_no += 1
        # ponytail: wkc = slaves with a good working counter, not the frame's raw counter; report the raw value when SoemBus (K08) has it
        return {"cycle": self.cycle_no - 1, "tMonoNs": t, "wkc": sum(1 for x in inputs if x["wkcOk"]), "axes": [row for _, row in sorted(axes)]}

    def _feedback(self, i, tick):
        a, last = self.axes[i], self.last[i]
        state = FAULT if self.latched[i] else neutral_state(self.sw[i])
        fault = self.latched[i] or (neutral_fault(last["errorCode"] or 0 if last else 0, self.fault_maps[i]) if state == FAULT else None)
        u = a["units"]
        pos = position_from_raw(self.unwrap[i].total, u) if self.unwrap[i].total is not None else None
        vel = velocity_from_raw(last["velocityRaw"], u) if last and last["velocityRaw"] is not None else None
        return {"axisId": a["axisId"], "state": state, "fault": fault, "commandSeq": max(self.channels[i].seq, 0), "positionRad": pos, "velocityRadS": vel,
                "torqueNm": torque_from_raw(last["torqueRaw"], u) if last else None, "tick": tick}

    # ---- silence and stop ----
    def _silence(self, payload):
        ms = payload.get("ms")
        if isinstance(ms, bool) or not isinstance(ms, int) or not 0 < ms <= 10000:
            raise BenchError("BENCH_LIMIT_EXCEEDED", f"silence ms {ms} outside 1..10000")
        self.phase = "silenced"                              # the session ends here (spec B1 §7.4): only stop and describe follow
        r = self.bus.silence(ms)
        by_pos = sorted(range(self.n), key=lambda i: self.axes[i]["slavePosition"])
        axes = []
        for i, s in zip(by_pos, r["slaves"]):
            u, self.sw[i] = self.axes[i]["units"], s["statusword"]   # stop decides from what the slaves say now
            axes.append({"axisId": self.axes[i]["axisId"], "positionRad": position_from_raw(self.unwrap[i].update(s["positionRaw"]), u),
                         "velocityRadS": None if s["velocityRaw"] is None else velocity_from_raw(s["velocityRaw"], u)})
        return r | {"axes": axes}

    def _stop(self, payload):
        """Quick stop what is enabled and hold the ramp (stopseq), then disable voltage everywhere; the last controlword of every axis is 0x0000. The hold time
        bounds it (schema: quickStopHoldMs <= 4000, inside the 5 s ACK). Idempotent."""
        try:
            if self.phase in ("started", "silenced"):
                for _ in range(int(self.hold_ms // self.cycle_ms) + 2):
                    moving = [neutral_state(self.sw[i]) in (ENABLED, QUICK_STOP) for i in range(self.n)]   # also after silence: a slave that did not trip still runs
                    outs = [{"controlword": self._quick_stop_word(i) if moving[i] else 0x0000, "targetRaw": 0} for i in range(self.n)]
                    self._exchange(outs)
                    if not any(o["controlword"] for o in outs):
                        break
                else:
                    self._exchange([{"controlword": 0x0000, "targetRaw": 0}] * self.n)
        finally:
            self.phase = "stopped"
            self.bus.close()
        # the speed each axis had when its last word went out: at rest means the ramp was held, not cut into a coast; null when that exchange read nothing
        return {"controlwords": list(self.cw), "velocityRadS": [velocity_from_raw(x["velocityRaw"], a["units"]) if ok and x["velocityRaw"] is not None else None
                                                                for x, a, ok in zip(self.last, self.axes, self.read_ok)]}
