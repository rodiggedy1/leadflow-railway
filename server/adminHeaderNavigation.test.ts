import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "client/src/components/AdminHeader.tsx"), "utf8");

describe("AdminHeader Staff navigation contract", () => {
  it("groups Reviews, Hiring, and Focus under Staff with their existing routes and IDs", () => {
    const staffStart = source.indexOf('id: "staff"');
    const campaignsStart = source.indexOf('id: "campaigns-group"');
    expect(staffStart).toBeGreaterThan(-1);
    expect(campaignsStart).toBeGreaterThan(staffStart);

    const staffBlock = source.slice(staffStart, campaignsStart);
    expect(staffBlock).toContain('{ id: "review-tracker", label: "Reviews", href: "/admin/review-tracker"');
    expect(staffBlock).toContain('{ id: "hiring", label: "Hiring", href: "/admin/hiring"');
    expect(staffBlock).toContain('{ id: "madison-focus", label: "Focus", href: "/admin/madison-focus"');
  });

  it("keeps one permission-filtered navigation definition for each regrouped page", () => {
    expect(source.match(/id: "review-tracker"/g)).toHaveLength(1);
    expect(source.match(/id: "hiring"/g)).toHaveLength(1);
    expect(source.match(/id: "madison-focus"/g)).toHaveLength(1);
    expect(source).toContain("entry.children.filter(c => allowedPageIds.includes(c.id))");
    expect(source).toContain("if (visibleChildren.length === 0) return null");
  });
});
