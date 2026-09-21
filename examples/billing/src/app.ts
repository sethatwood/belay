import { Hono } from "hono";
import { billing } from "./routes/billing";

export function createApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));
  app.route("/billing", billing);

  return app;
}

export const app = createApp();
