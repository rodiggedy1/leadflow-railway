/**
 * ReactivationCampaigns.tsx
 * Admin page for managing reactivation SMS campaigns.
 *
 * Flow:
 *  1. Upload CSV → preview eligible contacts by segment
 *  2. Configure campaign (name, message, segment, batch size)
 *  3. Review contact list → Launch (DRAFT → ACTIVE)
 *  4. Monitor campaign progress (sent / replied / booked)
 */

import { useState, useRef } from "react";
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
  Upload,
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
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";

interface Campaign {
  id: number;
  name: string;
  messageTemplate: string;
  segment: string;
  status: CampaignStatus;
  batchSize: number;
  totalContacts: number;
  sentCount: number;
  repliedCount: number;
  bookedCount: number;
  bookedRevenue: number; // live-computed from joined conversation_sessions
  lastSentAt: Date | null;
  createdAt: Date;
}

interface PreviewContact {
  phone: string;
  name: string;
  firstName: string;
  email: string;
  lastBookingDate: string;
  daysSince: number;
  bookingCount: number;
  segment: "6-12mo" | "1-2yr";
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

const SEGMENT_LABELS: Record<string, string> = {
  "6-12mo": "Warm (6–12 months)",
  "1-2yr": "Lapsed (1–2 years)",
  all: "All Eligible",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReactivationCampaigns() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // View state: "list" | "new" | "detail"
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);

  // CSV upload state
  const [csvText, setCsvText] = useState<string>("");
  const [csvFileName, setCsvFileName] = useState<string>("");

