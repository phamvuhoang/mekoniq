"""A05 (Python side): the coffee pickup/handoff admission oracle (tests/fixtures/coffee-handoff.json) evaluated by bridge/handoff.py; the TS
arm session evaluates the same fixture. Custody never moves on an ACK, a lost grip/feedback or a cancel; nothing here is served."""
import json
import unittest

from support import ROOT
from bridge.handoff import admit_pickup

FX = json.loads((ROOT / "tests" / "fixtures" / "coffee-handoff.json").read_text())


class HandoffAdmissionTest(unittest.TestCase):
    def test_every_fixture_case(self):
        for c in FX["cases"]:
            got = admit_pickup(c["inputs"])
            self.assertEqual({"pickup": got["pickup"], "reasonCodes": got["reasonCodes"], "custody": got["custody"], "served": got["served"]}, c["expected"], c["name"])

    def test_reason_codes_follow_the_fixture_order_and_never_serve(self):
        for c in FX["cases"]:
            codes = admit_pickup(c["inputs"])["reasonCodes"]
            self.assertEqual(codes, sorted(codes, key=FX["order"].index), c["name"]); self.assertFalse(admit_pickup(c["inputs"])["served"])
        self.assertIsNone(FX["unknownLimits"]["temperatureK"])


if __name__ == "__main__":
    unittest.main()
