import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../client/src/pages/OpsChat.tsx", import.meta.url), "utf8");
const customerServiceTarget = 'if (ws.id === "cs") { window.location.assign("/admin/cs-inbox-2"); return; }';

describe("Command Chat Customer Service navigation", () => {
  it("routes every Customer Service SMS rail entry to Inbox v2", () => {
    expect((source.match(/line1: "Customer",\s+line2: "Service SMS"/g) ?? [])).toHaveLength(3);
    expect((source.match(new RegExp(customerServiceTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? [])).toHaveLength(3);
  });

  it("removes every duplicate Inbox v2 sidebar shortcut", () => {
    expect(source).not.toContain('href: "/admin/cs-inbox-2"');
    expect(source).not.toContain('line1: "Inbox",    line2: "v2"');
  });
});
