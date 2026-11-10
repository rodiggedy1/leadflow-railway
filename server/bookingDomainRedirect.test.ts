import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { BOOKING_HOST, OLD_BOOKING_HOST, registerBookingDomainRedirect } from "./bookingDomainRedirect";

// A catch-all stands in for the SPA fallback (serveStatic) so pass-through is observable.
function appWith(options?: { redirectOldDomain?: boolean }) {
  const app = express();
  registerBookingDomainRedirect(app, options);
  app.use("*", (req, res) => res.status(200).send(`fallthrough ${req.originalUrl}`));
  return app;
}

const untouchedPaths = [
  "/admin",
  "/admin/leads",
  "/api/health",
  "/api/trpc/booking.prepare",
  "/api/stripe/webhook",
  "/api/payable-invoices/stripe-webhook",
  "/assets/index-abc123.js",
  "/book/widget",
  "/book/QF-12345",
  "/book-now",
  "/booking",
  "/cashapp-pay/tok_1",
];

afterEach(() => vi.unstubAllEnvs());

describe("booking domain redirect — book.maidsinblack.com", () => {
  it("301s /book and /book/ to / and keeps the full query string", async () => {
    const app = appWith();
    await request(app).get("/book").set("Host", BOOKING_HOST).expect(301).expect("Location", "/");
    await request(app).get("/book/").set("Host", BOOKING_HOST).expect(301).expect("Location", "/");
    await request(app).get("/book?x=1&utm_source=google").set("Host", BOOKING_HOST).expect(301).expect("Location", "/?x=1&utm_source=google");
    await request(app).get("/book?cashapp_return=abc%2Fdef").set("Host", BOOKING_HOST).expect(301).expect("Location", "/?cashapp_return=abc%2Fdef");
  });

  it("matches the host case-insensitively and ignores a port", async () => {
    await request(appWith()).get("/book?x=1").set("Host", "BOOK.maidsinblack.com:443").expect(301).expect("Location", "/?x=1");
  });

  it("redirects HEAD but never POST", async () => {
    const app = appWith();
    await request(app).head("/book").set("Host", BOOKING_HOST).expect(301).expect("Location", "/");
    await request(app).post("/book").set("Host", BOOKING_HOST).expect(200);
  });

  it("serves / itself through the SPA fallback", async () => {
    await request(appWith()).get("/?x=1").set("Host", BOOKING_HOST).expect(200, "fallthrough /?x=1");
  });

  it.each(untouchedPaths)("never redirects %s", async path => {
    await request(appWith()).get(path).set("Host", BOOKING_HOST).expect(200, `fallthrough ${path}`);
  });
});

describe("booking domain redirect — quote.maidinblack.com", () => {
  it("is off by default when REDIRECT_OLD_BOOKING_DOMAIN is unset", async () => {
    vi.stubEnv("REDIRECT_OLD_BOOKING_DOMAIN", "");
    const app = appWith();
    await request(app).get("/").set("Host", OLD_BOOKING_HOST).expect(200, "fallthrough /");
    await request(app).get("/book?x=1").set("Host", OLD_BOOKING_HOST).expect(200, "fallthrough /book?x=1");
  });

  it("only turns on for the exact value \"true\"", async () => {
    vi.stubEnv("REDIRECT_OLD_BOOKING_DOMAIN", "1");
    await request(appWith()).get("/book").set("Host", OLD_BOOKING_HOST).expect(200);
    vi.stubEnv("REDIRECT_OLD_BOOKING_DOMAIN", "true");
    await request(appWith()).get("/book").set("Host", OLD_BOOKING_HOST).expect(301).expect("Location", `https://${BOOKING_HOST}/`);
  });

  it("when enabled, 301s / and /book to the new domain root with the query string", async () => {
    const app = appWith({ redirectOldDomain: true });
    await request(app).get("/").set("Host", OLD_BOOKING_HOST).expect(301).expect("Location", `https://${BOOKING_HOST}/`);
    await request(app).get("/?gclid=abc").set("Host", OLD_BOOKING_HOST).expect(301).expect("Location", `https://${BOOKING_HOST}/?gclid=abc`);
    await request(app).get("/book?cashapp_return=tok").set("Host", OLD_BOOKING_HOST).expect(301).expect("Location", `https://${BOOKING_HOST}/?cashapp_return=tok`);
    await request(app).get("/book/").set("Host", OLD_BOOKING_HOST).expect(301).expect("Location", `https://${BOOKING_HOST}/`);
  });

  it.each(untouchedPaths)("never redirects %s, even when enabled", async path => {
    await request(appWith({ redirectOldDomain: true })).get(path).set("Host", OLD_BOOKING_HOST).expect(200, `fallthrough ${path}`);
  });

  it("leaves other hosts (e.g. the Railway preview domain) alone, even when enabled", async () => {
    const app = appWith({ redirectOldDomain: true });
    await request(app).get("/").set("Host", "leadflow-preview.up.railway.app").expect(200);
    await request(app).get("/book").set("Host", "leadflow-preview.up.railway.app").expect(200);
  });
});
