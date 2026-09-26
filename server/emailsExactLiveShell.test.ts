import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Admin Emails route", () => {
  it("uses the separate one-way CsInbox2 Email copy and leaves CsInbox2 unchanged", () => {
    const app = read("client/src/App.tsx");
    const emailCopy = read("client/src/components/CsInbox2Email.tsx");
    const csInbox2 = read("client/src/components/CsInbox2.tsx");
    expect(app).toContain('const CsInbox2Email = lazy(() => import("./components/CsInbox2Email"));');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/emails"><CsInbox2Email /></ReviewWorkspaceFrame>');
    expect(emailCopy).toContain('trpc.gmail.getThread.useQuery(');
    expect(emailCopy).toContain('trpc.opsChat.listEmailInboxThreads.useQuery');
    expect(emailCopy).toContain('trpc.gmail.sendReply.useMutation');
    expect(emailCopy).toContain('trpc.gmail.completeThread.useMutation');
    expect(emailCopy).toContain('DOMPurify.sanitize(message.bodyHtml, { USE_PROFILES: { html: true } })');
    expect(csInbox2).toContain('export default function CsInbox2()');
  });
});
