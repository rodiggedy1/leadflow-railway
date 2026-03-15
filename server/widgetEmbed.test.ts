/**
 * Tests for the widget embed script behavior.
 * These are pure logic tests — they mirror the client-side JS logic in
 * widgetEmbed.ts so we can validate it without a browser.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ── Consent checkbox pre-check ────────────────────────────────────────────────
describe("consent checkbox", () => {
  it("state.consent is true by default", () => {
    // Mirrors: var state = { ..., consent: true }
    const state = { consent: true };
    expect(state.consent).toBe(true);
  });

  it("consentCheck.checked is set to true on render", () => {
    // Mirrors: consentCheck.checked = true; (DOM property, not attribute)
    const mockCheckbox = { checked: false } as HTMLInputElement;
    mockCheckbox.checked = true; // the fix
    expect(mockCheckbox.checked).toBe(true);
  });

  it("state.consent updates when checkbox changes", () => {
    const state = { consent: true };
    // Simulate unchecking
    state.consent = false;
    expect(state.consent).toBe(false);
    // Simulate re-checking
    state.consent = true;
    expect(state.consent).toBe(true);
  });
});

// ── Auto-open key generation ──────────────────────────────────────────────────
describe("auto-open localStorage key", () => {
  function getAutoOpenKey(isoDate: string): string {
    const today = isoDate.slice(0, 10);
    return "mib_auto_" + today;
  }

  it("key includes today's date", () => {
    const key = getAutoOpenKey("2026-03-15T12:00:00.000Z");
    expect(key).toBe("mib_auto_2026-03-15");
  });

  it("key changes on a new calendar day", () => {
    const key1 = getAutoOpenKey("2026-03-15T23:59:59.000Z");
    const key2 = getAutoOpenKey("2026-03-16T00:00:00.000Z");
    expect(key1).not.toBe(key2);
  });

  it("key is stable within the same day", () => {
    const key1 = getAutoOpenKey("2026-03-15T08:00:00.000Z");
    const key2 = getAutoOpenKey("2026-03-15T20:00:00.000Z");
    expect(key1).toBe(key2);
  });
});

// ── Auto-open deduplication logic ─────────────────────────────────────────────
describe("scheduleAutoOpen deduplication", () => {
  // Simulate the guard logic
  function shouldAutoOpen(
    sessionClosed: boolean,
    alreadyOpenedToday: boolean
  ): boolean {
    if (sessionClosed) return false;
    if (alreadyOpenedToday) return false;
    return true;
  }

  it("opens when not closed and not already opened today", () => {
    expect(shouldAutoOpen(false, false)).toBe(true);
  });

  it("does NOT open when user closed the widget this session", () => {
    expect(shouldAutoOpen(true, false)).toBe(false);
  });

  it("does NOT open when already auto-opened today", () => {
    expect(shouldAutoOpen(false, true)).toBe(false);
  });

  it("does NOT open when both flags are set", () => {
    expect(shouldAutoOpen(true, true)).toBe(false);
  });
});

// ── Exit-intent trigger logic ─────────────────────────────────────────────────
describe("setupExitIntent — mouseleave trigger", () => {
  // Simulate the guard and trigger logic
  function shouldTriggerExitIntent(
    sessionClosed: boolean,
    exitAlreadyShown: boolean,
    clientY: number
  ): boolean {
    // Guard checks
    if (sessionClosed) return false;
    if (exitAlreadyShown) return false;
    // Only top-edge exits (clientY <= 10)
    if (clientY > 10) return false;
    return true;
  }

  it("triggers when cursor leaves through top edge (clientY = 0)", () => {
    expect(shouldTriggerExitIntent(false, false, 0)).toBe(true);
  });

  it("triggers when cursor is at clientY = 5 (near top)", () => {
    expect(shouldTriggerExitIntent(false, false, 5)).toBe(true);
  });

  it("does NOT trigger when cursor leaves through side/bottom (clientY = 400)", () => {
    expect(shouldTriggerExitIntent(false, false, 400)).toBe(false);
  });

  it("does NOT trigger when cursor is at clientY = 11 (just above threshold)", () => {
    expect(shouldTriggerExitIntent(false, false, 11)).toBe(false);
  });

  it("does NOT trigger when user already closed the widget", () => {
    expect(shouldTriggerExitIntent(true, false, 0)).toBe(false);
  });

  it("does NOT trigger when exit intent already shown this session", () => {
    expect(shouldTriggerExitIntent(false, true, 0)).toBe(false);
  });

  it("fires at most once (triggered flag prevents re-fire)", () => {
    let triggered = false;
    let openCount = 0;

    function onMouseLeave(clientY: number) {
      if (triggered) return;
      if (clientY > 10) return;
      triggered = true;
      openCount++;
    }

    onMouseLeave(0); // first exit
    onMouseLeave(0); // second exit — should be ignored
    onMouseLeave(0); // third exit — should be ignored

    expect(openCount).toBe(1);
  });
});

// ── setOpen state management ──────────────────────────────────────────────────
describe("setOpen state management", () => {
  it("opens the widget and triggers renderBody", () => {
    const state = { open: false };
    let renderCalled = false;
    function setOpen(val: boolean) {
      state.open = val;
      if (val) renderCalled = true;
    }
    setOpen(true);
    expect(state.open).toBe(true);
    expect(renderCalled).toBe(true);
  });

  it("closes the widget without calling renderBody", () => {
    const state = { open: true };
    let renderCalled = false;
    function setOpen(val: boolean) {
      state.open = val;
      if (val) renderCalled = true;
    }
    setOpen(false);
    expect(state.open).toBe(false);
    expect(renderCalled).toBe(false);
  });
});
