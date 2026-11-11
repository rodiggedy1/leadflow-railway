import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const base = "2041fa94a4cf8e2b47c40773582e07f482114987";
const internal = "client/src/components/internal-booking/";
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const original = (file: string) => execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
type Element = { type: unknown; props: Record<string, any> };
const summary = (bookingId = 91) => ({ bookingId, publicBookingNumber: `BK-${bookingId}`, customerName: "Saved Customer", customerPhone: "+12025550142", customerEmail: "saved@example.test", address: "123 Saved Street, Washington DC", requestedLocalDate: "2026-11-18", arrivalLabel: "Preferred afternoon", serviceName: "Deep cleaning", firstCleaningTotalCents: 34567, paymentStatus: "unpaid", cardLabel: null });
const link = (method = "apple_pay", bookingId = 91) => ({ bookingId, method, token: "saved-token", url: "https://example.test/payment/saved-token", expiresAt: new Date(Date.now() + 3600000).toISOString(), amountCents: 34567, customerName: "Saved Customer", customerPhone: "+12025550142", message: "Review your payment: https://example.test/payment/saved-token" });

/** Runs the real component handlers with a tiny deterministic hook/JSX harness, not a network client. */
function fixture(...targets: [number?]) {
  let bookingId = targets.length ? targets[0] : 91;
  let slots: any[] = [], index = 0;
  let effects: Array<() => void> = [];
  const cleanups: Array<() => void> = [];
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  const hooks = {
    useState(initial: any) { const slot = index++; if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial; return [slots[slot], (value: any) => { slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
    useRef(initial: any) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useEffect(effect: () => any, deps: any[]) { const slot = index++; if (!slots[slot] || deps.some((value, i) => value !== slots[slot][i])) { slots[slot] = deps; effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); } },
  };
  const query = { data: bookingId ? summary(bookingId) : undefined, isError: false, error: null as any, isFetching: false, isPending: false, refetch: vi.fn(async () => undefined) };
  const queryHook = vi.fn(() => query);
  const create = vi.fn(async (input: any) => link(input.method, input.bookingId));
  const send = vi.fn(async (_input: any) => ({ success: true, submitted: true }));
  const clipboard = vi.fn(async (_value: string) => undefined);
  const uuid = vi.fn(() => "d432d702-5ff4-4f0a-97ab-a9602716ef28");
  const exports: any = {};
  const output = ts.transpileModule(read(internal + "InternalBookingThankYou.tsx"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const requireMock = (name: string) => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (name === "@/lib/trpc") return { trpc: { bookingPaymentAdmin: { handoff: { overview: { useQuery: queryHook }, create: { useMutation: () => ({ mutateAsync: create }) }, send: { useMutation: () => ({ mutateAsync: send }) } } } } };
    if (name === "lucide-react") return new Proxy({}, { get: (_, key) => `icon-${String(key)}` });
    if (name.endsWith(".css")) return {};
    throw new Error(`Unexpected dependency: ${name}`);
  };
  new Function("require", "exports", "crypto", "navigator", output)(requireMock, exports, { randomUUID: uuid }, { clipboard: { writeText: clipboard } });
  const onOpenBookings = vi.fn(), onStartAnotherBooking = vi.fn();
  let tree: Element;
  const render = () => {
    index = 0;
    const wrapper = exports.default({ bookingId, onOpenBookings, onStartAnotherBooking });
    tree = wrapper.type(wrapper.props);
    const pending = effects; effects = []; pending.forEach(run => run());
    return tree;
  };
  const nodes = (): Element[] => {
    const list: Element[] = [];
    const walk = (node: any) => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === "object" && "props" in node) { list.push(node); walk(node.props.children); } };
    walk(tree); return list;
  };
  const textOf = (node: any): string => Array.isArray(node) ? node.map(textOf).join(" ") : node && typeof node === "object" ? textOf(node.props?.children) : node == null || typeof node === "boolean" ? "" : String(node);
  const text = () => textOf(tree);
  const byLabel = (label: string) => nodes().find(node => node.props["aria-label"] === label)!;
  const button = (label: string) => nodes().filter(node => node.type === "button" && textOf(node).trim() === label).at(-1)!;
  const click = async (label: string) => { const node = button(label) ?? byLabel(label); expect(node, label).toBeDefined(); expect(node.props.disabled, label).toBeFalsy(); await node.props.onClick(); await tick(); render(); };
  const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  const unmount = () => cleanups.splice(0).forEach(run => run());
  const switchBooking = (id: number) => { unmount(); slots = []; index = 0; bookingId = id; query.data = summary(id); render(); };
  render();
  return { render, text, nodes, byLabel, button, click, tick, query, queryHook, create, send, clipboard, uuid, unmount, switchBooking, onOpenBookings, onStartAnotherBooking };
}

describe("internal staff thank-you source boundary", () => {
  it("keeps public booking, approved screens, checkout paths, wrapper and session byte-identical", () => {
    const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", base, "client/src/components/approved-book"], { cwd: root, encoding: "utf8" }).trim().split("\n");
    paths.push("client/src/pages/Book.tsx", "client/src/App.tsx", "client/src/components/PublicBookingHeader.tsx", "client/src/pages/booking-flow-review.css", ...["InternalBookingWrapper.tsx", "InternalExactBookingApi.ts", "InternalExactBookingSession.ts", "InternalApprovedBookPayment.tsx", "BookingCheckoutTransport.tsx", "BookingPaymentCheckout.tsx", "BookingApplePayCheckout.tsx", "BookingCashAppCheckout.tsx", "internal-booking-shell.css"].map(file => internal + file));
    for (const path of paths) expect(read(path), path).toBe(original(path));
  });
  it("changes only the completion mount and one readonly native ID getter, not existing callbacks or return branches", () => {
    const file = internal + "InternalPublicBook.tsx";
    const strip = (source: string) => source.replace('import InternalBookingThankYou from "./InternalBookingThankYou";\n', "").replace(/  if \(complete\)\n    return \([\s\S]*?\n    \);/, "[completion branch]");
    expect(strip(read(file))).toBe(strip(original(file)));
    expect(read(file)).toContain("bookingId={internalBooking.bookingId}");
    expect(read(internal + "InternalBookingAdapter.ts").replace("  readonly bookingId?: number;\n", "")).toBe(original(internal + "InternalBookingAdapter.ts"));
    expect(read(internal + "useInternalExactBooking.ts").replace("    get bookingId() { return session.prepared?.bookingId; },\n", "")).toBe(original(internal + "useInternalExactBooking.ts"));
  });
  it("scopes every stylesheet selector to the new internal root", () => {
    const css = read(internal + "internal-booking-thank-you.css");
    const selectors = [...css.matchAll(/([^{}]+)\{/g)].map(match => match[1].trim()).filter(selector => !selector.startsWith("@media"));
    for (const selector of selectors) for (const item of selector.split(",")) expect(item.trim()).toMatch(/^\.internal-booking-thank-you(?:[\s.:]|$)/);
    expect(css).toContain("@media (max-width: 420px)");
    expect(css).toContain(":focus-visible");
  });
});

describe("staff handoff UI interactions (mocked transport only)", () => {
  it("mounts only the saved overview query; selection does not create, send, charge or copy", async () => {
    const f = fixture();
    expect(f.queryHook).toHaveBeenCalledWith({ bookingId: 91 }, { enabled: true, refetchInterval: false, refetchOnWindowFocus: false });
    expect(f.text()).toContain("Saved Customer"); expect(f.text()).toContain("BK-91"); expect(f.text()).toContain("$345.67"); expect(f.text()).toContain("unpaid");
    expect(f.text()).toContain("Save a card through Apple Pay"); expect(f.text()).toContain("Save a card only. No charge");
    await f.click("Send link: Apple Pay");
    expect(f.text()).toContain("Saved booking amount (no charge)");
    expect(f.text()).not.toContain("Immediate first-cleaning payment");
    expect(f.create).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled(); expect(f.clipboard).not.toHaveBeenCalled(); expect(f.uuid).not.toHaveBeenCalled();
    expect(f.button("Confirm Send")).toBeUndefined();
  });
  it.each(["Apple Pay", "Cash App", "Card on file"])("reviews the saved recipient, returned URL and message before Confirm Send for %s", async label => {
    const f = fixture(); await f.click(`Send link: ${label}`); await f.click("Create link for review");
    expect(f.create).toHaveBeenCalledWith({ bookingId: 91, method: label === "Apple Pay" ? "apple_pay" : label === "Cash App" ? "cashapp" : "card", requestId: "d432d702-5ff4-4f0a-97ab-a9602716ef28", expectedAmountCents: 34567, confirmed: true });
    expect(f.send).not.toHaveBeenCalled(); expect(f.text()).toContain("+12025550142"); expect(f.byLabel("Review link").props.value).toBe(link().url);
    expect(f.byLabel("Review message").props.value).toBe(link().message);
    await f.click("Confirm Send");
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ bookingId: 91, token: "saved-token", message: link().message, confirmed: true }));
    expect(f.text()).toContain("Delivery is not confirmed"); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("retains the UUID across an unchanged creation failure retry and hides raw API errors", async () => {
    const f = fixture(); f.create.mockRejectedValueOnce(new Error('[{"secret":"raw error"}]'));
    await f.click("Send link: Cash App"); await f.click("Create link for review");
    expect(f.text()).toContain("Link creation was not confirmed"); expect(f.text()).not.toContain("secret");
    await f.click("Create link for review"); expect(f.uuid).toHaveBeenCalledTimes(1);
    expect(f.create.mock.calls[0][0]).toEqual(f.create.mock.calls[1][0]); expect(f.send).not.toHaveBeenCalled();
  });
  it("keeps the token and exact message on unconfirmed send retries; never claims delivered", async () => {
    const f = fixture(); f.send.mockRejectedValueOnce(new Error("provider secret")).mockResolvedValueOnce({ success: false, submitted: false });
    await f.click("Send link: Apple Pay"); await f.click("Create link for review"); await f.click("Confirm Send");
    expect(f.text()).toContain("Delivery status is unknown"); expect(f.text()).not.toContain("provider secret");
    await f.click("Confirm Send"); expect(f.send.mock.calls[0][0]).toEqual(f.send.mock.calls[1][0]);
    expect(f.text()).toContain("Send was not confirmed"); expect(f.text()).not.toContain("Message submitted"); expect(f.create).toHaveBeenCalledTimes(1);
    f.send.mockResolvedValueOnce({ success: true, submitted: false }); await f.click("Confirm Send"); expect(f.text()).toContain("Send was not confirmed");
  });
  it("allows explicit message review/edit but blocks a message without the reviewed URL", async () => {
    const f = fixture(); await f.click("Send link: Apple Pay"); await f.click("Create link for review");
    f.byLabel("Review message").props.onChange({ currentTarget: { value: "No URL" } }); f.render(); expect(f.button("Confirm Send").props.disabled).toBeTruthy();
    const edited = `Hello saved customer: ${link().url}`;
    f.byLabel("Review message").props.onChange({ currentTarget: { value: edited } }); f.render(); await f.click("Confirm Send");
    expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ message: edited, token: "saved-token" }));
  });
  it("creates a copy-only link only after review; clipboard failure is visible and never sends", async () => {
    const f = fixture(); f.clipboard.mockRejectedValueOnce(new Error("denied"));
    await f.click("Copy link: Card on file"); expect(f.create).not.toHaveBeenCalled(); await f.click("Create link for review");
    expect(f.button("Confirm Send")).toBeUndefined(); await f.click("Copy link"); expect(f.text()).toContain("Could not copy the link");
    await f.click("Copy link"); expect(f.text()).toContain("Link copied. No message was sent."); expect(f.send).not.toHaveBeenCalled(); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it.each([
    { bookingId: 92 }, { method: "cashapp" }, { amountCents: 1 }, { url: "javascript:alert(1)" }, { token: "" }, { expiresAt: "2020-01-01" },
  ])("rejects unverifiable created output: %j", async change => {
    const f = fixture(); f.create.mockResolvedValueOnce({ ...link(), ...change }); await f.click("Send link: Apple Pay"); await f.click("Create link for review");
    expect(f.text()).toContain("returned link could not be verified"); expect(f.button("Confirm Send")).toBeUndefined(); expect(f.send).not.toHaveBeenCalled(); expect(f.clipboard).not.toHaveBeenCalled();
  });
  it("disables actions without an actual native ID, on query error, and on cross-booking overview", () => {
    const missing = fixture(undefined); expect(missing.queryHook).toHaveBeenCalledWith({ bookingId: 0 }, expect.objectContaining({ enabled: false })); expect(missing.byLabel("Send link: Apple Pay").props.disabled).toBeTruthy();
    const f = fixture(); f.query.data = summary(92); f.render(); expect(f.byLabel("Send link: Apple Pay").props.disabled).toBeTruthy();
    f.query.isError = true; f.query.error = new Error("raw query secret"); f.render(); expect(f.text()).not.toContain("raw query secret"); expect(f.text()).toContain("actions are disabled");
  });
  it("blocks missing recipients and changed saved amounts without creating a replacement automatically", async () => {
    const f = fixture(); f.create.mockResolvedValueOnce({ ...link(), customerPhone: null } as any); await f.click("Send link: Apple Pay"); await f.click("Create link for review");
    expect(f.button("Confirm Send").props.disabled).toBeTruthy(); expect(f.text()).toContain("No saved phone recipient");
    f.query.data!.firstCleaningTotalCents = 99999; f.render(); expect(f.text()).toContain("no longer matches"); expect(f.button("Confirm Send")).toBeUndefined(); expect(f.create).toHaveBeenCalledTimes(1);
  });
  it("ignores a late create result after switching native bookings", async () => {
    const f = fixture(); let finish!: (value: any) => void; f.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await f.click("Send link: Apple Pay"); await f.click("Create link for review"); f.switchBooking(92); finish(link()); await f.tick(); f.render();
    expect(f.text()).toContain("BK-92"); expect(f.byLabel("Review link")).toBeUndefined(); expect(f.send).not.toHaveBeenCalled();
  });
  it("ignores late send acceptance after switching bookings and does not refresh the new booking", async () => {
    const f = fixture(); let finish!: (value: any) => void; f.send.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await f.click("Send link: Apple Pay"); await f.click("Create link for review"); await f.click("Confirm Send"); f.switchBooking(92); finish({ success: true, submitted: true }); await f.tick(); f.render();
    expect(f.text()).not.toContain("Message submitted"); expect(f.query.refetch).not.toHaveBeenCalled();
  });
  it("rechecks expiry at click time even before another render", async () => {
    const f = fixture(); await f.click("Send link: Apple Pay"); await f.click("Create link for review");
    const sendClick = f.button("Confirm Send").props.onClick;
    const copyClick = f.button("Copy link").props.onClick;
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7200000);
    try {
      await sendClick(); await copyClick(); await f.tick(); f.render();
      expect(f.send).not.toHaveBeenCalled(); expect(f.clipboard).not.toHaveBeenCalled(); expect(f.text()).toContain("no longer valid");
    } finally { clock.mockRestore(); }
  });
  it("deduplicates rapid explicit create and send clicks", async () => {
    const f = fixture(); let finishCreate!: (value: any) => void;
    f.create.mockImplementationOnce(() => new Promise(resolve => { finishCreate = resolve; }));
    await f.click("Send link: Apple Pay"); const createClick = f.button("Create link for review").props.onClick;
    createClick(); createClick(); expect(f.create).toHaveBeenCalledTimes(1); finishCreate(link()); await f.tick(); f.render();
    let finishSend!: (value: any) => void; f.send.mockImplementationOnce(() => new Promise(resolve => { finishSend = resolve; }));
    const sendClick = f.button("Confirm Send").props.onClick; sendClick(); sendClick(); expect(f.send).toHaveBeenCalledTimes(1);
    finishSend({ success: true, submitted: true }); await f.tick(); f.render(); expect(f.text()).toContain("Delivery is not confirmed");
  });
  it("rejects captured mutation and clipboard handlers from an unmounted booking", async () => {
    const f = fixture(); await f.click("Send link: Apple Pay");
    const createClick = f.button("Create link for review").props.onClick; await f.click("Create link for review");
    const sendClick = f.button("Confirm Send").props.onClick, copyClick = f.button("Copy link").props.onClick;
    f.switchBooking(92); createClick(); sendClick(); copyClick(); await f.tick(); f.render();
    expect(f.create).toHaveBeenCalledTimes(1); expect(f.send).not.toHaveBeenCalled(); expect(f.clipboard).not.toHaveBeenCalled();
  });
  it("requires an explicit true success flag and does not invent provider delivery", async () => {
    const f = fixture(); f.send.mockResolvedValueOnce({} as any).mockResolvedValueOnce({ success: true } as any);
    await f.click("Send link: Apple Pay"); await f.click("Create link for review"); await f.click("Confirm Send");
    expect(f.text()).toContain("Send was not confirmed"); await f.click("Confirm Send"); expect(f.text()).toContain("Send request accepted. Delivery is not confirmed.");
  });
  it("preserves the existing explicit navigation callbacks", async () => {
    const f = fixture(); await f.click("Back to Booking CRM"); await f.click("Create another booking"); expect(f.onOpenBookings).toHaveBeenCalledTimes(1); expect(f.onStartAnotherBooking).toHaveBeenCalledTimes(1);
    expect(f.create).not.toHaveBeenCalled(); expect(f.send).not.toHaveBeenCalled();
  });
});
