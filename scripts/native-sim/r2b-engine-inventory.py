"""Read-only installed engine inventory for the current subject image; no campaign behavior."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys
import mujoco
artifacts = []
for path in sorted(Path(mujoco.__file__).parent.rglob("*")):
    if path.is_file() and ("libmujoco" in path.name or path.name == "__init__.py"):
        data = path.read_bytes()
        artifacts.append({"path": str(path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
print(json.dumps({"version": mujoco.__version__, "python": sys.version, "artifacts": artifacts,
                  "packages": sorted({d.metadata["Name"]: d.version for d in importlib.metadata.distributions()}.items())}))
