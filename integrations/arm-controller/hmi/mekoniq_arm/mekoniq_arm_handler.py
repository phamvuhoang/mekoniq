"""QtVCP handler of the MEKONIQ arm HMI (`DISPLAY = qtvcp -f mekoniq_arm`). Everything that moves or starts the machine goes through the bridge
arbiter over its local socket as arm.command.v1: the HMI holds a local_operator lease like any other client, it never calls the LinuxCNC
command channel, never opens the error_channel (the bridge service is the single consumer and fans out arm.event.v1 error_channel events),
and a restarted HMI acquires nothing and starts nothing by itself. The action policy below is pure and unit-tested; the Qt glue at the end is
only exercised by the Linux GUI smoke (docs/hmi-acceptance.md). Role UI is never a safety boundary: estop/enabling devices are independent."""
import hashlib
import json
import os
import socket
import threading
import time

try:
    import rfc8785
    _canonical = rfc8785.dumps
except ImportError:
    _canonical = lambda v: json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()

# Stock QtVCP ACTION methods that write to the controller directly. None of them is wired in this handler; the static test checks it.
BLOCKED_STOCK_ACTIONS = ("RUN", "RUN_FROM_LINE", "STEP", "ABORT", "PAUSE", "RESUME", "PAUSE_MACHINE", "MDI", "CALL_MDI", "CALL_MDI_WAIT", "SET_MDI_MODE", "SET_AUTO_MODE", "SET_MANUAL_MODE",
                         "JOG", "JOG_INCR", "JOG_ABS", "DO_JOG", "HOME", "UNHOME", "SET_MACHINE_HOMING", "SET_MACHINE_UNHOMED", "OPEN_PROGRAM", "LOAD_PROGRAM", "RELOAD_PROGRAM", "SET_ESTOP_STATE", "SET_MACHINE_STATE",
                         "SET_SPINDLE_RATE", "SET_FEED_RATE", "SET_RAPID_RATE", "TOGGLE_LIMITS_OVERRIDE", "SET_LIMITS_OVERRIDE", "SET_AXIS_ORIGIN", "SET_TOOL_OFFSET", "SET_DIRECT_TOOL_OFFSET", "SET_USER_SYSTEM")
LABELS = {
    "mode": {"vi": "Chế độ / backend", "ja": "モード / バックエンド", "en": "Mode / backend"}, "owner": {"vi": "Chủ điều khiển", "ja": "制御オーナー", "en": "Control owner"},
    "model": {"vi": "Model / profile", "ja": "モデル / プロファイル", "en": "Model / profile"}, "joints": {"vi": "Khớp (thực tế · lệnh)", "ja": "関節(実測 · 指令)", "en": "Joints (actual · commanded)"},
    "homed": {"vi": "Đã home", "ja": "ホーム済み", "en": "Homed"}, "program": {"vi": "Chương trình", "ja": "プログラム", "en": "Program"}, "fault": {"vi": "Lỗi", "ja": "異常", "en": "Fault"},
    "freshness": {"vi": "Độ mới dữ liệu", "ja": "データ鮮度", "en": "Telemetry freshness"}, "estop_reset": {"vi": "Reset E-stop (phần mềm)", "ja": "非常停止解除(ソフト)", "en": "Reset E-stop (software)"},
    "machine_on": {"vi": "Bật máy", "ja": "機械ON", "en": "Machine on"}, "acquire_local": {"vi": "Nhận quyền tại chỗ", "ja": "ローカル制御を取得", "en": "Take local control"},
    "release_local": {"vi": "Trả quyền", "ja": "制御を解放", "en": "Release control"}, "revoke": {"vi": "Thu hồi (dừng rồi đối soát)", "ja": "取り戻す(停止→照合)", "en": "Revoke (stop, then reconcile)"},
    "jog": {"vi": "Nhích khớp", "ja": "ジョグ", "en": "Jog"}, "home_all": {"vi": "Home tất cả", "ja": "全軸ホーム", "en": "Home all"}, "stage": {"vi": "Nạp chương trình đã duyệt", "ja": "承認プログラムを読込", "en": "Stage approved program"},
    "run": {"vi": "Chạy", "ja": "実行", "en": "Run"}, "pause": {"vi": "Tạm dừng", "ja": "一時停止", "en": "Pause"}, "resume": {"vi": "Tiếp tục", "ja": "再開", "en": "Resume"}, "stop": {"vi": "Dừng", "ja": "停止", "en": "Stop"},
    "reconcile": {"vi": "Đối soát", "ja": "照合", "en": "Reconcile"}, "stale": {"vi": "CŨ", "ja": "古い", "en": "STALE"}, "unknown": {"vi": "chưa rõ", "ja": "不明", "en": "unknown"},
    "safety_note": {"vi": "Giao diện này không phải mạch an toàn.", "ja": "この画面は安全回路ではありません。", "en": "This screen is not a safety circuit."},
}
LOCAL_ONLY = {"jog", "home_all"}


