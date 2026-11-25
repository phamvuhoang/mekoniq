"""V10: the three-cup tray fixture against the real engine: each layout compiles and starts without penetration, the lock of the low-friction profile is admitted by the worker, and the
friction the engine really applies to a cup-tray contact is read back (the larger of the two faces)."""
import hashlib
import json
from pathlib import Path

import mujoco
import pytest

from mujoco_worker.actors import ACTOR_PROXY_V1
from mujoco_worker.mobile_engine import MobileEngine
from mujoco_worker.session import WorkerSession, scene_digest_of

ROOT = Path(__file__).resolve().parents[1] / "fixtures"
TRAY, PAYLOAD = ROOT / "serve-tray-v1", ROOT / "serve-payload-v1"
SCHEMAS = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "schemas"
read = lambda d, n: json.loads((d / (n + ".json")).read_text())


def inputs(load, physics):
    scene = read(PAYLOAD, "navigation-scene")
    prof, phys = read(TRAY, load), read(TRAY, physics)
    scene["engine"]["loadProfileRef"].update(id=prof["id"], path=load + ".json", sha256=hashlib.sha256((TRAY / (load + ".json")).read_bytes()).hexdigest())
    scene["engine"]["physicsProfileRef"].update(id=phys["id"], path=physics + ".json", sha256=hashlib.sha256((TRAY / (physics + ".json")).read_bytes()).hexdigest())
    scene["sceneDigest"] = scene_digest_of(scene)
    return scene, {"amr-1": read(TRAY, "physical-model-amr-1")}, prof, phys


CASES = [("cup-triple", "drive-contact-profile", 0.6), ("cup-triple-low-friction", "drive-contact-tray-low-v1", 0.15)]


@pytest.mark.parametrize("load,physics,mu", CASES)
def test_each_layout_compiles_without_penetration_and_keeps_three_free_cups(load, physics, mu):
    engine = MobileEngine(*inputs(load, physics))
    assert sorted(engine.prop) == ["cup-1", "cup-2", "cup-3"]
    assert engine.model.nv == 6 + 2 + 3 * 6                       # chassis, two wheel hinges, three free cups


@pytest.mark.parametrize("load,physics,mu", CASES)
def test_the_engine_applies_the_larger_friction_of_the_two_faces_to_every_cup_tray_contact(load, physics, mu):
    engine = MobileEngine(*inputs(load, physics))
    m, d = engine.model, engine.data
    for _ in range(5):
        mujoco.mj_step(m, d)
    seen = {}
    for c in d.contact[:d.ncon]:
        tags = {engine.tags.get(int(c.geom1)), engine.tags.get(int(c.geom2))}
        cup = next((t for t in tags if t and t.startswith("prop/")), None)
        if cup and any(t and t.startswith("amr-1/tray-1") for t in tags):
            seen[cup] = float(c.friction[0])
    assert sorted(seen) == ["prop/cup-1", "prop/cup-2", "prop/cup-3"]
    assert all(v == pytest.approx(mu) for v in seen.values()), seen


def test_the_worker_admits_the_low_friction_lock_and_refuses_an_unregistered_edit(tmp_path):
    s = WorkerSession(run_id="t", bundle_root=tmp_path, lock_digest="b" * 64, schema_dir=SCHEMAS)
    s._check_physics_profile(read(TRAY, "drive-contact-tray-low-v1"))
    edited = read(TRAY, "drive-contact-tray-low-v1")
    edited["contact"]["sliding"] = 0.1
    with pytest.raises(Exception, match="PHYSICS_PROFILE_INVALID"):
        s._check_physics_profile(edited)


def test_the_proxy_declaration_is_the_workers_constant():
    p = read(TRAY, "actor-proxy-v1")
    assert (p["id"], p["shape"], p["heightM"]) == (ACTOR_PROXY_V1["id"], ACTOR_PROXY_V1["shape"], ACTOR_PROXY_V1["heightM"])
