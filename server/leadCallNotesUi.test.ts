import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import * as ts from "typescript";
import * as icons from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";

const path = "client/src/components/LeadCallNotes.tsx";
const source = readFileSync(path, "utf8");
const pagePath = "client/src/pages/CommandChatExactLive.tsx";
const page = readFileSync(pagePath, "utf8");
const div = ({ children }: any) => React.createElement("div", {}, children);
const Dialog = (props: any) => div(props), DialogContent = (props: any) => div(props);
type Element = React.ReactElement<Record<string, any>>;
const nodes = (tree: unknown): Element[] => Array.isArray(tree) ? tree.flatMap(nodes) : React.isValidElement<Record<string, any>>(tree) ? [tree, ...nodes(tree.props.children)] : [];
const text = (tree: unknown): string => typeof tree === "string" || typeof tree === "number" ? String(tree) : Array.isArray(tree) ? tree.map(text).join("") : React.isValidElement<Record<string, any>>(tree) ? text(tree.props.children) : "";
const note = (overrides: Record<string, any> = {}) => ({
  id: "vapi:1", provider: "vapi", providerCallId: "offline-call", source: "madison", direction: "incoming",
  startedAt: Date.UTC(2026, 10, 23, 18), durationSeconds: 135, outcome: "quote_given",
  summary: "Requested a deep clean before moving in. Asked about oven cleaning and Friday availability.",
  transcript: "Assistant: What would you like cleaned?\nCaller: Add the oven, please.",
    details: [{ label: "Cleaning type", value: "Deep cleaning" }],
    followUps: [{ taskId: 7, title: "Confirm Friday availability", evidenceQuote: "Friday would be best", status: "open" }], ...overrides,
  });
function ui(data: Record<string, any> = {}): Record<string, any> {
  const refetch = vi.fn(), useQuery = vi.fn(() => ({ data: { phone: "+12025550123", calls: [note()] }, isLoading: false, isError: false, isFetching: false, refetch, ...data }));
  const module = { exports: {} as Record<string, any> };
  runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module, exports: module.exports, Date, JSON, Math, require: (id: string) => {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "lucide-react") return icons;
      if (id === "@/lib/trpc") return { trpc: { voice: { getLeadCallNotes: { useQuery } } } };
      if (id === "@/components/ui/dialog") return { Dialog, DialogContent, DialogDescription: div, DialogTitle: div };
      if (id.endsWith(".css")) return {};
      throw new Error(`Unexpected UI import: ${id}`);
    } }, { timeout: 1500 });
  return { ...module.exports, useQuery, refetch };
}
const lead = { name: "Synthetic lead", phone: "2025550123", sessionId: 42 };

function declaration(value: string, name: string) {
  const parsed = ts.createSourceFile(pagePath, value, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = parsed.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!found) throw new Error(`Missing ${name}`);
  return found.getText(parsed);
}
function queue(): Record<string, any> {
  const values: unknown[] = []; let cursor = 0;
  const ReactMock = { ...React,
    useState(initial: unknown) { const slot = cursor++; if (!(slot in values)) values[slot] = initial; return [values[slot], (next: unknown) => { values[slot] = next; }]; },
    useRef(initial: unknown) { const slot = cursor++; if (!(slot in values)) values[slot] = { current: initial }; return values[slot]; },
    useEffect() {},
  };
  const component = ui(), props = { title: "All leads", description: "Newest first", leads: [{ ...lead, id: 123, ts: 1_800_000_000_000, receivedAt: 1_800_000_000_000, queue: "incoming", sourceLabel: "Thumbtack", detail: "Deep cleaning", extras: [], proposedTimes: [], nativeDetails: [], claimedBy: null, isBooked: false }], smsInbox: [], claimPending: false, bookingPending: false, callPending: false, bridgePending: false,
    onClaim: vi.fn(), onUnclaim: vi.fn(), onMarkBooked: vi.fn(), onUnbook: vi.fn(), onCall: vi.fn(), onTestBridge: vi.fn(), onOpenSms: vi.fn() };
  const code = `import React, {useState,useRef,useEffect} from "react";\nexport ${declaration(page, "LeadQueue")}`;
  const module = { exports: {} as Record<string, any> };
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText,
    { module, exports: module.exports, ...icons, ...component, LeadDetailPanel: div, leadCardStatus: () => ({ kind: "new", label: "New", ts: 1_800_000_000_000 }), leadCardConversation: () => null,
      customerPortraitFor: () => "https://example.invalid/synthetic.png", formatPhoneDisplay: (p: string) => p, formatRelative: () => "now", firstName: (s: string) => s,
      navigator: { clipboard: { writeText: vi.fn() } }, require: (id: string) => { if (id === "react") return ReactMock; throw new Error(id); } }, { timeout: 1500 });
  return { ...component, props, render: () => { cursor = 0; return module.exports.LeadQueue(props) as Element; } };
}

