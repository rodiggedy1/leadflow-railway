import React from "react";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(new URL("../client/src/components/BookingTeamMagicLink.tsx", import.meta.url), "utf8");
const controlTower = readFileSync(new URL("../client/src/components/ControlTowerTab.tsx", import.meta.url), "utf8");
type Element = React.ReactElement<Record<string, any>>;
const elements = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(elements) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...elements(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" ? tree : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const props = { source: "booking", id: 71, assignedTeamName: "Synthetic team" };
// The existing cleaner mutation returns only these fields, not booking identity.
const result = { url: "https://synthetic.example/auth/cleaner-callback?token=synthetic%2Btoken&exact=1#keep", cleanerName: "Synthetic cleaner" };
const button = (tree: Element) => elements(tree).find(node => node.type === "button")!;
const hasUrl = (tree: Element) => elements(tree).some(node => node.type === "a" || node.type === "input");
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(options: { response?: unknown; mutation?: any; clipboard?: any; profile?: any } = {}) {
  const slots: any[] = [];
  let cursor = 0;
  const cleanups: Array<() => void> = [];
  const clipboard = options.clipboard === undefined ? { writeText: vi.fn(async () => {}) } : options.clipboard;
  const mutation = options.mutation ?? { isPending: false, mutateAsync: vi.fn(async () => options.response ?? result) };
  const profile = options.profile ?? { data: { cleanerProfileId: 501, teamName: "Synthetic team", source: "booking", id: 71 }, isFetching: false, error: null };
  const useQuery = vi.fn(() => profile);
  const useMutation = vi.fn(() => mutation);
  const react = { ...React,
    useRef(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next: unknown) => { slots[i] = next; }]; },
    useEffect(create: () => (() => void) | void) { const i = cursor++; if (!(i in slots)) { slots[i] = true; const cleanup = create(); if (cleanup) cleanups.push(cleanup); } },
  };
  const module = { exports: {} as { BookingTeamMagicLink: (p: any) => Element } };
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  runInNewContext(output, { module, exports: module.exports, React, navigator: { clipboard }, Error,
    require: (id: string) => {
      if (id === "react") return react;
      if (id === "lucide-react") { const Icon = (p: any) => React.createElement("svg", p); return { Copy: Icon, ExternalLink: Icon, Loader2: Icon }; }
      // No other RPC, mutation, utility, sender or account/token engine is available.
      if (id === "@/lib/trpc") return { trpc: {
        bookings: { teamPortalProfile: { useQuery } },
        cleaner: { getMagicLink: { useMutation } },
      } };
      throw new Error(`Unexpected import: ${id}`);
    },
  }, { timeout: 1500 });
  return {
    mutation, clipboard, profile, useQuery, useMutation,
    render: (p: any = props) => { cursor = 0; return module.exports.BookingTeamMagicLink(p); },
    unmount: () => cleanups.forEach(cleanup => cleanup()),
  };
}

