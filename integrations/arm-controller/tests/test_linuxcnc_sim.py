"""A02: the LinuxCNC simulation package is reproducible on paper and refuses to claim a run it did not make. INI/HAL/tool/program/lock/profile
are checked against the pinned model; the smoke script records blocked_external without a controller; the smoke driver sequence runs against
a fake controller here (bridge-side proof only). A real start/home/run/pause/resume/stop/fault sequence needs a Linux host: see README."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from support import MODEL_DIR, ROOT

CFG = ROOT / "configs" / "sim" / "puma560"
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()


def ini(path):
    """Minimal LinuxCNC INI reader: sections of KEY = VALUE, repeated keys kept as lists, comments stripped."""
    out, section = {}, None
    for raw in Path(path).read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("["):
            section = line.strip("[]"); out.setdefault(section, {}); continue
        k, _, v = line.partition("="); out[section].setdefault(k.strip(), []).append(v.strip())
    return {s: {k: v if len(v) > 1 else v[0] for k, v in kv.items()} for s, kv in out.items()}


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.ini, self.dh = ini(CFG / "mekoniq.ini"), json.loads((MODEL_DIR / "modified-dh.json").read_text())
        self.hal = (CFG / "machine.hal").read_text(); self.dhhal = (CFG / "puma560-dh.hal").read_text()

    def test_ini_pins_units_kinematics_display_and_model(self):
        i = self.ini
        self.assertEqual((i["TRAJ"]["LINEAR_UNITS"], i["TRAJ"]["ANGULAR_UNITS"]), ("inch", "deg"))
        self.assertTrue(i["RS274NGC"]["RS274NGC_STARTUP_CODE"].startswith("G20 "))
        self.assertEqual((i["KINS"]["KINEMATICS"], i["KINS"]["JOINTS"]), ("genserkins", "6"))
        self.assertEqual(i["DISPLAY"]["DISPLAY"], "qtvcp -f mekoniq_arm"); self.assertEqual(i["HAL"]["HALFILE"], "machine.hal")
        self.assertEqual(i["EMCMOT"]["EMCMOT"], "motmod"); self.assertEqual(i["EMCIO"]["TOOL_TABLE"], "tool.tbl")
        self.assertEqual(i["MEKONIQ"]["BACKEND"], "linuxcnc_sim"); self.assertEqual(i["MEKONIQ"]["PROFILE"], "profile.json")
        self.assertEqual(i["MEKONIQ"]["MODEL_MANIFEST"], "../../../models/puma560-reference/manifest.json")
        self.assertEqual(i["MEKONIQ"]["MODEL_MANIFEST_SHA256"], sha(MODEL_DIR / "manifest.json"))
        for n, j in enumerate(self.dh["joints"]):
            s = i[f"JOINT_{n}"]
            self.assertEqual(s["TYPE"], "ANGULAR", n)
            self.assertEqual((float(s["MIN_LIMIT"]), float(s["MAX_LIMIT"]), float(s["MAX_VELOCITY"]), float(s["HOME"])), (j["min"], j["max"], j["maxVelocity"], j["home"]), j["name"])

    def test_hal_is_virtual_loopback_with_the_pinned_dh_and_a_fault_fixture(self):
        values = {}
        for line in self.dhhal.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[0] == "setp":
                key, idx = parts[1].split(".")[1].rsplit("-", 1); values[(key, int(idx))] = float(parts[2])
        for n, j in enumerate(self.dh["joints"]):
            self.assertEqual((values[("A", n)], values[("ALPHA", n)], values[("D", n)]), (j["a"], j["alpha"], j["d"]), j["name"])
        self.assertIn("loadrt [KINS]KINEMATICS", self.hal); self.assertIn("source puma560-dh.hal", self.hal)
        for n in range(6):
            self.assertRegex(self.hal, rf"net\s+J{n}pos\s+joint\.{n}\.motor-pos-cmd\s*=>\s*joint\.{n}\.motor-pos-fb")
        self.assertRegex(self.hal, r"iocontrol\.0\.user-enable-out\s*=>\s*iocontrol\.0\.emc-enable-in")
        self.assertRegex(self.hal, r"net\s+mekoniq-fault-inject\s*=>\s*joint\.0\.amp-fault-in")
        content = "\n".join(l.split("#", 1)[0] for l in (self.hal + self.dhhal + (CFG / "mekoniq.ini").read_text()).splitlines()).lower()  # configuration, not comments
        for forbidden in ("lcec", "ethercat", "igh", "hm2", "parport", "ethercat.xml"):
            self.assertNotIn(forbidden, content, forbidden)

    def test_tool_table_declares_no_tool(self):
        rows = [l for l in (CFG / "tool.tbl").read_text().splitlines() if l.strip() and not l.startswith(";")]
        self.assertEqual(len(rows), 1); self.assertRegex(rows[0], r"^T1 P1 Z0(\.0)? D0(\.0)? ;tool-0-notool")

    def test_demo_program_is_allowlisted_by_hash_and_words(self):
        profile = json.loads((CFG / "profile.json").read_text()); prog = ROOT / "programs" / "demo-six-axis.ngc"
        entry = profile["programs"]["demo-six-axis"]
        self.assertEqual(entry["path"], "programs/demo-six-axis.ngc"); self.assertEqual(entry["sha256"], sha(prog))
        self.assertEqual(entry["model"], {"id": "puma560-reference", "revision": 1, "manifestSha256": sha(MODEL_DIR / "manifest.json")})
        allowed = set(profile["gcode"]["allowedWords"])
        words = {w for line in prog.read_text().splitlines() for w in re.findall(r"[A-Z]\d+(?:\.\d+)?", re.sub(r"\(.*?\)", "", line).split(";")[0])}
        codes = {re.sub(r"(?<=[GM])0+(?=\d)", "", w) for w in words if w[0] in "GM"}
        self.assertTrue(codes <= allowed, codes - allowed)
        self.assertFalse(re.search(r"(?i)\b(o<|M1\d\d|M6[2-9]|M7\d|M100|python|sys\.|subprocess)", prog.read_text()))
        self.assertIn("G20", codes); self.assertIn("M2", codes)

    def test_profile_fixes_stale_disconnect_lease_and_channel_bounds(self):
        p = json.loads((CFG / "profile.json").read_text())
        self.assertEqual(p["machineId"], "puma560-sim-1"); self.assertEqual(p["backend"], "linuxcnc_sim"); self.assertEqual(p["mode"], "simulation")
        self.assertEqual(p["telemetry"], {"staleMs": 500, "deviceStatusStaleMs": 2000, "clockSkewMaxMs": 250, "rateHz": 20})
        self.assertEqual(p["disconnect"], {"response": "hold_and_reconcile", "note": "a lost Lab link never stops a running program by itself and never resumes one; the local operator decides"})
        self.assertEqual(p["lease"], {"ttlMs": 10000, "renewBeforeMs": 3000, "expiredResponse": "block_next_command_require_reconcile"})
        self.assertEqual({k: p["channel"][k] for k in ("socketPath", "localSocketPath", "maxFrameBytes", "queueDepth", "maxCommandsPerSecond")}, {"socketPath": "/run/mekoniq-arm/bridge.sock", "localSocketPath": "/run/mekoniq-arm/local.sock", "maxFrameBytes": 65536, "queueDepth": 32, "maxCommandsPerSecond": 50})
        self.assertEqual(p["ownerTransfer"], {"allowedTaskStates": ["idle", "disabled"], "requireNoUnknownOutcome": True})
        self.assertEqual(p["units"], {"length": "inch", "angle": "deg", "alpha": "rad"})
        self.assertEqual(p["hardware"], {"enabled": False, "reason": "SIM_ONLY: hardware enable is provisioning-controlled, never a profile edit"})


class LockTest(unittest.TestCase):
    def test_lock_is_a_candidate_until_a_clean_host_verifies_it(self):
        lock = json.loads((ROOT / "packaging" / "dependencies.lock.json").read_text())
        self.assertEqual(lock["status"], "candidate"); self.assertFalse(lock["verified"])
        self.assertEqual(lock["host"], {"distribution": "debian", "release": "12 (bookworm)", "architecture": "amd64", "image": {"name": None, "sha512": None, "reason": "UNVERIFIED: recorded when the clean VM/PC is provisioned"},
                                        "kernel": "stock (no PREEMPT_RT needed for simulation)", "realtime": {"claim": "none", "note": "VM timings are not IPC real-time evidence"}})
        by = {c["id"]: c for c in lock["components"]}
        self.assertEqual(by["linuxcnc"]["candidateRelease"], {"tag": "v2.9.10", "publishedAt": "2026-07-03T00:19:48Z"})
        self.assertEqual(by["linuxcnc"]["branchHead"], {"branch": "2.9", "commit": "26a2827980d61b309ae6113ed0f036c410735a37", "date": "2026-11-01T11:16:03Z", "note": "a branch is not a lock"})
        self.assertEqual(by["linuxcnc"]["sampleCommit"], "135b0ce5220bef8f8a34b6825723108b8b9740f1")
        self.assertEqual(by["linuxcnc"]["debianPackage"]["version"], "2.9.0~pre1+git20230208.f1270d6ed7-1+deb12u2")
        self.assertEqual(by["python3-pyqt5"]["version"], "5.15.9+dfsg-1"); self.assertEqual(by["python3-pyqt5.qsci"]["version"], "2.13.3+dfsg-3")
        self.assertEqual(by["model"]["manifestSha256"], sha(MODEL_DIR / "manifest.json"))
        for c in lock["components"]:
            self.assertIn(c["status"], ("candidate", "verified"), c["id"])
            if c.get("sha256") is None:
                self.assertTrue(str(c.get("sha256Reason", "")).startswith("UNVERIFIED"), c["id"])
        self.assertEqual(lock["requires"], {"ethercat": False, "physicalNic": False, "realtimeKernel": False, "linux": True})
        self.assertEqual(lock["checkedAt"], "2026-11-05")


class SmokeScriptTest(unittest.TestCase):
    def assert_blocked_without_qualification(self, record):
        self.assertEqual(record["status"], "blocked_external")
        self.assertEqual(record["result"], "not_run")
        self.assertEqual(record["runtimeInventory"]["qualification"], "not_run")

    def test_blocked_record_allows_package_names_containing_pass(self):
        self.assert_blocked_without_qualification({
            "status": "blocked_external", "result": "not_run",
            "runtimeInventory": {
                "qualification": "not_run",
                "packages": [{"name": "base-passwd", "version": "3.6.3", "architecture": "amd64", "status": "installed"}],
            },
        })

    def test_blocked_record_rejects_false_pass_in_each_outcome(self):
        for field in ("status", "result", "qualification"):
            with self.subTest(field=field):
                record = {"status": "blocked_external", "result": "not_run", "runtimeInventory": {"qualification": "not_run"}}
                target = record["runtimeInventory"] if field == "qualification" else record
                target[field] = "pass"
                with self.assertRaises(AssertionError):
                    self.assert_blocked_without_qualification(record)

    def test_without_linuxcnc_the_smoke_records_blocked_external_and_exits_2(self):
        with tempfile.TemporaryDirectory() as d:
            env = {**os.environ, "PATH": "/usr/bin:/bin", "MEKONIQ_SMOKE_FORCE_MISSING": "1"}
            r = subprocess.run(["bash", str(ROOT / "scripts" / "smoke-sim.sh"), "--profile", str(CFG / "mekoniq.ini"), "--evidence-dir", d], env=env, capture_output=True, text=True, cwd=ROOT)
            self.assertEqual(r.returncode, 2, r.stdout + r.stderr)
            rec = json.loads(Path(d, "smoke-sim.json").read_text())
            self.assert_blocked_without_qualification(rec)
            self.assertTrue(set(rec["reasons"]) & {"LINUXCNC_MISSING", "HOST_NOT_LINUX", "LINUXCNC_PYTHON_MODULE_MISSING"})
            self.assertEqual(rec["profile"]["sha256"], sha(CFG / "mekoniq.ini")); self.assertEqual(rec["modelManifest"]["sha256"], sha(MODEL_DIR / "manifest.json"))
            self.assertEqual(rec["dependenciesLock"]["sha256"], sha(ROOT / "packaging" / "dependencies.lock.json")); self.assertEqual(rec["backend"], "linuxcnc_sim")
            self.assertIn("platform", rec["host"])

    def test_usage_errors_exit_2_without_touching_the_evidence_dir(self):
        with tempfile.TemporaryDirectory() as d:
            r = subprocess.run(["bash", str(ROOT / "scripts" / "smoke-sim.sh"), "--evidence-dir", d], capture_output=True, text=True, cwd=ROOT)
            self.assertEqual(r.returncode, 2); self.assertIn("usage", (r.stdout + r.stderr).lower()); self.assertEqual(os.listdir(d), [])


class FakeController:
    """Scripted controller: tracks estop/machine/homed/program/pause/fault the way the LinuxCNC stat() fields would show them."""
    def __init__(self):
        self.estop, self.on, self.homed, self.program, self.running, self.paused, self.fault, self.calls = True, False, False, None, False, False, False, []
    def version(self): return "fake-linuxcnc 0.0"
    def state(self): return {"estop": self.estop, "machineOn": self.on, "homed": self.homed, "program": self.program, "running": self.running, "paused": self.paused, "fault": self.fault}
    def estop_reset(self): self.calls.append("estop_reset"); self.estop = False
    def machine_on(self): self.calls.append("machine_on"); self.on = not self.estop and not self.fault
    def home_all(self): self.calls.append("home_all"); self.homed = self.on
    def program_open(self, path): self.calls.append(("program_open", path)); self.program = path
    def auto_run(self): self.calls.append("auto_run"); self.running = self.on and self.homed and self.program is not None
    def auto_pause(self): self.calls.append("auto_pause"); self.paused = self.running
    def auto_resume(self): self.calls.append("auto_resume"); self.paused = False
    def abort(self): self.calls.append("abort"); self.running = self.paused = False
    def inject_fault(self): self.calls.append("inject_fault"); self.fault = True; self.on = False; self.running = self.paused = False
    def clear_fault(self): self.calls.append("clear_fault"); self.fault = False


class SmokeDriverTest(unittest.TestCase):
    def test_sequence_start_home_run_pause_resume_stop_fault_and_no_auto_resume(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        from smoke_driver import run_sequence
        ctl, log = FakeController(), []
        rec = run_sequence(ctl, "programs/demo-six-axis.ngc", log.append, wait=lambda pred, timeout: pred())
        self.assertEqual([s["step"] for s in rec["steps"]], ["estop_reset", "machine_on", "home_all", "program_open", "auto_run", "auto_pause", "auto_resume", "abort", "inject_fault", "observe_fault", "clear_fault", "observe_no_auto_resume"])
        self.assertTrue(all(s["ok"] for s in rec["steps"]), rec["steps"]); self.assertEqual(rec["status"], "pass"); self.assertEqual(rec["controller"], "fake-linuxcnc 0.0")
        self.assertEqual(ctl.calls.count("auto_run"), 1)                                   # a fault is never followed by a second run
        self.assertEqual(rec["steps"][-1]["observed"], {"running": False, "paused": False, "machineOn": False})
        self.assertEqual(rec["provenance"], "controller_sim"); self.assertEqual(rec["backend"], "linuxcnc_sim")

    def test_a_step_that_does_not_reach_its_state_fails_the_record(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        from smoke_driver import run_sequence
        ctl = FakeController(); ctl.home_all = lambda: ctl.calls.append("home_all")        # homing never completes
        rec = run_sequence(ctl, "programs/demo-six-axis.ngc", lambda _: None, wait=lambda pred, timeout: pred())
        self.assertEqual(rec["status"], "fail"); self.assertEqual([s["step"] for s in rec["steps"] if not s["ok"]], ["home_all"])
        self.assertNotIn("auto_run", ctl.calls)


if __name__ == "__main__":
    unittest.main()

class Arm64VmLockTest(unittest.TestCase):
    def test_explicit_arm64_lock_is_recorded_even_when_runtime_is_missing(self):
        lock = ROOT / 'packaging' / 'dependencies.arm64-vm.lock.json'
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(['bash', str(ROOT / 'scripts' / 'smoke-sim.sh'), '--profile', str(CFG / 'mekoniq.ini'), '--dependencies-lock', str(lock), '--evidence-dir', directory], env={**os.environ, 'MEKONIQ_SMOKE_FORCE_MISSING': '1'}, capture_output=True, text=True, cwd=ROOT)
            self.assertEqual(result.returncode, 2)
            record = json.loads(Path(directory, 'smoke-sim.json').read_text())
            self.assertEqual(record['dependenciesLock']['sha256'], sha(lock))
            self.assertEqual(record['result'], 'not_run')
            candidate = json.loads(lock.read_text())
            self.assertFalse(candidate['verified'])
            self.assertEqual(candidate['host']['architecture'], 'arm64')
            self.assertIsNone(candidate['actualInventory'])
