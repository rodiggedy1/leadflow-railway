/**
 * MadisonDebrief — review Madison's interactions for any given day.
 * Renders the exact same MadisonSmsDraftCard / MadisonCallSummaryCard
 * components used in Command Chat — no custom card logic here.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { MadisonSmsDraftCard, MadisonCallSummaryCard } from "@/components/CommandChat";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLocation } from "wouter";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MADISON_PHOTO =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-v3-Ky5x7Vzm5HBzWn6As5hsPv.webp";

/** Returns today's date as YYYY-MM-DD in the *local* timezone. */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(dateStr: string): string {
  // Parse as local date (append T12:00 so no UTC-shift on any timezone)
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

  const callCards = useMemo(() => cards.filter(c => c.quickAction === "madison_call_summary"), [cards]);
  const smsCards = useMemo(() => cards.filter(c => c.quickAction === "madison_sms_draft"), [cards]);

  const startReview = () => {
    if (cards.length === 0) return;
    setCardIndex(0);
    setView("review");
  };

  const goNext = () => {
    if (cardIndex < cards.length - 1) {
      setCardIndex(i => i + 1);
    } else {
      setView("done");
    }
  };

  const goPrev = () => {
    if (cardIndex > 0) setCardIndex(i => i - 1);
  };

  const exitReview = () => {
    setView("hero");
    setCardIndex(0);
  };

  const currentCard = cards[cardIndex];
  const progress = cards.length > 0 ? ((cardIndex + 1) / cards.length) * 100 : 0;

  // ── Hero ──────────────────────────────────────────────────────────────────

  if (view === "hero") {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f6fb", fontFamily: "Inter, Arial, sans-serif" }}>
        <AdminHeader activeTab="madison-debrief" />
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px" }}>
          <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 24, boxShadow: "0 20px 60px rgba(0,0,0,.08)", overflow: "hidden" }}>
            {/* Gradient hero */}
            <div style={{ padding: "32px 32px 28px", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                <img src={MADISON_PHOTO} alt="Madison" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,0.4)" }} />
                <div>
                  <div style={{ font: "700 26px Georgia, serif", lineHeight: 1 }}>Daily Debrief ✦</div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginTop: 3 }}>Madison's interaction history</div>
                </div>
              </div>

              {/* Date picker */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <label style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>Reviewing:</label>
                <input
                  type="date"
                  value={selectedDate}
                  max={todayLocal()}
                  onChange={e => { setSelectedDate(e.target.value); setView("hero"); setCardIndex(0); }}
                  style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 10, padding: "6px 12px", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", outline: "none" }}
                />
              </div>

              {isLoading ? (
                <div style={{ fontSize: 16, opacity: 0.8 }}>Loading…</div>
              ) : cards.length === 0 ? (
                <div style={{ fontSize: 18, lineHeight: 1.6 }}>
                  No interactions recorded for <b>{fmtDate(selectedDate)}</b>.
                </div>
              ) : (
                <div style={{ fontSize: 18, lineHeight: 1.6 }}>
                  On <b>{fmtDate(selectedDate)}</b>, I handled{" "}
                  <b>{cards.length} interaction{cards.length !== 1 ? "s" : ""}</b>
                  {callCards.length > 0 && smsCards.length > 0
                    ? ` — ${callCards.length} call${callCards.length !== 1 ? "s" : ""} and ${smsCards.length} SMS draft${smsCards.length !== 1 ? "s" : ""}.`
                    : callCards.length > 0
                    ? ` — ${callCards.length} inbound call${callCards.length !== 1 ? "s" : ""}.`
                    : ` — ${smsCards.length} SMS draft${smsCards.length !== 1 ? "s" : ""}.`}
                </div>
              )}
            </div>

            {/* Stats row */}
            {!isLoading && cards.length > 0 && (
              <div style={{ display: "flex", borderBottom: "1px solid #f0eeff" }}>
                <div style={{ flex: 1, padding: "18px 24px", borderRight: "1px solid #f0eeff" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#5d49f3" }}>{callCards.length}</div>
                  <div style={{ fontSize: 12, color: "#7a8092", fontWeight: 600, marginTop: 2 }}>Inbound Calls</div>
                </div>
                <div style={{ flex: 1, padding: "18px 24px" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#5d49f3" }}>{smsCards.length}</div>
                  <div style={{ fontSize: 12, color: "#7a8092", fontWeight: 600, marginTop: 2 }}>SMS Drafts</div>
                </div>
              </div>
            )}

            {/* CTA */}
            {!isLoading && cards.length > 0 && (
              <div style={{ padding: "20px 24px" }}>
                <button
                  onClick={startReview}
                  style={{ width: "100%", padding: "15px 0", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff", border: "none", borderRadius: 14, fontWeight: 700, fontSize: 16, cursor: "pointer" }}
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
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px" }}>
          <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 24, boxShadow: "0 20px 60px rgba(0,0,0,.08)", padding: "60px 40px", textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <div style={{ font: "700 26px Georgia, serif", color: "#1a1a2e", marginBottom: 10 }}>You're all caught up</div>
            <div style={{ fontSize: 16, color: "#6b7280", marginBottom: 28 }}>
              That's all {cards.length} interaction{cards.length !== 1 ? "s" : ""} for {fmtDate(selectedDate)}.
            </div>
            <button
              onClick={exitReview}
              style={{ padding: "12px 28px", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff", border: "none", borderRadius: 14, fontWeight: 700, fontSize: 15, cursor: "pointer" }}
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

  // Build a msg object that matches what the card components expect
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
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px" }}>
        {/* Top bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <button onClick={exitReview} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
            <X style={{ width: 14, height: 14 }} /> Exit
          </button>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{cardIndex + 1} of {cards.length}</span>
          <span style={{ fontSize: 12, color: "#9ca3af" }}>{fmtDate(selectedDate)}</span>
        </div>

        {/* Progress bar */}
        <div style={{ height: 6, background: "#ececf8", borderRadius: 999, marginBottom: 20, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #5d49f3, #7a63ff)", borderRadius: 999, transition: "width 0.3s ease" }} />
        </div>

        {/* The actual card — same component as Command Chat */}
        {currentCard.quickAction === "madison_sms_draft" ? (
          <MadisonSmsDraftCard
            msg={msgObj}
            callerName=""
          />
        ) : (
          <MadisonCallSummaryCard
            msg={msgObj}
            onCallBack={(name, phone) => {
              window.open(`tel:${phone}`, "_self");
            }}
            onTextBack={(name, phone) => {
              navigate(`/admin/leads?tab=callbacks&phone=${encodeURIComponent(phone)}`);
            }}
          />
        )}

        {/* Navigation */}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            onClick={goPrev}
            disabled={cardIndex === 0}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 18px", borderRadius: 12, border: "1px solid #ddd5ff", background: "#fff", color: cardIndex === 0 ? "#d1d5db" : "#5d49f3", fontWeight: 700, fontSize: 14, cursor: cardIndex === 0 ? "not-allowed" : "pointer" }}
          >
            <ChevronLeft style={{ width: 16, height: 16 }} /> Prev
          </button>
          <button
            onClick={goNext}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 18px", borderRadius: 12, border: "none", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
          >
            {cardIndex < cards.length - 1 ? (
              <><ChevronRight style={{ width: 16, height: 16 }} /> Next</>
            ) : (
              <>Done ✓</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
