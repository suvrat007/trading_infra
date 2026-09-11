# trading_engine

A C++ strategy execution engine that runs beside the Node server and talks to it
over ZeroMQ. Node keeps ingestion, indicators, persistence, REST and the browser
WebSocket; this process does one thing — turn a candle plus its indicators into
a BUY, SELL or HOLD.

```
ingest ──> indicators ──┬──> JS strategy ──> PaperBroker
                        │
                        └──> bridge ──zmq:5555──> trading_engine
                                                       │
                             PaperBroker <──zmq:5556───┘
```

## Build

Needs Visual Studio Build Tools with the C++ workload. CMake and Ninja ship
inside it, so nothing else has to be installed — `build.ps1` finds them with
`vswhere`.

```powershell
cd engine
.\build.ps1              # Release by default; -Config Debug, -Clean
```

Dependencies are fetched and pinned at configure time (`FetchContent`), not
expected from a package manager:

| | version | why |
|---|---|---|
| nlohmann/json | 3.11.3 | header-only JSON |
| libzmq | 4.3.5 | built static, so the binary ships alone |
| cppzmq | 4.10.0 | header-only C++ binding |

The first configure downloads and compiles libzmq (~90 s). After that it is
cached in `engine/build/_deps`.

## Run

```powershell
.\build\bin\trading_engine.exe --help
.\build\bin\trading_engine.exe --self-test     # 28 offline assertions
.\build\bin\trading_engine.exe --verbose       # log every candle, not just signals
```

Normally you do not start it yourself — the Node bridge spawns it.

## Wiring it into Node

One environment variable decides which engine trades. Exactly one ever does.

| `EXECUTION_MODE` | JavaScript strategy | C++ engine |
|---|---|---|
| `node` *(default)* | trades | not started |
| `shadow` | trades | runs, compared candle by candle, cannot trade |
| `cpp` | decides only | trades |

```powershell
cd server
$env:EXECUTION_MODE = "shadow"; npm start
```

`node` is the default deliberately: an engine that fails to build, or a machine
without the toolchain, must not stop the system from trading. In `shadow` the
two engines are checked against each other on every candle and a disagreement is
logged as `DIVERGENCE`.

Other variables: `ENGINE_PUSH`, `ENGINE_PULL`, `ENGINE_BINARY`,
`ENGINE_AUTOSTART=false` (attach to an engine you started yourself),
`ENGINE_FAST_PERIOD`, `ENGINE_SLOW_PERIOD`.

## Benchmark

```powershell
cd server
$env:EXECUTION_MODE = "shadow"; node scripts/benchmark-engines.mjs 1000
```

1,000 synthetic candles, first 50 discarded as warmup, both paths running the
same EMA 9/21 crossover over the same data. The run fails if the two engines
ever disagree — comparing the latency of two implementations that compute
different things measures nothing.

**Agreement: 1000/1000 candles, 0 divergences.**

### The strategy call alone — nanoseconds

The work Phase 5 set out to move into C++.

| | n | min | p50 | p95 | p99 | max | mean |
|---|---|---|---|---|---|---|---|
| `js onCandle` | 950 | 600 | **700** | 1100 | 2500 | 5100 | 790.8 |
| `c++ onCandle` | 950 | 200 | **300** | 800 | 1000 | 1500 | 338.5 |

**C++ is 2.3x faster**, and far tighter at the tail — 1,500 ns worst case
against 5,100 ns. That tail is the more interesting half: JavaScript's worst
case is garbage collection, which C++ does not have.

### Everything the engine does — microseconds

Parse JSON, decide, serialise JSON. The same span on both sides.

| | n | min | p50 | p95 | p99 | max | mean |
|---|---|---|---|---|---|---|---|
| `js parse+run+ser` | 950 | 4 | **5** | 7 | 11 | 106 | 5.3 |
| `c++ in->out` | 950 | 11 | **13** | 30 | 36 | 163 | 15.7 |
| `node->c++->node` | 950 | 107 | **136** | 325 | 695 | 1297 | 176.7 |

**C++ is 2.6x SLOWER over this span**, and the round trip is **27x slower** than
staying in JavaScript.

### Reading that honestly

The strategy got 2.3x faster and the system got 27x slower. Both are true, and
the second one is what the system actually pays.

