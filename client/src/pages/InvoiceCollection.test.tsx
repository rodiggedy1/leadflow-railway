import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { invoiceBalance, invoiceIssueSchema, invoiceMarkPaidSchema, selectedBalance, type InvoiceClient, type InvoiceService, type PayableInvoice } from "../../../shared/payableInvoice";
import { PayableInvoiceService, type InvoiceRepository } from "../../../server/payableInvoiceService";
import { invoiceReviewHash } from "../../../server/payableInvoiceReview";

// Small isolated hook harness: handlers and state transitions run without a browser,
// server, DOM dependency, or network. Only these two page components are invoked.
const hooks = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[], dependencies: [] as any[][], effectCursor: 0 }));
vi.mock("react", async importOriginal => ({ ...(await importOriginal<any>()),
  useState: (initial: any) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial; return [hooks.slots[index], (value: any) => { hooks.slots[index] = typeof value === "function" ? value(hooks.slots[index]) : value; }]; },
  useRef: (initial: any) => { const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index]; },
  useEffect: (effect: () => any, deps: any[]) => { const index = hooks.effectCursor++; if (!hooks.dependencies[index] || deps.some((value, i) => value !== hooks.dependencies[index][i])) { hooks.dependencies[index] = deps; hooks.effects.push(() => { hooks.cleanups[index]?.(); const cleanup = effect(); if (cleanup) hooks.cleanups[index] = cleanup; }); } },
}));
import { CustomerInvoicePage, InvoiceCollectionPage, invoiceStatusLabel, isInvoicePayable, linePaymentLabel, sampleInvoice, serviceBalance } from "./InvoiceCollection";

const fetchMock = vi.fn();
let tree: ReactElement<any>;
let page: () => ReactElement<any>;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const render = () => { hooks.cursor = 0; hooks.effectCursor = 0; tree = page(); hooks.effects.splice(0).forEach(effect => effect()); return tree; };
const descendants = (node: any): ReactElement<any>[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
const elements = (node: any = tree) => descendants(node);
const text = (node: any): string => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const find = (type: string, label: string) => elements().find(node => node.type === type && text(node).includes(label))!;
const button = (label: string) => find("button", label);
const checkbox = (label: string) => elements(find("label", label)).find(node => node.type === "input")!;
const field = (label: string) => checkbox(label);
const change = (label: string, value: string) => { field(label).props.onChange({ target: { value } }); render(); };
const confirm = (label: string, checked = true) => { checkbox(label).props.onChange({ target: { checked } }); render(); };
const response = (data: unknown, ok = true) => Promise.resolve({ ok, json: async () => data });
type LookupFixture = { client: InvoiceClient; reviewHash: string; services: InvoiceService[] };
const lookup: LookupFixture = { client: { id: 42, name: "Verified Client", email: "verified@example.test", phone: "+12025550102" }, reviewHash: "a".repeat(64), services: sampleInvoice.lines.map((row, index) => ({ ...row, id: `service-${index}`, eligible: true, reason: null, status: "Reviewed", paymentSource: index === 0 ? "manual" : null })) };
const issueResult = { invoice: { ...sampleInvoice, id: 77 }, url: "/invoice/pay/test-token" };
const startAdmin = async (source = lookup, paymentsReady = true) => { page = () => InvoiceCollectionPage({}); fetchMock.mockImplementation(() => response({ paymentsReady, message: paymentsReady ? "" : "Secure payments unavailable." })); render(); await flush(); render(); change("Client phone", lookup.client.phone); change("Billing email", lookup.client.email!); change("From service date", "2026-07-22"); change("To service date", "2026-11-07"); fetchMock.mockImplementation(() => response(source)); await button("Pull bookings").props.onClick(); render(); };
const serviceInputs = () => elements().filter(node => node.type === "input" && node.props["aria-label"]?.startsWith("Mark "));
const serviceInput = (index: number) => serviceInputs()[index];
const toggleService = (index: number) => { serviceInput(index).props.onChange(); render(); };
const selectedServiceInputs = () => serviceInputs().filter(node => node.props.checked);
const summary = (label: string) => text(elements().find(node => node.props?.className === "ic-summary-line" && text(node).startsWith(label)));
const expectSummary = (total: string, paid: string, remaining: string, unpaid: number) => {
  expect(summary("Service total")).toBe(`Service total${total}`);
  expect(summary("Already paid")).toBe(`Already paid${paid}`);
  const grandTotal = elements().find(node => node.props?.className === "ic-grand-total")!;
  expect(text(elements(grandTotal).find(node => node.type === "span"))).toBe("Remaining balance");
  expect(text(elements(grandTotal).find(node => node.type === "b"))).toBe(remaining);
  expect(summary("Unpaid services")).toBe(`Unpaid services${unpaid}`);
  expect(summary("Selected services")).toBe("");
  expect(summary("Selected balance to invoice")).toBe("");
};
const syntheticLookup = (): LookupFixture => ({ ...lookup, services: Array.from({ length: 12 }, (_, index) => ({ ...lookup.services[1], id: `synthetic-${index}`, occurrenceKey: `synthetic-${index}`, date: `2026-10-${String(index + 1).padStart(2, "0")}`, amountCents: index < 10 ? 18800 : index === 10 ? 17000 : 23000, paidCents: 0 })) });
const markResponse = (source: LookupFixture, ids: string[]): LookupFixture => ({ ...source, reviewHash: "e".repeat(64), services: source.services.map(row => ids.includes(row.id) ? { ...row, paidCents: row.amountCents, paymentSource: "manual" } : row) });
const preexistingPaidLookup = () => { const source = syntheticLookup(); return markResponse(source, source.services.slice(0, 10).map(row => row.id)); };
const lastPayload = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
const createInvoice = async () => { fetchMock.mockImplementation(() => response(issueResult)); await button("Create invoice page").props.onClick(); render(); return lastPayload(); };
const resetHarness = () => { hooks.cleanups.forEach(cleanup => cleanup()); hooks.slots = []; hooks.cursor = 0; hooks.effectCursor = 0; hooks.effects = []; hooks.cleanups = []; hooks.dependencies = []; };
const deferredResponse = () => { let resolve!: (value: any) => void; fetchMock.mockImplementation(() => new Promise(value => { resolve = value; })); return (data: unknown, ok = true) => resolve({ ok, json: async () => data }); };
const expectOnlyAdminCalls = (...paths: string[]) => {
  expect(fetchMock.mock.calls.map(call => call[0])).toEqual(paths.map(path => `/api/payable-invoices/admin/${path}`));
  expect(window.location.assign).not.toHaveBeenCalled();
};

const serviceRow = (index: number) => elements().filter(node => node.type === "label" && node.props.className?.includes("ic-service-row"))[index];
const rowPrice = (index: number) => elements(serviceRow(index)).find(node => node.props?.className === "ic-row-price")!;
const expectRowPrice = (index: number, amount: string, label: string | RegExp) => {
  expect(text(elements(rowPrice(index)).find(node => node.type === "b"))).toBe(amount);
  const actualLabel = text(elements(rowPrice(index)).find(node => node.type === "small"));
  if (typeof label === "string") expect(actualLabel).toBe(label); else expect(actualLabel).toMatch(label);
};

beforeEach(() => { hooks.slots = []; hooks.cursor = 0; hooks.effectCursor = 0; hooks.effects = []; hooks.cleanups = []; hooks.dependencies = []; fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("window", { location: { pathname: "/invoice/pay/token", origin: "https://local.example.test", assign: vi.fn() } }); vi.stubGlobal("document", { querySelector: () => null, createElement: () => ({ remove: vi.fn() }), head: { appendChild: vi.fn() } }); vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } }); });
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });

