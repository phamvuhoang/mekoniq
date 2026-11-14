"""Native contact-force sign, aggregation and transient coverage: no protocol double."""
import numpy as np
import mujoco
import pytest
from mujoco_worker.mobile_engine import MobileEngine, ContactAccumulator
from test_mobile import inputs


def test_floor_box_force_is_on_canonical_b_in_map_frame():
    engine = MobileEngine.__new__(MobileEngine)
    engine.model = mujoco.MjModel.from_xml_string('''<mujoco><option timestep="0.002"/><worldbody>
      <geom name="floor" type="plane" size="2 2 .1"/>
      <body pos="0 0 .1"><freejoint/><geom name="box" type="box" size=".1 .1 .1" mass="1"/></body>
      </worldbody></mujoco>''')
    engine.data = mujoco.MjData(engine.model)
    engine.tags = {0: "a-floor", 1: "z-box"}
    for _ in range(1000):
        mujoco.mj_step(engine.model, engine.data)
    sample = engine._sample_contacts()[("a-floor", "z-box")]
    assert sample[0] == pytest.approx(9.81, abs=1e-6)
    assert sample[1] == pytest.approx([0, 0, 9.81], abs=1e-6)
    engine.tags = {0: "z-floor", 1: "a-box"}
    assert engine._sample_contacts()[("a-box", "z-floor")][1] == pytest.approx([0, 0, -9.81], abs=1e-6)


def test_actual_mobile_impulse_integrates_every_native_substep():
    engine = MobileEngine(*inputs())
    original = engine._sample_contacts
    samples = []
    def capture():
        value = original()
        samples.append(value)
        return value
    engine._sample_contacts = capture
    try:
        result = engine.step(0, 0)
        assert len(samples) == 10
        for contact in result["contacts"]:
            pair = (contact["a"], contact["b"])
            forces = [s[pair][0] for s in samples if pair in s]
            assert contact["samples"] == len(forces)
            assert contact["normalImpulseNs"] == pytest.approx(sum(forces) * .002, abs=1e-12)
            assert contact["netImpulseMapNs"] == pytest.approx(sum((s[pair][1] for s in samples if pair in s), np.zeros(3)) * .002, abs=1e-12)
            assert contact["peakNormalN"] == max(forces)
    finally:
        engine.close()


def test_transient_native_contact_remains_when_final_substep_is_airborne():
    engine = MobileEngine.__new__(MobileEngine)
    engine.model = mujoco.MjModel.from_xml_string('''<mujoco><option timestep="0.002" gravity="0 0 0"/>
      <worldbody><geom type="plane" size="2 2 .1" solref=".002 .01"/>
      <body pos="0 0 .1001"><freejoint/><geom type="sphere" size=".1" mass="1" solref=".002 .01"/></body></worldbody></mujoco>''')
    engine.data = mujoco.MjData(engine.model)
    engine.tags = {0: "floor", 1: "prop/ball"}
    engine.data.qvel[2] = -1
    acc = ContactAccumulator(.002, set())
    samples = []
    for _ in range(10):
        mujoco.mj_step(engine.model, engine.data)
        sample = engine._sample_contacts()
        samples.append(sample)
        acc.add(sample)
    assert not samples[-1]
    assert any(samples[1:-1])
    contact = acc.finish()[0]
    assert 0 < contact["samples"] < 10
    assert contact["normalImpulseNs"] > 0

@pytest.mark.parametrize("normal, vector", [(float("nan"), [0, 0, 0]), (-1, [0, 0, 0]), (1, [0, 0, float("inf")])])
def test_invalid_contact_force_is_terminal(normal, vector):
    from mujoco_worker.protocol import WorkerError
    with pytest.raises(WorkerError, match="nonfinite contact force"):
        ContactAccumulator(.002, set()).add({("a", "b"): (normal, np.array(vector), np.zeros(3), 0)})


def test_impulse_overflow_is_terminal_not_available_infinity():
    from mujoco_worker.protocol import WorkerError
    acc = ContactAccumulator(1, set())
    sample = {("a", "b"): (1e308, np.array([0., 0., 1e308]), np.zeros(3), 0)}
    acc.add(sample)
    with np.errstate(over="ignore"), pytest.raises(WorkerError, match="contact impulse overflow"):
        acc.add(sample)
