import "dotenv/config";
import { createConfiguredApp } from "./app.js";

const port = Number(process.env.PORT ?? 4173);
const { app, database } = createConfiguredApp();

const server = app.listen(port, "0.0.0.0", () => {
  console.info(`Webhook receiver listening on port ${port}`);
});

function shutdown(): void {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
