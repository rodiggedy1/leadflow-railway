import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("cleaner customer-message magic-link handoff", () => {
  it("preserves only a validated booking reference through login and opens the existing guarded conversation drawer", async () => {
    const [customerRouter, callback, cleanerRouter, cleanerPortal] = await Promise.all([
      readFile(path.resolve(root, "server/customerPortalRouter.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/CleanerAuthCallback.tsx"), "utf8"),
      readFile(path.resolve(root, "server/cleanerPortalMessagesRouter.ts"), "utf8"),
      readFile(path.resolve(root, "client/src/pages/CleanerPortalConnected.tsx"), "utf8"),
    ]);

    expect(customerRouter).toContain('cleanerPortalLink = `${cleanerMagicLink}&job=${encodeURIComponent(`leadflow:${job.id}`)}`');
    expect(callback).toContain('const messageJobQuery = /^leadflow:\\d+$/.test(requestedJob)');
    expect(callback).toContain('window.location.replace(`/portal-v2${messageJobQuery}`)');
    expect(cleanerRouter).toContain("eq(leadflowJobs.teamId, cleaner.teamId)");
    expect(cleanerRouter).toContain("job: { portalJobKey: input.portalJobKey");
    expect(cleanerRouter).toContain("messages,");
    expect(cleanerPortal).toContain('new URLSearchParams(window.location.search).get("job")');
    expect(cleanerPortal).toContain("trpc.cleanerPortalMessages.getForJob.useQuery");
    expect(cleanerPortal).toContain("setContactJob(linkedMessageQuery.data.job)");
    expect(cleanerPortal).toContain("function ContactClientPanel");
    expect(cleanerPortal).toContain("threadQuery.data?.messages");
  });
});
