"""Make the pure-Python simulation modules (compiler, bridge, actors, metrics, collision) and the agent package importable without ROS or a colcon install."""
import os
import sys
from pathlib import Path

# compiler/actors/worlds are a pinned portable closure (lab:irsim refuses bytecode beside it): imports from these tests write none
sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"  # and the interpreters these tests start

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[2] / "agent"))
