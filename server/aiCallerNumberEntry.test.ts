import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { AiCallerWorkspaceProps, CallerContact } from "../client/src/components/AiCallerWorkspace";
import { getAiCallerInstructionPresets } from "../client/src/lib/aiCallerInstructionPresets";

const runner = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: any }[], cursor: 0, refCursor: 0, effects: [] as (() => void)[] }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const slot = runner.cursor++;
      if (!(slot in runner.states)) runner.states[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [runner.states[slot], (next: unknown) => { runner.states[slot] = typeof next === "function" ? (next as (value: unknown) => unknown)(runner.states[slot]) : next; }];
    },
    useRef: (initial: unknown) => { const slot = runner.refCursor++; return runner.refs[slot] ?? (runner.refs[slot] = { current: initial }); },
    useEffect: (effect: () => void) => { runner.effects.push(effect); },
  };
});
import { AiCallerWorkspace } from "../client/src/components/AiCallerWorkspace";
let props: AiCallerWorkspaceProps;
let tree: ReactElement<any>;
function render() {
  runner.cursor = 0; runner.refCursor = 0; runner.effects = [];
  tree = AiCallerWorkspace(props);
  runner.effects.forEach(effect => effect());
  return tree;
}
function elements(node: any): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !node.props) return [];
  return [node, ...elements(node.props.children)];
}
function find(predicate: (node: ReactElement<any>) => boolean) {
  const match = elements(tree).find(predicate);
  if (!match) throw new Error("Missing test element");
  return match;
}
function input(id: string) { return find(node => node.props.id === id); }
function callButton() { return elements(tree).find(node => node.type === "button" && node.props.className === "call-button")!; }
function typeNumber(phone: string) { input("dial-number").props.onChange({ target: { value: phone } }); render(); }
function typeScript(script: string) { input("instructions").props.onChange({ target: { value: script } }); render(); }
async function confirmCall() {
  callButton().props.onClick(); render();
  const button = find(node => node.type === "button" && node.props.children?.[0] === "Yes, start call");
  await button.props.onClick(); render();
}
const saved: CallerContact = { id: "saved", name: "Example booked customer", initials: "EC", phone: "+12025550124", type: "Customer", location: "Example location", leadflowJobId: 501, jobDate: "2026-11-22", scripts: [{ label: "Confirm address", text: "Hello, confirm your booked cleaning address." }] };
beforeEach(() => {
  runner.states = []; runner.refs = [{ current: { showModal: vi.fn(), close: vi.fn() } }];
  props = { review: false, contacts: [], recent: [], session: null, businessDate: "2026-11-22", onStartCall: vi.fn(async () => {}), onDismissSession: vi.fn() };
  render();
});

