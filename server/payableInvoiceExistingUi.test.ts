import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import * as shared from "../shared/payableInvoice";
import { describe, expect, it, vi } from "vitest";

/** LOCAL ONLY: transpiles actual TSX, uses actual shared money helpers and explicit
 * synthetic transports. The hook driver tests callbacks/cleanup, not React DOM
 * scheduling or browser layout. No app/server imports, database, SDK or network. */
const root = resolve(import.meta.dirname, "..");
const pagePath = "client/src/pages/InvoiceCollection.tsx";
const panelPath = "client/src/components/invoices/ExistingInvoicePanel.tsx";
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const baseline = execFileSync("git", ["show", `ee90b8b1823d2e5f72aa9f6c4f9d5f0f7854e351:${pagePath}`], {
  cwd: root, encoding: "utf8", env: { PATH: process.env.PATH }, maxBuffer: 512 * 1024,
});
const publicUrl = `https://invoice.example.test/invoice/${"a".repeat(64)}`;
const client: shared.InvoiceClient = { id: 3, name: "Synthetic Client", phone: "+12025550100", email: "synthetic@example.test" };
function fixture(amounts: number[] = [1000, 23000]): shared.InvoiceExistingView {
  return { client, url: publicUrl, reviewHash: "b".repeat(64), invoice: {
    id: 17, number: "INV-0017", clientId: client.id, clientName: client.name,
    from: "2026-11-01", to: "2026-11-30", dueDate: "2026-12-10", status: "open", currency: "usd",
    activeAttemptId: null, receipts: [], lines: amounts.map((amountCents, i) => ({
      id: i + 1, occurrenceKey: `job:${i + 1}`, date: `2026-11-${String(i + 1).padStart(2, "0")}`,
      description: `Synthetic service ${i + 1}`, address: "Synthetic address", amountCents, paidCents: 0, manualPaidCents: 0,
    })),
  } };
}
function summary(view: shared.InvoiceExistingView): shared.InvoiceExistingSummary {
  return { id: view.invoice.id, number: view.invoice.number, clientName: view.client.name,
    from: view.invoice.from, to: view.invoice.to, dueDate: view.invoice.dueDate, status: view.invoice.status,
    amountCents: shared.invoiceTotal(view.invoice.lines), paidCents: shared.safeSum(view.invoice.lines.map(row => row.paidCents)), balanceCents: shared.invoiceBalance(view.invoice.lines) };
}
function record(view: shared.InvoiceExistingView, ids: number[]): shared.InvoiceExistingView {
  const next = structuredClone(view);
  for (const row of next.invoice.lines) if (ids.includes(row.id)) { row.paidCents = row.amountCents; row.manualPaidCents = row.amountCents; }
  next.invoice.status = shared.invoiceBalance(next.invoice.lines) === 0 ? "paid" : "partially_paid";
  next.reviewHash = "c".repeat(64);
  return next;
}
function elements(tree: any): any[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!React.isValidElement(tree)) return [];
  return [tree, ...elements((tree.props as any).children)];
}
const text = (tree: any): string => tree == null || typeof tree === "boolean" ? "" : typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement(tree) ? text((tree.props as any).children) : "";
const node = (tree: any, type: string, label: string) => {
  const found = elements(tree).find(item => item.type === type && (text(item) === label || item.props["aria-label"] === label));
  expect(found, `${type}: ${label}`).toBeDefined(); return found;
};
function deferred<T = any>() {
  let resolve!: (value: T) => void; let reject!: (value: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const icon = (props: any) => React.createElement("svg", props);
const panelStub = () => React.createElement("section", null, "Synthetic panel mount");
function compile(source: string, hooks: any, scope: Record<string, any> = {}) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, { module, exports: module.exports, Error, Date, Intl, URL, AbortController,
    crypto: { randomUUID }, ...scope,
    require: (id: string) => {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith("shared/payableInvoice")) return shared;
      if (id === "lucide-react") return new Proxy({}, { get: () => icon });
      if (id.endsWith("ExistingInvoicePanel")) return { default: panelStub };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected actual-source dependency: ${id}`);
    },
  }, { timeout: 1000 });
  return module.exports;
}
function driver(source: string, exported: string, props: any, scope: Record<string, any> = {}) {
  const slots: any[] = [];
  let cursor = 0, dead = false, lateWrites = 0;
  let jobs: Array<() => void> = [];
  const hooks = {
    useState(initial: any) {
      const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: any) => { if (dead) { lateWrites++; return; } slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect: () => any, deps?: any[]) {
      const index = cursor++, old = slots[index];
      if (!old || !deps || deps.length !== old.deps?.length || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        slots[index] = { deps, cleanup: old?.cleanup };
        jobs.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  const loaded = compile(source, hooks, scope);
  return { loaded,
    render() { cursor = 0; const tree = loaded[exported](props); const pending = jobs; jobs = []; pending.forEach(run => run()); return { tree, html: renderToStaticMarkup(tree) }; },
    dispose() { slots.forEach(slot => slot?.cleanup?.()); dead = true; jobs = []; },
    get lateWrites() { return lateWrites; },
  };
}
function harness(initial = fixture(), custom?: (path: string, method?: string, body?: any, signal?: AbortSignal) => Promise<any>) {
  let saved = structuredClone(initial);
  const request = vi.fn(custom ?? (async (path, method, body) => {
    if (path === "/admin/existing/search") return { invoices: [summary(saved)], nextBeforeId: null };
    if (path === `/admin/existing/${saved.invoice.id}` && method === "GET") return structuredClone(saved);
    if (path === `/admin/existing/${saved.invoice.id}/mark-paid` && method === "POST") { saved = record(saved, body.lineIds); return structuredClone(saved); }
    throw new Error(`Unexpected synthetic request ${path}`);
  }));
  const copied = vi.fn(async (_value: string) => {}), onCreateNew = vi.fn();
  const h = driver(read(panelPath), "default", { request, onCreateNew }, { window: { location: { origin: "https://invoice.example.test" } }, navigator: { clipboard: { writeText: copied } } });
  const render = () => h.render();
  const click = async (label: string) => node(render().tree, "button", label).props.onClick();
  const find = async () => elements(render().tree).find(item => item.type === "form")!.props.onSubmit({ preventDefault: vi.fn() });
  const open = async () => { await click(`Open ${initial.invoice.number}`); await tick(); };
  const select = (id: number) => {
    const input = elements(render().tree).find(item => item.type === "input" && item.props["aria-label"]?.includes(`Nov ${id},`));
    expect(input).toBeDefined(); input!.props.onChange();
  };
  const confirm = () => {
    const label = elements(render().tree).find(item => item.type === "label" && text(item).startsWith("I confirm payment"));
    expect(label).toBeDefined(); elements(label).find(item => item.type === "input")!.props.onChange({ target: { checked: true } });
  };
  const ready = async () => { render(); await find(); await tick(); await open(); };
  const changeSearch = (value: string) => elements(render().tree).find(item => item.type === "input" && item.props.id === "ic-existing-search")!.props.onChange({ target: { value } });
  return { h, request, copied, onCreateNew, render, click, find, open, select, confirm, ready, changeSearch };
}

describe("existing invoice actual-source UI, synthetic transport only", () => {
  it("mounts idle and typing performs no search, poll, status check or financial write", async () => {
    const h = harness(); expect(h.render().html).toContain("Find invoices"); h.changeSearch("synthetic@example.test");
    h.render(); await tick(); expect(h.request).not.toHaveBeenCalled();
    expect(h.render().html).not.toContain('type="date"');
    await h.find(); await tick(); expect(h.request.mock.calls[0]).toEqual(["/admin/existing/search", "POST", { search: "synthetic@example.test" }, expect.any(AbortSignal)]);
    expect(h.request.mock.calls[0][0]).not.toContain("?");
  });
  it("shows original $10 and $230, saves only confirmed selected IDs, keeps original price and updates list and balances", async () => {
    const h = harness(); await h.ready(); const before = h.render();
    expect(before.html).toContain("Original price $10.00"); expect(before.html).toContain("Original price $230.00");
    expect(before.html).toContain("$240.00"); h.select(1);
    expect(node(h.render().tree, "button", "Save invoice updates").props.disabled).toBe(true);
    await h.click("Save invoice updates"); expect(h.request).toHaveBeenCalledTimes(2);
    h.confirm(); await h.click("Save invoice updates"); await tick(); const after = h.render();
    const write = h.request.mock.calls[2]; expect(write[0]).toBe("/admin/existing/17/mark-paid"); expect(write[1]).toBe("POST");
    expect(write[2]).toEqual({ requestId: expect.stringMatching(/^[a-f0-9-]{36}$/), lineIds: [1], reviewHash: "b".repeat(64), confirmed: true });
    expect(after.html).toContain("Original price $10.00"); expect(after.html).toContain("Original price $230.00");
    expect(after.html).toContain("Paid — recorded by staff"); expect(after.html).toContain("$230.00 remaining");
    expect(after.html).toContain("Remaining $0.00"); expect(after.html).toContain("No charge was made");
    expect(elements(after.tree).find(item => item.type === "a")!.props.href).toBe(publicUrl);
    expect(h.request.mock.calls.map(call => call[0])).toEqual(["/admin/existing/search", "/admin/existing/17", "/admin/existing/17/mark-paid"]);
    await h.click("Copy invoice link"); expect(h.copied).toHaveBeenCalledWith(publicUrl);
    expect(h.request).toHaveBeenCalledTimes(3);
  });
  it("selects all fully unpaid lines; zero balance is paid/read-only with the same invoice number and URL", async () => {
    const h = harness(); await h.ready();
    const selectAll = elements(h.render().tree).find(item => item.type === "label" && text(item) === "Select all fully unpaid lines");
    elements(selectAll).find(item => item.type === "input")!.props.onChange(); h.confirm();
    await h.click("Save invoice updates"); await tick(); const view = h.render();
    expect(h.request.mock.calls[2][2]).toMatchObject({ lineIds: [1, 2] });
    expect(view.html).toContain("INV-0017"); expect(view.html).toContain("$0.00 remaining");
    expect(view.html).toContain("fully paid and read-only"); expect(view.html).not.toContain("Save invoice updates");
    expect(elements(view.tree).find(item => item.type === "a")!.props.href).toBe(publicUrl);
    expect(view.html).toContain("Original price $230.00");
  });
  it("manual pagination retains its exact search, appends stable IDs and never loads beyond the explicit page", async () => {
    const first = fixture(), second = fixture(); second.invoice.id = 16; second.invoice.number = "INV-0016";
    const h = harness(first, async (_path, _method, body) => body.beforeId ? { invoices: [summary(first), summary(second)], nextBeforeId: null } : { invoices: [summary(first)], nextBeforeId: 17 });
    h.render(); h.changeSearch("  Synthetic Client  "); await h.find(); await tick();
    expect(h.request).toHaveBeenCalledTimes(1); await h.click("Load more invoices"); await tick();
    expect(h.request.mock.calls[1][2]).toEqual({ search: "Synthetic Client", beforeId: 17 });
    expect(elements(h.render().tree).filter(item => item.type === "button" && text(item) === "Open INV-0017")).toHaveLength(1);
    expect(h.render().html).toContain("Open INV-0016"); expect(h.render().html).not.toContain("Load more invoices");
    h.changeSearch("other"); expect(h.render().html).not.toContain("INV-0017"); expect(h.request).toHaveBeenCalledTimes(2);
  });
  it("bounds a returned page to 50 rows and suppresses a non-progressing cursor", async () => {
    const h = harness(fixture(), async (_path, _method, body) => ({ invoices: Array.from({ length: 60 }, (_, i) => ({ ...summary(fixture()), id: 100 - i, number: `INV-${100 - i}` })), nextBeforeId: body.beforeId ?? 50 }));
    h.render(); await h.find(); await tick();
    expect(elements(h.render().tree).filter(item => item.type === "button" && text(item).startsWith("Open INV-"))).toHaveLength(50);
    await h.click("Load more invoices"); await tick(); expect(h.render().html).not.toContain("Load more invoices");
  });
  it("partial Stripe paid lines stay read-only, while fully unpaid lines remain selectable", async () => {
    const data = fixture(); data.invoice.status = "partially_paid"; data.invoice.lines[0].paidCents = 400;
    const h = harness(data); await h.ready(); const view = h.render();
    expect(view.html).toContain("Partially paid — needs staff review"); expect(view.html).toContain("Remaining $6.00");
    const rows = elements(view.tree).filter(item => item.type === "input" && item.props["aria-label"]);
    expect(rows[0].props.disabled).toBe(true); expect(rows[1].props.disabled).toBe(false);
    h.select(1); h.select(2); h.confirm(); await h.click("Save invoice updates"); await tick();
    expect(h.request.mock.calls[2][2]).toMatchObject({ lineIds: [2] });
  });
  it.each(["paid", "void", "payment_review"] as const)("%s invoices cannot select or manually record any line", async status => {
    const data = fixture(); data.invoice.status = status; if (status === "paid") data.invoice.lines.forEach(row => row.paidCents = row.amountCents);
    const h = harness(data); await h.ready(); const view = h.render();
    expect(view.html).toContain("read-only"); expect(view.html).not.toContain("Save invoice updates");
    expect(elements(view.tree).filter(item => item.type === "input" && item.props.type === "checkbox").every(item => item.props.disabled)).toBe(true);
    h.select(1); expect(h.request).toHaveBeenCalledTimes(2);
  });
  it("active checkout attempt blocks manual recording but permits explicit saved-data refresh", async () => {
    const data = fixture(); data.invoice.activeAttemptId = "synthetic-attempt";
    const h = harness(data); await h.ready(); expect(h.render().html).toContain("checkout is in progress");
    expect(h.render().html).not.toContain("Save invoice updates"); await h.click("Refresh saved invoice"); await tick();
    expect(h.request.mock.calls.map(call => call[0])).toEqual(["/admin/existing/search", "/admin/existing/17", "/admin/existing/17"]);
    expect(h.request.mock.calls[2][1]).toBe("GET");
  });
  it("busy guards coalesce duplicate save clicks and freeze selection/search/confirmation; ambiguous retry reuses UUID", async () => {
    const failure = deferred(), data = fixture();
    const h = harness(data, async (path, _method, body) => path.endsWith("search") ? { invoices: [summary(data)], nextBeforeId: null } : path.endsWith("mark-paid") ? failure.promise : data);
    await h.ready(); h.select(2); h.confirm(); const old = h.render();
    const saveButton = node(old.tree, "button", "Save invoice updates"); saveButton.props.onClick(); saveButton.props.onClick();
    h.select(1); h.changeSearch("changed");
    const confirmation = elements(old.tree).find(item => item.type === "label" && text(item).startsWith("I confirm payment"));
    elements(confirmation).find(item => item.type === "input")!.props.onChange({ target: { checked: false } });
    expect(h.request).toHaveBeenCalledTimes(3); expect(h.render().html).toContain("Saving invoice updates");
    expect(elements(h.render().tree).find(item => item.props.id === "ic-existing-search")!.props.disabled).toBe(true);
    expect(elements(h.render().tree).filter(item => item.type === "input" && item.props.type === "checkbox").every(item => item.props.disabled)).toBe(true);
    const input = h.request.mock.calls[2][2]; failure.reject(new Error("Invoice data is temporarily unavailable.")); await tick();
    expect(h.render().html).toContain("temporarily unavailable"); expect(h.render().html).not.toContain("Invoice updated.");
    h.request.mockImplementationOnce(async () => record(data, [2])); await h.click("Save invoice updates"); await tick();
    expect(h.request.mock.calls[3][2]).toEqual(input); expect(input).toMatchObject({ lineIds: [2] });
    expect(h.render().html).toContain("Invoice updated.");
  });
  it("selection changes invalidate confirmation and rotate the request UUID after a failure", async () => {
    const h = harness(); await h.ready(); h.select(1); h.confirm(); h.request.mockRejectedValueOnce(new Error("Synthetic network failure"));
    await h.click("Save invoice updates"); await tick(); const oldId = (h.request.mock.calls[2][2] as any).requestId;
    h.select(2); expect(node(h.render().tree, "button", "Save invoice updates").props.disabled).toBe(true);
    h.confirm(); await h.click("Save invoice updates"); await tick(); expect((h.request.mock.calls[3][2] as any).requestId).not.toBe(oldId);
  });
  it("authorization error is visible, does not claim payment and preserves the same retry input", async () => {
    const h = harness(); await h.ready(); h.select(1); h.confirm(); h.request.mockRejectedValueOnce(new Error("Sign in with an active administrator account."));
    await h.click("Save invoice updates"); await tick(); expect(h.render().html).toContain("Sign in with an active administrator account.");
    expect(h.render().html).not.toContain("Invoice updated."); const input = h.request.mock.calls[2][2];
    await h.click("Save invoice updates"); await tick(); expect(h.request.mock.calls[3][2]).toEqual(input);
  });
  it("review-changed error allows manual GET refresh, clears selection/confirmation, and uses the newly read review hash", async () => {
    const h = harness(); await h.ready(); h.select(1); h.confirm(); h.request.mockRejectedValueOnce(new Error("Invoice changed. Refresh the invoice before recording payment."));
    await h.click("Save invoice updates"); await tick(); expect(h.render().html).toContain("Invoice changed.");
    const latest = fixture(); latest.reviewHash = "d".repeat(64); h.request.mockResolvedValueOnce(latest);
    await h.click("Refresh saved invoice"); await tick(); expect(h.render().html).not.toContain("Invoice changed.");
    expect(node(h.render().tree, "button", "Save invoice updates").props.disabled).toBe(true);
    expect(elements(h.render().tree).filter(item => item.type === "input" && item.props.type === "checkbox").every(item => !item.props.checked)).toBe(true);
    h.select(2); h.confirm(); await h.click("Save invoice updates"); await tick();
    expect(h.request.mock.calls[4][2]).toMatchObject({ reviewHash: "d".repeat(64), lineIds: [2] });
  });
  it("replacement search clears stale detail, selections, confirmations and errors", async () => {
    const h = harness(); await h.ready(); h.select(1); h.confirm(); h.request.mockRejectedValueOnce(new Error("Synthetic error"));
    await h.click("Save invoice updates"); await tick(); h.changeSearch("other client");
    expect(h.render().html).not.toContain("Synthetic error"); expect(h.render().html).not.toContain("INV-0017");
    await h.find(); await tick(); await h.open();
    expect(node(h.render().tree, "button", "Save invoice updates").props.disabled).toBe(true);
  });
  it("late lookup and GET responses cannot replace a new search/detail", async () => {
    const lookup = deferred(), old = deferred(), data = fixture(), newer = fixture(); newer.invoice.id = 16; newer.invoice.number = "INV-0016";
    const h = harness(data, async path => path.endsWith("search") ? { invoices: [summary(data), summary(newer)], nextBeforeId: null } : path.endsWith("/17") ? old.promise : newer);
    h.render(); h.request.mockImplementationOnce(() => lookup.promise); h.find(); h.changeSearch("next"); await h.find(); await tick();
    lookup.resolve({ invoices: [{ ...summary(data), number: "STALE" }], nextBeforeId: 17 }); await tick(); expect(h.render().html).not.toContain("STALE");
    h.click("Open INV-0017"); await h.click("Open INV-0016"); await tick();
    old.resolve(data); await tick(); expect(h.render().html).toContain("<h2>INV-0016</h2>"); expect(h.render().html).not.toContain("<h2>INV-0017</h2>");
    expect(h.request.mock.calls[0][3]!.aborted).toBe(true); expect(h.request.mock.calls[2][3]!.aborted).toBe(true);
  });
  it.each(["search", "open", "save"])("unmount aborts and ignores late %s result", async phase => {
    const pending = deferred(), h = harness(); h.render();
    if (phase !== "search") { await h.find(); await tick(); if (phase === "save") await h.open(); }
    h.request.mockImplementationOnce(() => pending.promise);
    if (phase === "search") h.find(); else if (phase === "open") h.click("Open INV-0017"); else { h.select(1); h.confirm(); h.click("Save invoice updates"); }
    const signal = h.request.mock.calls.at(-1)![3]!; h.h.dispose(); expect(signal.aborted).toBe(true);
    pending.resolve(phase === "search" ? { invoices: [summary(fixture())], nextBeforeId: null } : record(fixture(), [1])); await tick();
    expect(h.h.lateWrites).toBe(0);
  });
  it("cent precision and zero-priced lines are preserved; unsafe amounts cannot be manually recorded", async () => {
    const h = harness(fixture([0, 101, 202])); await h.ready(); const view = h.render();
    expect(view.html).toContain("Original price $0.00"); expect(view.html).toContain("Original price $1.01"); expect(view.html).toContain("$3.03");
    const inputs = elements(view.tree).filter(item => item.type === "input" && item.props["aria-label"]); expect(inputs[0].props.disabled).toBe(true);
    h.select(2); h.select(3); h.confirm(); expect(h.render().html).toContain("2 selected service lines ($3.03)");
    const loaded = compile(read(panelPath), React);
    expect(loaded.existingInvoiceAmounts(fixture([Number.MAX_SAFE_INTEGER]).invoice)).toBeNull();
    const invalid = fixture(); invalid.invoice.lines[0].paidCents = 1001;
    expect(loaded.existingInvoiceAmounts(invalid.invoice)).toBeNull();
    const invalidUi = harness(invalid, async path => path.endsWith("search") ? { invoices: [], nextBeforeId: null } : invalid);
    invalidUi.render(); invalidUi.request.mockResolvedValueOnce({ invoices: [summary(fixture())], nextBeforeId: null }); await invalidUi.find(); await tick(); await invalidUi.open();
    expect(invalidUi.render().html).toContain("Invoice amounts need review"); expect(invalidUi.render().html).not.toContain("Save invoice updates");
  });
  it("rejects arbitrary/protocol/cross-origin/PII URLs; links are explicit and use the same safe URL", async () => {
    const loaded = compile(read(panelPath), React), origin = "https://invoice.example.test";
    expect(loaded.existingInvoicePublicUrl(publicUrl, origin)).toBe(publicUrl);
    expect(loaded.existingInvoicePublicUrl(`/invoice/${"a".repeat(64)}`, origin)).toBe(publicUrl);
    for (const url of ["javascript:alert(1)", "data:text/html,x", publicUrl.replace("https:", "http:"), publicUrl.replace("invoice.example.test", "evil.example.test"), `${publicUrl}?email=private@example.test`, `${publicUrl}#private`, publicUrl.replace("/invoice/", "/other/"), publicUrl.replace("https://", "https://private:secret@")]) expect(loaded.existingInvoicePublicUrl(url, origin)).toBeNull();
    const data = fixture(); data.url = "javascript:alert(1)"; const h = harness(data); await h.ready();
    expect(h.render().html).not.toContain("Open customer page"); expect(h.render().html).not.toContain("Copy invoice link");
    expect(h.copied).not.toHaveBeenCalled(); expect(h.request).toHaveBeenCalledTimes(2);
  });
});

