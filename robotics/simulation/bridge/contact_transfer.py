"""Contact-based transfer assessor (pure). Confirms a grasp or release only from independent physical streams; a completed command is never evidence.

  grasp_confirmed   = matching identity AND fresh samples AND bilateral contact AND lift >= 0.05 m AND stable hold >= 1 s AND relative drift <= 0.005 m
  release_confirmed = jaws released AND receiver contact stable >= 0.5 s AND cup inside the slot
Missing evidence is `unknown`; an observed failure (slip, lost contact, cup outside the slot) is `rejected`. Nothing here moves a cup or touches custody."""

NS_PER_S = 1_000_000_000
DEFAULTS = {"liftM": 0.05, "holdS": 1.0, "driftM": 0.005, "receiverStableS": 0.5, "freshnessNs": 100_000_000, "maxGapNs": 50_000_000, "minContactN": 0.5, "releasedOpeningM": 0.06}
REQUIRED = {"gripper": ("leftContactN", "rightContactN", "openingM"), "cup_pose": ("cupXyzM", "toolXyzM"), "tray": ("contact", "insideSlot")}


def _result(status, reasons, refs):
    return {"status": status, "reasons": sorted(set(reasons)), "evidenceRefs": refs}


def _prepare(samples, policy):
    """Keeps this cup/epoch's well-formed samples in time order; returns (streams, problems)."""
    problems, streams, seen = [], {k: [] for k in REQUIRED}, set()
    for s in samples:
        kind = s.get("kind")
        if kind == "command_complete":
            continue  # recorded for the report, never counted as evidence
        if kind not in REQUIRED or not str(s.get("simTimeNs", "")).isdigit() or any(f not in s for f in REQUIRED[kind]):
            problems.append("SAMPLE_INVALID")
            continue
        if "epoch" not in s or "cupId" not in s:
            problems.append("SAMPLE_INVALID")  # a sample that does not say whose it is belongs to nobody
            continue
        if s["epoch"] != policy["epoch"]:
            problems.append("EPOCH_MISMATCH")
            continue
        if s["cupId"] != policy["cupId"]:
            continue
        key = (kind, s.get("sequence"))
        if s.get("sequence") is not None and key in seen:
            problems.append("DUPLICATE_SAMPLE")
            continue
        seen.add(key)
        streams[kind].append(s)
    for kind, items in streams.items():
        seqs = [s["sequence"] for s in items if s.get("sequence") is not None]
        if seqs != sorted(seqs):
            problems.append("REORDERED_SAMPLES")
        items.sort(key=lambda s: int(s["simTimeNs"]))
    return streams, problems


def _intervals(items, ok, max_gap_ns):
    """Contiguous runs of samples satisfying `ok` with no gap above max_gap_ns, as (start_ns, end_ns, [samples])."""
    runs, current = [], []
    for s in items:
        if current and int(s["simTimeNs"]) - int(current[-1]["simTimeNs"]) > max_gap_ns:
            runs.append(current)
            current = []
        if ok(s):
            current.append(s)
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    return [(int(r[0]["simTimeNs"]), int(r[-1]["simTimeNs"]), r) for r in runs]


