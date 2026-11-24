import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

// Owner-requested wording change (2026-11-24): the first tab in the Day Board's page tabs reads
// "Scheduler" instead of "Schedule". Only the label changes; the destination and the other tabs stay as they were.
describe("Day Board page tabs", () => {
  const shell = read("client/src/pages/DayBoardExactLive.tsx");
  const tabs = shell.match(/<nav className="dbr-page-tabs">([\s\S]*?)<\/nav>/)?.[1] ?? "";

  it("labels the schedule tab 'Scheduler' and still opens the Schedule page", () => {
    expect(tabs).toContain('<button onClick={() => navigate("/admin/schedule")}>Scheduler</button>');
    expect(tabs).not.toMatch(/>Schedule</);
  });

  it("keeps the other tabs, their order and their destinations unchanged", () => {
    // Button text is whatever sits between the last ">" and "</button>" (onClick handlers contain "=>").
    const labels = [...tabs.matchAll(/([^<>]+)<\/button>/g)].map(match => match[1]);
    expect(labels).toEqual(["Scheduler", "Day Board", "Team availability", "Workflow"]);
    expect(tabs).toContain('<button className="is-active">Day Board</button>');
    expect(tabs).toContain('<button onClick={() => navigate("/admin/team-availability")}>Team availability</button>');
    expect(tabs).toContain('<button onClick={() => navigate("/admin/field-management")}>Workflow</button>');
  });
});
