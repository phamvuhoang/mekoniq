"""Durable executor journal (own SQLite file, synchronous=FULL). A `sending` row with its stable goal UUID is committed in ONE transaction
BEFORE any native call; the receipt and every later fact are committed after. A row still `sending` on open means the process died in
between: it becomes `unknown` and is reconciled by querying the native side with the same UUID, never resent."""
import json
import sqlite3

OPEN = ("sending", "accepted", "executing", "unknown")


class ExecutorError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


class Journal:
    def __init__(self, path):
        self.db = sqlite3.connect(str(path), isolation_level=None)  # explicit BEGIN IMMEDIATE below
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
CREATE TABLE IF NOT EXISTS executor_binding(robot_id TEXT PRIMARY KEY, executor_id TEXT NOT NULL, control_epoch INTEGER NOT NULL, stop_pending INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS executor_command(
  command_id TEXT PRIMARY KEY, robot_id TEXT NOT NULL, command_hash TEXT NOT NULL, control_epoch INTEGER NOT NULL,
  goal_uuid TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN('accepted','sending','executing','unknown','terminal')),
  outcome TEXT CHECK(outcome IS NULL OR outcome IN('succeeded','canceled','aborted','rejected')),
  reason TEXT, ack_at_ms INTEGER, stop_at_ms INTEGER, cancel_pending INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT, command_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS executor_command_robot ON executor_command(robot_id, state);""")

    def close(self):
        self.db.close()

    def _tx(self, block):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            result = block(self.db)
            self.db.execute("COMMIT")
            return result
        except BaseException:
            self.db.execute("ROLLBACK")
            raise

    def bind(self, robot_id, executor_id, provisioned_epoch):
        """One executor per robot (a second id is refused, never replaced). The epoch only ever rises."""
        def run(db):
            row = db.execute("SELECT executor_id FROM executor_binding WHERE robot_id=?", (robot_id,)).fetchone()
            if row is None:
                db.execute("INSERT INTO executor_binding(robot_id,executor_id,control_epoch) VALUES(?,?,?)", (robot_id, executor_id, provisioned_epoch))
            elif row["executor_id"] != executor_id:
                raise ExecutorError("EXECUTOR_ALREADY_BOUND")
            else:
                db.execute("UPDATE executor_binding SET control_epoch=MAX(control_epoch,?) WHERE robot_id=?", (provisioned_epoch, robot_id))
        self._tx(run)

    def control_epoch(self, robot_id):
        row = self.db.execute("SELECT control_epoch FROM executor_binding WHERE robot_id=?", (robot_id,)).fetchone()
        if row is None:
            raise ExecutorError("EXECUTOR_NOT_BOUND")
        return row["control_epoch"]

    def stop_pending(self, robot_id):
        return bool(self.db.execute("SELECT stop_pending FROM executor_binding WHERE robot_id=?", (robot_id,)).fetchone()["stop_pending"])

    def recover_unfinished(self, now_ms):
        """Crash recovery on open: `sending` rows have no recorded outcome."""
        return self._tx(lambda db: db.execute("UPDATE executor_command SET state='unknown',reason='CRASH_BEFORE_RECEIPT',updated_at_ms=? WHERE state='sending'", (now_ms,)).rowcount)

    def command(self, command_id):
        row = self.db.execute("SELECT * FROM executor_command WHERE command_id=?", (command_id,)).fetchone()
        return dict(row) if row else None

    def open(self, robot_id):
        marks = ",".join("?" * len(OPEN))
        return [dict(r) for r in self.db.execute(f"SELECT * FROM executor_command WHERE robot_id=? AND state IN({marks}) ORDER BY rowid", (robot_id, *OPEN))]

    def begin(self, command, command_hash, goal_uuid, now_ms):
        """Journal-before-I/O, atomic: epoch fence + no unresolved/open goal + advance epoch + `sending` row with the goal UUID."""
        def run(db):
            robot, epoch = command["robotId"], command["controlEpoch"]
            current = db.execute("SELECT control_epoch FROM executor_binding WHERE robot_id=?", (robot,)).fetchone()["control_epoch"]
            if epoch < current:
                raise ExecutorError("STALE_CONTROL_EPOCH")
            if epoch > current + 1:
                raise ExecutorError("CONTROL_EPOCH_OUT_OF_RANGE")
            if db.execute("SELECT 1 FROM executor_command WHERE robot_id=? AND state IN('sending','unknown')", (robot,)).fetchone():
                raise ExecutorError("GOAL_UNRECONCILED")
            if db.execute("SELECT 1 FROM executor_command WHERE robot_id=? AND state IN('accepted','executing')", (robot,)).fetchone():
                raise ExecutorError("PREVIOUS_GOAL_ACTIVE")
            db.execute("UPDATE executor_binding SET control_epoch=? WHERE robot_id=?", (epoch, robot))
            db.execute("INSERT INTO executor_command(command_id,robot_id,command_hash,control_epoch,goal_uuid,state,command_json,updated_at_ms) VALUES(?,?,?,?,?,'sending',?,?)",
                       (command["commandId"], robot, command_hash, epoch, goal_uuid, json.dumps(command, sort_keys=True), now_ms))
        self._tx(run)
        return self.command(command["commandId"])

    def receipt(self, command_id, state, reason, now_ms, *, ack_at_ms=None, outcome=None, evidence=None):
        self._tx(lambda db: db.execute(
            "UPDATE executor_command SET state=?,reason=?,outcome=COALESCE(?,outcome),ack_at_ms=COALESCE(?,ack_at_ms),evidence_json=COALESCE(?,evidence_json),updated_at_ms=? WHERE command_id=? AND state<>'terminal'",
            (state, reason, outcome, ack_at_ms, json.dumps(evidence, sort_keys=True) if evidence is not None else None, now_ms, command_id)))

    def stop_requested(self, robot_id, now_ms):
        """Robot-wide STOP intent is journaled before the STOP goes out; open goals become `unknown` (ownership uncertain until the native side says)."""
        def run(db):
            db.execute("UPDATE executor_binding SET stop_pending=1 WHERE robot_id=?", (robot_id,))
            db.execute("UPDATE executor_command SET state='unknown',reason='STOP_REQUESTED',stop_at_ms=?,updated_at_ms=? WHERE robot_id=? AND state IN('sending','accepted','executing','unknown')", (now_ms, now_ms, robot_id))
        self._tx(run)

    def stop_acknowledged(self, robot_id):
        self._tx(lambda db: db.execute("UPDATE executor_binding SET stop_pending=0 WHERE robot_id=?", (robot_id,)))

    def cancel_requested(self, command_id, now_ms):
        self._tx(lambda db: db.execute("UPDATE executor_command SET cancel_pending=1,reason='CANCEL_REQUESTED',stop_at_ms=?,updated_at_ms=? WHERE command_id=? AND state IN('sending','accepted','executing','unknown')", (now_ms, now_ms, command_id)))

    def cancel_acknowledged(self, command_id):
        self._tx(lambda db: db.execute("UPDATE executor_command SET cancel_pending=0 WHERE command_id=?", (command_id,)))
