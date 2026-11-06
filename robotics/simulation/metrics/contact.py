"""Contact evidence from the Gazebo contact sensor (gz.msgs.Contacts as dicts): entity pair, tick, sim time, point, normal, depth. Provenance
physics_sim: a contact in the declared model/world, never a statement about a real robot."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ContactSample:
    tick: int
    sim_time_ns: int
    pair: tuple        # (entity_a, entity_b), sorted
    point: tuple
    normal: tuple
    depth: float
    provenance: str = "physics_sim"


def _entity(collision_name):
    return str(collision_name).split("::")[0]


def _vec(v):
    try:
        return (float(v["x"]), float(v["y"]), float(v["z"]))
    except (KeyError, TypeError, ValueError):
        raise ValueError("CONTACT_INVALID")


def contacts_from_message(msg, tick, sim_time_ns):
    out = []
    for c in (msg or {}).get("contact", []):
        try:
            a, b = _entity(c["collision1"]["name"]), _entity(c["collision2"]["name"])
            positions, normals, depths = c.get("position") or [], c.get("normal") or [], c.get("depth") or []
        except (KeyError, TypeError):
            raise ValueError("CONTACT_INVALID")
        if not positions or not normals or not depths:
            raise ValueError("CONTACT_INVALID")
        out.append(ContactSample(int(tick), int(sim_time_ns), tuple(sorted((a, b))), _vec(positions[0]), _vec(normals[0]), float(depths[0])))
    return out


class ContactLog:
    def __init__(self):
        self.samples = []

    def add(self, samples):
        self.samples.extend(samples)

    @property
    def count(self):
        return len(self.samples)

    def pairs(self):
        out = {}
        for s in self.samples:
            out[s.pair] = out.get(s.pair, 0) + 1
        return out

    def first(self, pair):
        return next((s for s in self.samples if s.pair == pair), None)
