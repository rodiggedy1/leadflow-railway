import { useEffect, useMemo, useState } from "react";
import AdminHeader from "@/components/AdminHeader";
import { trpc } from "@/lib/trpc";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Download, Lock, Play, RotateCcw, X } from "lucide-react";

type Rating = "correct" | "incorrect" | "uncertain";
const COLORS = { purple: "#5d49f3", ink: "#1a1a2e", muted: "#73788c", border: "#e8e8f6", bg: "#f4f6fb" };

function PrettyValue({ value }: { value: unknown }) {
  return <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace", color: "#4c465e" }}>{JSON.stringify(value, null, 2)}</pre>;
}

function qualityScore(actual: any, inbound: string) {
  if (!actual) return null;
  const required = ["primaryCategory", "mission", "missionState", "nextBestAction", "confidence", "extractionStatus"];
  const structured = required.filter((key: string) => actual[key] !== undefined && actual[key] !== null).length / required.length;
  const confidence = typeof actual.confidence === "number" ? Math.max(0, Math.min(1, actual.confidence)) : 0;
  const observations = Array.isArray(actual.factObservations) ? actual.factObservations : [];
  const missing = Array.isArray(actual.missingFacts) ? actual.missingFacts.map(String) : [];
  const evidenceValid = observations.length === 0 ? 1 : observations.filter((fact: any) => typeof fact.evidenceExcerpt === "string" && inbound.toLowerCase().includes(fact.evidenceExcerpt.toLowerCase())).length / observations.length;
  const contradictionFree = observations.every((fact: any) => !missing.some((item: string) => item.toLowerCase() === String(fact.factKey).toLowerCase())) ? 1 : 0;
  const diagnostics = actual.decisionDiagnostics;
  const safety = diagnostics?.severity === "CRITICAL" ? 0 : diagnostics?.severity === "HIGH" ? 0.5 : 1;
  const direction = actual.speechAct && actual.speechAct !== "AMBIGUOUS" ? 1 : 0.5;
  const score = Math.round(structured * 25 + confidence * 20 + evidenceValid * 20 + contradictionFree * 15 + direction * 10 + safety * 10);
  return { score, structured: Math.round(structured * 100), confidence: Math.round(confidence * 100), evidenceValid: Math.round(evidenceValid * 100), contradictionFree: Math.round(contradictionFree * 100), direction: Math.round(direction * 100), safety: Math.round(safety * 100), severity: diagnostics?.severity ?? "UNKNOWN" };
}

function issueFlags(actual: any, inbound: string) {
  if (!actual) return ["Not run"];
  const flags: string[] = [];
  const observations = Array.isArray(actual.factObservations) ? actual.factObservations : [];
  const missing = Array.isArray(actual.missingFacts) ? actual.missingFacts.map(String) : [];
  const observedKeys = observations.map((fact: any) => String(fact.factKey));
  if (observedKeys.some((key: string) => missing.includes(key))) flags.push("Contradiction");
  if (observations.some((fact: any) => typeof fact.evidenceExcerpt !== "string" || !inbound.toLowerCase().includes(fact.evidenceExcerpt.toLowerCase()))) flags.push("Evidence review");
  if (typeof actual.confidence !== "number" || actual.confidence < 0.75) flags.push("Low confidence");
  if (actual.extractionStatus !== "COMPLETE") flags.push("Incomplete");
  if (!actual.speechAct || actual.speechAct === "AMBIGUOUS") flags.push("Direction review");
  if (actual.decisionDiagnostics?.severity === "CRITICAL") flags.push("CRITICAL SAFETY");
  else if (actual.decisionDiagnostics?.severity === "HIGH") flags.push("High-risk review");
  if (actual.decisionDiagnostics?.reasonCodes?.length) flags.push(...actual.decisionDiagnostics.reasonCodes.slice(0, 2));
  if (["CANCELLATION_REQUEST", "RESCHEDULE_REQUEST", "PAYMENT_ISSUE", "REFUND_REQUEST"].includes(String(actual.primaryCategory))) flags.push("Sensitive");
  return flags.length ? flags : ["No flags"];
}

