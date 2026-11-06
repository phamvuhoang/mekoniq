"""A03 bridge protocol: typed envelopes validated against the shared schemas (arm-command = cell-command + owner/epoch/expectations), a fixed
local socket with bounded frames/queue/rate, no arbitrary HAL/MDI/file/network content, one error-channel consumer. Fake controller only."""
import json
import os
import socket
import threading
import time
import unittest

from support import ROOT, SOURCE
from arm_fixture import T0, cell_command, demo_program_ref, envelope, profile, profile_hash, temp_dir
from fake_controller import FakeController

from bridge import protocol
from bridge.arbiter import Arbiter
from bridge.journal import Journal
from bridge.service import BridgeService

FIXTURE = SOURCE / "tests" / "fixtures" / "digital-twin" / "arm" / "messages.json"


class SchemaTest(unittest.TestCase):
    def setUp(self):
        self.v = protocol.load_validators()

    def test_arm_command_schema_refs_cell_command_and_fixture_messages_validate_both_ways(self):
        schema = json.loads((SOURCE / "packages/contracts/schemas/arm-command.schema.json").read_text())
        self.assertEqual(schema["$id"], "mekoniq.arm-command.v1"); self.assertEqual(schema["properties"]["command"], {"$ref": "cell-command.schema.json"})
        obs = json.loads((SOURCE / "packages/contracts/schemas/arm-observation.schema.json").read_text())
        self.assertEqual(obs["$id"], "mekoniq.arm-observation.v1"); self.assertEqual([b["properties"]["kind"]["const"] for b in obs["oneOf"]], ["arm.status.v1", "arm.event.v1", "arm.reply.v1"])
        fx = json.loads(FIXTURE.read_text())
        self.assertEqual(fx["profileHash"], profile_hash())                                  # the fixture is bound to the pinned sim profile
        for m in fx["valid"]:
            self.assertEqual(protocol.validate(m["message"], self.v), [], m["name"])
        for m in fx["invalid"]:
            codes = protocol.validate(m["message"], self.v)
            self.assertTrue(codes, m["name"]); self.assertTrue(any(c.startswith(m["code"]) for c in codes), (m["name"], codes))

    def test_forbidden_content_is_named_not_swallowed(self):
        env = envelope(cell_command("query_outcome", {"targetCommandId": "cmd-0"}))
        env["command"]["payload"]["url"] = "http://10.0.0.1/halcmd"
        self.assertEqual(protocol.validate(env, self.v), ["ENDPOINT_FORBIDDEN:url"])
        env = envelope(cell_command("query_outcome", {"targetCommandId": "cmd-0"})); env["command"]["gcode"] = "G0 X1"
        self.assertEqual(protocol.validate(env, self.v), ["RAW_COMMAND_FORBIDDEN:gcode"])
        env = envelope(cell_command("query_outcome", {"targetCommandId": "cmd-0"})); env["owner"]["role"] = "admin"
        self.assertEqual(protocol.validate(env, self.v), ["ACTOR_FORBIDDEN:role"])
        env = envelope(cell_command("query_outcome", {"targetCommandId": "cmd-0"})); env["command"]["payload"]["targetCommandId"] = "../../etc/passwd"
        self.assertEqual(protocol.validate(env, self.v), ["INVALID_FIELD:/command/payload/targetCommandId"])

    def test_expiry_and_clock_skew_use_the_local_clock(self):
        p = profile()
        env = envelope(cell_command("query_outcome", {"targetCommandId": "cmd-0"}, expires="2026-11-05T07:59:59.000Z"))
        self.assertEqual(protocol.check_command(env, p, T0), ["COMMAND_EXPIRED"])
        env = envelope(cell_command("query_outcome", {"targetCommandId": "cmd-0"}, expires="2026-11-05T09:00:00.000Z"))
        self.assertEqual(protocol.check_command(env, p, T0), ["CLOCK_SKEW_EXCEEDED"])
        self.assertEqual(protocol.check_command(envelope(cell_command("query_outcome", {"targetCommandId": "cmd-0"})), p, T0), [])
        self.assertEqual(protocol.local_deadline_ms("2026-11-05T08:00:30.000Z", T0, p), T0 + 30000)

    def test_frames_are_bounded(self):
        import io
        big = b'{"a":"' + b"x" * 70000 + b'"}\n'
        with self.assertRaises(protocol.ProtocolError) as cm:
            list(protocol.read_frames(io.BytesIO(big), 65536))
        self.assertEqual(cm.exception.code, "FRAME_TOO_LARGE")
        self.assertEqual(list(protocol.read_frames(io.BytesIO(b'{"a":1}\n{"b":2}\n'), 65536)), [{"a": 1}, {"b": 2}])
        with self.assertRaises(protocol.ProtocolError):
            protocol.parse_strict(b'{"a":1,"a":2}')


