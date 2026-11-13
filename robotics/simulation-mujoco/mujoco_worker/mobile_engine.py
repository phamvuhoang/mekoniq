"""Real MuJoCo mobile plant: one logical tick, finite wheel servos, measured sensors.

No truth correction, no chassis constraint, no free-payload pose rewrite. Wheel
odometry integrates joint-angle increments independently of the engine base pose.
Contact forces use the engine's contact frame and are force ON canonical side b.
"""
import math

import mujoco
import numpy as np

from .compile import CompileError
from .compile_mobile import compile_mobile, matrix_pose, pose, resolve_lidar
from .drive import wheel_targets, torque_limits
from .engine import BAD_STATE
from .protocol import WorkerError


def _transform(data, bid):
    t = np.eye(4)
    t[:3, :3], t[:3, 3] = data.xmat[bid].reshape(3, 3), data.xpos[bid]
    return t


def _euler(r):
    return math.atan2(r[2, 1], r[2, 2]), -math.asin(float(np.clip(r[2, 0], -1, 1))), math.atan2(r[1, 0], r[0, 0])


class MobileEngine:
    def __init__(self, scene, physical_models, load_profile, physics):
        if mujoco.__version__ != "3.17.0":
            raise CompileError("ENGINE_VERSION_MISMATCH")
        xml, self.names = compile_mobile(scene, physical_models, load_profile, physics)
        self.scene, self.profile, self.physics = scene, load_profile, physics
        self.entry = scene["robots"][0]
        self.rid = self.entry["robotId"]
        self.physical = physical_models[self.rid]
        self.sensor, self.sensor_physical = resolve_lidar(self.entry["model"], self.physical)
        self.model = m = mujoco.MjModel.from_xml_string(xml)
        self.data = d = mujoco.MjData(m)
        mujoco.mj_forward(m, d)
        self.base = m.body(self.names["base"]).id
        self.wj = [m.joint(n).id for n in self.names["wheelJoints"]]
        self.wq, self.wv = m.jnt_qposadr[self.wj], m.jnt_dofadr[self.wj]
        self.acts = [m.actuator(n).id for n in self.names["actuators"]]
        self.tags = {m.geom(n).id: tag for n, tag in self.names["tags"].items()}
        self.prop = {pid: m.body(n).id for pid, n in self.names["props"].items()}
        self.dt, self.substeps = m.opt.timestep, scene["engine"]["substeps"]
        self.radius, self.separation = (self.physical["drive"][k]["value"] for k in ("wheelRadiusM", "wheelSeparationM"))
        drive = self.physical["drive"]["driveFrameInBase"]
        self.drive_in_base = pose(drive["xyzM"], drive["quaternionXyzw"])
        self.odom = np.array(self.entry["initialPoseMap"], dtype=float)
        self.tick = -1
        self.targets = np.zeros(2)
        self.contacts, self.saturated, self.unstable = [], 0, None
        self.scans = []
        # Deep initial penetration is a bad input, not a settling procedure. Robot
        # internal collisions are masked: canonical fixed parts intentionally overlap.
        for c in d.contact[:d.ncon]:
            if c.dist < -1e-6:
                raise CompileError("INITIAL_PENETRATION", f"{self.tags[int(c.geom1)]} / {self.tags[int(c.geom2)]}: {c.dist}")
        for p in load_profile["props"]:
            if p["attachment"]["kind"] != "free":
                continue
            support = self.names["supports"][p["attachment"]["supportId"]]
            sbid = m.body(self.names["links"][support["parentBodyId"]]).id
            bid = self.prop[p["propId"]]
            # A zero-gap box/cylinder does not necessarily generate a contact until
            # gravity acts. Query native geometric distance without stepping instead.
            support_geoms = range(m.body_geomadr[sbid], m.body_geomadr[sbid] + m.body_geomnum[sbid])
            if not any(abs(mujoco.mj_geomDistance(m, d, int(m.body_geomadr[bid]), int(g), 1, None)) <= 1e-6 for g in support_geoms):
                raise CompileError("LOAD_SUPPORT_GEOMETRY_INVALID", "initial free payload does not touch its declared model support")

    def _sample_contacts(self):
        """Sum all points for each pair BEFORE counting one substep sample/peak."""
        out = {}
        force = np.zeros(6)
        for i, c in enumerate(self.data.contact[:self.data.ncon]):
            if c.exclude:
                continue
            a, b = self.tags[int(c.geom1)], self.tags[int(c.geom2)]
            mujoco.mj_contactForce(self.model, self.data, i, force)
            # MuJoCo frame rows are contact axes; positive normal points geom1->geom2.
            fmap = c.frame.reshape(3, 3).T @ force[:3]
            if a > b:
                a, b, fmap = b, a, -fmap
            pair = (a, b)
            if pair not in out:
                out[pair] = [0.0, np.zeros(3), c.pos.copy(), -1.0]
            sample = out[pair]
            sample[0] += max(0.0, float(force[0]))
            sample[1] += fmap
            if force[0] > sample[3]:
                sample[2], sample[3] = c.pos.copy(), float(force[0])
        return out

    def step(self, v_mps, omega_radps):
        d, m = self.data, self.model
        targets = wheel_targets(v_mps, omega_radps, self.radius, self.separation)
        if any(not lo <= t <= hi for t, (lo,hi) in zip(targets, m.actuator_ctrlrange[self.acts])):
            raise WorkerError("VELOCITY_TARGET_OUT_OF_RANGE", "wheel target exceeds canonical speed limit")
        self.targets[:] = targets
        d.ctrl[self.acts] = self.targets
        aggregate, unstable, self.saturated = {}, set(), 0
        for _ in range(self.substeps):
            old = d.qpos[self.wq].copy()
            saturated = False
            for act, velocity, target in zip(self.acts, d.qvel[self.wv], self.targets):
                lo, hi = torque_limits(float(velocity), float(target), self.physics)
                m.actuator_forcerange[act] = lo, hi
                demand = self.physics["velocityGainNmsPerRad"] * (target - velocity)
                saturated |= demand < lo - 1e-12 or demand > hi + 1e-12
            self.saturated += int(saturated)
            before = {k: d.warning[w].number for k, w in BAD_STATE.items()}
            mujoco.mj_step(m, d)
            unstable.update(k for k, w in BAD_STATE.items() if d.warning[w].number != before[k])
            if not np.isfinite(d.qpos).all() or not np.isfinite(d.qvel).all() or not np.isfinite(d.qacc).all():
                unstable.add("NONFINITE")
            # Stop immediately on an engine reset; never integrate a reset state.
            if unstable:
                self.unstable = ",".join(sorted(unstable))
                raise WorkerError("PLANT_UNSTABLE", self.unstable, fatal=True)
            delta = (d.qpos[self.wq] - old) * self.radius
            ds, da = float(sum(delta) / 2), float((delta[1] - delta[0]) / self.separation)
            distance = ds * float(np.sinc(da / (2 * math.pi)))
            self.odom[:2] += distance * np.array([math.cos(self.odom[2] + da/2), math.sin(self.odom[2] + da/2)])
            self.odom[2] += da  # deliberately unwrapped; residual caller wraps differences
            for pair, (normal, fmap, point, _) in self._sample_contacts().items():
                if pair not in aggregate:
                    if len(aggregate) >= 256:
                        raise WorkerError("CONTACT_CAPACITY_EXCEEDED", "more than 256 contact pairs in a tick", fatal=True)
                    aggregate[pair] = {"a": pair[0], "b": pair[1], "samples": 0, "peakNormalN": 0.0, "normalImpulseNs": 0.0,
                                       "netImpulseMapNs": np.zeros(3), "pointAtPeakMapM": point.tolist(), "expected": pair in self.names["expected"]}
                a = aggregate[pair]
                a["samples"] += 1
                a["normalImpulseNs"] += normal * self.dt
                a["netImpulseMapNs"] += fmap * self.dt
                if normal > a["peakNormalN"]:
                    a["peakNormalN"], a["pointAtPeakMapM"] = normal, point.tolist()
        self.contacts = [{**aggregate[p], "netImpulseMapNs": aggregate[p]["netImpulseMapNs"].tolist()} for p in sorted(aggregate)]
        self.tick += 1
        mujoco.mj_forward(m, d)  # read transforms/velocities at the final integrated pose
        if self.tick % self.entry["model"]["sensors"][0]["publishEveryTicks"] == 0:
            self.scans = [self.scan(self.tick)]
        return self.read()

    def scan(self, tick):
        sensor, physical = self.sensor, self.sensor_physical
        at = physical["poseInBase"]
        transform = _transform(self.data, self.base) @ pose(at["xyzM"], at["quaternionXyzw"])
        n, fov = sensor["beamCount"], sensor["fieldOfViewRad"]
        delta = fov / n
        start = -fov / 2 + delta / 2
        ranges, states = [], []
        # Group 1 excludes the entire robot (all its fixed and hinged bodies), rather
        # than bodyexclude which excludes just one body. Props/world remain visible.
        groups = np.array([1, 0, 1, 1, 1, 1], dtype=np.uint8)
        gid = np.zeros(1, dtype=np.int32)
        for i in range(n):
            angle = start + i * delta
            direction = transform[:3, :3] @ [math.cos(angle), math.sin(angle), 0]
            distance = mujoco.mj_ray(self.model, self.data, transform[:3, 3].copy(), direction, groups, 1, -1, gid)
            if distance < 0 or distance > sensor["rangeMaxM"]:
                ranges.append(None); states.append("no_return")
            elif distance < sensor["rangeMinM"]:
                ranges.append(None); states.append("below_min")
            else:
                ranges.append(float(distance)); states.append("hit")
        return {"sensorId": sensor["id"], "frameId": physical["parentLinkId"], "tick": tick, "simTimeNs": str(tick * 20_000_000),
                "angleMinRad": start, "angleIncrementRad": delta, "rangeMinM": sensor["rangeMinM"], "rangeMaxM": sensor["rangeMaxM"], "rangesM": ranges, "states": states}

    def _velocity(self, bid):
        out = np.zeros(6)
        mujoco.mj_objectVelocity(self.model, self.data, mujoco.mjtObj.mjOBJ_BODY, bid, out, 0)
        # mj_objectVelocity is COM-centred. Convert linear velocity to body origin.
        out[3:] += np.cross(out[:3], self.data.xpos[bid] - self.data.xipos[bid])
        return out

    def read(self):
        d, m = self.data, self.model
        base = _transform(d, self.base)
        drive = base @ self.drive_in_base
        roll, pitch, yaw = _euler(base[:3, :3])
        vel = self._velocity(self.base)
        drive_vel = vel[3:] + np.cross(vel[:3], drive[:3, 3] - base[:3, 3])
        heading = math.atan2(drive[1, 0], drive[0, 0])
        collisions = set()
        for c in self.contacts:
            if not c["expected"]:
                for a, b in ((c["a"], c["b"]), (c["b"], c["a"])):
                    if a.startswith(self.rid + "/"):
                        collisions.add(b.removeprefix("static/").removeprefix("prop/"))
        loads, resting = [], {}
        for p in self.profile["props"]:
            pid = p["propId"]
            bid = self.prop[pid]
            at = _transform(d, bid)
            pv = self._velocity(bid)
            sid, relative = None, None
            resting[pid] = None
            if p["attachment"]["kind"] == "free":
                sid = p["attachment"]["supportId"]
                support = self.names["supports"][sid]
                sp = support["poseInBody"]
                sbid = m.body(self.names["links"][support["parentBodyId"]]).id
                st = _transform(d, sbid) @ pose(sp["positionM"], sp["quaternionXyzw"])
                relative = matrix_pose(np.linalg.inv(st) @ at)
                sv = self._velocity(sbid)
                support_velocity = sv[3:] + np.cross(sv[:3], at[:3,3] - d.xpos[sbid])
                touching = any((int(c.geom1) == m.body_geomadr[bid] and m.geom_bodyid[int(c.geom2)] == sbid) or
                               (int(c.geom2) == m.body_geomadr[bid] and m.geom_bodyid[int(c.geom1)] == sbid) for c in d.contact[:d.ncon] if c.exclude == 0 and c.dist <= .001)
                if touching and np.linalg.norm(pv[3:] - support_velocity) < .01:
                    resting[pid] = sid
            loads.append({"propId": pid, "poseMap": matrix_pose(at), "linearVelocityMapMps": pv[3:].tolist(), "angularVelocityMapRadps": pv[:3].tolist(), "supportId": sid, "poseInSupport": relative})
        wheel = {"robotId": self.rid, "angleRad": d.qpos[self.wq].tolist(), "velocityRadS": d.qvel[self.wv].tolist(), "torqueNm": d.actuator_force[self.acts].tolist(), "targetRadS": self.targets.tolist(), "saturatedSubsteps": self.saturated}
        return {"time": float(d.time), "unstable": self.unstable, "robot": {"robotId": self.rid, "poseDriveMap": [float(drive[0, 3]), float(drive[1, 3]), heading],
                "bodyVelocity": [float(drive_vel[0] * math.cos(heading) + drive_vel[1] * math.sin(heading)), float(vel[2])], "scans": self.scans,
                "collisionIds": sorted(collisions), "pose3d": {"z": float(base[2, 3]), "roll": roll, "pitch": pitch}, "wheels": {"leftRadS": wheel["velocityRadS"][0], "rightRadS": wheel["velocityRadS"][1]}},
                "base": {"robotId": self.rid, "poseMap": matrix_pose(base), "rollRad": roll, "pitchRad": pitch}, "wheel": wheel, "odometry": self.odom.tolist(), "loads": loads, "resting": resting, "contacts": self.contacts}

    def readback(self):
        m, d = self.model, self.data
        links = [{"name": lid, "massKg": float(m.body_mass[m.body(name).id]), "positionMap": d.xpos[m.body(name).id].tolist()} for lid, name in self.names["links"].items()]
        rims = [m.jnt_bodyid[j] for j in self.wj]
        radii = [float(m.geom_size[m.body_geomadr[b]][0]) for b in rims]
        return {"robots": [{"robotId": self.rid, "links": links, "wheelRadiusM": radii[0], "wheelSeparationM": float(np.linalg.norm(d.xpos[rims[0]] - d.xpos[rims[1]])),
                            "wheelAxes": [(d.xmat[m.jnt_bodyid[j]].reshape(3, 3) @ m.jnt_axis[j]).tolist() for j in self.wj]}]}

    def close(self):
        self.model = self.data = None
