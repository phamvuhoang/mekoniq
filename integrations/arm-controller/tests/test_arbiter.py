"""A03 arbiter: exactly one control owner, leases/epochs fenced, idempotent command ids, lifecycle accepted != completed, durable outcomes.
Fake controller only: proves arbitration, never LinuxCNC command mapping."""
import json
import unittest

from support import ROOT  # noqa: F401
from arm_fixture import T0, cell_command, demo_program_ref, envelope, profile, temp_dir
from fake_controller import FakeController

from bridge.arbiter import Arbiter
from bridge.journal import Journal


class ArbiterTest(unittest.TestCase):
    def setUp(self):
        self.dir, self.ctl, self.now = temp_dir(), FakeController(), T0
        self.p = profile()
        self.journal = Journal(self.dir / "journal.jsonl")
        self.arb = Arbiter(self.p, self.journal, self.ctl, now_ms=lambda: self.now)
        self.arb.start()

    def lab(self, lease_ms=10000):
        r = self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, lease_ms)
        self.assertTrue(r["ok"], r); return r

    def test_concurrent_local_and_lab_acquire_give_exactly_one_owner(self):
        a = self.arb.acquire("local_operator", "hmi:op-1", self.arb.controller_epoch, 10000)
        b = self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 10000)
        self.assertTrue(a["ok"]); self.assertFalse(b["ok"]); self.assertEqual(b["reasonCodes"], ["OWNER_HELD:local_operator"])
        self.assertEqual(self.arb.status()["owner"], {"kind": "local_operator", "actor": "hmi:op-1", "leaseId": a["leaseId"]})
        self.assertEqual([e["event"] for e in self.journal.entries() if e["kind"] == "owner"], ["owner_acquired"])

    def test_owner_transfer_needs_idle_controller_and_no_unknown_outcome(self):
        tok = self.lab(); self.ctl.interp = "running"
        self.arb.release(tok["leaseId"], token=tok["token"])
        r = self.arb.acquire("local_operator", "hmi:op-1", self.arb.controller_epoch, 10000)
        self.assertEqual(r["reasonCodes"], ["TRANSFER_STATE_INVALID:running"])
        self.ctl.interp = "idle"; self.assertTrue(self.arb.acquire("local_operator", "hmi:op-1", self.arb.controller_epoch, 10000)["ok"])

    def test_epoch_lease_and_machine_are_fenced(self):
        self.assertEqual(self.arb.acquire("lab_simulation", "lab", self.arb.controller_epoch + 1, 10000)["reasonCodes"], ["EPOCH_MISMATCH"])
        self.assertEqual(self.arb.acquire("lab_simulation", "lab", self.arb.controller_epoch, 999999)["reasonCodes"], ["LEASE_TOO_LONG"])
        self.assertEqual(self.arb.acquire("nobody", "x", self.arb.controller_epoch, 1000)["reasonCodes"], ["OWNER_KIND_INVALID"])
        tok = self.lab()
        bad = envelope(cell_command("query_outcome", {"targetCommandId": "cmd-0"}), token=tok["token"], lease=tok["leaseId"])
        bad["machineId"] = "other-machine"
        self.assertEqual(self.arb.submit(bad)["reasonCodes"], ["MACHINE_MISMATCH"])

    def test_start_job_is_accepted_not_completed_and_journaled_before_the_send(self):
        tok = self.lab()
        st = envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"])
        self.assertEqual(self.arb.submit(st)["status"], "accepted")
        r = self.arb.submit(envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-run", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"]))
        self.assertEqual((r["status"], r["lifecycle"]), ("accepted", "accepted_not_completed"))
        rows = [e for e in self.journal.entries() if e["kind"] == "command" and e["commandId"] == "cmd-run"]
        self.assertEqual([e["intent"] for e in rows], ["sending", "answered"]); self.assertEqual(self.ctl.calls.count("run"), 1)
        self.assertEqual(self.arb.outcome("cmd-run")["status"], "running")
        self.ctl.finish("cmd-run")
        self.assertEqual(self.arb.outcome("cmd-run")["status"], "running")                  # the controller finished, but the bridge has not observed it yet
        self.assertEqual([c["commandId"] for c in self.arb.poll_completions()], ["cmd-run"])
        self.assertEqual(self.arb.outcome("cmd-run")["status"], "completed")

    def test_duplicate_id_same_payload_returns_the_first_answer_and_never_sends_twice(self):
        tok = self.lab(); self.arb.submit(envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"]))
        env = envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-run", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"])
        first = self.arb.submit(env); again = self.arb.submit(json.loads(json.dumps(env)))
        self.assertEqual((again["status"], again["duplicate"]), (first["status"], True)); self.assertEqual(self.ctl.calls.count("run"), 1)
        other = envelope(cell_command("start_job", {"jobId": "job-2"}, "cmd-run", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"])
        conflict = self.arb.submit(other)
        self.assertEqual((conflict["status"], conflict["reasonCodes"]), ("conflict", ["COMMAND_ID_CONFLICT"])); self.assertEqual(self.ctl.calls.count("run"), 1)
        self.assertEqual([e["code"] for e in self.journal.entries() if e["kind"] == "audit"], ["COMMAND_ID_CONFLICT"])

    def test_commands_need_the_current_owner_token_lease_and_capability_state(self):
        tok = self.lab()
        wrong = envelope(cell_command("pause_job", {"jobId": "job-1"}, "cmd-forged"), token="forged", lease=tok["leaseId"])
        self.assertEqual(self.arb.submit(wrong)["reasonCodes"], ["OWNER_TOKEN_INVALID"])
        self.assertEqual(self.arb.submit(envelope(cell_command("pause_job", {"jobId": "job-1"}, "cmd-p"), token=tok["token"], lease=tok["leaseId"]))["reasonCodes"], ["STATE_INVALID:idle"])
        self.assertEqual(self.arb.submit(envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-r"), token=tok["token"], lease=tok["leaseId"]))["reasonCodes"], ["PROGRAM_NOT_STAGED"])
        self.assertEqual(self.arb.submit(envelope(cell_command("brew", {"recipeId": "x", "cupId": "c"}, "cmd-b"), token=tok["token"], lease=tok["leaseId"]))["reasonCodes"], ["ARM_CAPABILITY_UNSUPPORTED:brew"])
        self.ctl.homed = False
        st = envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"])
        self.assertEqual(self.arb.submit(st)["status"], "accepted")
        self.assertEqual(self.arb.submit(envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-r2", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"]))["reasonCodes"], ["NOT_HOMED"])

    def test_expired_lease_blocks_the_next_command_and_frees_the_owner(self):
        tok = self.lab(lease_ms=5000); self.now += 6000
        r = self.arb.submit(envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"]))
        self.assertEqual(r["reasonCodes"], ["LEASE_EXPIRED"]); self.assertEqual(self.arb.status()["owner"]["kind"], "none"); self.assertFalse(self.arb.status()["reconcileRequired"])
        self.assertTrue(self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 5000)["ok"])
        self.assertIn("lease_expired", [e["event"] for e in self.journal.entries() if e["kind"] == "owner"])

    def test_local_revocation_goes_through_the_stop_policy_then_requires_reconcile(self):
        tok = self.lab(); self.arb.submit(envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"]))
        self.arb.submit(envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-run", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"]))
        r = self.arb.revoke("hmi:op-1", "operator takes over")
        self.assertEqual(r["outcome"]["evidence"]["policy"], "cancel_then_reconcile"); self.assertEqual(self.ctl.calls[-1], "cancel")
        self.assertEqual(self.arb.status()["owner"]["kind"], "none"); self.assertTrue(self.arb.status()["reconcileRequired"])
        self.assertEqual(self.arb.submit(envelope(cell_command("pause_job", {"jobId": "job-1"}, "p-late"), token=tok["token"], lease=tok["leaseId"]))["reasonCodes"], ["OWNER_TOKEN_INVALID"])
        self.assertEqual(self.arb.outcome("cmd-run")["status"], "unknown")                  # a cancelled job is unknown until the controller is queried
        self.arb.reconcile("cmd-run"); self.assertEqual(self.arb.outcome("cmd-run")["status"], "running")  # no owner holds: reconcile needs no token; the fake still reports running

    def test_profile_and_model_expectations_are_checked_before_any_effect(self):
        tok = self.lab()
        env = envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage", program=demo_program_ref()), token=tok["token"], lease=tok["leaseId"])
        env["expected"]["profileHash"] = "0" * 64
        self.assertEqual(self.arb.submit(env)["reasonCodes"], ["PROFILE_MISMATCH"]); self.assertEqual(self.ctl.calls, [])
        env = envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage2", program={"id": "demo-six-axis", "hash": "1" * 64}), token=tok["token"], lease=tok["leaseId"])
        self.assertEqual(self.arb.submit(env)["reasonCodes"], ["PROGRAM_HASH_MISMATCH"]); self.assertEqual(self.ctl.calls, [])
        env = envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage3", program={"id": "free-text", "hash": "1" * 64}), token=tok["token"], lease=tok["leaseId"])
        self.assertEqual(self.arb.submit(env)["reasonCodes"], ["PROGRAM_NOT_ALLOWLISTED:free-text"])


if __name__ == "__main__":
    unittest.main()
