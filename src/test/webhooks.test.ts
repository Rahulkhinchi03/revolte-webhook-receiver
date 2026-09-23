import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp, type WebhookEvent } from "../app.js";
import { createDatabase } from "../db.js";

const secret = "test-secret";

function sign(body: string, prefix = false): string {
  const digest = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return prefix ? `sha256=${digest}` : digest;
}

function validBody(id = "evt_123"): string {
  return JSON.stringify({
    id,
    type: "invoice.created",
    created_at: "2026-01-01T12:00:00.000Z",
    data: { amount: 4200 },
  });
}

function setup(handler?: (event: WebhookEvent) => Promise<void> | void) {
  const directory = mkdtempSync(join(tmpdir(), "webhook-receiver-"));
  const database = createDatabase(join(directory, "events.db"));
  const app = createApp({ secret, store: database.store, handler });
  return {
    app,
    close: () => {
      database.connection.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("accepts a valid signature and runs the handler asynchronously", async () => {
  const events: WebhookEvent[] = [];
  const context = setup((event) => {
    events.push(event);
  });
  const body = validBody();

  try {
    const response = await request(context.app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Signature", sign(body, true))
      .send(body);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { accepted: true, duplicate: false });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.length, 1);
  } finally {
    context.close();
  }
});

test("rejects an invalid signature with 401", async () => {
  const context = setup();
  const body = validBody();

  try {
    const response = await request(context.app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Signature", sign(`${body}changed`))
      .send(body);

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: "invalid_signature" });
  } finally {
    context.close();
  }
});

test("rejects a missing signature header with 401", async () => {
  const context = setup();
  const body = validBody();

  try {
    const response = await request(context.app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .send(body);

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: "invalid_signature" });
  } finally {
    context.close();
  }
});

test("does not process duplicate event IDs", async () => {
  const events: WebhookEvent[] = [];
  const context = setup((event) => {
    events.push(event);
  });
  const body = validBody("evt_duplicate");

  try {
    const first = await request(context.app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Signature", sign(body))
      .send(body);
    const second = await request(context.app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Signature", sign(body))
      .send(body);

    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { accepted: true, duplicate: false });
    assert.equal(second.status, 200);
    assert.deepEqual(second.body, { accepted: true, duplicate: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(events.length, 1);
  } finally {
    context.close();
  }
});

test("rejects malformed JSON with 400", async () => {
  const context = setup();
  const body = '{"id":';

  try {
    const response = await request(context.app)
      .post("/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Signature", sign(body))
      .send(body);

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "malformed_payload" });
  } finally {
    context.close();
  }
});
