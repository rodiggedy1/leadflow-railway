import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { getCleanerCallbackDestination, withTeamLeaderboardDestination } from "../shared/teamLeaderboardAccess";

const root = resolve(import.meta.dirname, "..");
const baseline = "166ab595dfd7730dad3da1b6ba5ab03fc767c918";
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");
const original = (relative: string) => execFileSync("git", ["show", `${baseline}:${relative}`], { cwd: root, encoding: "utf8" });
const origin = "https://quote.maidinblack.com";
// Synthetic format-only token. No real login link is generated or verified by these tests.
const token = "a".repeat(64);
const existing = `${origin}/auth/cleaner-callback?token=${token}`;

function execute(source: string, imports: Record<string, unknown>) {
  const module = { exports: {} as Record<string, any> };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(code, {
    module, exports: module.exports,
    require(id: string) {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (Object.hasOwn(imports, id)) return imports[id];
      throw new Error(`Offline leaderboard rejected import: ${id}`);
    },
  });
  return module.exports;
}

describe("exact allowlisted cleaner callback destinations", () => {
  it("uses the leaderboard only for the exact view value and drops token/job/arbitrary redirects", () => {
    expect(getCleanerCallbackDestination(new URLSearchParams(`token=${token}&view=team-leaderboard&job=leadflow:7&redirect=https://evil.test`)))
      .toBe("/team-leaderboard");
  });
  it.each([
    "", "Team-leaderboard", "team-leaderboard/", " team-leaderboard", "team-leaderboard ",
    "/team-leaderboard", "//evil.test", "https://evil.test", "javascript:alert(1)",
    "team-leaderboard?token=secret", "team-leaderboard#fragment", "team-leaderboard\n",
  ])("ignores non-allowlisted view %j without accepting an open redirect", view => {
    const params = new URLSearchParams({ view, redirect: "https://evil.test", next: "//evil.test", token });
    expect(getCleanerCallbackDestination(params)).toBe("/portal-v2");
    params.set("job", "leadflow:123");
    expect(getCleanerCallbackDestination(params)).toBe("/portal-v2?job=leadflow%3A123");
  });
  it.each(["leadflow:0", "leadflow:1", "leadflow:007", "leadflow:123456789"]) (
    "preserves the existing validated job behavior for %s", job => {
      expect(getCleanerCallbackDestination(new URLSearchParams({ job }))).toBe(`/portal-v2?job=${encodeURIComponent(job)}`);
    },
  );
  it.each(["", "123", "leadflow:-1", "leadflow:1.5", "leadflow:1/foo", "leadflow:1&token=secret", "Leadflow:1", "leadflow:1\n", "//evil.test", "https://evil.test"]) (
    "drops invalid jobs %j", job => {
      expect(getCleanerCallbackDestination(new URLSearchParams({ job, token }))).toBe("/portal-v2");
    },
  );
  it("does not mutate callback parameters and follows existing first-parameter semantics", () => {
    const params = new URLSearchParams("view=other&view=team-leaderboard&job=leadflow:12");
    const before = params.toString();
    expect(getCleanerCallbackDestination(params)).toBe("/portal-v2?job=leadflow%3A12");
    expect(params.toString()).toBe(before);
    expect(getCleanerCallbackDestination(new URLSearchParams("view=team-leaderboard&view=https://evil.test"))).toBe("/team-leaderboard");
  });
});

describe("decorate only an existing trusted HTTPS callback magic link", () => {
  it("retains URL identity, token, job, and unrelated parameters while replacing only view", () => {
    const input = `${existing}&job=leadflow%3A91&note=hello%20world&tag=one&tag=two&view=old&view=other`;
    const result = withTeamLeaderboardDestination(input, origin);
    expect(result).not.toBeNull();
    const before = new URL(input);
    const after = new URL(result!);
    expect(after.origin).toBe(before.origin);
    expect(after.pathname).toBe(before.pathname);
    expect(after.searchParams.getAll("token")).toEqual([token]);
    expect(after.searchParams.getAll("view")).toEqual(["team-leaderboard"]);
    before.searchParams.delete("view");
    after.searchParams.delete("view");
    expect(Array.from(after.searchParams)).toEqual(Array.from(before.searchParams));
    expect(withTeamLeaderboardDestination(result!, origin)).toBe(result);
    expect(withTeamLeaderboardDestination(existing, `${origin}/`)).not.toBeNull();
  });
  it.each([
    "not-a-url", "/auth/cleaner-callback?token=anything", `//quote.maidinblack.com/auth/cleaner-callback?token=${token}`,
    existing.replace("https:", "http:"), existing.replace("https:", "javascript:"),
    existing.replace("quote.maidinblack.com", "evil.test"), existing.replace("quote.maidinblack.com", "quote.maidinblack.com.evil.test"),
    existing.replace("quote.maidinblack.com", "quote.maidinblack.com@evil.test"), existing.replace("https://", "https://staff@"),
    existing.replace("/auth/cleaner-callback", "/auth/cleaner-callback/"), existing.replace("/auth/cleaner-callback", "/auth/cleaner-callback-extra"),
    existing.replace("/auth/cleaner-callback", "/other/../auth/cleaner-callback"), existing.replace("/auth/cleaner-callback", "/auth/%63leaner-callback"),
    `${existing}#fragment`, `${existing}&token=${token}`, `${existing}&token=`, `${existing} `, `\n${existing}`,
    existing.replace("cleaner-callback", "cleaner-\ncallback"), existing.replace(`token=${token}`, "token="),
    existing.replace(`token=${token}`, "token=short"), existing.replace(`token=${token}`, `token=${"g".repeat(64)}`),
    existing.replace(`token=${token}`, `not-token=${token}`), `${origin}/auth/cleaner-callback`,
  ])("rejects malformed or untrusted existing link case %# without returning token-bearing errors", input => {
    expect(withTeamLeaderboardDestination(input, origin)).toBeNull();
  });
  it.each(["https://evil.test", "http://quote.maidinblack.com", `${origin}/path`, `${origin}?redirect=anything`, `${origin}#fragment`, ` ${origin}`, "not-an-origin", "https://staff@quote.maidinblack.com"])(
    "rejects invalid expected origin %j", expected => {
      expect(withTeamLeaderboardDestination(existing, expected)).toBeNull();
    },
  );
});

