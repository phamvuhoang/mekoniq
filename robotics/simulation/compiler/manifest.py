"""Canonical hashing (SHA-256 over RFC 8785 JSON, the same algorithm as packages/contracts hashPayload) and the hashed bundle writer."""
import hashlib
import json
import re
from pathlib import Path

import rfc8785

from .models import CompileError

HASH_ALGORITHM = "sha256-canonical-json-v1"
COMPILER = {"id": "lab-world-compiler", "version": "1"}
SAFE_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,200}$")


def canonical_hash(value):
    return hashlib.sha256(rfc8785.dumps(value)).hexdigest()


def resolve_output(output_dir, run_root):
    """The bundle directory, required to be inside run_root when one is declared (a run never writes outside its own root)."""
    out = Path(output_dir).resolve()
    if run_root is not None:
        root = Path(run_root).resolve()
        if out != root and root not in out.parents:
            raise CompileError("OUTPUT_OUTSIDE_RUN_ROOT", str(output_dir))
    return out


def write_hashed_bundle(out, input_hash, manifest, files):
    """Write every file, then the manifest (outputs sorted by path, each with its sha256; manifestHash covers everything but itself).
    Called only after the whole bundle rendered, so an invalid input never leaves a partial bundle."""
    for name in files:
        if not SAFE_NAME.match(name) or name in (".", ".."):
            raise CompileError("OUTPUT_NAME_INVALID", name)
    out.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        target = (out / name).resolve()
        if target.parent != out:
            raise CompileError("OUTPUT_NAME_INVALID", name)
        target.write_bytes(data)
    result = {**manifest, "compiler": COMPILER, "hashAlgorithm": HASH_ALGORITHM, "inputHash": input_hash,
              "outputs": [{"path": name, "sha256": hashlib.sha256(files[name]).hexdigest()} for name in sorted(files)]}
    result["manifestHash"] = canonical_hash(result)
    (out / "compiler-manifest.json").write_bytes((json.dumps(result, indent=2, sort_keys=True) + "\n").encode())
    return result
