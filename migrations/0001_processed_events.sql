CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  received_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL
);
