import os
import sys

# the tool roots are a pinned closure (lab:irsim refuses bytecode beside it): imports from these tests write none
sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"  # and the interpreters these tests start

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
