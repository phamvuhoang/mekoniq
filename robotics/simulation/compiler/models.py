"""Validated world model. Project v2 (lab-project-v2 schema) + AssetRevision JSON (asset-revision schema) -> SI shapes in each asset's root frame,
robot footprints, walls, bindings. Every failure is a CompileError with a code; nothing is guessed from missing data."""
import hashlib
import math
import re
from dataclasses import dataclass, field

import rfc8785

ID = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")
WALL_THICKNESS_M, WALL_HEIGHT_M = 0.1, 2.0
HANDOFF_MARGIN_M = 0.1
DEFAULT_FIXTURE_HEIGHT_M = 0.75
QUATERNION_TOLERANCE = 1e-6


class CompileError(ValueError):
    def __init__(self, code, detail=None):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code, self.detail = code, detail


def _finite(*values):
    return all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in values)


# ---- quaternion [x, y, z, w], Hamilton; poses are (position, quaternion) in the asset root frame ----
def qmul(a, b):
    return (a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2])


def qrotate(q, v):
    t = (2 * (q[1] * v[2] - q[2] * v[1]), 2 * (q[2] * v[0] - q[0] * v[2]), 2 * (q[0] * v[1] - q[1] * v[0]))
    return (v[0] + q[3] * t[0] + q[1] * t[2] - q[2] * t[1], v[1] + q[3] * t[1] + q[2] * t[0] - q[0] * t[2], v[2] + q[3] * t[2] + q[0] * t[1] - q[1] * t[0])


def check_quaternion(q, where):
    if not isinstance(q, list) or len(q) != 4 or not _finite(*q) or abs(math.sqrt(sum(c * c for c in q)) - 1) > QUATERNION_TOLERANCE:
        raise CompileError("QUATERNION_NOT_NORMALIZED", where)
    return tuple(q)


def compose(a, b):
    p = qrotate(a[1], b[0])
    q = qmul(a[1], b[1])
    n = math.sqrt(sum(c * c for c in q))
    return ((a[0][0] + p[0], a[0][1] + p[1], a[0][2] + p[2]), tuple(c / n for c in q))


def quat_to_rpy(q):
    x, y, z, w = q
    return (math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)), math.asin(max(-1.0, min(1.0, 2 * (w * y - z * x)))),
            math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))


def frame_poses(frames, where):
    """Root-frame pose of every frame: exactly one root, known parents, no cycles, normalized quaternions."""
    by_id = {}
    for f in frames:
        if not isinstance(f.get("id"), str) or not ID.match(f["id"]):
            raise CompileError("ID_INVALID", f"{where} frame {f.get('id')!r}")
        if f["id"] in by_id:
            raise CompileError("FRAME_DUPLICATE", f"{where}/{f['id']}")
        t = f.get("translationM")
        if not isinstance(t, list) or len(t) != 3 or not _finite(*t):
            raise CompileError("FRAME_NOT_FINITE", f"{where}/{f['id']}")
        check_quaternion(f.get("quaternionXyzw"), f"{where}/{f['id']}")
        by_id[f["id"]] = f
    roots = [f for f in frames if f["parentId"] is None]
    if len(roots) != 1:
        raise CompileError("FRAME_ROOT_COUNT", f"{where}: {len(roots)}")
    for f in frames:
        if f["parentId"] is not None and f["parentId"] not in by_id:
            raise CompileError("FRAME_PARENT_UNKNOWN", f"{where}/{f['id']} -> {f['parentId']}")
    poses = {roots[0]["id"]: ((0.0, 0.0, 0.0), (0.0, 0.0, 0.0, 1.0))}
    for start in frames:
        chain, cur = [], start
        while cur is not None and cur["id"] not in poses:
            if cur in chain:
                raise CompileError("FRAME_CYCLE", f"{where}/{cur['id']}")
            chain.append(cur)
            cur = by_id[cur["parentId"]]
        for f in reversed(chain):
            poses[f["id"]] = compose(poses[f["parentId"]], (tuple(f["translationM"]), tuple(f["quaternionXyzw"])))
    return roots[0]["id"], poses


