# Client — Live Candlestick Chart

React + Vite + lightweight-charts. Two data paths into one chart:

```
mount ──> GET /api/candles?limit=200 ──> series.setData(...)   (once)
      └─> ws://localhost:8080 ────────> series.update(...)     (per closed candle)
```

The chart instance is created once and driven through a ref handle, so a live
candle costs **zero React re-renders** — `update()` touches only the last bar,
where `setData()` would rebuild all 200 points and reset the user's pan/zoom.

## Layout

```
src/
├── main.jsx  App.jsx  index.css
├── components/   CandleChart.jsx (imperative handle)  ConnectionStatus.jsx
├── hooks/        useCandleHistory.js  useCandleStream.js
├── constants/    api.js  websocket.js  chart.js
└── utils/        grouped by consumer
    ├── api/candles.js       fetch + error shape
    ├── stream/message.js    frame parsing/guards
    ├── stream/backoff.js    reconnect timing
    └── chart/candle.js      API candle -> chart point (ms->s, string->number)
```

## Run

Backend must be running first (`cd ../server && npm start`).

```bash
npm run dev      # http://localhost:5173
```

Override endpoints with `.env` if needed — see `.env.example`.