  // Campaign form state
  const [campaignName, setCampaignName] = useState("");
  const [messageTemplate, setMessageTemplate] = useState(DEFAULT_TEMPLATE);
  const [segment, setSegment] = useState<"6-12mo" | "1-2yr" | "all">("6-12mo");
  const [batchSize, setBatchSize] = useState(50);

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: campaigns = [], refetch: refetchCampaigns } =
    trpc.campaigns.list.useQuery(undefined, { refetchInterval: 10_000 });

  const { data: previewData, isPending: isPreviewing } =
    trpc.campaigns.previewCsv.useMutation();

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

  const previewCsv = trpc.campaigns.previewCsv.useMutation({
      onError: (err) => toast.error(err.message),
  });

  const createCampaign = trpc.campaigns.createFromCsv.useMutation({
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

  const deleteCampaign= trpc.campaigns.delete.useMutation({
    onSuccess: () => {
      toast.success("Campaign deleted");
      refetchCampaigns();
      setDeleteConfirmId(null);
      if (view === "detail") setView("list");
    },
    onError: (err) => toast.error(err.message),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      previewCsv.mutate({ csvText: text });
    };
    reader.readAsText(file);
  }

  function handleCreateCampaign() {
    if (!csvText) {
      toast.error("Please upload a CSV file first.");
      return;
    }
    if (!campaignName.trim()) {
      toast.error("Please enter a campaign name.");
      return;
    }
    createCampaign.mutate({ name: campaignName, messageTemplate, segment, batchSize, csvText });
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
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Admin
        </a>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Reactivation Campaigns</h1>
            <p className="text-muted-foreground mt-1">
              Re-engage past customers who haven't booked in 6–24 months.
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
              <Upload className="w-4 h-4" />
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

        {campaigns.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No campaigns yet</h3>
              <p className="text-muted-foreground mb-4 max-w-sm">
                Upload your customer list to create your first reactivation campaign.
              </p>
              <Button onClick={() => setView("new")} className="gap-2">
                <Upload className="w-4 h-4" />
                Create Campaign
              </Button>
            </CardContent>
          </Card>
        ) : (
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
                        <p className="text-sm text-muted-foreground">
                          {SEGMENT_LABELS[c.segment] ?? c.segment} · {c.totalContacts} contacts
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
        )}
      </div>
    );
  }

  function renderNewCampaign() {
    const preview = previewCsv.data;
    const contactsForSegment =
      segment === "6-12mo"
        ? preview?.warmTotal ?? 0
        : segment === "1-2yr"
        ? preview?.lapsedTotal ?? 0
        : (preview?.warmTotal ?? 0) + (preview?.lapsedTotal ?? 0);

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setView("list")} className="gap-1">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Button>
          <h1 className="text-2xl font-bold text-foreground">New Campaign</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Upload + Config */}
          <div className="space-y-5">
            {/* Step 1: Upload CSV */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
                  Upload Customer List
                </CardTitle>
                <CardDescription>
                  Export your booking history as CSV. Only one-time customers inactive 6–24 months will be included.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-4 h-4" />
                  {csvFileName || "Choose CSV file"}
                </Button>

                {isPreviewing && (
                  <p className="text-sm text-muted-foreground mt-2 text-center">Analyzing contacts…</p>
                )}

                {preview && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-700 dark:text-blue-400">{preview.warmTotal}</div>
                      <div className="text-xs text-blue-600 dark:text-blue-500 mt-1">Warm (6–12 mo)</div>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-amber-700 dark:text-amber-400">{preview.lapsedTotal}</div>
                      <div className="text-xs text-amber-600 dark:text-amber-500 mt-1">Lapsed (1–2 yr)</div>
                    </div>
                  </div>
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
                    placeholder="e.g. March Reactivation — Warm Leads"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Target Segment</label>
                  <Select value={segment} onValueChange={(v) => setSegment(v as typeof segment)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="6-12mo">Warm — 6 to 12 months ({preview?.warmTotal ?? "—"} contacts)</SelectItem>
                      <SelectItem value="1-2yr">Lapsed — 1 to 2 years ({preview?.lapsedTotal ?? "—"} contacts)</SelectItem>
                      <SelectItem value="all">All Eligible ({(preview?.warmTotal ?? 0) + (preview?.lapsedTotal ?? 0)} contacts)</SelectItem>
                    </SelectContent>
                  </Select>
                  {preview && contactsForSegment > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {contactsForSegment} contacts will receive this message
                    </p>
                  )}
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
                {/* Preview */}
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
              disabled={createCampaign.isPending || !csvText || !campaignName.trim()}
            >
              {createCampaign.isPending ? "Creating…" : "Create Campaign (Draft)"}
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
                  Showing up to 200 contacts for the selected segment
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {!preview ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                    <Upload className="w-8 h-8 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">Upload a CSV to preview contacts</p>
                  </div>
                ) : (
                  <div className="max-h-[500px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead className="text-right">Last Booking</TableHead>
                          <TableHead className="text-right">Bookings</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(segment === "6-12mo" ? preview.warm : segment === "1-2yr" ? preview.lapsed : [...preview.warm, ...preview.lapsed])
                          .slice(0, 100)
                          .map((c: PreviewContact, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{c.firstName || c.name}</TableCell>
                              <TableCell className="text-muted-foreground text-xs">{c.phone}</TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {c.daysSince}d ago
                              </TableCell>
                              <TableCell className="text-right text-xs">{c.bookingCount}</TableCell>
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
              <p className="text-sm text-muted-foreground">
                {SEGMENT_LABELS[campaign.segment] ?? campaign.segment} · {campaign.totalContacts} contacts
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Total</span>
              </div>
              <div className="text-2xl font-bold">{campaign.totalContacts}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{sentPct}% sent</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Sent</span>
              </div>
              <div className="text-2xl font-bold">{campaign.sentCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">of {campaign.totalContacts}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">Replied</span>
              </div>
              <div className="text-2xl font-bold text-blue-600">{campaign.repliedCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{replyRate}% reply rate</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Booked</span>
              </div>
              <div className="text-2xl font-bold text-green-600">{campaign.bookedCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{bookRate}% of replies</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-muted-foreground">Revenue</span>
              </div>
              <div className="text-2xl font-bold text-purple-600">
                {campaignStats?.bookedRevenue ? `$${campaignStats.bookedRevenue.toLocaleString()}` : "$0"}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">from booked leads</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-orange-500" />
                <span className="text-xs text-muted-foreground">Conv. Rate</span>
              </div>
              <div className="text-2xl font-bold text-orange-600">
                {campaignStats?.conversionRate ?? bookRate}%
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">replies → booked</div>
            </CardContent>
          </Card>
        </div>

        {/* Progress bar */}
        {campaign.totalContacts > 0 && (
          <Card>
            <CardContent className="pt-5 pb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Send Progress</span>
                <span className="text-sm text-muted-foreground">{campaign.sentCount} / {campaign.totalContacts}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${sentPct}%` }}
                />
              </div>
              {campaign.lastSentAt && (
                <p className="text-xs text-muted-foreground mt-2">
                  Last sent: {new Date(campaign.lastSentAt).toLocaleString()}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Message Flow — editable SMS sequence */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Message Flow
            </CardTitle>
            <CardDescription>
              The full SMS sequence sent to reactivation contacts. Click <strong>Edit</strong> on any message to update the copy.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MessageFlowPanel
              flowType="reactivation"
              sampleVars={{
                "[Name]": contacts[0]?.firstName || contacts[0]?.name || "Sarah",
                "[Discount]": "10",
                "[LastPrice]": "150",
                "[DiscountedPrice]": "135",
              }}
            />
          </CardContent>
        </Card>

        {/* Contact list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Contacts ({contacts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Segment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Last Booking</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.slice(0, 200).map((c: any) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.firstName || c.name || "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{c.phone}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {SEGMENT_LABELS[c.segment ?? ""] ?? c.segment ?? "—"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <ContactStatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {c.daysSince ? `${c.daysSince}d ago` : c.lastBookingDate ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {view === "list" && renderCampaignList()}
      {view === "new" && renderNewCampaign()}
      {view === "detail" && renderCampaignDetail()}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Campaign?</DialogTitle>
            <DialogDescription>
              This will permanently delete the campaign and all its contacts. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteCampaign.mutate({ id: deleteConfirmId })}
              disabled={deleteCampaign.isPending}
            >
              {deleteCampaign.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ContactStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    PENDING: { label: "Pending", className: "bg-muted text-muted-foreground" },
    SENT: { label: "Sent", className: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400" },
    REPLIED: { label: "Replied", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400" },
    BOOKED: { label: "Booked", className: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400" },
    OPTED_OUT: { label: "Opted Out", className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400" },
  };
  const c = config[status] ?? config.PENDING;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}
