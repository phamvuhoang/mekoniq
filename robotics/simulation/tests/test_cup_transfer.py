"""BV-04/05: the cup's attachment parent in the simulated cell changes only on full evidence (grasp: gripper closed + object present + lift;
tray: release + receiver presence + dock in tolerance). A release ACK alone leaves the cup with the arm; one parent at a time, always."""
import math

import pytest

from beverage_cell import CellLayout, SensorZone, cup_pose_in_world, in_zone, liquid_estimate
from cup_transfer import AttachmentLedger, TransferError

LAYOUT = CellLayout(cell_base=(3.0, 1.0, 0.9, 0.0), nozzle_offset=(0.0, 0.1, 0.05), pickup_pose=(3.0, 1.0, 0.0), tray_slot_offsets={1: (0.0, 0.0, 0.5)})


def ledger():
    return AttachmentLedger("cup-1", initial_parent={"kind": "cell", "id": "coffee-1", "frame": "nozzle"})


def test_grasp_evidence_moves_the_cup_to_the_arm_and_release_ack_alone_leaves_it_there():
    l = ledger()
    with pytest.raises(TransferError, match="TRANSFER_EVIDENCE_INCOMPLETE"):
        l.attach_to_arm("t-1", "arm-1", {"gripperClosed": True, "objectPresent": True})
    assert l.owner() == "cell:coffee-1"
    l.attach_to_arm("t-1", "arm-1", {"gripperClosed": True, "objectPresent": True, "liftPoseReached": True, "source": "mock_arm"})
    assert l.owner() == "arm:arm-1" and l.parent()["frame"] == "tcp"
    with pytest.raises(TransferError, match="TRANSFER_EVIDENCE_INCOMPLETE"):
        l.release_to_tray("t-2", "amr-1", 1, giver={"released": True, "source": "mock_arm"}, receiver=None)
    assert l.owner() == "arm:arm-1"
    with pytest.raises(TransferError, match="TRANSFER_EVIDENCE_INCOMPLETE"):
        l.release_to_tray("t-2", "amr-1", 1, giver={"released": True, "source": "mock_arm"}, receiver={"receiverPresent": True, "dockInTolerance": False, "source": "mock_amr"})
    l.release_to_tray("t-2", "amr-1", 1, giver={"released": True, "source": "mock_arm"}, receiver={"receiverPresent": True, "dockInTolerance": True, "source": "mock_amr"})
    assert l.owner() == "robot:amr-1/tray:1" and [m["transferId"] for m in l.movements] == ["t-1", "t-2"]
    assert l.movements[1]["evidence"]["receiver"]["source"] == "mock_amr" and l.movements[1]["evidence"]["giver"]["source"] == "mock_arm"


def test_a_repeated_transfer_id_is_absorbed_and_a_wrong_owner_is_refused():
    l = ledger()
    ev = {"gripperClosed": True, "objectPresent": True, "liftPoseReached": True, "source": "mock_arm"}
    l.attach_to_arm("t-1", "arm-1", ev)
    l.attach_to_arm("t-1", "arm-1", ev)
    assert len(l.movements) == 1
    with pytest.raises(TransferError, match="CUP_OWNER_MISMATCH"):
        l.attach_to_arm("t-9", "arm-2", ev)


def test_cup_pose_follows_its_parent_frame_and_sensor_zones_use_the_cup_centre():
    nozzle = cup_pose_in_world({"kind": "cell", "id": "coffee-1", "frame": "nozzle"}, LAYOUT, arm_tcp=None, robot_pose=None)
    assert nozzle == (3.0, 1.1, 0.95)
    tcp = cup_pose_in_world({"kind": "arm", "id": "arm-1", "frame": "tcp"}, LAYOUT, arm_tcp=(2.5, 1.2, 1.1), robot_pose=None)
    assert tcp == (2.5, 1.2, 1.1)
    tray = cup_pose_in_world({"kind": "robot", "id": "amr-1", "frame": "tray", "slot": 1}, LAYOUT, arm_tcp=None, robot_pose=(2.98, 1.02, 0.1))
    assert tray == pytest.approx((2.98, 1.02, 0.5))
    zone = SensorZone("tray-1", center=(2.98, 1.02, 0.5), radius_m=0.05)
    assert in_zone(tray, zone) and not in_zone(nozzle, zone)
    with pytest.raises(ValueError, match="FRAME_UNKNOWN"):
        cup_pose_in_world({"kind": "arm", "id": "arm-1", "frame": "tcp"}, LAYOUT, arm_tcp=None, robot_pose=None)


def test_liquid_estimate_is_modelled_and_bounded_by_the_cup():
    e = liquid_estimate(volume_m3=0.00011, cup_capacity_m3=0.0003, density_kg_per_m3=1030.0)
    assert e == {"volumeM3": 0.00011, "massKg": pytest.approx(0.1133), "fillRatio": pytest.approx(0.36666, abs=1e-4), "provenance": "modelled",
                 "assumptions": ["density 1030.0 kg/m3 assumed for the mixed drink", "no fluid dynamics: scalar fill only"]}
    with pytest.raises(ValueError, match="CUP_CAPACITY_EXCEEDED"):
        liquid_estimate(volume_m3=0.00031, cup_capacity_m3=0.0003, density_kg_per_m3=1000.0)
    assert math.isclose(liquid_estimate(0.0, 0.0003, 1000.0)["massKg"], 0.0)
