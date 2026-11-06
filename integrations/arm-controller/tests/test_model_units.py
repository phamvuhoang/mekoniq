"""A01: model/unit contract of the pinned PUMA 560 reference (LinuxCNC 2.9 sample, modified DH per Craig). The oracle below is an
INDEPENDENT forward kinematics (4x4 homogeneous matrices, Shepperd quaternion extraction); the implementation under test is the quaternion
chain the Lab and the plan 02 checker use. Numeric tolerances are fixture tolerances, not mechanical accuracy. Nothing here touches hardware."""
import hashlib
import json
import math
import unittest

from support import MODEL_DIR, SIMULATION  # noqa: F401  (sys.path)

from collision.arm_swept_path import forward_kinematics  # the implementation (quaternion chain), same convention as genserkins

INCH, DEG = 0.0254, math.pi / 180
load = lambda name: json.loads((MODEL_DIR / name).read_text())
sha = lambda name: hashlib.sha256((MODEL_DIR / name).read_bytes()).hexdigest()


# ---- independent oracle: homogeneous matrices ---------------------------------------------------------------------------------------
def _mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def _rx(t):
    c, s = math.cos(t), math.sin(t)
    return [[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]]


def _rz(t):
    c, s = math.cos(t), math.sin(t)
    return [[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def _tr(x, y, z):
    return [[1, 0, 0, x], [0, 1, 0, y], [0, 0, 1, z], [0, 0, 0, 1]]


def oracle_fk(model_si, q_rad):
    """T_0_6 = prod_i Rx(alpha_{i-1}) Tx(a_{i-1}) Rz(theta_i) Tz(d_i)   (Craig modified DH = genserkins go_dh_pose_convert)."""
    T = _tr(0, 0, 0)
    for link, theta in zip(model_si["links"], q_rad):
        T = _mul(T, _mul(_mul(_rx(link["alpha"]), _tr(link["a"], 0, 0)), _mul(_rz(theta + link["thetaOffset"]), _tr(0, 0, link["d"]))))
    tool = model_si.get("toolM", [0, 0, 0])
    T = _mul(T, _tr(*tool))
    return T


def quaternion_xyzw(T):
    """Shepperd's method; returns [x, y, z, w] normalised with w >= 0."""
    m = T
    tr = m[0][0] + m[1][1] + m[2][2]
    if tr > 0:
        s = math.sqrt(tr + 1) * 2
        q = [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, 0.25 * s]
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2
        q = [0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s]
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2
        q = [(m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s]
    else:
        s = math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2
        q = [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s, (m[1][0] - m[0][1]) / s]
    n = math.sqrt(sum(c * c for c in q))
    q = [c / n for c in q]
    return [-c for c in q] if q[3] < 0 else q


def angle_between(qa, qb):
    d = abs(sum(a * b for a, b in zip(qa, qb)))
    return 2 * math.acos(min(1.0, d))


def to_si(dh):
    """Source units (inch, rad alpha, deg joints) -> SI; an unknown unit is an error, never a guess."""
    u = dh["units"]
    length = {"inch": INCH, "m": 1.0, "mm": 0.001}[u["length"]]
    angle = {"deg": DEG, "rad": 1.0}[u["joint"]]
    alpha = {"deg": DEG, "rad": 1.0}[u["alpha"]]
    return {"revision": "a01", "links": [{"alpha": j["alpha"] * alpha, "a": j["a"] * length, "d": j["d"] * length, "thetaOffset": j["thetaOffset"] * angle} for j in dh["joints"]],
            "limits": [{"min": j["min"] * angle, "max": j["max"] * angle, "maxVelocity": j["maxVelocity"] * angle} for j in dh["joints"]], "toolM": [v * length for v in dh["toolTranslation"]]}


def numeric_rank(model_si, q_rad, h=1e-6, tol=1e-6):
    """Rank of the 6x6 finite-difference Jacobian (position + rotation-vector), Gaussian elimination with a pivot threshold."""
    base = oracle_fk(model_si, q_rad)
    cols = []
    for i in range(6):
        qp = list(q_rad); qp[i] += h
        T = oracle_fk(model_si, qp)
        dp = [(T[k][3] - base[k][3]) / h for k in range(3)]
        R = _mul([[*[base[r][c] for c in range(3)], 0] if r < 3 else [0, 0, 0, 1] for r in range(4)], _tr(0, 0, 0))
        Rt = [[R[c][r] for c in range(3)] for r in range(3)]
        dR = [[sum(T[r][k] * Rt[k][c] for k in range(3)) for c in range(3)] for r in range(3)]  # T*R^T ~ I + [w]x
        w = [(dR[2][1] - dR[1][2]) / 2 / h, (dR[0][2] - dR[2][0]) / 2 / h, (dR[1][0] - dR[0][1]) / 2 / h]
        cols.append(dp + w)
    J = [[cols[c][r] for c in range(6)] for r in range(6)]
    rank, row = 0, 0
    for c in range(6):
        p = max(range(row, 6), key=lambda r: abs(J[r][c]), default=None)
        if p is None or abs(J[p][c]) < tol:
            continue
        J[row], J[p] = J[p], J[row]
        for r in range(row + 1, 6):
            f = J[r][c] / J[row][c]
            J[r] = [J[r][k] - f * J[row][k] for k in range(6)]
        row += 1; rank += 1
    return rank


class ManifestTest(unittest.TestCase):
    def setUp(self):
        self.m, self.dh = load("manifest.json"), load("modified-dh.json")

    def test_reference_only_with_pinned_origin_and_file_hashes(self):
        m = self.m
        self.assertTrue(m["referenceOnly"]); self.assertIsNone(m["mekoniqRobotCode"])
        self.assertEqual(m["origin"]["commit"], "135b0ce5220bef8f8a34b6825723108b8b9740f1")
        self.assertEqual(m["origin"]["repository"], "https://github.com/LinuxCNC/linuxcnc"); self.assertEqual(m["origin"]["branch"], "2.9")
        for name in ("modified-dh.json", "frames.json", "reference-poses.json"):
            self.assertEqual(m["hashes"][name], sha(name), name)
        vendored = m["origin"]["files"]["configs/sim/axis/vismach/puma/puma560_dh.hal"]
        self.assertEqual(vendored["vendoredSha256"], hashlib.sha256((MODEL_DIR / "origin" / "puma560_dh.hal").read_bytes()).hexdigest())
        self.assertIsNone(vendored["upstreamSha256"]); self.assertIn("not verified byte-for-byte", vendored["note"])
        self.assertEqual(m["convention"], "modified_dh_craig"); self.assertEqual(m["units"], {"length": "inch", "alpha": "rad", "joint": "deg"}); self.assertEqual(m["siOutput"], {"length": "m", "angle": "rad", "time": "s"})

    def test_sample_numbers_are_the_pinned_hal_values(self):
        hal = (MODEL_DIR / "origin" / "puma560_dh.hal").read_text()
        values = {}
        for line in hal.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[0] == "setp":
                key, idx = parts[1].split(".")[1].rsplit("-", 1); values[(key, int(idx))] = float(parts[2])
        for i, j in enumerate(self.dh["joints"]):
            self.assertEqual((j["a"], j["alpha"], j["d"]), (values[("A", i)], values[("ALPHA", i)], values[("D", i)]), j["name"])
        self.assertEqual([j["name"] for j in self.dh["joints"]], ["J1", "J2", "J3", "J4", "J5", "J6"])
        self.assertEqual(self.m["linuxcncJointMap"], {f"JOINT_{i}": f"J{i + 1}" for i in range(6)})
        self.assertEqual(self.m["axisSign"], [1] * 6); self.assertEqual(self.m["zeroOffsetDeg"], [0] * 6)
        self.assertEqual(self.m["homeDeg"]["J5"], 0.1)                       # the sample dodges the inverse failure; a singularity warning, not a safety trick

    def test_missing_mekoniq_fields_stay_unknown(self):
        for k in ("payloadKg", "gearRatio", "brake", "encoder", "massKg", "inertia"):
            self.assertIsNone(self.m["unknown"][k]["value"], k); self.assertTrue(self.m["unknown"][k]["reason"].startswith("NOT_PROVIDED"), k)
        self.assertEqual(self.m["tolerances"], {"fkPositionM": 1e-6, "fkAngleRad": 1e-6, "ikPositionM": 0.001, "ikAngleRad": 0.0087266463})
        self.assertEqual(self.m["labIllustrativeModel"]["revision"], "bd57344faecee29df2d50b8e8535de6936b05da3778eadbf46ad0e5d626650f3")
        self.assertNotEqual(self.m["labIllustrativeModel"]["revision"], self.m["hashes"]["modified-dh.json"])


class UnitsTest(unittest.TestCase):
    def test_inch_and_degree_round_trip_both_ways(self):
        for v in (26.45, -5.5, 17, 17.05, 2.2, 0.001):
            self.assertAlmostEqual(v * INCH / INCH, v, places=12); self.assertAlmostEqual((v * INCH) / 0.0254, v, places=12)
        for v in (0.1, 30, -215, 35, 360):
            self.assertAlmostEqual(math.degrees(math.radians(v)), v, places=12); self.assertAlmostEqual(v * DEG / DEG, v, places=12)

    def test_si_table_values(self):
        si = to_si(load("modified-dh.json"))
        self.assertAlmostEqual(si["links"][0]["d"], 0.67183, places=9); self.assertAlmostEqual(si["links"][2]["a"], 0.4318, places=9)
        self.assertAlmostEqual(si["limits"][2]["min"], -215 * DEG, places=12); self.assertAlmostEqual(si["limits"][0]["maxVelocity"], 30 * DEG, places=12)
        self.assertAlmostEqual(si["links"][1]["alpha"], 1.570796326, places=12)  # the sample's truncated pi/2 is pinned, not replaced
        with self.assertRaises(KeyError):
            to_si({**load("modified-dh.json"), "units": {"length": "furlong", "alpha": "rad", "joint": "deg"}})


class ReferencePosesTest(unittest.TestCase):
    def setUp(self):
        self.dh, self.poses, self.m = load("modified-dh.json"), load("reference-poses.json"), load("manifest.json")
        self.si = to_si(self.dh); self.tol = self.m["tolerances"]

    def q_rad(self, case):
        return [v * DEG for v in case["qDeg"]]

    def test_fixture_expectations_come_from_the_oracle_and_the_implementation_agrees(self):
        for case in self.poses["cases"]:
            if case["kind"] in ("unreachable",):
                continue
            T = oracle_fk(self.si, self.q_rad(case))
            p, q = [T[k][3] for k in range(3)], quaternion_xyzw(T)
            self.assertLess(math.dist(p, case["expected"]["tcpM"]), self.tol["fkPositionM"], case["name"])
            self.assertLess(angle_between(q, case["expected"]["quaternionXyzw"]), self.tol["fkAngleRad"], case["name"])
            impl = forward_kinematics({**self.si, "revision": "a01"}, self.q_rad(case))
            self.assertLess(math.dist(impl["tcp"], p), 1e-9, case["name"]); self.assertLess(angle_between(impl["tcpQuaternion"], q), 1e-9, case["name"])
        self.assertGreaterEqual(sum(1 for c in self.poses["cases"] if c["kind"] == "nominal"), 3)

    def test_quaternion_is_xyzw_normalised_and_positive_w(self):
        case = next(c for c in self.poses["cases"] if c["name"] == "j1-plus-90"); home = next(c for c in self.poses["cases"] if c["name"] == "sample-home")
        q, q0 = case["expected"]["quaternionXyzw"], home["expected"]["quaternionXyzw"]
        self.assertAlmostEqual(math.sqrt(sum(c * c for c in q)), 1, places=9); self.assertGreaterEqual(q[3], 0)
        # same wrist as sample-home, J1 turned +90 deg: the relative rotation q * conj(q0) is a +90 deg turn about the base z (right-handed)
        x, y, z, w = q0; conj = [-x, -y, -z, w]
        rel = [q[3] * conj[0] + q[0] * conj[3] + q[1] * conj[2] - q[2] * conj[1], q[3] * conj[1] - q[0] * conj[2] + q[1] * conj[3] + q[2] * conj[0],
               q[3] * conj[2] + q[0] * conj[1] - q[1] * conj[0] + q[2] * conj[3], q[3] * conj[3] - q[0] * conj[0] - q[1] * conj[1] - q[2] * conj[2]]
        self.assertLess(angle_between(rel, [0, 0, math.sin(math.pi / 4), math.cos(math.pi / 4)]), 1e-9)
        self.assertEqual(self.poses["quaternionOrder"], "xyzw")

    def test_unit_conversion_case_states_source_units_and_si(self):
        case = next(c for c in self.poses["cases"] if c["kind"] == "unit_conversion")
        self.assertEqual(case["sourceUnits"], {"joint": "deg", "length": "inch"})
        for a, b in zip(case["qDeg"], case["qRad"]):
            self.assertAlmostEqual(a, b / DEG, places=9)
        self.assertAlmostEqual(case["expected"]["tcpInch"][2] * INCH, case["expected"]["tcpM"][2], places=12)

    def test_near_singularity_is_flagged_by_the_wrist_indicator_and_jacobian_rank(self):
        case = next(c for c in self.poses["cases"] if c["kind"] == "near_singularity")
        self.assertTrue(abs(math.sin(self.q_rad(case)[4])) < 0.05); self.assertTrue(case["expected"]["singular"])
        exact = self.q_rad(case); exact[4] = 0.0                                   # 0.1 deg away the Jacobian is still full rank; at q5 = 0 it loses one
        self.assertLess(numeric_rank(self.si, exact), 6)
        nominal = next(c for c in self.poses["cases"] if c["kind"] == "nominal" and not c["expected"].get("singular"))
        self.assertEqual(numeric_rank(self.si, self.q_rad(nominal)), 6)
        self.assertEqual(self.poses["singularityIndicator"], {"rule": "near: abs(sin(q5)) < 0.05; exact: finite-difference Jacobian rank < 6 at q5 = 0", "note": "fixture indicator, not a controller policy"})

    def test_unreachable_target_is_outside_the_reach_bound(self):
        case = next(c for c in self.poses["cases"] if c["kind"] == "unreachable")
        reach = sum(abs(l["a"]) + abs(l["d"]) for l in self.si["links"]) + math.hypot(*self.si["toolM"])
        self.assertAlmostEqual(self.m["reachBoundM"], reach, places=9)
        self.assertGreater(math.dist(case["targetM"], [0, 0, 0]), reach); self.assertFalse(case["expected"]["reachable"])

    def test_joint_limit_case_names_the_violating_joint(self):
        case = next(c for c in self.poses["cases"] if c["kind"] == "joint_limit")
        over = [j["name"] for j, v in zip(self.dh["joints"], case["qDeg"]) if not j["min"] <= v <= j["max"]]
        self.assertEqual(over, case["expected"]["violatedJoints"]); self.assertEqual(over, ["J3"]); self.assertFalse(case["expected"]["withinLimits"])


class FramesTest(unittest.TestCase):
    def test_frame_tree_world_cell_arm_links_flange_tcp(self):
        f = load("frames.json")
        ids = [x["id"] for x in f["frames"]]
        self.assertEqual(ids, ["world", "cell_base", "arm_base", "link_1", "link_2", "link_3", "link_4", "link_5", "link_6", "flange", "tcp"])
        by = {x["id"]: x for x in f["frames"]}
        self.assertIsNone(by["world"]["parentId"]); self.assertEqual(by["arm_base"]["parentId"], "cell_base"); self.assertEqual(by["tcp"]["parentId"], "flange")
        self.assertEqual(by["tcp"]["translationM"], [0, 0, 0]); self.assertEqual(f["toolRevision"], "tool-0-notool")
        self.assertEqual(by["cell_base"]["provenance"], "unknown"); self.assertIn("NOT_CALIBRATED", by["cell_base"]["reason"])
        self.assertEqual(f["convention"], "T_parent_child; quaternion [x,y,z,w]; right-handed, +Z up")


if __name__ == "__main__":
    unittest.main()
