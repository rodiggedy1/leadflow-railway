/**
 * ReactivationCampaigns.tsx
 * Admin page for managing reactivation SMS campaigns.
 *
 * Flow:
 *  1. Filter contacts from the unified completedJobs database (frequency, eligibility)
 *  2. Configure campaign (name, message, batch size)
 *  3. Review contact list → Launch (DRAFT → ACTIVE)
 *  4. Monitor campaign progress (sent / replied / booked)
 */

import { useState } from "react";
import AdminHeader from "@/components/AdminHeader";
import { trpc } from "@/lib/trpc";
import MessageFlowPanel from "@/components/MessageFlowPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users,
  MessageSquare,
  Play,
  Pause,
  Trash2,
  ArrowLeft,
  CheckCircle,
  Clock,
  BarChart3,
  ChevronRight,
  DollarSign,
  TrendingUp,
  FlaskConical,
  Database,
  RefreshCw,
  Filter,
  PlusCircle,
  Megaphone,
  XCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
type FrequencyFilter = "all" | "one-time" | "recurring";

interface Campaign {
  id: number;
  name: string;
  messageTemplate: string;
  segment: string;
  sourceType: string;
  status: CampaignStatus;
  batchSize: number;
  totalContacts: number;
  sentCount: number;
  repliedCount: number;
  bookedCount: number;
  bookedRevenue: number;
  lastSentAt: Date | null;
  createdAt: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE =
  "Hi [Name]! 👋 It's been a while since your last clean with Maids in Black. We'd love to have you back — reply YES to get a special returning customer rate or ask us anything!";

const STATUS_BADGE: Record<CampaignStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  DRAFT: { label: "Draft", variant: "secondary" },
  ACTIVE: { label: "Active", variant: "default" },
  PAUSED: { label: "Paused", variant: "outline" },
  COMPLETED: { label: "Completed", variant: "secondary" },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReactivationCampaigns() {
  // View state
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  // Audience filter state
  const [frequencyFilter, setFrequencyFilter] = useState<FrequencyFilter>("all");

  // Campaign form state
  const [campaignName, setCampaignName] = useState("");
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_TEMPLATE);
  const [batchSize, setBatchSize] = useState(50);

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: campaigns = [], refetch: refetchCampaigns } =
    trpc.campaigns.list.useQuery(undefined, { refetchInterval: 10_000 });

  // AI Center blasts (from campaign_blasts table)
  const { data: blastHistory = [] } =
    trpc.commandCenter.getCampaignHistory.useQuery(undefined, { refetchInterval: 30_000 });

  // Live preview of eligible contacts as filters change
  const { data: preview, isLoading: isLoadingPreview, refetch: refetchPreview } =
    trpc.campaigns.previewFromCompletedJobs.useQuery(
      { frequency: frequencyFilter },
      { enabled: view === "new" }
    );

  const { data: campaignDetail, refetch: refetchDetail } =
    trpc.campaigns.get.useQuery(
      { id: selectedCampaignId! },
      { enabled: !!selectedCampaignId, refetchInterval: 5_000 }
    );

  const { data: campaignStats } =
    trpc.campaigns.stats.useQuery(
      { id: selectedCampaignId! },
      { enabled: !!selectedCampaignId && view === "detail", refetchInterval: 10_000 }
    );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createCampaign = trpc.campaigns.createFromCompletedJobs.useMutation({
    onSuccess: (data) => {
      toast.success(`Campaign created — ${data.contactCount} contacts loaded. Ready to launch.`);
      refetchCampaigns();
      setSelectedCampaignId(data.campaignId);
      setView("detail");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateStatus = trpc.campaigns.updateStatus.useMutation({
    onSuccess: () => {
      refetchCampaigns();
      refetchDetail();
    },
    onError: (err) => toast.error(err.message),
  });

  const createTestCampaign = trpc.campaigns.createTest.useMutation({
    onSuccess: (data) => {
      toast.success("Test campaign created — Rohan (302-981-6191) loaded. Ready to launch.");
      refetchCampaigns();
      setSelectedCampaignId(data.campaignId);
      setView("detail");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteCampaign = trpc.campaigns.delete.useMutation({
    onSuccess: () => {
      toast.success("Campaign deleted");
      refetchCampaigns();
      setDeleteConfirmId(null);
      if (view === "detail") setView("list");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleCreateCampaign() {
    if (!campaignName.trim()) {
      toast.error("Please enter a campaign name.");
      return;
    }
    createCampaign.mutate({
      name: campaignName,
      messageTemplate,
      frequency: frequencyFilter,
      batchSize,
    });
  }

  function handleStatusChange(id: number, status: CampaignStatus) {
    updateStatus.mutate({ id, status });
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderCampaignList() {
    return (
      <div className="space-y-6">
        {/* Back to Admin */}
        <a
          href="/admin/command-center"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Admin
        </a>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Reactivation Campaigns</h1>
            <p className="text-muted-foreground mt-1">
              Re-engage past customers from your booking history.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-dashed text-muted-foreground hover:text-foreground"
              onClick={() => createTestCampaign.mutate({})}
              disabled={createTestCampaign.isPending}
              title="Creates a test campaign with Rohan (302-981-6191, $150 last booking) as the only contact"
            >
              <FlaskConical className="w-4 h-4" />
              {createTestCampaign.isPending ? "Creating…" : "Test Campaign"}
            </Button>
            <Button onClick={() => setView("new")} className="gap-2">
              <PlusCircle className="w-4 h-4" />
              New Campaign
            </Button>
          </div>
        </div>

        {/* Test campaign info banner */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 border border-dashed rounded-lg px-3 py-2">
          <FlaskConical className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            <strong>Test Campaign</strong> — creates a single-contact campaign with Rohan (302-981-6191, last booking $150, 10% off) so you can test the full SMS flow end-to-end before launching a real campaign.
          </span>
        </div>

        {/* ── AI Center Blasts ─────────────────────────────────────────── */}
        {blastHistory.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-purple-500" />
              <h2 className="text-sm font-semibold text-foreground">AI Center Blasts</h2>
              <span className="text-xs text-muted-foreground">— sent from the AI Center campaign tool</span>
            </div>
            {blastHistory.map((blast) => {
              const replyCount = blast.replyCount ?? 0;
              const sentCount = blast.sentCount ?? 0;
              const replyRate = sentCount > 0 ? Math.round((replyCount / sentCount) * 100) : 0;
              return (
                <Card key={blast.id} className="border-purple-100">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-foreground truncate">{blast.campaignTitle}</span>
                            {blast.batchLabel && (
                              <span className="text-xs text-muted-foreground">{blast.batchLabel}</span>
                            )}
                            <span className="inline-flex items-center gap-1 text-xs font-medium bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded-full">
                              <Megaphone className="w-2.5 h-2.5" />
                              {blast.campaignType.replace(/_/g, " ")}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(blast.firedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                            {blast.firedBy && blast.firedBy !== "admin" && ` · by ${blast.firedBy}`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6 text-sm shrink-0 ml-4">
                        <div className="text-center hidden sm:block">
                          <div className="font-semibold text-foreground">{sentCount}</div>
                          <div className="text-muted-foreground text-xs">Sent</div>
                        </div>
                        <div className="text-center hidden sm:block">
                          <div className="font-semibold text-blue-600">{replyCount}</div>
                          <div className="text-muted-foreground text-xs">{replyRate}% reply</div>
                        </div>
                        <div className="text-center hidden sm:block">
                          <div className={`font-semibold text-xs px-2 py-0.5 rounded-full ${
                            replyRate >= 20 ? "bg-green-100 text-green-700" :
                            replyRate >= 10 ? "bg-amber-100 text-amber-700" :
                            "bg-gray-100 text-gray-500"
                          }`}>{replyRate}%</div>
                          <div className="text-muted-foreground text-xs">Rate</div>
                        </div>
                        <div className="text-center hidden sm:block">
                          <div className="font-semibold text-green-600">
                            {blast.failedCount === 0
                              ? <span className="text-green-600 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> All</span>
                              : <span className="text-amber-600 flex items-center gap-1"><XCircle className="w-3 h-3" />{sentCount - blast.failedCount}/{sentCount}</span>}
                          </div>
                          <div className="text-muted-foreground text-xs">Delivered</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* ── Reactivation Campaigns ──────────────────────────────────────── */}
        {campaigns.length > 0 && (
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-foreground">Reactivation Campaigns</h2>
            <span className="text-xs text-muted-foreground">— built from booking history contacts</span>
          </div>
        )}

        {campaigns.length === 0 && blastHistory.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No campaigns yet</h3>
              <p className="text-muted-foreground mb-4 max-w-sm">
                Create your first reactivation campaign from your booking history.
              </p>
              <Button onClick={() => setView("new")} className="gap-2">
                <PlusCircle className="w-4 h-4" />
                Create Campaign
              </Button>
            </CardContent>
          </Card>
        ) : campaigns.length > 0 ? (
          <div className="space-y-3">
            {(campaigns as Campaign[]).map((c) => (
              <Card
                key={c.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => { setSelectedCampaignId(c.id); setView("detail"); }}
              >
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-foreground truncate">{c.name}</span>
                          <Badge variant={STATUS_BADGE[c.status].variant}>
                            {STATUS_BADGE[c.status].label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                          <Database className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium">Booking History</span>
                          <span>·</span>
                          <span>{c.totalContacts} contacts</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-sm shrink-0 ml-4">
                      <div className="text-center hidden sm:block">
                        <div className="font-semibold text-foreground">{c.sentCount}</div>
                        <div className="text-muted-foreground text-xs">Sent</div>
                      </div>
                      <div className="text-center hidden sm:block">
                        <div className="font-semibold text-blue-600">{c.repliedCount}</div>
                        <div className="text-muted-foreground text-xs">
                          {c.sentCount > 0 ? `${Math.round((c.repliedCount / c.sentCount) * 100)}%` : "0%"} reply
                        </div>
                      </div>
                      <div className="text-center hidden sm:block">
                        <div className="font-semibold text-green-600">{c.bookedCount}</div>
                        <div className="text-muted-foreground text-xs">Booked</div>
                      </div>
                      <div className="text-center hidden md:block">
                        <div className="font-semibold text-purple-600">
                          {c.bookedRevenue > 0 ? `$${c.bookedRevenue.toLocaleString()}` : "—"}
                        </div>
                        <div className="text-muted-foreground text-xs">Revenue</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function renderNewCampaign() {
    const total = preview?.total ?? 0;
    const contacts = preview?.contacts ?? [];
    const alreadyEnrolled = preview?.alreadyEnrolled ?? 0;
    const canCreate = campaignName.trim() && total > 0;

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setView("list")} className="gap-1">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">New Campaign</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Contacts are pulled from your booking history database — no upload needed.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Config */}
          <div className="space-y-5">

            {/* Step 1: Filter Audience */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
                  Filter Audience
                </CardTitle>
                <CardDescription>
                  Choose which customers from your booking history to target.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-sm font-medium flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5" />
                      Booking Frequency
                    </label>
                    <button
                      type="button"
                      onClick={() => refetchPreview()}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      <RefreshCw className={`w-3 h-3 ${isLoadingPreview ? "animate-spin" : ""}`} />
                      Refresh
                    </button>
                  </div>
                  <Select value={frequencyFilter} onValueChange={(v) => setFrequencyFilter(v as FrequencyFilter)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All eligible customers</SelectItem>
                      <SelectItem value="one-time">One-time bookings only</SelectItem>
                      <SelectItem value="recurring">Recurring customers only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {isLoadingPreview ? (
                  <div className="flex items-center justify-center py-4">
                    <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{total}</div>
                      <div className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">Eligible contacts</div>
                    </div>
                    <div className="bg-muted rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-muted-foreground">{alreadyEnrolled}</div>
                      <div className="text-xs text-muted-foreground mt-1">Already enrolled</div>
                    </div>
                  </div>
                )}

                {total === 0 && !isLoadingPreview && (
                  <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 rounded-lg px-3 py-2">
                    No eligible contacts yet. Run a sync from the Completed Jobs page to populate your database.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Step 2: Configure */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
                  Configure Campaign
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Campaign Name</label>
                  <Input
                    placeholder="e.g. March Reactivation — One-Time Customers"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">
                    Batch Size <span className="text-muted-foreground font-normal">(messages per hour)</span>
                  </label>
                  <Select value={String(batchSize)} onValueChange={(v) => setBatchSize(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25 / hour (safest)</SelectItem>
                      <SelectItem value="50">50 / hour (recommended)</SelectItem>
                      <SelectItem value="100">100 / hour (faster)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Step 3: Message */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                  Message Template
                </CardTitle>
                <CardDescription>
                  Use <code className="bg-muted px-1 rounded text-xs">[Name]</code> to personalize with the customer's first name.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  rows={4}
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                  placeholder="Hi [Name]! ..."
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground mt-2">
                  {messageTemplate.length}/160 characters
                  {messageTemplate.length > 160 && (
                    <span className="text-amber-600 ml-1">(will send as 2 SMS segments)</span>
                  )}
                </p>
                {messageTemplate && (
                  <div className="mt-3 bg-muted rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1 font-medium">Preview:</p>
                    <p className="text-sm">
                      {messageTemplate.replace(/\[Name\]/gi, "Sarah")}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Button
              className="w-full gap-2"
              size="lg"
              onClick={handleCreateCampaign}
              disabled={createCampaign.isPending || !canCreate}
            >
              {createCampaign.isPending
                ? "Creating…"
                : `Create Campaign (Draft) — ${total} contacts`}
            </Button>
          </div>

          {/* Right: Contact Preview */}
          <div>
            <Card className="sticky top-4">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Contact Preview
                </CardTitle>
                <CardDescription>
                  Showing up to 200 of {total} eligible contacts from your booking database
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {isLoadingPreview ? (
                  <div className="flex items-center justify-center py-12">
                    <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : contacts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                    <Database className="w-8 h-8 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">
                      No eligible contacts yet. Sync completed jobs to populate this list.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-[500px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Frequency</TableHead>
                          <TableHead className="text-right">Job Date</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {contacts.map((c: any, i: number) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{c.firstName || c.name || "—"}</TableCell>
                            <TableCell className="text-muted-foreground text-xs">{c.phone}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{c.frequency || "One-time"}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground">{c.jobDate || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  function renderCampaignDetail() {
    const campaign = campaignDetail?.campaign as Campaign | undefined;
    const contacts = campaignDetail?.contacts ?? [];

    if (!campaign) {
      return (
        <div className="flex items-center justify-center py-20">
          <p className="text-muted-foreground">Loading campaign…</p>
        </div>
      );
    }

    const sentPct = campaign.totalContacts > 0 ? Math.round((campaign.sentCount / campaign.totalContacts) * 100) : 0;
    const replyRate = campaign.sentCount > 0 ? Math.round((campaign.repliedCount / campaign.sentCount) * 100) : 0;
    const bookRate = campaign.repliedCount > 0 ? Math.round((campaign.bookedCount / campaign.repliedCount) * 100) : 0;

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setView("list")} className="gap-1">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-foreground">{campaign.name}</h1>
                <Badge variant={STATUS_BADGE[campaign.status].variant}>
                  {STATUS_BADGE[campaign.status].label}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                <Database className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium">Booking History</span>
                <span>· {campaign.totalContacts} contacts</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {campaign.status === "DRAFT" && (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-1"
                  onClick={() => setDeleteConfirmId(campaign.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </Button>
                <Button
                  size="sm"
                  className="gap-1"
                  onClick={() => handleStatusChange(campaign.id, "ACTIVE")}
                  disabled={updateStatus.isPending}
                >
                  <Play className="w-3.5 h-3.5" />
                  Launch Campaign
                </Button>
              </>
            )}
            {campaign.status === "ACTIVE" && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                onClick={() => handleStatusChange(campaign.id, "PAUSED")}
                disabled={updateStatus.isPending}
              >
                <Pause className="w-3.5 h-3.5" />
                Pause
              </Button>
            )}
            {campaign.status === "PAUSED" && (
              <Button
                size="sm"
                className="gap-1"
                onClick={() => handleStatusChange(campaign.id, "ACTIVE")}
                disabled={updateStatus.isPending}
              >
                <Play className="w-3.5 h-3.5" />
                Resume
              </Button>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Progress</span>
              </div>
              <div className="text-2xl font-bold">{sentPct}%</div>
              <div className="text-xs text-muted-foreground">{campaign.sentCount} / {campaign.totalContacts} sent</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">Reply Rate</span>
              </div>
              <div className="text-2xl font-bold text-blue-600">{replyRate}%</div>
              <div className="text-xs text-muted-foreground">{campaign.repliedCount} replies</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Booked</span>
              </div>
              <div className="text-2xl font-bold text-green-600">{campaign.bookedCount}</div>
              <div className="text-xs text-muted-foreground">{bookRate}% of replies</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-muted-foreground">Revenue</span>
              </div>
              <div className="text-2xl font-bold text-purple-600">
                {campaign.bookedRevenue > 0 ? `$${campaign.bookedRevenue.toLocaleString()}` : "—"}
              </div>
              <div className="text-xs text-muted-foreground">from bookings</div>
            </CardContent>
          </Card>
        </div>

        {/* A/B Test stats if available */}
        {campaignStats && (campaignStats as any).abTestResults && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                A/B Test Results
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {((campaignStats as any).abTestResults as any[]).map((variant: any, i: number) => (
                  <div key={i} className="bg-muted rounded-lg p-3">
                    <div className="font-medium text-sm mb-1">{variant.label}</div>
                    <div className="text-xs text-muted-foreground">{variant.replyRate}% reply rate · {variant.bookRate}% book rate</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Contact list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Contacts ({contacts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(contacts as any[]).map((c: any, i: number) => (
                    <TableRow
                      key={i}
                      className={c.conversationId ? "cursor-pointer hover:bg-muted/50" : ""}
                    >
                      <TableCell className="font-medium">{c.firstName || c.name || "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{c.phone}</TableCell>
                      <TableCell>
                        {c.booked ? (
                          <Badge variant="default" className="text-xs bg-green-600">Booked</Badge>
                        ) : c.replied ? (
                          <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">Replied</Badge>
                        ) : c.sentAt ? (
                          <Badge variant="secondary" className="text-xs">Sent</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-muted-foreground">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {c.sentAt ? new Date(c.sentAt).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Message flow panel */}
        <MessageFlowPanel flowType="reactivation" />
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="hj-theme min-h-screen" style={{ backgroundColor: '#F7F7F7' }}>
      <AdminHeader activeTab="campaigns" />
      <div className="max-w-5xl mx-auto px-4 py-8">
      {view === "list" && renderCampaignList()}
      {view === "new" && renderNewCampaign()}
      {view === "detail" && renderCampaignDetail()}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Campaign</DialogTitle>
            <DialogDescription>
              This will permanently delete the campaign and all its contacts. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteCampaign.mutate({ id: deleteConfirmId })}
              disabled={deleteCampaign.isPending}
            >
              {deleteCampaign.isPending ? "Deleting…" : "Delete Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}
