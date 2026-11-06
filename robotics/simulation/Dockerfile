# Linux simulation environment for the Nav2 + Gazebo Harmonic restaurant scenarios (macOS has no native robot runtime: run this in Docker/VM).
# Build from source/:  docker build -f robotics/simulation/Dockerfile -t mekoniq-sim:jazzy .
# Run all scenarios:   docker run --rm mekoniq-sim:jazzy   (headless; simulation evidence only, not hardware)
FROM ros:jazzy-ros-base@sha256:8eed0a4669bbf43ee331878a4c39bd8ebddea8e3312a58b4fae8edb14526b617
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ros-dev-tools ros-jazzy-navigation2 ros-jazzy-nav2-bringup ros-jazzy-ros-gz-sim ros-jazzy-ros-gz-bridge ros-jazzy-xacro \
      ros-jazzy-robot-state-publisher ros-jazzy-launch-testing-ament-cmake ros-jazzy-ament-lint-auto python3-yaml python3-jsonschema python3-pip \
    && pip install --break-system-packages --no-cache-dir rfc8785 && rm -rf /var/lib/apt/lists/*
WORKDIR /ws
COPY robotics/navigation src/navigation
COPY robotics/description src/description
COPY robotics/simulation src/simulation
COPY robotics/agent src/agent
COPY packages/contracts/schemas contracts
ENV MEKONIQ_CONTRACTS_DIR=/ws/contracts
RUN . /opt/ros/jazzy/setup.sh && colcon build --packages-select mekoniq_description mekoniq_navigation mekoniq_simulation
# Lab v2 SIL worker: `python3 -m bridge.nav2_session --bundle <compiled bundle> --run-id <id> --robots <ns,...> --state-dir <dir>` (see robotics/simulation/bridge).
ENV PYTHONPATH=/ws/src/simulation:/ws/src/agent
CMD ["bash", "-lc", ". /opt/ros/jazzy/setup.sh && . /ws/install/setup.sh && colcon test --packages-select mekoniq_simulation --event-handlers console_direct+ && colcon test-result --verbose"]
