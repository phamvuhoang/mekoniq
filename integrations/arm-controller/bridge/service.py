"""Bridge service: two fixed local Unix sockets (profile.channel.socketPath for Lab-class clients, localSocketPath for the operator HMI;
mode 0600 for private use or 0660 with separate provisioned groups per channel), one thread per client (bounded), newline-delimited JSON frames bounded by
maxFrameBytes, a token bucket per client, schema validation before the arbiter, the owner kind a message may claim decided by its channel
(`local`/`revoke` only on the local one), replies correlated by requestId, status/event fan-out with per-client send timeouts (a stalled
client loses coalescable status frames with a SEQ_GAP marker, or is closed on an event it could not take), and the ONE consumer of the
LinuxCNC error channel (fanned out as arm.event.v1 error_channel)."""
import os
import hashlib
import json
import platform
from pathlib import Path
import math
import grp
import select
import socket
import struct
import threading
import time

from . import protocol
from .linuxcnc_port import LinuxcncPort

MAX_CLIENTS = 4
SEND_TIMEOUT_S = 0.5
CHANNEL_KINDS = {"lab": ("lab_simulation", "authorized_cell_job"), "local": ("local_operator",)}
LOCAL_ONLY_SHAPES = ("local", "revoke")


class _Bucket:
    def __init__(self, burst, per_second, clock):
        self.tokens, self.burst, self.rate, self.clock, self.last = float(burst), float(burst), float(per_second), clock, clock()

    def take(self):
        now = self.clock()
        self.tokens = min(self.burst, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


class BridgeService:
    error_consumers = 1  # the service drains linuxcnc.error_channel(); the HMI and the Lab read error_channel events instead of opening their own

    def __init__(self, profile, arbiter, controller, socket_path=None, local_socket_path=None, now_ms=None, status_hz=None, validators=None, monotonic=time.monotonic, socket_groups=None):
        self.profile, self.arb, self.ctl = profile, arbiter, controller
        self.socket_groups = socket_groups
        self.path = socket_path or profile["channel"]["socketPath"]
        self.local_path = local_socket_path or (profile["channel"].get("localSocketPath") if socket_path is None else self.path.rsplit(".sock", 1)[0] + "-local.sock")
        self.now_ms, self.monotonic = now_ms or (lambda: int(time.time() * 1000)), monotonic
        self.hz = profile["telemetry"]["rateHz"] if status_hz is None else status_hz
        self.validators = validators or protocol.load_validators()
        self.clients, self.lock, self.seq, self._stop = [], threading.Lock(), 0, threading.Event()
        self.channel, self.locks, self.dropped = {}, {}, {}
        self.threads, self.socks = [], []
        self.grip_proofs = {}
        records = [{"path": "integrations/arm-controller/bridge/" + p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "bytes": p.stat().st_size} for p in sorted(Path(__file__).parent.glob("*.py"))]
        self.inventory = {"controllerVersion": controller.version(), "pythonVersion": platform.python_version(), "platform": platform.system().lower(), "architecture": platform.machine(), "bridgeCodeSha256": hashlib.sha256(json.dumps(records, separators=(",", ":")).encode()).hexdigest(), "profileSha256": protocol.profile_hash(profile)}
        self.stamp_lock = threading.Lock()
        arbiter.on_event = self._on_arbiter_event          # lifecycle/outcome events of the arbiter go out as arm.event.v1

    # ---- lifecycle ---------------------------------------------------------------------------------------------------------------------------
    def start(self):
        gids = None
        if self.socket_groups is not None:
            gids = {channel: grp.getgrnam(self.socket_groups[channel]).gr_gid for channel in CHANNEL_KINDS}
            if len(set(gids.values())) != 2:
                raise ValueError("CHANNEL_GROUPS_MUST_DIFFER")
        for channel, path in (("lab", self.path), ("local", self.local_path)):
            if os.path.exists(path):
                os.unlink(path)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                s.bind(path)
                os.chmod(path, 0o600)
                if gids is not None:
                    os.chown(path, -1, gids[channel])
                    os.chmod(path, 0o660)
                s.listen(MAX_CLIENTS)
                s.settimeout(0.2)
            except Exception:
                s.close()
                if os.path.exists(path): os.unlink(path)
                self.stop()
                raise
            self.socks.append((channel, s, path))
            self.threads.append(threading.Thread(target=self._accept, args=(channel, s), daemon=True))
        if self.hz:
            self.threads.append(threading.Thread(target=self._loop, daemon=True))
        for t in self.threads:
            t.start()

    def stop(self):
        self._stop.set()
        for t in self.threads:
            if t.is_alive():
                t.join(timeout=2)
        with self.lock:
            clients = list(self.clients)
        for c in clients:
            self._drop(c)
        for _, s, path in self.socks:
            s.close()
            if os.path.exists(path):
                os.unlink(path)

    def _accept(self, channel, sock):
        while not self._stop.is_set():
            try:
                conn, _ = sock.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            with self.lock:
                if len(self.clients) >= MAX_CLIENTS:
                    conn.sendall(protocol.frame(self._reject(None, ["CLIENT_LIMIT"]))); conn.close(); continue
                self.clients.append(conn); self.channel[id(conn)] = channel
            threading.Thread(target=self._serve, args=(conn, channel), daemon=True).start()

    # ---- one client --------------------------------------------------------------------------------------------------------------------------
    def _reject(self, cid, codes):
        return {"schemaVersion": 1, "kind": protocol.KIND_REPLY, "commandId": cid, "status": "rejected", "lifecycle": "none", "duplicate": False, "reasonCodes": codes}

    def _send(self, conn, obj, droppable=False):
        """Per-client lock and send timeout: a stalled client never blocks the loop. Status frames are coalescable (dropped and counted,
        the next one carries SEQ_GAP:n); a reply or an event it cannot take closes the client, which must reconnect and reconcile."""
        lock = self.locks.setdefault(id(conn), threading.Lock())
        try:
            with lock:
                data = memoryview(protocol.frame(obj))
                deadline = time.monotonic() + SEND_TIMEOUT_S
                sent = 0
                while sent < len(data):
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not select.select([], [conn], [], remaining)[1]:
                        # A partial JSON frame cannot be dropped and followed by a new frame.
                        if sent:
                            self._drop(conn)
                        raise socket.timeout("SEND_DEADLINE")
                    # SO_SNDTIMEO affects kernel writes only, never the makefile command reader.
                    # It also bounds a partial write on Unix variants that ignore MSG_DONTWAIT.
                    remaining = max(0.000001, deadline - time.monotonic())
                    seconds = int(remaining)
                    conn.setsockopt(socket.SOL_SOCKET, socket.SO_SNDTIMEO, struct.pack("ll", seconds, max(1, int((remaining - seconds) * 1000000))))
                    try:
                        n = conn.send(data[sent:], socket.MSG_DONTWAIT)
                    except BlockingIOError:
                        continue
                    if not n:
                        raise ConnectionError("SOCKET_CLOSED")
                    sent += n
            return True
        except (OSError, socket.timeout):
            if droppable:
                self.dropped[id(conn)] = self.dropped.get(id(conn), 0) + 1
            else:
                self._drop(conn)
            return False

    def _drop(self, conn):
        with self.lock:
            if conn in self.clients:
                self.clients.remove(conn)
        self.channel.pop(id(conn), None); self.locks.pop(id(conn), None); self.dropped.pop(id(conn), None)
        try:
            conn.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        conn.close()

    def _serve(self, conn, channel="lab"):
        ch = self.profile["channel"]
        bucket = _Bucket(ch["queueDepth"], ch["maxCommandsPerSecond"], self.monotonic)
        reader = conn.makefile("rb")
        try:
            for msg in protocol.read_frames(reader, ch["maxFrameBytes"]):
                rid = msg.get("requestId") if isinstance(msg, dict) else None
                if not bucket.take():
                    self._send(conn, {**self._reject((msg.get("command") or {}).get("commandId") if isinstance(msg, dict) else None, ["RATE_LIMITED"]), "requestId": rid}); continue
                self._send(conn, {**self.handle(msg, channel), "requestId": rid})
        except protocol.ProtocolError as e:
            self._send(conn, self._reject(None, [e.code]))
        except OSError:
            pass
        finally:
            reader.close()
            self._drop(conn)

    def handle(self, msg, channel="lab"):
        """One validated envelope -> arbiter answer. The channel decides which owner kinds and shapes the message may carry. Never raises on caller input."""
        if not isinstance(msg, dict) or msg.get("kind") != protocol.KIND_COMMAND:
            return self._reject(None, ["KIND_INVALID"])
        codes = protocol.validate(msg, self.validators)
        cid = (msg.get("command") or {}).get("commandId") if isinstance(msg.get("command"), dict) else None
        if codes:
            return self._reject(cid, codes)
        actor = msg["owner"]["actor"]
        if actor not in CHANNEL_KINDS.get(channel, ()):
            return self._reject(cid, [f"OWNER_KIND_NOT_ALLOWED_ON_CHANNEL:{actor}"])
        for shape in LOCAL_ONLY_SHAPES:
            if shape in msg and channel != "local":
                return self._reject(cid, [f"CHANNEL_FORBIDDEN:{shape}"])
        if "command" in msg:
            return self.arb.submit(msg)
        codes = protocol.check_expectations(msg, self.profile)
        if codes:
            return self._reject(None, codes)
        token = msg["owner"]["token"]
        if "acquire" in msg:
            a = msg["acquire"]
            r = self.arb.acquire(actor, a["actor"], msg["controllerEpoch"], a["leaseMs"], simulation_scene=a.get("simulationScene"))
            r.pop("ok", None)
            if self.arb.sim_gripper and actor == "lab_simulation":
                r["capabilities"] = ["simulation_scene.v1", "correlated_barrier.v1"]
            return r
        if "barrier" in msg:
            # Read a new actual controller snapshot after receipt; cached broadcast frames cannot ACK.
            b = msg["barrier"]
            denied = self.arb._owner_check(msg)
            if denied:
                return self._reject(None, denied)
            st = self.status_message()
            stationary = st["task"]["interp"] in ("idle", "paused")
            valid = (st["bootId"] == b["bootId"] and st["controllerEpoch"] == msg["controllerEpoch"]
                     and int(st["seq"]) > int(b["afterSeq"]) and stationary
                     and (b["state"] != "paused" or st["task"]["interp"] == "paused")
                     and st["joints"]["actualRad"] is not None and st["task"]["fault"] is None and st["task"]["homed"]
                     and st["joints"]["velocityRadS"] is not None and all(math.isfinite(v) and abs(v) <= .02 for v in st["joints"]["velocityRadS"]))
            if not valid:
                return self._reject(None, ["BARRIER_STATE_UNPROVEN"])
            return {"schemaVersion": 1, "kind": protocol.KIND_REPLY, "commandId": None,
                    "status": "accepted", "lifecycle": "immediate", "duplicate": False, "reasonCodes": [],
                    "outcome": {"status": "completed", "evidence": {"barrierId": b["barrierId"],
                    "nonce": b["nonce"], "bootId": st["bootId"], "controllerEpoch": st["controllerEpoch"],
                    "seq": st["seq"], "state": b["state"], "clockNs": st["monotonicNs"], "simTimeNs": None}}}
        if "simScene" in msg:
            return self.arb.update_sim_scene(msg)
        if "release" in msg:
            return self.arb.release(msg["release"]["leaseId"], token=token)
        if "renew" in msg:
            return self.arb.renew(msg["renew"]["leaseId"], self.profile["lease"]["ttlMs"], token=token)
        if "local" in msg:
            return self.arb.local_motion(msg)
        if "revoke" in msg:
            return self.arb.revoke(msg["revoke"]["actor"], msg["revoke"]["reason"])
        return self.arb.reconcile(msg["reconcile"]["commandId"], token=token or None)

    # ---- status / events ---------------------------------------------------------------------------------------------------------------------
    def _stamp(self):
        with self.stamp_lock:
            self.seq += 1
            seq = self.seq
        return {"schemaVersion": 1, "machineId": self.profile["machineId"], "controllerEpoch": self.arb.controller_epoch, "bootId": str(self.ctl.state()["bootId"]), "seq": str(seq),
                "observedAt": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(self.now_ms() / 1000)) + f".{self.now_ms() % 1000:03d}Z", "monotonicNs": str(int(self.monotonic() * 1e9))}

    def broadcast(self, obj, droppable=None):
        """Status frames are coalescable (dropped for a stalled client, SEQ_GAP:n on its next frame); everything else must arrive or the client is closed."""
        droppable = obj.get("kind") == protocol.KIND_STATUS if droppable is None else droppable
        with self.lock:
            clients = list(self.clients)
        for c in clients:
            frame = obj
            gap = self.dropped.get(id(c), 0)
            if droppable and gap:
                frame = {**obj, "reasonCodes": [*obj.get("reasonCodes", []), f"SEQ_GAP:{gap}"]}
            if self._send(c, frame, droppable) and droppable and gap:
                self.dropped[id(c)] = 0                                        # the gap was told; a failed attempt keeps counting

    def event(self, event, command_id=None, codes=(), detail=None, observation=None, evidence=None):
        self.broadcast({**self._stamp(), "kind": protocol.KIND_EVENT, "event": event, "commandId": command_id, "observation": observation, "reasonCodes": list(codes), "detail": detail, "evidence": evidence}, droppable=False)

    def _on_arbiter_event(self, e):
        self.event(e["event"], e.get("commandId"), e.get("reasonCodes", []), e.get("detail"))

    def status_message(self):
        st = self.arb.observe()["state"]
        si = LinuxcncPort.to_si(st)
        p = self.profile
        st_arb = self.arb.status()
        return {**self._stamp(), "kind": protocol.KIND_STATUS, "inventory": self.inventory, "owner": st_arb["owner"], "reconcileRequired": st_arb["reconcileRequired"], "unknownCommands": st_arb["unknownCommands"][:50],
                "task": {"state": st["taskState"], "mode": st.get("mode", "unknown"), "interp": st["interp"], "homed": bool(st["homed"]), "fault": st.get("fault")},
                "joints": {"names": ["J1", "J2", "J3", "J4", "J5", "J6"], "commandedRad": si["commandedRad"], "actualRad": si["actualRad"], "velocityRadS": si["velocityRadS"], "followingErrorRad": si["followingErrorRad"], "source": "controller_sim" if p["mode"] == "simulation" else "unknown"},
                "tcp": None if si["tcpM"] is None else {"frameId": "arm_base", "positionM": si["tcpM"], "quaternionXyzw": [0, 0, 0, 1]},
                "program": {"id": st.get("program"), "hash": p["programs"].get(st.get("program"), {}).get("sha256") if st.get("program") else None, "state": "running" if st["interp"] == "running" else "paused" if st["interp"] == "paused" else "staged" if st.get("program") else "none"},
                "units": {"source": {"length": p["units"]["length"], "angle": p["units"]["angle"]}, "wire": "SI"}, "freshness": {"staleMs": p["telemetry"]["staleMs"], "quality": "valid"},
                **({"capabilities": ["simulation_scene.v1", "correlated_barrier.v1"], "virtualGrip": self.arb.sim_gripper.telemetry()} if self.arb.sim_gripper else {}),
                "reasonCodes": ["TCP_ORIENTATION_NOT_PINNED"] if si["tcpM"] is not None else ["POSE_MISSING"]}

    def poll_once(self):
        """One service tick: arbiter observations (restart/lease/fault already went out as events), the error channel, completions, a status frame."""
        errors = self.ctl.poll_errors()  # classify errors before an idle poll can finalize a job
        self.arb.observe()
        for err in errors:
            self.event("error_channel", None, [err["kind"].upper()], err["text"])
        self._sample_grip()
        for c in self.arb.poll_completions():                      # completion is an observation from the controller, never the accepted reply
            st = self._stamp()
            s = c["sending"]
            observation = {"schemaVersion": 2, "commandId": c["commandId"], "deviceId": s.get("deviceId") or self.profile["machineId"], "controlEpoch": s.get("controlEpoch") or 1, "payloadHash": s["payloadHash"],
                           "bootId": st["bootId"], "seq": st["seq"], "result": c["result"], "observedAt": st["observedAt"], "reasonCodes": [] if c["result"] == "completed" else ["CONTROLLER_REPORTED_FAILURE"]}
            self.broadcast({**st, "kind": protocol.KIND_EVENT, "event": "command_completed" if c["result"] == "completed" else "command_failed", "commandId": c["commandId"], "observation": observation,
                            "reasonCodes": observation["reasonCodes"], "detail": None, "evidence": {"source": self.profile["backend"], "gripperClosed": None, "objectPresent": None, "released": None, "note": "controller completion carries no grip authority; virtual_grip observations are separate", **{k: v for k, v in c["evidence"].items() if k in ("interp", "program")}}}, droppable=False)
        if self.hz:
            self.broadcast(self.status_message())

    def _sample_grip(self):
        grip = self.arb.sim_gripper
        if not grip:
            return
        state = self.ctl.state()
        cid = grip.scene.get("commandId") if grip.scene else None
        command = self.arb.sim_commands.get(cid)
        # Lease/restart/tunnel loss cannot create new observations, even if output remains high.
        if not command or self.arb._owner_check({"owner": {"token": self.arb.owner["token"] if self.arb.owner else None, "actor": "lab_simulation"}, "leaseId": self.arb.owner["leaseId"] if self.arb.owner else None}):
            if hasattr(self.ctl, "publish_virtual_grip"):
                self.ctl.publish_virtual_grip({"state": "unknown", "reasonCodes": ["SIM_OWNER_OR_COMMAND_MISSING"]})
            return
        si = LinuxcncPort.to_si(state)
        proof = grip.sample(close_output=state.get("gripperCloseOutput"), tcp_m=si["tcpM"], actual_joints_rad=si["actualRad"], command=command,
                            controller_epoch=self.arb.controller_epoch, boot_id=str(state["bootId"]))
        if hasattr(self.ctl, "publish_virtual_grip"):
            self.ctl.publish_virtual_grip(grip.telemetry())
        self.arb.journal.append({"kind": "sim_grip_sample", "commandId": cid, "controllerEpoch": self.arb.controller_epoch, "output0": state.get("gripperCloseOutput"), "actualRad": si["actualRad"], "tcpM": si["tcpM"], "virtualGrip": grip.telemetry(), "monotonicNs": str(int(self.monotonic()*1e9)), "atMs": self.now_ms()})
        if proof:
            stamp = self._stamp()
            proof["seq"] = stamp["seq"]
            proof["observationId"] = f"grip:{stamp['bootId']}:{stamp['seq']}"
            observation = {"schemaVersion": 2, "commandId": cid, "deviceId": command["deviceId"], "controlEpoch": command["controlEpoch"], "payloadHash": command["payloadHash"], "bootId": stamp["bootId"], "seq": stamp["seq"], "result": "accepted", "observedAt": stamp["observedAt"], "reasonCodes": []}
            self.arb.journal.append({"kind": "sim_grip_observation", "observation": proof, "atMs": self.now_ms()})
            self.broadcast({**stamp, "kind": protocol.KIND_EVENT, "event": "virtual_grip", "commandId": cid, "observation": observation, "reasonCodes": [], "detail": None, "evidence": {"transferObservation": proof}}, droppable=False)

    def _loop(self):
        period = 1.0 / self.hz
        while not self._stop.is_set():
            try:
                self.poll_once()
            except Exception:  # noqa: BLE001 - a poll error must not kill the service
                pass
            self._stop.wait(period)
