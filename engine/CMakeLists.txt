cmake_minimum_required(VERSION 3.20)

project(trading_engine
  VERSION 0.1.0
  DESCRIPTION "Low-latency strategy execution engine"
  LANGUAGES CXX
)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Single-config generators default to an unoptimised build, which would make
# every latency number in the benchmark meaningless.
if(NOT CMAKE_CONFIGURATION_TYPES AND NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
foreach(cfg IN ITEMS DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
  set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_${cfg} ${CMAKE_BINARY_DIR}/bin)
endforeach()

# ---------------------------------------------------------------------------
# Dependencies
#
# Fetched at configure time rather than expecting vcpkg/Conan: this machine has
# neither, and pinning tags here makes the build reproducible from a bare
# checkout. Sources land in engine/build/_deps and are cached across builds.
# ---------------------------------------------------------------------------
include(FetchContent)

# libzmq 4.3.5 declares cmake_minimum_required(VERSION 3.0.0); CMake >= 3.31
# refuses anything below 3.5. This floor is what lets it configure anyway.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5 CACHE STRING "" FORCE)

# --- nlohmann/json (header-only) -------------------------------------------
set(JSON_BuildTests OFF CACHE BOOL "" FORCE)
set(JSON_Install OFF CACHE BOOL "" FORCE)
FetchContent_Declare(nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        v3.11.3
  GIT_SHALLOW    TRUE
)

# --- libzmq (static) --------------------------------------------------------
# Static so the engine ships as one .exe with no DLL next to it.
set(BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(BUILD_STATIC ON  CACHE BOOL "" FORCE)
set(BUILD_TESTS  OFF CACHE BOOL "" FORCE)
set(WITH_PERF_TOOL OFF CACHE BOOL "" FORCE)
set(WITH_DOC OFF CACHE BOOL "" FORCE)
set(ENABLE_CPACK OFF CACHE BOOL "" FORCE)
set(ENABLE_CURVE OFF CACHE BOOL "" FORCE)
set(ENABLE_DRAFTS OFF CACHE BOOL "" FORCE)
set(ZMQ_BUILD_TESTS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(libzmq
  GIT_REPOSITORY https://github.com/zeromq/libzmq.git
  GIT_TAG        v4.3.5
  GIT_SHALLOW    TRUE
)

# --- cppzmq (header-only C++ binding) --------------------------------------
# SOURCE_SUBDIR points at a directory that does not exist on purpose: it makes
# FetchContent download the repo WITHOUT running its CMakeLists, which would
# otherwise go looking for an installed ZeroMQ package and fail.
FetchContent_Declare(cppzmq
  GIT_REPOSITORY https://github.com/zeromq/cppzmq.git
  GIT_TAG        v4.10.0
  GIT_SHALLOW    TRUE
  SOURCE_SUBDIR  no-cmake-here
)

FetchContent_MakeAvailable(nlohmann_json libzmq cppzmq)

# ---------------------------------------------------------------------------
# Target
# ---------------------------------------------------------------------------
add_executable(trading_engine
  src/main.cpp
  src/types.cpp
  src/selftest.cpp
  src/ExecutionEngine.cpp
)

target_include_directories(trading_engine PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${cppzmq_SOURCE_DIR}
)

target_link_libraries(trading_engine PRIVATE
  libzmq-static
  nlohmann_json::nlohmann_json
)

# Tells zmq.h to declare symbols as static rather than dllimport.
target_compile_definitions(trading_engine PRIVATE ZMQ_STATIC)

if(MSVC)
  target_compile_options(trading_engine PRIVATE /W4 /permissive- /utf-8)
  target_compile_definitions(trading_engine PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX WIN32_LEAN_AND_MEAN)
  # Pulled in by libzmq's static build on Windows.
  target_link_libraries(trading_engine PRIVATE ws2_32 iphlpapi rpcrt4)
else()
  target_compile_options(trading_engine PRIVATE -Wall -Wextra -Wpedantic)
  find_package(Threads REQUIRED)
  target_link_libraries(trading_engine PRIVATE Threads::Threads)
endif()
