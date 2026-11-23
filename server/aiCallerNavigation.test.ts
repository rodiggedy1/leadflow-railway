import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
describe("caller navigation", () => {
  it("places an accessible compact call link in the actual Command Chat header, in the same tab", () => {
    const source = read("client/src/pages/CommandChatExactLive.tsx");
    const actions = source.slice(source.indexOf('<div className="ccc-reference-chat-actions">'));
    const link = actions.match(/<a className="ccc-header-call-link"[^>]*>[\s\S]*?<\/a>/)?.[0];
    expect(link).toContain('href="/admin/ai-calls"');
    expect(link).toContain('aria-label="Open AI Calls"');
    expect(link).toContain('<PhoneCall />');
    expect(link).not.toContain("target=");
    expect(actions).toContain('aria-label="Active command participants"');
    const css = read("client/src/pages/command-chat-header-composition.css");
    expect(css).toContain(".ccc-reference-chat-actions>.ccc-header-call-link");
    expect(css).toContain(".ccc-header-call-link:focus-visible");
  });
  it("makes the approved caller the default while preserving the unchanged existing configuration", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('if (view === "configuration") return <ReviewWorkspaceFrame navActivePath="/review/ai-calls-transcript"><AiCallsExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<ReviewWorkspaceFrame hideNavigation><AiCallerLive /></ReviewWorkspaceFrame>');
    expect(read("client/src/components/AiCallerWorkspace.tsx")).toContain('href="/admin/command-chat"');
    expect(read("client/src/pages/AiCallerLive.tsx")).toContain('window.location.href = "/admin/ai-calls?view=configuration"');
  });
});
