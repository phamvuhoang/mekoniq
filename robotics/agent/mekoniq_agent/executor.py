"""Onboard robot executor. Journal before native I/O, one goal at a time, never a resend of an uncertain goal.

States: sending (journaled, native call outstanding) -> accepted (native ACKed) -> executing (native query shows it active) -> terminal
(native reported succeeded/canceled/aborted, or the native side refused it). `unknown` = ownership uncertain (no ACK, crash, STOP,
unreachable/forgotten by the native side); it blocks any new goal until a native query resolves it. `completed` means only that the
native action reported SUCCEEDED for this goal UUID: it is not arrival/localization proof (W06-T04) and not exactly-once execution."""
import json
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, Protocol

from . import ownership
from .journal import ExecutorError, Journal
from .protocol import command_hash, validate_command

_NAMESPACE = uuid.UUID("5e0c1c25-6d0c-4a51-9a52-6f3a0a3a7e01")  # fixed: a goal UUID is derived from robot+command, so it is stable across restarts


class SimulatedCrash(RuntimeError):
    """Raised only by the test-injected `fault` hook, after the journal is closed without writing further."""


class NativeRejected(Exception):
    def __init__(self, reason="GOAL_REJECTED"):
        super().__init__(reason)
        self.reason = reason


@dataclass
class NativeResult:
    """status: accepted|executing|canceling|succeeded|canceled|aborted|unknown|not_found (ROS action GoalStatus names)."""
    status: str
    evidence: dict = field(default_factory=dict)

    @property
    def completed(self):
        return self.status == "succeeded"


class NativeNavigation(Protocol):
    supports_speed_limit: bool
    def start(self, goal_uuid: str, target: dict, speed_limit_mps: Optional[float] = None) -> None:
        """Return normally = native ACK. Raise NativeRejected = refused. Any other exception = no ACK (outcome unknown)."""
    def query(self, goal_uuid: str) -> NativeResult: ...  # raises when the native side cannot be asked
    def cancel(self, goal_uuid: str) -> bool: ...          # True = cancel request acknowledged (not "stopped")
    def request_stop(self) -> bool: ...                    # True = stop request acknowledged (not a physical stop)


_TERMINAL = {"succeeded": "succeeded", "canceled": "canceled", "aborted": "aborted"}
_ACTIVE = {"accepted": "accepted", "executing": "executing", "canceling": "executing"}


def _now_ms():
    return time.time_ns() // 1_000_000


