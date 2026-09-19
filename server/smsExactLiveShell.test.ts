import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("SMS exact-live shell", () => {
  it("uses the copied review composition with live inbox behavior in matching slots", () => {
    const page = read("client/src/pages/SmsExactLive.tsx");
    const css = read("client/src/pages/sms-exact-live.css");
    const app = read("client/src/App.tsx");
    const customerPanel = read("client/src/components/CsRightPanelClient.tsx");

    expect(page).toContain('import "./cs-inbox-crm-review.css";');
    expect(page).toContain('import "./sms-review.css";');
    expect(page).toContain('import "./sms-exact-live.css";');
    expect(page).toContain('className="operations-crm-review cic-shell"');
    expect(page).toContain('className="cic-board-scroll"');
    expect(page).toContain('className="cic-detail-layout"');
    expect(page).toContain('trpc.leads.listCsInbox.useQuery');
    expect(page).toContain('trpc.leads.getCsConversation.useQuery');
    expect(page).toContain('trpc.leads.sendMessage.useMutation');
    expect(page).toContain('trpc.opsChat.addCsInbox2Note.useMutation');
    expect(page).toContain('trpc.leads.resolveSession.useMutation');
    expect(page).toContain('trpc.leads.sendWorkspaceMessage.useMutation');
    expect(page).toContain('trpc.leads.getClientProfile.useQuery');
    expect(page).toContain('trpc.leads.getCleanerProfileByPhone.useQuery');
    expect(page).toContain('trpc.leads.getCleanerTodayJobs.useQuery');
    expect(page).toContain('getCsInboxReplyPhoneNumberIdForSelectedConversation');
    expect(page).not.toContain('<CsInbox2');
    expect(css).toContain('.sms-exact-live .cic-live-tools');
    expect(css).toContain('.sms-exact-live .cic-detail-layout { min-height: 0; grid-template-rows: minmax(0, 1fr); }');
    expect(css).toContain('.sms-exact-live .cic-detail-layout > .cic-thread-main { overflow: hidden; }');
    expect(css).toContain('.sms-exact-live .cic-message p { overflow-wrap: anywhere; }');
    expect(page).toContain('const CUSTOMER_PORTRAITS = [');
    expect(page).toContain('function customerPortraitFor(value: string)');
    expect(page).toContain('cic-live-avatar cic-portrait');
    expect(page).toContain('new Event("review-workspace-collapse")');
    expect(page).toContain('function mediaDisplayUrl(url: string)');
    expect(page).toContain('function isVideoMedia(url: string)');
    expect(page).toContain('`/api/media-proxy?url=${encodeURIComponent(url)}`');
    expect(page).toContain('<video controls preload="metadata"');
    expect(page).toContain('const [mmsLightbox, setMmsLightbox]');
    expect(page).toContain('className="cic-live-mission"');
    expect(page).toContain('function InlineCustomerMission');
    expect(page).toContain('activeMission={activeMission}');
    expect(page).toContain('setActiveMission={setActiveMission}');
    expect(page).toContain('trpc.aiConcierge.chat.useMutation');
    expect(page).toContain('trpc.aiConcierge.sendPaymentLinkSms.useMutation');
    expect(page).toContain('trpc.csMissions.sendQuoteSms.useMutation');
    expect(page).toContain('const renderableTimeline = useMemo');
    expect(page).toContain('entry.message.text.trim() && <p>{entry.message.text}</p>');
    expect(page).not.toContain('initialMission={initialMission}');
    expect(customerPanel).toContain('initialMission?: "payment" | "quote" | "agreement" | null;');
    expect(customerPanel).toContain('if (initialMission === "payment") firePaymentLink();');
    expect(customerPanel).toContain('if (initialMission === "quote") setShowQuoteWidget(true);');
    expect(customerPanel).toContain('if (initialMission === "agreement")');
    expect(css).toContain('scrollbar-color: #4a4a51 #18181a;');
    expect(css).toContain('::-webkit-scrollbar-thumb');
    expect(css).toContain('.sms-exact-live .cic-mms-lightbox');
    expect(css).toContain('.sms-exact-live .cic-live-media video');
    expect(css).toContain('.sms-exact-live .cic-live-mission');
    expect(css).toContain('.sms-exact-live .cic-inline-mission');
    expect(app).toContain('const SmsExactLive = lazy(() => import("./pages/SmsExactLive"));');
    expect(app).toContain('function AdminSmsExactLiveRoute()');
    expect(app).toContain('const isSmsWorkspace = location === "/admin/sms";');
  });

  it("does not introduce the retired booking dependency", () => {
    const page = read("client/src/pages/SmsExactLive.tsx");
    expect(page).not.toContain(["cleaner", "Jobs"].join(""));
    expect(page).not.toContain(["cleaner", "_jobs"].join(""));
  });
});
