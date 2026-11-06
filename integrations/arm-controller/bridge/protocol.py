"""arm.command.v1 / arm.status.v1 / arm.event.v1 / arm.reply.v1 over newline-delimited JSON on a fixed local Unix socket. The envelope is validated
against the shared contract schemas (source/packages/contracts/schemas; copied into the artifact as ./schemas): the inner command is the
mekoniq.cell-command.v2 authority envelope, nothing here is a second one. Frames, queues and rates are bounded by the machine profile.
No HAL/MDI/G-code text, file path, Python or network endpoint is accepted from a caller; forbidden fields are named, never swallowed."""
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from jsonschema import Draft7Validator, FormatChecker
from referencing import Registry, Resource

try:
    import rfc8785
    canonical = rfc8785.dumps
except ImportError:  # the IPC may lack rfc8785; our JSON (ASCII keys, integers, hex strings) canonicalises identically
    canonical = lambda v: json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()

KIND_COMMAND, KIND_STATUS, KIND_EVENT, KIND_REPLY = "arm.command.v1", "arm.status.v1", "arm.event.v1", "arm.reply.v1"
ARM_CAPABILITIES = ("stage_program", "start_job", "pause_job", "resume_job", "cancel_job", "query_outcome")
OWNER_KINDS = ("none", "local_operator", "lab_simulation", "authorized_cell_job")
SHAPES = ("command", "acquire", "release", "renew", "reconcile", "local", "revoke", "simScene", "barrier")
MAX_TTL_MS = 300_000  # a command may not claim to live longer than this from the local clock (issuer clock lead beyond it is a skew refusal)
# same classification as lab-runtime contracts.ts classifyField
_ACTOR, _ENDPOINT, _RAW = re.compile(r"actor|role|principal|owner|operator|user", re.I), re.compile(r"endpoint|url|uri|host|address|socket|topic|^ip$|^port$|path|file", re.I), re.compile(r"gcode|halcmd|mdi|shell|script|python|command$", re.I)
PKG = Path(__file__).resolve().parents[1]


class ProtocolError(ValueError):
    def __init__(self, code, detail=None):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code, self.detail = code, detail


def classify(name):
    return "ACTOR_FORBIDDEN" if _ACTOR.search(name) else "ENDPOINT_FORBIDDEN" if _ENDPOINT.search(name) else "RAW_COMMAND_FORBIDDEN" if _RAW.search(name) else "UNKNOWN_FIELD"


def parse_strict(raw):
    """No duplicate keys, no NaN/Infinity, UTF-8 only."""
    def pairs(items):
        keys = [k for k, _ in items]
        if len(keys) != len(set(keys)):
            raise ProtocolError("INVALID_JSON", "duplicate key")
        return dict(items)

    def bad(_):
        raise ProtocolError("INVALID_JSON", "non-finite number")
    try:
        return json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw, object_pairs_hook=pairs, parse_constant=bad)
    except ProtocolError:
        raise
    except (ValueError, TypeError, UnicodeDecodeError) as e:
        raise ProtocolError("INVALID_JSON", str(e)[:80]) from e


def frame(obj):
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode() + b"\n"


def read_frames(stream, max_bytes):
    """One JSON object per line; a line longer than the bound is a protocol error (the caller closes the connection)."""
    while True:
        line = stream.readline(max_bytes + 1)
        if not line:
            return
        if len(line) > max_bytes:
            raise ProtocolError("FRAME_TOO_LARGE", f"> {max_bytes} bytes")
        if line.strip():
            yield parse_strict(line)


def schema_dir():
    for candidate in (os.environ.get("MEKONIQ_ARM_SCHEMA_DIR"), PKG / "schemas", PKG.parents[1] / "packages" / "contracts" / "schemas"):
        if candidate and Path(candidate).is_dir():
            return Path(candidate)
    raise ProtocolError("SCHEMA_DIR_MISSING")


def load_validators(directory=None):
    """Per-branch validators: the arm envelope (command kept opaque), each cell-command capability branch, each observation kind."""
    d = Path(directory) if directory else schema_dir()
    load = lambda n: json.loads((d / n).read_text())
    cell_cmd, cell_obs, arm_cmd, arm_obs = load("cell-command.schema.json"), load("cell-observation.schema.json"), load("arm-command.schema.json"), load("arm-observation.schema.json")
    registry = Registry().with_resources([("cell-command.schema.json", Resource.from_contents(cell_cmd)), ("cell-observation.schema.json", Resource.from_contents(cell_obs))])
    mk = lambda s: Draft7Validator(s, registry=registry, format_checker=FormatChecker())
    envelope = {**arm_cmd, "properties": {**arm_cmd["properties"], "command": {"type": "object"}}}
    return {"envelope": mk(envelope), "command": {b["properties"]["capability"]["const"]: mk({**b, "$schema": cell_cmd["$schema"]}) for b in cell_cmd["oneOf"]},
            "observation": {b["properties"]["kind"]["const"]: mk({**b, "$schema": arm_obs["$schema"]}) for b in arm_obs["oneOf"]}, "capabilities": [b["properties"]["capability"]["const"] for b in cell_cmd["oneOf"]]}


