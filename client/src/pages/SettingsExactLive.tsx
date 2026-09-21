import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  Building2,
  Check,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Link,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  RefreshCw,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  ToggleLeft,
  ToggleRight,
  Trash2,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import BookingWidgetConfigPanel from "@/components/BookingWidgetConfigPanel";
import MessageFlowPanel from "@/components/MessageFlowPanel";
import "./settings-review.css";
import "./settings-live-exact.css";

type SettingsTab = "form" | "widget" | "booking" | "email" | "reactivation" | "general" | "pay" | "responses";
type SettingRow = { key: string; value: string; label: string; description: string | null; fieldType: string };
type FlowId = "A" | "B" | "C" | "split";
type CustomRuleDraft = { id?: number; label: string; type: "bonus" | "deduction"; amount: string; description: string };

const TABS: Array<{ id: SettingsTab; label: string; icon: typeof Settings }> = [
  { id: "form", label: "Form SMS", icon: FileText },
  { id: "widget", label: "Widget SMS", icon: MessageCircle },
  { id: "booking", label: "Booking Widget", icon: Sparkles },
  { id: "email", label: "Email Leads", icon: Mail },
  { id: "reactivation", label: "Reactivation", icon: RefreshCw },
  { id: "general", label: "General", icon: Settings },
  { id: "pay", label: "Pay Rules", icon: CircleDollarSign },
  { id: "responses", label: "Responses", icon: MessageSquare },
];

const FORM_FLOWS: Array<{ id: Exclude<FlowId, "C">; title: string; copy: string; tone: string }> = [
  { id: "A", title: "Flow A — Madison", copy: "Price-forward conversation that begins with a warm introduction and immediate next-step question.", tone: "blue" },
  { id: "B", title: "Flow B — Jade", copy: "Service-first conversation that gathers the preferred day before presenting the next step.", tone: "coral" },
  { id: "split", title: "A/B Test (50/50)", copy: "Each eligible new lead is randomly assigned Flow A or Flow B.", tone: "violet" },
];

const WIDGET_FLOWS: Array<{ id: FlowId; title: string; copy: string; tone: string }> = [
  ...FORM_FLOWS.slice(0, 2),
  { id: "C", title: "Flow C — Enriched Quote", copy: "Collects service details, add-ons, and date before sending a personalized quote link.", tone: "blue" },
  FORM_FLOWS[2],
];

const formTemplateKeys: Record<FlowId, string[]> = {
  A: ["flowA_sms1", "flowA_sms2", "flowA_sms3", "flowA_sms4", "flowA_sms5", "flowA_sms6", "flowA_sms6_later"],
  B: ["flowB_sms1", "flowB_sms2", "flowB_sms3", "flowB_sms4", "flowB_sms5", "flowB_sms5_later"],
  C: ["flowC_sms1", "flowC_sms2", "flowC_sms3", "flowC_sms4"],
  split: ["flowA_sms1", "flowA_sms2", "flowA_sms3", "flowA_sms4", "flowA_sms5", "flowA_sms6", "flowA_sms6_later", "flowB_sms1", "flowB_sms2", "flowB_sms3", "flowB_sms4", "flowB_sms5", "flowB_sms5_later"],
};

const widgetTemplateKeys: Record<FlowId, string[]> = {
  A: ["widgetFlowA_sms1", ...formTemplateKeys.A],
  B: ["widgetFlowB_sms1", ...formTemplateKeys.B],
  C: ["widgetFlowC_sms1", "widgetFlowC_sms2", "widgetFlowC_sms3", "widgetFlowC_sms4"],
  split: ["widgetFlowA_sms1", ...formTemplateKeys.A, "widgetFlowB_sms1", ...formTemplateKeys.B],
};

