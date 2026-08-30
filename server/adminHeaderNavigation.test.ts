import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const source = fs.readFileSync(path.join(root, "client/src/components/AdminHeader.tsx"), "utf8");

describe("AdminHeader Staff navigation contract", () => {
  it("groups Leads, Pipeline, and Voice tools into one Leads dropdown", () => {
    const leadsStart = source.indexOf('id: "leads-group"');
    const staffStart = source.indexOf('id: "staff"');
    expect(leadsStart).toBeGreaterThan(-1);
    expect(staffStart).toBeGreaterThan(leadsStart);

    const leadsBlock = source.slice(leadsStart, staffStart);
    expect(leadsBlock).toContain('{ id: "leads",         label: "Leads",        href: "/admin/leads"');
    expect(leadsBlock).toContain('{ id: "pipeline",      label: "Pipeline",     href: "/admin/leads?tab=pipeline"');
    expect(leadsBlock).toContain('{ id: "callbacks",    label: "Callbacks",    href: "/admin/leads?tab=callbacks"');
    expect(leadsBlock).toContain('{ id: "calls",        label: "All Calls",    href: "/admin/calls"');
    expect(leadsBlock).toContain('{ id: "missed-calls", label: "Missed Calls", href: "/admin/missed-calls"');
    expect(source).not.toContain('id: "voice",');
  });

  it("keeps the Voice pending-count badge on the consolidated Leads trigger", () => {
    expect(source).toContain('entry.id === "leads-group" && <VoicePendingBadge />');
    expect(source).toContain("trpc.voice.listCallbacks.useQuery");
    expect(source).toContain("trpc.missedCalls.getPendingCount.useQuery");
    expect(source).toContain("onMissedCall: () => refetchMissed()");
  });

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
    expect(source.match(/id: "leads"/g)).toHaveLength(1);
    expect(source.match(/id: "pipeline"/g)).toHaveLength(1);
    expect(source.match(/id: "review-tracker"/g)).toHaveLength(1);
    expect(source.match(/id: "hiring"/g)).toHaveLength(1);
    expect(source.match(/id: "madison-focus"/g)).toHaveLength(1);
    expect(source).toContain("entry.children.filter(c => allowedPageIds.includes(c.id))");
    expect(source).toContain("if (visibleChildren.length === 0) return null");
  });
});
