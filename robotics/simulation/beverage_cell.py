"""Geometry of the coffee cell inside a SIL world: cell base, nozzle and pickup frames, tray slots, the cup collider and the sensor zones that
confirm presence. The process model (brew/ice/milk) is the shared coffee_io_sim adapter; this module only says where things are and what a
sensor zone would see. Liquid is a bounded scalar with model provenance; nothing here is a fluid model."""
import math
import re
from dataclasses import dataclass

ID = re.compile(r"^[A-Za-z0-9_.:-]{1,200}$")
NOZZLE_ZONE_RADIUS_M, TRAY_ZONE_RADIUS_M = 0.03, 0.05


@dataclass(frozen=True)
class CellLayout:
    cell_base: tuple          # (x, y, z, yaw) in world
    nozzle_offset: tuple      # (dx, dy, dz) in the cell base frame
    pickup_pose: tuple        # (x, y, yaw) in world: where the robot docks
    tray_slot_offsets: dict   # slot -> (dx, dy, dz) in the robot base frame


@dataclass(frozen=True)
class SensorZone:
    id: str
    center: tuple
    radius_m: float

    def __post_init__(self):
        if not (isinstance(self.radius_m, (int, float)) and self.radius_m > 0) or len(self.center) != 3:
            raise ValueError("ZONE_INVALID")


def _rot(dx, dy, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return c * dx - s * dy, s * dx + c * dy


def _r9(v):
    return round(v, 9)  # stable decimal metres: no binary-float artefacts in frames or indexes


def nozzle_world(layout):
    x, y, z, yaw = layout.cell_base
    dx, dy = _rot(layout.nozzle_offset[0], layout.nozzle_offset[1], yaw)
    return (_r9(x + dx), _r9(y + dy), _r9(z + layout.nozzle_offset[2]))


def cup_pose_in_world(parent, layout, arm_tcp, robot_pose):
    """Cup centre (bottom) in world for its attachment parent: nozzle of the cell, the arm TCP, or a tray slot of a robot."""
    kind = parent.get("kind")
    if kind == "cell":
        return nozzle_world(layout)
    if kind == "arm":
        if arm_tcp is None:
            raise ValueError("FRAME_UNKNOWN: arm tcp")
        return tuple(arm_tcp)
    if kind == "robot":
        if robot_pose is None:
            raise ValueError("FRAME_UNKNOWN: robot pose")
        off = layout.tray_slot_offsets.get(parent.get("slot"))
        if off is None:
            raise ValueError("FRAME_UNKNOWN: tray slot")
        dx, dy = _rot(off[0], off[1], robot_pose[2])
        return (_r9(robot_pose[0] + dx), _r9(robot_pose[1] + dy), _r9(off[2]))
    raise ValueError("FRAME_UNKNOWN")


def in_zone(pose, zone):
    return math.dist(pose, zone.center) <= zone.radius_m


def liquid_estimate(volume_m3, cup_capacity_m3, density_kg_per_m3):
    if volume_m3 < 0 or cup_capacity_m3 <= 0 or density_kg_per_m3 <= 0:
        raise ValueError("LIQUID_INVALID")
    if volume_m3 > cup_capacity_m3:
        raise ValueError("CUP_CAPACITY_EXCEEDED")
    return {"volumeM3": volume_m3, "massKg": volume_m3 * density_kg_per_m3, "fillRatio": volume_m3 / cup_capacity_m3, "provenance": "modelled",
            "assumptions": [f"density {density_kg_per_m3} kg/m3 assumed for the mixed drink", "no fluid dynamics: scalar fill only"]}


def _num(v):
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-", "-0") else "0"


def cell_models_sdf(layout, cup_id, cup_radius_m, cup_height_m):
    """The cup as a kinematic cylinder at the nozzle (the worker re-parents it on evidence) with pose publishing and a contact sensor."""
    if not ID.match(cup_id):
        raise ValueError("ID_INVALID")
    nx, ny, nz = nozzle_world(layout)
    name = f"cup_{cup_id}"
    return f"""    <model name="{name}"><pose>{_num(nx)} {_num(ny)} {_num(nz + cup_height_m / 2)} 0 0 0</pose><link name="link"><gravity>false</gravity>
      <inertial><mass>0.05</mass><inertia><ixx>0.0001</ixx><iyy>0.0001</iyy><izz>0.0001</izz></inertia></inertial>
      <collision name="c"><geometry><cylinder><radius>{_num(cup_radius_m)}</radius><length>{_num(cup_height_m)}</length></cylinder></geometry></collision>
      <visual name="v"><geometry><cylinder><radius>{_num(cup_radius_m)}</radius><length>{_num(cup_height_m)}</length></cylinder></geometry></visual>
      <sensor name="contact" type="contact"><contact><collision>c</collision></contact><topic>/model/{name}/contacts</topic><always_on>true</always_on></sensor></link>
      <plugin filename="gz-sim-pose-publisher-system" name="gz::sim::systems::PosePublisher"><publish_model_pose>true</publish_model_pose><use_pose_vector_msg>true</use_pose_vector_msg></plugin>
    </model>"""


def cell_scene_index(layout, cups, arm_id, cell_id, robot_ids):
    nozzle = nozzle_world(layout)
    zones = [{"id": "nozzle", "center": list(nozzle), "radiusM": NOZZLE_ZONE_RADIUS_M, "sensor": f"{cell_id}:cup"}]
    for rid in robot_ids:
        for slot in sorted(layout.tray_slot_offsets):
            zones.append({"id": f"tray:{rid}:{slot}", "center": None, "radiusM": TRAY_ZONE_RADIUS_M, "sensor": f"{rid}:tray-{slot}", "follows": rid})
    return {"frames": {"cell_base": list(layout.cell_base), "nozzle": list(nozzle), "pickup": list(layout.pickup_pose)}, "armId": arm_id, "cellId": cell_id, "zones": zones,
            "cups": [{"id": c, "gazeboModel": f"cup_{c}", "parent": {"kind": "cell", "id": cell_id, "frame": "nozzle"}} for c in cups],
            "telemetry": {f"cup_{c}": {"pose": f"/model/cup_{c}/pose", "contacts": f"/model/cup_{c}/contacts"} for c in cups}}


def single_actuator_authority(publishers, strict=False):
    """Exactly one controller per joint. Two publishers on one joint is a configuration fault, never a merged command."""
    by_joint = {}
    for p in publishers:
        by_joint.setdefault(p["joint"], set()).add(p["controller"])
    conflicts = [{"joint": j, "controllers": sorted(c)} for j, c in by_joint.items() if len(c) > 1]
    if conflicts and strict:
        raise ValueError(f"JOINT_AUTHORITY_CONFLICT:{conflicts[0]['joint']}")
    return {"ok": not conflicts, "conflicts": conflicts}