describe("source-exact creation/customer preservation and minimal mount", () => {
  it("the four additive integration lines are the only page changes against the approved HEAD", () => {
    const restored = read(pagePath).split("\n").filter(line => !line.includes('import ExistingInvoicePanel from ') && !line.includes('const [existingMode, setExistingMode]') && !line.includes('if (!review && existingMode) return') && !line.includes('Open existing invoice</button>')).join("\n");
    expect(restored).toBe(baseline);
    expect(read(pagePath).split("export function CustomerInvoicePage")[1]).toBe(baseline.split("export function CustomerInvoicePage")[1]);
  });
  it("actual review SSR is unchanged and all review actions remain request-free", async () => {
    const blocked = vi.fn(() => { throw new Error("No transport permitted in static review"); });
    const current = driver(read(pagePath), "InvoiceCollectionPage", { review: true }, { fetch: blocked });
    const control = driver(baseline, "InvoiceCollectionPage", { review: true }, { fetch: blocked });
    expect(current.render().html).toBe(control.render().html); expect(current.render().html).not.toContain("Open existing invoice");
    node(current.render().tree, "button", "Pull bookings").props.onClick(); await tick();
    const confirmation = elements(current.render().tree).find(item => item.type === "label" && text(item).startsWith("I confirm payment"));
    elements(confirmation).find(item => item.type === "input")!.props.onChange({ target: { checked: true } });
    node(current.render().tree, "button", "Mark selected services already paid").props.onClick(); await tick();
    node(current.render().tree, "button", "Preview customer page").props.onClick(); await tick();
    expect(blocked).not.toHaveBeenCalled();
  });
  it("passes the original generic request helper and switching back retains creation input and status without new polling", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ paymentsReady: true }) }));
    const h = driver(read(pagePath), "InvoiceCollectionPage", { review: false }, { fetch }); h.render(); await tick();
    const phone = elements(h.render().tree).find(item => item.type === "label" && text(item) === "Client phone");
    elements(phone).find(item => item.type === "input")!.props.onChange({ target: { value: "+12025550100" } });
    node(h.render().tree, "button", "Open existing invoice").props.onClick();
    const panel = elements(h.render().tree).find(item => item.type === panelStub); expect(panel).toBeDefined();
    await panel.props.request("/admin/existing/search", "POST", { search: "" }, new AbortController().signal);
    expect(fetch.mock.calls[1][0]).toBe("/api/payable-invoices/admin/existing/search");
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: "POST", credentials: "same-origin", referrerPolicy: "no-referrer", body: '{"search":""}' });
    panel.props.onCreateNew(); const restored = h.render(); expect(restored.html).toContain("Create invoice page"); expect(restored.html).toContain('value="+12025550100"');
    expect(fetch.mock.calls.filter(call => call[0].endsWith("/admin/status"))).toHaveLength(1);
  });
  it("full actual creation lookup/mark/issue/send handlers keep the original body, all unpaid auto-inclusion, and full prices", async () => {
    const rows: shared.InvoiceService[] = [1, 2].map(i => ({ id: `job:${i}`, occurrenceKey: `job:${i}`, date: `2026-11-0${i}`, description: "Synthetic service", address: "Synthetic address", amountCents: i === 1 ? 1000 : 23000, paidCents: 0, paymentSource: null, status: "completed", eligible: true, reason: null }));
    const run = async (source: string) => {
      const fetch = vi.fn(async (url: string, init: any) => {
        const body = init.body ? JSON.parse(init.body) : null;
        let result: any;
        if (url.endsWith("/status")) result = { paymentsReady: true };
        else if (url.endsWith("/lookup")) result = { client, services: rows, reviewHash: "b".repeat(64) };
        else if (url.endsWith("/mark-paid")) result = { client, services: rows.map(row => row.id === "job:1" ? { ...row, paidCents: row.amountCents, paymentSource: "manual" } : row), reviewHash: "c".repeat(64) };
        else if (url.endsWith("/issue")) result = { invoice: fixture().invoice, url: publicUrl };
        else if (url.endsWith("/send")) result = { message: "Synthetic send acknowledged" };
        else throw new Error(`Unexpected creation transport ${url}`);
        return { ok: true, json: async () => result };
      });
      const h = driver(source, "InvoiceCollectionPage", { review: false }, { fetch }); h.render(); await tick();
      const field = (label: string, value: string) => { const row = elements(h.render().tree).find(item => item.type === "label" && text(item) === label); elements(row).find(item => item.type === "input")!.props.onChange({ target: { value } }); };
      field("Client phone", client.phone); field("From service date", "2026-11-01"); field("To service date", "2026-11-30"); field("Payment due date", "2026-12-10");
      await node(h.render().tree, "button", "Pull bookings").props.onClick();
      expect(h.render().html).toContain("$230.00");
      const row = elements(h.render().tree).find(item => item.type === "input" && item.props["aria-label"]?.includes("Nov 1,")); row!.props.onChange();
      const confirmation = elements(h.render().tree).find(item => item.type === "label" && text(item).startsWith("I confirm payment")); elements(confirmation).find(item => item.type === "input")!.props.onChange({ target: { checked: true } });
      await node(h.render().tree, "button", "Mark selected services already paid").props.onClick();
      expect(h.render().html).toContain("$10.00"); expect(h.render().html).toContain("$230.00");
      expect(h.render().html).toContain("Paid — recorded by staff");
      await node(h.render().tree, "button", "Create invoice page").props.onClick();
      const sendConfirmation = elements(h.render().tree).find(item => item.type === "label" && text(item).startsWith("Send this invoice")); elements(sendConfirmation).find(item => item.type === "input")!.props.onChange({ target: { checked: true } });
      await node(h.render().tree, "button", "Send invoice").props.onClick();
      return fetch.mock.calls.map(([url, init]: any) => ({ url, method: init.method, body: init.body ? { ...JSON.parse(init.body), requestId: "stable-placeholder" } : null }));
    };
    const current = await run(read(pagePath)), control = await run(baseline); expect(current).toEqual(control);
    expect(current[2].body).toMatchObject({ serviceIds: ["job:1"], reviewHash: "b".repeat(64) });
    expect(current[3].body).toMatchObject({ serviceIds: ["job:2"], confirmedUnpaid: true, reviewHash: "c".repeat(64) });
    expect(current[4].body).toMatchObject({ confirmed: true });
  });
});
