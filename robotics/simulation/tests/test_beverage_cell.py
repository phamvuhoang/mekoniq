"""BV-03/04 geometry side of the coffee cell in the SIL world: cup collider, nozzle/pickup/tray frames, sensor zones and the SDF models the compiled
world receives. The process model (brew/ice/milk quantities) lives in the shared coffee_io_sim adapter; this is only where the cup is."""
import pytest

from beverage_cell import CellLayout, SensorZone, cell_models_sdf, cell_scene_index, single_actuator_authority


def test_cell_layout_emits_cup_collider_nozzle_pickup_and_tray_zones():
    layout = CellLayout(cell_base=(3.0, 1.0, 0.9, 0.0), nozzle_offset=(0.0, 0.1, 0.05), pickup_pose=(3.0, 1.0, 0.0), tray_slot_offsets={1: (0.0, 0.0, 0.5)})
    sdf = cell_models_sdf(layout, cup_id="cup-1", cup_radius_m=0.035, cup_height_m=0.09)
    assert '<model name="cup_cup-1">' in sdf and "<collision" in sdf and "<pose>3 1.1 0.995" in sdf
    index = cell_scene_index(layout, cups=["cup-1"], arm_id="arm-1", cell_id="coffee-1", robot_ids=["amr-1"])
    assert index["frames"] == {"cell_base": [3.0, 1.0, 0.9, 0.0], "nozzle": [3.0, 1.1, 0.95], "pickup": [3.0, 1.0, 0.0]}
    assert index["zones"] == [{"id": "nozzle", "center": [3.0, 1.1, 0.95], "radiusM": 0.03, "sensor": "coffee-1:cup"}, {"id": "tray:amr-1:1", "center": None, "radiusM": 0.05, "sensor": "amr-1:tray-1", "follows": "amr-1"}]
    assert index["cups"] == [{"id": "cup-1", "gazeboModel": "cup_cup-1", "parent": {"kind": "cell", "id": "coffee-1", "frame": "nozzle"}}]
    assert index["telemetry"]["cup_cup-1"] == {"pose": "/model/cup_cup-1/pose", "contacts": "/model/cup_cup-1/contacts"}


def test_single_actuator_authority_per_joint_fails_on_two_publishers():
    ok = single_actuator_authority([{"joint": "J1", "controller": "linuxcnc_sim"}, {"joint": "J2", "controller": "linuxcnc_sim"}])
    assert ok == {"ok": True, "conflicts": []}
    bad = single_actuator_authority([{"joint": "J1", "controller": "linuxcnc_sim"}, {"joint": "J1", "controller": "ros2_control"}])
    assert bad == {"ok": False, "conflicts": [{"joint": "J1", "controllers": ["linuxcnc_sim", "ros2_control"]}]}
    with pytest.raises(ValueError, match="JOINT_AUTHORITY_CONFLICT"):
        single_actuator_authority([{"joint": "J1", "controller": "a"}, {"joint": "J1", "controller": "b"}], strict=True)


def test_sensor_zone_requires_positive_radius():
    with pytest.raises(ValueError, match="ZONE_INVALID"):
        SensorZone("z", center=(0, 0, 0), radius_m=0)
