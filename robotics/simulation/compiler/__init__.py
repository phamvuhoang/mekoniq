"""Lab world compiler: one immutable AssetRevision set + project v2 -> Gazebo world, raw occupancy map, Nav2 bindings, per-robot URDF/config,
scene index and a content-hashed manifest. Pure Python (stdlib + rfc8785); runs without ROS. Everything it emits is ILLUSTRATIVE simulation data."""
from .compile_world import CompileError, compile_world  # noqa: F401