describe("local invoice builder", () => {
  it("pulls and lists jobs with phone only, without requiring an email", async () => {
    await startAdmin(); change("Billing email", "");
    fetchMock.mockImplementation(() => response(lookup));
    await button("Pull bookings").props.onClick(); render();
    expect(lastPayload()).toMatchObject({ phone: lookup.client.phone, email: "" });
    expect(serviceInputs()).toHaveLength(3);
    expectSummary("$675.00", "$225.00", "$450.00", 2);
  });
  it("pulls and lists jobs with email only, without requiring a phone", async () => {
    await startAdmin(); change("Client phone", "");
    fetchMock.mockImplementation(() => response(lookup));
    await button("Pull bookings").props.onClick(); render();
    expect(lastPayload()).toMatchObject({ phone: "", email: lookup.client.email });
    expect(serviceInputs()).toHaveLength(3);
    expectSummary("$675.00", "$225.00", "$450.00", 2);
  });
  it("lists all returned jobs and original paid amounts even with no portal account", async () => {
    await startAdmin();
    fetchMock.mockImplementation(() => response({ client: null, services: lookup.services, reviewHash: "" }));
    await button("Pull bookings").props.onClick(); render();
    expect(serviceInputs()).toHaveLength(3);
    expectRowPrice(0, "$225.00", "Paid");
    expectSummary("$675.00", "$225.00", "$450.00", 2);
    expect(text(tree)).not.toContain("An account must already exist");
    expectOnlyAdminCalls("status", "lookup", "lookup");
  });
  it("keeps loaded staff-paid service prices visible with a Paid label and unchanged period balance", async () => {
    await startAdmin(); expectRowPrice(0, "$225.00", "Paid"); expectRowPrice(1, "$225.00", "Unpaid");
    expect(text(serviceRow(0))).toContain("Paid — recorded by staff");
    expect(serviceInput(0).props.disabled).toBe(true); expect(serviceInput(0).props.checked).toBe(false);
    expectSummary("$675.00", "$225.00", "$450.00", 2);
    toggleService(1); expectRowPrice(0, "$225.00", "Paid"); expectSummary("$675.00", "$225.00", "$450.00", 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("never replaces original service prices with zero after marking a subset paid and clears manual selection", async () => {
    await startAdmin(); for (let index = 0; index < 3; index++) expectRowPrice(index, "$225.00", index === 0 ? "Paid" : "Unpaid");
    toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1"])));
    await button("Mark selected").props.onClick(); render();
    expect(lastPayload().serviceIds).toEqual(["service-1"]);
    for (let index = 0; index < 3; index++) expectRowPrice(index, "$225.00", index < 2 ? "Paid" : "Unpaid");
    expect(text(serviceRow(1))).toContain("Paid — recorded by staff"); expectSummary("$675.00", "$450.00", "$225.00", 1);
    expect(selectedServiceInputs()).toHaveLength(0); expect(serviceInput(1).props.disabled).toBe(true);
    expect(checkbox("I confirm payment was already received").props.checked).toBe(false);
    expectOnlyAdminCalls("status", "lookup", "mark-paid");
  });
  it("shows a partial admin service's original price and invoices its unpaid remainder without any selection", async () => {
    const source = { ...lookup, services: lookup.services.map((row, index) => index === 2 ? { ...row, paidCents: 10000 } : row) };
    await startAdmin(source); expectRowPrice(2, "$225.00", /\$125\.00/i); expect(text(rowPrice(2))).toMatch(/remaining/i);
    expect(text(serviceRow(2))).toContain("$100.00 payment recorded"); expectSummary("$675.00", "$325.00", "$350.00", 2);
    expect(selectedServiceInputs()).toHaveLength(0); change("Payment due date", "2026-11-14");
    expect(await createInvoice()).toMatchObject({ serviceIds: ["service-1", "service-2"], reviewHash: source.reviewHash, confirmedUnpaid: true });
  });
  it("keeps live client and date inputs blank", () => {
    page = () => InvoiceCollectionPage({}); fetchMock.mockImplementation(() => response({ paymentsReady: true })); render();
    for (const label of ["Client phone", "Billing email", "From service date", "To service date", "Payment due date"]) expect(field(label).props.value).toBe("");
  });
  it("creates every eligible unpaid service after setting only the due date, with zero manual selections", async () => {
    await startAdmin(); expectSummary("$675.00", "$225.00", "$450.00", 2); expect(selectedServiceInputs()).toHaveLength(0);
    expect(button("Mark selected").props.disabled).toBe(true); expect(button("Create invoice page").props.disabled).toBe(true);
    await button("Mark selected").props.onClick(); await button("Create invoice page").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(2);
    change("Payment due date", "2026-11-14"); expect(button("Create invoice page").props.disabled).toBe(false);
    const payload = await createInvoice(); expect(payload.serviceIds).toEqual(["service-1", "service-2"]); expect(payload.confirmedUnpaid).toBe(true);
    expectOnlyAdminCalls("status", "lookup", "issue"); expect(button("Send invoice").props.disabled).toBe(true);
  });
  it("has no invoice selection step or separate review checkbox and labels inline checkboxes only for prior payments", async () => {
    await startAdmin();
    expect(text(tree)).not.toContain("Select all eligible services"); expect(text(tree)).not.toContain("I reviewed these service");
    expect(text(tree)).not.toContain("Selected balance to invoice"); expect(summary("Unpaid services")).toBe("Unpaid services2");
    expect(serviceInputs().map(node => node.props["aria-label"])).toEqual(["Mark Oct 3, 2026 service already paid", "Mark Oct 17, 2026 service already paid", "Mark Oct 31, 2026 service already paid"]);
    const automaticBar = elements().find(node => node.props?.className === "ic-select-bar")!;
    expect(text(automaticBar)).toBe("All unpaid dates are included automatically2 unpaid");
    expect(elements(automaticBar).filter(node => node.type === "input")).toHaveLength(0);
    expect(elements().filter(node => node.type === "input" && node.props.type === "checkbox")).toHaveLength(5);
    const markPaidSection = elements().find(node => node.props?.className === "ic-mark-paid")!;
    expect(text(markPaidSection)).toContain("Select all unpaid dates to mark paid");
    expect(serviceInput(0).props.disabled).toBe(true); expect(serviceInput(1).props.disabled).toBe(false);
    expect(checkbox("I confirm payment was already received").props.disabled).toBe(true);
  });
  it("bulk prior-payment selection includes only eligible unpaid rows and never narrows the automatic invoice", async () => {
    const source = preexistingPaidLookup(); source.services.push({ ...source.services[11], id: "ineligible", eligible: false, reason: "Needs review" });
    await startAdmin(source); expect(checkbox("Select all unpaid dates to mark paid").props.checked).toBe(false);
    checkbox("Select all unpaid dates to mark paid").props.onChange(); render();
    expect(selectedServiceInputs()).toHaveLength(2); expect(serviceInput(10).props.checked).toBe(true); expect(serviceInput(11).props.checked).toBe(true);
    for (let i = 0; i < 10; i++) expect(serviceInput(i).props.checked).toBe(false); expect(serviceInput(12).props.checked).toBe(false);
    expect(checkbox("Select all unpaid dates to mark paid").props.checked).toBe(true); expect(button("Mark selected").props.disabled).toBe(true);
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 2);
    checkbox("Select all unpaid dates to mark paid").props.onChange(); render(); expect(selectedServiceInputs()).toHaveLength(0);
    change("Payment due date", "2026-11-14"); expect((await createInvoice()).serviceIds).toEqual(["synthetic-10", "synthetic-11"]);
    expectOnlyAdminCalls("status", "lookup", "issue");
  });
  it("bulk prior-payment recording still requires deliberate confirmation and clears all selections on success", async () => {
    await startAdmin(); checkbox("Select all unpaid dates to mark paid").props.onChange(); render();
    await button("Mark selected").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(2);
    confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1", "service-2"])));
    await button("Mark selected").props.onClick(); render(); expect(lastPayload().serviceIds).toEqual(["service-1", "service-2"]);
    expect(selectedServiceInputs()).toHaveLength(0); expect(checkbox("Select all unpaid dates to mark paid").props.checked).toBe(false);
    expect(checkbox("Select all unpaid dates to mark paid").props.disabled).toBe(true); expect(checkbox("I confirm payment was already received").props.checked).toBe(false);
    expectSummary("$675.00", "$675.00", "$0.00", 0); expectOnlyAdminCalls("status", "lookup", "mark-paid");
  });
  it("immediately shows ten preexisting paid dates and two unpaid dates without another click or mark", async () => {
    await startAdmin(preexistingPaidLookup()); expectSummary("$2,280.00", "$1,880.00", "$400.00", 2);
    expect(selectedServiceInputs()).toHaveLength(0); expect(elements().filter(node => node.props?.className?.includes("ic-service-row"))).toHaveLength(12);
    for (let i = 0; i < 10; i++) expect(serviceInput(i).props.disabled).toBe(true);
    expect(text(tree)).toContain("Paid — recorded by staff"); expectOnlyAdminCalls("status", "lookup");
  });
  it("manual date selection changes only the mark-paid count and amount, not period totals or unpaid invoice count", async () => {
    await startAdmin(preexistingPaidLookup()); toggleService(10);
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 2);
    expect(text(find("label", "I confirm payment was already received"))).toContain("1 selected unpaid service ($170.00)");
    toggleService(11); expectSummary("$2,280.00", "$1,880.00", "$400.00", 2);
    expect(text(find("label", "I confirm payment was already received"))).toContain("2 selected unpaid services ($400.00)");
    toggleService(10); expect(text(find("label", "I confirm payment was already received"))).toContain("1 selected unpaid service ($230.00)");
    expect(selectedServiceInputs()).toHaveLength(1); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("deselecting all prior-payment dates leaves invoice creation enabled and includes every unpaid date", async () => {
    await startAdmin(preexistingPaidLookup()); change("Payment due date", "2026-11-14"); toggleService(10); toggleService(11); toggleService(10); toggleService(11);
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 2); expect(selectedServiceInputs()).toHaveLength(0);
    expect(button("Mark selected").props.disabled).toBe(true); expect(button("Create invoice page").props.disabled).toBe(false);
    expect((await createInvoice()).serviceIds).toEqual(["synthetic-10", "synthetic-11"]);
  });
  it.each([false, true])("prior-payment selection (confirmed=%s) never narrows invoice service IDs", async paidConfirmed => {
    await startAdmin(preexistingPaidLookup()); toggleService(10); if (paidConfirmed) confirm("I confirm payment was already received");
    change("Payment due date", "2026-11-14"); expect((await createInvoice()).serviceIds).toEqual(["synthetic-10", "synthetic-11"]);
    expectOnlyAdminCalls("status", "lookup", "issue"); expect(button("Send invoice").props.disabled).toBe(true);
  });
  it("a fresh re-pull after marking uses paid state but resets selection without losing the period remainder", async () => {
    const source = syntheticLookup(); const ids = source.services.slice(0, 10).map(row => row.id); const recorded = markResponse(source, ids);
    await startAdmin(source); for (let i = 0; i < 10; i++) toggleService(i);
    confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(recorded)); await button("Mark selected").props.onClick(); render();
    expect(lastPayload().serviceIds).toEqual(ids); expectSummary("$2,280.00", "$1,880.00", "$400.00", 2); expect(selectedServiceInputs()).toHaveLength(0);
    fetchMock.mockImplementation(() => response(recorded)); await button("Pull bookings").props.onClick(); render();
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 2); expect(selectedServiceInputs()).toHaveLength(0);
    expect(text(tree)).toContain("Paid — recorded by staff"); expectOnlyAdminCalls("status", "lookup", "mark-paid", "lookup");
  });
  it("a remounted builder pulling recorded paid state starts unselected with the correct period totals", async () => {
    const source = syntheticLookup(); const ids = source.services.slice(0, 10).map(row => row.id); const recorded = markResponse(source, ids);
    await startAdmin(source); for (let i = 0; i < 10; i++) toggleService(i);
    confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(recorded)); await button("Mark selected").props.onClick(); render();
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 2); resetHarness(); await startAdmin(recorded);
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 2); expect(selectedServiceInputs()).toHaveLength(0);
    expectOnlyAdminCalls("status", "lookup", "mark-paid", "status", "lookup");
  });
  it("excludes ineligible paid and unpaid rows from period totals, manual recording and invoice issuance", async () => {
    const source = preexistingPaidLookup(); source.services = source.services.map((row, index) => index === 0 || index === 11 ? { ...row, eligible: false, reason: "Needs review" } : row);
    await startAdmin(source); expectSummary("$1,862.00", "$1,692.00", "$170.00", 1);
    expect(serviceInput(0).props.disabled).toBe(true); expect(serviceInput(11).props.disabled).toBe(true); expect(text(tree)).toContain("Needs review");
    change("Payment due date", "2026-11-14"); expect((await createInvoice()).serviceIds).toEqual(["synthetic-10"]);
  });
  it("counts partial payments across the period while selected partial rows affect only manual payment confirmation", async () => {
    const source = { ...lookup, services: lookup.services.map((row, index) => index === 2 ? { ...row, paidCents: 10000 } : row) };
    await startAdmin(source); expectSummary("$675.00", "$325.00", "$350.00", 2);
    toggleService(2); expectSummary("$675.00", "$325.00", "$350.00", 2);
    expect(text(find("label", "I confirm payment was already received"))).toContain("1 selected unpaid service ($125.00)");
    toggleService(1); expect(text(find("label", "I confirm payment was already received"))).toContain("2 selected unpaid services ($350.00)");
    toggleService(2); toggleService(1); expectSummary("$675.00", "$325.00", "$350.00", 2); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("includes unpaid rows with absent paidCents but excludes zero-balance and overpaid rows from invoice IDs", async () => {
    const source = syntheticLookup(); source.services = source.services.slice(0, 4).map((row, index) => index === 0 ? { ...row, paidCents: undefined } : index === 1 ? { ...row, amountCents: 0 } : { ...row, paidCents: row.amountCents + (index === 3 ? 100 : 0) });
    await startAdmin(source); expect(summary("Unpaid services")).toBe("Unpaid services1");
    for (let i = 1; i < 4; i++) expect(serviceInput(i).props.disabled).toBe(true);
    change("Payment due date", "2026-11-14"); expect((await createInvoice()).serviceIds).toEqual(["synthetic-0"]);
  });
  it("clears period and manual selection as a replacement lookup starts and leaves them clear on failure", async () => {
    await startAdmin(preexistingPaidLookup()); toggleService(10); expectSummary("$2,280.00", "$1,880.00", "$400.00", 2);
    const resolve = deferredResponse(); const pending = button("Pull bookings").props.onClick(); render();
    expectSummary("$0.00", "$0.00", "$0.00", 0); expect(text(tree)).toContain("No services loaded");
    resolve({ message: "Lookup unavailable. Try again." }, false); await pending; render();
    expectSummary("$0.00", "$0.00", "$0.00", 0); expect(text(tree)).toContain("Lookup unavailable. Try again.");
    expect(text(tree)).not.toContain("Verified Client"); expect(button("Create invoice page").props.disabled).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([["Client phone", "+12025550999"], ["Billing email", "other@example.test"], ["From service date", "2026-08-01"], ["To service date", "2026-11-06"]])("changing %s resets period totals, review snapshot and manual selection", async (label, value) => {
    await startAdmin(preexistingPaidLookup()); toggleService(10); confirm("I confirm payment was already received"); change("Payment due date", "2026-11-14");
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 2); change(label, value);
    expectSummary("$0.00", "$0.00", "$0.00", 0); expect(text(tree)).toContain("No services loaded");
    expect(text(tree)).not.toContain("Verified Client"); expect(selectedServiceInputs()).toHaveLength(0);
    expect(button("Create invoice page").props.disabled).toBe(true); await button("Create invoice page").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(() => response(preexistingPaidLookup())); await button("Pull bookings").props.onClick(); render();
    expect(selectedServiceInputs()).toHaveLength(0); expect(checkbox("I confirm payment was already received").props.checked).toBe(false);
  });
  it("keeps the exact manual-paid payload deliberate and issues every remaining unpaid ID with the refreshed full review hash", async () => {
    const source = preexistingPaidLookup(); await startAdmin(source); toggleService(10); confirm("I confirm payment was already received");
    fetchMock.mockImplementation(() => response(markResponse(source, ["synthetic-10"]))); await button("Mark selected").props.onClick(); render();
    const [markUrl, markOptions] = fetchMock.mock.calls.at(-1)!; const markPayload = lastPayload();
    expect(markUrl).toBe("/api/payable-invoices/admin/mark-paid"); expect(markOptions.method).toBe("POST"); expect(invoiceMarkPaidSchema.parse(markPayload)).toEqual(markPayload);
    expect(markPayload).toEqual({ requestId: markPayload.requestId, clientId: 42, from: "2026-07-22", to: "2026-11-07", serviceIds: ["synthetic-10"], reviewHash: source.reviewHash });
    expectSummary("$2,280.00", "$2,050.00", "$230.00", 1); expect(selectedServiceInputs()).toHaveLength(0);
    change("Payment due date", "2026-11-14"); expect(button("Create invoice page").props.disabled).toBe(false);
    const issuePayload = await createInvoice(); const [issueUrl, issueOptions] = fetchMock.mock.calls.at(-1)!;
    expect(issueUrl).toBe("/api/payable-invoices/admin/issue"); expect(issueOptions.method).toBe("POST"); expect(invoiceIssueSchema.parse(issuePayload)).toEqual(issuePayload);
    expect(issuePayload).toEqual({ requestId: issuePayload.requestId, clientId: 42, from: "2026-07-22", to: "2026-11-07", dueDate: "2026-11-14", serviceIds: ["synthetic-11"], reviewHash: "e".repeat(64), confirmedUnpaid: true });
    expect(issueOptions).toMatchObject({ credentials: "same-origin", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" } });
    expectOnlyAdminCalls("status", "lookup", "mark-paid", "issue"); expect(button("Send invoice").props.disabled).toBe(true);
  });
  it("requires inline payment confirmation and records only the selected unpaid source rows", async () => {
    await startAdmin(); toggleService(1); toggleService(2); expect(button("Mark selected").props.disabled).toBe(true);
    await button("Mark selected").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(2);
    confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1", "service-2"])));
    await button("Mark selected").props.onClick(); render();
    expect(lastPayload()).toMatchObject({ clientId: 42, from: "2026-07-22", to: "2026-11-07", serviceIds: ["service-1", "service-2"], reviewHash: lookup.reviewHash });
    expect(lastPayload()).not.toHaveProperty("confirmed"); expect(selectedServiceInputs()).toHaveLength(0); expectSummary("$675.00", "$675.00", "$0.00", 0);
    change("Payment due date", "2026-11-14"); expect(button("Create invoice page").props.disabled).toBe(true);
    await button("Create invoice page").props.onClick(); expectOnlyAdminCalls("status", "lookup", "mark-paid");
  });
  it("issues without a review checkbox and never emails automatically, but retains deliberate confirmed sending", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); const payload = await createInvoice();
    expect(payload).toMatchObject({ serviceIds: ["service-1", "service-2"], reviewHash: lookup.reviewHash, confirmedUnpaid: true });
    expect(find("a", "Download PDF").props.href).toBe("/api/payable-invoices/admin/77/pdf");
    expect(button("Send invoice").props.disabled).toBe(true); expect(text(tree)).toContain(lookup.client.email!); expect(text(tree)).toContain("No email or SMS has been sent.");
    await button("Send invoice").props.onClick(); expectOnlyAdminCalls("status", "lookup", "issue");
    confirm("Send this invoice to"); fetchMock.mockImplementation(() => response({ message: "Invoice sent." })); await button("Send invoice").props.onClick(); render();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/payable-invoices/admin/77/send"); expect(lastPayload()).toMatchObject({ confirmed: true }); expect(text(tree)).toContain("Invoice email sent.");
  });
  it.each([["Client phone", "+12025550999"], ["Billing email", "other@example.test"], ["From service date", "2026-08-01"], ["To service date", "2026-11-06"]])("rejects a stale lookup after %s changes without restoring totals", async (label, value) => {
    await startAdmin(); const resolve = deferredResponse(); const pending = button("Pull bookings").props.onClick(); const signal = fetchMock.mock.calls.at(-1)![1].signal;
    change(label, value); expect(signal.aborted).toBe(true); expectSummary("$0.00", "$0.00", "$0.00", 0);
    resolve(lookup); await pending; render(); expect(text(tree)).not.toContain("Verified Client"); expect(text(tree)).toContain("No services loaded"); expectSummary("$0.00", "$0.00", "$0.00", 0);
  });
  it("surfaces actual configuration messages rather than an approval gate", async () => {
    page = () => InvoiceCollectionPage({}); fetchMock.mockImplementation(() => response({ paymentsReady: false, message: "Stripe key missing." })); render(); await flush(); render();
    expect(text(tree)).toContain("Stripe key missing."); expect(text(tree)).not.toContain("need approval first");
  });
  it.each(["Services changed. Pull bookings again.", "Prior payment could not be recorded."])("preserves error, chosen rows and all unpaid invoice candidates after failed marking: %s", async message => {
    await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response({ message }, false)); await button("Mark selected").props.onClick(); render();
    expect(text(tree)).toContain(message); expect(serviceInput(0).props.checked).toBe(false); expect(serviceInput(1).props.checked).toBe(true); expect(serviceInput(2).props.checked).toBe(false);
    expectSummary("$675.00", "$225.00", "$450.00", 2); expect(fetchMock).toHaveBeenCalledTimes(3);
    change("Payment due date", "2026-11-14"); expect((await createInvoice()).serviceIds).toEqual(["service-1", "service-2"]);
  });
  it("records only ten manually selected rows then immediately shows twelve dates and $400 remaining with selection cleared", async () => {
    const source = syntheticLookup(); const ids = source.services.slice(0, 10).map(row => row.id);
    expect(source.services.reduce((sum, row) => sum + row.amountCents, 0)).toBe(228000); expect(source.services.slice(0, 10).reduce((sum, row) => sum + row.amountCents, 0)).toBe(188000);
    await startAdmin(source); for (let i = 0; i < 10; i++) toggleService(i);
    expect(button("Mark selected").props.disabled).toBe(true); await button("Mark selected").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(2);
    confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(source, ids))); await button("Mark selected").props.onClick(); render();
    expect(lastPayload().serviceIds).toEqual(ids); expectSummary("$2,280.00", "$1,880.00", "$400.00", 2); expect(selectedServiceInputs()).toHaveLength(0);
    expect(text(tree)).toContain("Paid — recorded by staff"); expect(checkbox("I confirm payment was already received").props.checked).toBe(false);
    expect(text(tree)).not.toContain("I reviewed these service"); expectOnlyAdminCalls("status", "lookup", "mark-paid");
    change("Payment due date", "2026-11-14"); expect(await createInvoice()).toMatchObject({ serviceIds: ["synthetic-10", "synthetic-11"], reviewHash: "e".repeat(64) });
    expectOnlyAdminCalls("status", "lookup", "mark-paid", "issue"); expect(button("Send invoice").props.disabled).toBe(true);
  });
  it("keeps ineligible unpaid rows visible but unselected and unbilled after all eligible balances are marked paid", async () => {
    const source = { ...lookup, services: lookup.services.map((row, index) => index === 2 ? { ...row, eligible: false, reason: "Needs review" } : row) };
    await startAdmin(source); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(source, ["service-1"]))); await button("Mark selected").props.onClick(); render();
    expectSummary("$450.00", "$450.00", "$0.00", 0); expect(selectedServiceInputs()).toHaveLength(0); expect(serviceInput(2).props.disabled).toBe(true); expect(text(tree)).toContain("Needs review");
    change("Payment due date", "2026-11-14"); expect(button("Create invoice page").props.disabled).toBe(true); await button("Create invoice page").props.onClick(); expectOnlyAdminCalls("status", "lookup", "mark-paid");
  });
  it("includes a partial payment balance on an unselected eligible date after marking another service paid", async () => {
    const source = { ...lookup, services: lookup.services.map((row, index) => index === 2 ? { ...row, paidCents: 10000 } : row) };
    await startAdmin(source); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(source, ["service-1"]))); await button("Mark selected").props.onClick(); render();
    expectSummary("$675.00", "$550.00", "$125.00", 1); expect(serviceInput(2).props.checked).toBe(false); expect(text(tree)).toContain("$100.00 payment recorded"); expectRowPrice(2, "$225.00", "$125.00 remaining");
    change("Payment due date", "2026-11-14"); expect(await createInvoice()).toMatchObject({ serviceIds: ["service-2"], reviewHash: "e".repeat(64) });
  });
  it("manual reselection after marking never changes invoice candidates or collects/sends automatically", async () => {
    await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1"]))); await button("Mark selected").props.onClick(); render();
    change("Payment due date", "2026-11-14"); toggleService(2); expectSummary("$675.00", "$450.00", "$225.00", 1); expect(button("Create invoice page").props.disabled).toBe(false);
    toggleService(2); expectSummary("$675.00", "$450.00", "$225.00", 1); expect(button("Create invoice page").props.disabled).toBe(false);
    expect(await createInvoice()).toMatchObject({ serviceIds: ["service-2"], reviewHash: "e".repeat(64) }); expectOnlyAdminCalls("status", "lookup", "mark-paid", "issue"); expect(button("Send invoice").props.disabled).toBe(true);
  });
  it("ignores a pending mark response after the period changes", async () => {
    await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); const resolve = deferredResponse(); const pending = button("Mark selected").props.onClick();
    const signal = fetchMock.mock.calls.at(-1)![1].signal; change("From service date", "2026-08-01"); expect(signal.aborted).toBe(true); resolve(markResponse(lookup, ["service-1"])); await pending; render();
    expect(text(tree)).toContain("No services loaded"); expect(text(tree)).not.toContain("Verified Client"); expectSummary("$0.00", "$0.00", "$0.00", 0); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("ignores a pending mark response after admin unmount", async () => {
    await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); const resolve = deferredResponse(); const pending = button("Mark selected").props.onClick(); hooks.cleanups.forEach(cleanup => cleanup());
    const snapshot = JSON.stringify(hooks.slots); resolve(markResponse(lookup, ["service-1"])); await pending; expect(JSON.stringify(hooks.slots)).toBe(snapshot); expect(fetchMock.mock.calls.at(-1)![1].signal.aborted).toBe(true);
  });
  it("reports real prior payments but does not issue or access checkout when readiness is false", async () => {
    await startAdmin(lookup, false); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1"]))); await button("Mark selected").props.onClick(); render();
    expectSummary("$675.00", "$450.00", "$225.00", 1); change("Payment due date", "2026-11-14"); expect(button("Create invoice page").props.disabled).toBe(true); await button("Create invoice page").props.onClick(); render();
    expect(text(tree)).toContain("Secure payments unavailable."); expectOnlyAdminCalls("status", "lookup", "mark-paid");
  });
  it.each(["", "2026-02-30", "2026-11-31", "not-a-date"])("blocks issue for invalid due date %s even with unpaid services loaded", async value => {
    await startAdmin(); change("Payment due date", value); expect(button("Create invoice page").props.disabled).toBe(true);
    await button("Create invoice page").props.onClick(); expectOnlyAdminCalls("status", "lookup");
  });
  it("changing a valid due date needs no review recheck and sends the latest date with all unpaid IDs", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); expect(button("Create invoice page").props.disabled).toBe(false);
    change("Payment due date", "2026-11-21"); expect(button("Create invoice page").props.disabled).toBe(false); expect(text(tree)).not.toContain("I reviewed these service");
    expect(await createInvoice()).toMatchObject({ dueDate: "2026-11-21", serviceIds: ["service-1", "service-2"], reviewHash: lookup.reviewHash });
  });
  it.each(["empty", "all paid", "all ineligible"])("disables invoice creation for %s loaded periods", async kind => {
    const source = { ...lookup, services: kind === "empty" ? [] : lookup.services.map(row => kind === "all paid" ? { ...row, paidCents: row.amountCents } : { ...row, eligible: false, reason: "Needs review" }) };
    await startAdmin(source); change("Payment due date", "2026-11-14"); expect(summary("Unpaid services")).toBe("Unpaid services0"); expect(button("Create invoice page").props.disabled).toBe(true);
    await button("Create invoice page").props.onClick(); expectOnlyAdminCalls("status", "lookup");
  });
  it("requires a loaded client even when a response contains unpaid rows and a review hash", async () => {
    await startAdmin({ ...lookup, client: null } as any); change("Payment due date", "2026-11-14"); expect(summary("Unpaid services")).toBe("Unpaid services2"); expect(button("Create invoice page").props.disabled).toBe(true);
    await button("Create invoice page").props.onClick(); expectOnlyAdminCalls("status", "lookup");
  });
  it("requires the original lookup review hash before enabling issue", async () => {
    await startAdmin({ ...lookup, reviewHash: "" }); change("Payment due date", "2026-11-14"); expect(button("Create invoice page").props.disabled).toBe(true);
    await button("Create invoice page").props.onClick(); expectOnlyAdminCalls("status", "lookup");
  });
  it.each([["", "2026-11-07"], ["2026-02-30", "2026-11-07"], ["2026-11-08", "2026-11-07"], ["2026-07-22", "2026-11-31"]])("requires a valid loaded period %s through %s in both the issue handler and button", async (from, to) => {
    await startAdmin(); change("Payment due date", "2026-11-14");
    // Preserve a loaded snapshot while injecting an invalid controlled period to exercise the issue guard itself.
    hooks.slots[2] = from; hooks.slots[3] = to; render(); expect(button("Create invoice page").props.disabled).toBe(true);
    await button("Create invoice page").props.onClick(); expectOnlyAdminCalls("status", "lookup");
  });
  it("does not create an invoice until the pending configuration check confirms readiness", async () => {
    page = () => InvoiceCollectionPage({}); const resolveStatus = deferredResponse(); render();
    expect(text(tree)).toContain("Checking invoice configuration…");
    change("Client phone", lookup.client.phone); change("Billing email", lookup.client.email!); change("From service date", "2026-07-22"); change("To service date", "2026-11-07");
    fetchMock.mockImplementation(() => response(lookup)); await button("Pull bookings").props.onClick(); render(); change("Payment due date", "2026-11-14");
    expect(button("Create invoice page").props.disabled).toBe(true); await button("Create invoice page").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveStatus({ paymentsReady: true }); await flush(); render(); expect(button("Create invoice page").props.disabled).toBe(false);
  });
  it("preserves real configuration-check errors and keeps invoice creation disabled", async () => {
    page = () => InvoiceCollectionPage({}); fetchMock.mockImplementation(() => response({ message: "Invoice configuration could not be checked." }, false)); render(); await flush(); render();
    expect(text(tree)).toContain("Invoice configuration could not be checked."); expect(button("Create invoice page").props.disabled).toBe(true); expectOnlyAdminCalls("status");
  });
  it("disables date recording, due date, issue and duplicate mark submissions while prior payment is busy", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); toggleService(1); confirm("I confirm payment was already received");
    const staleMark = button("Mark selected").props.onClick; const resolve = deferredResponse(); const pending = staleMark(); render();
    expect(button("Recording payment").props.disabled).toBe(true); expect(button("Create invoice page").props.disabled).toBe(true); expect(field("Payment due date").props.disabled).toBe(true);
    for (const input of serviceInputs()) expect(input.props.disabled).toBe(true); expect(checkbox("I confirm payment was already received").props.disabled).toBe(true);
    expect(checkbox("Select all unpaid dates to mark paid").props.disabled).toBe(true);
    await button("Recording payment").props.onClick(); await button("Create invoice page").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(3);
    resolve(markResponse(lookup, ["service-1"])); await pending; render(); expect(button("Create invoice page").props.disabled).toBe(false); expectSummary("$675.00", "$450.00", "$225.00", 1);
  });
  it("disables all recording/issue actions during issue and ignores a duplicate click while busy", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); toggleService(1); confirm("I confirm payment was already received"); const resolve = deferredResponse(); const pending = button("Create invoice page").props.onClick(); render();
    expect(button("Creating invoice").props.disabled).toBe(true); expect(button("Mark selected").props.disabled).toBe(true); expect(button("Pull bookings").props.disabled).toBe(true); expect(field("Payment due date").props.disabled).toBe(true);
    for (const input of serviceInputs()) expect(input.props.disabled).toBe(true);
    expect(checkbox("Select all unpaid dates to mark paid").props.disabled).toBe(true);
    await button("Creating invoice").props.onClick(); await button("Mark selected").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(3);
    resolve(issueResult); await pending; render(); expect(text(tree)).toContain("Invoice page created"); expect(button("Send invoice").props.disabled).toBe(true); expectOnlyAdminCalls("status", "lookup", "issue");
  });
  it("does not repeat issuance after success and blocks manual recording or email without its separate confirmation", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); await createInvoice();
    expect(button("Create invoice page").props.disabled).toBe(true); expect(button("Mark selected").props.disabled).toBe(true);
    expect(checkbox("Select all unpaid dates to mark paid").props.disabled).toBe(true); expect(checkbox("I confirm payment was already received").props.disabled).toBe(true);
    await button("Create invoice page").props.onClick(); await button("Mark selected").props.onClick(); await button("Send invoice").props.onClick();
    expectOnlyAdminCalls("status", "lookup", "issue"); expect(text(tree)).toContain("No email or SMS has been sent.");
  });
  it("disabled row toggles after issue preserve the issued page, send confirmation and create safeguard", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); await createInvoice(); confirm("Send this invoice to");
    for (const input of serviceInputs()) expect(input.props.disabled).toBe(true);
    toggleService(1); expect(selectedServiceInputs()).toHaveLength(0); expect(text(tree)).toContain("Invoice page created");
    expect(checkbox("Send this invoice to").props.checked).toBe(true); expect(button("Create invoice page").props.disabled).toBe(true);
    expect(button("Send invoice").props.disabled).toBe(false); expectOnlyAdminCalls("status", "lookup", "issue");
  });
  it("preserves the review error and retries unchanged issuance with the same request key and complete unpaid IDs", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); fetchMock.mockImplementation(() => response({ message: "Service dates, amounts or paid status changed. Pull bookings again before creating the invoice." }, false));
    await button("Create invoice page").props.onClick(); render(); const first = lastPayload();
    expect(text(tree)).toContain("Service dates, amounts or paid status changed."); expectSummary("$675.00", "$225.00", "$450.00", 2); expect(button("Create invoice page").props.disabled).toBe(false);
    render(); render(); const retry = await createInvoice(); expect(retry).toEqual(first); expect(retry.serviceIds).toEqual(["service-1", "service-2"]); expectOnlyAdminCalls("status", "lookup", "issue", "issue");
  });
  it("retries unchanged failed manual recording with the same mark key, then clears selection on success", async () => {
    await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response({ message: "Recording unavailable. Try again." }, false));
    await button("Mark selected").props.onClick(); render(); const first = lastPayload(); expect(checkbox("I confirm payment was already received").props.checked).toBe(true);
    render(); fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1"]))); await button("Mark selected").props.onClick(); render();
    expect(lastPayload()).toEqual(first); expect(selectedServiceInputs()).toHaveLength(0); expectSummary("$675.00", "$450.00", "$225.00", 1); expectOnlyAdminCalls("status", "lookup", "mark-paid", "mark-paid");
  });
  it("changing a prior-payment selection after a failed issue does not change the issue payload or retry key", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); fetchMock.mockImplementation(() => response({ message: "Invoice could not be issued." }, false)); await button("Create invoice page").props.onClick(); render(); const first = lastPayload();
    toggleService(1); confirm("I confirm payment was already received"); expect(await createInvoice()).toEqual(first);
    expectOnlyAdminCalls("status", "lookup", "issue", "issue");
  });
  it("uses a new issue request key after a due-date payload change, without requiring a review check", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); fetchMock.mockImplementation(() => response({ message: "Invoice could not be issued." }, false)); await button("Create invoice page").props.onClick(); render(); const first = lastPayload();
    change("Payment due date", "2026-11-21"); const next = await createInvoice(); expect(next.requestId).not.toBe(first.requestId); expect(next).toEqual({ ...first, requestId: next.requestId, dueDate: "2026-11-21" });
  });
  it("refreshing a stale issue review uses the replacement full snapshot and a new request key", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); fetchMock.mockImplementation(() => response({ message: "Services changed. Pull bookings again." }, false)); await button("Create invoice page").props.onClick(); render(); const first = lastPayload();
    fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1"]))); await button("Pull bookings").props.onClick(); render();
    expectSummary("$675.00", "$450.00", "$225.00", 1); const next = await createInvoice(); expect(next.requestId).not.toBe(first.requestId); expect(next.serviceIds).toEqual(["service-2"]); expect(next.reviewHash).toBe("e".repeat(64));
  });
  it.each(["Client phone", "From service date"])("ignores a pending issue response after %s changes", async label => {
    await startAdmin(); change("Payment due date", "2026-11-14"); const resolve = deferredResponse(); const pending = button("Create invoice page").props.onClick(); const signal = fetchMock.mock.calls.at(-1)![1].signal;
    change(label, label === "Client phone" ? "+12025550999" : "2026-08-01"); expect(signal.aborted).toBe(true); resolve(issueResult); await pending; render();
    expect(text(tree)).not.toContain("Invoice page created"); expect(text(tree)).toContain("No services loaded"); expectSummary("$0.00", "$0.00", "$0.00", 0); expectOnlyAdminCalls("status", "lookup", "issue");
  });
  it("ignores a pending issue response after unmount without mutating state or sending email", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); const resolve = deferredResponse(); const pending = button("Create invoice page").props.onClick(); hooks.cleanups.forEach(cleanup => cleanup()); const snapshot = JSON.stringify(hooks.slots);
    resolve(issueResult); await pending; expect(JSON.stringify(hooks.slots)).toBe(snapshot); expect(fetchMock.mock.calls.at(-1)![1].signal.aborted).toBe(true); expectOnlyAdminCalls("status", "lookup", "issue");
  });
  it("ignores a pending lookup and status response after admin unmount", async () => {
    page = () => InvoiceCollectionPage({}); const resolveStatus = deferredResponse(); render();
    change("Client phone", lookup.client.phone); change("Billing email", lookup.client.email!); change("From service date", "2026-07-22"); change("To service date", "2026-11-07");
    const statusSignal = fetchMock.mock.calls[0][1].signal; const resolveLookup = deferredResponse(); const pending = button("Pull bookings").props.onClick(); hooks.cleanups.forEach(cleanup => cleanup()); const snapshot = JSON.stringify(hooks.slots);
    resolveLookup(lookup); resolveStatus({ paymentsReady: true }); await pending; await flush(); expect(JSON.stringify(hooks.slots)).toBe(snapshot); expect(statusSignal.aborted).toBe(true); expect(fetchMock.mock.calls.at(-1)![1].signal.aborted).toBe(true);
  });
  it("clears an issued invoice and its send confirmation when the billing client is changed", async () => {
    await startAdmin(); change("Payment due date", "2026-11-14"); await createInvoice(); confirm("Send this invoice to"); change("Client phone", "+12025550999");
    expect(text(tree)).not.toContain("Invoice page created"); expect(text(tree)).not.toContain("Send this invoice to"); expectSummary("$0.00", "$0.00", "$0.00", 0); expect(button("Create invoice page").props.disabled).toBe(true); expectOnlyAdminCalls("status", "lookup", "issue");
  });
  it("review-only preview includes every unpaid date with original prices and does not issue, email or call Stripe", async () => {
    const onPreview = vi.fn(); page = () => InvoiceCollectionPage({ review: true, onPreview }); render();
    expect(text(tree)).not.toContain("I reviewed these service"); expect(serviceInput(0).props.disabled).toBe(true);
    await button("Preview customer page").props.onClick(); expect(onPreview).toHaveBeenCalledTimes(1);
    const invoice = onPreview.mock.calls[0][0] as PayableInvoice; expect(invoice.lines.map(row => row.occurrenceKey)).toEqual(["sample-2", "sample-3"]);
    expect(invoice.lines.map(row => [row.amountCents, row.paidCents])).toEqual([[22500, 0], [22500, 0]]); expect(invoiceBalance(invoice.lines)).toBe(45000);
    expect(fetchMock).not.toHaveBeenCalled(); expect(window.location.assign).not.toHaveBeenCalled();
  });
  it("captured no-selection UI issue payload passes the real schema and service with full-period hash and original partial-payment amounts", async () => {
    // TEST ONLY in-memory repository. No real repository, DB, route setup, delivery or Stripe client imports.
    const source: LookupFixture = { ...lookup, services: lookup.services.map((row, index) => ({ ...row, id: `job:${index + 1}`, occurrenceKey: `job:${index + 1}`, paidCents: index === 2 ? 10000 : row.paidCents })) };
    source.services.push({ ...source.services[1], id: "job:4", occurrenceKey: "job:4", eligible: false, reason: "Needs review" });
    source.reviewHash = invoiceReviewHash(source.client, source.services, "2026-07-22", "2026-11-07");
    await startAdmin(source); change("Payment due date", "2026-11-14"); expect(selectedServiceInputs()).toHaveLength(0); const payload = await createInvoice(); const input = invoiceIssueSchema.parse(payload);
    expect(input).toEqual({ requestId: expect.any(String), clientId: 42, from: "2026-07-22", to: "2026-11-07", dueDate: "2026-11-14", serviceIds: ["job:2", "job:3"], reviewHash: source.reviewHash, confirmedUnpaid: true });
    expect(input.reviewHash).not.toBe(invoiceReviewHash(source.client, source.services.filter(row => input.serviceIds.includes(row.id)), input.from, input.to));
    const repo: InvoiceRepository = {
      lookup: vi.fn(async () => source), services: vi.fn(async () => source),
      issue: vi.fn(async (issuedInput, client, rows: InvoiceService[]): Promise<PayableInvoice> => ({ ...sampleInvoice, id: 77, clientId: client.id, clientName: client.name, from: issuedInput.from, to: issuedInput.to, dueDate: issuedInput.dueDate,
        lines: rows.map((row, index) => ({ id: index + 1, occurrenceKey: row.occurrenceKey, date: row.date, description: row.description, address: row.address, amountCents: row.amountCents, paidCents: row.paidCents || 0, manualPaidCents: row.paymentSource === "manual" ? row.paidCents || 0 : 0 })) })),
      byToken: vi.fn(async () => null), reserve: vi.fn(async () => { throw new Error("No checkout expected"); }), attachSession: vi.fn(async () => {}), attempt: vi.fn(async () => null), settle: vi.fn(async () => {}),
    };
    const stripeCreate = vi.fn(); const stripeRetrieve = vi.fn(); const stripe = vi.fn(() => ({ checkout: { sessions: { create: stripeCreate, retrieve: stripeRetrieve } } } as any));
    const assertCollectionReady = vi.fn(async () => {});
    const service = new PayableInvoiceService({ repo, stripe, assertCollectionReady, origin: "https://invoice.example.test", tokenSecret: "test-only-invoice-secret-not-a-real-key-2026" });
    const result = await service.issue(input);
    expect(repo.services).toHaveBeenCalledWith(42, input.from, input.to); expect(repo.issue).toHaveBeenCalledWith(input, source.client, [source.services[1], source.services[2]], expect.stringMatching(/^[a-f0-9]{64}$/), expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(assertCollectionReady).toHaveBeenCalledWith([source.services[1], source.services[2]]);
    expect(result.invoice.lines.map(row => [row.amountCents, row.paidCents])).toEqual([[22500, 0], [22500, 10000]]);
    expect(invoiceBalance(result.invoice.lines)).toBe(35000); expect(selectedBalance(result.invoice, result.invoice.lines.map(row => row.id))).toBe(35000);
    expect(stripe).not.toHaveBeenCalled(); expect(stripeCreate).not.toHaveBeenCalled(); expect(stripeRetrieve).not.toHaveBeenCalled(); expect(repo.reserve).not.toHaveBeenCalled(); expect(repo.settle).not.toHaveBeenCalled();
    expectOnlyAdminCalls("status", "lookup", "issue"); expect(button("Send invoice").props.disabled).toBe(true);
    // The server still rejects a stale full-period snapshot even if the selected unpaid rows have not changed.
    source.services = source.services.map((row, index) => index === 0 ? { ...row, description: "Changed paid service" } : row);
    await expect(service.issue(input)).rejects.toMatchObject({ code: "REVIEW_CHANGED", status: 409 }); expect(repo.issue).toHaveBeenCalledTimes(1); expect(stripe).not.toHaveBeenCalled();
  });
});

