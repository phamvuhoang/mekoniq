import pytest


def test_epoch_mismatch_and_full_queue_stop_the_world():
    from bridge.engineering_worker import EvidenceGap, EvidenceQueue, check_epoch
    with pytest.raises(RuntimeError, match="EPOCH_MISMATCH"):
        check_epoch({"epoch": 1}, 2)
    paused = []
    q = EvidenceQueue(limit=1, pause_world=lambda: paused.append(1))
    q.put({"sequence": 0})
    with pytest.raises(EvidenceGap):
        q.put({"sequence": 1})
    assert paused == [1] and q.failed  # the world is paused first; the run cannot continue


def test_failure_to_pause_is_a_hard_stop():
    from bridge.engineering_worker import EvidenceQueue
    def boom():
        raise OSError("no scene control")
    q = EvidenceQueue(limit=0, pause_world=boom)
    with pytest.raises(RuntimeError, match="EVIDENCE_GAP_PAUSE_FAILED"):
        q.put({"sequence": 0})


def test_one_writer_per_joint():
    from bridge.engineering_worker import assert_single_writer
    assert_single_writer([{"joint": "a", "controller": "ros2_control"}, {"joint": "b", "controller": "ros2_control"}])
    with pytest.raises(RuntimeError, match="JOINT_WRITER_CONFLICT:a"):
        assert_single_writer([{"joint": "a", "controller": "gz_diff_drive"}, {"joint": "a", "controller": "ros2_control"}])


def test_lifecycle_runs_in_order_and_stops_exactly_what_it_started():
    from bridge.engineering_worker import STAGES, Lifecycle
    stopped = []
    clock = iter(range(0, 1000))
    life = Lifecycle(monotonic=lambda: next(clock), startup_timeout_s=50)
    for stage in STAGES[:5]:
        life.enter(stage, owns=lambda s=stage: stopped.append(s))
    life.fail("VERIFY_IDENTITY_FAILED")
    assert life.failed == "VERIFY_IDENTITY_FAILED"
    assert stopped == list(reversed(STAGES[:5]))  # only what this run created, newest first
    with pytest.raises(RuntimeError, match="LIFECYCLE_FAILED"):
        life.enter(STAGES[5])


def test_stage_order_is_enforced_and_startup_has_a_wall_timeout():
    from bridge.engineering_worker import STAGES, Lifecycle
    life = Lifecycle(monotonic=lambda: 0, startup_timeout_s=10)
    with pytest.raises(RuntimeError, match="STAGE_ORDER"):
        life.enter(STAGES[2])
    t = [0]
    slow = Lifecycle(monotonic=lambda: t[0], startup_timeout_s=10)
    slow.enter(STAGES[0])
    t[0] = 11
    with pytest.raises(RuntimeError, match="STARTUP_TIMEOUT"):
        slow.enter(STAGES[1])
    assert slow.failed == "STARTUP_TIMEOUT"


def test_pause_stops_integration_but_not_the_watchdog():
    from bridge.engineering_worker import SimClock
    c = SimClock()
    c.advance(5_000_000)
    c.pause()
    c.advance(5_000_000)  # ignored while paused
    assert c.sim_ns == 5_000_000
    c.resume()
    c.advance(1)
    assert c.sim_ns == 5_000_001
    with pytest.raises(RuntimeError, match="CLOCK_REGRESSION"):
        c.advance(-1)


def test_one_failing_cleanup_does_not_stop_the_others():
    from bridge.engineering_worker import STAGES, Lifecycle
    stopped = []
    life = Lifecycle(monotonic=lambda: 0, startup_timeout_s=50)
    def bad():
        raise OSError("cannot kill")
    life.enter(STAGES[0], owns=lambda: stopped.append("a"))
    life.enter(STAGES[1], owns=bad)
    life.enter(STAGES[2], owns=lambda: stopped.append("c"))
    with pytest.raises(RuntimeError, match="CLEANUP_FAILED"):
        life.fail("X")
    assert stopped == ["c", "a"] and life.failed == "X"  # every cleanup ran, newest first


def test_the_queue_refuses_samples_after_an_overflow_even_once_drained():
    from bridge.engineering_worker import EvidenceGap, EvidenceQueue
    q = EvidenceQueue(limit=1, pause_world=lambda: None)
    q.put({"sequence": 0})
    with pytest.raises(EvidenceGap):
        q.put({"sequence": 1})
    q.drain()
    with pytest.raises(EvidenceGap, match="STREAM_FAILED"):
        q.put({"sequence": 2})  # the gap is not repaired by emptying the queue