**Why C++ loses on the wider span.** The 13 µs is almost entirely JSON.
`nlohmann/json` is a convenience-first library that builds a full DOM of
`std::string` and `std::map` nodes; V8's `JSON.parse` is hand-tuned native code
that has had enormous effort spent on it. Writing C++ does not automatically
beat JavaScript — it beats it where the work is arithmetic and branches, and
loses where the work is a library someone else optimised harder.

**Why the round trip costs 123 µs.** Serialise, write to a loopback TCP socket,
context switch, ZeroMQ framing, the kernel, the engine's read, then all of it
again in reverse. That is the price of a process boundary, and no amount of
optimising the strategy touches it.

**Both are irrelevant here.** One 1-minute candle gives a 60,000,000 µs budget:

| path | p50 | share of budget |
|---|---|---|
| JavaScript, in process | 5 µs | 0.000008% |
| C++ over ZeroMQ | 136 µs | 0.000227% |

Going from 0.000008% to 0.000227% of the budget is not a regression anyone can
observe. Latency was never the constraint at this candle rate.

### When this architecture would actually pay

The 123 µs of IPC is a **fixed cost per message**, while the C++ advantage is
**per unit of work**. So the trade flips as the work grows:

- **Per-tick strategies**, thousands of messages a second, where JavaScript's GC
  pauses land in the tail instead of the mean.
- **Expensive strategies** — a large order book, an optimiser, a model — where
  the compute dwarfs 123 µs.
- **Batching**, sending many candles per message, which amortises IPC.
- **Shared memory instead of TCP**, which removes most of the 123 µs.

The honest conclusion is that Phase 5 built the *mechanism* — a proven,
swappable, measured seam between two languages — and demonstrated that at one
candle per minute it does not pay for itself yet. Knowing that with numbers is
the point.

### Methodology

Things that would have made these numbers wrong:

- **Cross-process wall clocks.** The first version subtracted a Node timestamp
  from a C++ `system_clock` timestamp and reported round trips of **−350 µs**.
  Node builds wall time from `performance.timeOrigin` (captured once at start)
  plus a monotonic counter, and that drifts against the system clock C++ reads;
  at microsecond resolution the drift exceeded the measurement. Every round trip
  is now timed on **one clock**, stamped before `push.send` and read on arrival.
- **Microseconds for the strategy call.** A crossover check is two lookups and a
  comparison; in microseconds it reads 0 or 1. Both sides now report nanoseconds
  — `std::chrono::steady_clock` in C++, `process.hrtime.bigint()` in Node.
- **No warmup.** The first frame measured 100 µs against 14 µs after it: cold
  instruction cache, first allocations, and on the JS side V8 still interpreting
  before it compiles. The first 50 candles are discarded on both paths.
- **Averages.** A mean of 40 µs can be 40 µs every time or 20 µs with one 12 ms
  stall, and only the second is a bug. Percentiles throughout.
- **Different work.** The JS "engine equivalent" span deliberately includes JSON
  parse and serialise, because the C++ number does.

## Layout

| file | what |
|---|---|
| `src/types.h` / `.cpp` | `Candle`, `Indicators`, `TradeSignal`, JSON in/out |
| `src/Strategy.h` | abstract base, `CrossTracker` |
| `src/EMAStrategy.h` | the crossover port |
| `src/ExecutionEngine.h` / `.cpp` | sockets, loop, latency stats |
| `src/main.cpp` | arguments, signal handling |
| `src/selftest.cpp` | 28 offline assertions |
| `CMakeLists.txt` | dependencies, target |
| `build.ps1` | locates the toolchain, configures, builds |

On the Node side: `server/src/engineBridge.js`, `server/src/constants/engine.js`,
`server/src/utils/engine/`, and the scripts in `server/scripts/`.

## Known gaps

- Only EMA is ported. RSI and MACD still exist solely in JavaScript, so `cpp`
  mode can only run a crossover.
- Crossover state is not persisted; restarting the engine forgets which side the
  lines were on, and the first candle after a restart cannot produce a signal.
- A stalled consumer blocks the send for the full 1 s timeout, throttling candle
  intake meanwhile. The failure is loud rather than silent, which was the
  intent, but a sender thread would avoid it.
- No authentication on either port. They bind to loopback only — unlike the
  browser WebSocket, this port would let anyone inject trade signals.