@dataclass(frozen=True)
class Shape:
    kind: str
    frame_id: str
    dims: dict
    position: tuple
    quaternion: tuple

    def half_extents(self):
        """Axis-aligned half extents of the shape's bounding box in the root frame."""
        R = lambda v: qrotate(self.quaternion, v)
        if self.kind == "box":
            cols = [R((1, 0, 0)), R((0, 1, 0)), R((0, 0, 1))]
            return tuple(sum(abs(cols[i][k]) * self.dims["sizeM"][i] / 2 for i in range(3)) for k in range(3))
        if self.kind == "sphere":
            return (self.dims["radiusM"],) * 3
        ax = R((0, 0, 1))
        return tuple(self.dims["radiusM"] * math.sqrt(max(0.0, 1 - ax[k] ** 2)) + self.dims["heightM"] / 2 * abs(ax[k]) for k in range(3))


@dataclass
class CompiledAsset:
    revision: dict
    root_frame: str
    poses: dict
    shapes: list
    footprint: tuple        # (minx, miny, maxx, maxy) in the root frame
    radius_m: float         # circumscribed footprint radius about the root origin
    mass_kg: float | None
    mass_provenance: str | None
    height_m: float

    @property
    def ref(self):
        return {"id": self.revision["id"], "revision": self.revision["revision"], "contentHash": self.revision["contentHash"]}


def compile_asset(asset):
    where = str(asset.get("id"))
    if not isinstance(asset.get("id"), str) or not ID.match(asset["id"]):
        raise CompileError("ID_INVALID", f"asset {asset.get('id')!r}")
    if not isinstance(asset.get("contentHash"), str) or asset["contentHash"] != hashlib.sha256(rfc8785.dumps({k: v for k, v in asset.items() if k != "contentHash"})).hexdigest():
        raise CompileError("ASSET_HASH_MISMATCH", where)
    root, poses = frame_poses(asset.get("frames") or [], where)
    shapes = []
    for g in asset.get("geometry") or []:
        if g.get("frameId") not in poses:
            raise CompileError("FRAME_UNKNOWN", f"{where}/{g.get('frameId')}")
        dims = {k: v for k, v in g.items() if k not in ("kind", "frameId")}
        values = [x for v in dims.values() for x in (v if isinstance(v, list) else [v])]
        if g.get("kind") not in ("box", "cylinder", "sphere") or not values or not _finite(*values) or any(x <= 0 for x in values):
            raise CompileError("GEOMETRY_NOT_POSITIVE", f"{where}/{g.get('frameId')}")
        position, quaternion = poses[g["frameId"]]
        shapes.append(Shape(g["kind"], g["frameId"], dims, position, quaternion))
    lo = [math.inf] * 3
    hi = [-math.inf] * 3
    for s in shapes:
        h = s.half_extents()
        for k in range(3):
            lo[k], hi[k] = min(lo[k], s.position[k] - h[k]), max(hi[k], s.position[k] + h[k])
    footprint = (lo[0], lo[1], hi[0], hi[1]) if shapes else (0.0, 0.0, 0.0, 0.0)
    radius = max(math.hypot(x, y) for x in (lo[0], hi[0]) for y in (lo[1], hi[1])) if shapes else 0.0
    inertial = asset.get("inertial")
    mass = inertial.get("massKg") if isinstance(inertial, dict) else None
    provenance = next((p.get("source") for p in asset.get("provenance") or [] if p.get("parameter") == "inertial.massKg"), None)
    return CompiledAsset(asset, root, poses, shapes, footprint, radius, mass if _finite(mass) and mass > 0 else None, provenance, hi[2] if shapes else 0.0)


@dataclass
class Robot:
    entity_id: str
    namespace: str
    asset: CompiledAsset
    parking_id: str
    speed_limit_mps: float | None


