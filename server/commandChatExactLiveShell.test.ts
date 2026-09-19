import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Command Chat exact live shell", () => {
  it("keeps the approved review composition while binding only existing Command Chat data and actions", () => {
    const page = read("client/src/pages/CommandChatExactLive.tsx");
    const styles = read("client/src/pages/command-chat-exact-live.css");
    const app = read("client/src/App.tsx");

    for (const stylesheet of [
      "command-chat-crm-review.css",
      "command-chat-left-cohesion.css",
      "command-chat-conversation-list.css",
      "command-chat-group-conversation.css",
      "command-chat-reference-composition.css",
      "command-chat-header-composition.css",
      "command-chat-exact-live.css",
    ]) {
      expect(page).toContain(`"./${stylesheet}"`);
    }

    for (const marker of [
      'className="ccc-workspace"',
      'className="ccc-command-grid"',
      'className="ccc-command-panel ccc-left-panel"',
      'className="ccc-command-panel ccc-center-panel"',
      'className="ccc-command-panel ccc-right-panel"',
      'className="ccc-message-stream"',
      'className="ccc-composer"',
      'className="ccc-live-thread-drawer"',
    ]) {
      expect(page).toContain(marker);
    }

    for (const procedure of [
      "listChannelMessages.useQuery",
      "sendMessage.useMutation",
      "getAllAgentPhotoMap.useQuery",
      "getAgentStatusList.useQuery",
      "getChannelCounts.useQuery",
      "listActiveThreads.useQuery",
      "getThreadReplies.useQuery",
      "toggleReaction.useMutation",
      "getReactions.useMutation",
      "uploadOpsPhoto.useMutation",
      "transcribeVoiceNote.useMutation",
      "createIssue.useMutation",
      "setReminder.useMutation",
      "pinNote.useMutation",
      "announceBooking.useMutation",
    ]) {
      expect(page).toContain(procedure);
    }

    expect(page).toContain('useOpsStream({');
    expect(page).toContain('fetch("/api/agents/login"');
    expect(page).toContain('mediaUrl: attachmentUrls.length ? JSON.stringify(attachmentUrls) : undefined');
    expect(styles).toContain(".ccc-live-thread-drawer");
    expect(styles).toContain(".ccc-live-message-media");
    expect(app).toContain('const CommandChatExactLive = lazy(() => import("./pages/CommandChatExactLive"));');
    expect(app).toContain('function AdminCommandChatExactLiveRoute() { return <ReviewWorkspaceFrame hideNavigation><CommandChatExactLive /></ReviewWorkspaceFrame>; }');
    expect(app).toContain('<Route path={"/admin/command-chat"} component={AdminCommandChatExactLiveRoute} />');
    expect(app).toContain('const isCommandChatWorkspace = location === "/admin/command-chat";');
  });

  it("does not mount the legacy CommandChat or OpsChat page as the new route shell", () => {
    const app = read("client/src/App.tsx");
    expect(app).not.toContain('path={"/admin/command-chat"} component={CommandChatCRMReviewRoute}');
    expect(app).not.toContain('path={"/admin/command-chat"} component={OpsChatRedirect}');
  });
});
