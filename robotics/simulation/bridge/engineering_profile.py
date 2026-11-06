"""Engineering native environment qualification. A lock without a captured inventory never qualifies a host."""


def qualify_inventory(actual: dict, locked: dict) -> dict:
    """Compare what a host has against its target lock; every difference is its own reason code."""
    reasons = []
    if actual.get("os") != locked.get("os"):
        reasons.append("OS_MISMATCH")
    if actual.get("arch") != locked.get("arch"):
        reasons.append("ARCHITECTURE_MISMATCH")
    pinned = locked.get("packages")
    required = locked.get("required") or []
    installed = actual.get("packages") or {}
    # A candidate lock (nothing pinned, or a required package without a pinned version) can never be matched by presence alone.
    if not isinstance(pinned, dict) or not pinned or any(name not in pinned for name in required):
        reasons.append("INVENTORY_UNRESOLVED")
    for name in sorted(set(required) | set(pinned or {})):
        if name not in installed:
            reasons.append(f"PACKAGE_MISSING:{name}")
        elif isinstance(pinned, dict) and name in pinned and installed[name] != pinned[name]:
            reasons.append(f"PACKAGE_MISMATCH:{name}")
    digests = actual.get("digests") or {}
    for name, digest in sorted((locked.get("digests") or {}).items()):
        if name not in digests:
            reasons.append(f"DIGEST_MISSING:{name}")
        elif digests[name] != digest:
            reasons.append(f"DIGEST_MISMATCH:{name}")
    for name in sorted(set(locked.get("forbidden") or []) & set(installed)):
        reasons.append(f"HARDWARE_PLUGIN_PRESENT:{name}")
    return {"qualified": not reasons, "reasons": reasons}
