"""Native apt environment inventory. A candidate lock is never a qualified VM."""
import argparse
import hashlib
import json
import platform
import os
import shutil
import time
import re
import subprocess
from pathlib import Path

PROFILE_ID = "utm-ubuntu-arm64"
PROFILES = Path(__file__).resolve().parents[1] / "profiles"


def validate_profile(profile, actual):
    reasons = []
    if profile.get("id") != PROFILE_ID or profile.get("schemaVersion") != 1:
        reasons.append("PROFILE_UNKNOWN")
    if actual.get("platform") != "linux":
        reasons.append("PROFILE_PLATFORM_MISMATCH")
    if actual.get("architecture") != profile.get("architecture") or profile.get("architecture") != "arm64":
        reasons.append("PROFILE_ARCH_MISMATCH")
    if actual.get("os") != profile.get("os") or profile.get("os") != {"id": "ubuntu", "version": "24.04"}:
        reasons.append("PROFILE_OS_MISMATCH")
    required = profile.get("requiredPackages")
    pinned = profile.get("packageVersions")
    if not isinstance(required, list) or not required or any(not isinstance(p, str) or not re.fullmatch(r"[a-z0-9][a-z0-9+.-]+", p) for p in required):
        return reasons + ["PROFILE_PACKAGES_INVALID"]
    if not isinstance(pinned, dict) or any(not isinstance(pinned.get(p), str) or not pinned[p] for p in required):
        reasons.append("PROFILE_INVENTORY_UNRESOLVED")
    packages = actual.get("packages") or {}
    for name in sorted(set(required) | set(pinned or {}) | set(packages)):
        if not packages.get(name):
            reasons.append(f"PROFILE_PACKAGE_MISSING:{name}")
        elif isinstance(pinned, dict) and packages[name] != pinned.get(name):
            reasons.append(f"PROFILE_PACKAGE_MISMATCH:{name}")
    runtime_pin = profile.get("runtimePin")
    runtime = actual.get("runtime")
    if not isinstance(runtime_pin, dict) or not runtime_pin:
        reasons.append("PROFILE_RUNTIME_UNRESOLVED")
    elif runtime != runtime_pin or not isinstance(runtime, dict) or runtime.get("rosDistro") != "jazzy" or not all(runtime.get("executables", {}).get(name, {}).get("sha256") for name in ("ros2", "gz")):
        reasons.append("PROFILE_RUNTIME_MISMATCH")
    return reasons


def overlay_fingerprint(prefix):
    root = Path(prefix)
    if not root.is_dir():
        raise ValueError("PROFILE_OVERLAY_MISSING")
    digest = hashlib.sha256()
    total = 0
    started = time.monotonic()
    for index, path in enumerate(sorted(root.rglob("*"))):
        if index > 100000 or time.monotonic() - started > 20:
            raise ValueError("PROFILE_OVERLAY_LIMIT")
        if path.is_symlink() and path.is_dir():
            raise ValueError("PROFILE_OVERLAY_DIRECTORY_SYMLINK")
        if path.is_file():
            total += path.stat().st_size
            if total > 1024 * 1024 * 1024:
                raise ValueError("PROFILE_OVERLAY_LIMIT")
            digest.update(str(path.relative_to(root)).encode() + b"\0")
            with path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    digest.update(chunk)
            digest.update(b"\0")
    return digest.hexdigest()


def worker_pythonpath_identity(value, simulation_root):
    # Only the two source-owned import roots relocate into a private byte-verified snapshot.
    # External Python roots retain their actual paths; the raw execution paths stay in the inventory.
    root = Path(simulation_root).resolve()
    local = {str(root): "$NATIVE_SOURCE/robotics/simulation", str(root.parent / "agent"): "$NATIVE_SOURCE/robotics/agent"}
    return os.pathsep.join(local.get(str(Path(p).resolve()), p) if p else p for p in value.split(os.pathsep))


def inspect_profile(profile_id):
    if profile_id != PROFILE_ID:
        return {"id": profile_id, "available": False, "reasonCodes": ["PROFILE_UNKNOWN"], "image": None}
    profile = json.loads((PROFILES / f"{profile_id}.lock.json").read_text())
    os_release = {}
    try:
        for line in Path("/etc/os-release").read_text().splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                os_release[key] = value.strip('"')
    except OSError:
        pass
    machine = platform.machine().lower()
    actual = {"platform": platform.system().lower(), "architecture": {"aarch64": "arm64", "arm64": "arm64", "x86_64": "amd64"}.get(machine, machine), "os": {"id": os_release.get("ID"), "version": os_release.get("VERSION_ID")}, "packages": {}}
    try:
        result = subprocess.run(["dpkg-query", "-W", "-f=${binary:Package}\t${db:Status-Abbrev}\t${Version}\n"], capture_output=True, text=True, timeout=10, check=False)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                fields = line.split("\t")
                if len(fields) == 3 and fields[1].startswith("ii "):
                    actual["packages"][fields[0]] = fields[2]
    except (OSError, subprocess.TimeoutExpired):
        pass
    executables = {}
    for name in ("ros2", "gz"):
        resolved = shutil.which(name)
        if resolved:
            path = Path(resolved).resolve()
            try:
                executables[name] = {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
            except OSError:
                pass
    actual["runtime"] = {"rosDistro": os.environ.get("ROS_DISTRO"), "amentPrefixes": os.environ.get("AMENT_PREFIX_PATH", "").split(os.pathsep), "executables": executables,
                         "pythonPath": worker_pythonpath_identity(os.environ.get("PYTHONPATH", ""), Path(__file__).resolve().parents[1]), "libraryPath": os.environ.get("LD_LIBRARY_PATH", ""), "gazeboPluginPath": os.environ.get("GZ_SIM_SYSTEM_PLUGIN_PATH", "")}
    try:
        actual["runtime"]["overlayManifests"] = {prefix: overlay_fingerprint(prefix) for prefix in actual["runtime"]["amentPrefixes"] if prefix and Path(prefix).resolve() != Path("/opt/ros/jazzy")}
    except (OSError, ValueError) as error:
        return {"id": profile_id, "available": False, "reasonCodes": [str(error)], "image": None}
    actual["executionPaths"] = {"pythonPath": os.environ.get("PYTHONPATH", "")}
    reasons = validate_profile(profile, actual)
    digest = hashlib.sha256(json.dumps(actual, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"id": profile_id, "available": not reasons, "reasonCodes": reasons, "installation": "native_apt", "headless": True, "image": None, "profileSha256": hashlib.sha256((PROFILES / f"{profile_id}.lock.json").read_bytes()).hexdigest(), "actual": actual, "inventorySha256": digest}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    args = parser.parse_args()
    print(json.dumps(inspect_profile(args.profile), sort_keys=True))