describe("preserve released authentication and all other App paths", () => {
  it("normalizes only the approved callback destination additions to the byte-identical baseline", () => {
    const source = read("client/src/pages/CleanerAuthCallback.tsx");
    const normalized = source
      .replace('import { getCleanerCallbackDestination } from "@shared/teamLeaderboardAccess";\n', "")
      .replace('  const callbackDestination = getCleanerCallbackDestination(callbackParams);\n', "")
      .replace('        if (callbackDestination === "/team-leaderboard") {\n          window.location.replace(callbackDestination);\n        } else {\n          window.location.replace(`/portal-v2${messageJobQuery}`);\n        }', '        window.location.replace(`/portal-v2${messageJobQuery}`);')
      .replace("messageJobQuery, callbackDestination]);", "messageJobQuery]);");
    expect(normalized).toBe(original("client/src/pages/CleanerAuthCallback.tsx"));
    // Keep the existing handoff source-contract markers intact too.
    expect(source).toContain('const messageJobQuery = /^leadflow:\\d+$/.test(requestedJob)');
    expect(source).toContain('window.location.replace(`/portal-v2${messageJobQuery}`)');
  });
  it("adds only the approved team/admin routes, admin workspace frame and exact runtime bypasses to App", () => {
    const source = read("client/src/App.tsx");
    expect(source.match(/if \(location === "\/team-leaderboard"\) return null;/g)).toHaveLength(2);
    const normalized = source
      .replace('const TeamLeaderboard = lazy(() => import("./pages/TeamLeaderboard"));\n', "")
      .replace('const AdminTeamLeaderboard = lazy(() => import("./pages/AdminTeamLeaderboard"));\n', "")
      .replace('function AdminTeamLeaderboardRoute() {\n  return <div className="review-nav-host tl-admin-workspace-host"><ReviewWorkspaceNav activePath="/review/reviews-quality" /><AdminTeamLeaderboard /></div>;\n}\n\n', "")
      .replace('        <Route path={"/team-leaderboard"} component={TeamLeaderboard} />\n', "")
      .replace('        <Route path={"/admin/team-leaderboard"} component={AdminTeamLeaderboardRoute} />\n', "")
      .replace('location === "/admin/dashboard" || location === "/admin/team-leaderboard"', 'location === "/admin/dashboard"')
      .replaceAll('  if (location === "/team-leaderboard") return null;\n', "");
    expect(normalized).toBe(original("client/src/App.tsx"));
  });
  it("does not alter existing backend identity/authentication or magic-link generators", () => {
    expect(read("server/cleanerRouter.ts")).toBe(original("server/cleanerRouter.ts"));
  });
  it("contains no legacy job-data dependency in the assigned access files", () => {
    const forbidden = new RegExp(["cleaner", "[_]?", "[jJ]obs"].join(""));
    for (const file of ["shared/teamLeaderboardAccess.ts", "client/src/pages/TeamLeaderboard.tsx", "client/src/pages/CleanerAuthCallback.tsx", "client/src/App.tsx"]) {
      expect(read(file)).not.toMatch(forbidden);
    }
  });
  it("executes both real App runtime wrappers and skips only the exact new path", () => {
    const source = read("client/src/App.tsx");
    let location = "/team-leaderboard";
    const imports: Record<string, unknown> = {
      react: { lazy: () => () => null }, wouter: { useLocation: () => [location] },
      "./components/LeadAssignmentWatcher": { default: () => null },
    };
    // Import-only stubs: no staff component, hook, or lazy page is loaded.
    for (const match of Array.from(source.matchAll(/^import .* from ["']([^"']+)["'];?$/gm))) {
      if (!Object.hasOwn(imports, match[1])) imports[match[1]] = {};
    }
    for (const match of Array.from(source.matchAll(/^import ["']([^"']+)["'];?$/gm))) imports[match[1]] = {};
    const runtime = execute(`${source}\nexport { DayBoardSafePollingInstrumentation, DayBoardSafeRuntimeWatchers };`, imports);
    const control = execute(`${original("client/src/App.tsx")}\nexport { DayBoardSafePollingInstrumentation, DayBoardSafeRuntimeWatchers };`, imports);
    for (const name of ["DayBoardSafePollingInstrumentation", "DayBoardSafeRuntimeWatchers"]) {
      location = "/team-leaderboard";
      expect(runtime[name]()).toBeNull();
      expect(control[name]()).not.toBeNull();
      for (const path of ["/team-leaderboard/child", "/team-leaderboard-other", "/team-leaderboard/", "/", "/portal-v2", "/auth/cleaner-callback", "/admin/command-center", "/admin/day-board", "/admin/invoices/collect", "/invoice/synthetic"]) {
        location = path;
        expect(runtime[name]() === null).toBe(control[name]() === null);
      }
    }
  });
});

