"""The MuJoCo plant of one arm cell: the only module that imports mujoco. It knows the model only through `compile_cell`'s `names`; it validates nothing (the session does).

One tick: set the arm actuator targets and the gripper actuator target, apply the cup placements, re-pin every parked cup at its park pose with zero velocity, then
mj_step(nstep = scene.engine.substeps).

Gripper: the wire carries `openingM`, the distance between the inner faces of the two pads (0 .. physics.gripper.openingMaxM). The command maps it linearly onto the
gripper actuator's control range (the drive joint range): ctrl = lo + (hi - lo) * (1 - openingM / openingMaxM), so openingMaxM -> lo (open) and 0 -> hi (closed). The
reported opening is measured, not inverted: the separation of the two pad boxes along their thinnest axis minus their half thicknesses, from the model state.
"""
import mujoco
import numpy as np

from .compile import compile_cell


def engine_version():
    return mujoco.__version__


class MujocoEngine:
    def __init__(self, scene, component, physics, blob_dir):
        mjcf, names = compile_cell(scene, component, physics, blob_dir)
        self.names = names
        m = self.model = mujoco.MjModel.from_xml_string(mjcf)
        d = self.data = mujoco.MjData(m)
        mujoco.mj_resetDataKeyframe(m, d, 0)  # the compiler's only keyframe: homeRad, gripper open, cups parked
        mujoco.mj_forward(m, d)
        self.substeps = int(scene["engine"]["substeps"])
        self.opening_max_m = float(physics["gripper"]["openingMaxM"])
        self.arm_joints = [m.joint(n).id for n in names["joints"]]
        self.arm_qpos, self.arm_qvel = m.jnt_qposadr[self.arm_joints], m.jnt_dofadr[self.arm_joints]
        self.arm_limits = [(float(lo), float(hi)) for lo, hi in m.jnt_range[self.arm_joints]]
        self.arm_act = [m.actuator(n).id for n in names["actuators"]]
        self.grip_act = m.actuator(names["gripper"]).id
        self.grip_range = tuple(float(v) for v in m.actuator_ctrlrange[self.grip_act])
        grip_joints = [m.joint(n).id for n in names["jointIds"].values() if n not in names["joints"]]
        self.grip_qpos, self.grip_qvel = m.jnt_qposadr[grip_joints], m.jnt_dofadr[grip_joints]
        if len(names["pads"]) != 2:
            raise ValueError(f"the opening needs two pads, the model has {len(names['pads'])}")
        self.pads = [m.geom(n).id for n in names["pads"]]
        self.contact_bits = (names["propContact"]["contype"], names["propContact"]["conaffinity"])
        self.prop = {}
        for pid, name in names["props"].items():
            bid = m.body(name).id
            jid = m.body_jntadr[bid]
            qa, va = m.jnt_qposadr[jid], m.jnt_dofadr[jid]
            self.prop[pid] = {"body": bid, "geom": m.body_geomadr[bid], "qpos": qa, "qvel": va, "park": d.qpos[qa:qa + 7].copy()}
        self.in_scene = set()
        # contact tags (see snapshot.py): every geom that can collide, by what it is
        link_of = {v: k for k, v in names["links"].items()}  # body name -> component link id
        arm_bodies = {m.jnt_bodyid[j] for j in self.arm_joints} | {m.body_parentid[m.jnt_bodyid[self.arm_joints[0]]]}
        tags = {m.geom(names["floor"]).id: ("floor",), m.geom(names["palm"]).id: ("palm",)}
        tags.update({g: ("pad", k) for k, g in enumerate(self.pads)})
        tags.update({m.geom(n).id: ("static", sid) for sid, n in names["statics"].items()})
        tags.update({m.geom(n).id: ("support", sid) for sid, n in names["supports"].items()})
        tags.update({p["geom"]: ("prop", pid) for pid, p in self.prop.items()})
        for g in range(m.ngeom):
            if g not in tags:
                b = m.geom_bodyid[g]
                tags[g] = ("link", link_of[m.body(b).name]) if b in arm_bodies else ("gripper",)
        self.tags = tags

    # ---- commands ----
    def _set_contacts(self, pid, on):
        p, (ct, ca) = self.prop[pid], self.contact_bits if on else (0, 0)
        self.model.geom_contype[p["geom"]], self.model.geom_conaffinity[p["geom"]] = ct, ca
        self.model.body_contype[p["body"]], self.model.body_conaffinity[p["body"]] = ct, ca  # MuJoCo's broad phase filters on the body bits first

    def _put(self, pid, qpos7):
        p, d = self.prop[pid], self.data
        d.qpos[p["qpos"]:p["qpos"] + 7] = qpos7
        d.qvel[p["qvel"]:p["qvel"] + 6] = 0.0

    def step(self, targets, opening, placements):
        """One tick; `opening` None keeps the last gripper command. `placements` are (propId, pose or None), already validated."""
        d = self.data
        d.ctrl[self.arm_act] = targets
        if opening is not None:
            lo, hi = self.grip_range
            d.ctrl[self.grip_act] = lo + (hi - lo) * (1.0 - opening / self.opening_max_m)
        for pid, pose in placements:
            if pose is None:
                self.in_scene.discard(pid)
                self._set_contacts(pid, False)
                continue
            x, y, z, w = pose["quaternionXyzw"]
            q = np.array([w, x, y, z], dtype=float)
            self._put(pid, [*pose["position"], *(q / np.linalg.norm(q))])
            self._set_contacts(pid, True)
            self.in_scene.add(pid)
        for pid in self.prop.keys() - self.in_scene:  # parked cups do not fall: held at the park pose, contacts off
            self._put(pid, self.prop[pid]["park"])
        mujoco.mj_step(self.model, d, nstep=self.substeps)
        return self.read()

    # ---- readings ----
    def opening(self):
        d, (a, b) = self.data, self.pads
        size = self.model.geom_size
        k = int(np.argmin(size[a]))  # the pad's thickness axis
        axis = d.geom_xmat[a].reshape(3, 3)[:, k]
        return float(abs(np.dot(d.geom_xpos[b] - d.geom_xpos[a], axis)) - size[a][k] - size[b][k])

    def read(self):
        d = self.data
        props = {}
        for pid in sorted(self.in_scene):
            p = self.prop[pid]
            w, x, y, z = d.qpos[p["qpos"] + 3:p["qpos"] + 7]
            props[pid] = {"position": d.qpos[p["qpos"]:p["qpos"] + 3].tolist(), "quaternionXyzw": [float(x), float(y), float(z), float(w)],
                          "speed": float(np.linalg.norm(d.qvel[p["qvel"]:p["qvel"] + 3]))}
        n = d.ncon
        contacts = [(self.tags[int(g1)], self.tags[int(g2)]) for (g1, g2), ex in zip(d.contact.geom[:n], d.contact.exclude[:n]) if ex == 0]
        return {"time": float(d.time), "arm": {"positions": d.qpos[self.arm_qpos].tolist(), "velocities": d.qvel[self.arm_qvel].tolist()},
                "gripper": {"positions": d.qpos[self.grip_qpos].tolist(), "velocities": d.qvel[self.grip_qvel].tolist(), "openingM": self.opening()},
                "props": props, "contacts": contacts}

    def readback(self):
        """The arm as the compiled MjModel holds it: per arm joint (chain order) the child link's mass, the hinge axis in the parent body frame, the range and the actuator's force limit."""
        m = self.model
        link_of = {v: k for k, v in self.names["links"].items()}
        joint_of = {v: k for k, v in self.names["jointIds"].items()}
        links, joints = [], []
        for j, act in zip(self.arm_joints, self.arm_act):
            b = m.jnt_bodyid[j]
            axis = np.zeros(3)
            mujoco.mju_rotVecQuat(axis, m.jnt_axis[j], m.body_quat[b])
            links.append({"name": link_of[m.body(b).name], "massKg": float(m.body_mass[b])})
            joints.append({"name": joint_of[m.joint(j).name], "axis": axis.tolist(), "lower": float(m.jnt_range[j][0]), "upper": float(m.jnt_range[j][1]),
                           "forceN": float(m.actuator_forcerange[act][1])})
        return {"robots": [], "arm": {"links": links, "joints": joints}}

    def close(self):
        self.model = self.data = None
