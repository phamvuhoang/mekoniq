"""Raw drive units <-> SI (spec B1 §5.3). `units` is one axis' `units` of the kit; the polarity is applied here and nowhere else."""
import math


def velocity_to_raw(rad_s: float, units: dict) -> int:
    return round(rad_s * units["velocityRawPerRadS"]["value"] * units["polarity"])


def velocity_from_raw(raw: int, units: dict) -> float:
    return raw / units["velocityRawPerRadS"]["value"] * units["polarity"]


def position_from_raw(unwrapped: int, units: dict) -> float:
    return unwrapped * 2 * math.pi / units["positionCountsPerRev"]["value"] * units["polarity"]


def torque_from_raw(permille, units: dict):
    rated = units.get("ratedTorqueNm")
    return None if permille is None or rated is None else permille / 1000 * rated["value"]


class Unwrap32:
    """6064h is an int32 that wraps; the unwrapped value accumulates the modulo-2**32 difference between two reads (the first read anchors it)."""

    def __init__(self):
        self.last = self.total = None

    def update(self, raw: int) -> int:
        if self.last is None:
            self.total = raw
        else:
            self.total += (raw - self.last + 2**31) % 2**32 - 2**31
        self.last = raw
        return self.total
