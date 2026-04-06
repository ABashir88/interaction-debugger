# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # Run server with node
npm run dev      # Run server with nodemon (auto-restart on changes)
npx prettier --write server.js   # Format code (2-space indent, no tabs)
```

Server runs on port 3000.

## Architecture

Single-file Express server (`server.js`) with an in-memory event store. **All data resets on server restart** — there is no database or persistence layer.

### Data model

Events are plain objects pushed into the `events` array. Required fields: `interaction_id`, `type`, `timestamp`. Optional: `status`, `source`, `step`.

### API

| Method | Path | Purpose |
|--------|------|---------|
| `POST /events` | Ingest one event | validates required fields, pushes to in-memory array |
| `GET /interactions/:interaction_id` | Retrieve timeline + debug analysis | filters events by ID, sorts by timestamp, runs failure detection |
| `GET /` | Health check | |

### Failure detection (`detectFailures`)

Four rules applied to a sorted timeline:
1. **explicit_failure** — event has `status === "failure"`
2. **error_event** — event `type` contains the string `"error"`
3. **missing_expected_event** — `ivr_start` present but no `ivr_end`
4. **large_time_gap** — gap > 30,000 ms between consecutive events

`generateExplanation` converts the first detected failure (plus context from adjacent timeline events) into a human-readable string. `formatEventLabel` builds the label shown in that string from `event.step` and/or `event.source`.
