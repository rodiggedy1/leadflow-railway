import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Team exact-live workspace", () => {
  it("uses existing agent accounts, access controls, and performance procedures", () => {
    const page = read("client/src/pages/TeamExactLive.tsx");

    expect(page).toContain("trpc.agents.list.useQuery");
    expect(page).toContain("trpc.agents.performance.useQuery");
    expect(page).toContain("trpc.agents.callAssistStats.useQuery");
    expect(page).toContain("trpc.agents.create.useMutation");
    expect(page).toContain("trpc.agents.setActive.useMutation");
    expect(page).toContain("trpc.agents.setPagePermissions.useMutation");
    expect(page).toContain("trpc.agents.resetPassword.useMutation");
    expect(page).toContain("useState<string[] | null>(null)");
    expect(page).toContain("pagePermissions: draftPermissions");
    expect(page).toContain("Connected to existing agent accounts and performance records");
    expect(page).not.toContain("Static review workspace");
  });

  it("keeps account-changing actions explicitly confirmed", () => {
    const page = read("client/src/pages/TeamExactLive.tsx");

    expect(page).toContain("Create the Team account");
    expect(page).toContain("Reset the password for");
    expect(page).toContain("Save page access for");
    expect(page).toContain("Deactivate account");
  });

  it("registers the Team page as an admin-controlled live workspace", () => {
    const app = read("client/src/App.tsx");
    const guard = read("client/src/components/AdminPageGuard.tsx");

    expect(app).toContain('const TeamExactLive = lazy(() => import("./pages/TeamExactLive"));');
    expect(app).toContain("function AdminTeamExactLiveRoute()");
    expect(app).toContain('pageId="agents"');
    expect(app).toContain('navActivePath="/review/team"');
    expect(app).toContain("<TeamExactLive />");
    expect(app).toContain('<Route path={"/admin/team"} component={AdminTeamExactLiveRoute} />');
    expect(guard).toContain('"agents":            "/admin/team"');
  });
});
