import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { AiCallerWorkspace, type CallerContact } from "../client/src/components/AiCallerWorkspace";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

const contact: CallerContact = {
  id: "instructions-contact",
  name: "Example Customer",
  initials: "EC",
  phone: "+12025550101",
  type: "Customer",
  location: "Fictional location",
  leadflowJobId: 501,
  jobDate: "2026-11-22",
  scripts: [{ label: "Confirm address", text: "Confirm the address before the team arrives." }],
};

function renderWorkspace() {
  return renderToStaticMarkup(createElement(AiCallerWorkspace, {
    review: false,
    contacts: [contact],
    recent: [],
    session: null,
    onStartCall: vi.fn(),
    onDismissSession: vi.fn(),
  }));
}

describe("AI Caller instructions input", () => {
  it("renders instructions copy instead of presenting a verbatim opening-script editor", () => {
    const html = renderWorkspace();

    for (const expected of [
      "Describe the purpose. Ava will turn it into a natural conversation.",
      "Call instructions",
      "For example: Tell them we are running late and will arrive in 30 minutes.",
      "Ava writes the opening and uses these instructions throughout the call.",
    ]) expect(html).toContain(expected);

    for (const removed of [
      "Review the existing call script before starting.",
      "Call script",
      "The existing caller uses this as its opening script.",
      "CALL SCRIPT ·",
    ]) expect(html).not.toContain(removed);
  });

  it("adds instructions mode to the workspace payload while preserving the entered text for confirmation", () => {
    const source = read("client/src/components/AiCallerWorkspace.tsx");

    expect(source).toMatch(/scriptMode\s*:\s*["']instructions["']/);
    expect(source).toContain("script: instructions.trim(),");
    expect(source).toContain("setConfirmation(payload)");
    expect(source).toContain("<p>{confirmation.script}</p>");
    expect(source).toContain("CALL INSTRUCTIONS ·");
  });

  it("leaves the existing exact-live configuration on its default literal script payload", () => {
    const exactLive = read("client/src/pages/AiCallsExactLive.tsx");

    expect(exactLive).toContain('const [script, setScript] = useState("");');
    expect(exactLive).toContain("script: script.trim(),");
    expect(exactLive).not.toContain("scriptMode");
  });
});
