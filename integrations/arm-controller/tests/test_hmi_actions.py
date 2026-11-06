"""A04 HMI: the QtVCP handler is a thin client of the arbiter. Its action policy is pure and tested here; jog/home exist only for the local
operator owner and only in an allowed state; stock QtVCP write actions that bypass the arbiter are not wired; a restarted HMI never acquires
or starts anything by itself; the UI shows mode/backend, owner, model/profile, six actual/commanded joints, homing, program, fault and
freshness in vi/ja/en. GUI smoke (fullscreen, touch, screenshots) needs the Linux runtime: blocked_external here."""
import json
import re
import unittest
import xml.etree.ElementTree as ET

from support import ROOT
from arm_fixture import T0, cell_command, envelope, profile, temp_dir
from fake_controller import FakeController

from bridge.arbiter import Arbiter
from bridge.journal import Journal
from hmi.mekoniq_arm.mekoniq_arm_handler import BLOCKED_STOCK_ACTIONS, LABELS, HmiActions, allowed_actions

HMI = ROOT / "hmi" / "mekoniq_arm"
LOCAL = {"kind": "local_operator", "actor": "hmi:op-1", "leaseId": "lease-1"}
LAB = {"kind": "lab_simulation", "actor": "lab-runtime", "leaseId": "lease-2"}
NONE = {"kind": "none", "actor": None, "leaseId": None}
ready = lambda **o: {"task": "on", "interp": "idle", "homed": True, "fault": None, "reconcileRequired": False, "program": "demo-six-axis", **o}


class PolicyTest(unittest.TestCase):
    def test_jog_and_home_only_for_the_local_owner_in_an_allowed_state(self):
        self.assertTrue({"jog", "home_all", "run", "stop"} <= allowed_actions(LOCAL, ready()))
        self.assertFalse({"jog", "home_all", "run", "pause", "resume"} & allowed_actions(LAB, ready()))
        self.assertFalse({"jog", "home_all", "run"} & allowed_actions(NONE, ready()))
        self.assertNotIn("jog", allowed_actions(LOCAL, ready(interp="running"))); self.assertNotIn("home_all", allowed_actions(LOCAL, ready(interp="paused")))
        self.assertNotIn("jog", allowed_actions(LOCAL, ready(task="off"))); self.assertNotIn("jog", allowed_actions(LOCAL, ready(fault="JOINT_0_FAULT")))
        self.assertNotIn("run", allowed_actions(LOCAL, ready(homed=False))); self.assertNotIn("run", allowed_actions(LOCAL, ready(program=None)))

    def test_lifecycle_actions_follow_the_controller_state(self):
        self.assertEqual({"pause", "stop", "revoke", "release_local"} & allowed_actions(LOCAL, ready(interp="running")), {"pause", "stop", "revoke", "release_local"})
        self.assertNotIn("run", allowed_actions(LOCAL, ready(interp="running"))); self.assertNotIn("resume", allowed_actions(LOCAL, ready(interp="running")))
        self.assertIn("resume", allowed_actions(LOCAL, ready(interp="paused"))); self.assertNotIn("pause", allowed_actions(LOCAL, ready(interp="paused")))
        self.assertEqual(allowed_actions(LOCAL, ready(fault="JOINT_0_FAULT", interp="idle", task="off")), {"stop", "reconcile", "release_local", "estop_reset"})  # a fault never offers a resume

    def test_acquire_only_when_nobody_owns_and_nothing_is_unknown(self):
        self.assertIn("acquire_local", allowed_actions(NONE, ready())); self.assertNotIn("acquire_local", allowed_actions(NONE, ready(reconcileRequired=True)))
        self.assertIn("reconcile", allowed_actions(NONE, ready(reconcileRequired=True))); self.assertNotIn("acquire_local", allowed_actions(LAB, ready()))
        self.assertEqual(allowed_actions(LAB, ready(interp="running")), {"revoke"})                                          # the lab owns: the local operator can only take over through the stop policy

    def test_there_is_no_software_estop_and_another_owner_offers_only_revoke(self):
        for owner, state in ((LAB, ready()), (NONE, ready(fault="X", task="estop")), (LOCAL, ready())):
            self.assertNotIn("estop", allowed_actions(owner, state))                                                        # the E-stop is a physical circuit, never this UI
        self.assertEqual(allowed_actions(LAB, ready()), {"revoke"}); self.assertEqual(allowed_actions(LAB, ready(interp="running")), {"revoke"})
        self.assertEqual(allowed_actions(LOCAL, ready(task="estop")), {"estop_reset", "release_local"}); self.assertEqual(allowed_actions(LOCAL, ready(task="off")), {"machine_on", "release_local"})


