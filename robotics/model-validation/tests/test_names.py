import pytest

from linkforge_worker.names import NameMapError, make_name_map, rewrite_urdf

URDF = ('<robot name="r"><link name="chassis/body"/><link name="a:b"/><link name="a_b"/>'
        '<joint name="mount:a:b" type="fixed"><parent link="chassis/body"/><child link="a:b"/></joint>'
        '<joint name="j2" type="fixed"><parent link="a:b"/><child link="a_b"/><mimic joint="mount:a:b"/></joint>'
        '<gazebo reference="a_b"/></robot>')


def ids():
    return {"link": ["chassis/body", "a:b", "a_b"], "joint": ["mount:a:b", "j2"], "sensor": ["lidar"]}


def test_names_are_typed_hashes_and_reversible():
    m = make_name_map(ids())
    names = [n for kind in m["forward"].values() for n in kind.values()]
    assert len(names) == len(set(names)) == 6
    assert all(n.startswith(p) and len(n) == 66 and "/" not in n and ":" not in n for k, p in (("link", "l_"), ("joint", "j_"), ("sensor", "s_")) for n in m["forward"][k].values())
    for kind, table in m["forward"].items():
        for src, mapped in table.items():
            assert m["reverse"][kind][mapped] == src
    assert make_name_map(ids()) == m  # deterministic


def test_the_same_id_in_two_kinds_stays_distinct():
    m = make_name_map({"link": ["x"], "joint": ["x"], "sensor": []})
    assert m["forward"]["link"]["x"] != m["forward"]["joint"]["x"]


def test_duplicate_or_empty_ids_are_refused():
    with pytest.raises(NameMapError):
        make_name_map({"link": ["a", "a"], "joint": [], "sensor": []})
    with pytest.raises(NameMapError):
        make_name_map({"link": [""], "joint": [], "sensor": []})


def test_rewrite_maps_only_allowlisted_references_and_round_trips():
    m = make_name_map(ids())
    mapped = rewrite_urdf(URDF, m["forward"])
    assert "chassis/body" not in mapped and "a:b" not in mapped
    assert m["forward"]["link"]["a_b"] in mapped  # gazebo reference too
    assert rewrite_urdf(mapped, m["reverse"]).count("chassis/body") == 2  # the link and the joint parent


def test_a_reference_in_an_unknown_tag_is_not_guessed():
    m = make_name_map(ids())
    with pytest.raises(NameMapError) as e:
        rewrite_urdf('<robot name="r"><link name="chassis/body"/><weird target="chassis/body"/></robot>', m["forward"])
    assert e.value.code == "REFERENCE_MAPPING_UNSUPPORTED"