const emailTemplateKeys = ["emailFlowA_sms1", ...formTemplateKeys.A.slice(1)];
const generalGroups = [
  { title: "Customer Tracker", keys: ["trackerSmsEnabled", "trackerSmsTemplate"] },
  { title: "Reviews & Ratings", keys: ["googleReviewUrl", "autoGoogleReviewOnFiveStar", "googleReviewSmsTemplate"] },
  { title: "Business Info", keys: ["businessName", "businessPhone"] },
  { title: "Call Notifications", keys: ["callAlertEnabled", "callAlertPhone"] },
];
const knownServices = ["Window Cleaning", "Carpet Cleaning", "Junk Removal", "Office Cleaning", "Post-Construction Cleaning", "Move-In / Move-Out Cleaning", "Deep Cleaning", "Standard Cleaning"];

function initialTab(): SettingsTab {
  if (window.location.pathname === "/admin/widget-config") return "booking";
  const requested = new URLSearchParams(window.location.search).get("tab");
  return TABS.some((tab) => tab.id === requested) ? requested as SettingsTab : "form";
}

function previewValue(value: string) {
  return value
    .replaceAll("{firstName}", "Taylor")
    .replaceAll("{bedrooms}", "3")
    .replaceAll("{bathrooms}", "2")
    .replaceAll("{serviceType}", "Standard Cleaning")
    .replaceAll("{price}", "180")
    .replaceAll("{day}", "Thursday")
    .replaceAll("{slot}", "Thursday at 9 AM")
    .replaceAll("{slot1}", "Thursday at 9 AM")
    .replaceAll("{slot2}", "Saturday at 10 AM")
    .replaceAll("{timePref}", "Morning")
    .replaceAll("{address}", "123 Main St, Washington, DC")
    .replaceAll("{reviewLink}", "https://share.google/example");
}

function FlowSelector({ flows, selected, onSelect, saving, locked = false }: { flows: Array<{ id: FlowId; title: string; copy: string; tone: string }>; selected: FlowId; onSelect: (flow: FlowId) => void; saving: boolean; locked?: boolean }) {
  return <div className="settings-flow-grid">
    {flows.map((flow) => <button key={flow.id} type="button" disabled={locked || saving} className={`settings-flow is-${flow.tone} ${selected === flow.id ? "is-active" : ""}`} onClick={() => onSelect(flow.id)}>
      <strong>{flow.title}</strong><p>{flow.copy}</p>{selected === flow.id && <i><Check size={12} />{locked ? "Fixed flow" : "Selected"}</i>}
    </button>)}
  </div>;
}

function TemplateEditor({ rows, drafts, onDraft, onSave, savingKey }: { rows: SettingRow[]; drafts: Record<string, string>; onDraft: (key: string, value: string) => void; onSave: (key: string) => void; savingKey: string | null }) {
  if (!rows.length) return <div className="settings-live-empty">No message templates are available for this flow.</div>;
  return <section className="settings-card settings-templates"><header><div><span>Message templates</span><h2>Conversation scripts</h2><p>These are the saved production scripts. Edits are held locally until the individual Save button is selected.</p></div></header>{rows.map((row, index) => {
    const value = drafts[row.key] ?? row.value;
    const dirty = value !== row.value;
    return <section className="settings-template" key={row.key}><div><b>SMS {index + 1} · {row.label.replace(/^.*?SMS \d+(?:: )?/, "")}</b><small>{row.description ?? "Saved message template"}</small></div><textarea value={value} onChange={(event) => onDraft(row.key, event.target.value)} rows={3} /><button type="button" disabled={!dirty || savingKey === row.key} onClick={() => onSave(row.key)}>{savingKey === row.key ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}{savingKey === row.key ? "Saving" : "Save"}</button></section>;
  })}</section>;
}