class FakeBridge:
    """In-process stand-in for the socket client: routes HMI messages to a real arbiter and records what the HMI sent."""
    def __init__(self, arb): self.arb, self.sent, self.status = arb, [], None
    def send(self, msg):
        self.sent.append(msg)
        if "acquire" in msg:
            return self.arb.acquire(msg["owner"]["actor"], msg["acquire"]["actor"], msg["controllerEpoch"], msg["acquire"]["leaseMs"])
        if "release" in msg:
            return self.arb.release(msg["release"]["leaseId"], token=msg["owner"]["token"])
        if "renew" in msg:
            return self.arb.renew(msg["renew"]["leaseId"], 10000, token=msg["owner"]["token"])
        if "local" in msg:
            return self.arb.local_motion(msg)
        if "reconcile" in msg:
            return self.arb.reconcile(msg["reconcile"]["commandId"], token=msg["owner"]["token"] or None)
        if "revoke" in msg:
            return self.arb.revoke(msg["owner"]["actor"], msg["revoke"]["reason"])
        return self.arb.submit(msg)


class HandlerTest(unittest.TestCase):
    def setUp(self):
        self.ctl, self.p = FakeController(), profile()
        self.arb = Arbiter(self.p, Journal(temp_dir() / "journal.jsonl"), self.ctl, now_ms=lambda: T0); self.arb.start()
        self.bridge = FakeBridge(self.arb)
        self.hmi = HmiActions(self.p, self.bridge, operator="hmi:op-1", now_ms=lambda: T0)

    def test_restarted_hmi_never_acquires_or_starts_by_itself(self):
        self.hmi.on_status({"owner": LAB, "task": {"state": "on", "interp": "running", "homed": True, "fault": None}, "program": {"id": "demo-six-axis", "state": "running"}})
        self.assertEqual(self.bridge.sent, []); self.assertEqual(self.hmi.view()["owner"], "lab_simulation"); self.assertEqual(self.hmi.view()["enabled"], {"revoke"})
        HmiActions(self.p, self.bridge, operator="hmi:op-1")                                                        # a fresh instance (crash + restart) stays passive
        self.assertEqual(self.bridge.sent, [])

    def test_local_jog_goes_through_the_arbiter_and_only_for_the_local_owner(self):
        tok = self.hmi.acquire_local()
        self.assertEqual(tok["status"], "accepted"); self.assertEqual(self.arb.status()["owner"]["kind"], "local_operator")
        self.assertEqual(self.hmi.jog(joint=2, velocity_deg_s=5.0)["reasonCodes"], ["STATE_UNKNOWN"])                  # no status frame yet: the HMI does not guess
        self.hmi.on_status({"owner": self.arb.status()["owner"], "task": {"state": "on", "interp": "idle", "homed": True, "fault": None}, "program": {"id": None, "state": "none"}})
        r = self.hmi.jog(joint=2, velocity_deg_s=5.0)
        self.assertEqual(r["status"], "accepted"); self.assertEqual(self.ctl.calls[-1], ("jog", 2, 5.0))
        self.assertEqual(self.hmi.home_all()["status"], "accepted"); self.assertEqual(self.ctl.calls[-1], "home_all")
        self.hmi.release_local(); self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 10000)
        self.hmi.on_status({"owner": self.arb.status()["owner"], "task": {"state": "on", "interp": "idle", "homed": True, "fault": None}, "program": {"id": None, "state": "none"}})
        self.assertEqual(self.hmi.jog(joint=0, velocity_deg_s=1.0)["reasonCodes"], ["ACTION_NOT_ALLOWED:jog"])  # refused locally first
        forged = {**self.hmi._envelope(), "local": {"action": "jog_start", "joint": 0, "velocityDegS": 1.0}}
        self.assertEqual(self.arb.local_motion(forged)["reasonCodes"], ["OWNER_TOKEN_INVALID"])                   # and by the arbiter without the local owner token
        self.assertEqual([c for c in self.ctl.calls if isinstance(c, tuple) and c[0] == "jog"], [("jog", 2, 5.0)])

    def test_run_and_stop_use_the_same_command_envelope_as_the_lab(self):
        self.hmi.acquire_local(); self.hmi.on_status({"owner": self.arb.status()["owner"], "task": {"state": "on", "interp": "idle", "homed": True, "fault": None}, "program": {"id": None, "state": "none"}})
        self.hmi.stage("demo-six-axis"); self.hmi.on_status({"owner": self.arb.status()["owner"], "task": {"state": "on", "interp": "idle", "homed": True, "fault": None}, "program": {"id": "demo-six-axis", "state": "staged"}})
        self.assertEqual(self.hmi.run()["status"], "accepted"); self.assertEqual(self.ctl.calls[-1], "run")
        self.hmi.on_status({"owner": self.arb.status()["owner"], "task": {"state": "on", "interp": "running", "homed": True, "fault": None}, "program": {"id": "demo-six-axis", "state": "running"}})
        self.assertEqual(self.bridge.sent[-1]["kind"], "arm.command.v1"); self.assertEqual(self.bridge.sent[-1]["command"]["capability"], "start_job")
        self.assertEqual(self.hmi.stop()["status"], "accepted"); self.assertEqual(self.ctl.calls[-1], "cancel")

    def test_lab_owner_revocation_from_the_hmi_follows_the_stop_policy(self):
        self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 10000); self.ctl.interp = "running"
        self.hmi.on_status({"owner": self.arb.status()["owner"], "task": {"state": "on", "interp": "running", "homed": True, "fault": None}, "program": {"id": "demo-six-axis", "state": "running"}})
        r = self.hmi.revoke("operator takes over")
        self.assertEqual(r["outcome"]["evidence"]["policy"], "cancel_then_reconcile"); self.assertEqual(self.ctl.calls[-1], "cancel"); self.assertEqual(self.arb.status()["owner"]["kind"], "none")
        self.assertEqual(self.hmi.jog(joint=0, velocity_deg_s=1.0)["reasonCodes"], ["ACTION_NOT_ALLOWED:jog"])     # no owner after a revoke until acquire + reconcile