def allowed_actions(owner, state):
    """Pure policy: which HMI actions are offered for an owner (dict with kind) and a controller state
    ({task, interp, homed, fault, reconcileRequired, program}). There is no software E-stop: the physical circuit is independent of this UI.
    The arbiter re-checks everything; this only keeps the UI honest."""
    kind = (owner or {}).get("kind", "none")
    if kind == "none":
        return {"reconcile"} if state.get("reconcileRequired") else {"acquire_local"}
    if kind != "local_operator":
        return {"revoke"}                                                          # another owner: the local operator takes over only through the stop policy
    out = {"release_local"}
    if state.get("fault"):
        return out | {"stop", "reconcile", "estop_reset"}
    if state.get("reconcileRequired"):
        return out | {"reconcile"}
    task = state.get("task")
    if task == "estop":
        return out | {"estop_reset"}
    if task != "on":
        return out | {"machine_on"}
    out.add("stop")
    interp = state.get("interp")
    if interp == "running":
        return out | {"pause", "revoke"}
    if interp == "paused":
        return out | {"resume", "revoke"}
    out |= {"jog", "home_all", "stage"}
    if state.get("homed") and state.get("program"):
        out.add("run")
    return out


class HmiActions:
    """Bridge-facing actions of the HMI: builds arm.command.v1 envelopes with the local lease and refuses locally what the policy does not offer."""
    def __init__(self, profile, bridge, operator, now_ms=None):
        self.profile, self.bridge, self.operator = profile, bridge, operator
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))         # the IPC wall clock, the same one the arbiter uses for expiry
        self.token, self.lease, self.epoch, self.owner, self.state, self.status_at = "", "", 1, {"kind": "none", "actor": None, "leaseId": None}, None, None
        self._n, self.lease_expires_at = 0, None
        self.profile_hash = hashlib.sha256(_canonical(profile)).hexdigest()

    # ---- status in -----------------------------------------------------------------------------------------------------------------------------
    def on_status(self, status, now_ms=None):
        """arm.status.v1 (or the subset the tests feed): owner, task, program. Nothing here sends anything."""
        self.owner = status.get("owner") or self.owner
        self.epoch = status.get("controllerEpoch", self.epoch)
        t = status.get("task") or {}
        self.state = {"task": t.get("state"), "interp": t.get("interp"), "homed": bool(t.get("homed")), "fault": t.get("fault"), "reconcileRequired": bool(status.get("reconcileRequired")), "unknownCommands": list(status.get("unknownCommands") or []), "program": (status.get("program") or {}).get("id")}
        if self.owner.get("kind") != "local_operator" or (self.lease and self.owner.get("leaseId") != self.lease):
            self.token, self.lease, self.lease_expires_at = "", "", None          # the bridge says we no longer own: never keep a dead lease
        self.status_at = now_ms if now_ms is not None else self.now_ms()

    def view(self):
        enabled = allowed_actions(self.owner, self.state) if self.state else set()
        return {"owner": self.owner.get("kind", "none"), "enabled": enabled, "state": self.state, "statusAt": self.status_at}

    # ---- envelopes out -------------------------------------------------------------------------------------------------------------------------
    def _envelope(self, **shape):
        self._n += 1
        return {"schemaVersion": 1, "kind": "arm.command.v1", "requestId": f"hmi-{self._n}", "machineId": self.profile["machineId"], "controllerEpoch": self.epoch, "owner": {"token": self.token, "actor": "local_operator"}, "leaseId": self.lease,
                "expected": {"profileHash": self.profile_hash, "modelManifestSha256": self.profile["model"]["manifestSha256"]}, **shape}

    def tick(self):
        """Called by the refresh timer: renew the lease before it expires (renewBeforeMs); a refused renewal drops the lease locally."""
        if not self.lease or self.lease_expires_at is None or self.now_ms() < self.lease_expires_at - self.profile["lease"]["renewBeforeMs"]:
            return None
        r = self.bridge.send(self._envelope(renew={"leaseId": self.lease}))
        if r.get("status") == "accepted":
            self.lease_expires_at = r.get("expiresAtMs", self.now_ms() + self.profile["lease"]["ttlMs"])
        else:
            self.token, self.lease, self.lease_expires_at, self.owner = "", "", None, {"kind": "none", "actor": None, "leaseId": None}
        return r

    def _refuse(self, action):
        return {"schemaVersion": 1, "kind": "arm.reply.v1", "commandId": None, "status": "rejected", "lifecycle": "none", "duplicate": False, "reasonCodes": [f"ACTION_NOT_ALLOWED:{action}" if self.state else "STATE_UNKNOWN"]}

    def _gate(self, action):
        return None if self.state and action in allowed_actions(self.owner, self.state) else self._refuse(action)

    def acquire_local(self):
        if self.state and "acquire_local" not in allowed_actions(self.owner, self.state):
            return self._refuse("acquire_local")
        r = self.bridge.send(self._envelope(acquire={"actor": self.operator, "leaseMs": self.profile["lease"]["ttlMs"]}))
        if r.get("status") == "accepted":
            self.token, self.lease, self.lease_expires_at = r["token"], r["leaseId"], r.get("expiresAtMs", self.now_ms() + self.profile["lease"]["ttlMs"])
            self.owner = {"kind": "local_operator", "actor": self.operator, "leaseId": self.lease}
        return r

    def release_local(self):
        r = self.bridge.send(self._envelope(release={"leaseId": self.lease}))
        self.token, self.lease, self.lease_expires_at, self.owner = "", "", None, {"kind": "none", "actor": None, "leaseId": None}
        return r

    def estop_reset(self):
        return self._gate("estop_reset") or self.bridge.send(self._envelope(local={"action": "estop_reset", "joint": None, "velocityDegS": None}))

    def machine_on(self):
        return self._gate("machine_on") or self.bridge.send(self._envelope(local={"action": "machine_on", "joint": None, "velocityDegS": None}))

    def revoke(self, reason):
        return self._gate("revoke") or self.bridge.send(self._envelope(revoke={"actor": self.operator, "reason": reason[:200]}))

    def jog(self, joint, velocity_deg_s):
        return self._gate("jog") or self.bridge.send(self._envelope(local={"action": "jog_start", "joint": joint, "velocityDegS": velocity_deg_s}))

    def jog_stop(self, joint):
        return self.bridge.send(self._envelope(local={"action": "jog_stop", "joint": joint, "velocityDegS": None}))

    def home_all(self):
        return self._gate("home_all") or self.bridge.send(self._envelope(local={"action": "home_all", "joint": None, "velocityDegS": None}))

    def _command(self, capability, payload, program=None):
        self._n += 1
        now = self.now_ms()
        cid = f"hmi-{self.operator}-{now}-{self._n}"
        expires = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now / 1000 + 30)) + ".000Z"
        command = {"commandId": cid, "runId": "00000000-0000-4000-8000-000000000000", "deviceId": self.profile["machineId"], "controlEpoch": self.epoch, "expiresAt": expires, "recipeRevision": None,
                   "programRef": program, "capability": capability, "payloadHash": hashlib.sha256(_canonical(payload)).hexdigest(), "payload": payload}
        return self.bridge.send(self._envelope(command=command))

    def stage(self, program_id):
        p = self.profile["programs"].get(program_id)
        if not p:
            return self._refuse("stage")
        return self._gate("stage") or self._command("stage_program", {"profileId": self.profile["machineId"]}, {"id": program_id, "hash": p["sha256"]})

    def run(self):
        pid = self.state.get("program") if self.state else None
        p = self.profile["programs"].get(pid or "")
        return self._gate("run") or self._command("start_job", {"jobId": f"local-{self.operator}"}, {"id": pid, "hash": p["sha256"]} if p else None)

    def pause(self): return self._gate("pause") or self._command("pause_job", {"jobId": f"local-{self.operator}"})
    def resume(self): return self._gate("resume") or self._command("resume_job", {"jobId": f"local-{self.operator}"})
    def stop(self): return self._gate("stop") or self._command("cancel_job", {"jobId": f"local-{self.operator}"})
    def reconcile(self, command_id): return self.bridge.send(self._envelope(reconcile={"commandId": command_id}))