function flagStyle(flag: string) {
  if (flag === "No flags") return { background: "#edfbf3", color: "#197447", border: "1px solid #b7e5cf" };
  if (flag === "Not run") return { background: "#f4f6fb", color: COLORS.muted, border: `1px solid ${COLORS.border}` };
  return { background: "#fff5e8", color: "#9b6d4b", border: "1px solid #f0dfcc" };
}

export default function MadisonGoldenTest() {
  const { data: cases = [], isLoading } = trpc.madison.getGoldenTestCases.useQuery(undefined, { staleTime: 15_000 });
  const [caseIndex, setCaseIndex] = useState(0);
  const [actualByCase, setActualByCase] = useState<Record<string, any>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = window.localStorage.getItem("madison-golden-batch-results-v1");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState<"development" | "held_out">("development");
  const [runError, setRunError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"classification" | "approval" | "batch" | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number; running: boolean } | null>(null);
  const utils = trpc.useUtils();
  const runCase = trpc.madison.runGoldenTestCase.useMutation();
  const saveRating = trpc.madison.saveGoldenTestRating.useMutation({
    onSuccess: result => {
      setRunError(null);
      setErrorKind(null);
      setSaveMessage(result.rating === "correct" ? "Approved and saved." : result.rating === "incorrect" ? "Denied and saved." : "Marked uncertain and saved.");
      setNotes("");
      setCaseIndex(index => Math.min(visibleCases.length - 1, index + 1));
      void utils.madison.getGoldenTestCases.invalidate();
    },
    onError: error => { setErrorKind("approval"); setRunError(error.message); },
  });
  const visibleCases = useMemo(() => cases.filter(item => item.split === filter), [cases, filter]);
  const current = visibleCases[caseIndex];
  const actual = current ? actualByCase[current.caseId] ?? current.review?.actualPrediction : null;
  const reviewedCount = visibleCases.filter(item => item.review?.rating && item.review.rating !== "uncertain").length;
  const runCount = visibleCases.filter(item => actualByCase[item.caseId] || item.review?.actualPrediction).length;
  const score = current && actual ? qualityScore(actual, current.currentInboundMessage) : null;

  useEffect(() => {
    window.localStorage.setItem("madison-golden-batch-results-v1", JSON.stringify(actualByCase));
  }, [actualByCase]);

  const runOne = async (caseId: string) => {
    const result = await runCase.mutateAsync({ caseId });
    setActualByCase(previous => ({ ...previous, [result.caseId]: result.actual }));
    return result;
  };

  const runAllDevelopment = async (force = false) => {
    const pending = cases.filter(item => item.split === "development" && (force || (!actualByCase[item.caseId] && !item.review?.actualPrediction)));
    if (!pending.length) { setSaveMessage("All development cases already have a classification. Review the queue below, or use Re-run all 40 to refresh them."); return; }
    setRunError(null); setErrorKind(null); setSaveMessage(null); setBatchProgress({ completed: 0, total: pending.length, running: true });
    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length) {
        const item = pending[cursor++];
        try { await runOne(item.caseId); }
        catch (error) { setErrorKind("batch"); setRunError(error instanceof Error ? error.message : String(error)); }
        setBatchProgress(progress => progress ? { ...progress, completed: progress.completed + 1 } : progress);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker()));
    setBatchProgress(progress => progress ? { ...progress, running: false } : progress);
    setSaveMessage(`${force ? "Finished re-running" : "Finished classifying"} ${pending.length} development cases. Review flagged cases first.`);
  };

  const selectFilter = (next: "development" | "held_out") => { setFilter(next); setCaseIndex(0); setNotes(""); setRunError(null); setErrorKind(null); setSaveMessage(null); };
  const go = (delta: number) => { setCaseIndex(index => Math.max(0, Math.min(visibleCases.length - 1, index + delta))); setNotes(""); setRunError(null); setErrorKind(null); setSaveMessage(null); };
  const rate = (rating: Rating) => { if (!current || !actual) return; saveRating.mutate({ caseId: current.caseId, rating, notes: notes.trim() || null, actualPrediction: actual }); };

  const exportResults = () => {
    const results = cases.filter(item => item.split === "development").map(item => {
      const prediction = actualByCase[item.caseId] ?? item.review?.actualPrediction ?? null;
      return {
        caseId: item.caseId,
        split: item.split,
        currentInboundMessage: item.currentInboundMessage,
        priorConversationContext: item.priorConversationContext,
        prediction,
        qualityScore: prediction ? qualityScore(prediction, item.currentInboundMessage) : null,
        flags: issueFlags(prediction, item.currentInboundMessage),
        review: item.review ? {
          rating: item.review.rating,
          notes: item.review.notes,
          reviewedAt: item.review.reviewedAt,
        } : null,
      };
    });
    const payload = {
      format: "madison-golden-test-export-v1",
      exportedAt: new Date().toISOString(),
      modelPath: "existing Madison GPT-4o Shadow classifier",
      readOnlyClassification: true,
      sideEffects: "No SMS, booking mutations, approvals, or fact-event writes",
      counts: {
        totalDevelopmentCases: results.length,
        classified: results.filter(item => item.prediction !== null).length,
        unclassified: results.filter(item => item.prediction === null).length,
      },
      results,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `madison-golden-test-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSaveMessage(`Exported ${payload.counts.classified} classified cases as JSON.`);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
      if (event.key.toLowerCase() === "a" && actual && !saveRating.isPending && filter === "development") rate("correct");
      if (event.key.toLowerCase() === "d" && actual && !saveRating.isPending && filter === "development") rate("incorrect");
      if (event.key.toLowerCase() === "u" && actual && !saveRating.isPending && filter === "development") rate("uncertain");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "Inter, Arial, sans-serif", color: COLORS.ink }}>
    <AdminHeader activeTab="madison-focus" />
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "34px 24px 70px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, marginBottom: 22, flexWrap: "wrap" }}>
        <div><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: COLORS.purple }}>MADISON · REVIEW TOOLS</div><h1 style={{ font: "700 34px Georgia, serif", margin: "8px 0 7px" }}>AI Golden Test</h1><p style={{ margin: 0, color: COLORS.muted, fontSize: 15 }}>Classify the development set in one batch, then review the flagged cases. Raw JSON stays behind details.</p></div>
        <div style={{ padding: "12px 15px", background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 14, fontSize: 13, fontWeight: 700 }}>{reviewedCount} of {visibleCases.length} reviewed · {runCount} classified</div>
      </div>

      <section style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 16, marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div><strong style={{ display: "block", fontSize: 16 }}>Batch classification</strong><span style={{ color: COLORS.muted, fontSize: 13 }}>Uses the existing read-only GPT-4o Shadow path. Results recover from this browser and can be exported for full review.</span>{batchProgress && <div style={{ marginTop: 9, color: batchProgress.running ? COLORS.purple : "#197447", fontWeight: 800, fontSize: 13 }}>{batchProgress.running ? `Classifying ${batchProgress.completed} of ${batchProgress.total}…` : `Completed ${batchProgress.completed} of ${batchProgress.total}`}</div>}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" onClick={exportResults} disabled={runCount === 0} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "12px 16px", background: runCount === 0 ? "#f1f2f6" : "#fff", color: runCount === 0 ? "#a3a6b2" : COLORS.purple, fontWeight: 800, cursor: "pointer" }}><Download size={15} />Export JSON</button><button type="button" onClick={() => void runAllDevelopment()} disabled={Boolean(batchProgress?.running) || filter === "held_out"} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "none", borderRadius: 10, padding: "12px 16px", background: filter === "held_out" ? "#e5e7eb" : COLORS.purple, color: "#fff", fontWeight: 800, cursor: "pointer" }}><Play size={15} />{batchProgress?.running ? "Running…" : "Run remaining"}</button><button type="button" onClick={() => void runAllDevelopment(true)} disabled={Boolean(batchProgress?.running) || filter === "held_out"} style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1px solid ${COLORS.purple}`, borderRadius: 10, padding: "12px 16px", background: filter === "held_out" ? "#f1f2f6" : "#fff", color: filter === "held_out" ? "#a3a6b2" : COLORS.purple, fontWeight: 800, cursor: "pointer" }}><RotateCcw size={15} />Re-run all 40</button></div>
      </section>

      <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>{(["development", "held_out"] as const).map(item => <button key={item} type="button" onClick={() => selectFilter(item)} style={{ border: `1px solid ${filter === item ? COLORS.purple : COLORS.border}`, background: filter === item ? "#eeeaff" : "#fff", color: filter === item ? COLORS.purple : COLORS.muted, borderRadius: 999, padding: "9px 15px", fontWeight: 800, cursor: "pointer" }}>{item === "development" ? "Development · 40" : "Held-out · 10"}{item === "held_out" && <Lock size={13} style={{ marginLeft: 6, verticalAlign: -2 }} />}</button>)}</div>

      {isLoading ? <div style={{ background: "#fff", borderRadius: 20, padding: 36 }}>Loading Golden Test cases…</div> : !current ? <div style={{ background: "#fff", borderRadius: 20, padding: 36 }}>No cases are available.</div> : <>
        <section style={{ display: "grid", gridTemplateColumns: "minmax(300px, .9fr) minmax(0, 1.6fr)", gap: 18, alignItems: "start" }}>
          <div style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 16, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`, fontWeight: 800 }}>Review queue</div>
            <div style={{ maxHeight: 680, overflowY: "auto" }}>{visibleCases.map((item, index) => { const itemActual = actualByCase[item.caseId] ?? item.review?.actualPrediction; const flags = issueFlags(itemActual, item.currentInboundMessage); const reviewed = item.review?.rating && item.review.rating !== "uncertain"; return <button key={item.caseId} type="button" onClick={() => { setCaseIndex(index); setRunError(null); setSaveMessage(null); }} style={{ width: "100%", textAlign: "left", border: 0, borderBottom: `1px solid ${COLORS.border}`, background: index === caseIndex ? "#f1efff" : "#fff", padding: "12px 14px", cursor: "pointer" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><strong style={{ fontSize: 13 }}>{item.caseId}</strong><span style={{ fontSize: 11, color: reviewed ? "#197447" : COLORS.muted }}>{reviewed ? "reviewed" : itemActual ? "ready" : "not run"}</span></div><div style={{ marginTop: 5, fontSize: 13, lineHeight: 1.35, color: COLORS.ink }}>{item.currentInboundMessage}</div><div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>{flags.slice(0, 3).map(flag => <span key={flag} style={{ ...flagStyle(flag), borderRadius: 999, padding: "3px 7px", fontSize: 10, fontWeight: 800 }}>{flag}</span>)}</div></button>; })}</div>
          </div>

          <div style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 18, boxShadow: "0 12px 34px rgba(35,27,77,.07)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}><strong>{current.caseId}</strong><span style={{ color: COLORS.muted, fontSize: 13 }}>{caseIndex + 1} of {visibleCases.length}</span></div>
            <div style={{ padding: 20, display: "grid", gap: 15 }}>
              <section style={{ background: "#fffaf4", border: "1px solid #f0dfcc", borderRadius: 14, padding: 15 }}><span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: "#9b6d4b" }}>CURRENT INBOUND MESSAGE</span><p style={{ fontSize: 19, lineHeight: 1.4, margin: "8px 0 0", fontWeight: 700 }}>{current.currentInboundMessage}</p></section>
              <details><summary style={{ cursor: "pointer", fontWeight: 800, color: COLORS.purple }}>Show bounded prior context ({current.priorConversationContext.length} messages)</summary><div style={{ marginTop: 10, display: "grid", gap: 7 }}>{current.priorConversationContext.map((message, index) => <div key={index} style={{ padding: "9px 11px", borderRadius: 9, background: message.role === "assistant" ? "#f3f0ff" : "#f4f6fb", fontSize: 13 }}><b>{message.role === "assistant" ? "Madison" : "Customer"}:</b> {message.content}</div>)}</div></details>
              <section style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 15 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}><div><div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: COLORS.muted }}>SHADOW UNDERSTANDING · GPT-4O</div><div style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>Read-only classifier output.</div></div><button type="button" onClick={() => void runOne(current.caseId).catch(error => { setErrorKind("classification"); setRunError(error instanceof Error ? error.message : String(error)); })} disabled={runCase.isPending || batchProgress?.running || filter === "held_out"} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "none", borderRadius: 10, padding: "9px 13px", background: filter === "held_out" ? "#e5e7eb" : COLORS.purple, color: "#fff", fontWeight: 800 }}><Play size={14} />{runCase.isPending ? "Running…" : actual ? "Run again" : "Run classification"}</button></div>{filter === "held_out" ? <div style={{ color: COLORS.muted }}><Lock size={15} /> Held-out cases are locked while development review is in progress.</div> : actual ? <details><summary style={{ cursor: "pointer", color: COLORS.purple, fontWeight: 800 }}>View raw structured result</summary><div style={{ marginTop: 10 }}><PrettyValue value={actual} /></div></details> : <div style={{ color: COLORS.muted }}>Run the batch or classify this case individually.</div>}{runError && <div role="alert" style={{ marginTop: 11, padding: "10px 11px", borderRadius: 10, background: "#fff3f3", border: "1px solid #f2caca", color: "#9e3030", display: "flex", gap: 8, fontSize: 13 }}><AlertCircle size={16} /><span><b>{errorKind === "approval" ? "Save failed:" : errorKind === "batch" ? "Batch item failed:" : "Classification failed:"}</b> {runError}</span></div>}{saveMessage && <div role="status" style={{ marginTop: 11, padding: "10px 11px", borderRadius: 10, background: "#edfbf3", border: "1px solid #b7e5cf", color: "#197447", fontSize: 13, fontWeight: 700 }}>{saveMessage}</div>}</section>
              {score && <section style={{ border: `1px solid ${COLORS.border}`, borderRadius: 13, padding: 14, background: "#fbfbff" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><div><div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: COLORS.purple }}>QUALITY SIGNALS</div><div style={{ color: COLORS.muted, fontSize: 12, marginTop: 3 }}>Review flags are not ground-truth accuracy.</div></div><strong style={{ font: "700 28px Georgia, serif", color: score.score >= 75 ? "#197447" : score.score >= 50 ? "#9b6d4b" : "#a53b3b" }}>{score.score}/100</strong></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{issueFlags(actual, current.currentInboundMessage).map(flag => <span key={flag} style={{ ...flagStyle(flag), borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 800 }}>{flag}</span>)}</div></section>}
              <section><label style={{ display: "block", fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: COLORS.muted, marginBottom: 6 }}>REVIEW NOTE (OPTIONAL)</label><textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} placeholder="Optional reason for your verdict" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 10, font: "inherit", resize: "vertical" }} /></section>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><button type="button" onClick={() => rate("correct")} disabled={!actual || saveRating.isPending || batchProgress?.running || filter === "held_out"} style={{ display: "inline-flex", gap: 7, alignItems: "center", padding: "11px 15px", borderRadius: 10, border: "1px solid #b7e5cf", background: "#edfbf3", color: "#197447", fontWeight: 800 }}><Check size={15} /> Approve <span style={{ fontSize: 11 }}>(A)</span></button><button type="button" onClick={() => rate("incorrect")} disabled={!actual || saveRating.isPending || batchProgress?.running || filter === "held_out"} style={{ display: "inline-flex", gap: 7, alignItems: "center", padding: "11px 15px", borderRadius: 10, border: "1px solid #f2caca", background: "#fff3f3", color: "#a53b3b", fontWeight: 800 }}><X size={15} /> Deny <span style={{ fontSize: 11 }}>(D)</span></button><button type="button" onClick={() => rate("uncertain")} disabled={!actual || saveRating.isPending || batchProgress?.running || filter === "held_out"} style={{ padding: "11px 15px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "#fff", color: COLORS.muted, fontWeight: 800 }}>Uncertain <span style={{ fontSize: 11 }}>(U)</span></button></div>
            </div>
            <div style={{ padding: "14px 20px", borderTop: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between" }}><button type="button" onClick={() => go(-1)} disabled={caseIndex === 0} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: `1px solid ${COLORS.border}`, borderRadius: 10, background: "#fff", padding: "9px 12px", fontWeight: 700, color: COLORS.muted }}><ChevronLeft size={15} /> Previous</button><span style={{ color: COLORS.muted, fontSize: 12, alignSelf: "center" }}>A approve · D deny · U uncertain · arrows navigate</span><button type="button" onClick={() => go(1)} disabled={caseIndex === visibleCases.length - 1} style={{ display: "inline-flex", gap: 6, alignItems: "center", border: `1px solid ${COLORS.border}`, borderRadius: 10, background: "#fff", padding: "9px 12px", fontWeight: 700, color: COLORS.muted }}>Next <ChevronRight size={15} /></button></div>
          </div>
        </section>
      </>}
    </div>
  </div>;
}
