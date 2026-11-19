"""The engine side of the virtual drive: it binds a DriveGroup (pure, drive_model.py) to the actuators of one compiled MjModel and applies, every substep, what the group asks.

Four things only, all on actuator and joint *parameters*, never on `qpos`/`qvel`/`xfrc_applied`:
  - `ctrl` of each axis, written through `actuator_ctrladr` (a `pid` actuator owns two ctrl cells, `actuator_ctrlrange` is per ctrl cell: the spike's hazard 1);
  - the switch-off of an axis that is not active: its own actuator group bit in `opt.disableactuator` (force exactly 0, the integral stays put);
  - the brake of such an axis whose model says `brake`: joint dry friction of at least `brakeTorqueNm` with a tightened constraint softness (spike case 3), the joint's own values restored
    when the axis is active again; `coast` changes nothing;
  - the actuator's internal state on a change of activity: the integral and the slew reference start from zero / from the current position when an axis becomes active and are cleared when it
    stops (spike hazard 3).
The torque of a wheel is limited per substep by the engine as before (the R2b envelope, now times the axis' `scale`); this class never computes a torque.
"""
import numpy as np

# dof_solimp / dof_solref of the friction-loss constraint while an axis brakes (spike case 3, "tighter": 0.5 mrad of drift over 10 s at 3x the gravity torque)
BRAKE_SOLIMP = [0.999, 0.9999, 0.001, 0.5, 2.0]
BRAKE_SOLREF = [0.004, 1.0]


class DriveBinding:
    def __init__(self, model, data, group, actuator_of_axis):
        """`actuator_of_axis`: {axisId: actuator id} for every axis of the group."""
        self.m, self.d, self.g = model, data, group
        acts = [actuator_of_axis[i] for i in group.ids]
        self.acts = np.array(acts, dtype=int)
        self.adr0 = model.actuator_ctrladr[self.acts].astype(int)
        self.cell1 = [i for i in range(group.n) if group.has_cell1[i]]
        self.adr1 = self.adr0[self.cell1] + 1
        jid = model.actuator_trnid[self.acts, 0]
        self.qadr, self.dof = model.jnt_qposadr[jid].astype(int), model.jnt_dofadr[jid].astype(int)
        self.actadr = model.actuator_actadr[self.acts].astype(int)
        self.actnum = model.actuator_actnum[self.acts].astype(int)
        for k, a in enumerate(acts):
            model.actuator_group[a] = group.plan[group.ids[k]]["group"]
        self.base_disable = int(model.opt.disableactuator)
        self.base_loss = model.dof_frictionloss[self.dof].copy()
        self.base_solimp, self.base_solref = model.dof_solimp[self.dof].copy(), model.dof_solref[self.dof].copy()
        self.brake_nm = [a["brakeTorqueNm"] for a in group.axes]
        self.active = None
        self.wheel = []   # (position in the group, actuator id) of the axes the engine limits per substep
        self.last = None

    # ---- true state of the axes ------------------------------------------------------------------------------------------------------------------------
    def true_state(self):
        d = self.d
        return d.qpos[self.qadr], d.qvel[self.dof]

    # ---- the three phases around the engine's mj_step ---------------------------------------------------------------------------------------------------
    def pre_substep(self):
        """substep() of the group on the true state, then applied to the model. Returns the group's answer."""
        pos, vel = self.true_state()
        out = self.g.substep(pos, vel)
        active = out["active"]
        if self.active is None or active != self.active:
            self._switch(active, pos)
            self.active = list(active)
        d = self.d
        d.ctrl[self.adr0] = out["ctrl"]
        if self.cell1:
            c1 = out["ctrl1"]
            d.ctrl[self.adr1] = [c1[i] for i in self.cell1]
        self.last = out
        return out

    def post_substep(self):
        """The feedback channel, from the state after mj_step and the actuators' forces and saturation."""
        pos, vel = self.true_state()
        d, m = self.d, self.m
        force = d.actuator_force[self.acts]
        lo, hi = m.actuator_forcerange[self.acts, 0], m.actuator_forcerange[self.acts, 1]
        saturated = (np.abs(force - lo) < 1e-9) | (np.abs(force - hi) < 1e-9)
        self.g.sample(pos, vel, force, saturated)

    # ---- activity changes ------------------------------------------------------------------------------------------------------------------------------
    def _switch(self, active, pos):
        m, d, g = self.m, self.d, self.g
        previous = self.active
        m.opt.disableactuator = self.base_disable | sum(1 << g.plan[g.ids[i]]["group"] for i in range(g.n) if not active[i])
        for i in range(g.n):
            if previous is not None and active[i] == previous[i]:
                continue
            dof = self.dof[i]
            if active[i]:
                m.dof_frictionloss[dof], m.dof_solimp[dof], m.dof_solref[dof] = self.base_loss[i], self.base_solimp[i], self.base_solref[i]
                if self.actnum[i]:  # integral from zero, slew reference at the current position
                    d.act[self.actadr[i]:self.actadr[i] + self.actnum[i]] = 0.0
                    if self.actnum[i] == 2:
                        d.act[self.actadr[i]] = pos[i]
            else:
                if self.brake_nm[i] is not None and g.axes[i]["onDisable"] == "brake":
                    m.dof_frictionloss[dof] = max(self.base_loss[i], self.brake_nm[i])
                    m.dof_solimp[dof], m.dof_solref[dof] = BRAKE_SOLIMP, BRAKE_SOLREF
                if self.actnum[i]:
                    d.act[self.actadr[i]:self.actadr[i] + self.actnum[i]] = 0.0

    def scale_limits(self, k, lo, hi):
        s = self.g.scale[k]
        return lo * s, hi * s


def build_drive(model, data, docs, plan, actuator_of_axis, axis_limits, substeps=10):
    """DriveGroup + DriveBinding for one compiled model. `docs` = (drive model, control profile). Every axis of the drive model must exist in this model, and the other way round."""
    from .drive_model import DriveGroup
    from .protocol import WorkerError

    drive_model, control = docs
    ids = [a["axisId"] for a in drive_model["axes"]]
    if set(ids) != set(actuator_of_axis):
        raise WorkerError("DRIVE_DOCUMENT_INVALID", f"the drive model names {sorted(ids)}, this scene has {sorted(actuator_of_axis)}")
    limits = {i: axis_limits[i] for i in ids}
    group = DriveGroup(drive_model, control, model.opt.timestep, substeps, limits)
    binding = DriveBinding(model, data, group, actuator_of_axis)
    group.reset(binding.true_state()[0])
    return binding
