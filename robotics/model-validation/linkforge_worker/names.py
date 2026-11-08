"""Reversible, collision-free renaming of source ids to names the LinkForge parser accepts (it drops links whose names contain '/' and similar)."""
import hashlib
import xml.etree.ElementTree as ET

PREFIX = {"link": "l_", "joint": "j_", "sensor": "s_"}


class NameMapError(Exception):
    def __init__(self, code, detail):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


def make_name_map(ids_by_kind):
    """`l_`/`j_`/`s_` + the full SHA-256 of the UTF-8 source id. Returns {'forward': {kind: {src: mapped}}, 'reverse': {kind: {mapped: src}}}."""
    forward, reverse = {}, {}
    for kind, prefix in PREFIX.items():
        forward[kind], reverse[kind] = {}, {}
        for source in ids_by_kind.get(kind, []):
            if not isinstance(source, str) or not source:
                raise NameMapError("NAME_INVALID", f"empty or non-string {kind} id")
            if source in forward[kind]:
                raise NameMapError("DUPLICATE_ID", f"{kind} id {source!r} appears twice")
            mapped = prefix + hashlib.sha256(source.encode("utf-8")).hexdigest()
            if mapped in reverse[kind]:  # unreachable for sha256, kept as the explicit uniqueness guarantee
                raise NameMapError("NAME_COLLISION", mapped)
            forward[kind][source], reverse[kind][mapped] = mapped, source
    return {"forward": forward, "reverse": reverse}


# (parent tag or None, tag, attribute, kinds tried in order): every place a URDF may name a link or joint.
_ALLOWED = {("link", "name"): ("link",), ("joint", "name"): ("joint",), ("parent", "link"): ("link",), ("child", "link"): ("link",), ("mimic", "joint"): ("joint",),
            ("gazebo", "reference"): ("link", "joint"), ("robot", "name"): ()}


def rewrite_urdf(xml_text, table):
    """Rewrites only allowlisted reference attributes through `table` ({kind: {from: to}}). An attribute elsewhere that equals a known id cannot be mapped safely."""
    root = ET.fromstring(xml_text)
    known = {v for t in table.values() for v in t}
    for el in root.iter():
        for attr, value in list(el.attrib.items()):
            kinds = _ALLOWED.get((el.tag, attr))
            if kinds is None and value in known:
                raise NameMapError("REFERENCE_MAPPING_UNSUPPORTED", f"<{el.tag} {attr}={value!r}> references an id in a place the mapper does not rewrite")
            for kind in kinds or ():
                if value in table.get(kind, {}):
                    el.set(attr, table[kind][value])
                    break
    return ET.tostring(root, encoding="unicode")
