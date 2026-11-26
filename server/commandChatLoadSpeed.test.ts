import { readFileSync } from "node:fs";
import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import { createTrpcLinks } from "../client/src/lib/trpcLinks";
import { orderChannelFeed } from "./opsChannelFeedOrder";

const page = readFileSync("client/src/pages/CommandChatExactLive.tsx", "utf8");
const voiceRouter = readFileSync("server/voiceRouter.ts", "utf8");
const opsRouter = readFileSync("server/opsChatRouter.ts", "utf8");

// ---------- channel feed: identical result to the old single query ----------
type Row = { id: number; createdAtMs: number; quickAction: string | null; cardStatus: string | null; lastActivityAt: number | null };
/** The old SQL ORDER BY expression, exactly (ties: newest id first). */
const sortKey = (r: Row) => r.quickAction === "madison_sms_draft" && r.cardStatus === "active" ? (r.lastActivityAt ?? r.createdAtMs) : r.createdAtMs;
const oldQuery = (rows: Row[], limit: number) => [...rows].sort((a, b) => sortKey(b) - sortKey(a) || b.id - a.id).slice(0, limit).map(r => r.id);
function newQuery(rows: Row[], limit: number) {
  const withKey = rows.map(r => ({ ...r, sortKey: sortKey(r) }));
  const active = withKey.filter(r => r.quickAction === "madison_sms_draft" && r.cardStatus === "active");
  const newest = [...withKey].sort((a, b) => b.createdAtMs - a.createdAtMs || b.id - a.id).slice(0, limit + active.length);
  return orderChannelFeed([...active, ...newest], limit).map(r => r.id);
}
function random(seed: number) { return () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31; }

describe("Command Chat feed: same 500 messages in the same order, without sorting the whole channel", () => {
  it("matches the old query on 300 random channels, including resurfacing, stale and same-second draft cards", () => {
    const rnd = random(7);
    for (let trial = 0; trial < 300; trial++) {
      const size = Math.floor(rnd() * 1400), limit = trial % 3 === 0 ? 5 : 500, rows: Row[] = [];
      for (let id = 1; id <= size; id++) {
        const createdAtMs = Math.floor((1_700_000_000 + id * 60 + Math.floor(rnd() * 120)) / 1) * 1000; // second precision, ties likely
        const draft = rnd() < 0.15, active = draft && rnd() < 0.6;
        rows.push({ id, createdAtMs, quickAction: draft ? "madison_sms_draft" : rnd() < 0.2 ? "new_lead" : null, cardStatus: draft ? (active ? "active" : "dismissed") : null,
          // resurfaced (much newer), slightly older than creation (the inbound's own time), or unset
          lastActivityAt: draft ? (rnd() < 0.1 ? null : createdAtMs + Math.floor((rnd() - 0.2) * 3_600_000 * (rnd() < 0.3 ? 2000 : 1))) : null });
      }
      expect(newQuery(rows, limit)).toEqual(oldQuery(rows, limit));
    }
  });
  it("keeps every message once and removes the helper's sort column", () => {
    const out = orderChannelFeed([{ id: 1, sortKey: 5, body: "a" }, { id: 1, sortKey: 5, body: "a" }, { id: 2, sortKey: 9, body: "b" }], 500);
    expect(out).toEqual([{ id: 2, body: "b" }, { id: 1, body: "a" }]);
  });
  it("the router computes the order with the original SQL expression and reads the newest messages by index", () => {
    expect(opsRouter).toContain("THEN COALESCE(${opsChatMessages.lastActivityAt}, UNIX_TIMESTAMP(${opsChatMessages.createdAt}) * 1000)");
    expect(opsRouter).toContain(".orderBy(desc(opsChatMessages.createdAt), desc(opsChatMessages.id))\n        .limit(500 + activeDraftCards.length);");
    expect(opsRouter).toContain("const msgs = orderChannelFeed([...activeDraftCards, ...newest], 500);");
  });
});

