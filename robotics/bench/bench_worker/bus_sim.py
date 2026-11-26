"""SimBus: simulated EtherCAT CiA 402 slaves, a `protocol_double` (spec B1 §3). Standard library only; knows nothing about the wire or the neutral states.

It is configured only through the kit's `simSlave` object (ruling R4); every knob has a default:

    defaultRxPdo        RxPDO mapping the slaves boot with (kit fixtures: DC kit has 60FF:00, AC kit has not)
    requiresDc          the slaves refuse SAFE-OP -> OP unless bus.sync is 'dc_sync0' (BENCH_NOT_OPERATIONAL)
    enableDelayCycles   5     cycles of 'enable operation' in Switched on before Operation enabled
    quickStopOption     2     605Ah: 1-3 leave Quick stop active for Switch on disabled once at rest; 5-8 stay in Quick stop active
    quickStopResume     true  in Quick stop active with 605Ah 5-8, 'enable operation' returns to Operation enabled (transition 16); false = the drive lacks it
    quickStopDecelRawPerCycle 2000  the quick-stop ramp (5 rad/s = 104 304 raw takes 52 cycles, about 10 ticks)
                              Torque removed while moving (Operation enabled or Quick stop active left for Switch on disabled, Ready to switch on or Switched on
                              with |v| >= REST_RAW) makes the motor freewheel (500 ms decay) and sets `slaves[i].coasted_while_moving`
    motorPower          true  false = the slaves start without motor power (restore_power brings it)
    powerLossFaults     true  motor power lost above Switch on disabled: Fault 0x3220; false = the drive drops to Switch on disabled without an error
    watchdogMs          100   slave-side watchdog: this long without a frame -> AL SAFE-OP (0x001B) and Fault 0x8130; null = never trips
    velocityScale       1.0   the slave tracks targetRaw x scale (0.8 = 20 % low)
    ignoreQuickStop     false the slave ignores the quick stop command in Operation enabled
    serials             ["SIM-0001", "SIM-0002"]  one slave per serial (the slave count is their number)
    initialErrorCode    null  a code: every slave boots in Fault with that 603Fh
    initialPositionRaw  0     6064h at power-on (to cross the int32 wrap)
    corruptReadback     null  an object ('6072:00', '1600:02', ...) whose SDO read returns the written value + 0x100 (a mapping entry reads back another subindex)
    events              []    [{atCycle, do, ...}] applied before exchange number atCycle (0 = the first after start):
                              inject_error {position, code} | force_velocity {position, rawVelocity|null} | wkc_loss {cycles} | cut_power {logic: bool}
                              | restore_power {} (motor power only)

The same knobs are Python attributes/methods for the bench's own tests (`writes`, `corrupt_readback`, `inject_error`, `force_velocity`, `wkc_loss`, `cut_power`);
the events call those methods, so both routes share one implementation. All numbers are `assumed`.
"""
from . import BenchError

VENDOR_ID, PRODUCT_CODE = 0x53494D00, 0x00000001
SW = {"NRTSO": 0x0000, "SOD": 0x0040, "RTSO": 0x0021, "SO": 0x0023, "OE": 0x0027, "QSA": 0x0007, "FRA": 0x000F, "F": 0x0008}
REMOTE = 0x0200                    # bit 9, outside every mask of the state table
TAU_MS = 20.0                      # assumed: first-order velocity response of the simulated loop
REST_RAW = 20                      # assumed: below this |velocity| (raw/s) a quick stop is complete
WATCHDOG_ERROR, UNDERVOLTAGE = 0x8130, 0x3220
BITS = {"6040:00": 16, "6041:00": 16, "6060:00": 8, "6061:00": 8, "6072:00": 16, "6077:00": 16, "603F:00": 16, "60B8:00": 16}
COAST_TAU_MS = 500.0               # assumed: a coasting rotor, power stage off
DEFAULTS = {"motorPower": True, "powerLossFaults": True, "quickStopResume": True, "quickStopDecelRawPerCycle": 2000, "enableDelayCycles": 5, "quickStopOption": 2, "watchdogMs": 100, "velocityScale": 1.0, "ignoreQuickStop": False, "serials": ["SIM-0001", "SIM-0002"],
            "initialErrorCode": None, "initialPositionRaw": 0, "corruptReadback": None, "events": []}
DEFAULT_TX = ["6041:00", "6064:00", "606C:00"]


def _entry(obj):
    return int(obj[:4], 16) << 16 | int(obj[5:7], 16) << 8 | BITS.get(obj.upper(), 32)


class _Slave:
    def __init__(self, serial, cfg):
        self.serial = serial
        self.state = "F" if cfg["initialErrorCode"] else "SOD"
        self.error = cfg["initialErrorCode"] or 0
        self.pending = None
        self.pos, self.vel, self.target = float(cfg["initialPositionRaw"]), 0.0, 0
        self.forced = None
        self.coasting = self.coasted_while_moving = False
        self.last_cw, self.enable_count = 0, 0
        self.od = {}