class RenewAndStateTest(unittest.TestCase):
    def setUp(self):
        self.ctl, self.p, self.now = FakeController(), profile(), T0
        self.arb = Arbiter(self.p, Journal(temp_dir() / "journal.jsonl"), self.ctl, now_ms=lambda: self.now); self.arb.start()
        self.bridge = FakeBridge(self.arb); self.hmi = HmiActions(self.p, self.bridge, operator="hmi:op-1", now_ms=lambda: self.now)

    def test_the_hmi_renews_its_lease_before_expiry_and_reads_reconcile_state_from_status(self):
        self.hmi.acquire_local(); n = len(self.bridge.sent)
        self.now += self.p["lease"]["ttlMs"] - self.p["lease"]["renewBeforeMs"] - 1; self.hmi.tick(); self.assertEqual(len(self.bridge.sent), n)
        self.now += 2; self.hmi.tick(); self.assertEqual(self.bridge.sent[-1].get("renew"), {"leaseId": self.hmi.lease}); self.assertEqual(self.arb.status()["owner"]["kind"], "local_operator")
        self.now += self.p["lease"]["ttlMs"] + 1000; self.hmi.on_status({"owner": {"kind": "none", "actor": None, "leaseId": None}, "reconcileRequired": True, "unknownCommands": ["cmd-run"], "task": {"state": "on", "interp": "idle", "homed": True, "fault": None}, "program": {"id": None, "state": "none"}})
        self.assertEqual(self.hmi.view()["enabled"], {"reconcile"}); self.assertEqual(self.hmi.view()["state"]["unknownCommands"], ["cmd-run"])

    def test_estop_reset_and_machine_on_are_local_actions_through_the_arbiter(self):
        self.ctl.task = "estop"; self.hmi.acquire_local = lambda: None                                                      # the controller is in estop: nothing may be acquired while disabled? the profile allows idle/disabled
        tok = self.arb.acquire("local_operator", "hmi:op-1", self.arb.controller_epoch, 10000); self.hmi.token, self.hmi.lease = tok["token"], tok["leaseId"]
        self.hmi.on_status({"owner": self.arb.status()["owner"], "task": {"state": "estop", "interp": "idle", "homed": False, "fault": None}, "program": {"id": None, "state": "none"}})
        self.assertEqual(self.hmi.estop_reset()["status"], "accepted"); self.assertEqual(self.ctl.calls[-1], "estop_reset"); self.ctl.task = "off"
        self.hmi.on_status({"owner": self.arb.status()["owner"], "task": {"state": "off", "interp": "idle", "homed": False, "fault": None}, "program": {"id": None, "state": "none"}})
        self.assertEqual(self.hmi.machine_on()["status"], "accepted"); self.assertEqual(self.ctl.calls[-1], "machine_on")


