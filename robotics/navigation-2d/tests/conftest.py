import json

import pytest

from irsim_testkit import FIX, SCHEMAS


@pytest.fixture
def serve():
    return json.loads((FIX / "navigation-scene.json").read_text())


@pytest.fixture
def two():
    return json.loads((FIX / "navigation-scene-two-robot.json").read_text())


@pytest.fixture
def schema_dir():
    return SCHEMAS
