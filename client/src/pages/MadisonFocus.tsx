/**
 * MadisonFocus — Focus Mode
 * Card-by-card review of all undismissed Madison cards (SMS drafts, email drafts, call summaries).
 * Uses getFocusCards which shares the same unresolved predicate as getUnresolvedMadisonCount.
 *
 * Behaviour:
 * - Skip: frontend-only cursor advance, card stays in queue
 * - Send/Dismiss: card calls onActed → invalidates getFocusCards → queue refetches → index clamps
 * - Safe index: after refetch, clamps index to new queue length via useEffect
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, X, SkipForward } from "lucide-react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { MadisonSmsDraftCard, MadisonEmailDraftCard, MadisonCallSummaryCard } from "@/components/CommandChat";

const MADISON_PHOTO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-v3-Ky5x7Vzm5HBzWn6As5hsPv.webp";

type ViewState = "hero" | "review" | "done";

export default function MadisonFocus() {
  const [view, setView] = useState<ViewState>("hero");
  const [cardIndex, setCardIndex] = useState(0);
  const [, navigate] = useLocation();

  const utils = trpc.useUtils();
  const { data: cards = [], isLoading } = trpc.opsChat.getFocusCards.useQuery(
    undefined,
    { staleTime: 0 }
  );

  const callCount = cards.filter(c => c.quickAction === "madison_call_summary").length;
  const smsCount = cards.filter(c => c.quickAction === "madison_sms_draft").length;
  const emailCount = cards.filter(c => c.quickAction === "madison_email_draft").length;

  // After a Send/Dismiss the queue shrinks — clamp index safely
  useEffect(() => {
    if (cards.length > 0 && cardIndex >= cards.length) {
      setCardIndex(cards.length - 1);
    }
    if (cards.length === 0 && view === "review") {
      setView("done");
    }
  }, [cards.length, cardIndex, view]);

  const startReview = () => {
    if (cards.length === 0) return;
    setCardIndex(0);
    setView("review");
  };

  // Skip: frontend-only cursor advance, no mutation
  const goNext = () => {
    if (cardIndex < cards.length - 1) setCardIndex(i => i + 1);
    else setView("done");
  };
  const goPrev = () => {
    if (cardIndex > 0) setCardIndex(i => i - 1);
  };

  // Called by cards after their own Send/Dismiss mutation succeeds — advance immediately
  const onCardActed = () => {
    utils.opsChat.getFocusCards.invalidate();
    if (cardIndex < cards.length - 1) setCardIndex(i => i + 1);
    else setView("done");
  };

  const exitReview = () => { setView("hero"); setCardIndex(0); };

  const currentCard = cards[cardIndex];
  const progress = cards.length > 0 ? ((cardIndex + 1) / cards.length) * 100 : 0;

  // ── Hero ──────────────────────────────────────────────────────────────────
  if (view === "hero") {
    return (
      <div style={{ minHeight: "100vh", background: "#f4f6fb", fontFamily: "Inter, Arial, sans-serif" }}>
        <AdminHeader activeTab="madison-focus" />
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
          <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 28, boxShadow: "0 24px 64px rgba(0,0,0,.09)", overflow: "hidden" }}>
            <div style={{ padding: "36px 36px 32px", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 22 }}>
                <img src={MADISON_PHOTO} alt="Madison" style={{ width: 58, height: 58, borderRadius: "50%", objectFit: "cover", border: "2.5px solid rgba(255,255,255,0.45)", flexShrink: 0 }} />
                <div>
                  <div style={{ font: "700 28px Georgia, serif", lineHeight: 1 }}>Focus ✦</div>
                  <div style={{ fontSize: 14, opacity: 0.8, marginTop: 4 }}>Review and act on pending items</div>
                </div>
              </div>
              {isLoading ? (
                <div style={{ fontSize: 17, opacity: 0.8 }}>Loading…</div>
              ) : cards.length === 0 ? (
                <div style={{ fontSize: 19, lineHeight: 1.6 }}>
                  ✅ <b>You're all caught up.</b> No pending items right now.
                </div>
              ) : (
                <div style={{ fontSize: 19, lineHeight: 1.6 }}>
                  You have <b>{cards.length} pending item{cards.length !== 1 ? "s" : ""}</b>
                  {callCount > 0 && smsCount > 0
                    ? ` — ${callCount} call${callCount !== 1 ? "s" : ""}, ${smsCount} SMS draft${smsCount !== 1 ? "s" : ""}${emailCount > 0 ? `, ${emailCount} email draft${emailCount !== 1 ? "s" : ""}` : ""}.`
                    : callCount > 0
                    ? ` — ${callCount} inbound call${callCount !== 1 ? "s" : ""}.`
                    : smsCount > 0 && emailCount > 0
                    ? ` — ${smsCount} SMS draft${smsCount !== 1 ? "s" : ""} and ${emailCount} email draft${emailCount !== 1 ? "s" : ""}.`
                    : smsCount > 0
                    ? ` — ${smsCount} SMS draft${smsCount !== 1 ? "s" : ""}.`
                    : ` — ${emailCount} email draft${emailCount !== 1 ? "s" : ""}.`}
                </div>
              )}
            </div>
            {!isLoading && cards.length > 0 && (
              <div style={{ display: "flex", borderBottom: "1px solid #f0eeff" }}>
                {callCount > 0 && (
                  <div style={{ flex: 1, padding: "22px 28px", borderRight: "1px solid #f0eeff" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "#5d49f3" }}>{callCount}</div>
                    <div style={{ fontSize: 13, color: "#7a8092", fontWeight: 600, marginTop: 3 }}>Inbound Calls</div>
                  </div>
                )}
                {smsCount > 0 && (
                  <div style={{ flex: 1, padding: "22px 28px", borderRight: emailCount > 0 ? "1px solid #f0eeff" : undefined }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "#5d49f3" }}>{smsCount}</div>
                    <div style={{ fontSize: 13, color: "#7a8092", fontWeight: 600, marginTop: 3 }}>SMS Drafts</div>
                  </div>
                )}
                {emailCount > 0 && (
                  <div style={{ flex: 1, padding: "22px 28px" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: "#5d49f3" }}>{emailCount}</div>
                    <div style={{ fontSize: 13, color: "#7a8092", fontWeight: 600, marginTop: 3 }}>Email Drafts</div>
                  </div>
                )}
              </div>
            )}
            {!isLoading && cards.length > 0 && (
              <div style={{ padding: "24px 28px" }}>
                <button
                  onClick={startReview}
                  style={{ width: "100%", padding: "17px 0", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff", border: "none", borderRadius: 16, fontWeight: 700, fontSize: 17, cursor: "pointer" }}
                >
                  Start Focus →
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
        <AdminHeader activeTab="madison-focus" />
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
          <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 28, boxShadow: "0 24px 64px rgba(0,0,0,.09)", padding: "70px 48px", textAlign: "center" }}>
            <div style={{ fontSize: 52, marginBottom: 18 }}>✅</div>
            <div style={{ font: "700 28px Georgia, serif", color: "#1a1a2e", marginBottom: 12 }}>You're all caught up</div>
            <div style={{ fontSize: 17, color: "#6b7280", marginBottom: 32 }}>No more pending items right now.</div>
            <button
              onClick={exitReview}
              style={{ padding: "14px 32px", background: "linear-gradient(135deg, #5d49f3, #7a63ff)", color: "#fff", border: "none", borderRadius: 16, fontWeight: 700, fontSize: 16, cursor: "pointer" }}
            >
              ← Back to Focus
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
      <AdminHeader activeTab="madison-focus" />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 48px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button onClick={exitReview} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 14, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
            <X style={{ width: 15, height: 15 }} /> Exit
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{cardIndex + 1} of {cards.length}</span>
          <span style={{ fontSize: 13, color: "#9ca3af" }}>Focus Mode</span>
        </div>
        <div style={{ height: 7, background: "#ececf8", borderRadius: 999, marginBottom: 24, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #5d49f3, #7a63ff)", borderRadius: 999, transition: "width 0.3s ease" }} />
        </div>
        <div key={currentCard.id} style={{ background: "#fff", borderRadius: 20, boxShadow: "0 8px 32px rgba(0,0,0,.07)", overflow: "hidden", marginBottom: 20 }}>
          {currentCard.quickAction === "madison_sms_draft" ? (
            <MadisonSmsDraftCard key={currentCard.id} msg={msgObj} callerName="" onActed={onCardActed} />
          ) : currentCard.quickAction === "madison_email_draft" ? (
            <MadisonEmailDraftCard key={currentCard.id} msg={msgObj} callerName="" onActed={onCardActed} />
          ) : (
            <MadisonCallSummaryCard
              key={currentCard.id}
              msg={msgObj}
              onCallBack={(_name, phone) => { window.open(`tel:${phone}`, "_self"); }}
              onTextBack={(_name, phone) => { navigate(`/admin/leads?tab=callbacks&phone=${encodeURIComponent(phone)}`); }}
              onActed={onCardActed}
            />
          )}
        </div>
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
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "14px 22px", borderRadius: 14, border: "1.5px solid #ddd5ff", background: "#fff", color: "#5d49f3", fontWeight: 700, fontSize: 15, cursor: "pointer" }}
          >
            <SkipForward style={{ width: 17, height: 17 }} />
            {cardIndex < cards.length - 1 ? "Skip" : "Done"}
          </button>
        </div>
        <div style={{ marginTop: 10, textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
          Skip moves to the next card without acting. The card stays in your queue.
        </div>
      </div>
    </div>
  );
}
