import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { InvoiceError, invoiceExistingSearchSchema, invoiceExistingMarkPaidSchema, type PayableInvoice } from "../shared/payableInvoice";
import { PayableInvoiceService, type InvoiceRepository } from "./payableInvoiceService";
import { registerPayableInvoiceRoutes, INVOICE_API } from "./payableInvoiceRoutes";
import { invoiceExistingReviewHash } from "./payableInvoiceExistingReview";

const ORIGIN = "https://invoice.example.test";
const SECRET = "synthetic-invoice-signing-fixture-only-0123456789";
const ISSUE = "11111111-1111-4111-8111-111111111111";
const MARK = "22222222-2222-4222-8222-222222222222";
const client = { id: 0, name: "Synthetic Client", phone: "+12025550123", email: "fixture@example.test" };
function invoiceFixture(): PayableInvoice {
  return { id: 42, number: "INV-SYNTHETIC-42", clientId: 0, clientName: client.name, from: "2026-10-01", to: "2026-11-07", dueDate: "2026-11-20", currency: "usd", status: "open", activeAttemptId: null, receipts: [], lines: [1, 2, 3].map(id => ({ id, occurrenceKey: `job:${id}`, date: `2026-10-0${id}`, description: "Cleaning", address: "Synthetic property", amountCents: 23000, paidCents: 0, manualPaidCents: 0 })) };
}
function fixture(admin: number | boolean = 17, signing = SECRET) {
  let invoice = invoiceFixture();
  const guard = vi.fn().mockResolvedValue(undefined);
  const stripe = vi.fn(() => { throw new Error("No provider call is permitted"); });
  const repo = {
    lookup: vi.fn(), services: vi.fn(), contactServices: vi.fn(), issue: vi.fn(), byToken: vi.fn(), reserve: vi.fn(), attachSession: vi.fn(), attempt: vi.fn(), settle: vi.fn(),
    adminInvoice: vi.fn(async () => ({ invoice: structuredClone(invoice), client, requestId: ISSUE })),
    listExisting: vi.fn(async () => ({ invoices: [{ id: invoice.id, number: invoice.number, clientName: client.name, from: invoice.from, to: invoice.to, dueDate: invoice.dueDate, status: invoice.status, amountCents: 69000, paidCents: invoice.lines.reduce((sum, line) => sum + line.paidCents, 0), balanceCents: invoice.lines.reduce((sum, line) => sum + line.amountCents - line.paidCents, 0) }], nextBeforeId: null })),
    markInvoicePaid: vi.fn(async (_id: number, input: { lineIds: number[] }) => {
      invoice = { ...invoice, lines: invoice.lines.map(line => input.lineIds.includes(line.id) ? { ...line, paidCents: line.amountCents, manualPaidCents: line.amountCents } : line) };
      invoice.status = invoice.lines.every(line => line.paidCents === line.amountCents) ? "paid" : "partially_paid";
    }),
  };
  const service = new PayableInvoiceService({ repo: repo as InvoiceRepository, stripe, origin: ORIGIN, tokenSecret: signing, assertCollectionReady: guard });
  const send = vi.fn(() => { throw new Error("No email is permitted"); });
  const app = express();
  registerPayableInvoiceRoutes(app, { service, admin: async () => admin, origin: ORIGIN, stripe, paymentsReady: false, send });
  const input = { requestId: MARK, lineIds: [1, 2], reviewHash: invoiceExistingReviewHash(invoice, client), confirmed: true as const };
  return { app, repo, service, stripe, guard, send, input, getInvoice: () => invoice, setInvoice: (next: PayableInvoice) => { invoice = next; } };
}
const base = `${INVOICE_API}/admin/existing`;

