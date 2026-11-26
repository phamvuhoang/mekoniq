"""Writes the two synthetic byte streams of the sensors role into bytes/ (python3 -I -B make_bytes.py). Deterministic: no clock, no random module; the committed .bin
files must equal ld19_bytes() / wit_bytes() byte for byte (tests/hardware/test_bench_sensors.py). Generator output, never a measurement.

ld19-synth.bin: 100 valid LD19 frames; the first angle grows 12 x 0.8 deg = 9.6 deg a frame, every point is 1000 mm at intensity 200, 3600 deg/s (10 Hz).
wit-synth.bin: 300 WitMotion frames, types 0x51, 0x52, 0x53 in turn: at rest (1 g on z), a few counts of gyro noise, yaw constant (the file is replayed in a loop, so a ramp would have a seam)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bench_worker.lidar_ld19 import crc8   # noqa: E402

OUT = Path(__file__).resolve().parent / "bytes"


def ld19_bytes(n: int = 100) -> bytes:
    out = bytearray()
    for k in range(n):
        start = k * 960 % 36000
        body = bytes([0x54, 0x2C]) + (3600).to_bytes(2, "little") + start.to_bytes(2, "little") + b"".join((1000).to_bytes(2, "little") + bytes([200]) for _ in range(12)) \
            + ((start + 880) % 36000).to_bytes(2, "little") + (k * 8 // 3 % 30000).to_bytes(2, "little")
        out += body + bytes([crc8(body)])
    return bytes(out)


def wit_bytes(n: int = 100) -> bytes:
    out, x = bytearray(), 1
    for k in range(n):
        for kind in (0x51, 0x52, 0x53):
            x = (x * 1103515245 + 12345) & 0x7FFFFFFF   # fixed LCG: counts of noise, not a model of any sensor
            noise = [(x >> s) % 5 - 2 for s in (8, 12, 16)]
            vals = {0x51: [noise[0], noise[1], 2048 + noise[2], 0], 0x52: [noise[0], noise[1], noise[2], 0], 0x53: [0, 0, 100, 0]}[kind]
            body = bytes([0x55, kind]) + b"".join((v & 0xFFFF).to_bytes(2, "little") for v in vals)
            out += body + bytes([sum(body) & 0xFF])
    return bytes(out)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    (OUT / "ld19-synth.bin").write_bytes(ld19_bytes())
    (OUT / "wit-synth.bin").write_bytes(wit_bytes())
