#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <memory>
#include <string>

#include "EMAStrategy.h"
#include "ExecutionEngine.h"
#include "Strategy.h"

namespace engine {
int runSelfTest();
}

namespace {

/**
 * The running engine, for the signal handler.
 *
 * A handler may only touch a narrow set of things - it can interrupt the
 * program between any two instructions, so allocating, locking or printing from
 * one risks deadlocking against whatever it interrupted. Setting an atomic flag
 * that the main loop polls is the standard safe move.
 */
engine::ExecutionEngine* g_engine = nullptr;

extern "C" void onSignal(int) {
  if (g_engine != nullptr) g_engine->stop();
}

void printUsage() {
  std::printf(
      "trading_engine - strategy execution engine\n"
      "\n"
      "  --in <endpoint>      inbound PULL   (default tcp://127.0.0.1:5555)\n"
      "  --out <endpoint>     outbound PUSH  (default tcp://127.0.0.1:5556)\n"
      "  --connect            connect instead of bind (Node binds instead)\n"
      "  --fast <n>           fast EMA period (default 9)\n"
      "  --slow <n>           slow EMA period (default 21)\n"
      "  --quiet-holds        do not publish HOLD frames\n"
      "  --verbose            log every candle, not just actionable signals\n"
      "  --self-test          run offline checks and exit\n"
      "  --help\n");
}

/** Reads the value after a flag, or exits with a message naming the flag. */
std::string requireValue(int argc, char** argv, int& i, const char* flag) {
  if (i + 1 >= argc) {
    std::printf("%s requires a value\n", flag);
    std::exit(2);
  }
  return argv[++i];
}

}  // namespace

int main(int argc, char** argv) {
  // Unbuffered stdout. When this process is spawned by Node its output is a
  // pipe, not a console, and C++ switches to full buffering there - so every
  // log line would sit in a 4KB buffer until the buffer filled or the process
  // exited, making a running engine look dead.
  std::setvbuf(stdout, nullptr, _IONBF, 0);

  engine::EngineConfig config;
  int fastPeriod = 9;
  int slowPeriod = 21;

  for (int i = 1; i < argc; ++i) {
    const std::string arg = argv[i];

    if (arg == "--help" || arg == "-h") {
      printUsage();
      return 0;
    }
    if (arg == "--self-test") return engine::runSelfTest();

    if (arg == "--in") config.inboundEndpoint = requireValue(argc, argv, i, "--in");
    else if (arg == "--out") config.outboundEndpoint = requireValue(argc, argv, i, "--out");
    else if (arg == "--connect") config.bind = false;
    else if (arg == "--verbose") config.verbose = true;
    else if (arg == "--quiet-holds") config.publishHolds = false;
    else if (arg == "--fast") fastPeriod = std::atoi(requireValue(argc, argv, i, "--fast").c_str());
    else if (arg == "--slow") slowPeriod = std::atoi(requireValue(argc, argv, i, "--slow").c_str());
    else {
      std::printf("unknown argument: %s\n\n", arg.c_str());
      printUsage();
      return 2;
    }
  }

  try {
    auto strategy = std::make_unique<engine::EMAStrategy>(fastPeriod, slowPeriod);
    engine::ExecutionEngine executionEngine(config, std::move(strategy));

    g_engine = &executionEngine;
    std::signal(SIGINT, onSignal);
    std::signal(SIGTERM, onSignal);

    executionEngine.run();
    executionEngine.printReport();

    g_engine = nullptr;
    return 0;
  } catch (const std::exception& err) {
    // Covers a bad period pair, a port already in use, and a malformed
    // endpoint - all of which are startup mistakes worth failing loudly on.
    std::printf("[engine] fatal: %s\n", err.what());
    return 1;
  }
}