function GeneralSettingField({ row, draft, onDraft, onSave, saving }: { row: SettingRow; draft: string; onDraft: (value: string) => void; onSave: (value: string) => void; saving: boolean }) {
  const isToggle = row.fieldType === "toggle";
  const dirty = draft !== row.value;
  return <article className="settings-live-field"><div><b>{row.label}</b>{row.description && <p>{row.description}</p>}</div>{isToggle ? <button type="button" className={`settings-toggle ${draft === "true" ? "is-on" : ""}`} disabled={saving} aria-pressed={draft === "true"} onClick={() => onSave(draft === "true" ? "false" : "true")}>{draft === "true" ? <ToggleRight size={29} /> : <ToggleLeft size={29} />}<span>{draft === "true" ? "Enabled" : "Disabled"}</span></button> : <div className="settings-live-input"><textarea rows={row.fieldType === "textarea" ? 4 : undefined} value={draft} onChange={(event) => onDraft(event.target.value)} />{dirty && <button type="button" className="settings-save" disabled={saving} onClick={() => onSave(draft)}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}Save</button>}</div>}</article>;
}

function ResponseTemplatesLive() {
  const utils = trpc.useUtils();
  const { data: templates = [], isLoading } = trpc.responseTemplates.list.useQuery();
  const create = trpc.responseTemplates.create.useMutation({ onSuccess: () => { utils.responseTemplates.list.invalidate(); setEditor(null); toast.success("Response template created"); } });
  const update = trpc.responseTemplates.update.useMutation({ onSuccess: () => { utils.responseTemplates.list.invalidate(); setEditor(null); toast.success("Response template saved"); } });
  const remove = trpc.responseTemplates.delete.useMutation({ onSuccess: () => { utils.responseTemplates.list.invalidate(); toast.success("Response template deleted"); } });
  const [editor, setEditor] = useState<{ id?: number; title: string; category: string; description: string; message: string; sortOrder: number } | null>(null);
  const save = () => {
    if (!editor || !editor.title.trim() || !editor.category.trim() || !editor.message.trim()) return toast.error("Title, category, and message are required");
    if (editor.id) update.mutate(editor as Required<typeof editor>);
    else create.mutate({ title: editor.title, category: editor.category, description: editor.description, message: editor.message, sortOrder: editor.sortOrder });
  };
  return <section className="settings-single"><section className="settings-card"><header><div><span>Reusable messaging</span><h2>Response templates</h2><p>Saved response templates used by the lead and customer-service composers.</p></div><button type="button" className="settings-quiet" onClick={() => setEditor({ title: "", category: "", description: "", message: "", sortOrder: 0 })}><Plus size={14} />New template</button></header><div className="settings-response-list">{isLoading ? <Loader2 className="settings-live-loader animate-spin" /> : templates.length ? templates.map((template) => <article key={template.id}><span><MessageSquare size={16} /></span><div><i>{template.category}</i><b>{template.title}</b>{template.description && <p>{template.description}</p>}<p className="settings-live-message-preview">{template.message}</p></div><button type="button" onClick={() => setEditor(template)}><Pencil size={14} />Edit</button><button type="button" aria-label={`Delete ${template.title}`} onClick={() => { if (window.confirm(`Delete ${template.title}?`)) remove.mutate({ id: template.id }); }}><Trash2 size={14} /></button></article>) : <div className="settings-live-empty">No response templates have been configured.</div>}</div></section><Dialog open={!!editor} onOpenChange={(open) => !open && setEditor(null)}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>{editor?.id ? "Edit response template" : "New response template"}</DialogTitle></DialogHeader>{editor && <div className="settings-live-dialog"><label>Title<Input value={editor.title} onChange={(event) => setEditor({ ...editor, title: event.target.value })} /></label><label>Category<Input value={editor.category} onChange={(event) => setEditor({ ...editor, category: event.target.value })} /></label><label>Description<Input value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label><label>Message<Textarea rows={6} value={editor.message} onChange={(event) => setEditor({ ...editor, message: event.target.value })} /></label></div>}<DialogFooter><Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button><Button onClick={save} disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Saving…" : "Save"}</Button></DialogFooter></DialogContent></Dialog></section>;
}

