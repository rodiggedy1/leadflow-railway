import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type Stripe from "stripe";
import { registerPayableInvoiceRoutes, INVOICE_API } from "./payableInvoiceRoutes";
import { InvoiceError } from "../shared/payableInvoice";
import type { PayableInvoiceService } from "./payableInvoiceService";

const ORIGIN = "https://invoice.example.test";
const TOKEN = "a".repeat(64);
const UUID = "11111111-1111-4111-8111-111111111111";
const LOOKUP = { phone: "+12025550100", email: "example@example.test", from: "2026-11-01", to: "2026-11-07" };
function fixture(isAdmin = true) {
  const fake = { lookup: vi.fn().mockResolvedValue({ client: { id: 1, name: "Example" }, services: [] }), issue: vi.fn().mockResolvedValue({ url: `${ORIGIN}/invoice/${TOKEN}` }), view: vi.fn().mockResolvedValue({ id: 1, lines: [] }), checkout: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_test_invoice" }), resume: vi.fn().mockResolvedValue({ refresh: true }), reconcile: vi.fn().mockResolvedValue(undefined) };
  const refresh = vi.fn(async (token: string) => fake.view(token));
  const constructEvent = vi.fn().mockReturnValue({ type: "checkout.session.completed", data: { object: { id: "cs_test_invoice", metadata: { leadflowInvoice: "leadflow_invoice_v1" } } }, livemode: false });
  const app = express();
  registerPayableInvoiceRoutes(app, { origin: ORIGIN, admin: async () => isAdmin ? 17 : false, service: { ...fake, refresh } as unknown as PayableInvoiceService, stripe: () => ({ webhooks: { constructEvent } }) as unknown as Stripe, webhookSecret: "test-only-signature-secret", paymentsReady: true });
  // A permissive global CORS imitates the old app after this route: it must never bypass invoice protection.
  app.use((_req, res, _next) => res.setHeader("Access-Control-Allow-Origin", "*"));
  return { app, fake, constructEvent };
}
describe("invoice API boundary", () => {
  it("the functioning configured service is payment ready rather than permanently disabled", async () => { const f = fixture(); const r = await request(f.app).get(`${INVOICE_API}/admin/status`).expect(200); expect(r.body.paymentsReady).toBe(true); });
  it("admin status requires an active admin", async () => { const f = fixture(false); await request(f.app).get(`${INVOICE_API}/admin/status`).expect(403); expect(f.fake.lookup).not.toHaveBeenCalled(); });
  it("admin lookup cannot run for unauthenticated callers", async () => { const f = fixture(false); await request(f.app).post(`${INVOICE_API}/admin/lookup`).set("Origin", ORIGIN).send(LOOKUP).expect(403); expect(f.fake.lookup).not.toHaveBeenCalled(); });
  it("rejects an arbitrary cross-site Origin before the global CORS middleware", async () => { const f = fixture(); const r = await request(f.app).post(`${INVOICE_API}/admin/lookup`).set("Origin", "https://attacker.example.test").send(LOOKUP).expect(403); expect(r.headers["access-control-allow-origin"]).toBeUndefined(); expect(f.fake.lookup).not.toHaveBeenCalled(); });
  it("rejects missing POST Origin", async () => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/admin/lookup`).send(LOOKUP).expect(403); expect(f.fake.lookup).not.toHaveBeenCalled(); });
  it("keeps customer contact data out of URL queries", async () => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/admin/lookup?phone=not-allowed`).set("Origin", ORIGIN).send(LOOKUP).expect(400); expect(f.fake.lookup).not.toHaveBeenCalled(); });
  it("returns authenticated exact lookup with no-store", async () => { const f = fixture(); const r = await request(f.app).post(`${INVOICE_API}/admin/lookup`).set("Origin", ORIGIN).send(LOOKUP).expect(200); expect(f.fake.lookup).toHaveBeenCalledWith(LOOKUP.phone, LOOKUP.email, LOOKUP.from, LOOKUP.to); expect(r.headers["cache-control"]).toBe("no-store"); expect(r.headers["referrer-policy"]).toBe("no-referrer"); });
  it.each([{ phone: LOOKUP.phone, from: LOOKUP.from, to: LOOKUP.to }, { email: LOOKUP.email, from: LOOKUP.from, to: LOOKUP.to }, { ...LOOKUP, email: "invalid" }])("accepts phone-only, email-only or valid-phone OR listing input %#", async body => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/admin/lookup`).set("Origin", ORIGIN).send(body).expect(200); expect(f.fake.lookup).toHaveBeenCalledWith("phone" in body ? body.phone : "", "email" in body ? body.email : "", LOOKUP.from, LOOKUP.to); });
  it.each([{ ...LOOKUP, from: "2026-02-30" }, { ...LOOKUP, from: "2026-12-01" }, { ...LOOKUP, phone: "", email: "" }, { ...LOOKUP, unexpected: true }])("rejects malformed client or period input %#", async body => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/admin/lookup`).set("Origin", ORIGIN).send(body).expect(400); expect(f.fake.lookup).not.toHaveBeenCalled(); });
  it("rejects malformed JSON without leaking body content", async () => { const f = fixture(); const r = await request(f.app).post(`${INVOICE_API}/admin/lookup`).set("Origin", ORIGIN).set("Content-Type", "application/json").send('{"broken":').expect(400); expect(r.body.error).toBe("INVALID_BODY"); });
  it("rejects oversized request bodies", async () => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/admin/lookup`).set("Origin", ORIGIN).send({ ...LOOKUP, extra: "x".repeat(300000) }).expect(413); expect(f.fake.lookup).not.toHaveBeenCalled(); });
  it("does not accept a browser-supplied amount for checkout", async () => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/${TOKEN}/checkout`).set("Origin", ORIGIN).send({ requestId: UUID, lineIds: [1], amountCents: 1 }).expect(400); expect(f.fake.checkout).not.toHaveBeenCalled(); });
  it("does not accept an invoice ID for another customer in checkout payload", async () => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/${TOKEN}/checkout`).set("Origin", ORIGIN).send({ requestId: UUID, lineIds: [1], invoiceId: 999 }).expect(400); expect(f.fake.checkout).not.toHaveBeenCalled(); });
  it("passes only token, request UUID and selected lines to checkout", async () => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/${TOKEN}/checkout`).set("Origin", ORIGIN).send({ requestId: UUID, lineIds: [1, 2] }).expect(200); expect(f.fake.checkout).toHaveBeenCalledWith(TOKEN, UUID, [1,2]); });
  it("allows read-only customer view by opaque capability without admin login", async () => { const f = fixture(false); await request(f.app).get(`${INVOICE_API}/${TOKEN}`).expect(200); expect(f.fake.view).toHaveBeenCalledWith(TOKEN); });
  it("resumes only the token's existing payment", async () => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/${TOKEN}/resume`).set("Origin", ORIGIN).send({}).expect(200); expect(f.fake.resume).toHaveBeenCalledWith(TOKEN); expect(f.fake.checkout).not.toHaveBeenCalled(); });
  it("does not leak SQL, contact or provider failures to customer", async () => { const f = fixture(); f.fake.view.mockRejectedValue(new Error("private SQL containing example@example.test")); const r = await request(f.app).get(`${INVOICE_API}/${TOKEN}`).expect(503); expect(JSON.stringify(r.body)).not.toMatch(/private|example@example/); });
  it("shows a useful normalized collection guard error without charging", async () => { const f = fixture(); f.fake.checkout.mockRejectedValue(new InvoiceError("COLLECTION_REVIEW_REQUIRED", 503, "Collection review required.")); const r = await request(f.app).post(`${INVOICE_API}/${TOKEN}/checkout`).set("Origin", ORIGIN).send({ requestId: UUID, lineIds: [1] }).expect(503); expect(r.body.error).toBe("COLLECTION_REVIEW_REQUIRED"); });
});
describe("signed invoice webhook", () => {
  it("requires a Stripe signature before invoking reconciliation", async () => { const f = fixture(); await request(f.app).post(`${INVOICE_API}/stripe-webhook`).send({}).expect(400); expect(f.fake.reconcile).not.toHaveBeenCalled(); });
  it("passes the exact raw bytes to Stripe signature verification", async () => { const f = fixture(); const text = '{ "id" : "evt_test" }'; await request(f.app).post(`${INVOICE_API}/stripe-webhook`).set("stripe-signature", "test-only-signature").set("Content-Type", "application/json").send(text).expect(200); expect(f.constructEvent.mock.calls[0][0].toString()).toBe(text); expect(f.fake.reconcile).toHaveBeenCalledOnce(); });
  it("rejects an invalid signature without settling", async () => { const f = fixture(); f.constructEvent.mockImplementation(() => { throw new Error("invalid"); }); await request(f.app).post(`${INVOICE_API}/stripe-webhook`).set("stripe-signature", "wrong").send({}).expect(400); expect(f.fake.reconcile).not.toHaveBeenCalled(); });
  it("does not acknowledge an uncommitted settlement", async () => { const f = fixture(); f.fake.reconcile.mockRejectedValue(new Error("commit failed")); await request(f.app).post(`${INVOICE_API}/stripe-webhook`).set("stripe-signature", "test-only").send({}).expect(503); });
});
