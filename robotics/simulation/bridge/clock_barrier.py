"""Worker-side clock evidence: a barrier ledger (ACK per participant with sim time, participant clock and monotonic receipt) and a least-squares
mapping between the simulator /clock and the wall clock. Records are canonical-hashed so a report can reference them as evidence."""
import hashlib

import rfc8785

from .protocol import ID


class BarrierLedger:
    def __init__(self, timeout_ns, monotonic_ns):
        self.timeout_ns, self.monotonic_ns, self._barriers = int(timeout_ns), monotonic_ns, {}

    def open(self, barrier_id, participants):
        if not isinstance(barrier_id, str) or not ID.match(barrier_id):
            raise ValueError("BARRIER_ID_INVALID")
        if not participants or any(not isinstance(p, str) or not ID.match(p) for p in participants):
            raise ValueError("BARRIER_PARTICIPANTS_INVALID")
        now = self.monotonic_ns()
        self._barriers[barrier_id] = {"barrierId": barrier_id, "participants": list(participants), "acks": [], "status": "pending",
                                      "openedMonotonicNs": now, "deadlineNs": now + self.timeout_ns, "closedMonotonicNs": None}

    def _get(self, barrier_id):
        b = self._barriers.get(barrier_id)
        if b is None:
            raise ValueError("BARRIER_UNKNOWN")
        return b

    def missing(self, barrier_id):
        b = self._get(barrier_id)
        acked = {a["participant"] for a in b["acks"]}
        return [p for p in b["participants"] if p not in acked]

    def ack(self, barrier_id, participant, sim_time_ns, clock_ns):
        b = self._get(barrier_id)
        if participant not in b["participants"]:
            raise ValueError("BARRIER_PARTICIPANT_UNKNOWN")
        if b["status"] != "pending" or any(a["participant"] == participant for a in b["acks"]):
            return  # late or repeated ACK: changes nothing
        b["acks"].append({"participant": participant, "simTimeNs": None if sim_time_ns is None else int(sim_time_ns), "clockNs": int(clock_ns), "receivedMonotonicNs": self.monotonic_ns()})
        if not self.missing(barrier_id):
            b["status"], b["closedMonotonicNs"] = "complete", self.monotonic_ns()

    def check_timeouts(self):
        now, out = self.monotonic_ns(), []
        for b in self._barriers.values():
            if b["status"] == "pending" and now >= b["deadlineNs"]:
                b["status"], b["closedMonotonicNs"] = "timeout", now
                out.append(b["barrierId"])
        return out

    def status(self, barrier_id):
        b = self._get(barrier_id)
        clocks = [a["clockNs"] for a in b["acks"]]
        return {"status": b["status"], "missing": self.missing(barrier_id), "skewNs": (max(clocks) - min(clocks)) if b["status"] == "complete" else None}

    def record(self, barrier_id):
        """Wire/evidence form: every nanosecond value is a digit string (RFC 8785 JSON cannot carry integers beyond 2^53), hashed canonically."""
        b, st = self._get(barrier_id), self.status(barrier_id)
        ns = lambda v: None if v is None else str(int(v))
        body = {"barrierId": b["barrierId"], "participants": list(b["participants"]), "status": st["status"], "missing": st["missing"], "skewNs": ns(st["skewNs"]),
                "openedMonotonicNs": ns(b["openedMonotonicNs"]), "closedMonotonicNs": ns(b["closedMonotonicNs"]),
                "acks": [{"participant": a["participant"], "simTimeNs": ns(a["simTimeNs"]), "clockNs": ns(a["clockNs"]), "receivedMonotonicNs": ns(a["receivedMonotonicNs"])} for a in b["acks"]]}
        return {**body, "sha256": hashlib.sha256(rfc8785.dumps(body)).hexdigest()}


def clock_mapping(samples):
    """Fit wall_ns ~= offset + sim_ns * (1 + drift) over (sim_ns, wall_ns) pairs; integers in, drift in ppm. Fewer than two samples: no mapping."""
    pairs = [(int(s), int(w)) for s, w in samples]
    if len(pairs) < 2:
        return {"samples": len(pairs), "offsetNs": None, "driftPpm": None, "residualMaxNs": None, "reason": "INSUFFICIENT_SAMPLES"}
    n = len(pairs)
    mean_s, mean_w = sum(s for s, _ in pairs) // n, sum(w for _, w in pairs) // n
    sxx = sum((s - mean_s) ** 2 for s, _ in pairs)
    if sxx == 0:
        return {"samples": n, "offsetNs": None, "driftPpm": None, "residualMaxNs": None, "reason": "SIM_TIME_CONSTANT"}
    slope = sum((s - mean_s) * (w - mean_w) for s, w in pairs) / sxx
    offset = mean_w - round(slope * mean_s)
    residual = max(abs(w - (offset + round(slope * s))) for s, w in pairs)
    return {"samples": n, "offsetNs": offset, "driftPpm": (slope - 1.0) * 1e6, "residualMaxNs": residual}