function OpenPhoneMappingLive() {
  const sync = trpc.opsChat.syncOpenPhoneUsers.useMutation();
  const assign = trpc.opsChat.setAgentOpenPhoneUserId.useMutation();
  const [result, setResult] = useState<{ matched: Array<{ agentId: number; agentName: string; opUserId: string; opName: string }>; unmatched: Array<{ opUserId: string; opName: string; opEmail: string }>; agentRows: Array<{ id: number; name: string }> } | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const refresh = async () => {
    try { const next = await sync.mutateAsync(); setResult(next); toast.success(`OpenPhone mapping checked: ${next.matched.length} matched.`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to sync OpenPhone users"); }
  };
  const saveAssignment = async (userId: string) => {
    const agentId = Number(choices[userId]);
    if (!agentId) return;
    try {
      await assign.mutateAsync({ agentId, openPhoneUserId: userId });
      setResult((current) => current ? { ...current, unmatched: current.unmatched.filter((person) => person.opUserId !== userId) } : current);
      toast.success("OpenPhone user assigned");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to assign OpenPhone user"); }
  };
  return <section className="settings-card settings-live-openphone"><header><div><span>Team communications</span><h2>OpenPhone agent mapping</h2><p>Sync the existing OpenPhone team and map any unmatched users to the appropriate LeadFlow agent.</p></div><button type="button" className="settings-quiet" disabled={sync.isPending} onClick={() => void refresh()}>{sync.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}{sync.isPending ? "Syncing" : "Sync users"}</button></header>{result && <div className="settings-live-openphone-result">{result.matched.length > 0 && <p><CheckCircle2 size={14} />{result.matched.length} user{result.matched.length === 1 ? "" : "s"} matched.</p>}{result.unmatched.map((person) => <div key={person.opUserId}><span>{person.opName || person.opEmail}</span><select value={choices[person.opUserId] ?? ""} onChange={(event) => setChoices((current) => ({ ...current, [person.opUserId]: event.target.value }))}><option value="">Assign agent…</option>{result.agentRows.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><button type="button" className="settings-save" disabled={!choices[person.opUserId] || assign.isPending} onClick={() => void saveAssignment(person.opUserId)}>Assign</button></div>)}</div>}</section>;
}

function PayRulesLive() {
  const utils = trpc.useUtils();
  const { data: rules, isLoading, refetch } = trpc.settings.getPayRules.useQuery();
  const updateRules = trpc.settings.updatePayRules.useMutation();
  const { data: customRules = [] } = trpc.settings.listCustomPayRules.useQuery();
  const refreshCustomRules = () => utils.settings.listCustomPayRules.invalidate();
  const create = trpc.settings.createCustomPayRule.useMutation({ onSuccess: () => { void refreshCustomRules(); setRuleDraft(null); toast.success("Custom rule created"); } });
  const update = trpc.settings.updateCustomPayRule.useMutation({ onSuccess: () => { void refreshCustomRules(); setRuleDraft(null); toast.success("Custom rule saved"); } });
  const remove = trpc.settings.deleteCustomPayRule.useMutation({ onSuccess: () => { void refreshCustomRules(); toast.success("Custom rule deleted"); } });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [ruleDraft, setRuleDraft] = useState<CustomRuleDraft | null>(null);
  const fields = rules ? [
    ["fiveStarBonus", "Five-star rating bonus", "Bonus after a five-star review", "bonus"], ["photoBonus", "Completion photo bonus", "Bonus after a required completion photo", "bonus"], ["streakBonus", "Streak bonus", "Bonus when the current streak reaches its target", "bonus"], ["streakTarget", "Streak target", "Jobs required for the current streak bonus", "neutral"], ["lowRatingDeduction", "Low-rating deduction", "Deduction after a rating of three stars or fewer", "deduction"], ["noPhotoPenalty", "No-photo penalty", "Deduction when a required completion photo is missing", "deduction"], ["recleanPenalty", "Reclean / poor-service penalty", "Deduction for a recorded reclean", "deduction"],
  ] as const : [];
  const saved = (key: keyof NonNullable<typeof rules>) => edits[key] ?? String(rules?.[key] ?? "");
  const save = async () => {
    if (!rules) return;
    const next = {
      fiveStarBonus: Number(saved("fiveStarBonus")), lowRatingDeduction: Number(saved("lowRatingDeduction")), photoBonus: Number(saved("photoBonus")), noPhotoPenalty: Number(saved("noPhotoPenalty")), streakBonus: Number(saved("streakBonus")), streakTarget: Number(saved("streakTarget")), recleanPenalty: Number(saved("recleanPenalty")),
    };
    if (Object.values(next).some((value) => !Number.isFinite(value) || value < 0) || !Number.isInteger(next.streakTarget) || next.streakTarget < 1) return toast.error("Enter valid non-negative amounts and a whole-number streak target of at least one.");
    await updateRules.mutateAsync(next); await refetch(); setEdits({}); toast.success("Pay rules saved");
  };
  const saveCustom = () => {
    if (!ruleDraft || !ruleDraft.label.trim() || Number(ruleDraft.amount) <= 0) return toast.error("Enter a rule name and a positive amount.");
    const input = { label: ruleDraft.label.trim(), type: ruleDraft.type, amount: Number(ruleDraft.amount), description: ruleDraft.description || undefined };
    if (ruleDraft.id) update.mutate({ id: ruleDraft.id, ...input }); else create.mutate(input);
  };
  return <section className="settings-single"><section className="settings-card"><header><div><span>Compensation controls</span><h2>Pay Rules</h2><p>These saved values are used for future rating and payroll calculations.</p></div><em>Live</em></header><div className="settings-pay-list">{isLoading ? <Loader2 className="settings-live-loader animate-spin" /> : fields.map(([key, label, description, type]) => <article key={key}><span className={`settings-live-pay-tone is-${type}`}>{type === "bonus" ? <TrendingUp size={14} /> : type === "deduction" ? <TrendingDown size={14} /> : <Zap size={14} />}</span><div><b>{label}</b><small>{description}</small></div><label>{key === "streakTarget" ? "" : "$"}<input type="number" min={key === "streakTarget" ? 1 : 0} step={key === "streakTarget" ? 1 : 0.5} value={saved(key)} onChange={(event) => setEdits((current) => ({ ...current, [key]: event.target.value }))} />{key === "streakTarget" ? "jobs" : ""}</label></article>)}</div><footer><button type="button" className="settings-save" disabled={!Object.keys(edits).length || updateRules.isPending} onClick={save}>{updateRules.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save pay rules</button></footer></section><section className="settings-card settings-live-custom-rules"><header><div><span>Additional compensation</span><h2>Custom bonuses & deductions</h2><p>Production custom rules are editable here without changing the review-shell layout.</p></div><button type="button" className="settings-quiet" onClick={() => setRuleDraft({ label: "", type: "bonus", amount: "", description: "" })}><Plus size={14} />Add rule</button></header><div className="settings-pay-list">{customRules.map((rule) => <article key={rule.id} className={!rule.isActive ? "is-inactive" : ""}><button type="button" className={`settings-toggle ${rule.isActive ? "is-on" : ""}`} aria-pressed={!!rule.isActive} onClick={() => update.mutate({ id: rule.id, isActive: !rule.isActive })}>{rule.isActive ? <ToggleRight size={25} /> : <ToggleLeft size={25} />}</button><div><b>{rule.label}</b><small>{rule.description || "No description"}</small></div><label>{rule.type === "bonus" ? "+" : "-"}${Number(rule.amount).toFixed(2)}</label><button type="button" onClick={() => setRuleDraft({ id: rule.id, label: rule.label, type: rule.type as "bonus" | "deduction", amount: String(rule.amount), description: rule.description || "" })}><Pencil size={14} /></button><button type="button" onClick={() => { if (window.confirm(`Delete ${rule.label}?`)) remove.mutate({ id: rule.id }); }}><Trash2 size={14} /></button></article>)}{!customRules.length && <div className="settings-live-empty">No custom pay rules have been configured.</div>}</div></section><Dialog open={!!ruleDraft} onOpenChange={(open) => !open && setRuleDraft(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{ruleDraft?.id ? "Edit custom pay rule" : "Add custom pay rule"}</DialogTitle></DialogHeader>{ruleDraft && <div className="settings-live-dialog"><label>Rule name<Input value={ruleDraft.label} onChange={(event) => setRuleDraft({ ...ruleDraft, label: event.target.value })} /></label><label>Type<select value={ruleDraft.type} onChange={(event) => setRuleDraft({ ...ruleDraft, type: event.target.value as "bonus" | "deduction" })}><option value="bonus">Bonus</option><option value="deduction">Deduction</option></select></label><label>Amount<Input type="number" min="0.01" step="0.50" value={ruleDraft.amount} onChange={(event) => setRuleDraft({ ...ruleDraft, amount: event.target.value })} /></label><label>Description<Input value={ruleDraft.description} onChange={(event) => setRuleDraft({ ...ruleDraft, description: event.target.value })} /></label></div>}<DialogFooter><Button variant="outline" onClick={() => setRuleDraft(null)}>Cancel</Button><Button onClick={saveCustom} disabled={create.isPending || update.isPending}>{create.isPending || update.isPending ? "Saving…" : "Save rule"}</Button></DialogFooter></DialogContent></Dialog></section>;
}

export default function SettingsExactLive() {
  const { data: data, isLoading, refetch } = trpc.settings.getAll.useQuery();
  const update = trpc.settings.update.useMutation();
  const { data: bookingDraft, refetch: refetchBookingDraft } = trpc.settings.getBookingWidgetDraft.useQuery();
  const updateBookingDraft = trpc.settings.updateBookingWidgetDraft.useMutation();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState("Live Settings workspace · production values load here; no change is made until you save a control.");
  const rows = useMemo(() => data ?? [] as SettingRow[], [data]);
  const byKey = useMemo(() => Object.fromEntries(rows.map((row) => [row.key, row])) as Record<string, SettingRow>, [rows]);
  const current = (key: string) => drafts[key] ?? byKey[key]?.value ?? "";
  const activeFlowKey = activeTab === "widget" ? "widgetSmsFlow" : byKey.formSmsFlow ? "formSmsFlow" : "smsFlow";
  const flowValue = activeTab === "email" ? "A" : current(activeFlowKey);
  const selectedFlow: FlowId = (activeTab === "form" && flowValue === "C" ? "B" : (["A", "B", "C", "split"].includes(flowValue) ? flowValue : "B")) as FlowId;
  const availableFlows = activeTab === "widget" ? WIDGET_FLOWS : FORM_FLOWS;
  const templateKeys = activeTab === "widget"
    ? [...widgetTemplateKeys.C, "widgetFlowB_sms1", "widgetFlowA_sms1", ...formTemplateKeys.B, ...formTemplateKeys.A]
    : activeTab === "email"
      ? emailTemplateKeys
      : [...formTemplateKeys.C, ...formTemplateKeys.B, ...formTemplateKeys.A];
  const templateRows = templateKeys.map((key) => byKey[key]).filter((row): row is SettingRow => Boolean(row));
  const previewTemplateKeys = activeTab === "widget" ? widgetTemplateKeys[selectedFlow] : activeTab === "email" ? emailTemplateKeys : formTemplateKeys[selectedFlow];
  const previewTemplateRows = previewTemplateKeys.map((key) => byKey[key]).filter((row): row is SettingRow => Boolean(row));
  const saveSetting = async (key: string, value = current(key), label?: string) => {
    if (!byKey[key]) return;
    setSavingKey(key);
    try { await update.mutateAsync({ key, value }); await refetch(); setDrafts((entries) => { const next = { ...entries }; delete next[key]; return next; }); setNotice(`${label ?? byKey[key].label} saved.`); toast.success("Setting saved"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save setting"); }
    finally { setSavingKey(null); }
  };
  const saveBooking = async (value: string) => { await updateBookingDraft.mutateAsync({ value }); await refetchBookingDraft(); setNotice("Booking Widget configuration saved."); toast.success("Booking Widget configuration saved"); };
  const selectFlow = (flow: FlowId) => { if (activeTab !== "email") setDrafts((entries) => ({ ...entries, [activeFlowKey]: flow })); };
  const silenced = current("silenced_services").split(",").map((item) => item.trim()).filter(Boolean);
  const toggleSilenced = (service: string) => { const next = silenced.includes(service) ? silenced.filter((item) => item !== service) : [...silenced, service]; void saveSetting("silenced_services", next.join(","), "Service screening"); };
  const health = useHealth();
  return <main className="settings-review settings-live ops-review" data-live-settings-shell="true"><header className="ops-utility"><label><SlidersHorizontal size={17} /><input aria-label="Search settings" placeholder="Search settings…" onChange={() => setNotice("Search is available in the Settings workspace.")} /><kbd>⌘ K</kbd></label><div><button type="button" aria-label="Settings notifications" onClick={() => setNotice("Settings notifications checked.")}><Bell size={18} /><i /></button><span>RG</span></div></header><div className="settings-shell"><section className="settings-head"><div><span>Configuration · Live workspace</span><h1><Settings size={27} />Settings</h1><p>Manage message flows, widget presentation, business preferences, and operational templates in one workspace.</p></div><p><Sparkles size={14} />{notice}</p></section><nav className="settings-tabs" aria-label="Settings sections">{TABS.map((tab) => { const Icon = tab.icon; return <button type="button" key={tab.id} className={activeTab === tab.id ? "is-active" : ""} onClick={() => { setActiveTab(tab.id); window.history.replaceState({}, "", tab.id === "booking" ? "/admin/widget-config" : `/admin/settings?tab=${tab.id}`); }}><Icon size={14} />{tab.label}</button>; })}</nav>{isLoading ? <section className="settings-card settings-live-loading"><Loader2 className="animate-spin" />Loading settings…</section> : <>{["form", "widget", "email"].includes(activeTab) && <section className="settings-grid"><div className="settings-column"><section className="settings-card"><header><div><span>{activeTab === "form" ? "Quote flow" : activeTab === "widget" ? "Widget flow" : "Email-lead flow"}</span><h2>{activeTab === "email" ? "Email lead conversation flow" : activeTab === "widget" ? "Widget SMS conversation flow" : "Form SMS conversation flow"}</h2><p>{activeTab === "email" ? "Email leads use the production Madison flow. Edit the saved scripts below." : "Choose the active production flow, then edit its saved conversation scripts below."}</p></div><em>{activeTab === "email" ? "Flow A" : "Live"}</em></header><FlowSelector flows={availableFlows} selected={selectedFlow} onSelect={selectFlow} saving={savingKey === activeFlowKey} locked={activeTab === "email"} /><footer>{activeTab !== "email" && <button type="button" className="settings-save" disabled={savingKey === activeFlowKey} onClick={() => void saveSetting(activeFlowKey, selectedFlow, "Conversation flow")}>{savingKey === activeFlowKey ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save flow setting</button>}<small>{activeTab === "email" ? "Email leads are locked to Flow A." : "A flow change applies to eligible new leads."}</small></footer></section><TemplateEditor rows={templateRows} drafts={drafts} onDraft={(key, value) => setDrafts((entries) => ({ ...entries, [key]: value }))} onSave={(key) => void saveSetting(key)} savingKey={savingKey} /></div><aside className="settings-preview"><header><span>Live template preview</span><h2>{activeTab === "email" ? "Flow A — Madison" : (availableFlows.find((flow) => flow.id === selectedFlow)?.title ?? "Selected flow")}</h2><p>Preview values are examples; saved templates are used for live conversations.</p></header><div className="settings-thread">{previewTemplateRows.slice(0, 3).map((row, index) => <div key={row.key}><small>SMS {index + 1}</small><p>{previewValue(current(row.key))}</p>{index < 2 && <><small>Lead</small><p className="is-lead">{index === 0 ? "Thursday afternoon works for me." : "That sounds good."}</p></>}</div>)}</div><footer><MessageSquare size={14} />Edits update this preview before you save</footer></aside></section>}{activeTab === "booking" && <section className="settings-single"><section className="settings-card settings-live-booking"><header><div><span>Booking conversion</span><h2>Booking Widget</h2><p>Configure the live booking experience, prompts, services, questions, and checkout flow.</p></div><em>Live</em></header><div className="settings-live-embed"><BookingWidgetConfigPanel savedValue={bookingDraft?.value} onSave={saveBooking} /></div></section></section>}{activeTab === "reactivation" && <section className="settings-single"><section className="settings-card settings-live-reactivation"><header><div><span>Reactivation</span><h2>Reactivation message flow</h2><p>Manage the production template sequence used by the reactivation workflow.</p></div><em>Live</em></header><div className="settings-live-embed"><MessageFlowPanel flowType="reactivation" sampleVars={{ "[Name]": "Taylor", "[LastPrice]": "180", "[Discount]": "10", "[DiscountedPrice]": "162" }} /></div></section></section>}{activeTab === "general" && <section className="settings-general-grid"><section className="settings-card"><header><div><span>Business preferences</span><h2>General</h2><p>Saved customer-facing business information and operational preferences.</p></div></header><div className="settings-live-fields">{generalGroups.flatMap((group) => group.keys.map((key) => byKey[key] ? <GeneralSettingField key={key} row={byKey[key]} draft={current(key)} saving={savingKey === key} onDraft={(value) => setDrafts((entries) => ({ ...entries, [key]: value }))} onSave={(value) => void saveSetting(key, value)} /> : null))}</div></section><section className="settings-column"><section className="settings-card"><header><div><span>Service screening</span><h2>Silenced service types</h2><p>Checked services are suppressed according to the saved production setting.</p></div></header><div className="settings-service-list">{knownServices.map((service) => <label key={service}><input type="checkbox" checked={silenced.includes(service)} disabled={savingKey === "silenced_services"} onChange={() => toggleSilenced(service)} /><span>{service}</span>{silenced.includes(service) && <i>Suppressed</i>}</label>)}</div></section><section className="settings-card settings-live-health"><header><div><span>Deployment</span><h2>Current environment</h2><p>Read-only deployment information from the running application.</p></div></header><div>{health.loading ? <Loader2 className="animate-spin" size={16} /> : <><b>{health.commit ?? "Unknown revision"}</b><small>{health.time ? new Date(health.time).toLocaleString() : "Deployment time unavailable"}</small></>}</div></section><OpenPhoneMappingLive /></section></section>}{activeTab === "pay" && <PayRulesLive />}{activeTab === "responses" && <ResponseTemplatesLive />}</>}</div></main>;
}

function useHealth() {
  const [health, setHealth] = useState<{ commit?: string; time?: string; loading: boolean }>({ loading: true });
  useEffect(() => { let mounted = true; fetch("/api/health").then((response) => response.ok ? response.json() : null).then((data) => { if (mounted) setHealth({ commit: data?.commit, time: data?.time, loading: false }); }).catch(() => { if (mounted) setHealth({ loading: false }); }); return () => { mounted = false; }; }, []);
  return health;
}
