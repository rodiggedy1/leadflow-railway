import React, { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  REVIEW_AGENT_NAME,
  publicReviewSchema,
  reviewEntrySchema,
  reviewStatusSchema,
  type PublicReview,
  type ReviewEntry,
  type ReviewResponseApi,
  type ReviewStatus,
} from "@shared/reviewResponses";
import "./review-responses.css";

// Isolated draft-only UI. Existing messaging, navigation and operational data are untouched.
const STATUS_LABELS: Record<ReviewStatus, string> = {
  RECORDED: "Recorded", DRAFTING: "Drafting", DRAFT_READY: "Draft ready",
  NEEDS_APPROVAL: "Needs approval", APPROVED: "Approved — not published",
  PUBLISHED: "Published record", ALREADY_REPLIED: "Already replied",
  FAILED: "Needs review", UNCERTAIN: "Uncertain — refresh required",
};
const PLATFORM_LABELS = { google: "Google", thumbtack: "Thumbtack" } as const;

export interface ReviewResponseFilters {
  platform: "all" | PublicReview["platform"];
  rating: "all" | string;
  status: "all" | ReviewStatus;
}
export function reviewResponseMatchesFilters(entry: ReviewEntry, filters: ReviewResponseFilters) {
  return (filters.platform === "all" || entry.review.platform === filters.platform)
    && (filters.rating === "all" || String(entry.review.rating) === filters.rating)
    && (filters.status === "all" || entry.status === filters.status);
}
export function reviewResponseCanDraft(entry: ReviewEntry) {
  return entry.status !== "DRAFTING" && entry.status !== "PUBLISHED"
    && entry.status !== "ALREADY_REPLIED" && entry.status !== "UNCERTAIN"
    && !entry.review.existingResponse?.trim() && !entry.publishedResponse?.trim();
}
export function reviewResponseCanApprove(entry: ReviewEntry, text: string) {
  return (entry.status === "DRAFT_READY" || entry.status === "NEEDS_APPROVAL")
    && Boolean(text.trim()) && text === entry.generatedDraft
    && entry.validationIssues.length === 0 && reviewResponseCanDraft(entry);
}
/** Do not let a stale list or result replace a newer persisted revision. */
export function mergeReviewResponseEntry(entries: ReviewEntry[], incoming: ReviewEntry): ReviewEntry[] {
  const previous = entries.find(entry => entry.key === incoming.key);
  if (previous && previous.revision > incoming.revision) return entries;
  return previous ? entries.map(entry => entry.key === incoming.key ? incoming : entry) : [incoming, ...entries];
}
/** Synchronous locking also protects the interval before React renders disabled buttons. */
export function createReviewResponseOperationGuard() {
  let sequence = 0;
  let active: number | null = null;
  return {
    begin() { if (active !== null) return null; active = ++sequence; return active; },
    current(token: number) { return active === token; },
    finish(token: number) { if (active === token) active = null; },
    invalidate() { active = null; sequence += 1; },
    busy() { return active !== null; },
  };
}

export interface ManualReviewFields {
  platform: PublicReview["platform"];
  accountId: string; businessId: string; reviewId: string; rating: string;
  reviewerName: string; text: string; createdAt: string; existingResponse: string;
}
const EMPTY_MANUAL_REVIEW: ManualReviewFields = {
  platform: "google", accountId: "", businessId: "", reviewId: "", rating: "",
  reviewerName: "", text: "", createdAt: "", existingResponse: "",
};
export function parseManualReview(fields: ManualReviewFields): PublicReview {
  // IDs and timestamps are supplied explicitly; never invent a provider ID or date.
  return publicReviewSchema.parse({
    ...fields, rating: Number(fields.rating), source: "manual",
    updatedAt: null, negotiationId: null, existingResponse: fields.existingResponse.trim() ? fields.existingResponse : null,
  });
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The review response service is unavailable.";
}
function parseEntries(value: ReviewEntry[]) { return reviewEntrySchema.array().parse(value); }