class BridgeClient:
    """Socket client of the bridge service (newline-delimited JSON) on the LOCAL channel; replies are matched by requestId (a late reply
    never answers the next request), status/events go to a callback thread."""
    def __init__(self, socket_path, on_message):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); self.sock.connect(socket_path)
        self.reader, self.on_message, self.replies, self.lock = self.sock.makefile("rb"), on_message, {}, threading.Lock()
        self.cv = threading.Condition(self.lock)
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self):
        for line in self.reader:
            m = json.loads(line)
            if m.get("kind") == "arm.reply.v1":
                with self.cv:
                    self.replies[m.get("requestId")] = m; self.cv.notify_all()
            else:
                self.on_message(m)

    def send(self, msg, timeout_s=5.0):
        rid = msg.setdefault("requestId", f"hmi-{time.monotonic_ns()}")
        with self.cv:
            self.sock.sendall(json.dumps(msg, separators=(",", ":")).encode() + b"\n")
            end = time.monotonic() + timeout_s
            while rid not in self.replies:
                if not self.cv.wait(end - time.monotonic()):
                    return {"schemaVersion": 1, "kind": "arm.reply.v1", "commandId": None, "status": "outcome_unknown", "lifecycle": "none", "duplicate": False, "reasonCodes": ["BRIDGE_TIMEOUT"]}
            return self.replies.pop(rid)