class ServiceTest(unittest.TestCase):
    """The service on a real Unix socket in a temp dir (the profile path is fixed on the IPC; tests override it)."""
    def setUp(self):
        self.dir, self.ctl, self.now = temp_dir(), FakeController(), T0
        self.p = profile(); self.journal = Journal(self.dir / "journal.jsonl")
        self.arb = Arbiter(self.p, self.journal, self.ctl, now_ms=lambda: self.now); self.arb.start()
        self.sock = str(self.dir / "bridge.sock")
        self.svc = BridgeService(self.p, self.arb, self.ctl, socket_path=self.sock, now_ms=lambda: self.now, status_hz=0)
        self.svc.start()

    def tearDown(self):
        self.svc.stop()

    def client(self):
        n = len(self.svc.clients)
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.settimeout(5); s.connect(self.sock)
        for _ in range(100):                                                            # the server registers the client on accept, not on connect
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

    def test_socket_is_fixed_owner_only_and_two_clients_get_one_owner(self):
        self.assertEqual(oct(os.stat(self.sock).st_mode & 0o777), "0o600")
        a, b = self.client(), self.client()
        acquire = lambda kind, actor: {"schemaVersion": 1, "kind": "arm.command.v1", "machineId": self.p["machineId"], "controllerEpoch": self.arb.controller_epoch, "owner": {"token": "", "actor": kind}, "leaseId": "",
                                       "expected": {"profileHash": profile_hash(self.p), "modelManifestSha256": self.p["model"]["manifestSha256"]}, "acquire": {"actor": actor, "leaseMs": 5000}}
        results = {}
        def go(name, s, kind):
            results[name] = self.rpc(s, acquire(kind, name))
        t1, t2 = threading.Thread(target=go, args=("hmi:op-1", a, "local_operator")), threading.Thread(target=go, args=("lab-runtime", b, "lab_simulation"))
        t1.start(); t2.start(); t1.join(); t2.join()
        oks = [r for r in results.values() if r["status"] == "accepted"]
        self.assertEqual(len(oks), 1, results); self.assertEqual(self.arb.status()["owner"]["kind"] in ("local_operator", "lab_simulation"), True)

    def test_oversize_frame_closes_the_connection_with_a_reason(self):
        s = self.client(); s.sendall(b'{"pad":"' + b"x" * 70000 + b'"}\n')
        f = s.makefile("rb"); line = f.readline()
        self.assertEqual(json.loads(line)["reasonCodes"], ["FRAME_TOO_LARGE"]); self.assertEqual(f.readline(), b"")

    def test_supplied_endpoint_and_duplicate_ids_over_the_socket(self):
        s = self.client()
        r = self.rpc(s, {"schemaVersion": 1, "kind": "arm.command.v1", "machineId": self.p["machineId"], "controllerEpoch": self.arb.controller_epoch, "owner": {"token": "", "actor": "lab_simulation"}, "leaseId": "",
                         "expected": {"profileHash": profile_hash(self.p), "modelManifestSha256": self.p["model"]["manifestSha256"]}, "acquire": {"actor": "lab-runtime", "leaseMs": 5000}})
        tok, lease = r["token"], r["leaseId"]
        bad = envelope(cell_command("query_outcome", {"targetCommandId": "cmd-0"}), token=tok, lease=lease, controller_epoch=self.arb.controller_epoch); bad["command"]["payload"]["socket"] = "/run/x.sock"
        self.assertEqual(self.rpc(s, bad)["reasonCodes"], ["ENDPOINT_FORBIDDEN:socket"])
        st = envelope(cell_command("stage_program", {"profileId": self.p["machineId"]}, "cmd-stage", program=demo_program_ref()), token=tok, lease=lease, controller_epoch=self.arb.controller_epoch)
        self.assertEqual(self.rpc(s, st)["status"], "accepted")
        run = envelope(cell_command("start_job", {"jobId": "job-1"}, "cmd-run", program=demo_program_ref()), token=tok, lease=lease, controller_epoch=self.arb.controller_epoch)
        first, again = self.rpc(s, run), self.rpc(s, run)
        self.assertEqual((first["status"], again["status"], again["duplicate"]), ("accepted", "accepted", True)); self.assertEqual(self.ctl.calls.count("run"), 1)

    def test_rate_and_queue_are_bounded(self):
        s = self.client()
        msgs = [envelope(cell_command("query_outcome", {"targetCommandId": f"c{i}"}, f"q{i}"), token="x", lease="y", controller_epoch=self.arb.controller_epoch) for i in range(60)]
        replies, f = [], s.makefile("rb")
        def read():                                                               # a real client reads while it sends; the service never blocks on a stalled peer
            while len(replies) < 60:
                m = json.loads(f.readline())
                if m.get("kind") == "arm.reply.v1":
                    replies.append(m)
        reader = threading.Thread(target=read, daemon=True); reader.start()
        for m in msgs:
            s.sendall(protocol.frame(m))
        reader.join(10); self.assertEqual(len(replies), 60)
        limited = [r for r in replies if "RATE_LIMITED" in r["reasonCodes"] or "QUEUE_FULL" in r["reasonCodes"]]
        self.assertGreater(len(limited), 0); self.assertLessEqual(len(replies) - len(limited), self.p["channel"]["maxCommandsPerSecond"] + self.p["channel"]["queueDepth"])

    def test_error_channel_has_one_consumer_and_fans_out_as_events(self):
        a, b = self.client(), self.client()
        self.ctl.errors.append({"kind": "operator_error", "text": "joint 0 following error"})
        self.svc.poll_once()
        for s in (a, b):
            f = s.makefile("rb"); e = json.loads(f.readline())
            while e.get("event") != "error_channel":
                e = json.loads(f.readline())
            self.assertEqual((e["kind"], e["event"]), ("arm.event.v1", "error_channel")); self.assertEqual(e["detail"], "joint 0 following error")
        self.assertEqual(self.ctl.errors, []); self.assertEqual(self.svc.error_consumers, 1)


if __name__ == "__main__":
    unittest.main()
