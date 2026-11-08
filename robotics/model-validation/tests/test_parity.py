from types import SimpleNamespace as NS

from linkforge_worker.parity import compare, from_model, from_urdf_xml
from tests.helpers import box_inertia, joint, link, model, urdf


def raw():
    return from_model(model())


def clone(d):
    import copy
    return copy.deepcopy(d)


def test_identical_descriptions_have_no_findings():
    assert compare(raw(), clone(raw()), "LF") == []
    assert compare(raw(), from_urdf_xml(urdf(model())), "URDF_MODEL") == []


def test_same_link_count_but_different_set_is_loss_and_extra():
    a, b = raw(), clone(raw())
    b["links"]["intruder"] = b["links"].pop("tray/plate")  # still two links
    found = {(f["code"], f["entityId"]) for f in compare(a, b, "LF")}
    assert ("LF_IMPORT_LOSS", "tray/plate") in found and ("LF_IMPORT_MUTATION", "intruder") in found


def test_changed_inertia_is_a_mutation_with_the_link_id():
    a, b = raw(), clone(raw())
    b["links"]["chassis/base"]["inertia"][0] = 1e-9
    f = compare(a, b, "LF")
    assert [(x["code"], x["entityId"], x["linkId"]) for x in f] == [("LF_IMPORT_MUTATION", "chassis/base", "chassis/base")]


def test_tolerances_are_absolute_1e12_or_relative_1e9():
    a, b = raw(), clone(raw())
    b["links"]["chassis/base"]["mass"] += 1e-13
    assert compare(a, b, "LF") == []
    b["links"]["chassis/base"]["mass"] += 1e-6
    assert [x["code"] for x in compare(a, b, "LF")] == ["LF_IMPORT_MUTATION"]
    b["links"]["chassis/base"]["mass"] = a["links"]["chassis/base"]["mass"] * (1 + 5e-10)
    assert compare(a, b, "LF") == []


def test_joint_topology_type_axis_origin_and_limits_are_compared():
    m = model([link("a"), link("b"), link("c")], [joint("j1", "a", "b", "continuous"), joint("j2", "b", "c")])
    a = from_model(m)
    for edit in (lambda j: j.update(parent="c"), lambda j: j.update(type="fixed"), lambda j: j.update(axis=[1.0, 0.0, 0.0]),
                 lambda j: j["xyz"].__setitem__(2, 0.5), lambda j: j["limits"].update(velocity=1.0)):
        b = clone(a)
        edit(b["joints"]["j1"])
        f = compare(a, b, "LF")
        assert [x["entityId"] for x in f] == ["j1"] and f[0]["jointId"] == "j1", edit


def test_shapes_are_compared_in_count_kind_and_size():
    a, b = raw(), clone(raw())
    b["links"]["chassis/base"]["collision"] = []
    assert [x["code"] for x in compare(a, b, "LF")] == ["LF_IMPORT_LOSS"]
    b = clone(a)
    b["links"]["chassis/base"]["collision"][0]["size"] = [0.5, 0.4, 0.2]
    assert [x["code"] for x in compare(a, b, "LF")] == ["LF_IMPORT_MUTATION"]


def test_a_model_without_inertia_is_described_as_missing_not_zero():
    m = model([link("a", inertiaKgM2=None)], [])
    assert from_model(m)["links"]["a"]["inertia"] is None
    assert box_inertia(1, (1, 1, 1))[0] > 0
