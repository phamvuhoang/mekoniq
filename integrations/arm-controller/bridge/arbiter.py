"""Command arbiter of the arm controller: the single place that turns commands into controller calls. One owner at a time (none,
local_operator, lab_simulation, authorized_cell_job) with controller epoch + lease; transfer only when the controller is idle/disabled and no
outcome is unknown; idempotent command ids; lifecycle accepted != completed (completion is an observed controller transition); every send
journaled before the call; a lost reply is outcome_unknown and blocks further effects until reconciled; release/renew/reconcile are bound to
the owner token; a local operator revokes through the stop policy, never a new command. Lifecycle changes go out through `on_event`."""
import hashlib
import re
import secrets
import threading
from pathlib import Path

from . import protocol
from .sim_gripper import SimGripper

EFFECTS = {"stage_program", "start_job", "pause_job", "resume_job", "cancel_job"}
STATE_NEEDED = {"pause_job": ("running",), "resume_job": ("paused",), "cancel_job": ("running", "paused"), "start_job": ("idle",)}
# what the controller must show before an immediate command counts as completed (an ACK is never a completion)
TRANSITION = {"pause_job": "paused", "resume_job": "running", "cancel_job": "idle"}
TERMINAL = ("completed", "failed", "unknown")
_WORD = re.compile(r"[A-Z]\d+(?:\.\d+)?")
_FORBIDDEN = re.compile(r"(?i)\b(o<|M1\d\d|M6[2-9]|M7\d|M100|python|sys\.|subprocess)")


def _serialised(method):
    def wrapper(self, *a, **k):
        with self._lock:
            return method(self, *a, **k)
    wrapper.__name__, wrapper.__doc__ = method.__name__, method.__doc__
    return wrapper