def _dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def _assess_pick(streams, p, now, refs):
    g, c = streams["gripper"], streams["cup_pose"]
    if not g or not c:
        return _result("unknown", ["GRASP_EVIDENCE_MISSING"], refs)
    if now - int(g[-1]["simTimeNs"]) > p["freshnessNs"] or now - int(c[-1]["simTimeNs"]) > p["freshnessNs"]:
        return _result("unknown", ["STALE_SAMPLES"], refs)
    both = lambda s: s["leftContactN"] >= p["minContactN"] and s["rightContactN"] >= p["minContactN"]
    if not any(both(s) for s in g):
        return _result("unknown", ["GRASP_EVIDENCE_MISSING"], refs)
    base = c[0]["cupXyzM"][2]
    lifted = [s for s in c if s["cupXyzM"][2] - base >= p["liftM"]]
    if not lifted:
        return _result("unknown", ["LIFT_NOT_REACHED"], refs)
    start = int(lifted[0]["simTimeNs"])
    offset = [a - b for a, b in zip(lifted[0]["cupXyzM"], lifted[0]["toolXyzM"])]
    after = [s for s in c if int(s["simTimeNs"]) >= start]
    drifted = [s for s in after if _dist([a - b for a, b in zip(s["cupXyzM"], s["toolXyzM"])], offset) > p["driftM"]]
    contact_lost = [s for s in g if int(s["simTimeNs"]) >= start and not both(s)]
    # an observed failure after lift is a rejection even if the hold had not yet completed
    if drifted:
        return _result("rejected", ["GRASP_SLIPPED"], refs)
    if contact_lost:
        return _result("rejected", ["GRASP_CONTACT_LOST"], refs)
    if any(s["cupXyzM"][2] - base < p["liftM"] for s in after):
        return _result("rejected", ["CUP_DROPPED"], refs)
    for stream in ([s for s in g if int(s["simTimeNs"]) >= start], after):
        if any(int(b["simTimeNs"]) - int(a["simTimeNs"]) > p["maxGapNs"] for a, b in zip(stream, stream[1:])):
            return _result("unknown", ["EVIDENCE_GAP"], refs)  # nothing was observed in between, so nothing is confirmed
    held_ns = int(after[-1]["simTimeNs"]) - start
    if held_ns < p["holdS"] * NS_PER_S:
        return _result("unknown", ["HOLD_TOO_SHORT"], refs)
    return _result("confirmed", [], refs)


def _assess_place(streams, p, now, refs):
    g, t = streams["gripper"], streams["tray"]
    if not t:
        return _result("unknown", ["RECEIVER_EVIDENCE_MISSING"], refs)
    if not g:
        return _result("unknown", ["RELEASE_EVIDENCE_MISSING"], refs)
    if now - int(t[-1]["simTimeNs"]) > p["freshnessNs"] or now - int(g[-1]["simTimeNs"]) > p["freshnessNs"]:
        return _result("unknown", ["STALE_SAMPLES"], refs)
    if t[-1]["contact"] and not t[-1]["insideSlot"]:
        return _result("rejected", ["CUP_OUTSIDE_SLOT"], refs)
    if not t[-1]["contact"] and any(s["contact"] for s in t):
        return _result("rejected", ["RECEIVER_CONTACT_LOST"], refs)
    released = g[-1]["openingM"] >= p["releasedOpeningM"] and g[-1]["leftContactN"] < p["minContactN"] and g[-1]["rightContactN"] < p["minContactN"]
    if not released:
        return _result("unknown", ["JAWS_NOT_RELEASED"], refs)
    runs = _intervals(t, lambda s: s["contact"] and s["insideSlot"], p["maxGapNs"])
    if not runs or runs[-1][2][-1] is not t[-1] or (runs[-1][1] - runs[-1][0]) < p["receiverStableS"] * NS_PER_S:
        return _result("unknown", ["RECEIVER_NOT_STABLE"], refs)
    return _result("confirmed", [], refs)


def assess_transfer(samples, policy):
    for field in ("stage", "cupId", "epoch"):
        if field not in policy:
            raise ValueError(f"POLICY_INVALID:{field}")
    if policy["stage"] not in ("pick", "place"):
        raise ValueError("POLICY_INVALID:stage")
    p = {**DEFAULTS, **policy}
    streams, problems = _prepare(samples, p)
    all_times = [int(s["simTimeNs"]) for items in streams.values() for s in items]
    now = int(p["nowSimTimeNs"]) if "nowSimTimeNs" in p else (max(all_times) if all_times else 0)
    refs = [f"{k}@{items[0]['simTimeNs']}..{items[-1]['simTimeNs']}" for k, items in streams.items() if items]
    needed = {"pick": ("gripper", "cup_pose"), "place": ("gripper", "tray")}[p["stage"]]
    if any(x in problems for x in ("REORDERED_SAMPLES", "EPOCH_MISMATCH", "SAMPLE_INVALID")):
        return _result("unknown", problems, refs)
    result = (_assess_pick if p["stage"] == "pick" else _assess_place)(streams, p, now, refs)
    if result["status"] == "unknown" and not all(streams[k] for k in needed) and p["stage"] == "pick":
        result["reasons"] = sorted(set(result["reasons"]) | {"GRASP_EVIDENCE_MISSING"})
    result["reasons"] = sorted(set(result["reasons"]) | set(problems))
    return result