class SimBus:
    def __init__(self, kit):
        self.cfg = cfg = DEFAULTS | kit.get("simSlave", {})
        self.slaves = [_Slave(s, cfg) for s in cfg["serials"]]
        for s in self.slaves:
            self._load_map(s, "1600", cfg["defaultRxPdo"])
            self._load_map(s, "1A00", DEFAULT_TX)
        self.writes = []
        self.corrupt_readback = cfg["corruptReadback"]
        self.events = sorted(cfg["events"], key=lambda e: e["atCycle"])
        self.al_state, self.al_status = "INIT", 0
        self.cycle_ms, self.cycle, self.lost, self.logic, self.power, self.silent_ms = None, 0, 0, True, cfg["motorPower"], 0.0

    # ---- mailbox ----
    def _load_map(self, s, idx, objs):
        s.od[f"{idx}:00"] = len(objs)
        for k, o in enumerate(objs, 1):
            s.od[f"{idx}:{k:02X}"] = _entry(o)

    def scan(self):
        self.al_state = "PRE-OP"
        return [{"position": i, "vendorId": VENDOR_ID, "productCode": PRODUCT_CODE, "revision": 1, "serial": s.serial, "name": "MEKONIQ simulated CiA 402 slave"}
                for i, s in enumerate(self.slaves, 1)]

    def sdo_read(self, position, obj, size):
        v = self.slaves[position - 1].od.get(obj, 0)
        return v + 0x100 if obj == self.corrupt_readback else v

    def sdo_write(self, position, obj, value, size):
        self.writes.append((position, obj, value))
        self.slaves[position - 1].od[obj] = value

    def map_pdo(self, position, rx, tx):
        if self.al_state != "PRE-OP":
            raise BenchError("BENCH_PDO_MAP_REFUSED", f"slave {position} is in {self.al_state}, mapping needs PRE-OP")
        for sm, idx, objs in (("1C12", "1600", rx), ("1C13", "1A00", tx)):
            self.sdo_write(position, f"{sm}:00", 0, 1)
            self.sdo_write(position, f"{idx}:00", 0, 1)
            for k, o in enumerate(objs, 1):
                self.sdo_write(position, f"{idx}:{k:02X}", _entry(o), 4)
            self.sdo_write(position, f"{idx}:00", len(objs), 1)
            self.sdo_write(position, f"{sm}:01", int(idx, 16), 2)
            self.sdo_write(position, f"{sm}:00", 1, 1)

    def start(self, cycle_ms, sync):
        if self.cfg["requiresDc"] and sync != "dc_sync0":
            self.al_state, self.al_status = "SAFE-OP", 0x0030
            raise BenchError("BENCH_NOT_OPERATIONAL", f"SAFE-OP -> OP refused, AL status 0x0030 (invalid DC SYNC configuration) with sync {sync}")
        self.al_state, self.cycle_ms = "OP", cycle_ms

    # ---- the simulation knobs (also reached through simSlave.events) ----
    def inject_error(self, position, code):
        self.slaves[position - 1].pending = code

    def force_velocity(self, position, raw_velocity):
        self.slaves[position - 1].forced = raw_velocity

    def wkc_loss(self, cycles):
        self.lost = max(self.lost, cycles)

    def cut_power(self, logic=False):
        self.power = False
        if logic:                                            # the slave is gone from the bus and its power stage is off
            self.logic = False
            for s in self.slaves:
                s.state, s.target = "NRTSO", 0

    def restore_power(self):
        self.power = True

    def _event(self, e):
        do = e["do"]
        if do == "inject_error":
            self.inject_error(e["position"], e["code"])
        elif do == "force_velocity":
            self.force_velocity(e["position"], e["rawVelocity"])
        elif do == "wkc_loss":
            self.wkc_loss(e["cycles"])
        elif do == "cut_power":
            self.cut_power(e["logic"])
        elif do == "restore_power":
            self.restore_power()
        else:
            raise ValueError(f"unknown simSlave event {do!r}")

    # ---- cyclic ----
    def _rx(self, s):
        return [f"{s.od[f'1600:{k:02X}'] >> 16:04X}:{s.od[f'1600:{k:02X}'] >> 8 & 0xFF:02X}" for k in range(1, s.od["1600:00"] + 1)]

    def _apply(self, s, cw):
        """One CiA 402 state machine step on the received controlword."""
        st, rising_reset = s.state, cw & 0x80 and not s.last_cw & 0x80
        if not self.power and st in ("RTSO", "SO", "OE", "QSA") and s.pending is None:
            if self.cfg["powerLossFaults"]:
                s.pending = UNDERVOLTAGE
            else:
                st = "SOD"
        if s.pending is not None and st not in ("FRA", "F"):
            st, s.error, s.pending = "FRA", s.pending, None
        elif st == "FRA":
            st = "F"
        elif st == "F":
            if rising_reset:
                st, s.error = "SOD", 0
        elif not cw & 0x02:                                  # disable voltage
            st = "SOD"
        elif not cw & 0x04:                                  # quick stop
            if st == "OE" and not self.cfg["ignoreQuickStop"]:
                st = "QSA"
            elif st in ("RTSO", "SO"):
                st = "SOD"
        elif st == "QSA":
            if self.cfg["quickStopOption"] in (5, 6, 7, 8) and self.cfg["quickStopResume"] and cw & 0x8F == 0x0F:
                st = "OE"                                    # transition 16
        elif cw & 0x87 == 0x06:                              # shutdown
            if st in ("SOD", "SO", "OE") and self.power:
                st = "RTSO"
        elif cw & 0x8F == 0x07:                              # switch on / disable operation
            if st in ("RTSO", "OE"):
                st = "SO"
        elif cw & 0x8F == 0x0F and st == "SO":               # enable operation
            s.enable_count += 1
            if s.enable_count >= self.cfg["enableDelayCycles"]:
                st = "OE"
        if st != "SO":
            s.enable_count = 0
        if s.state in ("OE", "QSA") and st in ("SOD", "RTSO", "SO") and abs(s.vel) >= REST_RAW:
            s.coasting = s.coasted_while_moving = True       # torque removed while moving: the rotor freewheels
        if st == "QSA" and self.cfg["quickStopOption"] in (1, 2, 3) and abs(s.vel) < REST_RAW:
            st = "SOD"
        s.state, s.last_cw = st, cw

    def _move(self, s, ms):
        if s.state == "QSA":
            step = self.cfg["quickStopDecelRawPerCycle"] * ms / self.cycle_ms
            s.vel -= max(-step, min(step, s.vel))
        else:
            want = s.target * self.cfg["velocityScale"] if s.state == "OE" else 0.0
            tau = COAST_TAU_MS if s.coasting and s.state != "OE" else TAU_MS
            s.vel += (want - s.vel) * min(1.0, ms / tau)
        s.coasting = s.coasting and abs(s.vel) >= REST_RAW
        if s.forced is not None:
            s.vel = float(s.forced)
        s.pos += s.vel * ms / 1000

    def _starve(self, ms):
        """Time without a frame reaching the slaves: the slave watchdog."""
        self.silent_ms += ms
        wd = self.cfg["watchdogMs"]
        if wd is not None and self.silent_ms >= wd and self.al_state == "OP" and self.logic:
            self.al_state, self.al_status = "SAFE-OP", 0x001B
            for s in self.slaves:
                if s.state not in ("FRA", "F"):
                    s.pending = WATCHDOG_ERROR
                s.target = 0
                self._apply(s, s.last_cw)

    def _inputs(self, s, ok):
        tx = {f"{s.od[f'1A00:{k:02X}'] >> 16:04X}:00" for k in range(1, s.od["1A00:00"] + 1)}
        wrapped = (round(s.pos) + 2**31) % 2**32 - 2**31
        return {"statusword": (SW[s.state] | REMOTE) if self.logic else 0, "positionRaw": wrapped, "velocityRaw": round(s.vel),
                "torqueRaw": 0 if "6077:00" in tx else None, "errorCode": s.error, "wkcOk": ok}

    def exchange(self, outputs):
        while self.events and self.events[0]["atCycle"] <= self.cycle:
            self._event(self.events.pop(0))
        self.cycle += 1
        reached = self.logic and self.lost == 0
        self.lost = max(0, self.lost - 1)
        if reached:
            self.silent_ms = 0.0
        else:
            self._starve(self.cycle_ms)
        ok = reached and self.al_state == "OP"
        for s, out in zip(self.slaves, outputs):
            if ok:
                s.target = out["targetRaw"] if "60FF:00" in self._rx(s) else 0
                self._apply(s, out["controlword"])
            elif s.state == "FRA" or s.pending is not None:
                self._apply(s, s.last_cw)
            self._move(s, self.cycle_ms)
        return [self._inputs(s, ok) for s in self.slaves]

    def silence(self, ms):
        for _ in range(max(1, round(ms / self.cycle_ms))):
            self._starve(self.cycle_ms)
            for s in self.slaves:
                if s.state == "FRA":
                    self._apply(s, s.last_cw)
                self._move(s, self.cycle_ms)
        return {"alState": self.al_state, "alStatusCode": self.al_status,
                "slaves": [{k: v for k, v in self._inputs(s, False).items() if k in ("statusword", "errorCode", "positionRaw", "velocityRaw")} for s in self.slaves]}

    def close(self):
        if self.al_state == "OP":
            self.al_state = "SAFE-OP"
