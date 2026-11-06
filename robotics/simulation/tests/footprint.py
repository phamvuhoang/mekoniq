"""Pure geometry for the Gazebo scenarios (no ROS): footprint clearance between oriented rectangles. Lives in metrics/separation.py; re-exported here."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from metrics.separation import corners, footprint_gap  # noqa: E402,F401
