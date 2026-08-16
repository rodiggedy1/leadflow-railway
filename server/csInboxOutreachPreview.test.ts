import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const outreachSource = readFileSync(
  new URL("../client/src/components/CsInboxOutreachPreview.tsx", import.meta.url),
  "utf8"
);

describe("CsInbox Madison V1 UI contract", () => {
  it("uses only the approved existing draft, send, routing, and live-update infrastructure", () => {
    expect(outreachSource).toContain("trpc.madison.getNextBestActions.useQuery");
    expect(outreachSource).toContain("trpc.madison.deferNextBestAction.useMutation");
    expect(outreachSource).toContain("trpc.leads.sendMessage.useMutation");
    expect(outreachSource).toContain('fetch("/api/cs-reply-stream"');
    expect(outreachSource).toContain("getCsInboxReplyPhoneNumberId");
    expect(outreachSource).toContain("useOpsStream");
    expect(outreachSource).toContain("onLeadUpdate");
  });

  it("keeps the approved one-card workflow with Why Now, Send & Next, Skip, and caught-up state", () => {
    expect(outreachSource).toContain("YOUR NEXT BEST ACTION");
    expect(outreachSource).toContain("WHY NOW");
    expect(outreachSource).toContain("MADISON&apos;S SUGGESTED MESSAGE");
    expect(outreachSource).toContain("Send & Next");
    expect(outreachSource).toContain("Skip");
    expect(outreachSource).toContain("You&apos;re caught up.");
  });

  it("does not add direct provider, webhook, polling, or scheduling behavior", () => {
    expect(outreachSource).not.toContain("openphone");
    expect(outreachSource).not.toContain("setInterval");
    expect(outreachSource).not.toContain("cron");
    expect(outreachSource).not.toContain("webhook");
  });
});
