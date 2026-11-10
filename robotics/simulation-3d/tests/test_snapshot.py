import math

import pytest

from webots_worker.snapshot import SnapshotError, base_state, beam, body_velocity, collision_ids, drive_pose, lidar_scan, wheel_speeds

R = 0.09
SEP = 0.36
EYE = [1, 0, 0, 0, 1, 0, 0, 0, 1]
TABLE = [[3.6, 2.6], [4.4, 2.6], [4.4, 3.4], [3.6, 3.4]]


def test_body_velocity_to_wheel_speeds():
    left, right = wheel_speeds(0.5, 0.0, R, SEP)
    assert left == pytest.approx(0.5 / R) and right == pytest.approx(0.5 / R)
    left, right = wheel_speeds(0.0, 1.0, R, SEP)
    assert left == pytest.approx(-0.18 / R) and right == pytest.approx(0.18 / R)  # turning left: the right wheel is faster


def test_wheel_floor_contacts_are_not_collisions():
    contacts = [{"solid": "wheel-left_rim", "point": [3.5, 3.0, 0.0]}, {"solid": "caster-front_ball", "point": [3.5, 3.0, 0.0]}]
    assert collision_ids(contacts, {"chassis_base"}, {"table-05": TABLE}, {}, "amr-1") == []


def test_body_obstacle_contact_yields_obstacle_id():
    contacts = [{"solid": "chassis_base", "point": [3.58, 3.0, 0.15]}, {"solid": "chassis_base", "point": [3.59, 3.1, 0.15]}]
    assert collision_ids(contacts, {"chassis_base"}, {"table-05": TABLE, "table-06": [[9, 9], [10, 9], [10, 10]]}, {}, "amr-1") == ["table-05"]


def test_body_contact_with_another_robot_is_named_by_its_robot_id():
    other = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]
    contacts = [{"solid": "chassis_base", "point": [0.5, 1.01, 0.1]}]
    assert collision_ids(contacts, {"chassis_base"}, {}, {"robot02": other}, "robot01") == ["robot02"]
    assert collision_ids(contacts, {"chassis_base"}, {}, {"robot01": other}, "robot01") == ["engine:unattributed"]  # a robot never collides with itself


def test_unexplained_body_contact_is_still_a_contact():
    assert collision_ids([{"solid": "chassis_base", "point": [50.0, 50.0, 0.1]}], {"chassis_base"}, {"table-05": TABLE}, {}, "amr-1") == ["engine:unattributed"]


def test_nan_pose_raises_PLANT_UNSTABLE():
    for bad in ([math.nan, 0, 0.1], [0, math.inf, 0.1]):
        with pytest.raises(SnapshotError) as e:
            base_state(bad, EYE, [0] * 6)
        assert e.value.code == "PLANT_UNSTABLE"
    with pytest.raises(SnapshotError):
        base_state([0, 0, 0.1], [math.nan] * 9, [0] * 6)
    with pytest.raises(SnapshotError):
        base_state([0, 0, 0.1], EYE, [0, 0, 0, 0, 0, math.nan])


def test_base_state_reads_yaw_roll_pitch_and_planar_velocity():
    yaw = 0.5
    c, s = math.cos(yaw), math.sin(yaw)
    st = base_state([1, 2, 0.09], [c, -s, 0, s, c, 0, 0, 0, 1], [0.3 * c, 0.3 * s, 0, 0, 0, 0.2])
    assert st["yaw"] == pytest.approx(yaw) and st["roll"] == pytest.approx(0) and st["pitch"] == pytest.approx(0) and st["z"] == 0.09
    v, w = body_velocity(st)
    assert v == pytest.approx(0.3) and w == pytest.approx(0.2)
    pitch = 0.1  # nose down by 0.1 rad about +y
    cp, sp = math.cos(pitch), math.sin(pitch)
    tilted = base_state([0, 0, 0.09], [cp, 0, sp, 0, 1, 0, -sp, 0, cp], [0] * 6)
    assert tilted["pitch"] == pytest.approx(-pitch) or tilted["pitch"] == pytest.approx(pitch)
    assert abs(tilted["pitch"]) == pytest.approx(pitch)


def test_drive_pose_is_the_base_pose_composed_with_the_drive_frame():
    base = base_state([2.0, 1.5, 0.09], EYE, [0] * 6)
    assert drive_pose(base, [0, 0, 0], 0.0) == pytest.approx([2.0, 1.5, 0.0])
    # a drive frame 0.2 m ahead of the base origin, base turned +90 degrees: the drive frame is at (2, 1.7)
    turned = base_state([2.0, 1.5, 0.09], [0, -1, 0, 1, 0, 0, 0, 0, 1], [0] * 6)
    assert drive_pose(turned, [0.2, 0, 0], 0.0) == pytest.approx([2.0, 1.7, math.pi / 2])


def test_lidar_beams_map_to_the_scan_vocabulary():
    assert beam(2.5, 0.05, 10) == (2.5, "hit")
    assert beam(math.inf, 0.05, 10) == (None, "no_return")
    assert beam(-math.inf, 0.05, 10) == (None, "below_min")
    assert beam(math.nan, 0.05, 10) == (None, "invalid")
    assert beam(0.01, 0.05, 10) == (None, "below_min")
    with pytest.raises(SnapshotError) as e:
        beam(12.0, 0.05, 10)
    assert e.value.code == "SENSOR_INCONSISTENT"


def test_webots_ray_order_becomes_counter_clockwise_from_minus_pi():
    n = 360
    delta = 2 * math.pi / n
    webots = [float(i + 1) / 100 + 0.05 for i in range(n)]  # ray i points at pi - (i + 1/2) * delta (clockwise from west)
    scan = lidar_scan(webots, sensor_id="lidar-2d", frame_id="lidar", tick=5, range_min=0.05, range_max=10.0, fov=2 * math.pi)
    assert scan["angleMinRad"] == pytest.approx(-math.pi + delta / 2) and scan["angleIncrementRad"] == pytest.approx(delta)
    assert scan["rangesM"][0] == webots[n - 1] and scan["rangesM"][n - 1] == webots[0]
    assert len(scan["rangesM"]) == len(scan["states"]) == n and scan["simTimeNs"] == str(5 * 20_000_000)
    # ray 269 and 270 straddle south (-pi/2): after the reorder they are the two beams around index 89 / 90
    angle = lambda k: scan["angleMinRad"] + k * scan["angleIncrementRad"]
    assert angle(89) < -math.pi / 2 < angle(90) and angle(90) + angle(89) == pytest.approx(-math.pi)
