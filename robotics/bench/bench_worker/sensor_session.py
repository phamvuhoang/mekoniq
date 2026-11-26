"""One sensors session (role `sensors`, spec B1 §3, K06): the ops `describe`, `open`, `step`, `imuConfigure`, `stop`; any other op is BENCH_ORDER_VIOLATION. It never
commands a drive: `step` takes `{"commands": []}` and nothing else. On the simulated backend the sensor bytes are files replayed by tick count (kit `simSlave.sensorBytes`
{lidar, imu}, paths relative to the kit file; optional `simSlave.sensorCorruptEvery` N flips a bit in every Nth frame, for negative tests); the serial backend comes with
the hardware tasks. Each `step` ACK carries the frames decoded in that tick and the bytes the decoder dropped.

Replay rates (generator figures, ponytail: fixed): the LD19 sends 4500 points a second = 375 frames a second = 7.5 frames a 20 ms tick (705 bytes every 2 ticks); the IMU
at 100 Hz with three frame types = 6 frames = 66 bytes a tick. Imports no bus module: the bus role imports no sensor module either (a test starts both and checks)."""
import os
import platform

from . import BenchError, imu_wit, lidar_ld19

WORKER_VERSION = "1.0.0"
OPS = ("describe", "open", "step", "imuConfigure", "stop")
MAX_BYTES_FILE = 8 << 20
IMU_BYTES_PER_TICK = 66
ALGORITHMS = ("6axis", "9axis")


class _Replay:
    """A byte file played in a loop; every `corrupt_every`-th frame (counted in the stream, frame-aligned files) gets one bit flipped in its middle."""

    def __init__(self, path, frame_len, corrupt_every):
        try:
            if os.path.getsize(path) > MAX_BYTES_FILE or not os.path.isfile(path):
                raise OSError("not a regular file of at most 8 MiB")
            with open(path, "rb") as f:
                self.data = f.read()
            if not self.data:
                raise OSError("empty")
        except OSError as e:
            raise BenchError("BENCH_SENSOR_BYTES_INVALID", f"{path}: {e}")
        self.frame_len, self.every, self.pos = frame_len, corrupt_every, 0

    def take(self, n):
        out, size = bytearray(), len(self.data)
        for p in range(self.pos, self.pos + n):
            b = self.data[p % size]
            if self.every and p // self.frame_len % self.every == self.every - 1 and p % self.frame_len == self.frame_len // 2:
                b ^= 0x01
            out.append(b)
        self.pos += n
        return out


class SensorSession:
    def __init__(self, kit: dict, kit_dir: str, *, read_only: bool):
        self.kit, self.kit_dir, self.read_only = kit, kit_dir, read_only
        sim = kit.get("simSlave") or {}
        self.sources, self.every = sim.get("sensorBytes") or {}, sim.get("sensorCorruptEvery") or 0
        self.phase, self.tick, self.imu_config = "new", 0, None
        self.replay, self.buf, self.last = {}, {"lidar": bytearray(), "imu": bytearray()}, {}

    def handle(self, op: str, payload: dict, expected_tick: int) -> dict:
        if op not in OPS:
            raise BenchError("BENCH_ORDER_VIOLATION", f"{op} is an op of the bus role")
        if self.read_only and op == "imuConfigure":
            raise BenchError("BENCH_READ_ONLY", "imuConfigure in a read-only session")
        if op == "open" and self.phase != "new" or op in ("step", "imuConfigure") and self.phase != "open":
            raise BenchError("BENCH_ORDER_VIOLATION", f"{op} in phase {self.phase}")
        if op == "step" and (expected_tick != self.tick or payload.get("commands")):
            raise BenchError("BENCH_ORDER_VIOLATION", f"expectedTick {expected_tick} (the session is at {self.tick}) or drive commands sent to the sensors role")
        return getattr(self, f"_{op}")(payload)

    def _describe(self, payload):
        return {"protocol": "mekoniq-bench/1", "role": "sensors", "backend": self.kit["bus"]["backend"], "kitId": self.kit["id"], "kitDigest": self.kit["digest"],
                "readOnly": self.read_only, "phase": self.phase, "lockDigest": None, "version": WORKER_VERSION, "python": platform.python_version(), "pysoem": None,
                "sensors": {k: k in self.sources for k in ("lidar", "imu")}}

    def _open(self, payload):
        for name, frame_len in (("lidar", lidar_ld19.FRAME_LEN), ("imu", imu_wit.FRAME_LEN)):
            if name in self.sources:
                self.replay[name] = _Replay(os.path.join(self.kit_dir, self.sources[name]), frame_len, self.every)
        self.phase = "open"
        return {"interface": None}

    def _imuConfigure(self, payload):
        b, r, a = payload.get("baud"), payload.get("rateHz"), payload.get("algorithm")
        if not (isinstance(b, int) and not isinstance(b, bool) and b > 0 and isinstance(r, (int, float)) and not isinstance(r, bool) and r > 0 and a in ALGORITHMS):
            raise BenchError("BENCH_ORDER_VIOLATION", "imuConfigure needs baud (int), rateHz (> 0) and algorithm (6axis | 9axis)")
        self.imu_config = {"baud": b, "rateHz": r, "algorithm": a}   # ponytail: recorded only; the serial writes (FF AA reg lo hi) come with the hardware tasks
        return dict(self.imu_config)

    def _step(self, payload):
        out = {"lidar": {"frames": [], "droppedBytes": 0}, "imu": {"samples": [], "droppedBytes": 0}}
        if "lidar" in self.replay:
            t = self.tick
            self.buf["lidar"] += self.replay["lidar"].take(705 * (t + 1) // 2 - 705 * t // 2)
            out["lidar"]["frames"], out["lidar"]["droppedBytes"] = lidar_ld19.parse(self.buf["lidar"])
        if "imu" in self.replay:
            self.buf["imu"] += self.replay["imu"].take(IMU_BYTES_PER_TICK)
            frames, out["imu"]["droppedBytes"] = imu_wit.parse(self.buf["imu"])
            for f in frames:   # a sample is complete at the angle frame, with the acceleration and gyro frames that came before it
                s = imu_wit.scale(f)
                if s:
                    self.last.update(s)
                    if "rpyRad" in s and len(self.last) == 3:
                        out["imu"]["samples"].append({k: list(self.last[k]) for k in ("accelMps2", "gyroRadS", "rpyRad")})
        self.tick += 1
        return out

    def _stop(self, payload):
        self.phase = "stopped"
        return {}
