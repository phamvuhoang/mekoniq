"""A03 recovery: bridge restart invalidates owner tokens and reconciles pending commands from the journal; a lost reply is outcome_unknown and is
never resent; a controller reboot makes a new epoch, re-evaluates homing and never resumes the program. Fake controller only."""
import unittest

from support import ROOT  # noqa: F401
from arm_fixture import T0, cell_command, demo_program_ref, envelope, profile, temp_dir
from fake_controller import FakeController

from bridge.arbiter import Arbiter
from bridge.journal import Journal


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        self.dir, self.ctl, self.now, self.p = temp_dir(), FakeController(), T0, profile()
        self.arb = Arbiter(self.p, Journal(self.dir / "journal.jsonl"), self.ctl, now_ms=lambda: self.now); self.arb.start()
        self.tok = self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 10000)
        self.arb.submit(envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage", program=demo_program_ref()), token=self.tok["token"], lease=self.tok["leaseId"]))

    def env(self, capability, payload, command_id, tok=None):
        tok = tok or self.tok
        return envelope(cell_command(capability, payload, command_id, program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"], controller_epoch=self.arb.controller_epoch)

    def restart(self):
        self.arb = Arbiter(self.p, Journal(self.dir / "journal.jsonl"), self.ctl, now_ms=lambda: self.now); return self.arb.start()

    def test_lost_reply_after_the_send_is_outcome_unknown_and_never_resent(self):
        self.ctl.raise_on.add("run")
        r = self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run"))
        self.assertEqual((r["status"], r["reasonCodes"]), ("outcome_unknown", ["SEND_INTERRUPTED"])); self.assertEqual(self.ctl.calls.count("run"), 1)
        self.assertEqual(self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run"))["status"], "outcome_unknown")   # a retry of the same id asks, never resends
        self.assertEqual(self.arb.submit(self.env("start_job", {"jobId": "job-2"}, "cmd-run-2"))["reasonCodes"], ["RECONCILE_REQUIRED:cmd-run"])
        self.assertEqual(self.ctl.calls.count("run"), 1)
        self.assertEqual(self.arb.reconcile("cmd-run", token=self.tok["token"])["outcome"]["status"], "running"); self.assertFalse(self.arb.status()["reconcileRequired"])

    def test_bridge_restart_invalidates_tokens_and_reconciles_pending_commands(self):
        self.ctl.raise_on.add("run"); self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run"))
        boot = self.restart()
        self.assertEqual(boot["pendingReconciled"], ["cmd-run"]); self.assertEqual(self.arb.status()["owner"]["kind"], "none")
        self.assertEqual(self.arb.submit(self.env("stage_program", {"profileId": self.p["machineId"]}, "s-old"))["reasonCodes"], ["OWNER_TOKEN_INVALID"])
        self.assertEqual(self.ctl.calls.count("run"), 1)                                                       # no physical-effect replay on restart
        self.assertEqual(self.arb.outcome("cmd-run")["status"], "running"); self.assertEqual(self.arb.controller_epoch, 1)   # same controller boot: same epoch
        self.assertEqual([e["event"] for e in self.arb.journal.entries() if e["kind"] == "lifecycle"], ["bridge_start", "bridge_restart"])

    def test_controller_reboot_makes_a_new_epoch_and_never_resumes(self):
        self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run"))
        self.ctl.reboot("ctl-boot-2")
        boot = self.restart()
        self.assertEqual((self.arb.controller_epoch, boot["epochChanged"]), (2, True)); self.assertEqual(self.arb.outcome("cmd-run")["status"], "unknown")
        self.assertEqual(self.ctl.calls.count("run"), 1); self.assertEqual(self.ctl.interp, "idle"); self.assertFalse(self.ctl.homed)
        old = self.env("resume_job", {"jobId": "job-1"}, "cmd-resume")                                               # built with the old epoch
        old["controllerEpoch"] = 1
        self.assertEqual(self.arb.submit(old)["reasonCodes"], ["EPOCH_MISMATCH"])
        tok = self.arb.acquire("lab_simulation", "lab-runtime", 2, 10000); self.assertEqual(tok["reasonCodes"], ["RECONCILE_REQUIRED"])
        self.arb.reconcile("cmd-run"); self.assertEqual(self.arb.outcome("cmd-run")["status"], "running")             # the fake still reports its last answer; the bridge never re-runs
        self.assertEqual(self.arb.acquire("lab_simulation", "lab-runtime", 2, 10000)["reasonCodes"], ["COMMAND_IN_FLIGHT"])
        self.ctl.finish("cmd-run", "failed"); self.arb.poll_completions()
        tok = self.arb.acquire("lab_simulation", "lab-runtime", 2, 10000); self.assertTrue(tok["ok"])
        self.assertEqual(self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run-3", tok))["reasonCodes"], ["PROGRAM_NOT_STAGED"])   # the reboot dropped the staged program
        self.assertEqual(self.arb.submit(self.env("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage-2", tok))["status"], "accepted")
        self.assertEqual(self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run-4", tok))["reasonCodes"], ["NOT_HOMED"])          # homing is re-evaluated, never assumed

    def test_fault_does_not_go_back_to_running_by_itself(self):
        self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run"))
        self.ctl.fault = "AMP_FAULT_J0"; self.ctl.interp = "idle"; self.ctl.task = "off"
        self.assertEqual(self.arb.observe()["events"], ["fault"]); self.assertEqual(self.arb.outcome("cmd-run")["status"], "unknown")
        self.ctl.fault = None; self.ctl.task = "on"
        self.assertEqual(self.arb.submit(self.env("resume_job", {"jobId": "job-1"}, "cmd-resume"))["reasonCodes"], ["RECONCILE_REQUIRED:cmd-run"])
        self.assertEqual(self.ctl.calls.count("resume"), 0)


if __name__ == "__main__":
    unittest.main()
