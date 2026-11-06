cmake_minimum_required(VERSION 3.8)
project(mekoniq_simulation)
find_package(ament_cmake REQUIRED)
install(DIRECTORY worlds launch bridge compiler DESTINATION share/${PROJECT_NAME})
if(BUILD_TESTING)
  find_package(ament_cmake_pytest REQUIRED)
  # Skips (with an explicit message) when rclpy/gz are unavailable; the agent package is imported from ../agent by the test itself.
  ament_add_pytest_test(restaurant_scenarios tests/test_restaurant.py TIMEOUT 1800 WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})
  # Pure-Python tooling (world compiler, worker protocol/bridge): no ROS needed, runs everywhere.
  ament_add_pytest_test(simulation_tooling tests/test_world_compiler.py tests/test_nav2_session.py tests/test_clock_barrier.py tests/test_dynamic_scene.py tests/test_two_robots.py tests/test_arm_swept_path.py tests/test_cup_transfer.py tests/test_beverage_cell.py TIMEOUT 300 WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR})
endif()
ament_package()
