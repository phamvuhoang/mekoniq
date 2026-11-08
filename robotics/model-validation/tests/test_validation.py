import copy
import io
import json
from contextlib import redirect_stdout

import pytest

from linkforge_worker.adapter import validate_request
from tests.helpers import codes, joint, link, model, pose, request, urdf

SENSOR = {"sensorId": "lidar", "sourceInstanceId": "chassis", "sensorModelDigest": "a" * 64, "parentLinkId": "chassis/base", "poseInBase": pose(), "model": {}}


def run(tmp_path, m=None, xml=None, **kw):
    m = m or model()
    return validate_request(request(m, xml if xml is not None else urdf(m), tmp_path, **kw))


def check(result, check_id):
    return next(c for c in result["report"]["checks"] if c["id"] == check_id)


def test_lf01_a_valid_robot_passes_with_parity_and_a_reference_export(tmp_path):
    m = model([link("chassis/base", inertiaKgM2=[0.3, 0, 0, 0.5, 0, 0.7]), link("wheel-left/rim", (0.1, 0.05, 0.1), 1.5, inertiaKgM2=[0.01, 0, 0, 0.02, 0, 0.015]),
               link("tray/plate", (0.4, 0.35, 0.01), 1.2, inertiaKgM2=[0.02, 0, 0, 0.03, 0, 0.04])],
              [joint("wheel-left/axle", "chassis/base", "wheel-left/rim", "continuous", axis=(0.0, 1.0, 0.0)), joint("mount:chassis/tray:tray/mount", "chassis/base", "tray/plate")], [SENSOR])
    r = run(tmp_path, m)
    report = r["report"]
    assert (report["execution"], report["result"], report["mode"]) == ("ran", "pass", "shadow")
    assert report["physicalModelDigest"] == m["modelDigest"] and report["robotId"] == "amr-1"
    results = {c["id"]: c["result"] for c in report["checks"]}
    assert {k: results[k] for k in ("MEKONIQ-RAW", "LF-IMPORT", "LF-PARITY", "SOURCE-URDF", "REFERENCE-EXPORT")} == dict.fromkeys(("MEKONIQ-RAW", "LF-IMPORT", "LF-PARITY", "SOURCE-URDF", "REFERENCE-EXPORT"), "pass")
    assert report["engine"]["packageVersion"] == "1.6.0" and report["engine"]["lockDigest"] == "1" * 64
    names = json.loads(r["artifacts"]["name-map.json"])
    assert names["forward"]["link"]["chassis/base"].startswith("l_")
    assert "chassis/base" in r["artifacts"]["reference.urdf"] and "l_" not in r["artifacts"]["reference.urdf"]  # source ids restored
    assert report["referenceSrdfRef"] is None and "SEMANTIC_PROFILE_NOT_SUPPLIED" in json.dumps(report["checks"])


def test_lf01_the_reference_export_is_withheld_not_trusted_when_linkforge_rounds_a_tensor(tmp_path):
    small = model([link("chassis/base"), link("wheel/rim", (0.1, 0.05, 0.1), 1.5)], [joint("j", "chassis/base", "wheel/rim")])
    r = run(tmp_path, small)  # ixx=0.0015625 becomes 0.001563 in LinkForge's 6-decimal serializer: relative error 3e-4 > the declared 1e-5
    assert r["report"]["result"] == "pass" and check(r, "LF-PARITY")["result"] == "pass"  # the *input* was imported without loss
    assert check(r, "REFERENCE-EXPORT")["result"] == "not_run" and "reference.urdf" not in r["artifacts"]
    assert any(i["code"] == "LF_EXPORT_MISMATCH" and i["severity"] == "warning" for i in r["report"]["issues"])


