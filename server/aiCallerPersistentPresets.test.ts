import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { AiCallerWorkspaceProps, CallerContact } from "../client/src/components/AiCallerWorkspace";

// Exercise the real workspace with synthetic hooks only: no DOM, server, or call provider.
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
import { getAiCallerInstructionPresets } from "../client/src/lib/aiCallerInstructionPresets";

const customerLabels = [
  "Team running late", "Running significantly late", "Team at address / access needed", "Parking instructions",
  "Put card on file", "Payment failed", "Confirm address", "Scope clarification", "Client ETA update",
  "Earlier arrival available", "Home not ready / team turned away", "Job paused — issue on site",
];
const teamLabels = ["ETA request", "Schedule confirmation", "Job status reminder", "Confirm job completion"];
const businessDate = "2026-11-22";
const oldRecipientFacts = ["Prior booked customer", "814 Previous Avenue", "9:45 AM", "47 minutes"];
const saved: CallerContact = {
  id: "saved", name: oldRecipientFacts[0], initials: "PC", phone: "+12025550124", type: "Customer",
  location: oldRecipientFacts[1], leadflowJobId: 501, jobDate: businessDate,
  scripts: customerLabels.map(label => ({ label, text: `Hello ${oldRecipientFacts[0]}, your team will arrive at ${oldRecipientFacts[1]} at ${oldRecipientFacts[2]}, in ${oldRecipientFacts[3]}.` })),
};
const lead: CallerContact = { id: "searched-lead", name: "Synthetic inquiry", initials: "SI", phone: "+12025550125", type: "Lead", location: "Lead", leadflowJobId: null, jobDate: businessDate, scripts: [] };
const customer: CallerContact = { ...lead, id: "searched-customer", name: "Synthetic customer", initials: "SC", phone: "+12025550126", type: "Customer" };
const team: CallerContact = { ...lead, id: "searched-team", name: "Synthetic team", initials: "ST", phone: "+12025550127", type: "Team" };
let props: AiCallerWorkspaceProps;
let tree: ReactElement<any>;
function render() {
  // The second pass reflects state updates made by initialization effects.
  for (let pass = 0; pass < 2; pass++) {
    runner.cursor = 0; runner.refCursor = 0; runner.effects = [];
    tree = AiCallerWorkspace(props);
    runner.effects.forEach(effect => effect());
  }
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
function pills() { return elements(find(node => node.props.className === "presets")).filter(node => node.type === "button"); }
function expectPills(labels = customerLabels) { expect(pills().map(node => node.props.children)).toEqual(labels); }
function pill(label: string) { return pills().find(node => node.props.children === label)!; }
function pickPreset(index: number, type?: CallerContact["type"]) {
  const preset = getAiCallerInstructionPresets(type)[index];
  pill(preset.label).props.onClick(); render();
  expect(input("instructions").props.value).toBe(preset.text);
  expect(pill(preset.label).props["aria-pressed"]).toBe(true);
  expect(pills().filter(node => node.props["aria-pressed"])).toHaveLength(1);
  return preset;
}
function edit(text: string) { input("instructions").props.onChange({ target: { value: text } }); render(); }
function typeNumber(phone: string) { input("dial-number").props.onChange({ target: { value: phone } }); render(); }
function chooseSearch(person: CallerContact) {
  find(node => node.props.className === "contact-select").props.onClick(); render();
  find(node => node.props["aria-label"] === "Search customers, leads and teams").props.onChange({ target: { value: person.name } }); render();
  props = { ...props, searchResults: { query: person.name.toLowerCase(), contacts: [person], loading: false } }; render();
  find(node => node.type === "button" && node.props.children?.[1]?.props?.children?.[0]?.props?.children?.[0] === person.name).props.onClick(); render();
}
function clearSearchResults() { props = { ...props, searchResults: { query: "", contacts: [], loading: false } }; render(); }
function callButton() { return find(node => node.type === "button" && node.props.className === "call-button"); }
function expectSafe(text: string) { for (const fact of oldRecipientFacts) expect(text).not.toContain(fact); }
async function expectConfirmedCall(person: CallerContact, preset: { label: string; text: string }) {
  expect(callButton().props.disabled).toBe(false);
  callButton().props.onClick(); render();
  expect(runner.refs[0].current.showModal).toHaveBeenCalledTimes(1);
  expect(props.onStartCall).not.toHaveBeenCalled();
  const instructions = find(node => node.props.className === "confirm-instructions");
  expect(instructions.props.children[0].props.children).toEqual(["CALL INSTRUCTIONS · ", preset.label]);
  expect(instructions.props.children[1].props.children).toBe(preset.text);
  const recipient = find(node => node.props.className === "confirm-person");
  expect(recipient.props.children[1].props.children[0].props.children).toBe(person.name);
  expect(recipient.props.children[1].props.children[1].props.children[0]).toBe(person.phone);
  await find(node => node.type === "button" && node.props.children?.[0] === "Yes, start call").props.onClick(); render();
  expect(runner.refs[0].current.close).toHaveBeenCalledTimes(1);
  expect(props.onStartCall).toHaveBeenCalledTimes(1);
  expect(props.onStartCall).toHaveBeenCalledWith({
    leadflowJobId: person.leadflowJobId, jobDate: person.jobDate, personName: person.name, phone: person.phone,
    scenario: preset.label, script: preset.text, audience: person.type === "Team" ? "cleaner" : "customer", language: "en", scriptMode: "instructions",
  });
}
beforeEach(() => {
  runner.states = []; runner.refs = [{ current: { showModal: vi.fn(), close: vi.fn() } }];
  props = { review: false, contacts: [], recent: [], session: null, businessDate, onStartCall: vi.fn(async () => {}), onDismissSession: vi.fn(), onSearchChange: vi.fn() };
  render();
});

describe("persistent purpose-based caller presets", () => {
  it("keeps the exact twelve customer labels and four team labels with recipient-free instruction prompts", () => {
    for (const type of [undefined, "Customer", "Lead", "Team"] as const) {
      const presets = getAiCallerInstructionPresets(type);
      expect(presets.map(item => item.label)).toEqual(type === "Team" ? teamLabels : customerLabels);
      for (const preset of presets) {
        expect(preset.text.trim().length).toBeGreaterThanOrEqual(10);
        expectSafe(preset.text);
        expect(preset.text).not.toMatch(/^(?:hi\b|hello\b)/i);
      }
    }
  });
  it("shows all customer pills before any contact data, even when optional contacts are unavailable", () => {
    expectPills();
    props = { ...props, loading: true, error: "Optional contacts unavailable" }; render();
    expectPills();
    pickPreset(1);
    expect(input("instructions").props.disabled).toBe(false);
    expect(pills().every(node => node.props.disabled === false)).toBe(true);
    expect(callButton().props.disabled).toBe(true);
    expect(props.onStartCall).not.toHaveBeenCalled();
  });
  it.each([lead, customer])("keeps all customer pills after choosing a searched $type with empty scripts and clearing transient results", async person => {
    chooseSearch(person);
    expectPills();
    expect(input("instructions").props.value).toBe(getAiCallerInstructionPresets(person.type)[0].text);
    expect(props.onStartCall).not.toHaveBeenCalled();
    expect(runner.refs[0].current.showModal).not.toHaveBeenCalled();
    clearSearchResults();
    expectPills();
    expect(find(node => node.props.className === "contact-select").props.children[0].props.children[1].props.children[0].props.children[0]).toBe(person.name);
    const preset = pickPreset(1);
    expectSafe(input("instructions").props.value);
    await expectConfirmedCall(person, preset);
  });
  it("shows only four team pills and confirms a non-first team instruction for a searched team with no job", async () => {
    chooseSearch(team); clearSearchResults();
    expectPills(teamLabels);
    expect(input("instructions").props.value).toBe(getAiCallerInstructionPresets("Team")[0].text);
    expect(props.onStartCall).not.toHaveBeenCalled();
    const preset = pickPreset(1, "Team");
    await expectConfirmedCall(team, preset);
  });
  it.each(["2025550123", "not a number", ""])("retains all customer pills and a chosen prompt while typing %j", phone => {
    const preset = pickPreset(1);
    typeNumber(phone);
    expectPills();
    expect(input("instructions").props.value).toBe(preset.text);
    expect(pill(preset.label).props["aria-pressed"]).toBe(true);
    expect(props.onStartCall).not.toHaveBeenCalled();
    expect(callButton().props.disabled).toBe(phone !== "2025550123");
    if (phone !== "2025550123") {
      callButton().props.onClick(); render();
      expect(runner.refs[0].current.showModal).not.toHaveBeenCalled();
    }
  });
  it("clicks a non-first pill after entering a number and confirms its exact instructions with no job or saved recipient", async () => {
    typeNumber("(202) 555-0123");
    const preset = pickPreset(6);
    await expectConfirmedCall({ ...customer, name: "+12025550123", phone: "+12025550123" }, preset);
  });
  it("auto-selects the initial saved contact but fills the first generic prompt instead of its booked script", async () => {
    props = { ...props, contacts: [saved] }; render();
    const preset = getAiCallerInstructionPresets("Customer")[0];
    expect(input("instructions").props.value).toBe(preset.text);
    expectPills();
    expectSafe(input("instructions").props.value);
    expect(props.onStartCall).not.toHaveBeenCalled();
    await expectConfirmedCall(saved, preset);
  });
  it("does not overwrite an existing edited instruction when the first contact loads", () => {
    const custom = "Ask the recipient which cleaning services they would like to discuss.";
    edit(custom);
    props = { ...props, contacts: [saved] }; render();
    expect(input("instructions").props.value).toBe(custom);
    expect(pills().every(node => !node.props["aria-pressed"])).toBe(true);
    expectPills();
    expect(props.onStartCall).not.toHaveBeenCalled();
  });
  it("preserves a non-first customer preset through saved/search/manual recipient changes without old booking facts", async () => {
    props = { ...props, contacts: [saved] }; render();
    const preset = pickPreset(8);
    for (const person of [lead, customer]) {
      chooseSearch(person); clearSearchResults();
      expectPills();
      expect(input("instructions").props.value).toBe(preset.text);
      expect(pill(preset.label).props["aria-pressed"]).toBe(true);
      expectSafe(input("instructions").props.value);
    }
    for (const phone of ["2025550128", "invalid", "", "2025550123"]) {
      typeNumber(phone);
      expectPills();
      expect(input("instructions").props.value).toBe(preset.text);
      expect(pill(preset.label).props["aria-pressed"]).toBe(true);
      expectSafe(input("instructions").props.value);
    }
    await expectConfirmedCall({ ...customer, name: "+12025550123", phone: "+12025550123" }, preset);
  });
  it("preserves edited custom instructions across recipients and audiences, using Custom instructions rather than an old label", async () => {
    props = { ...props, contacts: [saved] }; render();
    const selectedPreset = pickPreset(1);
    const custom = "Ask what help is needed and collect details; do not assume a scheduled job exists.";
    edit(custom);
    expect(pill(selectedPreset.label).props["aria-pressed"]).toBe(true);
    for (const person of [lead, team, customer]) {
      chooseSearch(person); clearSearchResults();
      expectPills(person.type === "Team" ? teamLabels : customerLabels);
      expect(input("instructions").props.value).toBe(custom);
      if (person === lead) expect(pill(selectedPreset.label).props["aria-pressed"]).toBe(true);
      else expect(pills().every(node => !node.props["aria-pressed"])).toBe(true);
    }
    typeNumber("2025550123");
    expect(input("instructions").props.value).toBe(custom);
    await expectConfirmedCall({ ...customer, name: "+12025550123", phone: "+12025550123" }, { label: "Custom instructions", text: custom });
  });
  it("keeps the selected scenario label but sends the exact edited instructions when changing a compatible recipient", async () => {
    chooseSearch(lead);
    const selectedPreset = pickPreset(3);
    const custom = "Ask for parking directions and whether visitors need a permit; do not assume an address.";
    edit(custom);
    chooseSearch(customer); clearSearchResults();
    expect(input("instructions").props.value).toBe(custom);
    expect(pill(selectedPreset.label).props["aria-pressed"]).toBe(true);
    await expectConfirmedCall(customer, { label: selectedPreset.label, text: custom });
  });
  it("preserves a non-first team preset and label when switching between team recipients", async () => {
    chooseSearch(team);
    const selectedPreset = pickPreset(3, "Team");
    const otherTeam = { ...team, id: "second-team", name: "Second synthetic team", phone: "+12025550128" };
    chooseSearch(otherTeam); clearSearchResults();
    expectPills(teamLabels);
    expect(input("instructions").props.value).toBe(selectedPreset.text);
    expect(pill(selectedPreset.label).props["aria-pressed"]).toBe(true);
    await expectConfirmedCall(otherTeam, selectedPreset);
  });
  it.each(["manual", "customer"])("clears only an unchanged incompatible team prompt when switching to %s", destination => {
    chooseSearch(team);
    const preset = pickPreset(2, "Team");
    if (destination === "manual") typeNumber("2025550123"); else chooseSearch(customer);
    expectPills();
    expect(input("instructions").props.value).toBe("");
    expect(input("instructions").props.value).not.toBe(preset.text);
    expect(pills().every(node => !node.props["aria-pressed"])).toBe(true);
    expect(callButton().props.disabled).toBe(true);
    expect(props.onStartCall).not.toHaveBeenCalled();
  });
  it.each(["manual", "customer"])("preserves an edited team prompt when switching to %s", destination => {
    chooseSearch(team); pickPreset(2, "Team");
    const custom = "Ask the person whether they need office assistance; do not assume any existing assignment.";
    edit(custom);
    if (destination === "manual") typeNumber("2025550123"); else chooseSearch(customer);
    expectPills();
    expect(input("instructions").props.value).toBe(custom);
    expect(pills().every(node => !node.props["aria-pressed"])).toBe(true);
    expect(props.onStartCall).not.toHaveBeenCalled();
  });
  it("clears an unchanged incompatible customer preset when choosing a team and keeps every team pill available", () => {
    const customerPreset = pickPreset(1);
    chooseSearch(team); clearSearchResults();
    expectPills(teamLabels);
    expect(input("instructions").props.value).toBe("");
    expect(input("instructions").props.value).not.toBe(customerPreset.text);
    expect(pills().every(node => !node.props["aria-pressed"])).toBe(true);
    expect(callButton().props.disabled).toBe(true);
    pickPreset(1, "Team");
    expect(props.onStartCall).not.toHaveBeenCalled();
  });
  it("locks pills and editing only during an active call without starting another call", () => {
    typeNumber("2025550123"); pickPreset(1);
    props = { ...props, session: { vapiCallId: "synthetic-active", phase: "active", status: "ringing", customerName: "Synthetic", phone: "+12025550123", scenario: customerLabels[1] } }; render();
    expectPills();
    expect(pills().every(node => node.props.disabled === true)).toBe(true);
    expect(input("instructions").props.disabled).toBe(true);
    expect(input("dial-number").props.disabled).toBe(true);
    expect(find(node => node.props.className === "contact-select").props.disabled).toBe(true);
    expect(callButton().props.disabled).toBe(true);
    expect(props.onStartCall).not.toHaveBeenCalled();
    props = { ...props, session: null }; render();
    expect(pills().every(node => node.props.disabled === false)).toBe(true);
    expect(input("instructions").props.disabled).toBe(false);
    expect(input("dial-number").props.disabled).toBe(false);
  });
});
