"""Pure geometry for the Gazebo scenarios (no ROS): footprint clearance between oriented rectangles."""
import math


def corners(x, y, yaw, half):
    c, s = math.cos(yaw), math.sin(yaw)
    return [(x + c * i - s * j, y + s * i + c * j) for i, j in ((half[0], half[1]), (-half[0], half[1]), (-half[0], -half[1]), (half[0], -half[1]))]


def footprint_gap(a, b):
    """Distance between two convex quads (0.0 when they overlap): separating-axis test, else the smallest vertex-edge distance."""
    def normals(poly):
        return [(-(poly[(k + 1) % 4][1] - poly[k][1]), poly[(k + 1) % 4][0] - poly[k][0]) for k in range(4)]

    def separated(n):
        pa, pb = [p[0] * n[0] + p[1] * n[1] for p in a], [p[0] * n[0] + p[1] * n[1] for p in b]
        return max(pa) < min(pb) or max(pb) < min(pa)

    if not any(separated(n) for n in normals(a) + normals(b)):
        return 0.0

    def seg(p, q, r):
        dx, dy = r[0] - q[0], r[1] - q[1]
        t = max(0.0, min(1.0, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / (dx * dx + dy * dy)))
        return math.dist(p, (q[0] + t * dx, q[1] + t * dy))

    return min(min(seg(v, e[k], e[(k + 1) % 4]) for v in o for k in range(4)) for o, e in ((a, b), (b, a)))
