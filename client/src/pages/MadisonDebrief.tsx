/**
 * MadisonDebrief — review Madison's interactions for any given day.
 * Renders the exact same MadisonSmsDraftCard / MadisonCallSummaryCard
 * components used in Command Chat — no custom card logic here.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { MadisonSmsDraftCard, MadisonCallSummaryCard } from "@/components/CommandChat";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLocation } from "wouter";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MADISON_PHOTO =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-v3-Ky5x7Vzm5HBzWn6As5hsPv.webp";

function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ViewState = "hero" | "review" | "done";

export default function MadisonDebrief() {
  const [selectedDate, setSelectedDate] = useState(todayLocal);
  const [view, setView] = useState<ViewState>("hero");
  const [cardIndex, setCardIndex] = useState(0);
  const [, navigate] = useLocation();

  const { data: cards = [], isLoading } = trpc.opsChat.getDebriefCards.useQuery(
    { date: selectedDate },
    { staleTime: 30_000 }
  );

  const callCount = cards.filter(c => c.quickAction === "madison_call_summary").length;
  const smsCount = cards.filter(c => c.quickAction === "madison_sms_draft").length;

  const startReview = () => {
    if (cards.length === 0) return;
    setCardIndex(0);
    setView("review");
  };

  const goNext = () => {
    if (cardIndex < cards.length - 1) setCardIndex(i => i + 1);
    else setView("done");
  };

  const goPrev = () => {
    if (cardIndex > 0) setCardIndex(i => i - 1);
  };

  const exitReview = () => { setView("hero"); setCardIndex(0); };

  const currentCard = cards[cardIndex];
  const progress = cards.length > 0 ? ((cardIndex + 1) / cards.length) * 100 : 0;

  // ── Hero ──────────────────────────────────────────────────────────────────
  if (view === "hero") {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f6fb", fontFamily: "Inter, Arial, sans-serif" }}>
        <AdminHeader activeTab="madison-debrief" />
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
          <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 28, boxShadow: "0 24px 64px rgba(0,0,0,.09)", overflow: "hidden" }}>
            {/* Hero gradient */}
            <div style={{ padding: "36px 36px 32px", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22 }}>
                <img src={MADISON_PHOTO} alt="Madison" style={{ width: 58, height: 58, borderRadius: "50%", objectFit: "cover", border: "2.5px solid rgba(255,255,255,0.45)", flexShrink: 0 }} />
                <div>
                  <div style={{ font: "700 28px Georgia, serif", lineHeight: 1 }}>Daily Debrief ✦</div>
                  <div style={{ fontSize: 14, opacity: 0.8, marginTop: 4 }}>Madison's interaction history</div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
                <label style={{ fontSize: 14, fontWeight: 600, opacity: 0.85, whiteSpace: "nowrap" }}>Reviewing:</label>
                <input
                  type="date"
                  value={selectedDate}
                  max={todayLocal()}
                  onChange={e => { setSelectedDate(e.target.value); setView("hero"); setCardIndex(0); }}
                  style={{ background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.35)", borderRadius: 11, padding: "8px 14px", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", outline: "none" }}
                />
              </div>

              {isLoading ? (
                <div style={{ fontSize: 17, opacity: 0.8 }}>Loading…</div>
              ) : cards.length === 0 ? (
                <div style={{ fontSize: 19, lineHeight: 1.6 }}>
                  No interactions recorded for <b>{fmtDate(selectedDate)}</b>.
                </div>
              ) : (
                <div style={{ fontSize: 19, lineHeight: 1.6 }}>
                  On <b>{fmtDate(selectedDate)}</b>, I handled{" "}
                  <b>{cards.length} interaction{cards.length !== 1 ? "s" : ""}</b>
                  {callCount > 0 && smsCount > 0
                    ? ` — ${callCount} call${callCount !== 1 ? "s" : ""} and ${smsCount} SMS draft${smsCount !== 1 ? "s" : ""}.`
                    : callCount > 0
                    ? ` — ${callCount} inbound call${callCount !== 1 ? "s" : ""}.`
                    : ` — ${smsCount} SMS draft${smsCount !== 1 ? "s" : ""}.`}
                </div>
              )}
            </div>

            {/* Stats */}
            {!isLoading && cards.length > 0 && (
              <div style={{ display: "flex", borderBottom: "1px solid #f0eeff" }}>
                <div style={{ flex: 1, padding: "22px 28px", borderRight: "1px solid #f0eeff" }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#5d49f3" }}>{callCount}</div>
                  <div style={{ fontSize: 13, color: "#7a8092", fontWeight: 600, marginTop: 3 }}>Inbound Calls</div>
                </div>
                <div style={{ flex: 1, padding: "22px 28px" }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#5d49f3" }}>{smsCount}</div>
                  <div style={{ fontSize: 13, color: "#7a8092", fontWeight: 600, marginTop: 3 }}>SMS Drafts</div>
                </div>
              </div>
            )}

            {!isLoading && cards.length > 0 && (
              <div style={{ padding: "24px 28px" }}>
                <button
                  onClick={startReview}
                  style={{ width: "100%", padding: "17px 0", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff", border: "none", borderRadius: 16, fontWeight: 700, fontSize: 17, cursor: "pointer" }}
                >
                  Start Review →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (view === "done") {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f6fb", fontFamily: "Inter, Arial, sans-serif" }}>
        <AdminHeader activeTab="madison-debrief" />
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
          <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 28, boxShadow: "0 24px 64px rgba(0,0,0,.09)", padding: "70px 48px", textAlign: "center" }}>
            <div style={{ fontSize: 52, marginBottom: 18 }}>✅</div>
            <div style={{ font: "700 28px Georgia, serif", color: "#1a1a2e", marginBottom: 12 }}>You're all caught up</div>
            <div style={{ fontSize: 17, color: "#6b7280", marginBottom: 32 }}>
              That's all {cards.length} interaction{cards.length !== 1 ? "s" : ""} for {fmtDate(selectedDate)}.
            </div>
            <button
              onClick={exitReview}
              style={{ padding: "14px 32px", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff", border: "none", borderRadius: 16, fontWeight: 700, fontSize: 16, cursor: "pointer" }}
            >
              ← Back to Brief
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Review ────────────────────────────────────────────────────────────────
  if (!currentCard) return null;

  const msgObj = {
    id: currentCard.id,
    body: currentCard.body,
    metadata: currentCard.metadata,
    mediaUrl: currentCard.mediaUrl,
    createdAt: new Date(currentCard.ts),
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6fb", fontFamily: "Inter, Arial, sans-serif" }}>
      <AdminHeader activeTab="madison-debrief" />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 48px" }}>

        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button onClick={exitReview} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 14, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
            <X style={{ width: 15, height: 15 }} /> Exit
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{cardIndex + 1} of {cards.length}</span>
          <span style={{ fontSize: 13, color: "#9ca3af" }}>{fmtDate(selectedDate)}</span>
        </div>

        {/* Progress bar */}
        <div style={{ height: 7, background: "#ececf8", borderRadius: 999, marginBottom: 24, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #5d49f3, #7a63ff)", borderRadius: 999, transition: "width 0.3s ease" }} />
        </div>

        {/* Card — full width, no extra wrapper shrinking it */}
        <div style={{ background: "#fff", borderRadius: 20, boxShadow: "0 8px 32px rgba(0,0,0,.07)", overflow: "hidden", marginBottom: 20 }}>
          {currentCard.quickAction === "madison_sms_draft" ? (
            <MadisonSmsDraftCard msg={msgObj} callerName="" />
          ) : (
            <MadisonCallSummaryCard
              msg={msgObj}
              onCallBack={(_name, phone) => { window.open(`tel:${phone}`, "_self"); }}
              onTextBack={(_name, phone) => { navigate(`/admin/leads?tab=callbacks&phone=${encodeURIComponent(phone)}`); }}
            />
          )}
        </div>

        {/* Navigation */}
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={goPrev}
            disabled={cardIndex === 0}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "14px 22px", borderRadius: 14, border: "1.5px solid #ddd5ff", background: "#fff", color: cardIndex === 0 ? "#d1d5db" : "#5d49f3", fontWeight: 700, fontSize: 15, cursor: cardIndex === 0 ? "not-allowed" : "pointer" }}
          >
            <ChevronLeft style={{ width: 17, height: 17 }} /> Prev
          </button>
          <button
            onClick={goNext}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "14px 22px", borderRadius: 14, border: "none", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
          >
            {cardIndex < cards.length - 1
              ? <><ChevronRight style={{ width: 17, height: 17 }} /> Next</>
              : <>Done ✓</>}
          </button>
        </div>
      </div>
    </div>
  );
}
