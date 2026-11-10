"""Extern Webots supervisor, run as its own process by the worker. It steps with the robot controllers and reports each robot's base pose, orientation and velocity, the
contact points of its body solids (wheels and casters are not tracked: they stand on the floor), and on request the model as the engine loaded it."""
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
    return {"robots": out}


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
        reply = {"time": sup.getTime(), "robots": robots_out, "contacts": contacts}
    sys.stdout.write(json.dumps(reply) + "\n")
    sys.stdout.flush()
