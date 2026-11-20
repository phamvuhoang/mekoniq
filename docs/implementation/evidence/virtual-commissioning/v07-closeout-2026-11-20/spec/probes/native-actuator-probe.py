# R4 readiness probe (2026-11-19). Not repo code and not the V01 spike: a one-joint check that the native actuator
# features R4.1 relies on exist and behave in the pinned wheel. Run from the workspace root, writes nothing:
#   source/.venv-mujoco/bin/python -I -B docs/2026-11-19-virtual-commissioning/probes/native-actuator-probe.py
import sys, time, platform, numpy as np, mujoco
print('mujoco', mujoco.__version__, 'python', sys.version.split()[0], platform.machine())
BODY = """<mujoco><option timestep="0.002" integrator="implicitfast"/>
<worldbody><body><joint name="j" type="hinge" axis="0 0 1" damping="0.05" armature="0.01" frictionloss="0.02"/>
<geom type="capsule" size="0.02" fromto="0 0 0 0.3 0 0" mass="0.5"/></body></worldbody>
<actuator>%s</actuator></mujoco>"""
def build(act):
    m = mujoco.MjModel.from_xml_string(BODY % act); return m, mujoco.MjData(m)
def run(act, ctrl_fn, n=500, setup=None):
    m, d = build(act)
    if setup: setup(m, d)
    out = np.empty(n)
    for i in range(n):
        ctrl_fn(m, d, i); mujoco.mj_step(m, d); out[i] = d.qpos[0]
    return m, d, out
def step_target(m, d, i): d.ctrl[0] = 1.0 if i >= 10 else 0.0
def check(name, fn):
    try: print('OK  ', name, '->', fn())
    except Exception as e: print('FAIL', name, '->', type(e).__name__, str(e).replace('\n', ' ')[:260])

POS = '<position name="a" joint="j" kp="40" kv="4" forcerange="-3 3"/>'
ref = run(POS, step_target)[2]
check('position baseline finite, final', lambda: (bool(np.isfinite(ref).all()), float(ref[-1])))
def pid_ki0():
    m, d, o = run('<pid name="a" joint="j" kp="40" kv="4" ki="0" forcerange="-3 3"/>', step_target)
    return {'nu': m.nu, 'ctrl_len': int(d.ctrl.shape[0]), 'na': m.na, 'bit_identical_to_position': bool(np.array_equal(o, ref)), 'max_abs_diff': float(np.abs(o - ref).max())}
check('pid ki=0 vs position', pid_ki0)
def pid_ki():
    m, d, o = run('<pid name="a" joint="j" kp="40" kv="4" ki="20" imax="0.5" slewmax="2" forcerange="-3 3"/>', step_target)
    return {'finite': bool(np.isfinite(o).all()), 'final': float(o[-1]), 'na': m.na, 'ctrl_len': int(d.ctrl.shape[0]), 'ctrladr': m.actuator_ctrladr.tolist() if hasattr(m, 'actuator_ctrladr') else None}
check('pid ki>0 + imax + slewmax', pid_ki)
def delay():
    m, d, o = run('<position name="a" joint="j" kp="40" kv="4" forcerange="-3 3" nsample="8" delay="0.004"/>', step_target, n=60)
    first_ref = int(np.argmax(np.abs(ref[:60]) > 0)); first = int(np.argmax(np.abs(o) > 0))
    return {'first_motion_step_no_delay': first_ref, 'with_delay_0.004': first, 'shift_substeps': first - first_ref, 'actuator_delay_field': m.actuator_delay.tolist() if hasattr(m, 'actuator_delay') else 'missing', 'history_len': int(d.history.shape[0]) if hasattr(d, 'history') else 'missing'}
check('native command delay', delay)
def delay_runtime():
    def setup(m, d): m.actuator_delay[0] = 0.008
    m, d, o = run('<position name="a" joint="j" kp="40" kv="4" forcerange="-3 3" nsample="8" delay="0.004"/>', step_target, n=60, setup=setup)
    return {'first_motion_step_after_runtime_delay_0.008': int(np.argmax(np.abs(o) > 0))}
check('delay mutable at runtime', delay_runtime)
def delay_zero_identity():
    o = run('<position name="a" joint="j" kp="40" kv="4" forcerange="-3 3" nsample="8" delay="0"/>', step_target)[2]
    return {'nsample=8,delay=0 bit_identical_to_plain_position': bool(np.array_equal(o, ref))}
check('delay buffer present but zero', delay_zero_identity)
def dcmotor():
    m, d, o = run('<dcmotor name="a" joint="j" nominal="24 0.5 30" ctrlrange="-24 24"/>', lambda m, d, i: d.ctrl.__setitem__(0, 12.0), n=300)
    return {'finite': bool(np.isfinite(o).all()), 'qvel_end': float(d.qvel[0]), 'na': m.na}
check('dcmotor nominal="V stall noload"', dcmotor)
def disable_group():
    def ctrl(m, d, i):
        d.ctrl[0] = 1.0
        if i == 100: m.opt.disableactuator |= 1 << 2
    m, d, o = run('<position name="a" joint="j" kp="40" kv="4" forcerange="-3 3" group="2"/>', ctrl, n=300)
    return {'force_after_disable': float(d.actuator_force[0]), 'q_at_100': float(o[99]), 'q_end': float(o[-1])}
check('disableactuator group bit', disable_group)
def forcerange_runtime():
    def ctrl(m, d, i):
        d.ctrl[0] = 1.0
        if i == 50: m.actuator_forcerange[0] = [-0.2, 0.2]
    m, d, o = run(POS, ctrl, n=120)
    return {'abs_force_end<=0.2': bool(abs(d.actuator_force[0]) <= 0.2 + 1e-12), 'force_end': float(d.actuator_force[0])}
check('per-substep forcerange change', forcerange_runtime)
def sysid():
    import importlib; mod = importlib.import_module('mujoco.sysid'); return sorted(n for n in dir(mod) if not n.startswith('_'))[:12]
check('mujoco.sysid import', sysid)
def determinism():
    a = run(POS, step_target)[2]; b = run(POS, step_target)[2]; return {'two runs bit_identical': bool(np.array_equal(a, b))}
check('repeatability same process', determinism)
def cost():
    res = {}
    for name, act in [('position', POS), ('pid', '<pid name="a" joint="j" kp="40" kv="4" ki="20" imax="0.5" forcerange="-3 3"/>'), ('position+delay', '<position name="a" joint="j" kp="40" kv="4" forcerange="-3 3" nsample="8" delay="0.004"/>')]:
        m, d = build(act); t = time.perf_counter()
        for i in range(20000): d.ctrl[0] = 1.0; mujoco.mj_step(m, d)
        res[name] = round((time.perf_counter() - t) / 20000 * 1e6, 2)
    return {'us_per_substep_1dof': res}
check('cost on a 1-DOF toy (relative only)', cost)