def _codes(errors, prefix=""):
    out = []
    for e in errors:
        path = prefix + "".join(f"/{p}" for p in e.absolute_path)
        if e.validator == "additionalProperties":
            for name in sorted(set(e.instance) - set(e.schema.get("properties", {}))):
                out.append(f"{classify(name)}:{name}")
        elif e.validator == "required":
            out.append(f"FIELD_REQUIRED:{e.message.split(chr(39))[1]}")
        elif e.validator in ("oneOf", "anyOf") and e.context:
            out.extend(_codes([min(e.context, key=lambda c: -len(c.absolute_path))], prefix))
        else:
            out.append(f"INVALID_FIELD:{path or '/'}")
    return out


def validate(message, validators):
    """-> reason codes ([] = valid). The envelope and the inner command are validated by their own branch so every code names its field."""
    if not isinstance(message, dict):
        return ["INVALID_FIELD:/"]
    kind = message.get("kind")
    if kind == KIND_COMMAND:
        codes = _codes(validators["envelope"].iter_errors(message))
        if sum(k in message for k in SHAPES) != 1:
            codes.append("MESSAGE_SHAPE_AMBIGUOUS")
        cmd = message.get("command")
        if isinstance(cmd, dict):
            cap = cmd.get("capability")
            v = validators["command"].get(cap)
            codes += _codes(v.iter_errors(cmd), "/command") if v else [f"INVALID_FIELD:/command/capability"]
        return codes
    v = validators["observation"].get(kind)
    return _codes(v.iter_errors(message)) if v else ["KIND_UNKNOWN"]


def profile_hash(profile):
    return hashlib.sha256(canonical(profile)).hexdigest()


def parse_utc_ms(value):
    if not isinstance(value, str) or not value.endswith("Z"):
        raise ProtocolError("INVALID_TIME", str(value)[:40])
    try:
        return round(datetime.fromisoformat(value[:-1] + "+00:00").astimezone(timezone.utc).timestamp() * 1000)
    except ValueError as e:
        raise ProtocolError("INVALID_TIME", str(e)[:40]) from e


def local_deadline_ms(expires_at, now_ms, profile):
    """The caller's expiry becomes a local deadline on receipt, capped by MAX_TTL_MS; the issuer's clock is never trusted beyond that."""
    return min(parse_utc_ms(expires_at), now_ms + MAX_TTL_MS)


def check_expectations(env, profile):
    codes = []
    if env.get("machineId") != profile["machineId"]:
        codes.append("MACHINE_MISMATCH")
    exp = env.get("expected") or {}
    if exp.get("profileHash") != profile_hash(profile):
        codes.append("PROFILE_MISMATCH")
    if exp.get("modelManifestSha256") != profile["model"]["manifestSha256"]:
        codes.append("MODEL_MISMATCH")
    return codes


def check_command(env, profile, now_ms):
    """Profile-level admission of one command envelope (no state, no owner): machine/profile/model expectations, arm capability, program
    allowlist by id + sha256, expiry on the local clock, issuer clock skew."""
    codes = check_expectations(env, profile)
    cmd = env.get("command") or {}
    cap = cmd.get("capability")
    if cap not in ARM_CAPABILITIES:
        codes.append(f"ARM_CAPABILITY_UNSUPPORTED:{cap}")
    ref = cmd.get("programRef")
    if cap in ("stage_program", "start_job") and ref is not None:
        allowed = profile["programs"].get(ref.get("id"))
        if not allowed:
            codes.append(f"PROGRAM_NOT_ALLOWLISTED:{ref.get('id')}")
        elif allowed["sha256"] != ref.get("hash"):
            codes.append("PROGRAM_HASH_MISMATCH")
    elif cap == "stage_program":
        codes.append("PROGRAM_REF_REQUIRED")
    try:
        expires = parse_utc_ms(cmd.get("expiresAt"))
        if expires <= now_ms:
            codes.append("COMMAND_EXPIRED")
        elif expires > now_ms + MAX_TTL_MS:
            codes.append("CLOCK_SKEW_EXCEEDED")
    except ProtocolError:
        codes.append("INVALID_FIELD:/command/expiresAt")
    return codes