describe("local customer invoice", () => {
  it("retains original prices on staff-paid customer rows and leaves their payment checkbox disabled", () => {
    page = () => CustomerInvoicePage({ review: true }); render();
    expectRowPrice(0, "$225.00", "Paid — recorded by staff"); expectRowPrice(1, "$225.00", "Unpaid");
    const paid = elements(serviceRow(0)).find(node => node.type === "input")!; expect(paid.props.disabled).toBe(true); expect(paid.props.checked).toBe(false);
    expect(summary("Already paid")).toBe("Already paid$225.00"); expect(summary("Remaining invoice balance")).toBe("Remaining invoice balance$450.00");
    expect(button("Preview $450.00").props.disabled).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps a partial customer's $225 original price while selecting only its $125 remainder for checkout", async () => {
    const invoice = { ...sampleInvoice, lines: sampleInvoice.lines.map((row, index) => index === 2 ? { ...row, paidCents: 10000 } : row) };
    page = () => CustomerInvoicePage({}); fetchMock.mockImplementation(() => response({ invoice, paymentsReady: true })); render(); await flush(); render();
    expectRowPrice(2, "$225.00", /\$125\.00/i); expect(text(rowPrice(2))).toMatch(/remaining/i);
    expect(summary("Already paid")).toBe("Already paid$325.00"); expect(summary("Remaining invoice balance")).toBe("Remaining invoice balance$350.00");
    expect(button("Pay $350.00").props.disabled).toBe(false);
    elements(serviceRow(1)).find(node => node.type === "input")!.props.onChange(); render();
    expectRowPrice(2, "$225.00", /\$125\.00/i); expect(summary("Selected service dates")).toBe("Selected service dates1");
    fetchMock.mockImplementation(() => response({ url: "https://checkout.stripe.com/c/pay/example" })); await button("Pay $125.00").props.onClick(); render();
    const [url, options] = fetchMock.mock.calls.at(-1)!; expect(url).toBe("/api/payable-invoices/token/checkout"); expect(JSON.parse(options.body)).toEqual({ requestId: expect.any(String), lineIds: [3] });
    expect(window.location.assign).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("labels fully Stripe-paid customer rows Paid without falsely attributing payment to staff", () => {
    const invoice = { ...sampleInvoice, status: "paid" as const, lines: sampleInvoice.lines.map(row => ({ ...row, paidCents: row.amountCents, manualPaidCents: 0 })) };
    page = () => CustomerInvoicePage({ review: true, reviewInvoice: invoice }); render();
    for (let index = 0; index < 3; index++) { expectRowPrice(index, "$225.00", "Paid"); expect(elements(serviceRow(index)).find(node => node.type === "input")!.props.disabled).toBe(true); }
    expect(text(tree)).not.toContain("recorded by staff"); expect(summary("Already paid")).toBe("Already paid$675.00");
    expect(summary("Remaining invoice balance")).toBe("Remaining invoice balance$0.00"); expect(elements().filter(node => node.type === "button" && node.props.className === "ic-primary")).toHaveLength(0); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("preserves payment-review qualifiers alongside original staff-paid and Stripe-paid prices", () => {
    const invoice = { ...sampleInvoice, status: "payment_review" as const, lines: sampleInvoice.lines.map((row, index) => index === 1 ? { ...row, paidCents: row.amountCents, manualPaidCents: 0 } : row) };
    page = () => CustomerInvoicePage({ review: true, reviewInvoice: invoice }); render();
    expectRowPrice(0, "$225.00", "Paid — recorded by staff · adjustment under review"); expectRowPrice(1, "$225.00", "Paid · adjustment under review"); expectRowPrice(2, "$225.00", "Unpaid");
    expect(summary("Recorded payments (under review)")).toBe("Recorded payments (under review)$450.00"); expect(summary("Remaining invoice balance")).toBe("Remaining invoice balance$225.00");
    expect(text(tree)).toContain("does not confirm that every service is paid"); expect(elements().filter(node => node.type === "button" && node.props.className === "ic-primary")).toHaveLength(0); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("review mode displays every date, defaults unpaid selection, and makes no payment calls", async () => { page = () => CustomerInvoicePage({ review: true }); render(); expect(text(tree)).toContain("Oct 3, 2026"); expect(text(tree)).toContain("Oct 17, 2026"); expect(text(tree)).toContain("Oct 31, 2026"); expect(text(tree)).toContain("Paid — recorded by staff"); const paid = elements().find(node => node.type === "input" && node.props["aria-label"] === "Pay Oct 3, 2026 service")!; expect(paid.props.checked).toBe(false); expect(paid.props.disabled).toBe(true); expect(text(tree)).toContain("Already paid$225.00"); await button("Preview $450.00").props.onClick(); render(); expect(text(tree)).toContain("No payment request was made."); expect(fetchMock).not.toHaveBeenCalled(); });
  it("shows adjustment review, retains paid history with qualifier, and has no Pay button", () => { const adjusted = { ...sampleInvoice, status: "payment_review" as const }; page = () => CustomerInvoicePage({ review: true, reviewInvoice: adjusted }); render(); expect(text(tree)).toContain("Payment under review — not payable"); expect(text(tree)).toContain("adjustment under review"); expect(text(tree)).toContain("does not confirm that every service is paid"); expect(elements().filter(node => node.type === "button" && node.props.className === "ic-primary")).toHaveLength(0); expect(isInvoicePayable(adjusted)).toBe(false); expect(invoiceStatusLabel(adjusted)).not.toBe("Paid"); });
  it("opens exactly one total checkout and refreshes only on explicit status check", async () => { page = () => CustomerInvoicePage({}); fetchMock.mockImplementation(() => response({ invoice: sampleInvoice, paymentsReady: true })); render(); await flush(); render(); expect(fetchMock).toHaveBeenCalledTimes(1); fetchMock.mockImplementation(() => response({ url: "https://checkout.stripe.com/c/pay/example" })); await button("Pay $450.00").props.onClick(); render(); const [url, options] = fetchMock.mock.calls.at(-1)!; expect(url).toBe("/api/payable-invoices/token/checkout"); expect(JSON.parse(options.body).lineIds).toEqual([2, 3]); expect(window.location.assign).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(2); fetchMock.mockImplementation(() => response({ invoice: sampleInvoice, paymentsReady: true })); await button("Check payment status").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(3); expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/payable-invoices/token"); });
  it("resumes the existing checkout instead of creating another attempt", async () => { page = () => CustomerInvoicePage({}); fetchMock.mockImplementation(() => response({ invoice: { ...sampleInvoice, activeAttemptId: "existing", activeLineIds: [2] }, paymentsReady: true })); render(); await flush(); render(); fetchMock.mockImplementation(() => response({ url: "https://checkout.stripe.com/c/pay/example" })); await button("Resume secure checkout").props.onClick(); expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/payable-invoices/token/resume"); });
  it("ignores requests completed after unmount", async () => { let resolve!: (value: any) => void; page = () => CustomerInvoicePage({}); fetchMock.mockImplementation(() => new Promise(value => { resolve = value; })); render(); hooks.cleanups.forEach(cleanup => cleanup()); resolve({ ok: true, json: async () => ({ invoice: sampleInvoice, paymentsReady: true }) }); await flush(); expect(hooks.slots[0]).toBe(null); });
  it("identifies staff payment only using the structured manual amount", () => { const stripeLine = { ...sampleInvoice.lines[0], manualPaidCents: 0 }; expect(linePaymentLabel(stripeLine, sampleInvoice)).toBe("Paid"); expect(linePaymentLabel(sampleInvoice.lines[0], sampleInvoice)).toBe("Paid — recorded by staff"); expect(serviceBalance({ ...lookup.services[0], paidCents: 10000 } as any)).toBe(12500); });
});
