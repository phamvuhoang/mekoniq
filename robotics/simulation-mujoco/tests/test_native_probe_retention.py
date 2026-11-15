"""Portable observer tests with a fake engine; never native qualification evidence."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import pytest

SCRIPT = Path(__file__).resolve().parents[3] / 'scripts/native-sim/mujoco-probe-retention.py'

def load():
    spec = importlib.util.spec_from_file_location('retention', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class FakeSim:
    def __init__(self, parameters, q0, grip0=0):
        self.d = SimpleNamespace(qpos=[0.0], qvel=[0.0], qacc=[0.0], ctrl=[grip0], time=0.0,
                                 warning=[SimpleNamespace(number=0)])
        self.log = []
    def tick(self, command, label=''):
        self.d.ctrl = list(command)
        self.d.time += .02
        if label in ('throw', 'warn'):
            self.d.qacc = [float('nan')]
            self.d.warning[0].number += 1
            if label == 'throw':
                raise RuntimeError('PLANT_UNSTABLE fixture')
        self.log.append({'ms': 1, 'q': self.d.qpos, 'cup': [0, 0, 0], 'label': label})
        return command

def recipe():
    return SimpleNamespace(Sim=FakeSim, scene=SimpleNamespace(build=lambda p: '<mujoco model="portable-double"/>'))

@pytest.mark.parametrize('mode', ['m00', 'long_run'])
@pytest.mark.parametrize('failure', ['throw', 'warn', 'analysis'])
def test_retains_state_warnings_and_inputs_on_nominal_failure(tmp_path, mode, failure):
    module = load()
    r = recipe()
    capture = module.install_retention(r, tmp_path, {'mode': mode, 'seed': 7})
    sim = r.Sim({'unchanged': True}, [0])
    assert sim.tick([1], 'first') == [1]
    try:
        sim.tick([2], failure)
        if failure == 'analysis':
            raise ValueError('analysis fixture failure after stepping')
    except (RuntimeError, ValueError):
        capture.finish('exception')
    else:
        capture.finish('returned')
    state = json.loads((tmp_path / 'last-state.json').read_text())
    retained = json.loads((tmp_path / 'retention.json').read_text())
    assert set(state['state']) == {'qpos', 'qvel', 'qacc', 'ctrl'}
    assert state['state']['ctrl'] == [2]
    assert retained['inputs'][-1]['command'] == [2]
    assert retained['scope'] == 'observer_instrumented_frozen_recipe'
    assert retained['completedTicks'] == (1 if failure == 'throw' else 2)
    assert (tmp_path / 'nominal-compiled.xml').read_text() == '<mujoco model="portable-double"/>'
    if failure != 'analysis':
        fault = json.loads((tmp_path / 'first-failure-state.json').read_text())
        assert fault['state']['qacc'] == ['NaN']
        assert fault['warnings'] == [1]


def test_periodic_checkpoint_is_bounded_and_does_not_modify_return_or_arguments(tmp_path):
    module = load()
    r = recipe()
    capture = module.install_retention(r, tmp_path, {'mode': 'long_run'})
    sim = r.Sim({}, [0])
    command = [3]
    for _ in range(1005):
        assert sim.tick(command, 'hold') is command
    before = json.loads((tmp_path / 'retention.json').read_text())
    assert before['completedTicks'] == 1000  # retained even without finalization (abrupt process loss)
    capture.finish('returned')
    after = json.loads((tmp_path / 'retention.json').read_text())
    assert after['completedTicks'] == 1005
    assert len(after['samples']) == 128
    assert len(after['inputs']) == 128
    assert command == [3]

@pytest.mark.parametrize('mode', ['m00', 'long_run'])
def test_actual_harness_installs_and_finalizes_observer_without_engine(tmp_path, monkeypatch, mode):
    import runpy
    import sys
    import types
    r = types.ModuleType('run')
    class ThrowingSim(FakeSim):
        def tick(self, command, label=''):
            return super().tick(command, 'throw' if self.d.time > 0 else label)
    r.Sim = ThrowingSim
    r.scene = SimpleNamespace(DEFAULTS={}, build=lambda p: '<mujoco model="portable-double"/>')
    r.tunables = lambda p: {}
    r.waypoints = lambda m, p, t: ({'home': [0]}, None)
    def main():
        sim = r.Sim({}, [0])
        sim.tick([1], 'first')
        sim.tick([2], 'second')
    r.main = main
    fake_engine = types.ModuleType('mujoco')
    fake_engine.__version__ = '3.17.0'  # fixture protocol value, never installed engine evidence
    fake_engine.MjModel = SimpleNamespace(from_xml_string=lambda xml: object())
    monkeypatch.setitem(sys.modules, 'mujoco', fake_engine)
    monkeypatch.setitem(sys.modules, 'numpy', types.ModuleType('numpy'))
    monkeypatch.setitem(sys.modules, 'run', r)
    monkeypatch.setattr(sys, 'argv', ['observer', mode, str(tmp_path), '7'])
    original_spec = importlib.util.spec_from_file_location
    def local_observer(name, path, **kwargs):
        return original_spec(name, SCRIPT if str(path) == '/probe/mujoco-probe-retention.py' else path, **kwargs)
    monkeypatch.setattr(importlib.util, 'spec_from_file_location', local_observer)
    with pytest.raises(RuntimeError, match='PLANT_UNSTABLE fixture'):
        runpy.run_path(str(SCRIPT.with_name('mujoco-probe-engine.py')), run_name='__main__')
    assert json.loads((tmp_path / 'retention.json').read_text())['reason'] == 'exception'
    assert json.loads((tmp_path / 'last-state.json').read_text())['state']['qacc'] == ['NaN']
    assert json.loads((tmp_path / 'resource.json').read_text())['maxRssKiB'] > 0
