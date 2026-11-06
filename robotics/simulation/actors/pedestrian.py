"""Scripted pedestrians (SIM-05): a seeded schedule of poses/velocities on the fixed tick. Capsule-sized illustrative people, scripted
crossing/standing/occluded appearances; not a calibrated human-behaviour model. The schedule is what Gazebo is told; it proves nothing alone."""
import math
import random
from dataclasses import dataclass

TICK_S = 0.02


@dataclass(frozen=True)
class Trajectory:
    waypoints: tuple          # ((x, y), ...) in world metres; the actor dwells `dwell_ticks` at every waypoint before moving on
    speed_mps: float
    start_tick: int           # the actor is absent (not spawned at its pose) before this tick
    dwell_ticks: int
    loop: bool


def crossing(lane_x, y_from, y_to, speed_mps, start_tick):
    """Perpendicular crossing of a lane at x = lane_x."""
    return Trajectory(((lane_x, y_from), (lane_x, y_to)), speed_mps, start_tick, 0, False)


def standing(x, y, start_tick, dwell_ticks, leave_to, speed_mps):
    """Appears at (x, y), stands `dwell_ticks`, then walks away to `leave_to`."""
    return Trajectory(((x, y), tuple(leave_to)), speed_mps, start_tick, dwell_ticks, False)


class ActorSchedule:
    def __init__(self, seed, actor_id, trajectory, height_m=1.7, radius_m=0.2, dwell_jitter_ticks=0, tick_s=TICK_S):
        t = trajectory
        if len(t.waypoints) < 2 or not (t.speed_mps > 0) or t.start_tick < 0 or t.dwell_ticks < 0 or any(len(w) != 2 or not all(math.isfinite(c) for c in w) for w in t.waypoints):
            raise ValueError("TRAJECTORY_INVALID")
        if not (height_m > 0) or not (radius_m > 0):
            raise ValueError("ACTOR_GEOMETRY_INVALID")
        rng = random.Random(f"{seed}:{actor_id}")
        self.seed, self.actor_id, self.trajectory, self.height_m, self.radius_m, self.tick_s = seed, actor_id, t, height_m, radius_m, tick_s
        self.dwell_ticks = max(0, t.dwell_ticks + (rng.randint(-dwell_jitter_ticks, dwell_jitter_ticks) if dwell_jitter_ticks else 0))
        self.model = f"actor_{actor_id}"
        self.provenance = {"heightM": "illustrative", "radiusM": "illustrative", "trajectory": "scripted"}
        # timeline of (phase, duration_ticks): dwell at wp0, travel 0->1, dwell at wp1, travel 1->2, ...
        self._phases = []
        for i, wp in enumerate(t.waypoints):
            self._phases.append(("dwell", i, self.dwell_ticks))
            if i + 1 < len(t.waypoints):
                d = math.dist(wp, t.waypoints[i + 1])
                self._phases.append(("move", i, d / (t.speed_mps * tick_s)))
        self._cycle = sum(p[2] for p in self._phases)

    def _locate(self, tick):
        """-> (position, direction unit vector, moving). None before start."""
        t = self.trajectory
        if tick < t.start_tick:
            return None
        elapsed = float(tick - t.start_tick)
        if t.loop and self._cycle > 0:
            elapsed = elapsed % self._cycle
        last_dir = (0.0, 0.0)
        for phase, i, duration in self._phases:
            a = t.waypoints[i]
            if phase == "move":
                b = t.waypoints[i + 1]
                d = math.dist(a, b)
                direction = ((b[0] - a[0]) / d, (b[1] - a[1]) / d) if d > 0 else last_dir
                last_dir = direction
                if elapsed < duration:
                    f = elapsed / duration
                    return ((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f), direction, True)
            elif elapsed < duration:
                nxt = t.waypoints[i + 1] if i + 1 < len(t.waypoints) else None
                if nxt is not None and math.dist(a, nxt) > 0:
                    last_dir = ((nxt[0] - a[0]) / math.dist(a, nxt), (nxt[1] - a[1]) / math.dist(a, nxt))
                return (a, last_dir, False)
            elapsed -= duration
        return (t.waypoints[-1], last_dir, False)

    def pose_at(self, tick):
        state = self._locate(tick)
        if state is None:
            return None
        (x, y), (dx, dy), _ = state
        return (x, y, math.atan2(dy, dx))

    def command_at(self, tick):
        """Velocity command for the actor model at this tick (zero when absent, dwelling or done)."""
        state = self._locate(tick)
        if state is None or not state[2]:
            return {"model": self.model, "vx": 0.0, "vy": 0.0}
        (_, (dx, dy), _) = state
        return {"model": self.model, "vx": dx * self.trajectory.speed_mps, "vy": dy * self.trajectory.speed_mps}