# ---- Qt glue (QtVCP loads this module as the handler; only exercised by the Linux GUI smoke) -------------------------------------------------
class HandlerClass:
    def __init__(self, halcomp, widgets, paths):
        self.h, self.w, self.paths = halcomp, widgets, paths
        cfg = os.path.dirname(os.environ.get("INI_FILE_NAME", ""))
        self.profile = json.load(open(os.path.join(cfg, "profile.json")))
        self.lang = os.environ.get("MEKONIQ_HMI_LANG", "vi")
        self.client = BridgeClient(self.profile["channel"]["localSocketPath"], self._on_message)
        self.actions = HmiActions(self.profile, self.client, operator=f"hmi:{os.environ.get('USER', 'operator')}")
        self.last_status_ms = None

    def initialized__(self):
        from PyQt5.QtCore import QTimer
        w, a = self.w, self.actions
        qss = os.path.join(os.path.dirname(__file__), "mekoniq_arm.qss")
        w.setStyleSheet(open(qss).read())
        t = lambda k: LABELS[k][self.lang]
        for key in ("mode", "owner", "model", "joints", "homed", "program", "fault", "freshness"):
            getattr(w, f"{key}Title").setText(t(key))
        w.safetyNote.setText(t("safety_note"))
        wiring = {"estopResetButton": ("estop_reset", a.estop_reset), "machineOnButton": ("machine_on", a.machine_on), "acquireButton": ("acquire_local", a.acquire_local), "releaseButton": ("release_local", a.release_local), "revokeButton": ("revoke", lambda: a.revoke("local operator takes over")),
                  "homeButton": ("home_all", a.home_all), "stageButton": ("stage", lambda: a.stage("demo-six-axis")), "runButton": ("run", a.run), "pauseButton": ("pause", a.pause), "resumeButton": ("resume", a.resume), "stopButton": ("stop", a.stop),
                  "reconcileButton": ("reconcile", lambda: a.reconcile(w.reconcileId.text()))}
        for name, (label, fn) in wiring.items():
            b = getattr(w, name); b.setText(t(label)); b.clicked.connect(lambda _=False, f=fn: self._run(f))
        for j in range(6):
            plus, minus = getattr(w, f"jogPlus{j}"), getattr(w, f"jogMinus{j}")
            v = self.profile["localMotion"]["maxJogVelocityDegS"] / 2
            plus.pressed.connect(lambda j=j, v=v: self._run(lambda: a.jog(j, v))); minus.pressed.connect(lambda j=j, v=v: self._run(lambda: a.jog(j, -v)))
            plus.released.connect(lambda j=j: self._run(lambda: a.jog_stop(j))); minus.released.connect(lambda j=j: self._run(lambda: a.jog_stop(j)))
        self.timer = QTimer(); self.timer.timeout.connect(self._refresh); self.timer.start(200)
        self._refresh()

    def _run(self, fn):
        r = fn()
        self.w.lastReply.setText(json.dumps({"status": r.get("status"), "reasonCodes": r.get("reasonCodes")}))

    def _on_message(self, m):
        if m.get("kind") == "arm.status.v1":
            self.actions.on_status(m); self.last_status_ms = int(time.time() * 1000); self._status = m
        elif m.get("kind") == "arm.event.v1":
            self._event = m

    def _refresh(self):
        self.actions.tick()                                                        # lease renewal before expiry
        w, t, view = self.w, lambda k: LABELS[k][self.lang], self.actions.view()
        s = getattr(self, "_status", None)
        age = None if self.last_status_ms is None else int(time.time() * 1000) - self.last_status_ms
        stale = age is None or age > self.profile["telemetry"]["staleMs"]
        w.modeBackend.setText(f"{self.profile['mode']} / {self.profile['backend']}")
        w.ownerLabel.setText(f"{view['owner']} ({(s or {}).get('owner', {}).get('actor') or '-'})")
        w.modelProfile.setText(f"{self.profile['model']['id']} r{self.profile['model']['revision']} · {self.profile['machineId']} · {self.actions.profile_hash[:8]}")
        w.freshnessLabel.setText(f"{t('stale')} {age} ms" if stale else f"{age} ms")
        if s:
            j = s["joints"]
            for i in range(6):
                act, cmd = j["actualRad"], j["commandedRad"]
                w.jointTable.item(i, 1).setText(t("unknown") if act is None else f"{act[i]:.4f}"); w.jointTable.item(i, 2).setText(t("unknown") if cmd is None else f"{cmd[i]:.4f}")
            w.homedLabel.setText(str(s["task"]["homed"])); w.programLabel.setText(f"{s['program']['id']} · {s['program']['state']}"); w.faultLabel.setText(s["task"]["fault"] or "-")
        for name, label in (("acquireButton", "acquire_local"), ("releaseButton", "release_local"), ("revokeButton", "revoke"), ("homeButton", "home_all"), ("stageButton", "stage"), ("runButton", "run"), ("pauseButton", "pause"),
                            ("resumeButton", "resume"), ("stopButton", "stop"), ("reconcileButton", "reconcile"), ("estopResetButton", "estop_reset"), ("machineOnButton", "machine_on")):
            getattr(w, name).setEnabled(label in view["enabled"] and not (stale and label in LOCAL_ONLY | {"run", "resume"}))
        for i in range(6):
            for side in ("jogPlus", "jogMinus"):
                getattr(w, f"{side}{i}").setEnabled("jog" in view["enabled"] and not stale)


def get_handlers(halcomp, widgets, paths):
    return [HandlerClass(halcomp, widgets, paths)]