def test_lf02_topology_failures_name_the_source_ids_and_produce_no_reference(tmp_path):
    base = [link("a"), link("b"), link("c")]
    cases = {
        "MULTIPLE_ROOTS": [joint("j1", "a", "b")],
        "CYCLE": [joint("j1", "a", "b"), joint("j2", "b", "c"), joint("j3", "c", "a")],
        "DANGLING_JOINT": [joint("j1", "a", "b"), joint("j2", "b", "zzz")],
        "MULTIPLE_PARENT": [joint("j1", "a", "c"), joint("j2", "b", "c")],
    }
    for code, joints in cases.items():
        r = run(tmp_path, model(copy.deepcopy(base), joints))
        assert r["report"]["result"] == "fail", code
        assert code in codes(r), (code, codes(r))
        assert r["artifacts"].get("reference.urdf") is None
        assert r["report"]["referenceUrdfRef"] is None


def test_lf03_negative_inertia_fails_twice_the_raw_check_and_the_parser_repair(tmp_path):
    m = model()
    m["links"][1]["inertiaKgM2"][0] = -1.0
    r = run(tmp_path, m)
    assert r["report"]["result"] == "fail"
    assert {"INERTIA_INVALID", "LF_IMPORT_MUTATION"} <= codes(r)
    issue = next(i for i in r["report"]["issues"] if i["code"] == "LF_IMPORT_MUTATION")
    assert issue["linkId"] == "tray/plate" and issue["entityId"] == "tray/plate"  # original id, not l_<sha>
    assert check(r, "LF-VALIDATOR")["result"] in ("pass", "fail")  # upstream calling it valid changes nothing
    assert r["artifacts"].get("reference.urdf") is None


@pytest.mark.parametrize("tensor", [[1, 0, 0, 1, 0, -1], [1, 0, 0, 1, 0, 0], [1, 2, 0, 1, 0, 1], [1, 0, 0, 1, 0, 5]], ids=["negative-izz", "zero-izz", "not-positive-definite", "triangle-inequality"])
def test_lf03_other_bad_tensors_are_refused_before_trust(tmp_path, tensor):
    m = model()
    m["links"][0]["inertiaKgM2"] = [float(v) for v in tensor]
    assert "INERTIA_INVALID" in codes(run(tmp_path, m))


def test_lf03_non_finite_numbers_never_reach_the_parser(tmp_path):
    m = model()
    m["links"][0]["massKg"]["value"] = float("nan")
    r = run(tmp_path, m, xml=urdf(model()))
    assert "NON_FINITE" in codes(r) and r["report"]["result"] == "fail"


def test_lf04_hostile_names_are_mapped_and_parity_still_covers_every_element(tmp_path):
    m = model([link("chassis/body"), link("a:b"), link("a_b")], [joint("mount:a:b", "chassis/body", "a:b"), joint("j2", "a:b", "a_b")])
    r = run(tmp_path, m)
    assert r["report"]["result"] == "pass", r["report"]["issues"]
    assert check(r, "LF-PARITY")["result"] == "pass"
    reverse = json.loads(r["artifacts"]["name-map.json"])["reverse"]
    assert set(reverse["link"].values()) == {"chassis/body", "a:b", "a_b"}


def test_lf05_missing_inertia_is_a_failure_not_a_default(tmp_path):
    m = model([link("a", inertiaKgM2=None), link("b")], [joint("j", "a", "b")])
    r = run(tmp_path, m)
    assert "INERTIA_MISSING" in codes(r) and r["report"]["result"] == "fail"
    assert "ixx" not in r["artifacts"].get("reference.urdf", "")


def test_lf05_missing_collision_is_inconclusive_for_that_scope_and_a_bad_sensor_frame_is_attributed(tmp_path):
    m = model([link("a", collision=[]), link("b")], [joint("j", "a", "b")])
    r = run(tmp_path, m)
    assert r["report"]["result"] == "inconclusive" and check(r, "COLLISION-COVERAGE")["result"] == "inconclusive"
    bad = model(sensors=[{**SENSOR, "parentLinkId": "no/such"}])
    r = run(tmp_path, bad)
    issue = next(i for i in r["report"]["issues"] if i["code"] == "SENSOR_FRAME_MISSING")
    assert issue["source"] == "mekoniq" and issue["entityId"] == "lidar" and r["report"]["result"] == "fail"


