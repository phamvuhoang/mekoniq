"""`python3 -m collision` : one ARM03 swept-path check, JSON on stdin -> report JSON on stdout (plan 03 A05 reaches the plan 02 checker here).
Input: {assetRevision, worldRevision, jointTrace:[{tick,q}], attachments:[{cupId,fromTick,toTick}], world:[obstacles], model, geometry?, toleranceM?, allowedContacts?}.
Exit 2: the checker cannot run (model/trace missing -> not_run); exit 1: invalid input (never a pass)."""
import json
import sys

from .arm_swept_path import CheckerUnavailable, check_swept_path


def main():
    try:
        i = json.load(sys.stdin)
        report = check_swept_path(i["assetRevision"], i["worldRevision"], i["jointTrace"], i.get("attachments", []), world=i["world"], model=i["model"],
                                  geometry=i.get("geometry"), tolerance_m=i.get("toleranceM", 0.0005), allowed_contacts=i.get("allowedContacts", []))
    except CheckerUnavailable as e:
        print(f"CHECKER_UNAVAILABLE: {e}", file=sys.stderr)
        return 2
    except (KeyError, ValueError, TypeError) as e:
        print(f"INPUT_INVALID: {e}", file=sys.stderr)
        return 1
    json.dump(report, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
