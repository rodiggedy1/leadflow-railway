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
    const faqPanel = read("client/src/components/FAQPanel.tsx");
    const responseModal = read("client/src/components/InsertResponseModal.tsx");
    const objectionsPanel = read("client/src/components/ObjectionsPanel.tsx");
    const worldClassPanel = read("client/src/components/WorldClassReplyPanel.tsx");

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
    expect(page).toContain('trpc.leadflowJobs.smsCustomerContext.useQuery');
    expect(page).toContain('trpc.leads.getCleanerProfileByPhone.useQuery');
    expect(page).toContain('trpc.leadflowJobs.smsTeamTodayJobs.useQuery');
    expect(page).toContain('utils.leadflowJobs.smsResolveNames.fetch');
    expect(page).toContain('trpc.opsChat.getAllAgentPhotoMap.useQuery');
    expect(page).toContain('trpc.leads.getCsInboxLastAgents.useQuery');
    expect(page).toContain('sort((a, b) => a - b).slice(0, 800)');
    expect(page).toContain('function LastAgentBadge');
    expect(page).toContain('LastAgentBadge name={lastAgentNameBySessionId[conversation.id] ?? null}');
    expect(page).toContain('name ? initials : <UserRound size={10} />');
    expect(page).not.toContain('priority: unanswered ? "P1" : "P2"');
    expect(page).not.toContain('<span className="cic-owner-portrait">MA</span>');
    expect(page).toContain('getCsInboxReplyPhoneNumberIdForSelectedConversation');
    expect(page).not.toContain('<CsInbox2');
    expect(css).toContain('.sms-exact-live .cic-live-tools');
    expect(css).toContain('.sms-exact-live .cic-owner-portrait.is-agent');
    expect(css).toContain('.sms-exact-live .cic-owner-portrait.is-unassigned');
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
    expect(page).toContain('<FAQPanel open={faqOpen} onClose={() => setFaqOpen(false)} context="CS Chat" theme="dark" />');
    expect(page).toContain('customerFirstName={selected.name.split(" ")[0]} theme="dark"');
    expect(page).toContain('<ObjectionsPanel open={objectionsOpen} onClose={() => setObjectionsOpen(false)} theme="dark" />');
    expect(page).toContain('jobContext={clientProfile?.todayJob ?');
    expect(page).toContain('theme="dark" />');
    expect(page).toContain('const [autoDraftText, setAutoDraftText] = useState("");');
    expect(page).toContain('const [autoDraftReady, setAutoDraftReady] = useState(false);');
    expect(page).toContain('const streamAutoDraft = useCallback(async () => {');
    expect(page).toContain('fetch("/api/cs-reply-stream"');
    expect(page).toContain('const smsConversationContext = useMemo(() => detailMessages.slice(-5)');
    expect(page).toContain('if (!selected || !detail || !smsConversationContext || autoDraftedForRef.current === selected.id) return;');
    expect(page).toContain('const request = { conversationContext: smsConversationContext, customerName: selected.name, jobContext };');
    expect(page).toContain('body: JSON.stringify(request)');
    expect(page).toContain('csAutoDraft.mutate(request);');
    expect(page).toContain('if (dataString === "[DONE]") continue;');
    expect(page).toContain('if (event.error) throw new Error(event.error);');
    expect(page).toContain('if (!accumulated.trim()) throw new Error("Stream returned an empty draft");');
    expect(page).toContain('setAutoDraftLoading(true);\n        csAutoDraft.mutate(request);');
    expect(page).toContain('setAutoDraftText(accumulated);');
    expect(page).toContain('const insertAutoDraft = useCallback(() => {');
    expect(page).toContain('setCompose(autoDraftText);');
    expect(page).toContain('className="cic-sms-ai-draft-card"');
    expect(page).toContain('Insert into reply');
    expect(page).toContain('onClick={regenerateAutoDraft}');
    expect(page).not.toContain('<section className="cic-context">');
    expect(page).not.toContain('<strong>Madison</strong><span>{selected.lastMessage');
    expect(page).not.toContain('setCompose(accumulated);');
    expect(page).not.toContain('setCompose(result.reply);');
    expect(css).toContain('.sms-exact-live .cic-sms-ai-draft-card');
    expect(css).toContain('.sms-exact-live .cic-sms-ai-draft-insert');
    expect(css).toContain('.sms-exact-live .cic-sms-ai-draft-regenerate');
    expect(css).toContain('scrollbar-color: #4a4a51 #18181a;');
    expect(css).toContain('::-webkit-scrollbar-thumb');
    expect(css).toContain('.sms-exact-live .cic-mms-lightbox');
    expect(css).toContain('.sms-exact-live .cic-live-media video');
    expect(css).toContain('.sms-exact-live .cic-live-mission');
    expect(css).toContain('.sms-exact-live .cic-inline-mission');
    expect(css).toContain('/* Dark composer assistants');
    expect(css).toContain('.cic-assistant-dark-backdrop');
    expect(css).toContain('.cic-response-assistant-dark');
    expect(css).toContain('.cic-objections-assistant-dark');
    expect(css).toContain('.cic-worldclass-assistant-dark');
    expect(css).toContain('.sms-exact-live .cic-composer { position: relative; }');
    for (const panel of [faqPanel, responseModal, objectionsPanel, worldClassPanel]) expect(panel).toContain('theme?: "dark";');
    expect(faqPanel).toContain('cic-faq-assistant-dark');
    expect(responseModal).toContain('cic-response-assistant-dark');
    expect(objectionsPanel).toContain('cic-objections-assistant-dark');
    expect(worldClassPanel).toContain('cic-worldclass-assistant-dark');
    expect(app).toContain('const SmsExactLive = lazy(() => import("./pages/SmsExactLive"));');
    expect(app).toContain('function AdminSmsExactLiveRoute()');
    expect(app).toContain('<ReviewWorkspaceFrame navActivePath="/review/sms"><SmsExactLive /></ReviewWorkspaceFrame>');
    expect(app).toContain('<Route path={"/admin/sms"} component={AdminSmsExactLiveRoute} />');
    expect(app).toContain('location === "/admin/day-board" || location === "/admin/sms"');
    expect(app).toContain('import ReviewWorkspaceNav from "./components/ReviewWorkspaceNav";');
  });

  it("uses only LeadFlow-owned context reads for customer, team, and card names", () => {
    const page = read("client/src/pages/SmsExactLive.tsx");
    const router = read("server/leadflowJobsRouter.ts");
    const smsContext = router.slice(router.indexOf("smsCustomerContext:"), router.indexOf("list: bookingsAgentProcedure"));
    const legacySymbol = ["cleaner", "Jobs"].join("");
    const legacyTable = ["cleaner", "_jobs"].join("");

    for (const marker of [
      "smsCustomerContext: opsChatProcedure.input(smsPhoneInput).query",
      "smsTeamTodayJobs: opsChatProcedure.input",
      "smsResolveNames: opsChatProcedure.input(smsPhonesInput).query",
      "leadflowJobs",
      "cleanerPortalJobProgress",
      "cleanerProfiles",
    ]) expect(smsContext).toContain(marker);
    expect(smsContext).not.toContain(legacySymbol);
    expect(smsContext).not.toContain(legacyTable);
    expect(smsContext).not.toContain(".insert(");
    expect(smsContext).not.toContain(".update(");
    expect(smsContext).not.toContain(".delete(");
    expect(page).not.toContain(legacySymbol);
    expect(page).not.toContain(legacyTable);
    expect(page).not.toContain("trpc.leads.getClientProfile.useQuery");
    expect(page).not.toContain("trpc.leads.getCleanerTodayJobs.useQuery");
    expect(page).not.toContain("utils.leads.batchResolveNames.fetch");
  });

});
