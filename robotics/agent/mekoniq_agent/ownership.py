"""Who may drive this robot: provisioned scope/map, the control-epoch fence and the time window. Pure functions, no I/O."""
from dataclasses import dataclass
from datetime import datetime, timezone
import math


@dataclass(frozen=True)
class Profile:
    """Provisioned out of band (never taken from a command). One executor per robot."""
    organization_id: str
    venue_id: str
    robot_id: str
    executor_id: str
    control_epoch: int
    map_id: str
    map_revision: str
    frame: str
    max_ttl_ms: int = 300_000   # a command may not claim to live longer than this from now
    max_skew_ms: int = 30_000   # tolerated issuer clock lead; beyond it the command is refused, not trusted


def parse_utc_ms(value):
    """Schema guarantees an RFC 3339 UTC `...Z` string; anything else is invalid."""
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ValueError("INVALID_TIME")
    return round(datetime.fromisoformat(value[:-1] + "+00:00").astimezone(timezone.utc).timestamp() * 1000)


def scope_reason(command, p):
    if command["organizationId"] != p.organization_id or command["venueId"] != p.venue_id:
        return "SCOPE_MISMATCH"
    if command["robotId"] != p.robot_id:
        return "ROBOT_MISMATCH"


def epoch_reason(epoch, current):
    """Stale is refused; at most one handoff ahead of the persisted epoch, so one forged value cannot fence out later commands."""
    if epoch < current:
        return "STALE_CONTROL_EPOCH"
    if epoch > current + 1:
        return "CONTROL_EPOCH_OUT_OF_RANGE"


def time_reason(command, now_ms, p):
    issued, expires = parse_utc_ms(command["issuedAt"]), parse_utc_ms(command["expiresAt"])
    if expires <= now_ms:
        return "EXPIRED_COMMAND"
    if expires <= issued:
        return "INVALID_COMMAND"
    # An issuer whose clock runs ahead would make an old command look fresh: bound both its issue time and its lifetime.
    if issued > now_ms + p.max_skew_ms or expires > now_ms + p.max_ttl_ms:
        return "CLOCK_SKEW"


def domain_reason(target, p):
    """The goal must be in the map/frame this executor is bound to, with finite coordinates."""
    if target.get("mapId") != p.map_id or target.get("mapRevision") != p.map_revision:
        return "MAP_MISMATCH"
    if target.get("frame") != p.frame:
        return "FRAME_MISMATCH"
    for axis in ("x", "y"):
        v = target.get(axis)
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            return "INVALID_TARGET"