describe("typed-number caller interaction", () => {
  it.each(["2025550123", "(202) 555-0123", "1 202 555 0123", "+12025550123"])("starts from %s plus script with no booking, job, name or saved contact required", async phone => {
    typeNumber(phone); typeScript("Hi, this is Ava. How can we help with your cleaning inquiry?");
    expect(callButton().props.disabled).toBe(false);
    await confirmCall();
    expect(props.onStartCall).toHaveBeenCalledTimes(1);
    expect(props.onStartCall).toHaveBeenCalledWith({ leadflowJobId: null, jobDate: "2026-11-22", personName: "+12025550123", phone: "+12025550123", scenario: "Custom instructions", script: "Hi, this is Ava. How can we help with your cleaning inquiry?", audience: "customer", language: "en", scriptMode: "instructions" });
  });
  it("confirms the exact whole-call instructions before making one call", async () => {
    const instructions = "tell him we are running late and wil be there in 30 minutes";
    typeNumber("2025550123"); typeScript(`  ${instructions}  `);
    callButton().props.onClick(); render();
    const panel = find(node => node.props.className === "confirm-instructions");
    expect(panel.props.children[0].props.children[0]).toBe("CALL INSTRUCTIONS · ");
    expect(panel.props.children[1].props.children).toBe(instructions);
    expect(props.onStartCall).not.toHaveBeenCalled();
    const button = find(node => node.type === "button" && node.props.children?.[0] === "Yes, start call");
    await button.props.onClick(); render();
    expect(props.onStartCall).toHaveBeenCalledTimes(1);
    expect(props.onStartCall).toHaveBeenCalledWith(expect.objectContaining({ script: instructions, scriptMode: "instructions", leadflowJobId: null, phone: "+12025550123" }));
  });
  it("allows typing the number and script while optional contact data is unavailable", async () => {
    props = { ...props, loading: true, error: "Optional contacts unavailable" }; render();
    expect(input("dial-number").props.disabled).toBe(false);
    expect(input("instructions").props.disabled).toBe(false);
    typeNumber("2025550123"); typeScript("Hello, this is Ava from Maids in Black.");
    await confirmCall();
    expect(props.onStartCall).toHaveBeenCalledTimes(1);
  });
  it("does not let delayed contact loading overwrite the entered number or script", async () => {
    typeNumber("2025550123"); typeScript("Hello, this is my exact custom introduction.");
    props = { ...props, contacts: [saved] }; render(); render();
    expect(input("dial-number").props.value).toBe("2025550123");
    expect(input("instructions").props.value).toBe("Hello, this is my exact custom introduction.");
    await confirmCall();
    expect(props.onStartCall).toHaveBeenCalledWith(expect.objectContaining({ leadflowJobId: null, phone: "+12025550123", script: "Hello, this is my exact custom introduction." }));
  });
  it("does not accidentally dial a saved contact when the entered number is invalid or empty", () => {
    props = { ...props, contacts: [saved] }; render(); render();
    typeNumber("not a number"); typeScript("Hello, this is Ava from Maids in Black.");
    expect(callButton().props.disabled).toBe(true);
    callButton().props.onClick();
    expect(runner.refs[0].current.showModal).not.toHaveBeenCalled();
    typeNumber("");
    expect(callButton().props.disabled).toBe(true);
    expect(props.onStartCall).not.toHaveBeenCalled();
  });
  it("keeps selecting a saved customer wired to their real existing job and phone with generic instructions", async () => {
    props = { ...props, contacts: [saved] }; render(); render();
    typeNumber("2025550123");
    find(node => node.props.className === "contact-select").props.onClick(); render();
    find(node => node.type === "button" && node.props.children?.[1]?.props?.children?.[0]?.props?.children?.[0] === saved.name).props.onClick(); render();
    expect(input("dial-number").props.value).toBe("");
    const defaultPreset = getAiCallerInstructionPresets("Customer")[0];
    expect(input("instructions").props.value).toBe(defaultPreset.text);
    await confirmCall();
    expect(props.onStartCall).toHaveBeenCalledWith(expect.objectContaining({ leadflowJobId: 501, phone: saved.phone, scenario: defaultPreset.label, script: defaultPreset.text, scriptMode: "instructions" }));
  });
  it("keeps typed number and script locked only during an active call", () => {
    props = { ...props, session: { vapiCallId: "synthetic", phase: "active", status: "ringing", customerName: "Example", phone: "+12025550123", scenario: "Custom instructions" } }; render();
    expect(input("dial-number").props.disabled).toBe(true);
    expect(input("instructions").props.disabled).toBe(true);
  });
});

