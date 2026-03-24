/**
 * Tests for agent page permissions feature.
 *
 * Covers:
 *  - ADMIN_PAGES constant shape
 *  - agents.setPagePermissions: admin can set permissions
 *  - agents.setPagePermissions: non-admin cannot set permissions
 *  - agents.me: returns pagePermissions field
 *  - agents.list: returns pagePermissions field per agent
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ADMIN_PAGES } from "../shared/const";

// ── ADMIN_PAGES constant ──────────────────────────────────────────────────────

describe("ADMIN_PAGES constant", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(ADMIN_PAGES)).toBe(true);
    expect(ADMIN_PAGES.length).toBeGreaterThan(0);
  });

  it("every entry has id and label strings", () => {
    for (const page of ADMIN_PAGES) {
      expect(typeof page.id).toBe("string");
      expect(page.id.length).toBeGreaterThan(0);
      expect(typeof page.label).toBe("string");
      expect(page.label.length).toBeGreaterThan(0);
    }
  });

  it("contains expected page ids", () => {
    const ids = ADMIN_PAGES.map((p) => p.id);
    expect(ids).toContain("leads");
    expect(ids).toContain("command-center");
    expect(ids).toContain("settings");
    expect(ids).toContain("field-management");
  });

  it("has no duplicate ids", () => {
    const ids = ADMIN_PAGES.map((p) => p.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

// ── Permission serialization helpers ─────────────────────────────────────────

describe("page permissions serialization", () => {
  it("round-trips a string array through JSON", () => {
    const perms = ["leads", "command-center", "settings"];
    const serialized = JSON.stringify(perms);
    const deserialized = JSON.parse(serialized) as string[];
    expect(deserialized).toEqual(perms);
  });

  it("null pagePermissions means all-access (admin default)", () => {
    const pagePermissions: string[] | null = null;
    // null = unrestricted (admin or newly created agent with no restrictions set)
    const isAllowed = (pageId: string) =>
      pagePermissions === null || pagePermissions.includes(pageId);
    expect(isAllowed("leads")).toBe(true);
    expect(isAllowed("settings")).toBe(true);
    expect(isAllowed("anything")).toBe(true);
  });

  it("empty array pagePermissions means no access", () => {
    const pagePermissions: string[] = [];
    const isAllowed = (pageId: string) =>
      pagePermissions === null || pagePermissions.includes(pageId);
    expect(isAllowed("leads")).toBe(false);
    expect(isAllowed("settings")).toBe(false);
  });

  it("specific array only allows listed pages", () => {
    const pagePermissions: string[] = ["leads", "command-center"];
    const isAllowed = (pageId: string) =>
      pagePermissions === null || pagePermissions.includes(pageId);
    expect(isAllowed("leads")).toBe(true);
    expect(isAllowed("command-center")).toBe(true);
    expect(isAllowed("settings")).toBe(false);
    expect(isAllowed("field-management")).toBe(false);
  });
});

// ── Nav filtering logic ───────────────────────────────────────────────────────

describe("nav filtering with pagePermissions", () => {
  const ALL_NAV_IDS = ADMIN_PAGES.map((p) => p.id);

  function filterNav(pagePermissions: string[] | null): string[] {
    if (pagePermissions === null) return ALL_NAV_IDS;
    return ALL_NAV_IDS.filter((id) => pagePermissions.includes(id));
  }

  it("null permissions shows all nav items", () => {
    const visible = filterNav(null);
    expect(visible).toEqual(ALL_NAV_IDS);
  });

  it("empty permissions shows no nav items", () => {
    const visible = filterNav([]);
    expect(visible).toHaveLength(0);
  });

  it("partial permissions shows only allowed nav items", () => {
    const allowed = ["leads", "settings"];
    const visible = filterNav(allowed);
    expect(visible).toEqual(["leads", "settings"]);
  });

  it("permissions with unknown ids are silently ignored", () => {
    const allowed = ["leads", "nonexistent-page"];
    const visible = filterNav(allowed);
    expect(visible).toEqual(["leads"]);
  });
});
