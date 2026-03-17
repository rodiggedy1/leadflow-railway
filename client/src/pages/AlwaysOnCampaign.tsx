/**
 * AlwaysOnCampaign.tsx
 *
 * Admin dashboard for the Always-On Campaign Engine.
 *
 * Shows all four groups with:
 *  - Eligibility rules (who qualifies, trigger timing)
 *  - Live stats (enrolled / sent / replied / booked)
 *  - Editable message template
 *  - Paginated contact list with status badges
 *  - Enable/disable toggle per group
 *  - Manual enrollment trigger (backfill)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Zap,
  Users,
  Send,
  MessageSquare,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ToggleLeft,
  ToggleRight,
  Edit3,
  Check,
  X,
  Clock,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";

// ─── Types ────────────────────────────────────────────────────────────────────

type GroupType = "new-one-time" | "lapsed-one-time" | "lapsed-recurring" | "dormant";

const GROUP_META: Record<GroupType, {
  color: string;
  bgColor: string;
  borderColor: string;
  triggerRule: string;
  audienceRule: string;
  skipRule: string;
  icon: string;
}> = {
  "new-one-time": {
    color: "#16a34a",
    bgColor: "#f0fdf4",
    borderColor: "#bbf7d0",
    triggerRule: "3 days after job date",
    audienceRule: "First-time customers (frequency = One-Time or unknown)",
    skipRule: "Already enrolled in any group",
    icon: "🌱",
  },
  "lapsed-one-time": {
    color: "#d97706",
    bgColor: "#fffbeb",
    borderColor: "#fde68a",
    triggerRule: "21 days after job date",
    audienceRule: "One-time customers who haven't rebooked",
    skipRule: "Already enrolled in any group",
    icon: "⏰",
  },
  "lapsed-recurring": {
    color: "#dc2626",
    bgColor: "#fef2f2",
    borderColor: "#fecaca",
    triggerRule: "Frequency window + 7-day buffer (e.g. monthly = 37 days)",
    audienceRule: "Recurring customers (monthly, biweekly, weekly, etc.) past their schedule",
    skipRule: "Still within frequency window + 7 days (active customer)",
    icon: "🔄",
  },
  dormant: {
    color: "#7c3aed",
    bgColor: "#faf5ff",
    borderColor: "#ddd6fe",
    triggerRule: "180+ days since last job (6 months)",
    audienceRule: "Any customer — one-time or recurring — deeply lapsed",
    skipRule: "Already enrolled in any group",
    icon: "💤",
  },
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-gray-100 text-gray-700",
  SENT: "bg-blue-100 text-blue-700",
  REPLIED: "bg-yellow-100 text-yellow-700",
  BOOKED: "bg-green-100 text-green-700",
  OPTED_OUT: "bg-red-100 text-red-700",
  SKIPPED: "bg-gray-100 text-gray-500",
};

// ─── Group Card ───────────────────────────────────────────────────────────────

function GroupCard({ group, onUpdated }: {
  group: {
    id: number;
    groupType: string;
    name: string;
    description: string | null;
    isActive: number;
    messageTemplate: string;
    batchSize: number;
    totalEnrolled: number;
    sentCount: number;
    repliedCount: number;
    bookedCount: number;
  };
  onUpdated: () => void;
}) {
  const meta = GROUP_META[group.groupType as GroupType];
  const [expanded, setExpanded] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [templateDraft, setTemplateDraft] = useState(group.messageTemplate);
  const [editingBatchSize, setEditingBatchSize] = useState(false);
  const [batchSizeDraft, setBatchSizeDraft] = useState(String(group.batchSize));
  const [contactPage, setContactPage] = useState(0);
  const PAGE_SIZE = 50;

  // Test message dialog
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [lastRenderedMessage, setLastRenderedMessage] = useState<string | null>(null);

  const updateGroup = trpc.alwaysOn.updateGroup.useMutation({
    onSuccess: () => {
      toast.success("Group updated — changes saved.");
      onUpdated();
    },
    onError: (e) => toast.error(e.message),
  });

  const { data: contactsData, isLoading: contactsLoading, refetch: refetchContacts } =
    trpc.alwaysOn.getGroupContacts.useQuery(
      { groupId: group.id, limit: PAGE_SIZE, offset: contactPage * PAGE_SIZE },
      { enabled: expanded }
    );

  const handleToggleActive = () => {
    updateGroup.mutate({ groupId: group.id, isActive: group.isActive === 0 });
  };

  const handleSaveTemplate = () => {
    updateGroup.mutate({ groupId: group.id, messageTemplate: templateDraft });
    setEditingTemplate(false);
  };

  const sendTestMessage = trpc.alwaysOn.sendTestMessage.useMutation({
    onSuccess: (data) => {
      setLastRenderedMessage(data.renderedMessage);
      toast.success(`Test message sent to ${data.sentTo}`);
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });

  const handleSendTest = () => {
    const digits = testPhone.replace(/\D/g, "");
    if (digits.length < 10) {
      toast.error("Please enter a valid 10-digit US phone number.");
      return;
    }
    sendTestMessage.mutate({ groupId: group.id, testPhone });
  };

  const handleSaveBatchSize = () => {
    const val = parseInt(batchSizeDraft, 10);
    if (isNaN(val) || val < 1 || val > 500) {
      toast.error("Batch size must be between 1 and 500.");
      return;
    }
    updateGroup.mutate({ groupId: group.id, batchSize: val });
    setEditingBatchSize(false);
  };

  const replyRate = group.sentCount > 0
    ? Math.round((group.repliedCount / group.sentCount) * 100)
    : 0;
  const bookRate = group.sentCount > 0
    ? Math.round((group.bookedCount / group.sentCount) * 100)
    : 0;

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ borderColor: meta.borderColor, backgroundColor: meta.bgColor }}
    >
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{meta.icon}</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900 text-base">{group.name}</h3>
                <Badge
                  className={`text-xs px-2 py-0.5 ${group.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
                >
                  {group.isActive ? "Active" : "Paused"}
                </Badge>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{group.description}</p>
            </div>
          </div>
          <button
            onClick={handleToggleActive}
            className="flex items-center gap-1.5 text-sm font-medium transition-colors"
            style={{ color: group.isActive ? "#dc2626" : "#16a34a" }}
            title={group.isActive ? "Pause this group" : "Activate this group"}
          >
            {group.isActive
              ? <><ToggleRight className="w-5 h-5" /> Pause</>
              : <><ToggleLeft className="w-5 h-5" /> Activate</>
            }
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
          {[
            { label: "Enrolled", value: group.totalEnrolled.toLocaleString(), icon: <Users className="w-4 h-4" /> },
            { label: "Pending", value: (group.totalEnrolled - group.sentCount).toLocaleString(), icon: <Clock className="w-4 h-4" /> },
            { label: "Sent", value: group.sentCount.toLocaleString(), icon: <Send className="w-4 h-4" /> },
            { label: "Reply Rate", value: `${replyRate}%`, icon: <MessageSquare className="w-4 h-4" /> },
            { label: "Booked", value: `${bookRate}%`, icon: <Check className="w-4 h-4" /> },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-lg p-3 border border-white/60 text-center">
              <div className="flex items-center justify-center gap-1 text-gray-400 mb-1">
                {stat.icon}
                <span className="text-xs">{stat.label}</span>
              </div>
              <div className="text-xl font-bold text-gray-900">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Batch size editor */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-gray-500">Daily batch size:</span>
          {editingBatchSize ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={500}
                value={batchSizeDraft}
                onChange={(e) => setBatchSizeDraft(e.target.value)}
                className="w-20 text-sm border border-gray-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1"
                style={{ borderColor: meta.borderColor }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveBatchSize(); if (e.key === "Escape") setEditingBatchSize(false); }}
                autoFocus
              />
              <button onClick={handleSaveBatchSize} className="text-xs text-green-600 font-medium hover:text-green-700">Save</button>
              <button onClick={() => setEditingBatchSize(false)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => { setBatchSizeDraft(String(group.batchSize)); setEditingBatchSize(true); }}
              className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full hover:opacity-80 transition-opacity"
              style={{ backgroundColor: meta.borderColor, color: meta.color }}
            >
              {group.batchSize} per day <Edit3 className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Rules summary */}
        <div className="mt-4 bg-white/60 rounded-lg p-3 border border-white/80">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            <Info className="w-3.5 h-3.5" />
            Eligibility Rules
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
            <div>
              <span className="font-medium text-gray-700">Who: </span>
              <span className="text-gray-600">{meta.audienceRule}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Trigger: </span>
              <span className="text-gray-600">{meta.triggerRule}</span>
            </div>
            <div>
              <span className="font-medium text-gray-700">Skip if: </span>
              <span className="text-gray-600">{meta.skipRule}</span>
            </div>
          </div>
        </div>

        {/* Message template */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Message Template</span>
              <span
                className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: meta.borderColor, color: meta.color }}
              >
                <Users className="w-3 h-3" />
                {group.totalEnrolled.toLocaleString()} contacts
              </span>
            </div>
            {!editingTemplate ? (
              <button
                onClick={() => { setTemplateDraft(group.messageTemplate); setEditingTemplate(true); }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={handleSaveTemplate}
                  className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium"
                >
                  <Check className="w-3.5 h-3.5" /> Save
                </button>
                <button
                  onClick={() => setEditingTemplate(false)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              </div>
            )}
          </div>
          {editingTemplate ? (
            <div>
              <Textarea
                value={templateDraft}
                onChange={(e) => setTemplateDraft(e.target.value)}
                className="text-sm bg-white"
                rows={4}
              />
              <p className="text-xs text-gray-400 mt-1">
                Variables: [Name], [Price], [DiscountedPrice] — {templateDraft.length}/1600 chars
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-lg p-3 border text-sm text-gray-700 leading-relaxed" style={{ borderColor: meta.borderColor }}>
              {group.messageTemplate}
            </div>
          )}
        </div>

        {/* Test message button */}
        <div className="mt-3">
          <button
            onClick={() => { setTestDialogOpen(true); setLastRenderedMessage(null); }}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
            style={{ borderColor: meta.borderColor, color: meta.color, backgroundColor: meta.bgColor }}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Send Test Message
          </button>
        </div>

        {/* Test message dialog */}
        <Dialog open={testDialogOpen} onOpenChange={(open) => { setTestDialogOpen(open); if (!open) setLastRenderedMessage(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span style={{ color: meta.color }}>{meta.icon}</span>
                Test: {group.name}
              </DialogTitle>
              <DialogDescription>
                Send a sample message to your phone to preview exactly what customers will receive.
                Tokens like [Name] and [Price] will be filled with real data from a pending contact (or placeholders if none exist).
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 mt-2">
              {/* Message preview */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Message Preview</p>
                <div
                  className="rounded-lg p-3 text-sm text-gray-700 leading-relaxed border"
                  style={{ backgroundColor: meta.bgColor, borderColor: meta.borderColor }}
                >
                  {lastRenderedMessage ?? group.messageTemplate}
                </div>
                {lastRenderedMessage && (
                  <p className="text-xs text-green-600 mt-1">✓ Tokens replaced with real data — this is exactly what was sent.</p>
                )}
              </div>

              {/* Phone input */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Send to Phone Number</p>
                <Input
                  type="tel"
                  placeholder="e.g. 202-555-1234"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSendTest(); }}
                  className="text-sm"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={() => setTestDialogOpen(false)}>Cancel</Button>
                <Button
                  size="sm"
                  onClick={handleSendTest}
                  disabled={sendTestMessage.isPending}
                  style={{ backgroundColor: meta.color }}
                  className="text-white"
                >
                  {sendTestMessage.isPending
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" /> Sending...</>
                    : <><Send className="w-3.5 h-3.5 mr-1" /> Send Test</>}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Expand/collapse contacts */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-4 w-full flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 py-1"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {expanded ? "Hide contacts" : `View contacts (${group.totalEnrolled.toLocaleString()} enrolled)`}
        </button>
      </div>

      {/* Contact list */}
      {expanded && (
        <div className="border-t bg-white" style={{ borderColor: meta.borderColor }}>
          <div className="p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              {contactsData ? `${contactsData.total.toLocaleString()} contacts` : "Loading..."}
            </span>
            <button onClick={() => refetchContacts()} className="text-gray-400 hover:text-gray-600">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          {contactsLoading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading contacts...</div>
          ) : contactsData && contactsData.contacts.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Job Date</TableHead>
                      <TableHead>Enrolled</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contactsData.contacts.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name || c.firstName || "—"}</TableCell>
                        <TableCell className="font-mono text-sm">{c.phone}</TableCell>
                        <TableCell className="text-sm text-gray-600">{c.frequency || "—"}</TableCell>
                        <TableCell className="text-sm text-gray-600">{c.jobDate || "—"}</TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {c.enrolledAt ? new Date(c.enrolledAt).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status] || "bg-gray-100 text-gray-600"}`}>
                            {c.status}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Pagination */}
              {contactsData.total > PAGE_SIZE && (
                <div className="p-4 flex items-center justify-between border-t">
                  <span className="text-sm text-gray-500">
                    Page {contactPage + 1} of {Math.ceil(contactsData.total / PAGE_SIZE)}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setContactPage(p => Math.max(0, p - 1))}
                      disabled={contactPage === 0}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setContactPage(p => p + 1)}
                      disabled={(contactPage + 1) * PAGE_SIZE >= contactsData.total}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-center text-gray-400 text-sm">
              No contacts enrolled yet. Run the nightly sync or click "Enroll Now" to populate this group.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AlwaysOnCampaign() {
  const utils = trpc.useUtils();

  const { data: groups, isLoading, refetch } = trpc.alwaysOn.listGroups.useQuery();

  const manualEnroll = trpc.alwaysOn.manualEnroll.useMutation({
    onSuccess: (data) => {
      toast.success(`Enrollment complete — ${data.total} new contacts enrolled.`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const totalEnrolled = groups?.reduce((a, g) => a + g.totalEnrolled, 0) ?? 0;
  const totalSent = groups?.reduce((a, g) => a + g.sentCount, 0) ?? 0;
  const totalBooked = groups?.reduce((a, g) => a + g.bookedCount, 0) ?? 0;
  const activeGroups = groups?.filter(g => g.isActive).length ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/admin" className="text-gray-400 hover:text-gray-600 text-sm">← Admin</a>
            <span className="text-gray-300">/</span>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              <h1 className="text-lg font-semibold text-gray-900">Always-On Campaign</h1>
            </div>
          </div>
          <Button
            onClick={() => manualEnroll.mutate()}
            disabled={manualEnroll.isPending}
            className="flex items-center gap-2"
            style={{ backgroundColor: "#E8603C" }}
          >
            {manualEnroll.isPending
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Enrolling...</>
              : <><RefreshCw className="w-4 h-4" /> Enroll Now</>
            }
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Intro banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Set it and forget it</p>
              <p className="text-sm text-amber-700 mt-0.5">
                Every night at 10 PM, the nightly sync runs and automatically enrolls newly eligible contacts into the right group.
                Active recurring customers (still within their booking schedule) are <strong>never</strong> messaged.
                You only need to touch this page to edit message templates or pause a group.
              </p>
            </div>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Active Groups", value: `${activeGroups}/4`, color: "#16a34a" },
            { label: "Total Enrolled", value: totalEnrolled.toLocaleString(), color: "#2563eb" },
            { label: "Total Sent", value: totalSent.toLocaleString(), color: "#7c3aed" },
            { label: "Total Booked", value: totalBooked.toLocaleString(), color: "#E8603C" },
          ].map(stat => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Schedule info */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex items-start gap-3 flex-1">
              <Clock className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-600">
                <span className="font-medium text-gray-800">10 PM ET nightly — </span>
                Sync runs → new completed jobs imported from Launch27 → eligible contacts enrolled into matching groups.
              </div>
            </div>
            <div className="flex items-start gap-3 flex-1">
              <Send className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-gray-600">
                <span className="font-medium text-gray-800">10 AM ET, Mon–Sat — </span>
                SMS batch sends automatically. Up to <strong>batchSize</strong> PENDING contacts per group per day. TCPA-compliant (9 AM–8 PM ET only).
              </div>
            </div>
          </div>
        </div>

        {/* Group cards */}
        {isLoading ? (
          <div className="text-center py-16 text-gray-400">Loading groups...</div>
        ) : groups && groups.length > 0 ? (
          <div className="space-y-5">
            {groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                onUpdated={() => refetch()}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <Zap className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>No groups found. Click "Enroll Now" to initialize the always-on engine.</p>
          </div>
        )}
      </main>
    </div>
  );
}
