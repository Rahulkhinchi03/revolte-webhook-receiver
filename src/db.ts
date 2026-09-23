import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const processedEvents = sqliteTable("processed_events", {
  eventId: text("event_id").primaryKey(),
  receivedAt: text("received_at").notNull(),
  payloadJson: text("payload_json").notNull(),
});

export type EventStore = {
  admit(eventId: string, payloadJson: string): boolean;
};

export function createDatabase(path: string): {
  connection: Database.Database;
  store: EventStore;
} {
  mkdirSync(dirname(path), { recursive: true });
  const connection = new Database(path);
  const db = drizzle(connection);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS processed_events (
      event_id TEXT PRIMARY KEY NOT NULL,
      received_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `);

  return {
    connection,
    store: {
      admit(eventId, payloadJson) {
        const result = db.run(sql`
          INSERT OR IGNORE INTO processed_events (event_id, received_at, payload_json)
          VALUES (${eventId}, ${new Date().toISOString()}, ${payloadJson})
        `);
        return result.changes === 1;
      },
    },
  };
}