// ---------- request routing ----------
describe("request routing: essentials on their own, secondary in one background batch, everything else unchanged", () => {
  it("sends batch:none alone, batch:background together, and the rest exactly as before", async () => {
    const calls: { path: string; batch: boolean }[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://x"), batch = url.searchParams.get("batch") === "1";
      const paths = url.pathname.replace("/api/trpc/", "").split(",");
      calls.push({ path: paths.join(","), batch });
      const one = (p: string) => ({ result: { data: superjson.serialize({ path: p }) } });
      return new Response(JSON.stringify(batch ? paths.map(one) : one(paths[0])), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const client = createTRPCClient<any>({ links: createTrpcLinks(fakeFetch) }) as any;
    const results = await Promise.all([
      client.a.query(), client.b.query(),
      client.feed.query(undefined, { context: { batch: "none" } }), client.inbox.query(undefined, { context: { batch: "none" } }),
      client.stats.query(undefined, { context: { batch: "background" } }), client.pin.query(undefined, { context: { batch: "background" } }),
    ]);
    expect(results.map((r: any) => r.path)).toEqual(["a", "b", "feed", "inbox", "stats", "pin"]);
    expect(calls.map(c => c.path).sort()).toEqual(["a,b", "feed", "inbox", "stats,pin"].sort());
    expect(calls.find(c => c.path === "feed")!.batch).toBe(false);
    expect(calls.find(c => c.path === "a,b")!.batch).toBe(true);
  });
  it("main.tsx uses these links and no longer logs every query", () => {
    const main = readFileSync("client/src/main.tsx", "utf8");
    expect(main).toContain("trpc.createClient({ links: createTrpcLinks() })");
    expect(main).not.toContain("[QUERY FETCH]");
    expect(main).not.toContain("[INVALIDATE]");
  });
});

// ---------- Command Chat page ----------
describe("Command Chat page load order", () => {
  it("starts the feed's first fetch only after the live stream is connected (no gap), with a 1.5 s fallback", () => {
    expect(page).toContain('enabled: isAuthenticated && feedStreamGate !== "waiting", refetchInterval: 30_000');
    expect(page).toContain('setTimeout(() => setFeedStreamGate((gate) => gate === "waiting" ? "timeout" : gate), 1_500)');
    const onConnected = page.slice(page.indexOf("onConnected: () => {"), page.indexOf('}, { enabled: isAuthenticated, label: "CommandChatExactLive" });'));
    // Reconnects and the fallback path still reload the feed and tasks exactly as before.
    expect(onConnected).toContain("void utils.opsChat.listChannelMessages.invalidate({ channel });");
    expect(onConnected).toContain("void utils.claudeCustomerTasks.invalidate();");
    expect(onConnected.indexOf("listChannelMessages.invalidate")).toBeLessThan(onConnected.indexOf("setFeedStreamGate"));
    // Waiting counts as loading: the spinner shows, not an empty channel.
    expect(page).toContain('const messagesLoading = feedFetching || (isAuthenticated && feedStreamGate === "waiting");');
  });
  it("sends the feed, both inboxes and Thumbtack leads on their own; secondary queries start after the feed", () => {
    for (const q of ["listChannelMessages", "listCommandChatInbox", "listEmailInboxThreads", "thumbtackLead.listNative"]) {
      const at = page.indexOf(q === "thumbtackLead.listNative" ? "trpc.thumbtackLead.listNative.useQuery" : `.${q}.useQuery`);
      expect(at, q).toBeGreaterThan(0);
      expect(page.slice(at, at + 400), q).toContain("...ownRequest");
    }
    for (const q of ["getMyProfile", "getAllAgentPhotoMap", "listIssues", "getChannelPin", "getAgentStatusList", "listActiveThreads", "bookings.todayStats",
      "getSuperAlertMessageIds", "listInboundTeamSmsEvents", "voice.listCalls", "getLeadSessionStatuses"]) {
      const at = page.indexOf(`${q}.useQuery`);
      expect(at, q).toBeGreaterThan(0);
      const call = page.slice(at, at + 420);
      expect(call, q).toContain("...background");
      expect(call, q).toContain("backgroundReady");
    }
    expect(page).toContain('const backgroundReady = isAuthenticated && !messagesLoading && feedStreamGate !== "waiting";');
    // Alerts are not delayed (shared with the app-wide alert watcher).
    expect(page).toContain("trpc.opsChat.getPendingSuperAlerts.useQuery(undefined, { enabled: isAuthenticated, staleTime: 0, refetchInterval: 3_000");
  });
});

// ---------- call transcripts on demand ----------
describe("call transcripts load on demand", () => {
  it("Command Chat's call list leaves out transcripts and structured data, adding a has-transcript flag", () => {
    expect(page).toContain("{ limit: 50, offset: 0, omitTranscripts: true }");
    expect(voiceRouter).toContain("transcript: input.omitTranscripts ? sql<string | null>`NULL` : voiceCalls.transcript,");
    expect(voiceRouter).toContain("structuredData: input.omitTranscripts ? sql<string | null>`NULL` : voiceCalls.structuredData,");
    expect(voiceRouter).toContain("hasTranscript: Number(row.hasTranscript) === 1");
  });
  it("other pages still get full transcripts", () => {
    for (const other of ["client/src/pages/AiCallsExactLive.tsx", "client/src/pages/AllCalls.tsx", "client/src/pages/AiCallerLive.tsx"])
      expect(readFileSync(other, "utf8"), other).not.toContain("omitTranscripts");
  });
  it("the call card fetches one transcript only when its details are opened, and still offers details when only a transcript exists", () => {
    expect(page).toContain("enabled: detailsOpen && !preloadedTranscript && Boolean(evidence?.hasTranscript && handoff.vapiCallId)");
    expect(page).toContain("{(detailText || transcript || evidence?.hasTranscript) && <button");
    expect(page).toContain("Loading transcript…");
    const proc = voiceRouter.slice(voiceRouter.indexOf("getCallTranscript: agentProcedure"), voiceRouter.indexOf("getCallsBySession: agentProcedure"));
    expect(proc).toContain(".where(eq(voiceCalls.vapiCallId, input.vapiCallId))");
    expect(proc).not.toMatch(/insert|update\(|delete\(/);
  });
});
