/**
 * CSS guard test for the inline Resolve button in CsInbox.
 *
 * The inline Resolve button on each conversation card must use
 * `[@media(pointer:fine)]:flex` (and NOT just `flex`) so it is hidden on
 * touch devices. Without this guard, a tap on a conversation card can
 * accidentally trigger Resolve instead of selecting the conversation.
 *
 * This test reads the source file and asserts the guard class is present.
 * If a future refactor removes it, this test will fail immediately.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CSINBOX_PATH = resolve(__dirname, "../client/src/components/CsInbox.tsx");

describe("CsInbox — Resolve button touch guard", () => {
  let source: string;

  try {
    source = readFileSync(CSINBOX_PATH, "utf-8");
  } catch {
    source = "";
  }

  it("CsInbox.tsx exists and is readable", () => {
    expect(source.length).toBeGreaterThan(0);
  });

  it("inline Resolve button container uses [@media(pointer:fine)]:flex (not plain flex)", () => {
    // The container div must have the pointer:fine media query guard.
    // This ensures the button is hidden on touch devices (mobile/tablet)
    // and only appears on desktop mouse hover.
    expect(source).toContain("[@media(pointer:fine)]:flex");
  });

  it("inline Resolve button container uses hidden as base display class (not flex)", () => {
    // The base class must be `hidden` so touch devices never see the button.
    // The pattern must be: hidden [@media(pointer:fine)]:flex
    expect(source).toMatch(/hidden\s+\[@media\(pointer:fine\)\]:flex/);
  });

  it("inline Resolve button is only shown on New and Active tabs", () => {
    // The button should be conditionally rendered only for New/Active filters
    // to avoid showing it on Resolved/Teams tabs where it makes no sense.
    expect(source).toContain('activeFilter === "New" || activeFilter === "Active"');
  });

  it("inline Resolve button uses opacity-0 group-hover:opacity-100 for hover reveal", () => {
    // Even on pointer:fine devices, the button is hidden until hover.
    // This prevents it from cluttering the UI when not needed.
    expect(source).toContain("opacity-0 group-hover:opacity-100");
  });
});
