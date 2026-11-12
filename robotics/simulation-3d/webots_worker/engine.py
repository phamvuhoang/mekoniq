"""The Webots process tree of one run: Webots itself (started by this module, never attached to), one supervisor process and one controller process per robot. All of them live
in the worker's process group, so the parent's group kill ends every one of them. Time moves only when every controller has been told to step."""
import hashlib
import json
import os
import random
import re
import select
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from .protocol import WorkerError

EXPECTED_VERSION = "R2025a"
START_TIMEOUT_S = 60.0
CHILD_TIMEOUT_S = 30.0
STEP_TIMEOUT_S = 4.0  # below the parent's 5 s ACK deadline, so a stuck engine is reported by this process, with its reason
PORT_RANGE = (20000, 29999)
HERE = Path(__file__).resolve().parent


def webots_executable(webots_home):
    exe = Path(webots_home) / "Contents" / "MacOS" / "webots"
    if not exe.is_file():
        raise WorkerError("WEBOTS_NOT_INSTALLED", f"{exe} does not exist", fatal=True)
    return exe


def webots_argv(exe, port, world, watch=False):
    """Headless and unrendered by default (fast, minimized). Watch mode (dev only, set by the runtime for real runs, never for a smoke) keeps the window up and rendering at real time; the sim clock is unchanged."""
    return [str(exe), "--batch", *(["--mode=realtime"] if watch else ["--minimize", "--mode=fast"]), "--stdout", "--stderr", f"--port={port}", str(world)]


def host_engine(webots_home):
    """(version, sha256 of the executable) of the installed Webots, without starting a simulation."""
    exe = webots_executable(webots_home)
    try:
        out = subprocess.run([str(exe), "--version"], capture_output=True, text=True, timeout=30, env={"PATH": "/usr/bin:/bin", "HOME": os.environ.get("HOME", "/")}).stdout
    except (OSError, subprocess.TimeoutExpired) as e:
        raise WorkerError("WEBOTS_NOT_INSTALLED", f"{exe} --version failed: {e}", fatal=True)
    m = re.search(r"\bR\d{4}[a-z]\b", out)
    if not m:
        raise WorkerError("WEBOTS_VERSION_MISMATCH", f"cannot read a version from {out.strip()[:100]!r}", fatal=True)
    sha = hashlib.sha256()
    with exe.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            sha.update(chunk)
    return m.group(0), sha.hexdigest()


def engine_env():
    """The environment of Webots: minimal on purpose, and with no USER, so Webots keeps its per-run state in /tmp/webots/default/<port> whoever runs the worker."""
    return {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "HOME": os.environ.get("HOME", "/"), "TMPDIR": os.environ.get("TMPDIR", "/tmp")}


def _tmp_dir(port):
    """The state directory Webots really creates for `port`: it names it after $USER or $USERNAME of ITS environment, else "default"."""
    env = engine_env()
    return Path("/tmp/webots") / (env.get("USER") or env.get("USERNAME") or "default") / str(port)


def free_port():
    """A port nothing listens on and that has no leftover Webots state (a stale /tmp/webots/<user>/<port> from a crashed run could let a new controller meet a dead world)."""
    rnd = random.SystemRandom()
    for _ in range(50):
        port = rnd.randint(*PORT_RANGE)
        if _tmp_dir(port).exists():
            continue
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
        return port
    raise WorkerError("WEBOTS_PORT_IN_USE", f"no free port in {PORT_RANGE[0]}-{PORT_RANGE[1]} without leftover Webots state", fatal=True)


class _Child:
    def __init__(self, name, argv, env, log):
        self.name = name
        self.proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, env=env, close_fds=True)
        self.buffer = b""

    def send(self, obj):
        try:
            self.proc.stdin.write((json.dumps(obj) + "\n").encode())
            self.proc.stdin.flush()
        except (BrokenPipeError, OSError):
            raise WorkerError("ENGINE_LOST", f"controller {self.name} is gone", fatal=True)

    def read(self, deadline):
        fd = self.proc.stdout.fileno()
        while b"\n" not in self.buffer:
            left = deadline - time.monotonic()
            if left <= 0:
                raise WorkerError("ENGINE_TIMEOUT", f"controller {self.name} did not answer in time", fatal=True)
            if not select.select([fd], [], [], min(left, 0.5))[0]:
                if self.proc.poll() is not None and not select.select([fd], [], [], 0)[0]:
                    raise WorkerError("ENGINE_LOST", f"controller {self.name} exited ({self.proc.returncode})", fatal=True)
                continue
            data = os.read(fd, 1 << 20)
            if not data:
                raise WorkerError("ENGINE_LOST", f"controller {self.name} closed its output", fatal=True)
            self.buffer += data
        line, self.buffer = self.buffer.split(b"\n", 1)
        return json.loads(line)

    def stop(self):
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        if self.proc.poll() is None:
            try:
                self.proc.wait(1.0)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        for stream in (self.proc.stdout,):
            try:
                stream.close()
            except OSError:
                pass


