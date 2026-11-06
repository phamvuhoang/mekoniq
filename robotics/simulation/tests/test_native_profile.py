from bridge.native_profile import validate_profile


def fixture():
    return {"schemaVersion": 1, "id": "utm-ubuntu-arm64", "platform": "linux", "architecture": "arm64", "os": {"id": "ubuntu", "version": "24.04"}, "installation": "native_apt", "headless": True, "requiredPackages": ["ros-jazzy-ros-base"], "packageVersions": {"ros-jazzy-ros-base": "1.0"}, "runtimePin": {"rosDistro": "jazzy", "amentPrefixes": ["/opt/ros/jazzy"], "executables": {"ros2": {"path": "/opt/ros/jazzy/bin/ros2", "sha256": "a" * 64}, "gz": {"path": "/usr/bin/gz", "sha256": "b" * 64}}}}, {"platform": "linux", "architecture": "arm64", "os": {"id": "ubuntu", "version": "24.04"}, "packages": {"ros-jazzy-ros-base": "1.0"}, "runtime": {"rosDistro": "jazzy", "amentPrefixes": ["/opt/ros/jazzy"], "executables": {"ros2": {"path": "/opt/ros/jazzy/bin/ros2", "sha256": "a" * 64}, "gz": {"path": "/usr/bin/gz", "sha256": "b" * 64}}}}


def test_wrong_architecture_never_uses_another_profile():
    profile, actual = fixture()
    actual["architecture"] = "amd64"
    assert "PROFILE_ARCH_MISMATCH" in validate_profile(profile, actual)


def test_missing_or_changed_actual_inventory_blocks_run():
    profile, actual = fixture()
    actual["packages"] = {}
    assert "PROFILE_PACKAGE_MISSING:ros-jazzy-ros-base" in validate_profile(profile, actual)
    actual["packages"] = {"ros-jazzy-ros-base": "2.0"}
    assert "PROFILE_PACKAGE_MISMATCH:ros-jazzy-ros-base" in validate_profile(profile, actual)
    profile["packageVersions"] = None
    assert "PROFILE_INVENTORY_UNRESOLVED" in validate_profile(profile, actual)


def test_actual_inventory_matches_reviewed_pin():
    profile, actual = fixture()
    assert validate_profile(profile, actual) == []
    profile["id"] = "unknown"
    assert "PROFILE_UNKNOWN" in validate_profile(profile, actual)


def test_unpinned_dependencies_and_alternate_runtime_are_blocked():
    profile, actual = fixture()
    profile["packageVersions"]["engine-library"] = "8.0"
    actual["packages"]["engine-library"] = "8.1"
    assert "PROFILE_PACKAGE_MISMATCH:engine-library" in validate_profile(profile, actual)
    actual["runtime"] = {"executables": {"gz": {"path": "/tmp/alternate-gz"}}}
    assert "PROFILE_RUNTIME_MISMATCH" in validate_profile(profile, actual)


def test_rebuilding_overlay_at_same_prefix_changes_content_identity(tmp_path):
    from bridge.native_profile import overlay_fingerprint
    library = tmp_path / "controller.so"
    library.write_bytes(b"first build")
    first = overlay_fingerprint(tmp_path)
    library.write_bytes(b"other build")
    assert overlay_fingerprint(tmp_path) != first

def test_worker_pythonpath_identity_is_stable_across_private_snapshots():
    from bridge.native_profile import worker_pythonpath_identity
    assert worker_pythonpath_identity('/checkout/robotics/simulation:/checkout/robotics/agent:/opt/vendor', '/checkout/robotics/simulation') == worker_pythonpath_identity('/run/private/source/robotics/simulation:/run/private/source/robotics/agent:/opt/vendor', '/run/private/source/robotics/simulation') == '$NATIVE_SOURCE/robotics/simulation:$NATIVE_SOURCE/robotics/agent:/opt/vendor'
