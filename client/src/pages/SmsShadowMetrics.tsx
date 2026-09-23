import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, ShieldAlert } from "lucide-react";
import "./sms-shadow-metrics.css";

type SmsShadowMetrics = {
  evaluated: number;
  sent: number;
  sentUnchanged: number;
  sentEdited: number;
  averageConfidence: number | null;
};

type SmsShadowMetricsRow = {
  evaluationId: number;
  sessionId: number;
  customerName: string | null;
  draftText: string;
  sentText: string;
  score: number;
  decision: "would_send" | "review" | "blocked";
  wouldSendIfInScope: boolean;
  outcome: "sent_unchanged" | "sent_edited";
  outcomeAt: string | null;
};

function describeShadowEdit(draftText: string, sentText: string) {
  const draft = draftText.trim();
  const sent = sentText.trim();
  if (draft === sent) return { changed: false, removed: "", added: "" };
  let start = 0;
  while (start < draft.length && start < sent.length && draft[start] === sent[start]) start += 1;
  let draftEnd = draft.length - 1;
  let sentEnd = sent.length - 1;
  while (draftEnd >= start && sentEnd >= start && draft[draftEnd] === sent[sentEnd]) { draftEnd -= 1; sentEnd -= 1; }
  return {
    changed: true,
    removed: draft.slice(start, draftEnd + 1).trim(),
    added: sent.slice(start, sentEnd + 1).trim(),
  };
}

export default function SmsShadowMetrics() {
  const [metrics, setMetrics] = useState<SmsShadowMetrics | null>(null);
  const [rows, setRows] = useState<SmsShadowMetricsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    void fetch("/api/sms-shadow-evaluations/metrics", { credentials: "include" })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ metrics?: SmsShadowMetrics; rows?: SmsShadowMetricsRow[] }>;
      })
      .then(result => {
        setMetrics(result.metrics ?? null);
        setRows(Array.isArray(result.rows) ? result.rows : []);
      })
      .catch(() => setError("Shadow metrics are unavailable right now."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return <main className="sms-shadow-metrics-page">
    <header className="sms-shadow-metrics-page-header">
      <div>
        <a href="/admin/sms"><ArrowLeft />Back to SMS</a>
        <span><ShieldAlert />SMS Shadow Metrics</span>
        <p>Read-only learning data from AI drafts and successful human sends. No messages can be sent from this page.</p>
      </div>
      <button type="button" onClick={load} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />Refresh</button>
    </header>

    {loading ? <p className="sms-shadow-metrics-state">Loading learning data…</p> : error ? <p className="sms-shadow-metrics-state is-error">{error}</p> : <>
      <section className="sms-shadow-metrics-summary" aria-label="SMS shadow metrics summary">
        <span><small>Evaluated</small><b>{metrics?.evaluated ?? 0}</b></span>
        <span><small>Human sends</small><b>{metrics?.sent ?? 0}</b></span>
        <span><small>Sent unchanged</small><b>{metrics?.sentUnchanged ?? 0}</b></span>
        <span><small>Edited before send</small><b>{metrics?.sentEdited ?? 0}</b></span>
        <span><small>Avg. confidence</small><b>{metrics?.averageConfidence ?? "—"}{metrics?.averageConfidence !== null ? "/100" : ""}</b></span>
      </section>

      <section className="sms-shadow-metrics-list">
        <header><div><b>Draft-to-send pairs</b><small>Generated draft compared with the text a human actually sent.</small></div><span>{rows.length} recorded</span></header>
        {rows.length ? rows.map(row => {
          const edit = describeShadowEdit(row.draftText, row.sentText);
          return <article key={row.evaluationId} className="sms-shadow-metrics-row">
            <header><div><b>{row.customerName ?? "Customer"}</b><small>{row.outcomeAt ? new Date(row.outcomeAt).toLocaleString() : "Sent"}</small></div><span>Confidence {row.score}/100 · {row.wouldSendIfInScope ? "would send if in scope" : "would hold if in scope"}</span></header>
            <div className="sms-shadow-metrics-text"><section><small>AI draft</small><p>{row.draftText}</p></section><section><small>Final sent text</small><p>{row.sentText}</p></section></div>
            {edit.changed ? <footer><span><b>Removed</b>{edit.removed || "—"}</span><span><b>Added</b>{edit.added || "—"}</span></footer> : <footer><em>Sent unchanged</em></footer>}
          </article>;
        }) : <p className="sms-shadow-metrics-empty">No evaluated AI draft has been sent by a human yet.</p>}
      </section>
    </>}
  </main>;
}