class StaticTest(unittest.TestCase):
    def test_stock_write_actions_that_bypass_the_arbiter_are_not_wired(self):
        src = (HMI / "mekoniq_arm_handler.py").read_text()
        self.assertTrue(set(BLOCKED_STOCK_ACTIONS) >= {"RUN", "ABORT", "PAUSE", "RESUME", "MDI", "CALL_MDI", "SET_MDI_MODE", "SET_AUTO_MODE", "JOG", "JOG_INCR", "HOME", "UNHOME", "SET_MACHINE_HOMING", "OPEN_PROGRAM", "LOAD_PROGRAM", "SET_ESTOP_STATE"})
        for a in BLOCKED_STOCK_ACTIONS:
            self.assertNotRegex(src, rf"ACTION\.{a}\(", a)
        self.assertNotIn("linuxcnc.command(", src); self.assertNotIn("error_channel(", src); self.assertNotIn("halcmd", src)
        self.assertIn("error_channel", src.split("BLOCKED_STOCK_ACTIONS")[0] + "")                                   # documented: the service is the only consumer
        self.assertEqual(src.count("ACTION.SET_ESTOP_STATE"), 0)                                                     # the physical safety path is not this UI

    def test_ui_shows_the_required_state_and_has_no_qtvcp_action_widgets(self):
        tree = ET.parse(HMI / "mekoniq_arm.ui"); names = {w.get("name") for w in tree.iter("widget")}; classes = {w.get("class") for w in tree.iter("widget")}
        self.assertNotIn("estopButton", names)                                                                              # no software E-stop: the physical circuit is independent of this UI
        for n in ("modeBackend", "ownerLabel", "modelProfile", "jointTable", "homedLabel", "programLabel", "faultLabel", "freshnessLabel", "acquireButton", "releaseButton", "revokeButton", "homeButton", "runButton", "pauseButton", "resumeButton", "stopButton", "reconcileButton", "stageButton", "estopResetButton", "machineOnButton"):
            self.assertIn(n, names, n)
        self.assertTrue({f"jogPlus{i}" for i in range(6)} | {f"jogMinus{i}" for i in range(6)} <= names)
        self.assertFalse({c for c in classes if c and c.startswith("Action")}, classes)                                 # no ActionButton/ActionToolButton (they call ACTION.* directly)
        self.assertEqual(tree.getroot().get("version"), "4.0"); self.assertIn("mekoniq_arm.qss", (HMI / "mekoniq_arm_handler.py").read_text())

    def test_labels_are_trilingual_and_the_theme_is_navy_lime(self):
        for key, v in LABELS.items():
            self.assertEqual(set(v), {"vi", "ja", "en"}, key); self.assertTrue(all(v.values()), key)
        qss = (HMI / "mekoniq_arm.qss").read_text().lower()
        self.assertIn("#0b151a", qss); self.assertIn("#b4f375", qss); self.assertIn("min-height: 56px", qss)            # navy ground, lime accent, touch-sized controls
        doc = (ROOT / "docs" / "hmi-acceptance.md").read_text()
        for word in ("fullscreen", "DISPLAY = qtvcp -f mekoniq_arm", "blocked_external", "enabling device", "screenshot"):
            self.assertIn(word, doc, word)


if __name__ == "__main__":
    unittest.main()
