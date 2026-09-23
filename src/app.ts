import crypto from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import type { Database } from "better-sqlite3";
import { createDatabase, type EventStore } from "./db.js";

const eventSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.string().trim().min(1),
    created_at: z.string().datetime({ offset: true }),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();

export type WebhookEvent = z.infer<typeof eventSchema>;
export type EventHandler = (event: WebhookEvent) => Promise<void> | void;

type RawBodyRequest = Request & { rawBody?: Buffer };

function signatureCandidates(signature: string): string[] {
  const normalized = signature.trim();
  return normalized.startsWith("sha256=")
    ? [normalized.slice("sha256=".length)]
    : [normalized];
}

export function isValidSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return signatureCandidates(signature).some((candidate) => {
    const actual = Buffer.from(candidate, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");

    return (
      actual.length === expectedBuffer.length &&
      crypto.timingSafeEqual(actual, expectedBuffer)
    );
  });
}

export function createApp(options: {
  secret: string;
  store: EventStore;
  handler?: EventHandler;
}): express.Express {
  const app = express();
  const handler =
    options.handler ??
    ((event: WebhookEvent) => {
      console.info("Processed webhook event", {
        id: event.id,
        type: event.type,
      });
    });

  app.use(
    express.json({
      verify: (request, _response, buffer) => {
        (request as RawBodyRequest).rawBody = Buffer.from(buffer);
      },
    }),
  );

  app.post("/webhooks", (request: RawBodyRequest, response) => {
    if (
      !isValidSignature(
        request.rawBody ?? Buffer.alloc(0),
        request.get("X-Signature"),
        options.secret,
      )
    ) {
      response.status(401).json({ error: "invalid_signature" });
      return;
    }

    const parsed = eventSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ error: "malformed_payload" });
      return;
    }

    let admitted: boolean;
    try {
      admitted = options.store.admit(
        parsed.data.id,
        JSON.stringify(parsed.data),
      );
    } catch (error) {
      console.error("Failed to admit webhook event", error);
      response.status(500).json({ error: "internal_error" });
      return;
    }

    response.status(200).json({ accepted: true, duplicate: !admitted });

    if (admitted) {
      Promise.resolve(handler(parsed.data)).catch((error: unknown) => {
        console.error("Webhook event handler failed", {
          eventId: parsed.data.id,
          error,
        });
      });
    }
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (error instanceof SyntaxError && "body" in error) {
        response.status(400).json({ error: "malformed_payload" });
        return;
      }

      next(error);
    },
  );

  app.use(
    (
      _error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      response.status(500).json({ error: "internal_error" });
    },
  );

  return app;
}

export function createConfiguredApp(): {
  app: express.Express;
  database: Database;
} {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("WEBHOOK_SECRET is required");
  }

  const database = createDatabase(
    process.env.DATABASE_PATH ?? "./data/webhooks.db",
  );
  return {
    app: createApp({ secret, store: database.store }),
    database: database.connection,
  };
}
