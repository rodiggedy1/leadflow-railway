import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("literal CsInbox2 Email workspace", () => {
  it("keeps CsInbox2 as the unchanged working reference while routing Emails to a separate copy", () => {
    const app = read("client/src/App.tsx");
    const copy = read("client/src/components/CsInbox2EmailWorkspace.tsx");
    const source = read("client/src/components/CsInbox2.tsx");

    expect(app).toContain('const CsInbox2EmailWorkspace = lazy(() => import("./components/CsInbox2EmailWorkspace"));');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/emails"><CsInbox2EmailWorkspace /></ReviewWorkspaceFrame>');
    expect(app).not.toContain('const EmailsExactLive = lazy(() => import("./pages/EmailsExactLive"));');
    expect(copy).toContain('One-way copy of the working Email-specific branch from CsInbox2.');
    expect(source).toContain('export default function CsInbox2()');
  });

  it("copies the CsInbox2 Email query and mutation contracts without stored-thread fallback behavior", () => {
    const copy = read("client/src/components/CsInbox2EmailWorkspace.tsx");

    expect(copy).toContain('const [selectedEmailThreadId, setSelectedEmailThreadId] = useState<string | null>(initialThreadId);');
    expect(copy).toContain('trpc.opsChat.listEmailInboxThreads.useQuery(undefined, {');
    expect(copy).toContain('staleTime: 30_000');
    expect(copy).toContain('refetchOnWindowFocus: true');
    expect(copy).toContain('const emailThread = trpc.gmail.getThread.useQuery(');
    expect(copy).toContain('{ threadId: selectedEmailThreadId! },');
    expect(copy).toContain('{ enabled: !!selectedEmailThreadId, staleTime: 60_000, refetchOnWindowFocus: false }');
    expect(copy).toContain('trpc.opsChat.getEmailDraftByThreadId.useQuery(');
    expect(copy).toContain('refetchInterval: 15_000');
    expect(copy).toContain('trpc.gmail.sendReply.useMutation');
    expect(copy).toContain('trpc.gmail.completeThread.useMutation');
    expect(copy).toContain('trpc.opsChat.dismissEmailDraft.useMutation');
    expect(copy).toContain('threadId: selectedEmailThreadId, to: senderEmail, subject: subject, bodyHtml: emailReply.split');
    expect(copy).not.toContain('trpc.gmail.getStoredThread.useQuery');
  });

  it("copies the CsInbox2 sender, subject, body, and board behavior", () => {
    const copy = read("client/src/components/CsInbox2EmailWorkspace.tsx");

    expect(copy).toContain('const RELAY_DOMAINS = ["launch27mail.com","maidsinblacksupport.com"];');
    expect(copy).toContain('const rawSubject = t?.subject ?? "Email Thread";');
    expect(copy).toContain('rawSubject.replace(');
    expect(copy).toContain('DOMPurify.sanitize(msg.bodyHtml, { USE_PROFILES: { html: true } })');
    expect(copy).toContain('msg.bodyText || msg.snippet || "(no content)"');
    expect(copy).toContain('const getEmailColumn = (thread: typeof threads[0]) => {');
    expect(copy).toContain('return "Waiting on Customer";');
    expect(copy).toContain('return "At Risk";');
    expect(copy).toContain('return "New";');
    expect(copy).toContain('return "Needs Response";');
  });
});
