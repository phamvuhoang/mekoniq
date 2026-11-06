"""Test path setup: the arm-controller package root (bridge/, models/) and, for cross-runtime checks only, the sibling simulation tooling."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]                      # source/integrations/arm-controller
SOURCE = ROOT.parents[1]                                        # source/
SIMULATION = SOURCE / "robotics" / "simulation"                 # plan 02 checker (forward_kinematics, check_swept_path)
for p in (SIMULATION, ROOT):                                    # ROOT last so our `bridge` package shadows robotics/simulation/bridge
    if str(p) in sys.path:
        sys.path.remove(str(p))
    sys.path.insert(0, str(p))
# robotics/simulation also has a top-level `bridge` package: when both suites share one interpreter (pytest), drop its cached modules so
# `bridge.*` resolves to this package (ROOT is first on sys.path); the simulation tests keep their own references.
for name in [m for m in list(sys.modules) if m == "bridge" or m.startswith("bridge.")]:
    if not str(getattr(sys.modules[name], "__file__", "") or "").startswith(str(ROOT)):
        del sys.modules[name]
MODEL_DIR = ROOT / "models" / "puma560-reference"
