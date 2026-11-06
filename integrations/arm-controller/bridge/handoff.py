"""Coffee pickup/handoff admission on the controller side (plan 03 A05), the same rules and order as the Lab's admitPickup; both are checked
against tests/fixtures/coffee-handoff.json. A brew ACK is not completion; a lost grip, lost feedback or a cancel while holding leaves custody
unresolved (never released, never served). Numeric physical limits are not here: they stay unknown until a vendor/measured profile exists."""


def admit_pickup(i):
    codes = []
    if not i["brew"]["complete"]:
        codes.append("BREW_NOT_COMPLETE")
    if i["ice"]["required"]:
        if i["ice"].get("fault"):
            codes.append("ICE_JAM")
        elif not i["ice"]["complete"]:
            codes.append("ICE_NOT_COMPLETE")
    if i["milk"]["required"]:
        if i["milk"].get("fault"):
            codes.append("MILK_EMPTY")
        elif not i["milk"]["complete"]:
            codes.append("MILK_NOT_COMPLETE")
        if not i["milk"]["batchFresh"]:
            codes.append("MILK_BATCH_STALE")
    if not i["cup"]["present"]:
        codes.append("CUP_ABSENT")
    elif i["cup"]["id"] != i["cup"]["expectedId"]:
        codes.append("CUP_IDENTITY_MISMATCH")
    elif not i["cup"]["verified"]:
        codes.append("CUP_NOT_VERIFIED")
    if not i["cleaning"]["fresh"]:
        codes.append("CLEANING_STALE")
    if not i["interlock"]["ok"]:
        codes.append("INTERLOCK_NOT_READY")
    if codes:
        return {"pickup": "blocked", "reasonCodes": codes, "custody": "cell", "served": False}
    if not i["gripper"]["secure"]:
        return {"pickup": "blocked", "reasonCodes": ["GRIP_NOT_SECURE"], "custody": "unresolved", "served": False}
    if i["feedback"]["lost"]:
        return {"pickup": "blocked", "reasonCodes": ["FEEDBACK_LOST"], "custody": "unresolved", "served": False}
    if i["cancel"]["whileHolding"]:
        return {"pickup": "blocked", "reasonCodes": ["CANCELLED_WHILE_HOLDING"], "custody": "unresolved", "served": False}
    return {"pickup": "allowed", "reasonCodes": [] if i["receiver"]["ready"] else ["RECEIVER_NOT_READY"], "custody": "arm", "served": False}
