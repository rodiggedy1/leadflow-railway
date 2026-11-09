import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { PayableInvoice } from "../../../shared/payableInvoice";

// Like the existing isolated hook harness, but functional state updates do not
// execute in setState. They commit at the next render, after refresh has returned
// and mutated its refs. This catches the first-load initialized.current race.
const hooks = vi.hoisted(() => ({
  slots: [] as any[], cursor: 0, effectCursor: 0,
  effects: [] as (() => void)[], cleanups: [] as (() => void)[],
  dependencies: [] as any[][],
  pending: [] as { index: number; update: (previous: any) => any }[],
}));
vi.mock("react", async importOriginal => ({
  ...(await importOriginal<any>()),
  useState: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (value: any) => {
      if (typeof value === "function") hooks.pending.push({ index, update: value });
      else hooks.slots[index] = value;
    }];
  },
  useRef: (initial: any) => {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useEffect: (effect: () => any, deps: any[]) => {
    const index = hooks.effectCursor++;
    if (!hooks.dependencies[index] || deps.some((value, i) => value !== hooks.dependencies[index][i])) {
      hooks.dependencies[index] = deps;
      hooks.effects.push(() => {
        hooks.cleanups[index]?.();
        const cleanup = effect();
        if (cleanup) hooks.cleanups[index] = cleanup;
      });
    }
  },
}));
import { CustomerInvoicePage } from "./InvoiceCollection";

const fetchMock = vi.fn();
let tree: ReactElement<any>;
const microtasks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const render = () => {
  for (const { index, update } of hooks.pending.splice(0)) hooks.slots[index] = update(hooks.slots[index]);
  hooks.cursor = 0; hooks.effectCursor = 0;
  tree = CustomerInvoicePage({});
  hooks.effects.splice(0).forEach(effect => effect());
  return tree;
};
const descendants = (node: any): ReactElement<any>[] => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(descendants) : [node, ...descendants(node.props?.children)];
const text = (node: any): string => node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(text).join("") : text(node.props?.children);
const button = (label: string) => {
  const node = descendants(tree).find(node => node.type === "button" && text(node).includes(label));
  expect(node, `Expected button ${label}`).toBeDefined();
  return node!;
};
const rowInputs = () => descendants(tree).filter(node => node.type === "input" && node.props["aria-label"]?.startsWith("Pay "));
const selectedIds = () => rowInputs().filter(node => node.props.checked).map(node => {
  const index = rowInputs().indexOf(node);
  return (hooks.slots[0] as PayableInvoice).lines[index].id;
});
const expectSelection = (ids: number[], amount: string) => {
  expect(selectedIds()).toEqual(ids);
  expect(text(tree)).toContain(`Selected service dates${ids.length}`);
  expect(text(tree)).toContain(`Total to pay${amount}`);
};
const line = (id: number, amountCents: number, paidCents = 0): PayableInvoice["lines"][number] => ({ id, occurrenceKey: `job:${id}`, date: `2026-11-${String(id % 10 + 1).padStart(2, "0")}`, description: `Service ${id}`, address: "Test address", amountCents, paidCents });
const invoice = (): PayableInvoice => ({ id: 901, number: "TEST-DEFERRED", clientId: 0, clientName: "Matched customer", from: "2026-11-01", to: "2026-11-09", dueDate: "2026-11-16", currency: "usd", status: "partially_paid", receipts: [], activeAttemptId: null, lines: [line(11, 500, 500), line(12, 500), line(13, 700, 200)] });
const response = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
const reply = (value: PayableInvoice) => fetchMock.mockImplementation(() => response({ invoice: value, paymentsReady: true }));
const firstLoad = async (value = invoice()) => {
  reply(value); render(); await microtasks();
  // No render has committed the functional updater yet, even though the response
  // continuation has completed and initialized.current is now true.
  expect(hooks.pending).toHaveLength(1);
  expect(hooks.slots[1]).toEqual([]);
  render();
};
const refresh = async (value: PayableInvoice) => {
  reply(value); await button("Check payment status").props.onClick();
  expect(hooks.pending).toHaveLength(1);
  render();
};

beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.effectCursor = 0; hooks.effects = []; hooks.cleanups = []; hooks.dependencies = []; hooks.pending = [];
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { location: { pathname: "/invoice/first-token", origin: "https://local.example.test", assign: vi.fn() } });
  vi.stubGlobal("document", { querySelector: () => null, createElement: () => ({ remove: vi.fn() }), head: { appendChild: vi.fn() } });
});
afterEach(() => { hooks.cleanups.forEach(cleanup => cleanup()); vi.unstubAllGlobals(); });

describe("customer invoice deferred functional selection", () => {
  it("defaults to every unpaid ID after first refresh completes, with a nonzero enabled payment and exact checkout IDs", async () => {
    await firstLoad();
    expectSelection([12, 13], "$10.00");
    expect(rowInputs()[0].props).toMatchObject({ checked: false, disabled: true });
    expect(button("Pay $10.00").props.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(() => response({ url: "https://checkout.stripe.com/c/pay/test_deferred" }));
    await button("Pay $10.00").props.onClick(); render();
    const [path, options] = fetchMock.mock.calls.at(-1)!;
    expect(path).toBe("/api/payable-invoices/first-token/checkout");
    expect(JSON.parse(options.body)).toEqual({ requestId: expect.any(String), lineIds: [12, 13] });
    expect(window.location.assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/test_deferred");
  });

  it("later refresh preserves deselection, does not add new unpaid IDs, and removes newly paid selected IDs", async () => {
    await firstLoad(); rowInputs()[1].props.onChange();
    expect(hooks.pending).toHaveLength(1); render();
    expectSelection([13], "$5.00");
    const next = { ...invoice(), lines: [...invoice().lines, line(14, 900)] };
    await refresh(next); expectSelection([13], "$5.00");
    await refresh({ ...next, lines: next.lines.map(row => row.id === 13 ? { ...row, paidCents: row.amountCents } : row) });
    expectSelection([], "$0.00");
    expect(button("Pay $0.00").props.disabled).toBe(true);
    expect(fetchMock.mock.calls.every(([path, options]) => path === "/api/payable-invoices/first-token" && options.method === "GET")).toBe(true);
  });

  it("a token change resets initialization and selects the new invoice unpaid IDs without remounting the harness", async () => {
    await firstLoad();
    rowInputs()[1].props.onChange(); render(); rowInputs()[2].props.onChange(); render();
    expectSelection([], "$0.00");
    const next = { ...invoice(), id: 902, number: "TEST-SECOND", lines: [line(21, 500, 500), line(22, 800), line(23, 400)] };
    window.location.pathname = "/invoice/second-token";
    reply(next); render(); await microtasks();
    expect(hooks.pending).toHaveLength(1); expect(hooks.slots[1]).toEqual([]);
    render(); expectSelection([22, 23], "$12.00");
    expect(button("Pay $12.00").props.disabled).toBe(false);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/payable-invoices/first-token", "/api/payable-invoices/second-token"]);
  });

  it("active attempts retain their exact unpaid IDs on first load and later refresh and resume instead of checkout", async () => {
    await firstLoad({ ...invoice(), activeAttemptId: "active", activeLineIds: [12, 11, 999] });
    expectSelection([12], "$5.00");
    expect(rowInputs().every(node => node.props.disabled)).toBe(true);
    rowInputs()[1].props.onChange(); render(); expectSelection([12], "$5.00");
    await refresh({ ...invoice(), activeAttemptId: "active", activeLineIds: [13, 11, 999] });
    expectSelection([13], "$5.00"); expect(button("Resume secure checkout").props.disabled).toBe(false);
    fetchMock.mockImplementation(() => response({ url: "https://checkout.stripe.com/c/pay/test_resume" }));
    await button("Resume secure checkout").props.onClick(); render();
    const [path, options] = fetchMock.mock.calls.at(-1)!;
    expect(path).toBe("/api/payable-invoices/first-token/resume"); expect(JSON.parse(options.body)).toEqual({});
    expect(fetchMock.mock.calls.some(([path]) => path.endsWith("/checkout"))).toBe(false);
    expect(window.location.assign).toHaveBeenCalledTimes(1);
  });
});