describe("Booking detail existing assigned-team portal link", () => {
  it("resolves only the read-only profile on render and never requests, copies or opens a link", () => {
    const h = harness(); const tree = h.render();
    expect(h.useQuery).toHaveBeenCalledWith({ source: "booking", id: 71 }, { enabled: true, staleTime: 0, refetchOnMount: "always" });
    expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
    expect(h.clipboard.writeText).not.toHaveBeenCalled();
    expect(text(button(tree))).toBe("Copy team portal link");
    expect(hasUrl(tree)).toBe(false);
    expect(source.match(/\.useMutation\(/g)).toHaveLength(1);
    expect(source).toContain("trpc.cleaner.getMagicLink.useMutation()");
    expect(source).not.toMatch(/teamMagicLink|sendMagicLink|window\.location|fetch\(|\/auth\/|staffMagicLink/);
  });

  it("calls the direct existing cleaner mutation once with the exact ControlTower payload and account ID, never the booking ID", async () => {
    const h = harness(); await button(h.render()).props.onClick();
    expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.mutation.mutateAsync).toHaveBeenCalledWith({ cleanerProfileId: 501, origin: "https://quote.maidinblack.com" });
    expect(controlTower).toContain("trpc.cleaner.getMagicLink.useMutation(");
    expect(controlTower).toContain('origin: "https://quote.maidinblack.com"');
    expect(h.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(h.clipboard.writeText).toHaveBeenCalledWith(result.url);
    const tree = h.render(); const anchor = elements(tree).find(node => node.type === "a")!;
    expect(anchor.props.href).toBe(result.url);
    expect(anchor.props.target).toBe("_blank");
    expect(anchor.props.rel).toBe("noopener noreferrer");
    expect(text(anchor)).toBe("Open portal");
    const input = elements(tree).find(node => node.type === "input")!;
    expect(input.props.readOnly).toBe(true); expect(input.props.value).toBe(result.url);
    const select = vi.fn(); input.props.onFocus({ currentTarget: { select } }); expect(select).toHaveBeenCalledTimes(1);
    expect(text(tree)).toContain("Synthetic team's portal link copied.");
  });

  it("resolves the exact imported source/ID and uses its linked account, not a native-ID fallback", async () => {
    const profile = { data: { cleanerProfileId: 602, teamName: "Imported team", source: "leadflow", id: 83 }, isFetching: false };
    const h = harness({ profile }); await button(h.render({ ...props, source: "leadflow", id: 83 })).props.onClick();
    expect(h.useQuery).toHaveBeenCalledWith({ source: "leadflow", id: 83 }, { enabled: true, staleTime: 0, refetchOnMount: "always" });
    expect(h.mutation.mutateAsync).toHaveBeenCalledWith({ cleanerProfileId: 602, origin: "https://quote.maidinblack.com" });
    expect(h.clipboard.writeText).toHaveBeenCalledWith(result.url);
  });

  it.each([null, ""])('does not enable profile resolution or link controls without an assigned team (%s)', async assignedTeamName => {
    const h = harness(); const tree = h.render({ ...props, assignedTeamName });
    expect(h.useQuery).toHaveBeenCalledWith({ source: "booking", id: 71 }, { enabled: false, staleTime: 0, refetchOnMount: "always" });
    expect(button(tree).props.disabled).toBe(true);
    await button(tree).props.onClick(); expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Assign a team to access its portal link.");
  });

  it("does not enable the read query or request a link when disabled", async () => {
    const h = harness(); const tree = h.render({ ...props, disabled: true });
    expect(h.useQuery).toHaveBeenCalledWith({ source: "booking", id: 71 }, { enabled: false, staleTime: 0, refetchOnMount: "always" });
    expect(button(tree).props.disabled).toBe(true);
    await button(tree).props.onClick(); expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it.each([
    { data: undefined, isFetching: true },
    { data: undefined, isFetching: false },
    { data: { cleanerProfileId: 501, source: "booking", id: 71 }, isFetching: true },
    { data: { cleanerProfileId: 501, source: "leadflow", id: 71 }, isFetching: false },
    { data: { cleanerProfileId: 501, source: "booking", id: 72 }, isFetching: false },
    { data: { cleanerProfileId: 0, source: "booking", id: 71 }, isFetching: false },
    { data: { cleanerProfileId: -1, source: "booking", id: 71 }, isFetching: false },
    { data: { cleanerProfileId: null, source: "booking", id: 71 }, isFetching: false },
  ])("does not request a link before the current account is authoritatively resolved: %j", async profile => {
    const h = harness({ profile }); const tree = h.render();
    expect(button(tree).props.disabled).toBe(true);
    await button(tree).props.onClick(); expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
    expect(h.clipboard.writeText).not.toHaveBeenCalled(); expect(hasUrl(tree)).toBe(false);
  });

  it("reports read-only profile errors without falling back to a generic account or URL", async () => {
    const h = harness({ profile: { data: undefined, isFetching: false, error: new Error("The assigned team's active portal account could not be verified.") } });
    const tree = h.render(); await button(tree).props.onClick();
    expect(text(tree)).toContain("active portal account could not be verified.");
    expect(h.mutation.mutateAsync).not.toHaveBeenCalled(); expect(hasUrl(tree)).toBe(false);
  });

  it("prevents a second request while the existing mutation is pending", async () => {
    const mutation = { isPending: true, mutateAsync: vi.fn() };
    const h = harness({ mutation }); const tree = h.render();
    expect(button(tree).props.disabled).toBe(true); expect(text(button(tree))).toBe("Getting link…");
    await button(tree).props.onClick(); expect(mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("prevents a synchronous double-click even before mutation pending state rerenders", async () => {
    const pending = deferred();
    const mutation = { isPending: false, mutateAsync: vi.fn(() => pending.promise) };
    const h = harness({ mutation }); const tree = h.render(); const first = button(tree).props.onClick();
    await button(tree).props.onClick(); expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
    pending.resolve(result); await first; expect(h.clipboard.writeText).toHaveBeenCalledTimes(1);
  });

  it.each(["absent", "denied"])("keeps the exact returned link selectable when clipboard is %s", async mode => {
    const clipboard = mode === "absent" ? null : { writeText: vi.fn(async () => { throw new Error("Synthetic clipboard denial"); }) };
    const h = harness({ clipboard }); await button(h.render()).props.onClick();
    const tree = h.render(); expect(elements(tree).find(node => node.type === "input")?.props.value).toBe(result.url);
    expect(text(tree)).toContain("Select and copy the link below.");
    expect(text(tree)).not.toContain("portal link copied.");
  });

  it("uses the returned cleaner label when the resolved team name is null", async () => {
    const h = harness(); h.profile.data.teamName = null;
    await button(h.render()).props.onClick();
    expect(text(h.render())).toContain("Synthetic cleaner's portal link copied.");
  });

  it("does not copy or display a mutation response after unmount", async () => {
    const pending = deferred(); const mutation = { isPending: false, mutateAsync: vi.fn(() => pending.promise) };
    const h = harness({ mutation }); const click = button(h.render()).props.onClick();
    h.unmount(); pending.resolve(result); await click;
    expect(h.clipboard.writeText).not.toHaveBeenCalled(); expect(hasUrl(h.render())).toBe(false);
  });

  it.each([
    { source: "booking", id: 72, assignedTeamName: "Synthetic team" },
    { source: "leadflow", id: 71, assignedTeamName: "Synthetic team" },
    { source: "booking", id: 71, assignedTeamName: "Another team" },
    { source: "booking", id: 71, assignedTeamName: null },
    { ...props, disabled: true },
  ])("suppresses stale mutation responses on a same-mounted booking/assignment change: %j", async nextProps => {
    const pending = deferred(); const mutation = { isPending: false, mutateAsync: vi.fn(() => pending.promise) };
    const h = harness({ mutation }); const click = button(h.render()).props.onClick();
    h.render(nextProps); pending.resolve(result); await click;
    expect(h.clipboard.writeText).not.toHaveBeenCalled(); expect(hasUrl(h.render(nextProps))).toBe(false);
  });

  it("suppresses the response synchronously when reassignment starts before any rerender or unmount", async () => {
    const pending = deferred(); const mutation = { isPending: false, mutateAsync: vi.fn(() => pending.promise) };
    const assignmentVersionRef = { current: 0 }; const p = { ...props, assignmentVersionRef };
    const h = harness({ mutation }); const click = button(h.render(p)).props.onClick();
    assignmentVersionRef.current += 1; pending.resolve(result); await click;
    expect(h.clipboard.writeText).not.toHaveBeenCalled(); expect(hasUrl(h.render(p))).toBe(false);
  });

  it("blocks a stale click handler synchronously when the reassignment version changes", async () => {
    const assignmentVersionRef = { current: 0 }; const h = harness();
    const tree = h.render({ ...props, assignmentVersionRef }); assignmentVersionRef.current += 1;
    await button(tree).props.onClick(); expect(h.mutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("suppresses responses when the resolved account changes despite an identical team name", async () => {
    const pending = deferred(); const mutation = { isPending: false, mutateAsync: vi.fn(() => pending.promise) };
    const h = harness({ mutation }); const click = button(h.render()).props.onClick();
    h.profile.data = { ...h.profile.data, cleanerProfileId: 502 }; h.render();
    pending.resolve(result); await click;
    expect(h.clipboard.writeText).not.toHaveBeenCalled(); expect(hasUrl(h.render())).toBe(false);
  });

  it("does not display a stale failure after switching bookings", async () => {
    const pending = deferred(); const mutation = { isPending: false, mutateAsync: vi.fn(() => pending.promise) };
    const h = harness({ mutation }); const click = button(h.render()).props.onClick();
    const nextProps = { ...props, id: 72 }; h.render(nextProps);
    pending.reject(new Error("Old team's failure")); await click;
    expect(text(h.render(nextProps))).not.toContain("Old team's failure"); expect(hasUrl(h.render(nextProps))).toBe(false);
  });

  it.each(["resolved", "denied"])("does not restore stale feedback when an already-started clipboard operation is %s after reassignment", async mode => {
    const pending = deferred(); const started = deferred();
    const clipboard = { writeText: vi.fn(() => { started.resolve(undefined); return pending.promise; }) };
    const assignmentVersionRef = { current: 0 }; const p = { ...props, assignmentVersionRef };
    const h = harness({ clipboard }); const click = button(h.render(p)).props.onClick();
    await started.promise; expect(clipboard.writeText).toHaveBeenCalledWith(result.url);
    assignmentVersionRef.current += 1;
    if (mode === "resolved") pending.resolve(undefined); else pending.reject(new Error("Synthetic clipboard denial"));
    await click; const tree = h.render(p);
    expect(hasUrl(tree)).toBe(false); expect(text(tree)).not.toContain("portal link copied.");
    expect(text(tree)).not.toContain("Select and copy");
  });

  it.each(["disabled", "fetching", "account", "version", "booking", "source", "team"])("immediately hides a previously returned team URL on %s change and does not resurrect it", async change => {
    const assignmentVersionRef = { current: 0 }; const p = { ...props, assignmentVersionRef };
    const h = harness(); await button(h.render(p)).props.onClick(); expect(hasUrl(h.render(p))).toBe(true);
    let nextProps = p;
    if (change === "disabled") nextProps = { ...p, disabled: true } as any;
    if (change === "fetching") h.profile.isFetching = true;
    if (change === "account") h.profile.data = { ...h.profile.data, cleanerProfileId: 502 };
    if (change === "version") assignmentVersionRef.current += 1;
    if (change === "booking") nextProps = { ...p, id: 72 };
    if (change === "source") nextProps = { ...p, source: "leadflow" };
    if (change === "team") nextProps = { ...p, assignedTeamName: "Another team" };
    expect(hasUrl(h.render(nextProps))).toBe(false);
    h.profile.isFetching = false;
    h.profile.data = { cleanerProfileId: 501, teamName: "Synthetic team", source: "booking", id: 71 };
    expect(hasUrl(h.render(p))).toBe(false);
    expect(h.mutation.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("reports existing mutation errors without inventing a URL or making another mutation", async () => {
    const mutation = { isPending: false, mutateAsync: vi.fn(async () => { throw new Error("Cleaner not found"); }) };
    const h = harness({ mutation }); await button(h.render()).props.onClick(); const tree = h.render();
    expect(text(tree)).toContain("Cleaner not found"); expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.clipboard.writeText).not.toHaveBeenCalled(); expect(hasUrl(tree)).toBe(false);
  });
});