class Arbiter:
    def __init__(self, profile, journal, controller, now_ms, token_factory=lambda: secrets.token_urlsafe(24), on_event=None, program_root=None):
        self.profile, self.journal, self.ctl, self.now_ms, self._token = profile, journal, controller, now_ms, token_factory
        self.on_event = on_event or (lambda event: None)
        self.program_root = Path(program_root) if program_root else Path(__file__).resolve().parents[1]
        self.owner, self.controller_epoch, self.unknown, self._fault_seen, self._boot_id = None, 1, [], None, None
        self._lease_ttl, self._transfer = profile["lease"]["ttlMs"], profile["ownerTransfer"]
        self.sim_gripper = SimGripper(profile["simulationScene"]) if profile["mode"] == "simulation" and profile.get("simulationScene") else None
        self.sim_commands = {}
        self._active_jogs = set()
        self._lock = threading.RLock()                 # one decision at a time: two simultaneous acquires can never both succeed

    # ---- lifecycle ---------------------------------------------------------------------------------------------------------------------------
    @_serialised
    def start(self):
        """Bridge (re)start: owner tokens die, the controller boot id decides the epoch, pending sends are reconciled (same boot) or unknown (new boot)."""
        state = self.ctl.state()
        last = self.journal.last("epoch")
        changed = last is not None and last["bootId"] != state["bootId"]
        self.controller_epoch = (last["epoch"] + 1 if changed else last["epoch"]) if last else 1
        if last is None or changed:
            self.journal.append({"kind": "epoch", "epoch": self.controller_epoch, "bootId": state["bootId"], "atMs": self.now_ms()})
        self._boot_id = state["bootId"]
        self._lifecycle("controller_restart" if changed else "bridge_restart" if last else "bridge_start", state["bootId"])
        self.owner = None
        for row in self.journal.entries():
            if row.get("kind") == "local" and row.get("action") == "jog_start":
                self._active_jogs.add(row["joint"])
            elif row.get("kind") == "local" and row.get("action") == "jog_stop_confirmed":
                self._active_jogs.discard(row["joint"])
        self._stop_jogs("BRIDGE_RESTART")
        self.unknown = [cid for cid in self._unknown_from_journal()]
        reconciled = []
        if changed:
            for cid in self._unfinished_effects():
                self._mark_unknown(cid, ["CONTROLLER_REBOOT"])
        else:
            for cid in dict.fromkeys([*self.unknown, *self._unfinished_effects()]):
                self.reconcile(cid, reason="BRIDGE_RESTART")
                reconciled.append(cid)
        if self.unknown:
            self._event("reconcile_required", None, ["RECONCILE_REQUIRED"], ",".join(self.unknown))
        return {"epoch": self.controller_epoch, "epochChanged": changed, "pendingReconciled": reconciled, "reconcileRequired": bool(self.unknown)}

    def _lifecycle(self, event, boot_id):
        self.journal.append({"kind": "lifecycle", "event": event, "controllerEpoch": self.controller_epoch, "bootId": boot_id, "atMs": self.now_ms()})
        self.on_event({"event": event, "commandId": None, "reasonCodes": [f"EPOCH:{self.controller_epoch}"], "detail": str(boot_id)})

    def _controller_changed(self, state):
        """The controller rebooted under a live bridge: new epoch, every open effect unknown, the owner is gone; nothing resumes."""
        self.controller_epoch += 1
        self.journal.append({"kind": "epoch", "epoch": self.controller_epoch, "bootId": state["bootId"], "atMs": self.now_ms()})
        self._boot_id = state["bootId"]
        for cid in self._open_effects():
            self._mark_unknown(cid, ["CONTROLLER_REBOOT"])
        self.owner = None
        self._lifecycle("controller_restart", state["bootId"])
        if self.unknown:
            self._event("reconcile_required", None, ["RECONCILE_REQUIRED"], ",".join(self.unknown))

    def _unknown_from_journal(self):
        """Command ids whose last word in the journal is outcome_unknown (no later terminal outcome row)."""
        out = []
        for e in self.journal.entries():
            if e.get("kind") == "command" and e.get("intent") == "answered" and e.get("status") == "outcome_unknown" and e["commandId"] not in out and self.journal.outcome(e["commandId"]) is None:
                out.append(e["commandId"])
        return out

    def _unfinished_effects(self):
        """All sends that may have taken effect, including acknowledged nonterminal commands."""
        out = []
        for e in self.journal.entries():
            if e.get("kind") != "command" or e.get("intent") != "sending" or not e.get("effect"):
                continue
            cid = e["commandId"]
            rec = self.journal.command(cid)
            if cid not in out and self.journal.outcome(cid) is None and (not rec["answered"] or rec["answered"]["status"] in ("accepted", "outcome_unknown")):
                out.append(cid)
        return out

    def _stop_jogs(self, reason):
        """Continuous manual motion survives interpreter idle; stop it before dropping its owner."""
        for joint in sorted(self._active_jogs):
            try:
                self.ctl.jog_stop(joint)
            except Exception:
                continue  # keep the durable intent and the ownership gate until a stop is acknowledged
            self.journal.append({"kind": "local", "action": "jog_stop_confirmed", "joint": joint, "reason": reason, "atMs": self.now_ms()})
            self._active_jogs.discard(joint)
        return not self._active_jogs

    def _open_effects(self):
        """start_job commands the controller may still be executing: accepted or unknown, with no terminal outcome row yet."""
        out = []
        for e in self.journal.entries():
            if e.get("kind") != "command" or e.get("intent") != "sending" or e.get("capability") != "start_job" or e["commandId"] in out:
                continue
            rec = self.journal.command(e["commandId"])
            if rec["answered"] and rec["answered"].get("status") in ("accepted", "outcome_unknown") and self.journal.outcome(e["commandId"]) is None and e["commandId"] not in self.unknown:
                out.append(e["commandId"])
        return out

    def _mark_unknown(self, cid, codes):
        self._answer(cid, "outcome_unknown", codes, effect=True)
        if cid not in self.unknown:
            self.unknown.append(cid)

    # ---- ownership ---------------------------------------------------------------------------------------------------------------------------
    @_serialised
    def status(self):
        o = self.owner
        return {"owner": {"kind": o["kind"], "actor": o["actor"], "leaseId": o["leaseId"]} if o else {"kind": "none", "actor": None, "leaseId": None},
                "controllerEpoch": self.controller_epoch, "reconcileRequired": bool(self.unknown), "unknownCommands": list(self.unknown)}

    def _event(self, event, command_id, codes, detail=None):
        self.journal.append({"kind": "owner", "event": event, "commandId": command_id, "reasonCodes": codes, "detail": detail, "atMs": self.now_ms(), "controllerEpoch": self.controller_epoch})
        self.on_event({"event": event, "commandId": command_id, "reasonCodes": list(codes), "detail": detail})

    def _expire(self):
        if self.owner and self.now_ms() >= self.owner["expiresAtMs"]:
            lease = self.owner["leaseId"]
            self._stop_jogs("LEASE_EXPIRED")
            self.owner = None
            self._event("lease_expired", None, [], lease)
            for cid in self._open_effects():          # a lease that died with a job in flight leaves that job's outcome to be re-asked
                self._mark_unknown(cid, ["LEASE_EXPIRED"])
            if self.unknown:
                self._event("reconcile_required", None, ["RECONCILE_REQUIRED"], ",".join(self.unknown))
            return True
        return False

    @_serialised
    def acquire(self, kind, actor, controller_epoch, lease_ms, simulation_scene=None):
        self._expire()
        no = lambda code: {**self._reply(None, "rejected", [code]), "ok": False}
        if simulation_scene and (not self.sim_gripper or kind != "lab_simulation"):
            return no("SIM_SCENE_UNSUPPORTED")
        if kind not in protocol.OWNER_KINDS or kind == "none":
            return no("OWNER_KIND_INVALID")
        if controller_epoch != self.controller_epoch:
            return no("EPOCH_MISMATCH")
        if lease_ms > self._lease_ttl * 60 or lease_ms < 1000:
            return no("LEASE_TOO_LONG" if lease_ms > self._lease_ttl * 60 else "LEASE_TOO_SHORT")
        if self.unknown:
            return no("RECONCILE_REQUIRED")
        if self._active_jogs:
            return no("JOG_STOP_UNCONFIRMED")
        if self.owner:
            return no(f"OWNER_HELD:{self.owner['kind']}")
        st = self.ctl.state()
        task = "disabled" if st["taskState"] != "on" else st["interp"]
        if task not in self._transfer["allowedTaskStates"]:
            return no(f"TRANSFER_STATE_INVALID:{task}")
        if self._open_effects():
            return no("COMMAND_IN_FLIGHT")
        if self.sim_gripper:
            if simulation_scene:
                try:
                    self.sim_gripper.bind(simulation_scene["runId"], simulation_scene["worldRevision"], self.controller_epoch)
                except ValueError as e:
                    return no(str(e))
            else:
                self.sim_gripper.pin = None
        self.owner = {"kind": kind, "actor": actor, "token": self._token(), "leaseId": secrets.token_urlsafe(9), "expiresAtMs": self.now_ms() + lease_ms, "controllerEpoch": self.controller_epoch}
        self._event("owner_acquired", None, [], f"{kind}:{actor}")
        return {**self._reply(None, "accepted", []), "ok": True, "token": self.owner["token"], "leaseId": self.owner["leaseId"], "expiresAtMs": self.owner["expiresAtMs"]}

    def _bound(self, lease_id, token):
        """The caller must present the current owner's token and lease; anything else is refused (never by lease id alone)."""
        if not self.owner:
            return ["LEASE_UNKNOWN"]
        if token != self.owner["token"] or lease_id != self.owner["leaseId"]:
            return ["OWNER_TOKEN_INVALID"]
        return []

    @_serialised
    def release(self, lease_id, token=None):
        codes = self._bound(lease_id, token)
        if codes:
            return self._reply(None, "rejected", codes)
        if not self._stop_jogs("OWNER_RELEASED"):
            return self._reply(None, "rejected", ["JOG_STOP_UNCONFIRMED"])
        self._event("owner_released", None, [], lease_id); self.owner = None
        return self._reply(None, "accepted", [])

    @_serialised
    def renew(self, lease_id, lease_ms, token=None):
        self._expire()
        codes = self._bound(lease_id, token)
        if codes:
            return self._reply(None, "rejected", codes)
        self.owner["expiresAtMs"] = self.now_ms() + min(lease_ms, self._lease_ttl * 60)
        return {**self._reply(None, "accepted", []), "expiresAtMs": self.owner["expiresAtMs"]}

    @_serialised
    def revoke(self, actor, reason):
        """Local operator takes control: cancel what runs (journaled like any effect), drop the owner, require reconciliation. No new command."""
        cancelled = []
        if not self._stop_jogs("OWNER_REVOKED"):
            return self._reply(None, "rejected", ["JOG_STOP_UNCONFIRMED"])
        st = self.ctl.state()
        if st["interp"] in ("running", "paused"):
            cid = f"revoke-{len(self.journal.entries()) + 1}"
            self.journal.append({"kind": "command", "intent": "sending", "commandId": cid, "capability": "cancel_job", "effect": True, "controllerEpoch": self.controller_epoch, "actor": actor, "atMs": self.now_ms(), "reason": reason})
            try:
                self.ctl.cancel(cid)
                self._answer(cid, "accepted", [], effect=True)
            except Exception as e:  # noqa: BLE001
                self._answer(cid, "outcome_unknown", [f"SEND_INTERRUPTED:{type(e).__name__}"], effect=True)
            cancelled.append(cid)
        for open_id in self._open_effects():
            self._mark_unknown(open_id, ["REVOKED"])
        self.owner = None
        self._event("owner_revoked", None, [], f"{actor}: {reason}")
        if self.unknown:
            self._event("reconcile_required", None, ["RECONCILE_REQUIRED"], ",".join(self.unknown))
        return {**self._reply(None, "accepted", []), "lifecycle": "immediate", "outcome": {"status": "completed", "evidence": {"policy": "cancel_then_reconcile", "cancelled": cancelled, "reconcileRequired": bool(self.unknown)}}}

    # ---- commands ----------------------------------------------------------------------------------------------------------------------------
    def _reply(self, command_id, status, codes, **extra):
        return {"schemaVersion": 1, "kind": protocol.KIND_REPLY, "commandId": command_id, "status": status, "lifecycle": "none", "duplicate": False, "reasonCodes": codes, **extra}

    def _answer(self, cid, status, codes, effect=False, outcome=None):
        self.journal.append({"kind": "command", "intent": "answered", "commandId": cid, "status": status, "reasonCodes": codes, "effect": effect, "outcome": outcome, "controllerEpoch": self.controller_epoch, "atMs": self.now_ms()})
        if status == "outcome_unknown":
            self.on_event({"event": "outcome_unknown", "commandId": cid, "reasonCodes": list(codes), "detail": None})

    def _owner_check(self, env):
        o = env.get("owner") or {}
        if self._expire():
            return ["LEASE_EXPIRED"]
        if not self.owner or o.get("token") != self.owner["token"] or o.get("actor") != self.owner["kind"] or env.get("leaseId") != self.owner["leaseId"]:
            return ["OWNER_TOKEN_INVALID"]
        return []

    @_serialised
    def update_sim_scene(self, env):
        codes = self._owner_check(env)
        if env["controllerEpoch"] != self.controller_epoch:
            codes.append("EPOCH_MISMATCH")
        if not self.sim_gripper or env["owner"]["actor"] != "lab_simulation":
            codes.append("SIM_SCENE_UNSUPPORTED")
        if codes:
            return self._reply(None, "rejected", codes)
        try:
            self.sim_gripper.update(env["simScene"])
        except ValueError as e:
            return self._reply(None, "rejected", [str(e)])
        self.journal.append({"kind": "sim_scene", "receivedMonotonicNs": str(self.sim_gripper.receipt), "scene": env["simScene"], "controllerEpoch": self.controller_epoch, "atMs": self.now_ms()})
        return self._reply(None, "accepted", [])

    def _check_program(self, program_id):
        """The staged file must be byte-identical to the allowlisted hash and use allowlisted words only (a G-code file has side effects)."""
        p = self.profile["programs"][program_id]
        path = self.program_root / p["path"]
        try:
            data = path.read_bytes()
        except OSError:
            return [f"PROGRAM_FILE_MISSING:{program_id}"]
        if hashlib.sha256(data).hexdigest() != p["sha256"]:
            return [f"PROGRAM_FILE_HASH_MISMATCH:{program_id}"]
        text = data.decode("utf-8", "replace")
        sanitised = text
        for line in text.splitlines():
            code = re.sub(r"\(.*?\)", "", line).split(";")[0].strip().upper()
            if any(re.sub(r"(?<=M)0+(?=\d)", "", w) in ("M64", "M65") for w in _WORD.findall(code)):
                if (self.profile["mode"] != "simulation" or not self.profile.get("simulationScene")
                        or not re.fullmatch(r"M(?:64|65)\s+P0", code)):
                    return ["PROGRAM_SIM_OUTPUT_NOT_ALLOWED"]
                sanitised = sanitised.replace(line, "")
        if _FORBIDDEN.search(sanitised):
            return [f"PROGRAM_WORDS_NOT_ALLOWED:{_FORBIDDEN.search(sanitised).group(0)}"]
        allowed = set(self.profile.get("gcode", {}).get("allowedWords", []))
        for line in text.splitlines():
            code = re.sub(r"\(.*?\)", "", line).split(";")[0]
            for w in _WORD.findall(code):
                if w[0] in "GM" and re.sub(r"(?<=[GM])0+(?=\d)", "", w) not in allowed:
                    return [f"PROGRAM_WORDS_NOT_ALLOWED:{w}"]
        return []

    @_serialised
    def submit(self, env):
        codes = protocol.check_command(env, self.profile, self.now_ms())
        cmd = env.get("command") or {}
        cid = cmd.get("commandId")
        if codes:
            return self._reply(cid, "rejected", codes)
        if env.get("controllerEpoch") != self.controller_epoch:
            return self._reply(cid, "rejected", ["EPOCH_MISMATCH"])
        cap = cmd["capability"]
        if cap == "query_outcome":                      # a read of what became of a command: no owner needed (reconciliation starts here)
            self._expire()
            return {**self._reply(cid, "accepted", [], outcome=self.outcome(cmd["payload"]["targetCommandId"])), "lifecycle": "immediate"}
        codes = self._owner_check(env)
        if codes:
            return self._reply(cid, "rejected", codes)
        prior = self.journal.command(cid)
        if prior:
            if prior["payloadHash"] != cmd.get("payloadHash"):
                self.journal.append({"kind": "audit", "code": "COMMAND_ID_CONFLICT", "commandId": cid, "atMs": self.now_ms(), "actor": env["owner"]["actor"]})
                return self._reply(cid, "conflict", ["COMMAND_ID_CONFLICT"])
            a = prior["answered"]
            return {**self._reply(cid, a["status"] if a else "outcome_unknown", a["reasonCodes"] if a else ["SEND_INTERRUPTED"], outcome=self.outcome(cid)), "lifecycle": "accepted_not_completed" if prior["effect"] else "immediate", "duplicate": True}
        if self.unknown:
            return self._reply(cid, "rejected", [f"RECONCILE_REQUIRED:{self.unknown[0]}"])
        st = self.ctl.state()
        if st.get("fault"):
            return self._reply(cid, "rejected", [f"CONTROLLER_FAULT:{st['fault']}"])
        if cap in STATE_NEEDED and st["interp"] not in STATE_NEEDED[cap]:
            return self._reply(cid, "rejected", [f"STATE_INVALID:{st['interp']}"])
        if cap == "start_job":
            if self.sim_gripper and self.sim_gripper.pin and cmd["runId"] != self.sim_gripper.pin[0]:
                return self._reply(cid, "rejected", ["SIM_SCENE_RUN_MISMATCH"])
            if self._open_effects():
                return self._reply(cid, "rejected", ["COMMAND_IN_FLIGHT"])
            if not cmd.get("programRef") or st.get("program") != cmd["programRef"]["id"]:
                return self._reply(cid, "rejected", ["PROGRAM_NOT_STAGED"])
            if not st["homed"]:
                return self._reply(cid, "rejected", ["NOT_HOMED"])
        if cap == "stage_program":
            codes = self._check_program(cmd["programRef"]["id"])
            if codes:
                return self._reply(cid, "rejected", codes)
        self.journal.append({"kind": "command", "intent": "sending", "commandId": cid, "capability": cap, "payloadHash": cmd["payloadHash"], "effect": True, "controllerEpoch": self.controller_epoch,
                             "deviceId": cmd.get("deviceId"), "controlEpoch": cmd.get("controlEpoch"), "actor": env["owner"]["actor"], "deadlineMs": protocol.local_deadline_ms(cmd["expiresAt"], self.now_ms(), self.profile), "atMs": self.now_ms()})
        try:
            if cap == "stage_program":
                p = self.profile["programs"][cmd["programRef"]["id"]]
                self.ctl.stage(cmd["programRef"]["id"], p["path"], p["sha256"])
            elif cap == "start_job":
                self.sim_commands[cid] = dict(cmd)
                self.ctl.run(cid)
            elif cap == "pause_job":
                self.ctl.pause(cid)
            elif cap == "resume_job":
                self.ctl.resume(cid)
            elif cap == "cancel_job":
                self.ctl.cancel(cid)
        except Exception as e:  # noqa: BLE001 - the effect may have happened: unknown, never resent
            self._mark_unknown(cid, ["SEND_INTERRUPTED", f"ERROR:{type(e).__name__}"])
            self._event("reconcile_required", None, ["RECONCILE_REQUIRED"], ",".join(self.unknown))
            return {**self._reply(cid, "outcome_unknown", ["SEND_INTERRUPTED"]), "lifecycle": "accepted_not_completed"}
        self._answer(cid, "accepted", [], effect=True)
        if cap == "stage_program" and self.ctl.state().get("program") == cmd["programRef"]["id"]:
            self.journal.append({"kind": "outcome", "commandId": cid, "result": "completed", "evidence": {"program": cmd["programRef"]["id"]}, "atMs": self.now_ms()})
        return {**self._reply(cid, "accepted", []), "lifecycle": "accepted_not_completed"}

    @_serialised
    def outcome(self, command_id):
        # Recovery must compare the live controller with the command's original fence,
        # including terminal rows retained across a later controller reboot.
        result = self._recorded_outcome(command_id)
        state, rec = self.ctl.state(), self.journal.command(command_id)
        live_boot = self.ctl.recovery_identity() if hasattr(self.ctl, "recovery_identity") else str(state["bootId"])
        sending = rec["sending"] if rec else {}
        return {**result, "evidence": {**result.get("evidence", {}),
                "controllerIdentity": {"bootId": live_boot, "epoch": self.controller_epoch},
                "commandIdentity": {"commandId": command_id, "deviceId": sending.get("deviceId"), "payloadHash": sending.get("payloadHash"), "controlEpoch": sending.get("controlEpoch"), "controllerEpoch": sending.get("controllerEpoch")}}}

    def _recorded_outcome(self, command_id):
        """What the journal knows: unknown until reconciled, a recorded terminal outcome, else the ACK state (running for a job, accepted otherwise)."""
        rec = self.journal.command(command_id)
        if not rec:
            return {"status": "not_found", "evidence": {}}
        if command_id in self.unknown:
            return {"status": "unknown", "evidence": {"reason": rec["answered"]["reasonCodes"] if rec["answered"] else ["SEND_INTERRUPTED"]}}
        row = self.journal.outcome(command_id)
        if row:
            return {"status": row["result"], "evidence": row.get("evidence", {})}
        if rec["answered"] and rec["answered"]["status"] == "outcome_unknown":
            return {"status": "unknown", "evidence": {"reason": rec["answered"]["reasonCodes"]}}
        if rec["answered"] and rec["answered"]["status"] != "accepted":
            return {"status": "failed", "evidence": {"reasonCodes": rec["answered"]["reasonCodes"]}}
        return {"status": "running" if rec["sending"].get("capability") == "start_job" else "accepted", "evidence": {"lifecycle": "accepted_not_completed"}}

    @_serialised
    def reconcile(self, command_id, token=None, reason="OPERATOR_RECONCILE"):
        """Ask the controller what became of a command and record the answer; never resend. The owner's token when an owner holds, else open."""
        if self.owner and token != self.owner["token"]:
            return self._reply(command_id, "rejected", ["OWNER_TOKEN_INVALID"])
        live = self.ctl.outcome(command_id)
        status = live.get("status")
        if status in ("completed", "failed"):
            self.journal.append({"kind": "outcome", "commandId": command_id, "result": status, "evidence": live.get("evidence", {}), "atMs": self.now_ms(), "via": reason})
        elif status not in ("running", "accepted"):
            # Not knowing a job is not evidence that it did not execute. Keep the gate across restarts.
            self._mark_unknown(command_id, ["CONTROLLER_OUTCOME_UNAVAILABLE", reason])
            self._event("reconcile_required", command_id, ["RECONCILE_REQUIRED"])
            return {**self._reply(command_id, "accepted", [reason], outcome=self.outcome(command_id)), "lifecycle": "immediate"}
        else:
            self._answer(command_id, "accepted", [reason], effect=True, outcome=live)
        self.unknown = [c for c in self.unknown if c != command_id]
        self._event("reconciled", command_id, [reason])
        return {**self._reply(command_id, "accepted", [reason], outcome=self.outcome(command_id)), "lifecycle": "immediate"}

    @_serialised
    def reconcile_all(self):
        for cid in list(self.unknown):
            self.reconcile(cid)

    @_serialised
    def poll_completions(self):
        """Observed completions since the last poll: a job the controller reports terminal, or an immediate command whose transition is visible."""
        out, st = [], self.ctl.state()
        for cid in self._open_effects():
            live = self.ctl.outcome(cid)
            if live["status"] in ("completed", "failed"):
                self.journal.append({"kind": "outcome", "commandId": cid, "result": live["status"], "evidence": live.get("evidence", {}), "atMs": self.now_ms()})
                out.append({"commandId": cid, "result": live["status"], "sending": self.journal.command(cid)["sending"], "evidence": live.get("evidence", {})})
        for e in self.journal.entries():
            if e.get("kind") != "command" or e.get("intent") != "sending" or e.get("capability") not in TRANSITION or self.journal.outcome(e["commandId"]) or e["commandId"] in self.unknown:
                continue
            rec = self.journal.command(e["commandId"])
            if rec["answered"] and rec["answered"]["status"] == "accepted" and st["interp"] == TRANSITION[e["capability"]]:
                self.journal.append({"kind": "outcome", "commandId": e["commandId"], "result": "completed", "evidence": {"interp": st["interp"]}, "atMs": self.now_ms()})
                out.append({"commandId": e["commandId"], "result": "completed", "sending": e, "evidence": {"interp": st["interp"]}})
        return out

    @_serialised
    def local_motion(self, env):
        """HMI-local jog/home/estop-reset/machine-on: the local_operator owner only; jog/home need the controller on and idle; |velocity| capped by the profile."""
        o, local = env.get("owner") or {}, env.get("local") or {}
        if o.get("actor") != "local_operator":
            return self._reply(None, "rejected", ["OWNER_KIND_REQUIRED:local_operator"])
        codes = self._owner_check(env)
        if codes:
            return self._reply(None, "rejected", codes)
        action = local.get("action")
        if action in ("estop_reset", "machine_on"):
            self.journal.append({"kind": "local", "action": action, "actor": o.get("actor"), "atMs": self.now_ms(), "controllerEpoch": self.controller_epoch})
            (self.ctl.estop_reset if action == "estop_reset" else self.ctl.machine_on)()
            return {**self._reply(None, "accepted", []), "lifecycle": "immediate"}
        if self.unknown:
            return self._reply(None, "rejected", [f"RECONCILE_REQUIRED:{self.unknown[0]}"])
        st = self.ctl.state()
        if st.get("fault") or st["taskState"] != "on" or st["interp"] != "idle":
            return self._reply(None, "rejected", [f"STATE_INVALID:{st.get('fault') or st['taskState'] + '/' + st['interp']}"])
        lm = self.profile.get("localMotion", {"maxJogVelocityDegS": 0, "joints": 6})
        joint, vel = local.get("joint"), local.get("velocityDegS")
        if action in ("jog_start", "jog_stop") and (not isinstance(joint, int) or not 0 <= joint < lm["joints"]):
            return self._reply(None, "rejected", ["JOINT_INVALID"])
        if action == "jog_start" and (not isinstance(vel, (int, float)) or not 0 < abs(vel) <= lm["maxJogVelocityDegS"]):
            return self._reply(None, "rejected", ["JOG_VELOCITY_INVALID"])
        self.journal.append({"kind": "local", "action": action, "joint": joint, "velocityDegS": vel, "actor": o.get("actor"), "atMs": self.now_ms(), "controllerEpoch": self.controller_epoch})
        if action == "jog_start":
            self._active_jogs.add(joint)  # intent precedes the send: an interrupted send may still move
            self.ctl.jog(joint, float(vel))
        elif action == "jog_stop":
            self.ctl.jog_stop(joint)
            self._active_jogs.discard(joint)
            self.journal.append({"kind": "local", "action": "jog_stop_confirmed", "joint": joint, "atMs": self.now_ms()})
        elif action == "home_all":
            self.ctl.home_all()
        else:
            return self._reply(None, "rejected", ["LOCAL_ACTION_INVALID"])
        return {**self._reply(None, "accepted", []), "lifecycle": "immediate"}

    @_serialised
    def observe(self):
        """Controller poll for the service: a changed boot id is a controller restart (new epoch), a lease may expire, a new fault makes
        every open effect unknown. No automatic return to running on any of these."""
        st = self.ctl.state()
        events = []
        if self._boot_id is not None and st.get("bootId") != self._boot_id:
            self._controller_changed(st)
            events.append("controller_restart")
            st = self.ctl.state()
        if self._expire():
            events.append("lease_expired")
        if not self.owner and self._active_jogs:
            self._stop_jogs("NO_OWNER")
        if st.get("fault") and st["fault"] != self._fault_seen:
            self._fault_seen = st["fault"]
            for cid in self._open_effects():
                self._mark_unknown(cid, [f"CONTROLLER_FAULT:{st['fault']}"])
            self._event("fault", None, [st["fault"]])
            if self.unknown:
                self._event("reconcile_required", None, ["RECONCILE_REQUIRED"], ",".join(self.unknown))
            events.append("fault")
        elif not st.get("fault"):
            self._fault_seen = None
        return {"events": events, "state": st, "status": self.status()}
