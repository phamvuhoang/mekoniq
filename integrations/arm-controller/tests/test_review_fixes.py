"""Final-review fix pass (plan 03): token-bound ownership on both channels, no deadlock after lease expiry, lifecycle events on the wire,
request correlation, program file verification at staging, controller restart under a live bridge, per-job outcomes, ACK != completion
for pause/resume/cancel, backpressure that never blocks the loop, and an HMI without an inert E-stop. Fake controller only."""
import hashlib
import json
import shutil
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path

from support import ROOT
from arm_fixture import T0, cell_command, demo_program_ref, envelope, profile, profile_hash, temp_dir
from fake_controller import FakeController

from bridge import protocol
from bridge.arbiter import Arbiter
from bridge.journal import Journal
from bridge.service import BridgeService


def stage_env(p, tok, cid="cmd-stage"):
    return envelope(cell_command("stage_program", {"profileId": p["machineId"]}, cid, program=demo_program_ref(p)), token=tok["token"], lease=tok["leaseId"])


class OwnershipBindingTest(unittest.TestCase):
    def setUp(self):
        self.ctl, self.p, self.now, self.events = FakeController(), profile(), T0, []
        self.arb = Arbiter(self.p, Journal(temp_dir() / "journal.jsonl"), self.ctl, now_ms=lambda: self.now, on_event=lambda e: self.events.append(e)); self.arb.start()

    def test_release_renew_and_reconcile_need_the_owner_token_and_lease_ids_are_unpredictable(self):
        a = self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 10000); b = self.arb.acquire("lab_simulation", "lab-2", self.arb.controller_epoch, 10000)
        self.assertTrue(a["ok"]); self.assertFalse(b["ok"]); self.assertNotRegex(a["leaseId"], r"^lease-\d+$"); self.assertGreaterEqual(len(a["leaseId"]), 12)
        self.assertEqual(self.arb.release(a["leaseId"], token="forged")["reasonCodes"], ["OWNER_TOKEN_INVALID"])
        self.assertEqual(self.arb.renew(a["leaseId"], 5000, token="forged")["reasonCodes"], ["OWNER_TOKEN_INVALID"])
        self.assertEqual(self.arb.renew(a["leaseId"], 5000, token=a["token"])["status"], "accepted")
        self.arb.submit(stage_env(self.p, a)); self.arb.submit(envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-run", program=demo_program_ref(self.p)), token=a["token"], lease=a["leaseId"]))
        self.assertEqual(self.arb.reconcile("cmd-run", token="forged")["reasonCodes"], ["OWNER_TOKEN_INVALID"])   # an owner holds: only its token may reconcile
        self.assertEqual(self.arb.reconcile("cmd-run", token=a["token"])["status"], "accepted")
        self.assertEqual(self.arb.release(a["leaseId"], token=a["token"])["status"], "accepted"); self.assertEqual(self.arb.status()["owner"]["kind"], "none")

    def test_lease_expiry_without_open_effects_frees_the_owner_and_with_a_running_job_marks_it_unknown(self):
        a = self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 5000); self.now += 6000
        self.assertEqual(self.arb.submit(stage_env(self.p, a, "s-late"))["reasonCodes"], ["LEASE_EXPIRED"])
        self.assertFalse(self.arb.status()["reconcileRequired"])                                                         # nothing was in flight: no sentinel, no deadlock
        self.assertIn("lease_expired", [e["event"] for e in self.events])
        b = self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 5000); self.assertTrue(b["ok"])
        self.arb.submit(stage_env(self.p, b)); self.arb.submit(envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-run", program=demo_program_ref(self.p)), token=b["token"], lease=b["leaseId"]))
        self.now += 6000; self.arb.observe()
        self.assertEqual(self.arb.status()["owner"]["kind"], "none"); self.assertEqual(self.arb.status()["unknownCommands"], ["cmd-run"])
        self.assertEqual([e["event"] for e in self.events if e.get("commandId") == "cmd-run"], ["outcome_unknown"])
        self.assertEqual(self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 5000)["reasonCodes"], ["RECONCILE_REQUIRED"])
        self.assertEqual(self.arb.reconcile("cmd-run")["status"], "accepted")                                               # no owner holds: the former owner (or the operator) reconciles without a token
        self.assertEqual(self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 5000)["reasonCodes"], ["TRANSFER_STATE_INVALID:running"])   # the job still runs on the controller
        self.ctl.finish("cmd-run"); self.arb.poll_completions()
        self.assertTrue(self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 5000)["ok"])

    def test_query_outcome_is_a_read_that_needs_no_owner(self):
        a = self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 5000); self.arb.submit(stage_env(self.p, a)); self.arb.release(a["leaseId"], token=a["token"])
        r = self.arb.submit(envelope(cell_command("query_outcome", {"targetCommandId": "cmd-stage"}, "q-1"), token="", lease=""))
        self.assertEqual((r["status"], r["outcome"]["status"]), ("accepted", "completed"))                                # staged program identity was observed after the send

    def test_revoke_emits_events_and_the_reply_fits_the_schema(self):
        a = self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 10000); self.arb.submit(stage_env(self.p, a))
        self.arb.submit(envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-run", program=demo_program_ref(self.p)), token=a["token"], lease=a["leaseId"]))
        r = self.arb.revoke("hmi:op-1", "operator takes over")
        self.assertEqual((r["kind"], r["status"], r["outcome"]["evidence"]["policy"]), ("arm.reply.v1", "accepted", "cancel_then_reconcile"))
        self.assertEqual(protocol.validate(r, protocol.load_validators()), [])
        self.assertEqual([e["event"] for e in self.events][-3:], ["outcome_unknown", "owner_revoked", "reconcile_required"])


class ProgramStagingTest(unittest.TestCase):
    def test_a_modified_program_file_or_a_forbidden_word_is_refused_at_staging(self):
        p, ctl, root = profile(), FakeController(), Path(tempfile.mkdtemp(prefix="arm-prog-"))
        shutil.copytree(ROOT / "programs", root / "programs")
        arb = Arbiter(p, Journal(root / "journal.jsonl"), ctl, now_ms=lambda: T0, program_root=root); arb.start()
        a = arb.acquire("lab_simulation", "lab-runtime", arb.controller_epoch, 10000)
        self.assertEqual(arb.submit(stage_env(p, a, "s1"))["status"], "accepted")
        (root / "programs" / "demo-six-axis.ngc").write_text("G20 G90\nG0 X99\nM2\n")
        self.assertEqual(arb.submit(stage_env(p, a, "s2"))["reasonCodes"], ["PROGRAM_FILE_HASH_MISMATCH:demo-six-axis"]); self.assertEqual(ctl.calls.count("stage"), 1)
        shutil.copy(ROOT / "programs" / "demo-six-axis.ngc", root / "programs" / "demo-six-axis.ngc")
        bad = profile(); bad["programs"]["demo-six-axis"]["sha256"] = hashlib.sha256(b"G20 G90\nM62 P0\nM2\n").hexdigest()
        (root / "programs" / "demo-six-axis.ngc").write_bytes(b"G20 G90\nM62 P0\nM2\n")
        arb2 = Arbiter(bad, Journal(root / "journal2.jsonl"), FakeController(), now_ms=lambda: T0, program_root=root); arb2.start()
        b = arb2.acquire("lab_simulation", "lab-runtime", arb2.controller_epoch, 10000)
        r = arb2.submit(envelope(cell_command("stage_program", {"profileId": bad["machineId"]}, "s3", program={"id": "demo-six-axis", "hash": bad["programs"]["demo-six-axis"]["sha256"]}), token=b["token"], lease=b["leaseId"], p=bad))
        self.assertEqual(r["reasonCodes"], ["PROGRAM_WORDS_NOT_ALLOWED:M62"])


class ControllerLifecycleTest(unittest.TestCase):
    def setUp(self):
        self.ctl, self.p, self.now, self.events = FakeController(), profile(), T0, []
        self.arb = Arbiter(self.p, Journal(temp_dir() / "journal.jsonl"), self.ctl, now_ms=lambda: self.now, on_event=lambda e: self.events.append(e)); self.arb.start()
        self.tok = self.arb.acquire("lab_simulation", "lab-runtime", self.arb.controller_epoch, 10000); self.arb.submit(stage_env(self.p, self.tok))

    def env(self, cap, payload, cid):
        return envelope(cell_command(cap, payload, cid, program=demo_program_ref(self.p)), token=self.tok["token"], lease=self.tok["leaseId"], controller_epoch=self.arb.controller_epoch)

    def test_controller_restart_under_a_live_bridge_bumps_the_epoch_and_never_resumes(self):
        self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run"))
        self.ctl.reboot("ctl-boot-2")
        self.assertEqual(self.arb.observe()["events"], ["controller_restart"]); self.assertEqual(self.arb.controller_epoch, 2)
        self.assertEqual(self.arb.status()["owner"]["kind"], "none"); self.assertEqual(self.arb.status()["unknownCommands"], ["cmd-run"])
        self.assertEqual([e["event"] for e in self.events][-3:], ["outcome_unknown", "controller_restart", "reconcile_required"]); self.assertEqual(self.ctl.calls.count("run"), 1)
        old = self.env("resume_job", {"jobId": "job-1"}, "cmd-resume"); old["controllerEpoch"] = 1                                  # built before the restart
        self.assertEqual(self.arb.submit(old)["reasonCodes"], ["EPOCH_MISMATCH"])

    def test_pause_resume_cancel_complete_only_on_an_observed_transition(self):
        self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run"))
        self.ctl.pause = lambda cid: self.ctl.calls.append("pause")                                                         # ACK without the controller actually pausing
        r = self.arb.submit(self.env("pause_job", {"jobId": "job-1"}, "cmd-pause"))
        self.assertEqual((r["status"], r["lifecycle"]), ("accepted", "accepted_not_completed")); self.assertEqual(self.arb.outcome("cmd-pause")["status"], "accepted")
        self.assertEqual(self.arb.poll_completions(), [])
        self.ctl.interp = "paused"
        self.assertEqual([c["commandId"] for c in self.arb.poll_completions()], ["cmd-pause"]); self.assertEqual(self.arb.outcome("cmd-pause")["status"], "completed")

    def test_a_job_the_controller_no_longer_knows_remains_unknown_until_trustworthy_reconciliation(self):
        self.arb.submit(self.env("start_job", {"jobId": "job-1"}, "cmd-run"))
        self.ctl.outcomes.clear()                                                                                            # a bridge restart lost the port's memory: not_found
        self.assertEqual(self.arb.reconcile("cmd-run", token=self.tok["token"])["outcome"]["status"], "unknown")
        self.assertEqual(self.arb.outcome("cmd-run")["status"], "unknown")
        self.assertTrue(self.arb.status()["reconcileRequired"])
        self.ctl.fault = "AMP_FAULT"; self.arb.observe()
        self.assertEqual(self.arb.status()["unknownCommands"], ["cmd-run"])                                                            # a terminal-unknown job is not re-marked on every fault


class ChannelServiceTest(unittest.TestCase):
    def setUp(self):
        self.dir, self.ctl, self.now, self.p = temp_dir(), FakeController(), T0, profile()
        self.arb = Arbiter(self.p, Journal(self.dir / "journal.jsonl"), self.ctl, now_ms=lambda: self.now); self.arb.start()
        self.svc = BridgeService(self.p, self.arb, self.ctl, socket_path=str(self.dir / "lab.sock"), local_socket_path=str(self.dir / "local.sock"), now_ms=lambda: self.now, status_hz=0); self.svc.start()

    def tearDown(self):
        self.svc.stop()

    def client(self, path):
        n = len(self.svc.clients); s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.settimeout(5); s.connect(path)
        for _ in range(100):
            if len(self.svc.clients) > n:
                break
            time.sleep(0.01)
        return s

    def rpc(self, s, msg):
        """Send one envelope and return its reply; status/event frames interleave on the same socket and are skipped here."""
        s.sendall(protocol.frame(msg)); f = s.makefile("rb")
        while True:
            line = f.readline()
            if not line:
                return None
            m = json.loads(line)
            if m.get("kind") == "arm.reply.v1":
                return m

    def base(self, actor, request_id="r1", **shape):
        return {"schemaVersion": 1, "kind": "arm.command.v1", "requestId": request_id, "machineId": self.p["machineId"], "controllerEpoch": self.arb.controller_epoch, "owner": {"token": "", "actor": actor}, "leaseId": "",
                "expected": {"profileHash": profile_hash(self.p), "modelManifestSha256": self.p["model"]["manifestSha256"]}, **shape}

    def test_the_lab_channel_cannot_claim_local_operator_nor_revoke_or_jog(self):
        lab = self.client(str(self.dir / "lab.sock"))
        self.assertEqual(self.rpc(lab, self.base("local_operator", acquire={"actor": "fake-hmi", "leaseMs": 5000}))["reasonCodes"], ["OWNER_KIND_NOT_ALLOWED_ON_CHANNEL:local_operator"])
        self.assertEqual(self.rpc(lab, self.base("lab_simulation", revoke={"actor": "lab", "reason": "x"}))["reasonCodes"], ["CHANNEL_FORBIDDEN:revoke"])
        self.assertEqual(self.rpc(lab, self.base("lab_simulation", local={"action": "jog_start", "joint": 0, "velocityDegS": 1}))["reasonCodes"], ["CHANNEL_FORBIDDEN:local"])
        self.assertEqual([c for c in self.ctl.calls if isinstance(c, tuple)], [])
        local = self.client(str(self.dir / "local.sock"))
        self.assertEqual(self.rpc(local, self.base("lab_simulation", acquire={"actor": "lab", "leaseMs": 5000}))["reasonCodes"], ["OWNER_KIND_NOT_ALLOWED_ON_CHANNEL:lab_simulation"])
        r = self.rpc(local, self.base("local_operator", acquire={"actor": "hmi:op-1", "leaseMs": 5000})); self.assertEqual(r["status"], "accepted")
        msg = self.base("local_operator", local={"action": "jog_start", "joint": 1, "velocityDegS": 2}); msg["owner"]["token"] = r["token"]; msg["leaseId"] = r["leaseId"]
        self.assertEqual(self.rpc(local, msg)["status"], "accepted"); self.assertEqual(self.ctl.calls[-1], ("jog", 1, 2.0))

    def test_replies_echo_the_request_id_and_status_frames_carry_reconcile_state(self):
        lab = self.client(str(self.dir / "lab.sock"))
        r = self.rpc(lab, self.base("lab_simulation", request_id="req-42", acquire={"actor": "lab", "leaseMs": 5000})); self.assertEqual(r["requestId"], "req-42")
        st = self.svc.status_message()
        self.assertEqual((st["reconcileRequired"], st["unknownCommands"]), (False, [])); self.assertEqual(protocol.validate(st, self.svc.validators), [])

    def test_lifecycle_events_reach_every_client(self):
        lab, local = self.client(str(self.dir / "lab.sock")), self.client(str(self.dir / "local.sock"))
        r = self.rpc(lab, self.base("lab_simulation", acquire={"actor": "lab", "leaseMs": 5000}))
        stage = envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "s1", program=demo_program_ref(self.p)), token=r["token"], lease=r["leaseId"], controller_epoch=self.arb.controller_epoch)
        self.rpc(lab, stage); run = envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-run", program=demo_program_ref(self.p)), token=r["token"], lease=r["leaseId"], controller_epoch=self.arb.controller_epoch); self.rpc(lab, run)
        got = self.rpc(local, self.base("local_operator", revoke={"actor": "hmi:op-1", "reason": "operator takes over"}))
        self.assertEqual(got["status"], "accepted")
        f = lab.makefile("rb"); seen = []; lab.settimeout(2)
        while len(seen) < 3:
            m = json.loads(f.readline())
            if m.get("kind") == "arm.event.v1" and m["event"] in ("outcome_unknown", "owner_revoked", "reconcile_required"):
                seen.append(m)
        self.assertEqual([(m["kind"], m["event"], m.get("commandId")) for m in seen], [("arm.event.v1", "outcome_unknown", "cmd-run"), ("arm.event.v1", "owner_revoked", None), ("arm.event.v1", "reconcile_required", None)])
        for m in seen:
            self.assertEqual(protocol.validate(m, self.svc.validators), [], m)

    def test_a_stalled_client_never_blocks_the_loop_and_sees_a_gap_marker(self):
        stalled, blocked_peer = socket.socketpair()
        fine, reading_peer = socket.socketpair()
        for sock in (stalled, blocked_peer, fine, reading_peer): self.addCleanup(sock.close)
        stalled.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1024)
        # Fill a real socket until its peer stops accepting data; no production send mock.
        stalled.setblocking(False)
        while True:
            try: stalled.send(b"x" * 4096)
            except BlockingIOError: break
        stalled.setblocking(True)
        with self.svc.lock:
            self.svc.clients += [stalled, fine]
        reading_peer.settimeout(2)
        f = reading_peer.makefile("rb"); self.addCleanup(f.close)
        t = time.monotonic()
        self.svc.broadcast(self.svc.status_message()); first = json.loads(f.readline())
        self.svc.broadcast(self.svc.status_message()); second = json.loads(f.readline())
        self.assertLess(time.monotonic() - t, 1.5)
        self.assertEqual(first["kind"], "arm.status.v1"); self.assertEqual(second["kind"], "arm.status.v1")
        self.assertEqual(self.svc.dropped.get(id(stalled)), 2)
        self.svc.dropped[id(fine)] = 3; self.svc.broadcast(self.svc.status_message())
        self.assertIn("SEQ_GAP:3", json.loads(f.readline())["reasonCodes"])
        self.assertEqual(self.svc.dropped.get(id(fine), 0), 0)
        self.svc.event("fault", None, ["X"]); self.assertNotIn(stalled, self.svc.clients)



if __name__ == "__main__":
    unittest.main()
