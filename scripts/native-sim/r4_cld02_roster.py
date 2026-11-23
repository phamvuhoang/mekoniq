"""Record the selected item IDs in the same pytest session that writes full.xml."""
import json
import os
import uuid
from pathlib import Path

import pytest


# The ID ties the collection and JUnit properties to this pytest process.
invocation = uuid.uuid4().hex


def pytest_collection_finish(session):
    record = {
        "schemaVersion": 1,
        "sourceCommit": os.environ["R4_CLD02_SOURCE"],
        "imageId": os.environ["R4_CLD02_IMAGE"],
        "invocationId": invocation,
        "nodeIds": [item.nodeid for item in session.items],
    }
    Path(os.environ["R4_CLD02_COLLECTION"]).write_text(json.dumps(record) + "\n")


@pytest.fixture(scope="session", autouse=True)
def cld02_suite_identity(record_testsuite_property):
    record_testsuite_property("cld02Source", os.environ["R4_CLD02_SOURCE"])
    record_testsuite_property("cld02Image", os.environ["R4_CLD02_IMAGE"])
    record_testsuite_property("cld02Invocation", invocation)