describe("actual leaderboard wrapper with synthetic identity only", () => {
  function render(query: Record<string, unknown>, results: Record<string, unknown> = { isLoading: true, isError: false, data: undefined }) {
    const useQuery = vi.fn(() => query);
    const resultsQuery = vi.fn(() => results);
    const view = vi.fn((_props: Record<string, unknown>) => null);
    const page = execute(read("client/src/pages/TeamLeaderboard.tsx"), {
      "@/lib/trpc": { trpc: { cleaner: { me: { useQuery } }, leadflowJobs: { leaderboard: { forMe: { useQuery: resultsQuery } } } } },
      "@/components/TeamLeaderboardView": { TeamLeaderboardView: view },
    }).default;
    const markup = renderToStaticMarkup(React.createElement(page));
    expect(useQuery).toHaveBeenCalledTimes(1);
    expect(useQuery).toHaveBeenCalledWith(undefined, { retry: false, throwOnError: false });
    expect(resultsQuery).toHaveBeenCalledWith(undefined, {
      enabled: Boolean(query.data) && !query.isError, retry: false, throwOnError: false, refetchOnWindowFocus: false,
    });
    return { markup, view };
  }
  it("shows loading without any publication view", () => {
    const { markup, view } = render({ isLoading: true, isError: false, data: undefined });
    expect(markup).toContain("Checking your team access");
    expect(markup).toContain('aria-busy="true"');
    expect(view).not.toHaveBeenCalled();
  });
  it("shows a generic error without leaking query errors or stale identity", () => {
    const { markup, view } = render({ isLoading: false, isError: true, data: { id: 7 }, error: new Error(`secret ${token}`) });
    expect(markup).toContain("Unable to confirm access");
    expect(markup).not.toContain(token);
    expect(view).not.toHaveBeenCalled();
  });
  it("requires an active identity without constructing a token or rendering scores", () => {
    const { markup, view } = render({ isLoading: false, isError: false, data: null });
    expect(markup).toContain("Sign-in required");
    expect(markup).toContain("login link provided by your manager");
    expect(markup).not.toContain("token=");
    expect(view).not.toHaveBeenCalled();
  });
  it("passes only the server-supplied publication and canonical team ID after matching the active profile", () => {
    const publication = { weekLabel: "Synthetic week", teams: [], ownIncidents: [] };
    const details = {};
    const { markup, view } = render({ isLoading: false, isError: false, data: { id: 7, name: "Synthetic Cleaner" } }, {
      isLoading: false, isError: false, data: { cleanerProfileId: 7, ownTeamId: "900", publication, details },
    });
    expect(markup).not.toContain("not connected");
    expect(view).toHaveBeenCalledTimes(1);
    expect(view.mock.calls[0][0]).toEqual({ publication, ownTeamId: "900", details });
  });
  it("rejects stale previous-account results instead of rendering another team's cached feedback", () => {
    const { markup, view } = render({ isLoading: false, isError: false, data: { id: 7 } }, {
      isLoading: false, isError: false, data: { cleanerProfileId: 99, ownTeamId: "99", publication: { ownIncidents: [{ summary: "PRIVATE OTHER TEAM" }] }, details: {} },
    });
    expect(markup).toContain("Loading your team results");
    expect(markup).not.toContain("PRIVATE OTHER TEAM");
    expect(view).not.toHaveBeenCalled();
  });
  it("renders a generic results failure with no stale content or error payload", () => {
    const { markup, view } = render({ isLoading: false, isError: false, data: { id: 7 } }, {
      isLoading: false, isError: true, data: { cleanerProfileId: 7 }, error: new Error(`secret ${token}`),
    });
    expect(markup).toContain("Unable to load team results");
    expect(markup).not.toContain(token);
    expect(view).not.toHaveBeenCalled();
  });
});