export function reviewResponseNeedsInitialDraft(entry: ReviewEntry) {
  return entry.status === "RECORDED" && entry.generatedDraft === null
    && entry.approvedText === null && entry.approvedAt === null && entry.approvedBy === null
    && entry.publishedResponse === null && !entry.review.existingResponse?.trim();
}
/** Finite human-requested batch: one import, sequential initial drafts, one final list. No retries. */
export async function pullCapturedReviewsAndDrafts(api: ReviewResponseApi, progress: {
  entry(entry: ReviewEntry): void; message(message: string): void; current(): boolean;
}) {
  if (!api.importCaptured) throw new Error("Captured review import is unavailable.");
  const imported = parseEntries(await api.importCaptured());
  if (!progress.current()) return null;
  imported.forEach(progress.entry);
  const pending = imported.filter(reviewResponseNeedsInitialDraft);
  for (let index = 0; index < pending.length; index += 1) {
    const entry = pending[index];
    if (!progress.current()) return null;
    progress.message(`Drafting reply ${index + 1} of ${pending.length}`);
    const result = reviewEntrySchema.parse(await api.generate(entry.key));
    if (!progress.current()) return null;
    if (result.key !== entry.key || result.revision < entry.revision) throw new Error("A draft returned a mismatched or stale review. Refresh before retrying.");
    progress.entry(result);
  }
  const rows = parseEntries(await api.list());
  return progress.current() ? { rows, importedCount: imported.length, draftedCount: pending.length } : null;
}

function ReleaseNotice() {
  return <section className="rr-release" aria-label="Draft-only release restrictions">
    <div><strong>Draft-only workspace</strong><p>Claude prepares drafts only when you ask. Approval saves an internal decision; it never posts a response or contacts a customer.</p></div>
    <div className="rr-locks"><span>Monitoring off</span><span>Auto-publish off</span><button type="button" disabled title="Publishing is disabled in this release">Publishing disabled</button></div>
  </section>;
}

