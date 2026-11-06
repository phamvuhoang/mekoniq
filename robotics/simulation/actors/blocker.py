"""Static blockers (FD04): a box model parked outside the world that is placed on its rectangle for a tick window, then parked again. Each
placement is issued once; the run's fault log records the window as `blocker-on` / `blocker-off`."""
import math
import re

ID = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")
PARK = (-5.0, -5.0)


class BlockerSchedule:
    def __init__(self, blockers):
        self.blockers = []
        for b in blockers:
            ok = (isinstance(b.get("id"), str) and ID.match(b["id"]) and all(isinstance(b.get(k), (int, float)) and math.isfinite(b[k]) for k in ("x", "y", "width", "height", "heightM"))
                  and b["width"] > 0 and b["height"] > 0 and b["heightM"] > 0 and isinstance(b.get("atTick"), int) and b["atTick"] >= 0
                  and (b.get("untilTick") is None or (isinstance(b["untilTick"], int) and b["untilTick"] > b["atTick"])))
            if not ok:
                raise ValueError(f"BLOCKER_INVALID: {b.get('id')}")
            self.blockers.append(dict(b))
        self._placed = set()

    @staticmethod
    def model(b):
        return f"blocker_{b['id']}"

    def _on(self, b, tick):
        return b["atTick"] <= tick and (b.get("untilTick") is None or tick < b["untilTick"])

    def active(self, tick):
        return [b["id"] for b in self.blockers if self._on(b, tick)]

    def pose_commands(self, tick):
        out = []
        for b in self.blockers:
            on, placed = self._on(b, tick), b["id"] in self._placed
            if on and not placed:
                self._placed.add(b["id"])
                out.append({"model": self.model(b), "x": b["x"] + b["width"] / 2, "y": b["y"] + b["height"] / 2, "z": b["heightM"] / 2})
            elif not on and placed:
                self._placed.discard(b["id"])
                out.append({"model": self.model(b), "x": PARK[0], "y": PARK[1], "z": b["heightM"] / 2})
        return out

    def models(self):
        return [{"id": b["id"], "gazeboModel": self.model(b), "rect": [b["x"], b["y"], b["width"], b["height"]], "heightM": b["heightM"],
                 "window": {"atTick": b["atTick"], "untilTick": b.get("untilTick")}} for b in self.blockers]
