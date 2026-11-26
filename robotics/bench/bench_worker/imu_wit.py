"""WitMotion standard-protocol frame reader: pure functions over a bytearray, standard library only (spec B1 §7.6; contracts §2.4).

Frame (SDK `WitSerialDataIn`, wit_c_sdk.c): 11 bytes = 0x55, type, four little-endian int16, checksum = low byte of the sum of the first 10. A wrong first byte or a wrong
checksum drops ONE byte and tries again, as the SDK does. Scales (the SDK demo main.c): acceleration raw/32768 x 16 g, gyro raw/32768 x 2000 deg/s, angle raw/32768 x 180 deg.
Pinned in fixtures/bytes/README.md."""
import math
import struct

FRAME_LEN = 11
G = 9.80665
_FRAME = struct.Struct("<BB4h")


def parse(buf: bytearray):
    """Consumes `buf` in place. Returns ([{type, values: [int16 x 4]}], bytes dropped); an incomplete tail stays. Never raises."""
    frames, dropped, i = [], 0, 0
    while len(buf) - i >= FRAME_LEN:
        if buf[i] != 0x55 or sum(buf[i:i + FRAME_LEN - 1]) & 0xFF != buf[i + FRAME_LEN - 1]:
            dropped, i = dropped + 1, i + 1
            continue
        v = _FRAME.unpack_from(buf, i)
        frames.append({"type": v[1], "values": list(v[2:])})
        i += FRAME_LEN
    while i < len(buf) and buf[i] != 0x55:   # a short tail that cannot be a header start is junk now, not later
        dropped, i = dropped + 1, i + 1
    del buf[:i]
    return frames, dropped


def scale(frame: dict):
    """0x51 -> {accelMps2}, 0x52 -> {gyroRadS}, 0x53 -> {rpyRad}; any other type (time, magnetometer, quaternion ...) None."""
    v, t = frame["values"][:3], frame["type"]
    if t == 0x51:
        return {"accelMps2": [x / 32768 * 16 * G for x in v]}
    if t == 0x52:
        return {"gyroRadS": [math.radians(x / 32768 * 2000) for x in v]}
    if t == 0x53:
        return {"rpyRad": [math.radians(x / 32768 * 180) for x in v]}
    return None
