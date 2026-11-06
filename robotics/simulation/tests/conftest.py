"""Make the pure-Python simulation modules (compiler, bridge, actors, metrics, collision) and the agent package importable without ROS or a colcon install."""
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE.parents[2] / "agent"))