describe("saved-invoice local service and HTTP contract", () => {
  it("returns persisted lines and the same issuance-derived customer link, without a Stripe refresh", async () => {
    const f = fixture(); const res = await request(f.app).get(`${base}/42`).expect(200);
    const token = createHmac("sha256", SECRET).update(`invoice:0:${ISSUE}`).digest("hex");
    expect(res.body.url).toBe(`${ORIGIN}/invoice/${token}`); expect(res.body.invoice.number).toBe("INV-SYNTHETIC-42");
    expect(res.body.reviewHash).toBe(f.input.reviewHash); expect(res.body).not.toHaveProperty("requestId");
    expect(res.headers["cache-control"]).toBe("no-store"); expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(f.stripe).not.toHaveBeenCalled(); expect(f.repo.byToken).not.toHaveBeenCalled(); expect(f.guard).not.toHaveBeenCalled();
  });
  it("allows explicit saved-invoice search even when Stripe payments are not configured", async () => {
    const f = fixture(); const res = await request(f.app).post(`${base}/search`).set("Origin", ORIGIN).send({ search: "Synthetic" }).expect(200);
    expect(res.body.invoices).toHaveLength(1); expect(f.repo.listExisting).toHaveBeenCalledWith({ search: "Synthetic" }); expect(f.repo.lookup).not.toHaveBeenCalled(); expect(f.stripe).not.toHaveBeenCalled();
  });
  it("sends only the bounded cursor and search in the JSON body, not customer URL queries", async () => {
    const f = fixture(); await request(f.app).post(`${base}/search`).set("Origin", ORIGIN).send({ search: "fixture@example.test", beforeId: 40 }).expect(200);
    expect(f.repo.listExisting).toHaveBeenCalledWith({ search: "fixture@example.test", beforeId: 40 });
    await request(f.app).post(`${base}/search?email=private`).set("Origin", ORIGIN).send({ search: "" }).expect(400); expect(f.repo.listExisting).toHaveBeenCalledOnce();
  });
  it("updates the selected saved invoice without issuing, charging, sending or rewriting original prices", async () => {
    const f = fixture(); const before = await f.service.existingInvoice(42);
    const res = await request(f.app).post(`${base}/42/mark-paid`).set("Origin", ORIGIN).send(f.input).expect(200);
    expect(f.repo.markInvoicePaid).toHaveBeenCalledWith(42, f.input, 17);
    expect(res.body.url).toBe(before.url); expect(res.body.invoice.id).toBe(42); expect(res.body.invoice.number).toBe(before.invoice.number);
    expect(res.body.invoice.lines.map((line: any) => line.amountCents)).toEqual([23000, 23000, 23000]);
    expect(res.body.invoice.lines.map((line: any) => line.paidCents)).toEqual([23000, 23000, 0]); expect(res.body.invoice.status).toBe("partially_paid");
    expect(res.body.reviewHash).not.toBe(before.reviewHash);
    for (const fn of [f.repo.issue, f.repo.reserve, f.repo.settle, f.repo.lookup, f.repo.services, f.guard, f.stripe, f.send]) expect(fn).not.toHaveBeenCalled();
  });
  it("returns all-paid with intact service prices and the same link", async () => {
    const f = fixture(); const before = await f.service.existingInvoice(42);
    const result = await f.service.markExistingInvoicePaid(42, { ...f.input, lineIds: [1, 2, 3] }, 17);
    expect(result.invoice.status).toBe("paid"); expect(result.invoice.lines.every(line => line.amountCents === 23000 && line.paidCents === 23000)).toBe(true); expect(result.url).toBe(before.url);
  });
  it.each([false, 0])("all saved-invoice operations require active admin identity %#", async admin => {
    const f = fixture(admin); await request(f.app).get(`${base}/42`).expect(403);
    await request(f.app).post(`${base}/search`).set("Origin", ORIGIN).send({ search: "" }).expect(403);
    await request(f.app).post(`${base}/42/mark-paid`).set("Origin", ORIGIN).send(f.input).expect(403);
    expect(f.repo.adminInvoice).not.toHaveBeenCalled(); expect(f.repo.listExisting).not.toHaveBeenCalled(); expect(f.repo.markInvoicePaid).not.toHaveBeenCalled();
  });
  it("does not let a boolean-only admin stub invent a recording agent ID", async () => {
    const f = fixture(true); await request(f.app).post(`${base}/42/mark-paid`).set("Origin", ORIGIN).send(f.input).expect(403); expect(f.repo.markInvoicePaid).not.toHaveBeenCalled();
  });
  it.each([undefined, "https://attacker.example.test"])('rejects missing or foreign POST Origin %s', async origin => {
    const f = fixture(); for (const [path, body] of [[`${base}/search`, { search: "" }], [`${base}/42/mark-paid`, f.input]] as const) {
      const req = request(f.app).post(path); if (origin) req.set("Origin", origin); await req.send(body).expect(403);
    } expect(f.repo.listExisting).not.toHaveBeenCalled(); expect(f.repo.markInvoicePaid).not.toHaveBeenCalled();
  });
  it.each(["0", "-1", "1.5", "42abc", "1e2", "9007199254740992"])("rejects a noncanonical or unsafe invoice ID %s", async id => {
    const f = fixture(); await request(f.app).get(`${base}/${id}`).expect(400); await request(f.app).post(`${base}/${id}/mark-paid`).set("Origin", ORIGIN).send(f.input).expect(400); expect(f.repo.adminInvoice).not.toHaveBeenCalled(); expect(f.repo.markInvoicePaid).not.toHaveBeenCalled();
  });
  it.each([{ lineIds: [] }, { lineIds: [1, 1] }, { lineIds: [0] }, { lineIds: [1.5] }, { lineIds: ["1"] }, { requestId: "not-uuid" }, { reviewHash: "bad" }, { confirmed: false }, { confirmed: undefined }, { amountCents: 1 }, { invoiceId: 99 }, { status: "paid" }])("rejects unconfirmed, malformed and caller-supplied payment facts %#", async patch => {
    const f = fixture(); await request(f.app).post(`${base}/42/mark-paid`).set("Origin", ORIGIN).send({ ...f.input, ...patch }).expect(400); expect(f.repo.markInvoicePaid).not.toHaveBeenCalled();
  });
  it.each([{ search: "x".repeat(321) }, { beforeId: 0 }, { beforeId: 2.5 }, { limit: 10000 }, { status: "paid" }])("rejects search scope expansion %#", async input => {
    const f = fixture(); await request(f.app).post(`${base}/search`).set("Origin", ORIGIN).send(input).expect(400); expect(f.repo.listExisting).not.toHaveBeenCalled();
  });
  it("normalizes defaults and trim through the strict route schemas", async () => {
    const f = fixture(); await request(f.app).post(`${base}/search`).set("Origin", ORIGIN).send({}).expect(200); expect(f.repo.listExisting).toHaveBeenCalledWith({ search: "" });
    expect(invoiceExistingSearchSchema.parse({ search: "  name  " })).toEqual({ search: "name" }); expect(invoiceExistingMarkPaidSchema.safeParse({ ...f.input, lineIds: Array(1001).fill(1) }).success).toBe(false);
  });
  it("does not write when signing is unavailable or the saved invoice cannot be retrieved", async () => {
    const f = fixture(17, "short"); await request(f.app).post(`${base}/42/mark-paid`).set("Origin", ORIGIN).send(f.input).expect(503); expect(f.repo.markInvoicePaid).not.toHaveBeenCalled();
    const g = fixture(); g.repo.adminInvoice.mockRejectedValue(new InvoiceError("NOT_FOUND", 404, "Invoice unavailable.")); await request(g.app).post(`${base}/42/mark-paid`).set("Origin", ORIGIN).send(g.input).expect(404); expect(g.repo.markInvoicePaid).not.toHaveBeenCalled();
  });
  it("keeps rejected atomic writes out of the success response and hides unclassified sensitive errors", async () => {
    const f = fixture(); f.repo.markInvoicePaid.mockRejectedValue(new Error("private SQL fixture@example.test"));
    const res = await request(f.app).post(`${base}/42/mark-paid`).set("Origin", ORIGIN).send(f.input).expect(503);
    expect(JSON.stringify(res.body)).not.toMatch(/private SQL|fixture@example/); expect(res.body.success).toBe(false);
  });
  it.each(["REVIEW_CHANGED", "CHECKOUT_IN_PROGRESS", "BALANCE_CHANGED", "PAYMENT_REVIEW_REQUIRED"])("surfaces the safe repository protection %s without reporting success", async code => {
    const f = fixture(); f.repo.markInvoicePaid.mockRejectedValue(new InvoiceError(code, 409, "Refresh the saved invoice before recording payment."));
    const res = await request(f.app).post(`${base}/42/mark-paid`).set("Origin", ORIGIN).send(f.input).expect(409); expect(res.body.error).toBe(code); expect(res.body.success).toBe(false); expect(f.stripe).not.toHaveBeenCalled();
  });
  it("does not expose admin retrieval via a public token route", async () => {
    const f = fixture(false); await request(f.app).get(`${base}/42`).expect(403); expect(f.repo.adminInvoice).not.toHaveBeenCalled();
  });
});