export function ReviewResponseWorkspace({ api }: { api: ReviewResponseApi }) {
  const [entries, setEntries] = useState<ReviewEntry[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ key: string; revision: number; text: string } | null>(null);
  const [fields, setFields] = useState<ManualReviewFields>({ ...EMPTY_MANUAL_REVIEW });
  const [filters, setFilters] = useState<ReviewResponseFilters>({ platform: "all", rating: "all", status: "all" });
  const [busy, setBusy] = useState<string | null>("Loading reviews");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const guard = useRef(createReviewResponseOperationGuard()).current;
  const selected = entries.find(entry => entry.key === selectedKey) ?? null;
  const draftText = selected && editor?.key === selected.key && editor.revision === selected.revision
    ? editor.text : selected?.generatedDraft ?? "";
  const dirty = Boolean(selected && draftText !== (selected.generatedDraft ?? ""));
  const visible = entries.filter(entry => reviewResponseMatchesFilters(entry, filters));

  useEffect(() => {
    guard.invalidate();
    const token = guard.begin()!;
    setEntries([]); setSelectedKey(null); setEditor(null); setReady(false);
    setBusy("Loading reviews"); setError(null); setNotice(null); setNeedsRefresh(false);
    void (async () => {
      try {
        const rows = parseEntries(await api.list());
        if (!guard.current(token)) return;
        setEntries(rows); setReady(true);
      } catch (failure) {
        if (guard.current(token)) setError(`Could not load reviews: ${errorMessage(failure)} No sample data has been substituted.`);
      } finally {
        if (guard.current(token)) { guard.finish(token); setBusy(null); }
      }
    })();
    return () => guard.invalidate();
  }, [api, guard]);

  async function refresh() {
    if (dirty) { setError("Save Draft or discard local edits before refreshing."); return; }
    const token = guard.begin();
    if (token === null) return;
    setBusy("Refreshing reviews"); setError(null); setNotice(null);
    try {
      const rows = parseEntries(await api.list());
      if (!guard.current(token)) return;
      setEntries(previous => rows.map(row => {
        const newer = previous.find(entry => entry.key === row.key && entry.revision > row.revision);
        return newer ?? row;
      }));
      setReady(true); setNeedsRefresh(false);
    } catch (failure) {
      if (guard.current(token)) { setError(`Refresh failed: ${errorMessage(failure)}`); setNeedsRefresh(true); }
    } finally {
      if (guard.current(token)) { guard.finish(token); setBusy(null); }
    }
  }

  async function pullCaptured() {
    if (dirty) { setError("Save Draft or discard local edits before pulling reviews."); return; }
    const token = guard.begin();
    if (token === null || !ready || needsRefresh) { if (token !== null) guard.finish(token); return; }
    setBusy("Pulling captured Thumbtack reviews"); setError(null); setNotice(null);
    try {
      const result = await pullCapturedReviewsAndDrafts(api, {
        current: () => guard.current(token), message: setBusy,
        entry: entry => {
          if (!guard.current(token)) return;
          setEntries(previous => mergeReviewResponseEntry(previous, entry));
          setSelectedKey(previous => previous ?? entry.key);
        },
      });
      if (!result || !guard.current(token)) return;
      setEntries(previous => result.rows.map(row => previous.find(entry => entry.key === row.key && entry.revision > row.revision) ?? row));
      setNotice(`Pulled ${result.importedCount} captured reviews; requested ${result.draftedCount} new reply drafts. Saved drafts and approvals were preserved. Check validation warnings before approving. Nothing was published.`);
    } catch (failure) {
      if (guard.current(token)) {
        setNeedsRefresh(true);
        setError(`Pull or drafting could not be confirmed: ${errorMessage(failure)} Refresh before another action. Nothing was published.`);
      }
    } finally {
      if (guard.current(token)) { guard.finish(token); setBusy(null); }
    }
  }

  async function runAction(label: string, action: () => Promise<ReviewEntry>, expected?: ReviewEntry) {
    const token = guard.begin();
    if (token === null || !ready || needsRefresh) { if (token !== null) guard.finish(token); return; }
    setBusy(label); setError(null); setNotice(null);
    let completed = false;
    try {
      const result = reviewEntrySchema.parse(await action());
      if (!guard.current(token)) return;
      if (expected && (result.key !== expected.key || result.revision < expected.revision)) {
        throw new Error("The action returned a mismatched or stale review revision. Refresh before retrying.");
      }
      completed = true;
      setEntries(previous => mergeReviewResponseEntry(previous, result));
      setSelectedKey(result.key); setEditor(null);
      if (label === "Recording review") setFields({ ...EMPTY_MANUAL_REVIEW });
      setNotice(label === "Approving draft" ? "Draft approved internally — not published."
        : label === "Acknowledging alert" ? "Management alert acknowledged. This does not approve the draft."
        : label === "Saving draft" ? "Draft saved. Any previous approval is cleared."
        : label === "Generating draft" ? "Generation finished. Review the saved status and validation details before approval."
        : "Manual review recorded. Generate a draft only when you are ready.");
      // One explicit refresh after the requested action; no timers or automatic ingestion.
      const rows = parseEntries(await api.list());
      if (!guard.current(token)) return;
      setEntries(previous => {
        const merged = rows.map(row => {
          const newer = previous.find(entry => entry.key === row.key && entry.revision > row.revision);
          return newer ?? row;
        });
        return mergeReviewResponseEntry(merged, result);
      });
    } catch (failure) {
      if (guard.current(token)) {
        setNeedsRefresh(true);
        setError(`${completed ? "Action saved, but the list refresh failed" : "Action failed or could not be confirmed"}: ${errorMessage(failure)} Refresh before another action. Nothing was published.`);
      }
    } finally {
      if (guard.current(token)) { guard.finish(token); setBusy(null); }
    }
  }

  function recordReview(event: React.FormEvent) {
    event.preventDefault();
    if (guard.busy() || !ready || needsRefresh) return;
    try {
      const review = parseManualReview(fields);
      void runAction("Recording review", () => api.ingest(review));
    } catch (failure) {
      const result = publicReviewSchema.safeParse({ ...fields, rating: Number(fields.rating), source: "manual" });
      setError(result.success ? errorMessage(failure) : result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    }
  }
  function changeField(name: keyof ManualReviewFields, value: string) {
    setFields(previous => ({ ...previous, [name]: value }));
  }
  const blocked = Boolean(busy) || !ready || needsRefresh;

  return <main className="rr-page" data-review-response-workspace="draft-only">
    <header className="rr-hero"><div><span className="rr-eyebrow">AI OPERATIONS / CLAUDE / MANUAL REVIEW</span><h1>Review Response Workbench</h1><p>{REVIEW_AGENT_NAME}</p></div>
      {api.importCaptured && <button type="button" className="rr-primary" onClick={() => void pullCaptured()} disabled={blocked || dirty}>Pull reviews &amp; draft replies</button>}
      <button type="button" onClick={() => void refresh()} disabled={Boolean(busy) || dirty}>Refresh reviews</button>
    </header>
    <ReleaseNotice />
    <p className="rr-help">Captured Thumbtack reviews are retained webhook snapshots, not a live provider review list. Current public reply status is unverified (unknown); missing reply fields do not mean unanswered. Pulling is manual and drafts are never published here.</p>
    {busy && <p className="rr-message" role="status">{busy}…</p>}
    {error && <p className="rr-error" role="alert">{error}</p>}
    {notice && <p className="rr-message" role="status">{notice}</p>}
    {needsRefresh && <p className="rr-help">Actions are paused until a successful manual refresh. No failed action will be retried automatically.</p>}
    <div className="rr-workbench">
      <section className="rr-panel rr-inbox" aria-labelledby="rr-inbox-title">
        <div className="rr-section-heading"><h2 id="rr-inbox-title">Saved reviews</h2><span>{entries.length} recorded</span></div>
        <div className="rr-filters">
          <label>Platform<select value={filters.platform} disabled={Boolean(busy) || dirty} onChange={event => setFilters(previous => ({ ...previous, platform: event.target.value as ReviewResponseFilters["platform"] }))}><option value="all">All platforms</option><option value="google">Google</option><option value="thumbtack">Thumbtack</option></select></label>
          <label>Rating<select value={filters.rating} disabled={Boolean(busy) || dirty} onChange={event => setFilters(previous => ({ ...previous, rating: event.target.value }))}><option value="all">All ratings</option>{[5, 4, 3, 2, 1].map(rating => <option key={rating} value={rating}>{rating} stars</option>)}</select></label>
          <label>Status<select value={filters.status} disabled={Boolean(busy) || dirty} onChange={event => setFilters(previous => ({ ...previous, status: event.target.value as ReviewResponseFilters["status"] }))}><option value="all">All statuses</option>{reviewStatusSchema.options.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
        </div>
        {ready && !entries.length && <div className="rr-empty"><h3>No reviews recorded yet</h3><p>{api.importCaptured ? "Pull captured Thumbtack reviews to prepare recommended replies. Manual entry is available under details below." : "Manual entry is available under details below."} Google and Thumbtack are not being monitored, and no live provider connection is claimed.</p></div>}
        {ready && entries.length > 0 && !visible.length && <p className="rr-empty">No saved reviews match these filters.</p>}
        {!ready && !busy && <p className="rr-empty">Reviews unavailable. Resolve the service or migration error, then refresh.</p>}
        <div className="rr-review-list">{visible.map(entry => <button type="button" key={entry.key} className={`rr-review-row${selectedKey === entry.key ? " is-selected" : ""}`} aria-pressed={selectedKey === entry.key} disabled={Boolean(busy) || dirty} onClick={() => { if (guard.busy() || dirty) return; setSelectedKey(entry.key); setEditor(null); setNotice(null); }}>
          <span className="rr-row-meta">{PLATFORM_LABELS[entry.review.platform]} · {entry.review.rating}/5 <span>{STATUS_LABELS[entry.status]}</span></span>
          <strong>{entry.review.reviewerName || "Reviewer name not provided"}</strong><span className="rr-preview">{entry.review.text || "No written review text"}</span>
          {entry.escalationStatus === "management_required" && <span className="rr-flag">Management review required</span>}
        </button>)}</div>
      </section>
      <section className="rr-panel rr-detail" aria-labelledby="rr-draft-title">
        <h2 id="rr-draft-title">Review &amp; draft</h2>
        {!selected ? <div className="rr-empty"><h3>Select a saved review</h3><p>Inspect the original review, prepare a draft, and record a separate approval. Nothing is posted from this workspace.</p></div> : <>
          <div className="rr-detail-top"><strong>{PLATFORM_LABELS[selected.review.platform]} · {selected.review.rating}/5 stars</strong><span className="rr-badge">{STATUS_LABELS[selected.status]}</span></div>
          <h3>{selected.review.reviewerName || "Reviewer name not provided"}</h3>
          <p className="rr-review-text">{selected.review.text || "No written review text was supplied."}</p>
          <p className="rr-help">{selected.review.source === "thumbtack_webhook" ? "Captured Thumbtack reviews · current public reply status unverified" : `Source: ${selected.review.source}`}</p>
          <details><summary>Review IDs and source details</summary><dl className="rr-metadata"><dt>Review ID</dt><dd>{selected.review.reviewId}</dd><dt>Account provenance / business</dt><dd>{selected.review.accountId} / {selected.review.businessId}</dd><dt>Review timestamp</dt><dd>{selected.review.createdAt}</dd><dt>Source</dt><dd>{selected.review.source}</dd><dt>Saved revision</dt><dd>{selected.revision}</dd><dt>Booking context</dt><dd>Context not matched or verified in this workspace. No name-based matching.</dd></dl></details>
          {selected.review.existingResponse !== null && <section className="rr-existing"><h3>Existing provider response</h3><p>{selected.review.existingResponse || "Empty response supplied"}</p></section>}
          {(selected.severityReasons.length > 0 || selected.escalationStatus !== "not_required") && <section className="rr-management" aria-label="Management alert"><strong>{selected.escalationStatus === "acknowledged" ? "Management alert acknowledged" : "Management review required"}</strong>
            <ul>{selected.severityReasons.map((reason, index) => <li key={`${index}:${reason}`}>{reason}</li>)}</ul>
            <p>Acknowledging the alert is separate from approving a draft.</p>
            {selected.escalationStatus === "management_required" && <button type="button" disabled={blocked || dirty || !reviewResponseCanDraft(selected)} onClick={() => void runAction("Acknowledging alert", () => api.acknowledge({ key: selected.key, expectedRevision: selected.revision }), selected)}>Acknowledge alert</button>}
          </section>}
          {selected.validationIssues.length > 0 && <section className="rr-error" aria-label="Draft validation issues"><strong>Draft validation needs attention</strong><ul>{selected.validationIssues.map((issue, index) => <li key={`${index}:${issue}`}>{issue}</li>)}</ul></section>}
          <label className="rr-draft-label" htmlFor="rr-draft">Editable response draft<textarea id="rr-draft" rows={7} maxLength={20000} value={draftText} disabled={blocked || !reviewResponseCanDraft(selected)} onChange={event => setEditor({ key: selected.key, revision: selected.revision, text: event.target.value })} placeholder="Generate a draft explicitly, or enter your own draft." /></label>
          {dirty && <p className="rr-help">Unsaved local changes. Save Draft persists the edit and clears any prior approval. Save or discard before switching reviews or refreshing.</p>}
          <div className="rr-actions">
            <button type="button" disabled={blocked || dirty || !reviewResponseCanDraft(selected)} onClick={() => void runAction("Generating draft", () => api.generate(selected.key), selected)}>{selected.generatedDraft ? "Regenerate draft" : "Generate draft"}</button>
            <button type="button" disabled={blocked || !dirty || !draftText.trim() || !reviewResponseCanDraft(selected)} onClick={() => void runAction("Saving draft", () => api.edit({ key: selected.key, text: draftText, expectedRevision: selected.revision }), selected)}>Save Draft</button>
            <button type="button" className="rr-primary" disabled={blocked || dirty || !reviewResponseCanApprove(selected, draftText)} onClick={() => void runAction("Approving draft", () => api.approve({ key: selected.key, expectedRevision: selected.revision }), selected)}>Approve Draft</button>
            {dirty && <button type="button" disabled={Boolean(busy)} onClick={() => setEditor(null)}>Discard local edits</button>}
            <button type="button" disabled title="No publication endpoint is available in this release">Publishing disabled</button>
          </div>
          {selected.status === "APPROVED" && <section className="rr-approved"><strong>Approved — not published</strong><p>{selected.approvedText}</p><small>Approved by {selected.approvedBy || "recorded administrator"}{selected.approvedAt !== null ? ` · ${new Date(selected.approvedAt).toISOString()}` : ""}. Editing or regeneration requires a new approval.</small></section>}
          {selected.publishedResponse !== null && <section className="rr-existing"><h3>Stored publication record (read-only)</h3><p>{selected.publishedResponse}</p><small>This is an existing record, not a publication performed here.</small></section>}
        </>}
      </section>
    </div>
    <details className="rr-panel rr-manual"><summary>Optional manual review entry</summary><section aria-labelledby="rr-manual-title"><div className="rr-section-heading"><div><span className="rr-eyebrow">MANUAL ENTRY ONLY</span><h2 id="rr-manual-title">Record a public review</h2></div><span>Source: manual</span></div>
      <p className="rr-help">Use the actual provider account, business and review IDs. Recording does not generate, monitor, contact anyone, or publish a response.</p>
      <form onSubmit={recordReview}><fieldset disabled={blocked || dirty}><div className="rr-form-grid">
        <label>Platform<select value={fields.platform} onChange={event => changeField("platform", event.target.value)}><option value="google">Google</option><option value="thumbtack">Thumbtack</option></select></label>
        <label>Provider account ID<input required maxLength={128} value={fields.accountId} onChange={event => changeField("accountId", event.target.value)} autoComplete="off" /></label>
        <label>Business ID<input required maxLength={128} value={fields.businessId} onChange={event => changeField("businessId", event.target.value)} autoComplete="off" /></label>
        <label>Review ID<input required maxLength={256} value={fields.reviewId} onChange={event => changeField("reviewId", event.target.value)} autoComplete="off" /></label>
        <label>Rating<select required value={fields.rating} onChange={event => changeField("rating", event.target.value)}><option value="">Select rating</option>{[5, 4, 3, 2, 1].map(rating => <option key={rating} value={rating}>{rating} stars</option>)}</select></label>
        <label>Reviewer name (optional)<input maxLength={128} value={fields.reviewerName} onChange={event => changeField("reviewerName", event.target.value)} autoComplete="off" /></label>
        <label className="rr-span">Review timestamp (ISO 8601)<input type="text" required value={fields.createdAt} onChange={event => changeField("createdAt", event.target.value)} placeholder="YYYY-MM-DDTHH:mm:ssZ or timestamp with UTC offset" aria-describedby="rr-iso-help" autoComplete="off" /><small id="rr-iso-help">Paste the review’s original timestamp, including Z or a UTC offset. This is not a date picker.</small></label>
        <label className="rr-span">Original review text<textarea rows={4} maxLength={20000} value={fields.text} onChange={event => changeField("text", event.target.value)} /></label>
        <label className="rr-span">Existing provider response (optional)<textarea rows={3} maxLength={20000} value={fields.existingResponse} onChange={event => changeField("existingResponse", event.target.value)} /><small>If a response already exists, drafting is blocked; this workspace will not replace it.</small></label>
      </div><button type="submit" className="rr-primary">Record review</button></fieldset></form>
    </section></details>
  </main>;
}

function AccessState({ title, message, loading = false }: { title: string; message: string; loading?: boolean }) {
  return <main className="rr-page"><section className="rr-panel" aria-busy={loading}><h1>{title}</h1><p role={loading ? "status" : "alert"}>{message}</p><a href="/admin/dashboard">Back to staff dashboard</a></section></main>;
}

// Mounting Connected only after the session gate keeps all review queries admin-only.
function ConnectedReviewResponses() {
  const utils = trpc.useUtils();
  const status = trpc.aiActions.reviewResponses.status.useQuery(undefined, {
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false,
  });
  const importCaptured = trpc.aiActions.reviewResponses.importCaptured.useMutation({ retry: false });
  const ingest = trpc.aiActions.reviewResponses.ingest.useMutation({ retry: false });
  const generate = trpc.aiActions.reviewResponses.generate.useMutation({ retry: false });
  const edit = trpc.aiActions.reviewResponses.edit.useMutation({ retry: false });
  const approve = trpc.aiActions.reviewResponses.approve.useMutation({ retry: false });
  const acknowledge = trpc.aiActions.reviewResponses.acknowledge.useMutation({ retry: false });
  const { mutateAsync: importCapturedAsync } = importCaptured;
  const { mutateAsync: ingestAsync } = ingest;
  const { mutateAsync: generateAsync } = generate;
  const { mutateAsync: editAsync } = edit;
  const { mutateAsync: approveAsync } = approve;
  const { mutateAsync: acknowledgeAsync } = acknowledge;
  const api = useMemo<ReviewResponseApi>(() => {
    const invalidate = () => utils.aiActions.reviewResponses.list.invalidate(undefined, { refetchType: "none" });
    async function saved(action: Promise<ReviewEntry>) { const entry = await action; await invalidate(); return entry; }
    return {
      importCaptured: async () => { const rows = await importCapturedAsync(); await invalidate(); return rows; },
      list: () => utils.aiActions.reviewResponses.list.fetch(undefined, { staleTime: 0, retry: false }),
      ingest: review => saved(ingestAsync({ ...review, source: "manual" })),
      generate: key => saved(generateAsync({ key })),
      edit: input => saved(editAsync(input)),
      approve: input => saved(approveAsync(input)),
      acknowledge: input => saved(acknowledgeAsync(input)),
    };
  }, [utils, importCapturedAsync, ingestAsync, generateAsync, editAsync, approveAsync, acknowledgeAsync]);
  if (status.isLoading) return <AccessState title="Loading draft-only configuration…" message="Checking the review response module. No provider monitoring or publication is enabled." loading />;
  if (status.isError || !status.data) return <main className="rr-page"><section className="rr-panel"><h1>Review response module unavailable</h1><p className="rr-error" role="alert">{status.error?.message || "Configuration could not be loaded. No demo data or agent fallback is provided."}</p><button type="button" disabled={status.isFetching} onClick={() => void status.refetch()}>Retry configuration check</button></section><ReleaseNotice /></main>;
  if (status.data.monitoringEnabled !== false || status.data.publicationEnabled !== false || status.data.autoPublishEnabled !== false) return <AccessState title="Draft-only configuration required" message="The service configuration does not match this locked draft-only release. Review actions are unavailable." />;
  return <ReviewResponseWorkspace api={api} />;
}

export default function ReviewResponses() {
  const me = trpc.agents.me.useQuery(undefined, {
    retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false,
  });
  if (me.isLoading) return <AccessState title="Checking administrator access…" message="Confirming your existing staff session." loading />;
  if (me.isError) return <AccessState title="Unable to confirm administrator access" message={me.error.message} />;
  if (!me.data) return <AccessState title="Staff sign-in required" message="Sign in on the staff dashboard, then open the review response workspace." />;
  if (me.data.isAdmin !== true) return <AccessState title="Administrator access required" message="Only an authenticated administrator can record, draft or approve review responses." />;
  return <ConnectedReviewResponses key={me.data.id} />;
}
