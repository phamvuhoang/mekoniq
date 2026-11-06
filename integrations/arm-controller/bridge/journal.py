"""Append-only JSONL journal of the bridge (fsync per record). A command's `sending` row is written BEFORE the controller call and its
`answered` row after; a `sending` row without an answer is an unknown outcome to reconcile, never a command to resend."""
import json
import os
from pathlib import Path


class Journal:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._entries = [json.loads(l) for l in self.path.read_text().splitlines() if l.strip()] if self.path.exists() else []

    def append(self, record):
        record = {"seq": len(self._entries) + 1, **record}
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, separators=(",", ":"), ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())
        self._entries.append(record)
        return record

    def entries(self):
        return list(self._entries)

    def command(self, command_id):
        """{'sending': row, 'answered': row|None, 'payloadHash', 'epoch'} for a journaled command id, else None."""
        rows = [e for e in self._entries if e.get("kind") == "command" and e.get("commandId") == command_id]
        if not rows:
            return None
        sending = next((r for r in rows if r["intent"] == "sending"), rows[0])
        answered = [r for r in rows if r["intent"] == "answered"]
        return {"sending": sending, "answered": answered[-1] if answered else None, "payloadHash": sending.get("payloadHash"), "epoch": sending.get("controllerEpoch"), "effect": sending.get("effect", False)}

    def pending(self):
        """Command ids journaled as sending without an answer (in journal order)."""
        out, done = [], {e["commandId"] for e in self._entries if e.get("kind") == "command" and e.get("intent") == "answered"}
        for e in self._entries:
            if e.get("kind") == "command" and e.get("intent") == "sending" and e["commandId"] not in done and e["commandId"] not in out:
                out.append(e["commandId"])
        return out

    def outcome(self, command_id):
        """The terminal outcome row of a command (completed/failed/unknown), or None while it is open."""
        return next((e for e in reversed(self._entries) if e.get("kind") == "outcome" and e.get("commandId") == command_id), None)

    def last(self, kind):
        return next((e for e in reversed(self._entries) if e.get("kind") == kind), None)
