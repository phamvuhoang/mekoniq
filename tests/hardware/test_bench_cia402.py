import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'robotics' / 'bench'))

import itertools
import math

import pytest

from bench_worker import cia402
from bench_worker.cia402 import DISABLED, ENABLED, FAULT, QUICK_STOP, READY, neutral_fault, neutral_state, next_controlword
from bench_worker.units import Unwrap32, position_from_raw, torque_from_raw, velocity_from_raw, velocity_to_raw

ROWS = [(0x0000, DISABLED), (0x0040, DISABLED), (0x0021, READY), (0x0023, READY), (0x0027, ENABLED), (0x0007, QUICK_STOP), (0x000F, FAULT), (0x0008, FAULT)]
OUTSIDE = (0x0080, 0x0200, 0x0400, 0x1000, 0x4000)
EXTRA = [sum(c) for n in range(len(OUTSIDE) + 1) for c in itertools.combinations(OUTSIDE, n)]


@pytest.mark.parametrize("value,state", ROWS)
@pytest.mark.parametrize("extra", EXTRA)
def test_every_statusword_row_with_every_outside_bit_maps_to_its_neutral_state(value, state, extra):
    assert neutral_state(value | extra) == state


@pytest.mark.parametrize("sw,kw,cw", [
    (0x0040, dict(enable=True), 0x0006), (0x0021, dict(enable=True), 0x0007), (0x0023, dict(enable=True), 0x000F), (0x0027, dict(enable=True), 0x000F),
    (0x0027, dict(enable=True, quick_stop=True), 0x0002), (0x0027, dict(enable=False), 0x0000),
    (0x0008, dict(enable=False, reset_edge=True), 0x0080), (0x0008, dict(enable=True, reset_edge=False), 0x0000),
])
def test_next_controlword(sw, kw, cw):
    args = dict(enable=False, quick_stop=False, reset_edge=False) | kw
    assert next_controlword(sw, **args) == cw


@pytest.mark.parametrize("sw", [0x0040, 0x0021, 0x0023])
def test_quick_stop_never_advances_toward_enable(sw):
    assert next_controlword(sw, enable=True, quick_stop=True, reset_edge=False) == 0x0000


def test_quick_stop_active_is_held_while_quick_stop_is_commanded():
    assert next_controlword(0x0007, enable=True, quick_stop=True, reset_edge=False) == 0x0002


def test_quick_stop_true_never_yields_an_enabling_controlword_for_any_statusword():
    for sw in range(0, 0x10000, 7):  # a sweep over the whole 16-bit range, every combination of the masked bits included
        for enable, edge in itertools.product((False, True), repeat=2):
            assert next_controlword(sw, enable=enable, quick_stop=True, reset_edge=edge) not in cia402.ADVANCING


def test_releasing_a_held_quick_stop_with_enable_asks_for_operation_enabled():
    assert next_controlword(0x0007, enable=True, quick_stop=False, reset_edge=False) == 0x000F   # CiA 402 transition 16 (605Ah 5-7)
    assert next_controlword(0x0007, enable=False, quick_stop=False, reset_edge=False) == 0x0000


def test_fault_without_an_edge_never_enables():
    for sw in (0x0008, 0x000F, 0x0008 | 0x0200):
        assert next_controlword(sw, enable=True, quick_stop=False, reset_edge=False) == 0x0000


def test_neutral_fault():
    assert neutral_fault(0x7500, {"0x7500": "COMMAND_TIMEOUT"}) == "COMMAND_TIMEOUT"
    assert neutral_fault(0x1234, {}) == "EXTERNAL_TRIP"
    assert neutral_fault(0x2222, {"0x2222": "OTHER"}) == "EXTERNAL_TRIP"


def test_unwrap32_crossing_up_and_down():
    u = Unwrap32()
    a = u.update(2**31 - 10)
    assert u.update(-2**31 + 10) - a == 20
    u = Unwrap32()
    a = u.update(-2**31 + 10)
    assert u.update(2**31 - 10) - a == -20


def test_unwrap32_ten_wraps_in_one_direction():
    u, raw, total, step = Unwrap32(), 0, 0, 2**30 + 12345
    u.update(raw)
    for _ in range(40):  # 40 steps of a bit more than 2**30 wrap the int32 more than ten times
        total += step
        raw = (raw + step + 2**31) % 2**32 - 2**31
        assert u.update(raw) == total
    assert total > 10 * 2**32


UNITS = {"positionCountsPerRev": {"value": 131072}, "velocityRawPerRadS": {"value": 20860.76}, "ratedTorqueNm": {"value": 0.32}, "polarity": -1, "gearRatio": 1}


def test_units_apply_the_factor_and_the_polarity():
    assert velocity_to_raw(2.0, UNITS) == round(-2.0 * 20860.76)
    assert velocity_from_raw(round(-2.0 * 20860.76), UNITS) == pytest.approx(2.0, abs=1e-4)
    assert position_from_raw(131072, UNITS) == pytest.approx(-2 * math.pi)
    assert torque_from_raw(500, UNITS) == pytest.approx(0.16)
    assert torque_from_raw(None, UNITS) is None
    assert torque_from_raw(500, UNITS | {"ratedTorqueNm": None}) is None
