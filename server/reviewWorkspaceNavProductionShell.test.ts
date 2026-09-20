import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("shared workspace navigation production shell", () => {
  it("reuses the original shared rail on the four released workspace routes", () => {
    const app = read("client/src/App.tsx");

    expect(app).toContain('import ReviewWorkspaceNav from "./components/ReviewWorkspaceNav";');
    expect(app).toContain('<ReviewWorkspaceNav activePath={navActivePath} />');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/day-board-crm"><DayBoardExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/schedule-crm"><LeadflowScheduleCRMExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/sms"><SmsExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/emails"><EmailsExactLive /></ReviewWorkspaceFrame>');
  });

  it("retains the original rail's live destinations and suppresses the page-local rail", () => {
    const nav = read("client/src/components/ReviewWorkspaceNav.tsx");
    const css = read("client/src/components/review-workspace-nav.css");

    for (const destination of [
      'liveHref: "/admin/day-board"',
      'liveHref: "/admin/schedule"',
      'liveHref: "/admin/sms"',
      'liveHref: "/admin/emails"',
      'liveHref: "/admin/command-chat"',
      'liveHref: "/admin/ai-calls"',
    ]) expect(nav).toContain(destination);

    expect(css).toContain('.review-nav-host .ocr-sidebar{display:none!important}');
    expect(nav).not.toContain("OperationsWorkspaceSidebar");
  });
});
