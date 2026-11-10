"""Extern Webots supervisor, run as its own process by the worker. It steps with the robot controllers and reports each robot's base pose, orientation and velocity, the
contact points of its body solids (wheels and casters are not tracked: they stand on the floor), and on request the model as the engine loaded it.
With an `arm` in its config it also reports, per tick, every contact point of the arm's links, in world coordinates (hinged neighbours never collide), and on request the arm's link
masses and each joint's hinge axis and motor limits."""
import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.environ["WEBOTS_HOME"], "Contents", "lib", "controller", "python"))
from controller import Supervisor  # noqa: E402

TICK_MS = 20
cfg = json.loads(sys.argv[1])
sup = Supervisor()


def name_of(node):
    try:
        return node.getField("name").getSFString()
    except Exception:
        return None


def walk(node, out, hinges, parent=None):
    """Every Solid under `node` by name, through children and HingeJoint endPoints; hinges maps the endPoint solid's name to its (axis, anchor)."""
    n = name_of(node)
    if n is not None:
        out[n] = node
    kids = node.getField("children")
    if kids is not None:
        for i in range(kids.getCount()):
            child = kids.getMFNode(i)
            if child.getTypeName() == "HingeJoint":
                end = child.getField("endPoint").getSFNode()
                if end is not None:
                    jp = child.getField("jointParameters").getSFNode()
                    hinges[name_of(end)] = list(jp.getField("axis").getSFVec3f())
                    walk(end, out, hinges, node)
            else:
                walk(child, out, hinges, node)


world = sup.getRoot().getField("children")
robots, trees, hinges, body = {}, {}, {}, {}
for i in range(world.getCount()):
    n = world.getMFNode(i)
    nm = name_of(n)
    if nm in [r["id"] for r in cfg["robots"]]:
        robots[nm] = n
for r in cfg["robots"]:
    trees[r["id"]], hinges[r["id"]] = {}, {}
    walk(robots[r["id"]], trees[r["id"]], hinges[r["id"]])
    body[r["id"]] = [(s, trees[r["id"]][s]) for s in r["bodySolids"]]
    for _, node in body[r["id"]]:
        node.enableContactPointsTracking(TICK_MS, False)


arm_cfg = cfg.get("arm")
arm_node, arm_solids = None, []
if arm_cfg:
    for i in range(world.getCount()):
        if name_of(world.getMFNode(i)) == arm_cfg["name"]:
            arm_node = world.getMFNode(i)
    arm_tree = {}
    walk(arm_node, arm_tree, {})
    arm_solids = [(nm, node) for nm, node in sorted(arm_tree.items()) if node.getField("physics").getSFNode() is not None]  # the base is the static Robot: only the links move and collide
    for _, node in arm_solids:
        node.enableContactPointsTracking(TICK_MS, False)


def arm_contacts():
    out = []
    for nm, node in arm_solids:
        for cp in node.getContactPoints(False):  # cp.node_id is the tracked solid itself, not what it touched: the worker names the other side from the point
            out.append({"solid": nm, "point": list(cp.point)})
    return out


def arm_readback():
    joints, cur = [], arm_node
    while True:
        kids = cur.getField("children")
        hinge = next((kids.getMFNode(i) for i in range(kids.getCount()) if kids.getMFNode(i).getTypeName() == "HingeJoint"), None)
        if hinge is None:
            break
        devices = hinge.getField("device")
        motor = next(devices.getMFNode(i) for i in range(devices.getCount()) if devices.getMFNode(i).getTypeName() == "RotationalMotor")
        joints.append({"name": motor.getField("name").getSFString().removesuffix("_motor"), "axis": list(hinge.getField("jointParameters").getSFNode().getField("axis").getSFVec3f()),
                       "lower": motor.getField("minPosition").getSFFloat(), "upper": motor.getField("maxPosition").getSFFloat()})
        cur = hinge.getField("endPoint").getSFNode()
    return {"links": [{"name": nm, "massKg": node.getField("physics").getSFNode().getField("mass").getSFFloat()} for nm, node in arm_solids], "joints": joints}


def radius_of(node):
    bo = node.getField("boundingObject").getSFNode()
    if bo.getTypeName() == "Pose":
        bo = bo.getField("children").getMFNode(0)
    return bo.getField("radius").getSFFloat()


def readback():
    out = []
    for r in cfg["robots"]:
        tree = trees[r["id"]]
        links = []
        for nm in sorted(tree):
            phys = tree[nm].getField("physics").getSFNode()
            if phys is not None:
                links.append({"name": nm, "massKg": phys.getField("mass").getSFFloat(), "positionMap": list(tree[nm].getPosition())})
        left, right = tree[r["wheelSolids"]["left"]], tree[r["wheelSolids"]["right"]]
        pl, pr = left.getPosition(), right.getPosition()
        out.append({"robotId": r["id"], "links": links, "wheelRadiusM": radius_of(left), "wheelSeparationM": math.dist(pl, pr),
                    "wheelAxes": [hinges[r["id"]][r["wheelSolids"]["left"]], hinges[r["id"]][r["wheelSolids"]["right"]]]})
    return {"robots": out, **({"arm": arm_readback()} if arm_cfg else {})}


sys.stdout.write(json.dumps({"ready": True}) + "\n")
sys.stdout.flush()
for line in sys.stdin:
    cmd = json.loads(line)
    if cmd["cmd"] == "quit":
        break
    if cmd["cmd"] == "readback":
        reply = readback()
    else:
        if sup.step(TICK_MS) < 0:
            sys.exit(3)
        robots_out, contacts = {}, []
        for rid, node in robots.items():
            robots_out[rid] = {"position": list(node.getPosition()), "orientation": list(node.getOrientation()), "velocity": list(node.getVelocity())}
            for solid, snode in body[rid]:
                contacts += [{"robotId": rid, "solid": solid, "point": list(cp.point)} for cp in snode.getContactPoints(False)]
        reply = {"time": sup.getTime(), "robots": robots_out, "contacts": contacts, **({"armContacts": arm_contacts()} if arm_cfg else {})}
    sys.stdout.write(json.dumps(reply) + "\n")
    sys.stdout.flush()