@dataclass
class WorldModel:
    project: dict
    assets: list                      # asset revisions referenced by an entity, in entity-id order (deduplicated)
    robots: list
    walls: list                       # (x, y, w, h) rectangles, metres
    fixture_height_m: float
    fixture_asset: CompiledAsset | None
    assumptions: list = field(default_factory=list)

    @property
    def world(self):
        return self.project["world"]

    @classmethod
    def validate(cls, project, asset_revisions, fixture_height_m=DEFAULT_FIXTURE_HEIGHT_M):
        if not isinstance(project, dict) or not isinstance(project.get("world"), dict) or not isinstance(project.get("entities"), list):
            raise CompileError("PROJECT_INVALID")
        w = project["world"]
        if not _finite(w.get("width"), w.get("height")) or w["width"] <= 0 or w["height"] <= 0:
            raise CompileError("GEOMETRY_NOT_POSITIVE", "world")
        seen = set()
        for kind, items in (("point", w.get("points") or []), ("obstacle", w.get("obstacles") or []), ("entity", project["entities"])):
            for item in items:
                i = item.get("id")
                if not isinstance(i, str) or not ID.match(i) or i in (".", ".."):
                    raise CompileError("ID_INVALID", f"{kind} {i!r}")
                if i in seen:
                    raise CompileError("ID_DUPLICATE", i)
                seen.add(i)
        for o in w["obstacles"]:
            if not _finite(o.get("x"), o.get("y"), o.get("width"), o.get("height")):
                raise CompileError("GEOMETRY_NOT_FINITE", o["id"])
            if o["width"] <= 0 or o["height"] <= 0:
                raise CompileError("GEOMETRY_NOT_POSITIVE", o["id"])
            if o["x"] < 0 or o["y"] < 0 or o["x"] + o["width"] > w["width"] or o["y"] + o["height"] > w["height"]:
                raise CompileError("OBSTACLE_OUTSIDE_WORLD", o["id"])
        for p in w["points"]:
            if not _finite(p.get("x"), p.get("y")) or not (0 <= p["x"] <= w["width"] and 0 <= p["y"] <= w["height"]):
                raise CompileError("POINT_OUTSIDE_WORLD", p["id"])
        compiled = {}
        for a in asset_revisions:
            c = compile_asset(a)
            compiled[(c.revision["id"], c.revision["revision"], c.revision["contentHash"])] = c
        used, robots, namespaces = [], [], set()
        parking = sorted((p["id"] for p in w["points"] if p.get("kind") == "parking"))
        amrs = sorted((e for e in project["entities"] if e.get("kind") == "amr"), key=lambda e: e["id"])
        for e in project["entities"]:
            ref = e.get("assetRef") or {}
            asset = compiled.get((ref.get("id"), ref.get("revision"), ref.get("contentHash")))
            if asset is None:
                raise CompileError("ASSET_MISSING", f"{e['id']} -> {ref.get('id')}@{ref.get('revision')}")
            if asset.revision not in used:
                used.append(asset.revision)
        for i, e in enumerate(amrs):
            ref = e["assetRef"]
            asset = compiled[(ref["id"], ref["revision"], ref["contentHash"])]
            if not asset.shapes:
                raise CompileError("COLLISION_MISSING", e["id"])
            if asset.mass_kg is None:
                raise CompileError("MASS_MISSING", f"{e['id']}: inertial.massKg is required for a physics-simulated robot")
            ns = "robot_" + re.sub(r"[^a-z0-9]+", "_", e["id"].lower()).strip("_")
            if ns in namespaces:
                raise CompileError("NAMESPACE_DUPLICATE", ns)
            namespaces.add(ns)
            if i >= len(parking):
                raise CompileError("PARKING_MISSING", e["id"])
            robots.append(Robot(e["id"], ns, asset, parking[i], e.get("speedLimitMps")))
        fixture = next((c for c in compiled.values() if c.revision.get("kind") == "fixture" and c.revision in used or c.revision.get("kind") == "fixture"), None)
        height = fixture.height_m if fixture is not None else fixture_height_m
        W, H, t = w["width"], w["height"], WALL_THICKNESS_M
        walls = [(0.0, 0.0, t, H), (W - t, 0.0, t, H), (0.0, 0.0, W, t), (0.0, H - t, W, t)]
        model = cls(project, used, robots, walls, height, fixture)
        model.assumptions = [
            f"boundary walls {t} m thick and {WALL_HEIGHT_M} m high inside the world rectangle (illustrative)",
            f"project obstacles extruded from z=0 to {height} m ({'fixture asset ' + fixture.revision['id'] if fixture else 'compiler default'}; illustrative)",
            f"handoff pose for a table point inside its furniture: along the ray from the furniture centre to the nearest service point, offset by the largest robot radius + {HANDOFF_MARGIN_M} m margin; yaw faces the furniture centre",
            "visual geometry reuses the collision primitives: mesh blobs are referenced by hash but not bundled",
        ]
        return model

    # ---- clearance and bindings ----
    def rects(self):
        return self.walls + [(o["x"], o["y"], o["width"], o["height"]) for o in self.world["obstacles"]]

    @staticmethod
    def rect_distance(x, y, r):
        return math.hypot(x - max(r[0], min(x, r[0] + r[2])), y - max(r[1], min(y, r[1] + r[3])))

    def max_radius(self):
        return max((r.asset.radius_m for r in self.robots), default=0.0)

    def clearance(self, x, y):
        return min(self.rect_distance(x, y, r) for r in self.rects())

    def service_points(self):
        return [p for p in self.world["points"] if p.get("kind") in ("kitchen", "coffee_pickup")]

    def binding(self, point):
        w = self.world
        x, y, yaw = float(point["x"]), float(point["y"]), 0.0
        inside = next((o for o in w["obstacles"] if o["x"] <= x <= o["x"] + o["width"] and o["y"] <= y <= o["y"] + o["height"]), None)
        handoff = next((h for h in w.get("handoffPoints") or [] if h.get("id") == point["id"]), None)
        if inside is not None:
            cx, cy, hx, hy = inside["x"] + inside["width"] / 2, inside["y"] + inside["height"] / 2, inside["width"] / 2, inside["height"] / 2
            services = self.service_points()
            tx, ty = (services[0]["x"], services[0]["y"]) if services else (w["width"] / 2, w["height"] / 2)
            for s in services:
                if math.hypot(s["x"] - cx, s["y"] - cy) < math.hypot(tx - cx, ty - cy):
                    tx, ty = s["x"], s["y"]
            dx, dy = tx - cx, ty - cy
            norm = math.hypot(dx, dy) or 1.0
            ux, uy = dx / norm, dy / norm
            exit_t = min(hx / abs(ux) if ux else math.inf, hy / abs(uy) if uy else math.inf)
            offset = exit_t + self.max_radius() + HANDOFF_MARGIN_M
            x, y = cx + ux * offset, cy + uy * offset
            yaw = math.atan2(cy - y, cx - x)
        elif point.get("kind") == "table":
            near = min(w["obstacles"], key=lambda o: self.rect_distance(x, y, (o["x"], o["y"], o["width"], o["height"])), default=None)
            if near is not None and self.rect_distance(x, y, (near["x"], near["y"], near["width"], near["height"])) <= 1.5:
                yaw = math.atan2(near["y"] + near["height"] / 2 - y, near["x"] + near["width"] / 2 - x)
        if handoff is not None and _finite(handoff.get("yawRad")):
            yaw = float(handoff["yawRad"])
        return {"waypointId": point["id"], "kind": point.get("kind"), "x": x, "y": y, "yaw": yaw,
                "zone": {"radiusM": self.max_radius(), "clearanceM": self.clearance(x, y)}}

    def bindings(self):
        return {p["id"]: self.binding(p) for p in self.world["points"]}

    def assert_target_clearance(self):
        """Every bound pose must be inside the world and admit the largest robot footprint; never relaxed."""
        w = self.world
        for pid, b in self.bindings().items():
            if not (0 <= b["x"] <= w["width"] and 0 <= b["y"] <= w["height"]) or b["zone"]["clearanceM"] < b["zone"]["radiusM"]:
                raise CompileError("TARGET_CLEARANCE", f"{pid}: clearance {b['zone']['clearanceM']:.3f} m < footprint radius {b['zone']['radiusM']:.3f} m")