def test_the_urdf_must_be_the_model_not_merely_parseable(tmp_path):
    m = model()
    other = copy.deepcopy(m)
    other["links"][0]["massKg"]["value"] = 99.0
    r = run(tmp_path, m, xml=urdf(other))
    assert "URDF_MODEL_MISMATCH" in codes(r) and r["report"]["result"] == "fail"
    extra = model([link("chassis/base"), link("tray/plate", (0.4, 0.35, 0.01), 1.2), link("zz")], [joint("mount:chassis/tray:tray/mount", "chassis/base", "tray/plate"), joint("j", "chassis/base", "zz")])
    assert "URDF_MODEL_MISSING" in codes(run(tmp_path, extra, xml=urdf(m)))


def test_unsafe_input_is_rejected_before_any_parser(tmp_path):
    m = model()
    good = urdf(m)
    for code, xml in {
        "XML_DTD_REJECTED": good.replace("<robot", '<!DOCTYPE robot [<!ENTITY x "y">]><robot', 1),
        "XACRO_UNSUPPORTED": good.replace("<robot ", '<robot xmlns:xacro="http://www.ros.org/wiki/xacro" ', 1),
        "XML_TOO_LARGE": good + " " * (2 * 1024 * 1024),
        "XML_MALFORMED": good[:-8],
    }.items():
        r = run(tmp_path, m, xml=xml)
        assert code in codes(r), (code, codes(r))
        assert r["report"]["execution"] in ("ran", "failed") and r["report"]["result"] != "pass"


def test_artifact_paths_cannot_leave_the_bundle(tmp_path):
    m = model()
    req = request(m, urdf(m), tmp_path)
    for bad in ("../outside.urdf", "/etc/passwd", "http://x/y.urdf"):
        r = validate_request({**req, "urdfPath": bad})
        assert "PATH_REJECTED" in codes(r) and r["report"]["execution"] == "failed"
    (tmp_path / "link.urdf").symlink_to("/etc/hosts")
    assert "PATH_REJECTED" in codes(validate_request({**req, "urdfPath": "link.urdf"}))
    assert "SOURCE_HASH_MISMATCH" in codes(validate_request({**req, "urdfSha256": "f" * 64}))


def test_mesh_references_outside_the_bundle_are_refused(tmp_path):
    m = model([link("a", visual=[{"pose": pose(), "geometry": {"kind": "mesh", "filename": "../../etc/passwd"}, "source": {}}]), link("b")], [joint("j", "a", "b")])
    r = validate_request(request(m, urdf(m), tmp_path))
    assert "PATH_REJECTED" in codes(r)


def test_validation_never_writes_to_stdout(tmp_path):
    buf = io.StringIO()
    m = model()
    m["links"][1]["inertiaKgM2"][0] = -1.0
    with redirect_stdout(buf):
        run(tmp_path, m)
    assert buf.getvalue() == ""


def test_review2_the_inertial_frame_rotation_and_mimic_are_part_of_parity(tmp_path):
    m = model([link("chassis/base"), link("wheel-left/rim", (0.1, 0.05, 0.1), 1.5), link("wheel-right/rim", (0.1, 0.05, 0.1), 1.5)],
              [joint("wheel-left/axle", "chassis/base", "wheel-left/rim", "continuous", axis=(0.0, 1.0, 0.0)), joint("wheel-right/axle", "chassis/base", "wheel-right/rim", "continuous", axis=(0.0, 1.0, 0.0))])
    good = urdf(m)
    assert check(run(tmp_path, m, good), "SOURCE-URDF")["result"] == "pass"  # the control
    rotated = good.replace('rpy="0 0 0"/><mass', 'rpy="0.3 0 0"/><mass', 1)
    mimic = good.replace("</joint>", '<mimic joint="wheel-left/axle" multiplier="2" offset="0.5"/></joint>', 2).replace('<mimic joint="wheel-left/axle" multiplier="2" offset="0.5"/></joint>', "</joint>", 1)
    for why, xml in (("inertial rotation", rotated), ("mimic", mimic)):
        assert xml != good, why
        r = run(tmp_path, m, xml)
        assert r["report"]["result"] != "pass" and "URDF_MODEL_MISMATCH" in codes(r), why
