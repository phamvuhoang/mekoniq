import hashlib
import json
from pathlib import Path

import pytest
import rfc8785

from webots_worker.protocol import PROTOCOL, load_validators
from webots_worker.session import WorkerSession, scene_digest_of

FX = Path(__file__).resolve().parents[1] / "fixtures" / "serve-3d-v1"
SCHEMAS = Path(__file__).resolve().parents[3] / "packages" / "contracts" / "schemas"
RUN = "run-1"
R, SEP = 0.09, 0.36


class FakeEngine:
    """Stands in for Webots: records what the session asks and answers a settled robot at the spawn pose."""

    version, executable_sha256 = "R2025a", "a" * 64

    def __init__(self, world_text, config):
        self.world, self.config, self.time, self.steps, self.closed, self.fail_next, self.drift = world_text, config, 0.0, [], False, None, 0.0

    def start(self):
        pass

    def step(self, commands, lidar):
        if self.fail_next:
            raise self.fail_next
        self.time += 0.02 + self.drift
        self.steps.append({k: tuple(v) for k, v in commands.items()})
        robots = {}
        for r in self.config["robots"]:
            robots[r["id"]] = {"position": [2.0, 1.5, 0.09], "orientation": [1, 0, 0, 0, 1, 0, 0, 0, 1], "velocity": [0.0] * 6, "wheelPositions": [0.0, 0.0],
                               "lidar": {l["name"]: [3.0] * l["beams"] for l in r["lidars"]} if lidar else None}
        return {"time": self.time, "robots": robots, "contacts": []}

    def readback(self):
        return {"robots": [{"robotId": r["id"], "links": [{"name": "chassis_base", "massKg": 14.0, "positionMap": [2.0, 1.5, 0.09]}], "wheelRadiusM": R, "wheelSeparationM": SEP, "wheelAxes": [[0, 1, 0], [0, 1, 0]]} for r in self.config["robots"]]}

    def close(self):
        self.closed = True


@pytest.fixture
def bundle(tmp_path):
    """A bundle directory with the single-robot scene, its physical model and the digests the session checks."""
    scene = json.loads((FX / "navigation-scene.json").read_text())
    model_bytes = (FX / "physical-model-amr-1.json").read_bytes()
    (tmp_path / "physical-model").mkdir()
    (tmp_path / "physical-model" / "amr-1.json").write_bytes(model_bytes)
    scene["files"] = [{"path": "physical-model/amr-1.json", "sha256": hashlib.sha256(model_bytes).hexdigest(), "bytes": len(model_bytes)}]
    scene["sceneDigest"] = scene_digest_of(scene)
    (tmp_path / "navigation-scene.json").write_text(json.dumps(scene))
    return tmp_path, scene


@pytest.fixture
def made(bundle):
    root, scene = bundle
    engines = []

    def factory(world_text, config):
        engines.append(FakeEngine(world_text, config))
        return engines[-1]

    session = WorkerSession(run_id=RUN, bundle_root=root, lock_digest="b" * 64, expected_scene_digest=scene["sceneDigest"], engine_factory=factory, webots_home="/nonexistent", host_info=lambda: ("R2025a", "a" * 64))
    return session, engines, scene, root


_n = 0


def req(op, payload=None, tick=0, request_id=None):
    global _n
    _n += 1
    return {"protocol": PROTOCOL, "requestId": request_id or f"r{_n}", "runId": RUN, "expectedTick": tick, "op": op, "payload": payload or {}}


def step(tick, v=0.0, w=0.0, **kw):
    return req("step", {"targetTick": tick + 1, "velocities": [{"robotId": "amr-1", "vMps": v, "omegaRadps": w}], "actorUpdates": []}, tick=tick, **kw)


def validators():
    return load_validators(SCHEMAS)