describe("broad contact search interaction", () => {
  const lead: CallerContact = { id: "search-lead-1", name: "Rohan Example", initials: "RE", phone: "+13029816191", type: "Lead", location: "Lead · Standard cleaning", leadflowJobId: null, jobDate: "2026-11-22", scripts: [] };
  function openSearch(value: string) {
    find(node => node.props.className === "contact-select").props.onClick(); render();
    find(node => node.props["aria-label"] === "Search customers, leads and teams").props.onChange({ target: { value } }); render();
  }
  function choose(person: CallerContact) {
    find(node => node.type === "button" && node.props.children?.[1]?.props?.children?.[0]?.props?.children?.[0] === person.name).props.onClick(); render();
  }
  function shows(person: CallerContact) {
    return elements(tree).some(node => node.type === "button" && node.props.children?.[1]?.props?.children?.[0]?.props?.children?.[0] === person.name);
  }
  it("keeps a searched lead selected after the query and transient result list clear, with no job required", async () => {
    props = { ...props, onSearchChange: vi.fn() }; render();
    typeNumber("2025550123"); typeScript("Hello, this is my exact introduction for your cleaning inquiry.");
    openSearch("  rohan  ");
    expect(props.onSearchChange).toHaveBeenLastCalledWith("rohan");
    props = { ...props, searchResults: { query: "rohan", contacts: [lead], loading: false } }; render();
    expect(shows(lead)).toBe(true); choose(lead);
    expect(props.onSearchChange).toHaveBeenLastCalledWith("");
    props = { ...props, searchResults: { query: "", contacts: [], loading: false } }; render();
    expect(input("dial-number").props.value).toBe("");
    expect(input("instructions").props.value).toBe("Hello, this is my exact introduction for your cleaning inquiry.");
    await confirmCall();
    expect(props.onStartCall).toHaveBeenCalledWith(expect.objectContaining({ personName: lead.name, phone: lead.phone, leadflowJobId: null, audience: "customer", scenario: "Custom instructions" }));
  });
  it("does not present stale results for a different query or label pending search as no matches", () => {
    props = { ...props, onSearchChange: vi.fn(), searchResults: { query: "rohan", contacts: [lead], loading: false } }; render();
    openSearch("alba");
    expect(shows(lead)).toBe(false);
    expect(elements(tree).some(node => node.props.children === "Searching contacts…")).toBe(true);
    expect(elements(tree).some(node => node.props.children === "No contacts match.")).toBe(false);
  });
  it("shows a search error distinctly from an empty successful search", () => {
    props = { ...props, onSearchChange: vi.fn(), searchResults: { query: "rohan", contacts: [], loading: false, error: "Contact search failed." } }; render();
    openSearch("rohan");
    expect(elements(tree).some(node => node.props.role === "alert" && node.props.children === "Contact search failed.")).toBe(true);
    expect(elements(tree).some(node => node.props.children === "No contacts match.")).toBe(false);
    props = { ...props, searchResults: { query: "rohan", contacts: [], loading: false } }; render();
    expect(elements(tree).some(node => node.props.children === "No contacts match.")).toBe(true);
  });
  it("allows opening broad search while today's optional contact list is loading or unavailable", () => {
    props = { ...props, loading: true, error: "Today's contacts unavailable", onSearchChange: vi.fn() }; render();
    expect(find(node => node.props.className === "contact-select").props.disabled).toBe(false);
    openSearch("rohan"); expect(props.onSearchChange).toHaveBeenLastCalledWith("rohan");
  });
  it("matches formatted phone numbers in the local contact list", () => {
    const formatted = { ...lead, type: "Customer" as const, phone: "+1 (302) 981-6191" };
    props = { ...props, contacts: [formatted] }; render(); render();
    openSearch("3029816191"); expect(shows(formatted)).toBe(true);
  });
  it("does not carry a booked customer's default booking script into an unrelated searched lead", () => {
    props = { ...props, contacts: [saved], onSearchChange: vi.fn(), searchResults: { query: "rohan", contacts: [lead], loading: false } }; render(); render();
    openSearch("rohan"); choose(lead);
    const presets = getAiCallerInstructionPresets("Lead");
    expect(input("instructions").props.value).toBe(presets[0].text);
    expect(input("instructions").props.value).not.toBe(saved.scripts[0].text);
    const pills = elements(find(node => node.props.className === "presets")).filter(node => node.type === "button");
    expect(pills.map(node => node.props.children)).toEqual(presets.map(item => item.label));
    expect(pills).toHaveLength(12);
    expect(callButton().props.disabled).toBe(false);
    expect(props.onStartCall).not.toHaveBeenCalled();
  });
});
