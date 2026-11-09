import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

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
const confirm = (label: string) => { checkbox(label).props.onChange({ target: { checked: true } }); render(); };
const response = (data: unknown, ok = true) => Promise.resolve({ ok, json: async () => data });
const lookup = { client: { id: 42, name: "Verified Client", email: "verified@example.test", phone: "+12025550102" }, reviewHash: "a".repeat(64), services: sampleInvoice.lines.map((row, index) => ({ ...row, id: `service-${index}`, eligible: true, reason: null as string | null, status: "Reviewed", paymentSource: index === 0 ? "manual" : null })) };
const issueResult = { invoice: { ...sampleInvoice, id: 77 }, url: "/invoice/pay/test-token" };
const startAdmin = async (source = lookup, paymentsReady = true) => { page = () => InvoiceCollectionPage({}); fetchMock.mockImplementation(() => response({ paymentsReady, message: paymentsReady ? "" : "Secure payments unavailable." })); render(); await flush(); render(); change("Client phone", lookup.client.phone); change("Billing email", lookup.client.email); change("From service date", "2026-07-22"); change("To service date", "2026-11-07"); fetchMock.mockImplementation(() => response(source)); await button("Pull bookings").props.onClick(); render(); };
const selectAll = () => { checkbox("Select all eligible").props.onChange(); render(); };
const serviceInput = (index: number) => elements().filter(node => node.type === "input" && node.props["aria-label"]?.startsWith("Include "))[index];
const toggleService = (index: number) => { serviceInput(index).props.onChange(); render(); };
const summary = (label: string) => text(elements().find(node => node.props?.className === "ic-summary-line" && text(node).startsWith(label)));
const expectSummary = (total: string, paid: string, remaining: string, selected: number, selectedBalance: string) => {
  expect(summary("Service total")).toBe(`Service total${total}`);
  expect(summary("Already paid")).toBe(`Already paid${paid}`);
  const grandTotal = elements().find(node => node.props?.className === "ic-grand-total")!;
  expect(text(elements(grandTotal).find(node => node.type === "span"))).toBe("Remaining balance");
  expect(text(elements(grandTotal).find(node => node.type === "b"))).toBe(remaining);
  expect(summary("Selected services")).toBe(`Selected services${selected}`);
  expect(summary("Selected balance to invoice")).toBe(`Selected balance to invoice${selectedBalance}`);
};
const selectedServiceInputs = () => elements().filter(node => node.type === "input" && node.props["aria-label"]?.startsWith("Include ") && node.props.checked);
const syntheticLookup = () => ({ ...lookup, services: Array.from({ length: 12 }, (_, index) => ({ ...lookup.services[1], id: `synthetic-${index}`, occurrenceKey: `synthetic-${index}`, date: `2026-10-${String(index + 1).padStart(2, "0")}`, amountCents: index < 10 ? 18800 : index === 10 ? 17000 : 23000, paidCents: 0 })) });
const markResponse = (source: typeof lookup, ids: string[]) => ({ ...source, reviewHash: "e".repeat(64), services: source.services.map(row => ids.includes(row.id) ? { ...row, paidCents: row.amountCents, paymentSource: "manual" } : row) });
const preexistingPaidLookup = () => { const source = syntheticLookup(); return markResponse(source, source.services.slice(0, 10).map(row => row.id)); };

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
  it("keeps loaded staff-paid service prices visible with a Paid label and unchanged period balance", async () => {
    await startAdmin(); expectRowPrice(0, "$225.00", "Paid"); expectRowPrice(1, "$225.00", "Unpaid");
    expect(text(serviceRow(0))).toContain("Paid — recorded by staff");
    expectSummary("$675.00", "$225.00", "$450.00", 0, "$0.00");
    toggleService(0); expectRowPrice(0, "$225.00", "Paid"); expectSummary("$675.00", "$225.00", "$450.00", 1, "$0.00");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("never replaces original service prices with zero after marking a subset paid", async () => {
    await startAdmin(); for (let index = 0; index < 3; index++) expectRowPrice(index, "$225.00", index === 0 ? "Paid" : "Unpaid");
    toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1"])));
    await button("Mark selected").props.onClick(); render();
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).serviceIds).toEqual(["service-1"]);
    for (let index = 0; index < 3; index++) expectRowPrice(index, "$225.00", index < 2 ? "Paid" : "Unpaid");
    expect(text(serviceRow(1))).toContain("Paid — recorded by staff"); expectSummary("$675.00", "$450.00", "$225.00", 3, "$225.00");
    expect(window.location.assign).not.toHaveBeenCalled();
  });
  it("shows a partial admin service's original price and remaining amount without invoicing the paid portion", async () => {
    const source = { ...lookup, services: lookup.services.map((row, index) => index === 2 ? { ...row, paidCents: 10000 } : row) };
    await startAdmin(source); expectRowPrice(2, "$225.00", /\$125\.00/i); expect(text(rowPrice(2))).toMatch(/remaining/i);
    expect(text(serviceRow(2))).toContain("$100.00 payment recorded"); expectSummary("$675.00", "$325.00", "$350.00", 0, "$0.00");
    toggleService(0); toggleService(2); expectSummary("$675.00", "$325.00", "$350.00", 2, "$125.00");
    expect(text(find("label", "I confirm payment was already received"))).toContain("1 selected unpaid service ($125.00)");
    change("Payment due date", "2026-11-14"); confirm("I reviewed these service"); fetchMock.mockImplementation(() => response(issueResult));
    await button("Create invoice page").props.onClick(); expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({ serviceIds: ["service-0", "service-2"], reviewHash: source.reviewHash });
  });
  it("keeps live client and date inputs blank", () => { page = () => InvoiceCollectionPage({}); fetchMock.mockImplementation(() => response({ paymentsReady: true })); render(); expect(field("Client phone").props.value).toBe(""); expect(field("From service date").props.value).toBe(""); expect(field("To service date").props.value).toBe(""); });
  it("shows the full eligible period immediately after pulling with zero services selected", async () => {
    await startAdmin();
    expectSummary("$675.00", "$225.00", "$450.00", 0, "$0.00");
    expect(selectedServiceInputs()).toHaveLength(0); expect(checkbox("Select all eligible").props.checked).toBe(false);
    expect(button("Mark selected").props.disabled).toBe(true); expect(button("Create invoice page").props.disabled).toBe(true);
    await button("Mark selected").props.onClick(); await button("Create invoice page").props.onClick();
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/payable-invoices/admin/status", "/api/payable-invoices/admin/lookup"]);
    expect(window.location.assign).not.toHaveBeenCalled();
  });
  it("immediately shows ten preexisting paid dates and two unpaid dates without another click or mark", async () => {
    await startAdmin(preexistingPaidLookup());
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 0, "$0.00");
    expect(selectedServiceInputs()).toHaveLength(0); expect(checkbox("Select all eligible").props.checked).toBe(false);
    expect(elements().filter(node => node.props?.className?.includes("ic-service-row"))).toHaveLength(12);
    expect(text(tree)).toContain("Paid — recorded by staff"); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/payable-invoices/admin/status", "/api/payable-invoices/admin/lookup"]);
  });
  it("selecting only a paid date leaves the $400 period remainder and zero selected invoice balance", async () => {
    await startAdmin(preexistingPaidLookup()); toggleService(0);
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 1, "$0.00");
    expect(serviceInput(0).props.checked).toBe(true); expect(selectedServiceInputs()).toHaveLength(1);
    expect(checkbox("I confirm payment was already received").props.disabled).toBe(true);
    await button("Mark selected").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("selecting paid and unpaid subsets changes only selected count and selected invoice balance", async () => {
    await startAdmin(preexistingPaidLookup()); toggleService(0); toggleService(10);
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 2, "$170.00");
    expect(text(find("label", "I confirm payment was already received"))).toContain("1 selected unpaid service ($170.00)");
    toggleService(11); expectSummary("$2,280.00", "$1,880.00", "$400.00", 3, "$400.00");
    toggleService(10); expectSummary("$2,280.00", "$1,880.00", "$400.00", 2, "$230.00");
    expect(selectedServiceInputs()).toHaveLength(2); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("deselecting all services preserves period totals and disables invoice actions", async () => {
    await startAdmin(preexistingPaidLookup()); selectAll(); expectSummary("$2,280.00", "$1,880.00", "$400.00", 12, "$400.00");
    selectAll(); expectSummary("$2,280.00", "$1,880.00", "$400.00", 0, "$0.00");
    expect(selectedServiceInputs()).toHaveLength(0); expect(checkbox("Select all eligible").props.checked).toBe(false);
    change("Payment due date", "2026-11-14"); confirm("I reviewed these service");
    expect(button("Create invoice page").props.disabled).toBe(true); expect(button("Mark selected").props.disabled).toBe(true);
    await button("Create invoice page").props.onClick(); await button("Mark selected").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("a fresh re-pull after marking uses recorded paid state but resets selection without losing the period remainder", async () => {
    const source = syntheticLookup(); const ids = source.services.slice(0, 10).map(row => row.id); const recorded = markResponse(source, ids);
    await startAdmin(source); for (let i = 0; i < 10; i++) toggleService(i);
    confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(recorded)); await button("Mark selected").props.onClick(); render();
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).serviceIds).toEqual(ids);
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 12, "$400.00");
    fetchMock.mockImplementation(() => response(recorded)); await button("Pull bookings").props.onClick(); render();
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 0, "$0.00");
    expect(selectedServiceInputs()).toHaveLength(0); expect(checkbox("Select all eligible").props.checked).toBe(false);
    expect(text(tree)).toContain("Paid — recorded by staff"); expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/payable-invoices/admin/status", "/api/payable-invoices/admin/lookup", "/api/payable-invoices/admin/mark-paid", "/api/payable-invoices/admin/lookup"]);
  });
  it("a remounted builder pulling recorded paid state starts unselected with the correct period totals", async () => {
    const source = syntheticLookup(); const ids = source.services.slice(0, 10).map(row => row.id); const recorded = markResponse(source, ids);
    await startAdmin(source); for (let i = 0; i < 10; i++) toggleService(i);
    confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(recorded)); await button("Mark selected").props.onClick(); render();
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 12, "$400.00");
    hooks.cleanups.forEach(cleanup => cleanup()); hooks.slots = []; hooks.cursor = 0; hooks.effectCursor = 0; hooks.effects = []; hooks.cleanups = []; hooks.dependencies = [];
    await startAdmin(recorded); expectSummary("$2,280.00", "$1,880.00", "$400.00", 0, "$0.00");
    expect(selectedServiceInputs()).toHaveLength(0); expect(checkbox("Select all eligible").props.checked).toBe(false);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/payable-invoices/admin/status", "/api/payable-invoices/admin/lookup", "/api/payable-invoices/admin/mark-paid", "/api/payable-invoices/admin/status", "/api/payable-invoices/admin/lookup"]);
  });
  it("excludes ineligible paid and unpaid rows from every payable period total", async () => {
    const source = preexistingPaidLookup();
    source.services = source.services.map((row, index) => index === 0 || index === 11 ? { ...row, eligible: false, reason: "Needs review" } : row);
    await startAdmin(source); expectSummary("$1,862.00", "$1,692.00", "$170.00", 0, "$0.00");
    expect(serviceInput(0).props.disabled).toBe(true); expect(serviceInput(11).props.disabled).toBe(true); expect(text(tree)).toContain("Needs review");
    selectAll(); expectSummary("$1,862.00", "$1,692.00", "$170.00", 10, "$170.00");
    expect(serviceInput(0).props.checked).toBe(false); expect(serviceInput(11).props.checked).toBe(false); expect(selectedServiceInputs()).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("counts partial payments across the period before any selection and only their unpaid balance when selected", async () => {
    const source = { ...lookup, services: lookup.services.map((row, index) => index === 2 ? { ...row, paidCents: 10000 } : row) };
    await startAdmin(source); expectSummary("$675.00", "$325.00", "$350.00", 0, "$0.00");
    toggleService(0); toggleService(2); expectSummary("$675.00", "$325.00", "$350.00", 2, "$125.00");
    expect(text(find("label", "I confirm payment was already received"))).toContain("1 selected unpaid service ($125.00)");
    toggleService(1); expectSummary("$675.00", "$325.00", "$350.00", 3, "$350.00");
    selectAll(); expectSummary("$675.00", "$325.00", "$350.00", 0, "$0.00"); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("clears period and selected totals as a replacement lookup starts and leaves them clear on failure", async () => {
    await startAdmin(preexistingPaidLookup()); toggleService(10); expectSummary("$2,280.00", "$1,880.00", "$400.00", 1, "$170.00");
    let resolve!: (value: any) => void; fetchMock.mockImplementation(() => new Promise(value => { resolve = value; })); const pending = button("Pull bookings").props.onClick(); render();
    expectSummary("$0.00", "$0.00", "$0.00", 0, "$0.00"); expect(text(tree)).toContain("No services loaded");
    resolve({ ok: false, json: async () => ({ message: "Lookup unavailable. Try again." }) }); await pending; render();
    expectSummary("$0.00", "$0.00", "$0.00", 0, "$0.00"); expect(text(tree)).toContain("Lookup unavailable. Try again.");
    expect(text(tree)).not.toContain("Verified Client"); expect(button("Create invoice page").props.disabled).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([["Client phone", "+12025550999"], ["Billing email", "other@example.test"], ["From service date", "2026-08-01"], ["To service date", "2026-11-06"]])("changing %s resets period totals and selection", async (label, value) => {
    await startAdmin(preexistingPaidLookup()); toggleService(10); change("Payment due date", "2026-11-14"); confirm("I reviewed these service");
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 1, "$170.00"); change(label, value);
    expectSummary("$0.00", "$0.00", "$0.00", 0, "$0.00"); expect(text(tree)).toContain("No services loaded");
    expect(text(tree)).not.toContain("Verified Client"); expect(selectedServiceInputs()).toHaveLength(0);
    expect(checkbox("I reviewed these service").props.checked).toBe(false); expect(button("Create invoice page").props.disabled).toBe(true); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("keeps manual-paid and issue payloads scoped to a deliberate paid plus unpaid subset", async () => {
    const source = preexistingPaidLookup(); await startAdmin(source); toggleService(0); toggleService(10);
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 2, "$170.00"); confirm("I confirm payment was already received");
    fetchMock.mockImplementation(() => response(markResponse(source, ["synthetic-10"]))); await button("Mark selected").props.onClick(); render();
    const [markUrl, markOptions] = fetchMock.mock.calls.at(-1)!; const markPayload = JSON.parse(markOptions.body);
    expect(markUrl).toBe("/api/payable-invoices/admin/mark-paid"); expect(markOptions.method).toBe("POST"); expect(markPayload.requestId).toEqual(expect.any(String));
    expect(markPayload).toEqual({ requestId: markPayload.requestId, clientId: 42, from: "2026-07-22", to: "2026-11-07", serviceIds: ["synthetic-10"], reviewHash: source.reviewHash });
    expectSummary("$2,280.00", "$2,050.00", "$230.00", 12, "$230.00"); expect(checkbox("Select all eligible").props.checked).toBe(true);
    selectAll(); toggleService(0); toggleService(11); expectSummary("$2,280.00", "$2,050.00", "$230.00", 2, "$230.00");
    change("Payment due date", "2026-11-14"); expect(button("Create invoice page").props.disabled).toBe(true); confirm("I reviewed these service");
    fetchMock.mockImplementation(() => response(issueResult)); await button("Create invoice page").props.onClick(); render();
    const [issueUrl, issueOptions] = fetchMock.mock.calls.at(-1)!; const issuePayload = JSON.parse(issueOptions.body);
    expect(issueUrl).toBe("/api/payable-invoices/admin/issue"); expect(issueOptions.method).toBe("POST"); expect(issuePayload.requestId).toEqual(expect.any(String));
    expect(issuePayload).toEqual({ requestId: issuePayload.requestId, clientId: 42, from: "2026-07-22", to: "2026-11-07", dueDate: "2026-11-14", serviceIds: ["synthetic-0", "synthetic-11"], reviewHash: "e".repeat(64), confirmedUnpaid: true });
    expect(fetchMock).toHaveBeenCalledTimes(4); expect(window.location.assign).not.toHaveBeenCalled(); expect(button("Send invoice").props.disabled).toBe(true);
  });
  it("includes staff-paid dates in select-all, with only balance due", async () => { await startAdmin(); selectAll(); expect(checkbox("Select all eligible").props.checked).toBe(true); expect(text(tree)).toContain("Paid — recorded by staff"); expect(text(tree)).toContain("Remaining balance$450.00"); });
  it("records a subset and immediately includes every eligible date and period remainder before issue", async () => { await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response({ ...lookup, reviewHash: "d".repeat(64), services: lookup.services.map(row => row.id === "service-1" ? { ...row, paidCents: row.amountCents, paymentSource: "manual" } : row) })); await button("Mark selected").props.onClick(); render(); expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).serviceIds).toEqual(["service-1"]); expect(checkbox("Select all eligible").props.checked).toBe(true); expect(summary("Selected services")).toBe("Selected services3"); expect(text(tree)).toContain("Remaining balance$225.00"); expect(serviceInput(0).props.checked).toBe(true); expect(serviceInput(1).props.checked).toBe(true); change("Payment due date", "2026-11-14"); expect(button("Create invoice page").props.disabled).toBe(true); confirm("I reviewed these service"); fetchMock.mockImplementation(() => response(issueResult)); await button("Create invoice page").props.onClick(); const payload = JSON.parse(fetchMock.mock.calls.at(-1)![1].body); expect(payload.serviceIds).toEqual(["service-0", "service-1", "service-2"]); expect(payload.reviewHash).toBe("d".repeat(64)); });
  it("requires inline confirmation and records only selected unpaid source rows", async () => { await startAdmin(); selectAll(); expect(button("Mark selected").props.disabled).toBe(true); confirm("I confirm payment was already received"); const updated = { ...lookup, reviewHash: "b".repeat(64), services: lookup.services.map(row => ({ ...row, paidCents: row.amountCents, paymentSource: "manual" })) }; fetchMock.mockImplementation(() => response(updated)); await button("Mark selected").props.onClick(); render(); const [url, options] = fetchMock.mock.calls.at(-1)!; expect(url).toBe("/api/payable-invoices/admin/mark-paid"); expect(JSON.parse(options.body)).toMatchObject({ clientId: 42, from: "2026-07-22", to: "2026-11-07", serviceIds: ["service-1", "service-2"], reviewHash: lookup.reviewHash }); expect(JSON.parse(options.body)).not.toHaveProperty("confirmed"); expect(checkbox("Select all eligible").props.checked).toBe(true); expect(text(tree)).toContain("Remaining balance$0.00"); expect(fetchMock).toHaveBeenCalledTimes(3); });
  it("issues with reviewed IDs/hash and never sends an email automatically", async () => { await startAdmin(); selectAll(); change("Payment due date", "2026-11-14"); confirm("I reviewed these service"); expect(button("Create invoice page").props.disabled).toBe(false); fetchMock.mockImplementation(() => response(issueResult)); await button("Create invoice page").props.onClick(); render(); const [url, options] = fetchMock.mock.calls.at(-1)!; expect(url).toBe("/api/payable-invoices/admin/issue"); expect(JSON.parse(options.body)).toMatchObject({ serviceIds: ["service-0", "service-1", "service-2"], reviewHash: lookup.reviewHash }); expect(find("a", "Download PDF").props.href).toBe("/api/payable-invoices/admin/77/pdf"); expect(button("Send invoice").props.disabled).toBe(true); expect(text(tree)).toContain(lookup.client.email); expect(fetchMock).toHaveBeenCalledTimes(3); confirm("Send this invoice to"); fetchMock.mockImplementation(() => response({ message: "Invoice sent." })); await button("Send invoice").props.onClick(); render(); const sendCall = fetchMock.mock.calls.at(-1)!; expect(sendCall[0]).toBe("/api/payable-invoices/admin/77/send"); expect(JSON.parse(sendCall[1].body)).toMatchObject({ confirmed: true }); expect(text(tree)).toContain("Invoice email sent."); });
  it("uses returned review hash after prior payment and preserves selection IDs", async () => { await startAdmin(); checkbox("Select all eligible").props.onChange(); render(); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response({ ...lookup, reviewHash: "c".repeat(64), services: lookup.services.map(row => ({ ...row, paidCents: row.amountCents, paymentSource: "manual" })) })); await button("Mark selected").props.onClick(); render(); change("Payment due date", "2026-11-14"); confirm("I reviewed these service"); fetchMock.mockImplementation(() => response(issueResult)); await button("Create invoice page").props.onClick(); expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).reviewHash).toBe("c".repeat(64)); });
  it.each([["Client phone", "+12025550999"], ["Billing email", "other@example.test"], ["From service date", "2026-08-01"], ["To service date", "2026-11-06"]])("rejects a stale lookup after %s changes without restoring totals", async (label, value) => { await startAdmin(); let resolve!: (value: any) => void; fetchMock.mockImplementation(() => new Promise(value => { resolve = value; })); const pending = button("Pull bookings").props.onClick(); const signal = fetchMock.mock.calls.at(-1)![1].signal; change(label, value); expect(signal.aborted).toBe(true); expectSummary("$0.00", "$0.00", "$0.00", 0, "$0.00"); resolve({ ok: true, json: async () => lookup }); await pending; render(); expect(text(tree)).not.toContain("Verified Client"); expect(text(tree)).toContain("No services loaded"); expectSummary("$0.00", "$0.00", "$0.00", 0, "$0.00"); });
  it("surfaces actual configuration messages rather than an approval gate", async () => { page = () => InvoiceCollectionPage({}); fetchMock.mockImplementation(() => response({ paymentsReady: false, message: "Stripe key missing." })); render(); await flush(); render(); expect(text(tree)).toContain("Stripe key missing."); expect(text(tree)).not.toContain("need approval first"); });
  it("preserves server errors, chosen rows and totals after failed marking", async () => { await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response({ message: "Services changed. Pull bookings again." }, false)); await button("Mark selected").props.onClick(); render(); expect(text(tree)).toContain("Services changed. Pull bookings again."); expect(serviceInput(0).props.checked).toBe(false); expect(serviceInput(1).props.checked).toBe(true); expect(serviceInput(2).props.checked).toBe(false); expectSummary("$675.00", "$225.00", "$450.00", 1, "$225.00"); expect(fetchMock).toHaveBeenCalledTimes(3); });
  it("records only ten manually selected rows then immediately shows twelve dates and $400 remaining", async () => {
    const source = syntheticLookup(); const ids = source.services.slice(0, 10).map(row => row.id);
    expect(source.services.reduce((sum, row) => sum + row.amountCents, 0)).toBe(228000);
    expect(source.services.slice(0, 10).reduce((sum, row) => sum + row.amountCents, 0)).toBe(188000);
    await startAdmin(source); for (let i = 0; i < 10; i++) toggleService(i);
    expect(button("Mark selected").props.disabled).toBe(true); await button("Mark selected").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(2);
    confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(source, ids))); await button("Mark selected").props.onClick(); render();
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).serviceIds).toEqual(ids);
    expect(checkbox("Select all eligible").props.checked).toBe(true); expect(summary("Selected services")).toBe("Selected services12");
    expectSummary("$2,280.00", "$1,880.00", "$400.00", 12, "$400.00");
    expect(elements().filter(node => node.type === "input" && node.props["aria-label"]?.startsWith("Include ") && node.props.checked)).toHaveLength(12);
    expect(text(tree)).toContain("Paid — recorded by staff"); expect(checkbox("I confirm payment was already received").props.checked).toBe(false); expect(checkbox("I reviewed these service").props.checked).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3); expect(window.location.assign).not.toHaveBeenCalled();
    change("Payment due date", "2026-11-14"); await button("Create invoice page").props.onClick(); expect(fetchMock).toHaveBeenCalledTimes(3);
    confirm("I reviewed these service"); fetchMock.mockImplementation(() => response(issueResult)); await button("Create invoice page").props.onClick(); render();
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({ serviceIds: source.services.map(row => row.id), reviewHash: "e".repeat(64) });
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/payable-invoices/admin/status", "/api/payable-invoices/admin/lookup", "/api/payable-invoices/admin/mark-paid", "/api/payable-invoices/admin/issue"]); expect(button("Send invoice").props.disabled).toBe(true);
  });
  it("keeps ineligible unpaid rows visible but unselected and unbilled after marking", async () => {
    const source = { ...lookup, services: lookup.services.map((row, index) => index === 2 ? { ...row, eligible: false, reason: "Needs review" } : row) };
    await startAdmin(source); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(source, ["service-1"]))); await button("Mark selected").props.onClick(); render();
    expect(checkbox("Select all eligible").props.checked).toBe(true); expect(summary("Selected services")).toBe("Selected services2"); expect(text(tree)).toContain("Remaining balance$0.00"); expect(serviceInput(2).props.checked).toBe(false); expect(serviceInput(2).props.disabled).toBe(true); expect(text(tree)).toContain("Needs review");
    change("Payment due date", "2026-11-14"); confirm("I reviewed these service"); fetchMock.mockImplementation(() => response(issueResult)); await button("Create invoice page").props.onClick(); expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).serviceIds).toEqual(["service-0", "service-1"]);
  });
  it("includes a partial payment balance on an unselected eligible date after marking", async () => {
    const source = { ...lookup, services: lookup.services.map((row, index) => index === 2 ? { ...row, paidCents: 10000 } : row) };
    await startAdmin(source); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(source, ["service-1"]))); await button("Mark selected").props.onClick(); render();
    expectSummary("$675.00", "$550.00", "$125.00", 3, "$125.00"); expect(serviceInput(2).props.checked).toBe(true); expect(text(tree)).toContain("$100.00 payment recorded"); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("manual reselection after marking updates invoice IDs without collecting or sending automatically", async () => {
    await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1"]))); await button("Mark selected").props.onClick(); render();
    change("Payment due date", "2026-11-14"); confirm("I reviewed these service"); toggleService(2);
    expectSummary("$675.00", "$450.00", "$225.00", 2, "$0.00"); expect(button("Create invoice page").props.disabled).toBe(true); expect(checkbox("I reviewed these service").props.checked).toBe(false);
    toggleService(2); toggleService(0); expectSummary("$675.00", "$450.00", "$225.00", 2, "$225.00"); expect(fetchMock).toHaveBeenCalledTimes(3);
    confirm("I reviewed these service"); fetchMock.mockImplementation(() => response(issueResult)); await button("Create invoice page").props.onClick(); render(); expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body)).toMatchObject({ serviceIds: ["service-1", "service-2"], reviewHash: "e".repeat(64) }); expect(fetchMock).toHaveBeenCalledTimes(4); expect(window.location.assign).not.toHaveBeenCalled(); expect(button("Send invoice").props.disabled).toBe(true);
  });
  it("ignores a pending mark response after the period changes", async () => {
    await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); let resolve!: (value: any) => void; fetchMock.mockImplementation(() => new Promise(value => { resolve = value; })); const pending = button("Mark selected").props.onClick();
    const signal = fetchMock.mock.calls.at(-1)![1].signal; change("From service date", "2026-08-01"); expect(signal.aborted).toBe(true); resolve({ ok: true, json: async () => markResponse(lookup, ["service-1"]) }); await pending; render();
    expect(text(tree)).toContain("No services loaded"); expect(text(tree)).not.toContain("Verified Client"); expectSummary("$0.00", "$0.00", "$0.00", 0, "$0.00"); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("ignores a pending mark response after admin unmount", async () => {
    await startAdmin(); toggleService(1); confirm("I confirm payment was already received"); let resolve!: (value: any) => void; fetchMock.mockImplementation(() => new Promise(value => { resolve = value; })); const pending = button("Mark selected").props.onClick(); hooks.cleanups.forEach(cleanup => cleanup());
    const snapshot = JSON.stringify(hooks.slots); resolve({ ok: true, json: async () => markResponse(lookup, ["service-1"]) }); await pending; expect(JSON.stringify(hooks.slots)).toBe(snapshot); expect(fetchMock.mock.calls.at(-1)![1].signal.aborted).toBe(true);
  });
  it("reports real prior payments but does not issue or access checkout when readiness is false", async () => {
    await startAdmin(lookup, false); toggleService(1); confirm("I confirm payment was already received"); fetchMock.mockImplementation(() => response(markResponse(lookup, ["service-1"]))); await button("Mark selected").props.onClick(); render();
    expect(summary("Already paid")).toBe("Already paid$450.00"); expect(text(tree)).toContain("Remaining balance$225.00"); change("Payment due date", "2026-11-14"); confirm("I reviewed these service"); expect(button("Create invoice page").props.disabled).toBe(true); await button("Create invoice page").props.onClick(); render();
    expect(text(tree)).toContain("Secure payments unavailable."); expect(fetchMock).toHaveBeenCalledTimes(3); expect(fetchMock.mock.calls.map(call => call[0])).toEqual(["/api/payable-invoices/admin/status", "/api/payable-invoices/admin/lookup", "/api/payable-invoices/admin/mark-paid"]); expect(window.location.assign).not.toHaveBeenCalled();
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
