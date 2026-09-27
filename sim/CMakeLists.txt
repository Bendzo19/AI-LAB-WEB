cmake_minimum_required(VERSION 3.20)
project(f1sim VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

option(F1SIM_BUILD_APP "Build the playable SDL3/OpenGL app" ON)
option(F1SIM_BUILD_TESTS "Build unit/regression tests and the benchmark" ON)

if(MSVC)
  set(F1SIM_WARNINGS /W4 /permissive- /wd4244 /wd4267)
else()
  set(F1SIM_WARNINGS -Wall -Wextra -Wpedantic -Wshadow)
endif()

# ---- Physics core: no dependencies, engine-agnostic ------------------------
add_library(f1sim_core STATIC
  core/src/ini.cpp
  core/src/car_params.cpp
  core/src/tyre.cpp
  core/src/track.cpp
  core/src/vehicle.cpp
  core/src/lapsim.cpp
  core/src/ai_driver.cpp
  core/src/timing.cpp
  core/src/ffb.cpp
  core/src/telemetry.cpp
  core/src/session.cpp
  core/src/scenarios.cpp)
target_include_directories(f1sim_core PUBLIC core/include)
target_compile_options(f1sim_core PRIVATE ${F1SIM_WARNINGS})
if(MSVC)
  target_compile_definitions(f1sim_core PUBLIC _USE_MATH_DEFINES _CRT_SECURE_NO_WARNINGS NOMINMAX)
endif()

set(F1SIM_SOURCE_DATA_DIR "${CMAKE_CURRENT_SOURCE_DIR}/data")

# ---- Tests and benchmark -----------------------------------------------------
if(F1SIM_BUILD_TESTS)
  enable_testing()
  add_executable(f1sim_tests tests/test_main.cpp tests/test_tyre.cpp tests/test_track.cpp
                             tests/test_vehicle.cpp tests/test_misc.cpp)
  target_link_libraries(f1sim_tests PRIVATE f1sim_core)
  target_compile_options(f1sim_tests PRIVATE ${F1SIM_WARNINGS})
  target_compile_definitions(f1sim_tests PRIVATE F1SIM_DATA_DIR="${F1SIM_SOURCE_DATA_DIR}")
  add_test(NAME f1sim_tests COMMAND f1sim_tests)

  add_executable(f1sim_bench tools/bench.cpp)
  target_link_libraries(f1sim_bench PRIVATE f1sim_core)
  target_compile_options(f1sim_bench PRIVATE ${F1SIM_WARNINGS})
  target_compile_definitions(f1sim_bench PRIVATE F1SIM_DATA_DIR="${F1SIM_SOURCE_DATA_DIR}")
endif()

# ---- Playable app (SDL3 + OpenGL 3.3) -----------------------------------------
if(F1SIM_BUILD_APP)
  find_package(SDL3 CONFIG QUIET)
  if(NOT SDL3_FOUND)
    message(STATUS "SDL3 not found on the system - fetching SDL 3.2.8 (static)")
    include(FetchContent)
    set(SDL_SHARED OFF CACHE BOOL "" FORCE)
    set(SDL_STATIC ON CACHE BOOL "" FORCE)
    set(SDL_TEST_LIBRARY OFF CACHE BOOL "" FORCE)
    set(SDL_EXAMPLES OFF CACHE BOOL "" FORCE)
    FetchContent_Declare(SDL3
      GIT_REPOSITORY https://github.com/libsdl-org/SDL.git
      GIT_TAG release-3.2.8
      GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(SDL3)
  endif()

  add_executable(f1sim WIN32
    app/main.cpp
    app/gl.cpp
    app/renderer.cpp
    app/model.cpp
    app/hud.cpp
    app/input.cpp
    app/settings.cpp
    app/third_party_impl.cpp)
  target_include_directories(f1sim PRIVATE app third_party/stb third_party/cgltf)
  target_link_libraries(f1sim PRIVATE f1sim_core SDL3::SDL3)
  target_compile_options(f1sim PRIVATE ${F1SIM_WARNINGS})
  target_compile_definitions(f1sim PRIVATE F1SIM_DATA_DIR="${F1SIM_SOURCE_DATA_DIR}")
  if(MINGW)
    target_link_options(f1sim PRIVATE -static -static-libgcc -static-libstdc++)
  endif()
  # Ship the data folder next to the executable so the build is portable.
  add_custom_command(TARGET f1sim POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${F1SIM_SOURCE_DATA_DIR}" "$<TARGET_FILE_DIR:f1sim>/data")
endif()
