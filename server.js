// ==============================
// 1. Imports
// Load Express framework
// ==============================
const express = require("express");

// ==============================
// 2. App setup
// Create the Express app
// Configure middleware
// ==============================
const app = express();

app.use(express.json());

// ==============================
// 3. Storage
// Temporary in-memory event store
// This resets whenever the server restarts
// ==============================
const events = [];

// ==============================
// 4. Timeline helper functions
// Logic used to fetch and order events
// for a single interaction
// ==============================

// Helper: get all events for one interaction
function getEventsByInteractionId(interactionId) {
  return events.filter((event) => event.interaction_id === interactionId);
}

// Helper: sort events by timestamp
function sortEventsByTimestamp(eventsList) {
  return [...eventsList].sort((a, b) => {
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
}
// ==============================
// 5. Routes
// API endpoints for ingesting events
// and retrieving interaction timelines
// ==============================

// POST /events
// Ingest one event into memory
app.post("/events", (req, res) => {
  const event = req.body;

  if (!event.interaction_id || !event.type || !event.timestamp) {
    return res.status(400).json({
      error: "Missing required fields: interaction_id, type, timestamp",
    });
  }

  events.push(event);

  console.log("[EVENT RECEIVED]", event);
  console.log("[TOTAL EVENTS]", events.length);

  res.json({
    message: "Event received",
    total_events: events.length,
  });
});
// ==============================
// 5. Debugging helper functions
// Logic used to detect failures
// and generate explanations
// ==============================

function formatEventLabel(event) {
  if (!event) {
    return "unknown step";
  }

  if (event.step && event.source) {
    return `${event.step} in the ${event.source.toUpperCase()} layer`;
  }

  if (event.step) {
    return event.step;
  }

  if (event.type && event.source) {
    return `${event.type} in the ${event.source.toUpperCase()} layer`;
  }

  if (event.type) {
    return event.type;
  }

  return "unknown step";
}

// Detect failures in a timeline
function detectFailures(timeline) {
  const failures = [];

  if (!timeline || timeline.length === 0) {
    return failures;
  }

  // Rule 1: explicit failure status
  timeline.forEach((event) => {
    if (event.status === "failure") {
      failures.push({
        type: "explicit_failure",
        event_type: event.type,
        timestamp: event.timestamp,
        source: event.source || null,
        step: event.step || null,
        reason: `Event marked as failure: ${event.type}`,
      });
    }
  });

  // Rule 2: event type contains "error"
  timeline.forEach((event) => {
    if (
      typeof event.type === "string" &&
      event.type.toLowerCase().includes("error")
    ) {
      failures.push({
        type: "error_event",
        event_type: event.type,
        timestamp: event.timestamp,
        source: event.source || null,
        step: event.step || null,
        reason: `Error event detected: ${event.type}`,
      });
    }
  });

  // Rule 3: missing expected end event (ivr_start without ivr_end)
  const hasStart = timeline.some((e) => e.type === "ivr_start");
  const hasEnd = timeline.some((e) => e.type === "ivr_end");

  if (hasStart && !hasEnd) {
    failures.push({
      type: "missing_expected_event",
      event_type: "ivr_end",
      timestamp: null,
      source: "ivr",
      step: null,
      reason: "Interaction started but never ended (missing ivr_end)",
    });
  }

  // Rule 4: large time gaps
  const GAP_THRESHOLD_MS = 30000; // 30 seconds

  for (let i = 1; i < timeline.length; i++) {
    const prev = timeline[i - 1];
    const curr = timeline[i];

    const gap =
      new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();

    if (gap > GAP_THRESHOLD_MS) {
      failures.push({
        type: "large_time_gap",
        event_type: curr.type,
        timestamp: curr.timestamp,
        gap_ms: gap,
        reason: `Large delay between events: ${gap} ms`,
      });
    }
  }

  return failures;
}

function generateExplanation(timeline, failures) {
  if (!timeline || timeline.length === 0) {
    return "No events found for this interaction.";
  }

  if (!failures || failures.length === 0) {
    const firstEvent = timeline[0];
    const lastEvent = timeline[timeline.length - 1];

    return `The interaction started at ${formatEventLabel(firstEvent)} and completed at ${formatEventLabel(lastEvent)} without any detected issues.`;
  }

  const firstEvent = timeline[0];
  const firstFailure = failures[0];

  let relatedEvent = null;
  let previousEvent = null;

  if (firstFailure.timestamp) {
    const failureIndex = timeline.findIndex(
      (event) => event.timestamp === firstFailure.timestamp
    );

    if (failureIndex !== -1) {
      relatedEvent = timeline[failureIndex];
      if (failureIndex > 0) {
        previousEvent = timeline[failureIndex - 1];
      }
    }
  }

  const startLabel = formatEventLabel(firstEvent);
  const previousLabel = formatEventLabel(previousEvent);
  const failureLabel = formatEventLabel(relatedEvent);

  if (firstFailure.type === "explicit_failure") {
    if (previousEvent && relatedEvent) {
      return `The interaction started at ${startLabel}, progressed through ${previousLabel}, and then failed at ${failureLabel}.`;
    }

    if (relatedEvent) {
      return `The interaction started at ${startLabel} and failed at ${failureLabel}.`;
    }

    return `The interaction started at ${startLabel} and encountered a failure.`;
  }

  if (firstFailure.type === "error_event") {
    if (previousEvent && relatedEvent) {
      return `The interaction started at ${startLabel}, reached ${previousLabel}, and then hit an error at ${failureLabel}.`;
    }

    if (relatedEvent) {
      return `The interaction started at ${startLabel} and hit an error at ${failureLabel}.`;
    }

    return `The interaction started at ${startLabel} and encountered an error.`;
  }

  if (firstFailure.type === "missing_expected_event") {
    const lastEvent = timeline[timeline.length - 1];
    const lastLabel = formatEventLabel(lastEvent);

    return `The interaction started at ${startLabel} but never reached an end event. The last recorded step was ${lastLabel}, so the interaction appears incomplete.`;
  }

  if (firstFailure.type === "large_time_gap") {
    const seconds = Math.round(firstFailure.gap_ms / 1000);

    if (previousEvent && relatedEvent) {
      return `The interaction started at ${startLabel}, then a ${seconds} second delay occurred between ${previousLabel} and ${failureLabel}, which may indicate a backend or routing issue.`;
    }

    return `The interaction started at ${startLabel} and experienced a ${seconds} second delay between steps, which may indicate a backend or routing issue.`;
  }

  return `The interaction started at ${startLabel} and experienced one or more issues that require investigation.`;
}

// GET /interactions/:interaction_id
// Return ordered timeline for one interaction
app.get("/interactions/:interaction_id", (req, res) => {
  const { interaction_id } = req.params;

  const interactionEvents = getEventsByInteractionId(interaction_id);

  if (interactionEvents.length === 0) {
    return res.status(404).json({
      error: `No events found for interaction_id: ${interaction_id}`,
    });
  }

  const timeline = sortEventsByTimestamp(interactionEvents);

// NEW: debugging layer
const failures = detectFailures(timeline);
const explanation = generateExplanation(timeline, failures);

res.json({
  interaction_id,
  total_events: timeline.length,
  failure_detected: failures.length > 0,
  failures,
  explanation,
  timeline,
});
});

// Health check
// Quick endpoint to confirm server is running
app.get("/", (req, res) => {
  res.send("Interaction Debugger running");
});

// ==============================
// 6. Server start
// Start listening for HTTP requests
// ==============================
app.listen(3000, () => {
  console.log("[SERVER] running on port 3000");
});
