import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'robotics' / 'bench'))

import importlib.util
import json
import math
import random
import subprocess

import pytest

from bench_worker import BenchError
from bench_worker import imu_wit, lidar_ld19
from bench_worker.sensor_session import SensorSession

BENCH = Path(__file__).resolve().parents[2] / 'robotics' / 'bench'
FIX = BENCH / 'fixtures'
BYTES = FIX / 'bytes'


def make_bytes():
    spec = importlib.util.spec_from_file_location('make_bytes', FIX / 'make_bytes.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def frames_of(raw, n, size):
    return [raw[i * size:(i + 1) * size] for i in range(n)]


LD = (BYTES / 'ld19-synth.bin').read_bytes()
WIT = (BYTES / 'wit-synth.bin').read_bytes()


def wit_frame(kind, values, bad=False):
    body = bytes([0x55, kind]) + b''.join((v & 0xFFFF).to_bytes(2, 'little') for v in values)
    return body + bytes([(sum(body) + (1 if bad else 0)) & 0xFF])


def ld_frame(start=0, dist=1000):
    body = bytes([0x54, 0x2C]) + (3600).to_bytes(2, 'little') + start.to_bytes(2, 'little') + b''.join(dist.to_bytes(2, 'little') + b'\xc8' for _ in range(12)) \
        + (start + 880).to_bytes(2, 'little') + (1234).to_bytes(2, 'little')
    return body + bytes([lidar_ld19.crc8(body)])


# ---- the generator ----
def test_make_bytes_gives_the_committed_files_byte_for_byte():
    m = make_bytes()
    assert m.ld19_bytes() == LD and len(LD) == 100 * 47
    assert m.wit_bytes() == WIT and len(WIT) == 300 * 11
    assert m.ld19_bytes() == m.ld19_bytes()   # no clock, no randomness


def test_the_synthetic_frames_have_the_shape_the_brief_asks_for():
    frames, dropped = lidar_ld19.parse(bytearray(LD))
    assert (len(frames), dropped) == (100, 0)
    assert all(p == (1000, 200) for f in frames for p in f['points'])
    steps = [round((b['startDeg'] - a['startDeg']) % 360, 2) for a, b in zip(frames, frames[1:])]
    assert set(steps) == {9.6}   # 12 points x 0.8 degrees
    samples, dropped = imu_wit.parse(bytearray(WIT))
    assert dropped == 0 and [s['type'] for s in samples[:6]] == [0x51, 0x52, 0x53, 0x51, 0x52, 0x53] and len(samples) == 300


# ---- LD19 (manual V2.3 pages 7-11) ----
MANUAL_EXAMPLE = bytes.fromhex(
    '54 2C 68 08 AB 7E E0 00 E4 DC 00 E2 D9 00 E5 D5 00 E3 D3 00 E4 D0 00 E9 CD 00 E4 CA 00 E2 C7 00 E9 C5 00 E5 C2 00 E5 C0 00 E5 BE 82 3A 1A 50')


def test_the_manual_example_frame_is_decoded_with_its_own_crc():
    assert len(MANUAL_EXAMPLE) == lidar_ld19.FRAME_LEN == 47
    assert lidar_ld19.crc8(MANUAL_EXAMPLE[:46]) == 0x50
    frames, dropped = lidar_ld19.parse(bytearray(MANUAL_EXAMPLE))
    assert dropped == 0 and len(frames) == 1
    f = frames[0]
    assert (f['speedDegS'], f['startDeg'], f['endDeg'], f['sensorMs']) == (2152, 324.27, 334.7, 0x1A3A)
    assert f['points'][0] == (224, 228) and f['points'][1] == (0xDC, 0xE2) and len(f['points']) == 12   # the manual's table says 200 mm for 0xDC: 220 is right


def test_the_crc_table_is_the_manuals_and_is_crc8_with_polynomial_0x4d():
    def table(poly):
        out = []
        for i in range(256):
            c = i
            for _ in range(8):
                c = ((c << 1) ^ poly) & 0xFF if c & 0x80 else (c << 1) & 0xFF
            out.append(c)
        return out
    assert list(lidar_ld19._CRC) == table(0x4D)
    assert lidar_ld19._CRC[1] == 0x4D and lidar_ld19._CRC[255] == 0xA8   # first and last entries as printed on pages 8 and 9


def test_ld19_truncated_start_resynchronises():
    frames, dropped = lidar_ld19.parse(bytearray(LD[10:]))
    assert (len(frames), dropped) == (99, 37)


def test_ld19_one_flipped_bit_loses_exactly_that_frame():
    raw = bytearray(LD)
    raw[49 * 47 + 20] ^= 0x04
    frames, dropped = lidar_ld19.parse(raw)
    assert (len(frames), dropped) == (99, 47)
    good = lidar_ld19.parse(bytearray(LD))[0]
    assert frames == good[:49] + good[50:]   # nothing of the damaged frame survives


def test_ld19_header_bytes_inside_the_data_do_not_break_a_valid_frame():
    inside = ld_frame(dist=0x2C54)   # the two bytes 54 2C are in every point
    assert b'\x54\x2c' in inside[2:]
    frames, dropped = lidar_ld19.parse(bytearray(LD[:49 * 47] + inside + LD[50 * 47:]))
    assert (len(frames), dropped) == (100, 0)
    assert frames[49]['points'][0][0] == 0x2C54


def test_ld19_byte_by_byte_equals_all_at_once():
    whole = lidar_ld19.parse(bytearray(LD[3:]))
    buf, frames, dropped = bytearray(), [], 0
    for b in LD[3:]:
        buf.append(b)
        f, d = lidar_ld19.parse(buf)
        frames += f
        dropped += d
    assert (frames, dropped) == whole and len(buf) == 0


def test_ld19_keeps_a_partial_frame_in_the_buffer():
    buf = bytearray(LD[:100])
    frames, dropped = lidar_ld19.parse(buf)
    assert (len(frames), dropped, len(buf)) == (2, 0, 6)


def test_ld19_bad_crc_frame_with_a_good_frame_hidden_after_one_byte():
    one = ld_frame()
    frames, dropped = lidar_ld19.parse(bytearray(b'\x54' + one))   # a stray header byte, then a good frame
    assert len(frames) == 1 and dropped == 1


# ---- WitMotion (SDK sources) ----
def test_wit_scaling():
    g = 9.80665
    f, dropped = imu_wit.parse(bytearray(wit_frame(0x51, [0, 0, 2048, 0])))
    assert dropped == 0 and f == [{'type': 0x51, 'values': [0, 0, 2048, 0]}]
    assert imu_wit.scale(f[0])['accelMps2'][2] == 2048 / 32768 * 16 * g
    s = imu_wit.scale(imu_wit.parse(bytearray(wit_frame(0x52, [16384, -16384, 0, 0])))[0][0])
    assert s['gyroRadS'][0] == math.radians(1000) and s['gyroRadS'][1] == -math.radians(1000)
    r = imu_wit.scale(imu_wit.parse(bytearray(wit_frame(0x53, [0, 0, 16384, 0])))[0][0])
    assert r['rpyRad'][2] == pytest.approx(math.pi / 2)
    assert imu_wit.scale({'type': 0x50, 'values': [0, 0, 0, 0]}) is None


def test_wit_bad_checksum_gives_no_sample_and_one_byte_is_dropped_before_it_resynchronises():
    good = wit_frame(0x51, [1, 2, 3, 4])
    f, dropped = imu_wit.parse(bytearray(wit_frame(0x52, [7, 8, 9, 10], bad=True)))
    assert f == [] and dropped == 11   # the SDK drops one byte at a time, so a lone bad frame costs all 11
    f, dropped = imu_wit.parse(bytearray(b'\x55' + good))   # a stray 0x55 in front: exactly one byte is dropped, then the next frame is read
    assert [x['values'] for x in f] == [[1, 2, 3, 4]] and dropped == 1
    f, dropped = imu_wit.parse(bytearray(wit_frame(0x52, [7, 8, 9, 10], bad=True) + good))
    assert [x['values'] for x in f] == [[1, 2, 3, 4]] and dropped == 11


def test_wit_flipped_bit_in_one_frame_and_byte_by_byte():
    raw = bytearray(WIT)
    raw[100 * 11 + 4] ^= 0x10
    frames, dropped = imu_wit.parse(bytearray(raw))
    assert len(frames) == 299 and dropped == 11
    buf, got, lost = bytearray(), [], 0
    for b in raw:
        buf.append(b)
        f, d = imu_wit.parse(buf)
        got += f
        lost += d
    assert (got, lost) == (frames, dropped)


@pytest.mark.parametrize('mod', [lidar_ld19, imu_wit])
def test_arbitrary_bytes_never_raise_and_never_give_a_frame_with_a_bad_checksum(mod):
    rng = random.Random(20261126)
    raw = bytes(rng.randrange(256) for _ in range(10_000))
    # headers every 97 bytes, and real frames between noise: all of them come out, and every frame that comes out is found, checksum included, in the input
    spiced, size, real = bytearray(raw), mod.FRAME_LEN, (LD if mod is lidar_ld19 else WIT)
    for i in range(0, 9_900, 97):
        spiced[i:i + 2] = (b'\x54\x2c' if mod is lidar_ld19 else b'\x55\x51')
    embedded = bytearray()
    for k in range(30):
        embedded += raw[k * 53:k * 53 + 20 + k] + real[k * size:(k + 1) * size]
    for data in (bytearray(raw), spiced, embedded):
        for chunk in (len(data), 1, 13):
            buf, frames = bytearray(), []
            for i in range(0, len(data), chunk):
                buf += data[i:i + chunk]
                f, d = mod.parse(buf)
                assert d >= 0
                frames += f
            assert len(buf) < size
            for f in frames:
                if mod is lidar_ld19:
                    body = bytes([0x54, 0x2C]) + f['speedDegS'].to_bytes(2, 'little') + round(f['startDeg'] * 100).to_bytes(2, 'little') \
                        + b''.join(d.to_bytes(2, 'little') + bytes([i]) for d, i in f['points']) + round(f['endDeg'] * 100).to_bytes(2, 'little') + f['sensorMs'].to_bytes(2, 'little')
                    raw_frame = body + bytes([lidar_ld19.crc8(body)])
                else:
                    body = bytes([0x55, f['type']]) + b''.join((v & 0xFFFF).to_bytes(2, 'little') for v in f['values'])
                    raw_frame = body + bytes([sum(body) & 0xFF])
                assert raw_frame in bytes(data)
            if data is embedded:
                assert len(frames) >= 30


# ---- the sensors role ----
def kit(**sim):
    k = json.loads((FIX / 'kit-sim-v1.json').read_text())
    k['simSlave'].update({'sensorBytes': {'lidar': str(BYTES / 'ld19-synth.bin'), 'imu': str(BYTES / 'wit-synth.bin')}} | sim)
    return k


def session(k=None, read_only=False, opened=True):
    s = SensorSession(k or kit(), str(FIX), read_only=read_only)
    if opened:
        s.handle('open', {}, 0)
    return s


def test_describe_open_step_and_stop():
    s = session(opened=False)
    d = s.handle('describe', {}, 0)
    assert d['role'] == 'sensors' and d['backend'] == 'sim' and d['sensors'] == {'lidar': True, 'imu': True}
    with pytest.raises(BenchError) as e:
        s.handle('step', {'commands': []}, 0)
    assert e.value.code == 'BENCH_ORDER_VIOLATION'
    s.handle('open', {}, 0)
    total = {'frames': 0, 'dropped': 0, 'samples': 0}
    for t in range(100):
        r = s.handle('step', {'commands': []}, t)
        total['frames'] += len(r['lidar']['frames'])
        total['dropped'] += r['lidar']['droppedBytes'] + r['imu']['droppedBytes']
        total['samples'] += len(r['imu']['samples'])
    assert s.tick == 100
    assert total['dropped'] == 0 and 748 <= total['frames'] <= 752   # 7.5 frames a tick: 375 frames a second, 4500 points a second
    assert total['samples'] == 200                                       # two samples (accel, gyro, angle) a tick: 100 Hz
    one = s.handle('step', {'commands': []}, 100)['imu']['samples'][0]
    assert set(one) == {'accelMps2', 'gyroRadS', 'rpyRad'} and len(one['accelMps2']) == 3
    assert s.handle('stop', {}, s.tick) == {}


def test_only_five_ops_and_no_drive_commands():
    s = session()
    for op in ('scan', 'configure', 'start', 'silence'):
        with pytest.raises(BenchError) as e:
            s.handle(op, {}, 0)
        assert e.value.code == 'BENCH_ORDER_VIOLATION'
    with pytest.raises(BenchError) as e:
        s.handle('step', {'commands': [{'axisId': 'a'}]}, 0)
    assert e.value.code == 'BENCH_ORDER_VIOLATION'
    with pytest.raises(BenchError) as e:
        s.handle('step', {'commands': []}, 5)   # expectedTick
    assert e.value.code == 'BENCH_ORDER_VIOLATION'


def test_imu_configure_records_and_read_only_refuses():
    s = session()
    cfg = {'baud': 115200, 'rateHz': 100, 'algorithm': '6axis'}
    assert s.handle('imuConfigure', cfg, 0) == cfg
    with pytest.raises(BenchError) as e:
        s.handle('imuConfigure', {'baud': 1, 'rateHz': 100, 'algorithm': 'x'}, 0)
    assert e.value.code == 'BENCH_ORDER_VIOLATION'
    ro = session(read_only=True)
    with pytest.raises(BenchError) as e:
        ro.handle('imuConfigure', cfg, 0)
    assert e.value.code == 'BENCH_READ_ONLY'
    assert ro.handle('step', {'commands': []}, 0)['imu']['samples'] is not None   # reading is allowed


def test_corrupt_every_makes_the_decoder_drop_those_frames():
    s = session(kit(sensorCorruptEvery=10))
    frames = dropped = 0
    for t in range(200):
        r = s.handle('step', {'commands': []}, t)
        frames += len(r['lidar']['frames'])
        dropped += r['lidar']['droppedBytes']
    lost = dropped / lidar_ld19.FRAME_LEN
    assert 0.09 <= lost / (lost + frames) <= 0.11


def test_a_missing_or_wrong_source_is_refused_at_open_and_a_kit_without_sources_has_none():
    with pytest.raises(BenchError) as e:
        session(kit(sensorBytes={'lidar': str(BYTES / 'nope.bin')}))
    assert e.value.code == 'BENCH_SENSOR_BYTES_INVALID'
    none = json.loads((FIX / 'kit-sim-v1.json').read_text())
    s = session(none)
    assert s.handle('describe', {}, 0)['sensors'] == {'lidar': False, 'imu': False}
    r = s.handle('step', {'commands': []}, 0)
    assert r == {'lidar': {'frames': [], 'droppedBytes': 0}, 'imu': {'samples': [], 'droppedBytes': 0}}


def test_a_relative_source_is_relative_to_the_kit_file():
    s = SensorSession(kit(sensorBytes={'lidar': 'bytes/ld19-synth.bin'}), str(FIX), read_only=False)
    s.handle('open', {}, 0)
    assert s.handle('describe', {}, 0)['sensors'] == {'lidar': True, 'imu': False}


CODE = ("import sys, json; sys.path.insert(0, sys.argv.pop(1))\n"
        "from bench_worker.__main__ import main\n"
        "rc = main(sys.argv[1:])\n"
        "print(json.dumps([rc, sorted(m for m in sys.modules if m.startswith('bench_worker'))]))\n")


def run_role(role):
    """Starts the role for real (stdin at end of file is a stop), then reports which bench_worker modules the process imported."""
    p = subprocess.run([sys.executable, '-I', '-B', '-c', CODE, str(BENCH), '--role', role, '--kit', str(FIX / 'kit-sim-v1.json'), '--bus', 'sim', '--session-id', 't'],
                       stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    rc, modules = json.loads(p.stdout.strip().splitlines()[-1])
    assert rc == 0
    return p, set(modules)


def test_the_two_roles_never_import_each_others_modules():
    bus_only = {'bench_worker.bus', 'bench_worker.bus_sim', 'bench_worker.session', 'bench_worker.channel', 'bench_worker.cia402', 'bench_worker.stopseq', 'bench_worker.units'}
    sensor_only = {'bench_worker.sensor_session', 'bench_worker.lidar_ld19', 'bench_worker.imu_wit'}
    _, sensors = run_role('sensors')
    _, bus = run_role('bus')
    assert sensor_only <= sensors and not (bus_only & sensors), sensors   # the positive half makes a renamed module fail this test too
    assert {'bench_worker.bus_sim', 'bench_worker.session'} <= bus and not (sensor_only & bus), bus


def test_the_sensors_role_ends_with_a_plain_stopped_event():
    p, _ = run_role('sensors')
    assert json.loads(p.stderr.strip().splitlines()[-1]) == {'event': 'stopped'}