class WebotsEngine:
    def __init__(self, world_text, config):
        self.world, self.config = world_text, config
        self.home, self.run_dir = config["webotsHome"], Path(config["runDirectory"] or ".")
        self.python = config.get("python") or sys.executable
        self.webots = None
        self.children = {}
        self.logs = []
        self.port = None
        self.version = self.executable_sha256 = None

    # ---- start ----
    def start(self):
        exe = webots_executable(self.home)
        self.version, self.executable_sha256 = host_engine(self.home)
        if self.version != EXPECTED_VERSION:
            raise WorkerError("WEBOTS_VERSION_MISMATCH", f"found {self.version}, this worker is pinned to {EXPECTED_VERSION}", fatal=True)
        self.run_dir.mkdir(parents=True, exist_ok=True)
        world = self.run_dir / "world.wbt"
        world.write_text(self.world)
        os.chmod(world, 0o600)
        self.port = free_port()
        log = open(self.run_dir / "webots.log", "wb")
        self.logs.append(log)
        env = engine_env()
        self.webots = subprocess.Popen(webots_argv(exe, self.port, world, watch=os.environ.get("MEKONIQ_WEBOTS_WATCH") == "1"), stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, env=env)
        arm = self.config.get("arm")
        wanted = len(self.config["robots"]) + (1 if arm else 0) + 1
        deadline = time.monotonic() + START_TIMEOUT_S
        while True:
            text = (self.run_dir / "webots.log").read_text(errors="replace")
            if text.count("Waiting for local or remote connection") >= wanted:
                break
            if self.webots.poll() is not None:
                raise WorkerError("WEBOTS_START_FAILED", f"webots exited ({self.webots.returncode}) before it was ready: {text[-300:]!r}", fatal=True)
            if time.monotonic() > deadline:
                raise WorkerError("WEBOTS_START_FAILED", f"webots was not ready in {START_TIMEOUT_S:.0f} s: {text[-300:]!r}", fatal=True)
            time.sleep(0.1)
        cenv = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "WEBOTS_HOME": str(self.home), "HOME": os.environ.get("HOME", "/")}
        clog = open(self.run_dir / "controllers.log", "wb")
        self.logs.append(clog)

        def spawn(name, script, cfg):
            self.children[name] = _Child(name, [self.python, "-I", "-B", "-X", "utf8", str(HERE / script), json.dumps(cfg)], {**cenv, "WEBOTS_CONTROLLER_URL": f"ipc://{self.port}/{name}"}, clog)

        spawn("mekoniq_supervisor", "supervisor.py", {"robots": [{"id": r["id"], "bodySolids": r["bodySolids"], "wheelSolids": r["wheelSolids"]} for r in self.config["robots"]], **({"arm": {"name": arm["name"]}} if arm else {})})
        if arm:
            spawn(arm["name"], "arm_controller.py", {"joints": arm["joints"]})
        for r in self.config["robots"]:
            spawn(r["id"], "robot_controller.py", {"lidars": [l["name"] for l in r["lidars"]]})
        deadline = time.monotonic() + CHILD_TIMEOUT_S
        for name, child in self.children.items():
            if not child.read(deadline).get("ready"):
                raise WorkerError("WEBOTS_START_FAILED", f"controller {name} did not report ready", fatal=True)

    # ---- run ----
    def step(self, commands, lidar):
        if self.webots is None or self.webots.poll() is not None:
            raise WorkerError("ENGINE_LOST", f"webots exited ({None if self.webots is None else self.webots.returncode})", fatal=True)
        for r in self.config["robots"]:
            left, right = commands[r["id"]]
            self.children[r["id"]].send({"cmd": "step", "left": left, "right": right, "lidar": bool(lidar)})
        self.children["mekoniq_supervisor"].send({"cmd": "step"})
        deadline = time.monotonic() + STEP_TIMEOUT_S
        sup = self.children["mekoniq_supervisor"].read(deadline)
        robots = {}
        for r in self.config["robots"]:
            got = self.children[r["id"]].read(deadline)
            if abs(got["time"] - sup["time"]) > 1e-9:
                raise WorkerError("CLOCK_DRIFT", f"controller {r['id']} is at {got['time']}, the supervisor at {sup['time']}", fatal=True)
            robots[r["id"]] = {**sup["robots"][r["id"]], "wheelPositions": got["wheelPositions"], "lidar": got["lidar"]}
        return {"time": sup["time"], "robots": robots, "contacts": sup["contacts"]}

    def step_arm(self, targets):
        """One 20 ms tick of an arm run: every joint to its target position, then the supervisor's contacts. The arm controller and the supervisor must agree on the engine time."""
        if self.webots is None or self.webots.poll() is not None:
            raise WorkerError("ENGINE_LOST", f"webots exited ({None if self.webots is None else self.webots.returncode})", fatal=True)
        arm = self.config["arm"]["name"]
        self.children[arm].send({"cmd": "step", "targets": list(targets)})
        self.children["mekoniq_supervisor"].send({"cmd": "step"})
        deadline = time.monotonic() + STEP_TIMEOUT_S
        sup = self.children["mekoniq_supervisor"].read(deadline)
        got = self.children[arm].read(deadline)
        if abs(got["time"] - sup["time"]) > 1e-9:
            raise WorkerError("CLOCK_DRIFT", f"the arm controller is at {got['time']}, the supervisor at {sup['time']}", fatal=True)
        return {"time": sup["time"], "arm": {"positions": got["positions"], "velocities": got["velocities"]}, "armContacts": sup["armContacts"]}

    def readback(self):
        sup = self.children["mekoniq_supervisor"]
        sup.send({"cmd": "readback"})
        return sup.read(time.monotonic() + STEP_TIMEOUT_S)

    # ---- end ----
    def close(self):
        for child in self.children.values():
            try:
                child.send({"cmd": "quit"})
            except WorkerError:
                pass
        for child in self.children.values():
            child.stop()
        self.children = {}
        proc, self.webots = self.webots, None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(2.0)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        if self.port is not None:
            shutil.rmtree(_tmp_dir(self.port), ignore_errors=True)  # a killed Webots leaves this behind; the next run must not meet it
        for log in self.logs:
            log.close()
        self.logs = []
