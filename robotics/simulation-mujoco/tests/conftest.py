import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # the tool root, so `mujoco_worker` imports without PYTHONPATH