class Executor:
    def __init__(self, db_path, native, profile, *, fault=None, clock=_now_ms):
        assert fault in (None, "before_native_call", "after_native_accept")  # test-only hook; production wiring never passes it
        self.native, self.profile, self.clock, self._fault = native, profile, clock, fault
        self._lock = threading.RLock()
        self.journal = Journal(db_path)
        self.journal.bind(profile.robot_id, profile.executor_id, profile.control_epoch)
        self.journal.recover_unfinished(clock())
        # Not ready (not advertised, no new goals) until reconcile() has asked the native side about every goal left open.
        self.ready = not self.journal.open(profile.robot_id) and not self.journal.stop_pending(profile.robot_id)

    def close(self):
        self.journal.close()

    # -- results ---------------------------------------------------------------------------------------------------------------------
    @staticmethod
    def _refuse(reason):
        return {"accepted": False, "unknown": False, "reason": reason}

    def _acceptance(self, row):
        goal = {"nativeGoalId": row["goal_uuid"]}
        if row["state"] in ("accepted", "executing"):
            return {"accepted": True, "unknown": False, **goal}
        if row["state"] == "terminal":
            ok = row["outcome"] in ("succeeded", "canceled")
            return {"accepted": ok, "unknown": False, **({} if ok else {"reason": row["reason"] or row["outcome"]}), **goal}
        return {"accepted": False, "unknown": True, "reason": row["reason"] or row["state"], **goal}

    def status(self, command_id):
        row = self.journal.command(command_id)
        return row["state"] if row else "unknown"

    def state(self, command_id):
        """{status, completed, evidence}; a command never journaled is unknown (the journal is the only record of what we sent)."""
        row = self.journal.command(command_id)
        if row is None:
            return {"status": "unknown", "completed": False, "evidence": {"reason": "NOT_JOURNALED", "transport": "native"}}
        evidence = {"transport": "native", "commandId": command_id, "hash": row["command_hash"], "controlEpoch": row["control_epoch"], "goalUuid": row["goal_uuid"],
                    "outcome": row["outcome"], "reason": row["reason"], "ackAtMs": row["ack_at_ms"], "stopAtMs": row["stop_at_ms"],
                    "cancelPending": bool(row["cancel_pending"]), "native": json.loads(row["evidence_json"]) if row["evidence_json"] else None}
        return {"status": row["state"], "completed": row["outcome"] == "succeeded", "evidence": evidence}

    # -- submit ----------------------------------------------------------------------------------------------------------------------
    def submit(self, command):
        with self._lock:
            now, p = self.clock(), self.profile
            try:
                validate_command(command)
            except ValueError:
                return self._refuse("INVALID_COMMAND")
            digest = command_hash(command)
            old = self.journal.command(command["commandId"])
            if old:  # same command id: answer from the journal, never a second goal
                if old["command_hash"] != digest:
                    raise ExecutorError("IDEMPOTENCY_CONFLICT")
                return self._acceptance(old)
            if self.journal.stop_pending(p.robot_id):
                return self._refuse("STOP_UNCONFIRMED")  # STOP then retarget only after the STOP is acknowledged
            if not self.ready:
                return self._refuse("NOT_READY")
            reason = (ownership.scope_reason(command, p) or ownership.epoch_reason(command["controlEpoch"], self.journal.control_epoch(p.robot_id))
                      or ownership.time_reason(command, now, p))
            if reason:
                return self._refuse(reason)
            limit = command["limits"].get("speedLimitMps")
            if limit is not None and not self.native.supports_speed_limit:
                return self._refuse("SPEED_UNSUPPORTED")  # a limit the backend cannot honour is refused, never ignored
            reason = ownership.domain_reason(command["target"], p)
            if reason:
                return self._refuse(reason)
            self.reconcile()  # earlier goals may have ended; ask the native side before deciding
            if not self.ready:
                return self._refuse("NOT_READY")
            goal = str(uuid.uuid5(_NAMESPACE, f"{p.robot_id}/{command['commandId']}"))
            try:
                row = self.journal.begin(command, digest, goal, now)
            except ExecutorError as e:
                return self._refuse(e.code)
            return self._acceptance(self._send(row, command, limit))

    def _crash(self):
        self.journal.close()
        raise SimulatedCrash(self._fault)

    def _send(self, row, command, limit):
        if self._fault == "before_native_call":
            self._crash()
        id_ = command["commandId"]
        try:
            self.native.start(row["goal_uuid"], dict(command["target"]), limit)
        except NativeRejected as e:
            self.journal.receipt(id_, "terminal", e.reason, self.clock(), outcome="rejected")
        except Exception:  # timeout / partition / process error: the goal may or may not exist
            self.journal.receipt(id_, "unknown", "NO_ACK", self.clock())
        else:
            if self._fault == "after_native_accept":
                self._crash()
            at = self.clock()
            self.journal.receipt(id_, "accepted", None, at, ack_at_ms=at)
        return self.journal.command(id_)

    # -- reconcile -------------------------------------------------------------------------------------------------------------------
    def reconcile(self):
        """Ask the native side about every open goal by its stable UUID. Never starts anything. Ready only if every question was answered."""
        with self._lock:
            answered, out = True, {}
            for row in self.journal.open(self.profile.robot_id):
                try:
                    result = self.native.query(row["goal_uuid"])
                except Exception:
                    answered = False
                    if row["state"] != "unknown":
                        self.journal.receipt(row["command_id"], "unknown", "NATIVE_UNREACHABLE", self.clock())
                else:
                    self._apply(row, result)
                out[row["command_id"]] = self.state(row["command_id"])
            self.ready = answered and not self.journal.stop_pending(self.profile.robot_id)
            return out

    def _apply(self, row, result):
        id_, now, evidence = row["command_id"], self.clock(), {"status": result.status, **result.evidence}
        if result.status in _TERMINAL:
            self.journal.receipt(id_, "terminal", None, now, outcome=_TERMINAL[result.status], evidence=evidence)
        elif result.status in _ACTIVE:
            self.journal.receipt(id_, _ACTIVE[result.status], row["reason"] if row["cancel_pending"] else None, now, evidence=evidence)
        else:  # not_found / unknown: cannot tell "never arrived" from "arrived and forgotten", so it is NOT resent
            self.journal.receipt(id_, "unknown", "NATIVE_NOT_FOUND" if result.status == "not_found" else "NATIVE_UNKNOWN", now, evidence=evidence)

    # -- stop / cancel ---------------------------------------------------------------------------------------------------------------
    def request_stop(self, reason):
        """Robot-wide STOP request. Journaled first, retried by tick() until acknowledged; an ACK is never proof the robot stopped."""
        if not isinstance(reason, str) or not reason.strip():
            raise ExecutorError("STOP_REASON_REQUIRED")
        with self._lock:
            self.journal.stop_requested(self.profile.robot_id, self.clock())
            self.ready = False
            return {"acknowledged": self._send_stop(), "physicalStopConfirmed": False}

    def _send_stop(self):
        try:
            ok = bool(self.native.request_stop())
        except Exception:
            ok = False
        if ok:
            self.journal.stop_acknowledged(self.profile.robot_id)
        return ok

    def cancel(self, command_id):
        """Cancel one goal. Acknowledged = the native side took the request; the goal is terminal only when a query says so."""
        with self._lock:
            row = self.journal.command(command_id)
            if row is None or row["state"] == "terminal":
                return {"acknowledged": False, "unknown": row is None}
            self.journal.cancel_requested(command_id, self.clock())
            return {"acknowledged": self._send_cancel(row), "unknown": False}

    def _send_cancel(self, row):
        try:
            ok = bool(self.native.cancel(row["goal_uuid"]))
        except Exception:
            ok = False
        if ok:
            self.journal.cancel_acknowledged(row["command_id"])
        return ok

    def tick(self):
        """Service loop body: resend unacknowledged STOP/cancel, then reconcile. Safe to call repeatedly."""
        with self._lock:
            if self.journal.stop_pending(self.profile.robot_id):
                self._send_stop()
            for row in self.journal.open(self.profile.robot_id):
                if row["cancel_pending"]:
                    self._send_cancel(row)
            return self.reconcile()
