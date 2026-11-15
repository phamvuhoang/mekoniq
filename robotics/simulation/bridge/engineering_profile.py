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


def qualify_native_inventory(actual, locked):
    """Native execution additionally binds actual plugin files, launch environment and apt sources.
    The generic comparator above remains a portable consistency test, not a host attestation.
    """
    report=qualify_inventory(actual,locked);reasons=report['reasons']
    plugins=locked.get('digests')
    if not isinstance(plugins,dict) or not plugins or not all(name.startswith('/') and len(digest)==64 for name,digest in plugins.items()):
        reasons.append('PLUGIN_INVENTORY_UNRESOLVED')
    runtime=locked.get('runtimePin')
    if not isinstance(runtime,dict) or not runtime:
        reasons.append('RUNTIME_INVENTORY_UNRESOLVED')
    elif actual.get('runtime') != runtime:
        reasons.append('RUNTIME_INVENTORY_MISMATCH')
    provenance=locked.get('aptProvenance')
    if not isinstance(provenance,dict) or not provenance:
        reasons.append('APT_PROVENANCE_UNRESOLVED')
    elif actual.get('aptProvenance') != provenance:
        reasons.append('APT_PROVENANCE_MISMATCH')
    return {'qualified':not reasons,'reasons':reasons}