describe("lead call notes popup — actual UI, offline", () => {
  it("note icon stops mouse/key bubbling and opens notes without claiming, booking, texting or calling", () => {
    const h = queue(); let tree = h.render();
    const noteNode = nodes(tree).find(n => n.type === h.LeadCallNotesButton)!;
    expect(noteNode.props.name).toBe(lead.name);
    const icon = h.LeadCallNotesButton(noteNode.props);
    const stopPropagation = vi.fn(), focus = vi.fn();
    icon.props.onKeyDown({ stopPropagation }); icon.props.onClick({ stopPropagation, currentTarget: { focus } });
    expect(stopPropagation).toHaveBeenCalledTimes(2);
    tree = h.render();
    expect(nodes(tree).some(n => n.type === div)).toBe(false); // LeadDetailPanel was not opened.
    const dialog = nodes(tree).find(n => n.type === h.LeadCallNotesDialog)!;
    expect(dialog.props.lead.name).toBe(lead.name);
    dialog.props.returnFocus(); expect(focus).toHaveBeenCalledTimes(1);
    for (const [name, action] of Object.entries(h.props)) if (name.startsWith("on")) expect(action).not.toHaveBeenCalled();
    dialog.props.onClose(); expect(nodes(h.render()).some(n => n.type === h.LeadCallNotesDialog)).toBe(false);
  });
  it.each(["onClaim", "onMarkBooked", "onOpenSms", "onCall"])("preserves existing %s action", action => {
    const h = queue(), tree = h.render();
    const expectedLabel = action === "onClaim" ? "Claim lead" : action === "onMarkBooked" ? null : action === "onOpenSms" ? `Open text conversation with ${lead.name}` : `Call ${lead.name} through office`;
    const button = nodes(tree).find(n => n.type === "button" && (expectedLabel ? n.props["aria-label"] === expectedLabel : text(n) === "Book"))!;
    expect(button).toBeDefined(); button.props.onClick({ stopPropagation: vi.fn() }); expect(h.props[action as keyof typeof h.props]).toHaveBeenCalledWith(h.props.leads[0]);
  });
  it("fetches only this lead on open, without polling or a model/mutation call", () => {
    const h = ui(), close = vi.fn(), focus = vi.fn(), tree = h.LeadCallNotesDialog({ lead, onClose: close, returnFocus: focus });
    expect(h.useQuery).toHaveBeenCalledWith({ sessionId: 42, phone: "2025550123" }, { enabled: true, staleTime: 30_000, refetchOnMount: "always", refetchOnWindowFocus: false, retry: false });
    expect(source).not.toMatch(/refetchInterval|setInterval|useMutation|generate|sendSms/);
    tree.props.onOpenChange(false); expect(close).toHaveBeenCalledTimes(1);
    const content = nodes(tree).find(n => n.type === DialogContent)!; const preventDefault = vi.fn(); content.props.onCloseAutoFocus({ preventDefault }); expect(preventDefault).toHaveBeenCalled(); expect(focus).toHaveBeenCalled();
    nodes(tree).find(n => n.type === "button")!.props.onClick(); expect(h.refetch).toHaveBeenCalled();
  });
  it("shows saved summary, booking facts, follow-up evidence and completion state as literal text", () => {
    const h = ui(), html = renderToStaticMarkup(h.LeadCallNotesHistory({ calls: [note({ summary: "<script>literal customer words</script>", details: [{ label: "Preference", value: "<b>Friday</b>" }], followUps: [...note().followUps, { taskId: 8, title: "Oven added", evidenceQuote: "Add the oven", status: "done" }] })] }));
    expect(html).toContain("Madison"); expect(html).toContain("Open"); expect(html).toContain("Done"); expect(html).toContain("Friday would be best");
    expect(html).toContain("&lt;script&gt;literal customer words&lt;/script&gt;"); expect(html).toContain("&lt;b&gt;Friday&lt;/b&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain("Full transcript"); expect(html).toContain("Caller:");
  });
  it("supports incoming/outgoing staff and AI calls without inventing absent summaries", () => {
    const h = ui(), html = renderToStaticMarkup(h.LeadCallNotesHistory({ calls: [note({ source: "staff", provider: "openphone", direction: "outgoing", summary: null }), note({ id: "vapi:2", source: "outbound_ai", summary: null })] }));
    expect(html).toContain("Staff call"); expect(html).toContain("AI call"); expect(html).toContain("Outgoing"); expect(html).toContain("No saved call summary yet.");
    expect(html).toContain("AI call summary");
  });
  it.each(["loading", "error", "unlinked", "empty"])("handles %s without displaying another customer's cached notes", variant => {
    const h = ui(variant === "loading" ? { isLoading: true } : variant === "error" ? { isError: true } : { data: { calls: [] } });
    const tree = h.LeadCallNotesDialog({ lead: variant === "unlinked" ? { ...lead, sessionId: null, phone: null } : lead, onClose: vi.fn(), returnFocus: vi.fn() });
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain("Requested a deep clean");
    expect(html).toContain(variant === "loading" ? "Loading call notes" : variant === "error" ? "couldn’t be loaded" : variant === "unlinked" ? "No phone number attached yet" : "No call notes yet");
    if (variant === "unlinked") expect(h.useQuery.mock.calls[0][1].enabled).toBe(false);
  });
  it("formats saved JSON/dialogue or text without guessing unidentified speakers or altering words", () => {
    const h = ui();
    const json = h.callNotesTranscriptTurns(JSON.stringify([{ identifier: "+12025550123", content: "Please add the oven." }, { identifier: "Staff", content: "We will confirm the price." }]));
    expect(json[0].speaker).toBeNull(); expect(json[0].paragraphs.join("")).toBe("Please add the oven."); expect(json[1].speaker).toBe("Staff");
    const textTurns = h.callNotesTranscriptTurns("Caller: First request.\nStaff: Second answer.");
    expect(textTurns.map((t: any) => t.speaker)).toEqual(["Caller", "Staff"]);
    expect(textTurns.map((t: any) => t.paragraphs.join("")).join("").replace(/\s+/g, " ").trim()).toBe("First request. Second answer.");
    const long = Array.from({ length: 140 }, (_, i) => `word${i}`).join(" "), turns = h.callNotesTranscriptTurns(long);
    expect(turns[0].paragraphs.length).toBeGreaterThan(1); expect(turns[0].paragraphs.join("")).toBe(long);
  });
  it("adds only the authenticated read query and preserves every original voice-router byte", () => {
    const routerPath = "server/voiceRouter.ts", current = readFileSync(routerPath, "utf8");
    const original = execFileSync("git", ["show", `4839e7d91e64920ecc23b205e784ca7455409d7c:${routerPath}`], { encoding: "utf8" });
    expect(current).toContain('getLeadCallNotes: agentProcedure.input(leadCallNotesInputSchema)\n    .query(({ input }) => getLeadCallNotes(input)),');
    expect(current
      .replace('import { leadCallNotesInputSchema } from "../shared/leadCallNotes";\n', "")
      .replace('import { getLeadCallNotes } from "./leadCallNotes";\n', "")
      .replace('  getLeadCallNotes: agentProcedure.input(leadCallNotesInputSchema)\n    .query(({ input }) => getLeadCallNotes(input)),\n\n', "")
    ).toBe(original);
  });
  it("preserves every original lead-queue byte except the explicit note-icon/state/popup addition", () => {
    const original = execFileSync("git", ["show", `4839e7d91e64920ecc23b205e784ca7455409d7c:${pagePath}`], { encoding: "utf8" });
    const current = declaration(page, "LeadQueue")
      .replace('  const [callNotesLead, setCallNotesLead] = useState<CommandLead | null>(null);\n', "")
      .replace('  const callNotesTrigger = useRef<HTMLButtonElement | null>(null);\n', "")
      .replace('<LeadCallNotesButton name={lead.name} onOpen={button => { callNotesTrigger.current = button; setCallNotesLead(lead); }} />', "")
      .replace('      {callNotesLead && <LeadCallNotesDialog lead={callNotesLead} onClose={() => setCallNotesLead(null)} returnFocus={() => callNotesTrigger.current?.focus()} />}\n', "");
    expect(current).toBe(declaration(original, "LeadQueue"));
    expect(declaration(page, "LeadDetailPanel")).toBe(declaration(original, "LeadDetailPanel"));
    expect(declaration(page, "SmsConversationDrawer")).toBe(declaration(original, "SmsConversationDrawer"));
  });
});
