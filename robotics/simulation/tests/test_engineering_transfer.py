S = 1_000_000_000


def ns(t):
    return str(round(t * S))


def pick_samples(seconds=2.5, lift_at=0.5, lift=0.06, slip_after=None, release_contact_at=None, drift=0.0):
    out, t, i = [], 0.0, 0
    while t <= seconds + 1e-9:
        lifted = t >= lift_at
        z = 0.80 + (lift if lifted else 0.0)
        tool_z = z + 0.02
        dx = drift if slip_after is not None and t >= slip_after else 0.0
        contact = 6.0 if release_contact_at is None or t < release_contact_at else 0.0
        out += [{"kind": "gripper", "simTimeNs": ns(t), "leftContactN": contact, "rightContactN": contact, "openingM": 0.07, "cupId": "cup-1", "epoch": 1, "sequence": i},
                {"kind": "cup_pose", "simTimeNs": ns(t), "cupXyzM": [0.3 + dx, 0.0, z], "toolXyzM": [0.3, 0.0, tool_z], "cupId": "cup-1", "epoch": 1, "sequence": i}]
        t, i = t + 0.01, i + 1
    return out


def place_samples(inside=True, released=True, seconds=1.0, drop_contact_at=None):
    out, t, i = [], 0.0, 0
    while t <= seconds + 1e-9:
        contact = drop_contact_at is None or t < drop_contact_at
        out += [{"kind": "gripper", "simTimeNs": ns(t), "leftContactN": 0.0 if released else 5.0, "rightContactN": 0.0 if released else 5.0, "openingM": 0.08 if released else 0.05, "cupId": "cup-1", "epoch": 1, "sequence": i},
                {"kind": "tray", "simTimeNs": ns(t), "contact": contact, "insideSlot": inside, "loadKg": 0.22, "cupId": "cup-1", "epoch": 1, "sequence": i}]
        t, i = t + 0.01, i + 1
    return out


PICK = {"stage": "pick", "cupId": "cup-1", "epoch": 1}
PLACE = {"stage": "place", "cupId": "cup-1", "epoch": 1}


def assess(samples, policy):
    from bridge.contact_transfer import assess_transfer
    return assess_transfer(samples, policy)


def test_completion_is_not_grasp():
    result = assess([{"kind": "command_complete", "simTimeNs": "1000000000"}], {"stage": "pick", "cupId": "cup-1", "epoch": 1})
    assert result["status"] != "confirmed"
    assert "GRASP_EVIDENCE_MISSING" in result["reasons"]


def test_normal_grasp_lift_and_hold_is_confirmed():
    result = assess(pick_samples(), PICK)
    assert result == {"status": "confirmed", "reasons": [], "evidenceRefs": result["evidenceRefs"]}
    assert result["evidenceRefs"]


def test_completed_command_with_no_contact_stays_unknown_even_if_the_cup_rose():
    samples = [s for s in pick_samples() if s["kind"] != "gripper"] + [{"kind": "command_complete", "simTimeNs": ns(2.5)}]
    assert assess(samples, PICK)["status"] == "unknown"


def test_hold_shorter_than_one_second_is_unknown():
    result = assess(pick_samples(seconds=1.2), PICK)  # lifted at 0.5 s, only 0.7 s held
    assert result["status"] == "unknown" and "HOLD_TOO_SHORT" in result["reasons"]


def test_slip_after_lift_is_rejected():
    result = assess(pick_samples(slip_after=1.0, drift=0.012), PICK)  # low friction: the cup creeps 12 mm in the jaws
    assert result["status"] == "rejected" and "GRASP_SLIPPED" in result["reasons"]


def test_force_drop_after_lift_is_rejected():
    result = assess(pick_samples(release_contact_at=1.5), PICK)
    assert result["status"] == "rejected" and "GRASP_CONTACT_LOST" in result["reasons"]


def test_lift_not_reached_is_unknown():
    assert "LIFT_NOT_REACHED" in assess(pick_samples(lift=0.01), PICK)["reasons"]


def test_stale_streams_are_unknown_not_confirmed():
    result = assess(pick_samples(), {**PICK, "nowSimTimeNs": ns(9.0)})
    assert result["status"] == "unknown" and "STALE_SAMPLES" in result["reasons"]


def test_other_cup_other_epoch_duplicates_and_reordering_are_not_evidence():
    foreign = [dict(s, cupId="cup-2") for s in pick_samples()]
    assert assess(foreign, PICK)["status"] == "unknown"
    old_epoch = [dict(s, epoch=0) for s in pick_samples()]
    r = assess(old_epoch, PICK)
    assert r["status"] == "unknown" and "EPOCH_MISMATCH" in r["reasons"]
    dup = pick_samples() + pick_samples()[:10]
    assert "DUPLICATE_SAMPLE" in assess(dup, PICK)["reasons"]
    shuffled = pick_samples()
    shuffled[10], shuffled[40] = shuffled[40], shuffled[10]
    r = assess(shuffled, PICK)
    assert r["status"] == "unknown" and "REORDERED_SAMPLES" in r["reasons"]


def test_release_needs_open_jaws_and_a_stable_receiver_inside_the_slot():
    assert assess(place_samples(), PLACE)["status"] == "confirmed"
    assert "JAWS_NOT_RELEASED" in assess(place_samples(released=False), PLACE)["reasons"]
    short = assess(place_samples(seconds=0.3), PLACE)
    assert short["status"] == "unknown" and "RECEIVER_NOT_STABLE" in short["reasons"]
    assert assess([s for s in place_samples() if s["kind"] != "tray"], PLACE)["reasons"] == ["RECEIVER_EVIDENCE_MISSING"]


def test_amr_drift_that_leaves_the_slot_is_rejected_and_lost_receiver_contact_too():
    assert assess(place_samples(inside=False), PLACE) == {"status": "rejected", "reasons": ["CUP_OUTSIDE_SLOT"], "evidenceRefs": assess(place_samples(inside=False), PLACE)["evidenceRefs"]}
    assert assess(place_samples(drop_contact_at=0.8), PLACE)["reasons"] == ["RECEIVER_CONTACT_LOST"]


def test_policy_must_name_stage_cup_and_epoch():
    import pytest
    with pytest.raises(ValueError, match="POLICY_INVALID:epoch"):
        assess([], {"stage": "pick", "cupId": "c"})
    with pytest.raises(ValueError, match="POLICY_INVALID:stage"):
        assess([], {"stage": "carry", "cupId": "c", "epoch": 1})


def test_samples_without_identity_are_not_evidence():
    # finding: missing cupId/epoch used to default to the policy's values and count as this cup's evidence
    anonymous = [{k: v for k, v in s.items() if k not in ("cupId", "epoch")} for s in pick_samples()]
    result = assess(anonymous, PICK)
    assert result["status"] != "confirmed" and "SAMPLE_INVALID" in result["reasons"]


def test_long_gaps_in_the_streams_cannot_be_bridged_into_a_confirmed_hold():
    sparse = [s for s in pick_samples() if int(s["simTimeNs"]) in (0, 500_000_000, 510_000_000, 2_500_000_000)]
    result = assess(sparse, PICK)
    assert result["status"] == "unknown" and "EVIDENCE_GAP" in result["reasons"]


def test_receiver_stability_cannot_be_bridged_across_a_gap_either():
    sparse = [s for s in place_samples(seconds=1.0) if int(s["simTimeNs"]) in (0, 1_000_000_000) or s["kind"] == "gripper"]
    result = assess(sparse, PLACE)
    assert result["status"] == "unknown"
