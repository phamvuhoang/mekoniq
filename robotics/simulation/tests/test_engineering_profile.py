import json
from pathlib import Path

PROFILES = Path(__file__).resolve().parents[1] / "profiles"


def locked(**over):
    base = {"os": "ubuntu24.04", "arch": "arm64", "required": ["ros-jazzy-navigation2"], "packages": {"ros-jazzy-navigation2": "1.3.0-1"}, "digests": {"world-plugin": "a" * 64}, "forbidden": ["linuxcnc-uspace"]}
    base.update(over)
    return base


def actual(**over):
    base = {"os": "ubuntu24.04", "arch": "arm64", "packages": {"ros-jazzy-navigation2": "1.3.0-1"}, "digests": {"world-plugin": "a" * 64}}
    base.update(over)
    return base


def test_wrong_architecture_is_not_qualified():
    from bridge.engineering_profile import qualify_inventory
    report = qualify_inventory(
        {"os": "ubuntu24.04", "arch": "arm64", "packages": {}},
        {"os": "ubuntu24.04", "arch": "amd64", "packages": {}})
    assert report["qualified"] is False
    assert "ARCHITECTURE_MISMATCH" in report["reasons"]


def test_matching_complete_inventory_is_qualified():
    from bridge.engineering_profile import qualify_inventory
    assert qualify_inventory(actual(), locked()) == {"qualified": True, "reasons": []}


def test_package_absence_and_version_drift_are_separate_reasons():
    from bridge.engineering_profile import qualify_inventory
    assert "PACKAGE_MISSING:ros-jazzy-navigation2" in qualify_inventory(actual(packages={}), locked())["reasons"]
    assert "PACKAGE_MISMATCH:ros-jazzy-navigation2" in qualify_inventory(actual(packages={"ros-jazzy-navigation2": "9.9"}), locked())["reasons"]


def test_unpinned_lock_never_qualifies_even_when_everything_is_present():
    from bridge.engineering_profile import qualify_inventory
    for lock in (locked(packages=None), locked(packages={}), locked(packages={"x": "1"}, required=["ros-jazzy-navigation2"])):
        report = qualify_inventory(actual(), lock)
        assert report["qualified"] is False
    assert "INVENTORY_UNRESOLVED" in qualify_inventory(actual(), locked(packages=None))["reasons"]


def test_plugin_digest_drift_and_hardware_plugins_block():
    from bridge.engineering_profile import qualify_inventory
    assert "DIGEST_MISMATCH:world-plugin" in qualify_inventory(actual(digests={"world-plugin": "b" * 64}), locked())["reasons"]
    assert "DIGEST_MISSING:world-plugin" in qualify_inventory(actual(digests={}), locked())["reasons"]
    packages = {"ros-jazzy-navigation2": "1.3.0-1", "linuxcnc-uspace": "2.9"}
    assert "HARDWARE_PLUGIN_PRESENT:linuxcnc-uspace" in qualify_inventory(actual(packages=packages), locked())["reasons"]


def test_shipped_locks_are_candidates_with_no_invented_inventory():
    for target, arch in (("engineering-arm64", "arm64"), ("engineering-amd64", "amd64")):
        lock = json.loads((PROFILES / f"{target}.lock.json").read_text())
        assert lock["id"] == target and lock["arch"] == arch and lock["os"] == "ubuntu24.04"
        assert lock["qualification"] == "not_run" and lock["packages"] is None
        assert {"ros-jazzy-navigation2", "ros-jazzy-moveit", "ros-jazzy-gz-ros2-control"} <= set(lock["required"])


def test_inspect_on_an_unprovisioned_host_reports_blockers_not_availability():
    from bridge.native_profile import inspect_profile
    report = inspect_profile("engineering-arm64")
    assert report["id"] == "engineering-arm64" and report["available"] is False
    assert "INVENTORY_UNRESOLVED" in report["reasonCodes"]
    assert inspect_profile("engineering-unknown")["reasonCodes"] == ["PROFILE_UNKNOWN"]
