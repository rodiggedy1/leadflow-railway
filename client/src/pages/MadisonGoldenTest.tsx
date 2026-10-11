import { useMemo, useState } from "react";
import AdminHeader from "@/components/AdminHeader";
import { trpc } from "@/lib/trpc";
import { Check, ChevronLeft, ChevronRight, Lock, Play, Save, X } from "lucide-react";

type Rating = "correct" | "incorrect" | "uncertain";

const COLORS = { purple: "#5d49f3", ink: "#1a1a2e", muted: "#73788c", border: "#e8e8f6", bg: "#f4f6fb" };

function PrettyValue({ value }: { value: unknown }) {
  return <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace", color: "#4c465e" }}>{JSON.stringify(value, null, 2)}</pre>;
}

export default function MadisonGoldenTest() {
  const { data: cases = [], isLoading } = trpc.madison.getGoldenTestCases.useQuery(undefined, { staleTime: 15_000 });
  const [caseIndex, setCaseIndex] = useState(0);
  const [actualByCase, setActualByCase] = useState<Record<string, any>>({});
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState<"development" | "held_out">("development");
  const runCase = trpc.madison.runGoldenTestCase.useMutation({
    onSuccess: result => setActualByCase(previous => ({ ...previous, [result.caseId]: result.actual })),
  });
  const saveRating = trpc.madison.saveGoldenTestRating.useMutation({
    onSuccess: () => void utils.madison.getGoldenTestCases.invalidate(),
  });
  const utils = trpc.useUtils();
  const visibleCases = useMemo(() => cases.filter(item => item.split === filter), [cases, filter]);
  const current = visibleCases[caseIndex];
  const actual = current ? actualByCase[current.caseId] ?? current.review?.actualPrediction : null;
  const reviewedCount = visibleCases.filter(item => item.review?.rating).length;

  const selectFilter = (next: "development" | "held_out") => {
    setFilter(next);
    setCaseIndex(0);
    setNotes("");
  };
  const go = (delta: number) => {
    setCaseIndex(index => Math.max(0, Math.min(visibleCases.length - 1, index + delta)));
    setNotes("");
  };
  const rate = (rating: Rating) => {
    if (!current || !actual) return;
    saveRating.mutate({ caseId: current.caseId, rating, notes: notes.trim() || null, actualPrediction: actual });
  };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "Inter, Arial, sans-serif", color: COLORS.ink }}>
      <AdminHeader activeTab="madison-focus" />
      <div style={{ maxWidth: 1020, margin: "0 auto", padding: "34px 24px 70px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, marginBottom: 22, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: COLORS.purple }}>MADISON · REVIEW TOOLS</div>
            <h1 style={{ font: "700 34px Georgia, serif", margin: "8px 0 7px" }}>AI Golden Test</h1>
            <p style={{ margin: 0, color: COLORS.muted, fontSize: 15 }}>Review how Shadow Understanding classifies real anonymized message scenarios. This page cannot send SMS or change bookings.</p>
          </div>
          <div style={{ padding: "12px 15px", background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 14, fontSize: 13, fontWeight: 700 }}>
            {reviewedCount} of {visibleCases.length} reviewed
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {(["development", "held_out"] as const).map(item => (
            <button key={item} type="button" onClick={() => selectFilter(item)} style={{ border: `1px solid ${filter === item ? COLORS.purple : COLORS.border}`, background: filter === item ? "#eeeaff" : "#fff", color: filter === item ? COLORS.purple : COLORS.muted, borderRadius: 999, padding: "9px 15px", fontWeight: 800, cursor: "pointer" }}>
              {item === "development" ? "Development · 40" : "Held-out · 10"}{item === "held_out" && <Lock size={13} style={{ marginLeft: 6, verticalAlign: -2 }} />}
            </button>
          ))}
        </div>

        {isLoading ? <div style={{ background: "#fff", borderRadius: 20, padding: 36 }}>Loading Golden Test cases…</div> : !current ? <div style={{ background: "#fff", borderRadius: 20, padding: 36 }}>No cases are available.</div> : (
          <div style={{ background: "#fff", border: `1px solid ${COLORS.border}`, borderRadius: 22, boxShadow: "0 12px 34px rgba(35,27,77,.07)", overflow: "hidden" }}>
            <div style={{ padding: "18px 22px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>{current.caseId}</strong><span style={{ color: COLORS.muted, fontSize: 13 }}>{caseIndex + 1} of {visibleCases.length}</span>
            </div>
            <div style={{ padding: 22, display: "grid", gap: 16 }}>
              <section style={{ background: "#fffaf4", border: "1px solid #f0dfcc", borderRadius: 14, padding: 16 }}><span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: "#9b6d4b" }}>CURRENT INBOUND MESSAGE</span><p style={{ fontSize: 21, lineHeight: 1.4, margin: "8px 0 0", fontWeight: 700 }}>{current.currentInboundMessage}</p></section>
              <details><summary style={{ cursor: "pointer", fontWeight: 800, color: COLORS.purple }}>Show bounded prior context ({current.priorConversationContext.length} messages)</summary><div style={{ marginTop: 10, display: "grid", gap: 7 }}>{current.priorConversationContext.map((message, index) => <div key={index} style={{ padding: "9px 11px", borderRadius: 9, background: message.role === "assistant" ? "#f3f0ff" : "#f4f6fb", fontSize: 13 }}><b>{message.role === "assistant" ? "Madison" : "Customer"}:</b> {message.content}</div>)}</div></details>
              <section style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 16 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: COLORS.muted }}>SHADOW UNDERSTANDING · GPT-4O</span><button type="button" onClick={() => runCase.mutate({ caseId: current.caseId })} disabled={runCase.isPending || filter === "held_out"} style={{ display: "inline-flex", alignItems: "center", gap: 7, border: "none", borderRadius: 10, padding: "9px 13px", background: filter === "held_out" ? "#e5e7eb" : COLORS.purple, color: "#fff", fontWeight: 800, cursor: filter === "held_out" ? "not-allowed" : "pointer" }}><Play size={14} />{runCase.isPending ? "Running…" : actual ? "Run again" : "Run classification"}</button></div>{filter === "held_out" ? <div style={{ color: COLORS.muted, display: "flex", alignItems: "center", gap: 7 }}><Lock size={15} /> Held-out cases are locked while development labeling is in progress.</div> : actual ? <PrettyValue value={actual} /> : <div style={{ color: COLORS.muted }}>Run the existing read-only Shadow classifier to see the output.</div>}</section>
              <section><label style={{ display: "block", fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: COLORS.muted, marginBottom: 7 }}>REVIEW NOTE (OPTIONAL)</label><textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} placeholder="What was right or wrong? Note the exact field or evidence issue." style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 11, font: "inherit", resize: "vertical" }} /></section>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}><button type="button" onClick={() => rate("correct")} disabled={!actual || saveRating.isPending || filter === "held_out"} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 15px", borderRadius: 10, border: "1px solid #b7e5cf", background: "#edfbf3", color: "#197447", fontWeight: 800, cursor: !actual ? "not-allowed" : "pointer" }}><Check size={15} /> Correct</button><button type="button" onClick={() => rate("incorrect")} disabled={!actual || saveRating.isPending || filter === "held_out"} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "11px 15px", borderRadius: 10, border: "1px solid #f2caca", background: "#fff3f3", color: "#a53b3b", fontWeight: 800, cursor: !actual ? "not-allowed" : "pointer" }}><X size={15} /> Incorrect</button><button type="button" onClick={() => rate("uncertain")} disabled={!actual || saveRating.isPending || filter === "held_out"} style={{ padding: "11px 15px", borderRadius: 10, border: `1px solid ${COLORS.border}`, background: "#fff", color: COLORS.muted, fontWeight: 800, cursor: !actual ? "not-allowed" : "pointer" }}>Uncertain</button>{current.review?.rating && <span style={{ alignSelf: "center", color: COLORS.muted, fontSize: 13 }}>Saved as <b>{current.review.rating}</b>{current.review.reviewer ? ` by ${current.review.reviewer}` : ""}.</span>}</div>
            </div>
            <div style={{ padding: "15px 22px", borderTop: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", gap: 10 }}><button type="button" onClick={() => go(-1)} disabled={caseIndex === 0} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${COLORS.border}`, borderRadius: 10, background: "#fff", padding: "10px 13px", fontWeight: 700, color: COLORS.muted }}><ChevronLeft size={15} /> Previous</button><button type="button" onClick={() => go(1)} disabled={caseIndex === visibleCases.length - 1} style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${COLORS.border}`, borderRadius: 10, background: "#fff", padding: "10px 13px", fontWeight: 700, color: COLORS.muted }}>Next <ChevronRight size={15} /></button></div>
          </div>
        )}
      </div>
    </div>
  );
}
