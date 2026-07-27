/**
 * MadisonDebrief — review Madison's interactions for any given day.
 *
 * Layout:
 *   - Hero card: date picker + summary count → "Start Review"
 *   - Card-swipe view: one card at a time, progress bar, ← / → navigation
 *   - Done screen: "You're all caught up"
 *
 * Card types rendered:
 *   - madison_call_summary  → inbound call handled by Madison
 *   - madison_sms_draft     → SMS draft Madison prepared
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { ChevronLeft, ChevronRight, Phone, MessageSquare, X } from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

const MADISON_PHOTO =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-v3-Ky5x7Vzm5HBzWn6As5hsPv.webp";

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface DebriefCard {
  id: number;
  ts: number;
  quickAction: string | null;
  body: string;
  metadata: string | null;
  mediaUrl: string | null;
}

// ── Call card renderer ────────────────────────────────────────────────────────

function CallCard({ card, index, total }: { card: DebriefCard; index: number; total: number }) {
  const [showTranscript, setShowTranscript] = useState(false);
  let meta: {
    callerPhone?: string | null;
    callerName?: string | null;
    durationDisplay?: string;
    outcome?: string;
    intentSummary?: string;
    transcript?: string | null;
    recordingUrl?: string | null;
    actedBy?: string | null;
    actedAction?: string | null;
  } = {};
  try { meta = JSON.parse(card.metadata ?? "{}"); } catch { /* ignore */ }

  const displayName = meta.callerName ?? meta.callerPhone ?? "Unknown caller";
  const outcomeBadge = (() => {
    if (meta.outcome === "booked") return { label: "Booked ✔", bg: "#eef8f2", color: "#157c5a" };
    if (meta.outcome === "quote_given") return { label: "Quote given", bg: "#eff6ff", color: "#1d4ed8" };
    if (meta.outcome === "callback_requested") return { label: "Callback", bg: "#fef3c7", color: "#92400e" };
    if (meta.outcome === "faq_answered") return { label: "FAQ answered", bg: "#f0fdf4", color: "#166534" };
    return { label: "Call complete", bg: "#f0fdf4", color: "#166534" };
  })();

  const recordingUrl = meta.recordingUrl ?? card.mediaUrl ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Card type label */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
        <Phone style={{ width: 14, height: 14, color: "#6d5cff" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#6d5cff", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Inbound Call · {index + 1} of {total}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>{fmtTime(card.ts)}</span>
      </div>

      {/* Caller row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafaff", border: "1px solid #ebe8fb", borderRadius: 18, padding: "16px 18px", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#6d5cff", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 20, flexShrink: 0 }}>
            {(meta.callerName ?? "?")[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }}>{displayName}</div>
            {meta.callerPhone && (
              <div style={{ fontSize: 13, color: "#6d5cff", fontWeight: 600, marginTop: 2 }}>{fmtPhone(meta.callerPhone)}</div>
            )}
            {meta.durationDisplay && (
              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>{meta.durationDisplay}</div>
            )}
          </div>
        </div>
        <div style={{ background: outcomeBadge.bg, color: outcomeBadge.color, fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap" }}>
          {outcomeBadge.label}
        </div>
      </div>

      {/* Summary */}
      <div style={{ fontSize: 16, lineHeight: 1.55, color: "#222", marginBottom: 18 }}>
        {meta.intentSummary ?? "Called but left no details."}
      </div>

      {/* Transcript toggle */}
      {(meta.transcript || recordingUrl) && (
        <div>
          <button
            onClick={() => setShowTranscript(v => !v)}
            style={{ fontSize: 13, color: "#6d5cff", fontWeight: 700, background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: showTranscript ? 10 : 0 }}
          >
            {showTranscript ? "Hide transcript ↑" : "View transcript →"}
          </button>
          {showTranscript && (
            <div style={{ background: "#f8f7ff", borderRadius: 14, padding: "14px 16px" }}>
              {recordingUrl && (
                <audio controls src={recordingUrl} style={{ width: "100%", height: 36, marginBottom: 10, borderRadius: 8 }} />
              )}
              {meta.transcript && (
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.6, maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", background: "#fff", borderRadius: 10, padding: "10px 12px", border: "1px solid #e5e7eb" }}>
                  {meta.transcript}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Acted indicator */}
      {meta.actedBy && (
        <div style={{ marginTop: 14, fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>
          {meta.actedAction === "call" ? "📞 Called back" : meta.actedAction === "text" ? "💬 Texted back" : "✕ Dismissed"} by {meta.actedBy}
        </div>
      )}
    </div>
  );
}

// ── SMS card renderer ─────────────────────────────────────────────────────────

function SmsCard({ card, index, total }: { card: DebriefCard; index: number; total: number }) {
  let meta: {
    senderName?: string | null;
    fromPhone?: string | null;
    draftText?: string | null;
    status?: string | null;
    sentBy?: string | null;
    dismissedBy?: string | null;
  } = {};
  try { meta = JSON.parse(card.metadata ?? "{}"); } catch { /* ignore */ }

  // Parse body: first line is the customer message, rest is the draft
  const lines = card.body.split("\n").filter(Boolean);
  const customerMsg = lines[0] ?? "";
  const draftText = meta.draftText ?? lines.slice(1).join("\n") ?? "";

  const statusBadge = (() => {
    if (meta.status === "SENT" || meta.status === "DELIVERED") return { label: "Sent ✔", bg: "#eef8f2", color: "#157c5a" };
    if (meta.status === "DISMISSED") return { label: "Dismissed", bg: "#f3f4f6", color: "#6b7280" };
    if (meta.status === "DRAFT_READY") return { label: "Draft ready", bg: "#fef3c7", color: "#92400e" };
    return { label: meta.status ?? "Draft", bg: "#f8f7ff", color: "#6d5cff" };
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Card type label */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
        <MessageSquare style={{ width: 14, height: 14, color: "#6d5cff" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "#6d5cff", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          SMS Draft · {index + 1} of {total}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#9ca3af" }}>{fmtTime(card.ts)}</span>
      </div>

      {/* Sender row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fafaff", border: "1px solid #ebe8fb", borderRadius: 18, padding: "16px 18px", marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#6d5cff", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 20, flexShrink: 0 }}>
            {(meta.senderName ?? "?")[0]?.toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e" }}>{meta.senderName ?? "Unknown"}</div>
            {meta.fromPhone && (
              <div style={{ fontSize: 13, color: "#6d5cff", fontWeight: 600, marginTop: 2 }}>{fmtPhone(meta.fromPhone)}</div>
            )}
          </div>
        </div>
        <div style={{ background: statusBadge.bg, color: statusBadge.color, fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 20, whiteSpace: "nowrap" }}>
          {statusBadge.label}
        </div>
      </div>

      {/* Customer message */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8092", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
        Latest customer message
      </div>
      <div style={{ display: "inline-block", background: "#ece7ff", padding: "12px 16px", borderRadius: 16, fontSize: 16, lineHeight: 1.5, marginBottom: 18, maxWidth: "85%" }}>
        {customerMsg}
      </div>

      {/* Draft */}
      {draftText && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#7a8092", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Madison's draft reply
          </div>
          <div style={{ border: "1px solid #ddd5ff", borderRadius: 14, padding: "14px 16px", fontSize: 16, lineHeight: 1.5, color: "#222", marginBottom: 8 }}>
            {draftText}
          </div>
        </>
      )}

      {/* Acted indicator */}
      {(meta.sentBy || meta.dismissedBy) && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af", fontStyle: "italic" }}>
          {meta.sentBy ? `✔ Sent by ${meta.sentBy}` : `✕ Dismissed by ${meta.dismissedBy}`}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type ViewState = "hero" | "review" | "done";

export default function MadisonDebrief() {
  const todayStr = toDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [view, setView] = useState<ViewState>("hero");
  const [cardIndex, setCardIndex] = useState(0);

  const { data: cards = [], isLoading } = trpc.opsChat.getDebriefCards.useQuery(
    { date: selectedDate },
    { enabled: true, staleTime: 30_000 }
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
        <AdminHeader activeTab={undefined} />
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px" }}>
          <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 24, boxShadow: "0 20px 60px rgba(0,0,0,.08)", overflow: "hidden" }}>
            {/* Gradient hero */}
            <div style={{ padding: "32px 32px 28px", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
                <img src={MADISON_PHOTO} alt="Madison" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,0.4)" }} />
                <div>
                  <div style={{ font: "700 26px Georgia, serif", lineHeight: 1 }}>Morning Brief ✦</div>
                  <div style={{ fontSize: 13, opacity: 0.8, marginTop: 3 }}>Madison's daily debrief</div>
                </div>
              </div>

              {/* Date picker */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <label style={{ fontSize: 13, fontWeight: 600, opacity: 0.85 }}>Reviewing:</label>
                <input
                  type="date"
                  value={selectedDate}
                  max={todayStr}
                  onChange={e => { setSelectedDate(e.target.value); setView("hero"); }}
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
        <AdminHeader activeTab={undefined} />
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

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6fb", fontFamily: "Inter, Arial, sans-serif" }}>
      <AdminHeader activeTab={undefined} />
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 20px" }}>
        <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 24, boxShadow: "0 20px 60px rgba(0,0,0,.08)", overflow: "hidden" }}>
          {/* Top bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px 14px" }}>
            <button onClick={exitReview} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
              <X style={{ width: 14, height: 14 }} /> Exit
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{cardIndex + 1} of {cards.length}</span>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>{fmtDate(selectedDate)}</span>
          </div>

          {/* Progress bar */}
          <div style={{ height: 6, background: "#ececf8", margin: "0 24px 20px" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #5d49f3, #7a63ff)", borderRadius: 999, transition: "width 0.3s ease" }} />
          </div>

          {/* Card body */}
          <div style={{ padding: "0 24px 24px" }}>
            {currentCard.quickAction === "madison_call_summary" ? (
              <CallCard card={currentCard} index={cardIndex} total={cards.length} />
            ) : (
              <SmsCard card={currentCard} index={cardIndex} total={cards.length} />
            )}
          </div>

          {/* Navigation */}
          <div style={{ display: "flex", gap: 10, padding: "0 24px 24px" }}>
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
    </div>
  );
}
