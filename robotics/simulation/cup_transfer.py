"""Cup attachment ledger of the simulated cell: one parent at a time, moved only on full evidence (grasp: gripper closed + object present + lift
pose; tray: giver release + receiver presence + dock in tolerance). A release ACK alone changes nothing. Mirrors the source domain's cup
custody rules on the plant side so the worker never reports a transfer it cannot evidence."""


class TransferError(ValueError):
    def __init__(self, code, detail=None):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


GRASP = ("gripperClosed", "objectPresent", "liftPoseReached")
RECEIVER = ("receiverPresent", "dockInTolerance")


def _all_true(evidence, keys):
    return isinstance(evidence, dict) and all(evidence.get(k) is True for k in keys)


class AttachmentLedger:
    def __init__(self, cup_id, initial_parent):
        self.cup_id, self._parent, self.movements = cup_id, dict(initial_parent), []

    def parent(self):
        return dict(self._parent)

    def owner(self):
        p = self._parent
        return f"{p['kind']}:{p['id']}" + (f"/tray:{p['slot']}" if p["kind"] == "robot" else "")

    def _absorbed(self, transfer_id):
        return any(m["transferId"] == transfer_id for m in self.movements)

    def attach_to_arm(self, transfer_id, arm_id, evidence):
        if self._absorbed(transfer_id):
            return
        if self._parent["kind"] != "cell":
            raise TransferError("CUP_OWNER_MISMATCH", self.owner())
        if not _all_true(evidence, GRASP):
            raise TransferError("TRANSFER_EVIDENCE_INCOMPLETE", "grasp needs gripperClosed, objectPresent, liftPoseReached")
        before = self.parent()
        self._parent = {"kind": "arm", "id": arm_id, "frame": "tcp"}
        self.movements.append({"transferId": transfer_id, "from": before, "to": self.parent(), "evidence": dict(evidence)})

    def release_to_tray(self, transfer_id, robot_id, slot, giver, receiver):
        if self._absorbed(transfer_id):
            return
        if self._parent["kind"] != "arm":
            raise TransferError("CUP_OWNER_MISMATCH", self.owner())
        if not _all_true(giver, ("released",)) or not _all_true(receiver, RECEIVER):
            raise TransferError("TRANSFER_EVIDENCE_INCOMPLETE", "tray needs the giver's release and the receiver's presence + dock")
        before = self.parent()
        self._parent = {"kind": "robot", "id": robot_id, "frame": "tray", "slot": slot}
        self.movements.append({"transferId": transfer_id, "from": before, "to": self.parent(), "evidence": {"giver": dict(giver), "receiver": dict(receiver)}})
