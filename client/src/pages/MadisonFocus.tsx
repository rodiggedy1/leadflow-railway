/**
 * MadisonFocus — Focus Mode
 * 3-column layout:
 *   Left  : Weekly leaderboard
 *   Center: Card queue (unchanged send/dismiss/advance logic)
 *   Right : Session stats + recent wins + queue preview
 *
 * Purely additive — existing send/dismiss/advance flow is untouched.
 * Points are awarded via awardFocusPoints mutation after a successful Send.
 */
import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { ChevronLeft, X, SkipForward, Trophy, Zap, CheckCircle2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import AdminHeader from "@/components/AdminHeader";
import { MadisonSmsDraftCard, MadisonEmailDraftCard, MadisonCallSummaryCard } from "@/components/CommandChat";

const MADISON_PHOTO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/madison-headshot-v3-Ky5x7Vzm5HBzWn6As5hsPv.webp";

const PURPLE = "#6d46ff";
const PURPLE2 = "#8d70ff";
const GREEN = "#1f9d70";

type ViewState = "hero" | "review" | "done";
type RecentWin = { label: string; type: "sms" | "email" | "call"; ts: number };

// ── Leaderboard Sidebar ───────────────────────────────────────────────────────
function LeaderboardSidebar({ myName }: { myName: string }) {
  const { data: board = [] } = trpc.opsChat.getFocusLeaderboard.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const { data: myPts } = trpc.opsChat.getMyFocusPoints.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <aside style={{
      width: 260,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      {/* Leaderboard card */}
      <div style={{
        background: "#fff",
        border: "1px solid #e9e6fb",
        borderRadius: 22,
        padding: "20px 18px",
        boxShadow: "0 8px 24px rgba(52,42,95,.07)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Trophy style={{ width: 18, height: 18, color: PURPLE }} />
          <span style={{ fontWeight: 800, fontSize: 14, color: "#17152d" }}>This Week</span>
        </div>
        {board.length === 0 ? (
          <div style={{ fontSize: 13, color: "#9ca3af", textAlign: "center", padding: "12px 0" }}>
            No points yet this week.<br />Be the first! 🚀
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {board.map((entry, i) => {
              const isMe = entry.agentName === myName;
              return (
                <div key={entry.agentName} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderRadius: 13,
                  background: isMe ? "#f0ecff" : i === 0 ? "#fffbf0" : "transparent",
                  border: isMe ? `1.5px solid #c4b5fd` : "1.5px solid transparent",
                }}>
                  <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>
                    {medals[i] ?? `${i + 1}`}
                  </span>
                  <span style={{
                    flex: 1,
                    fontSize: 13,
                    fontWeight: isMe ? 800 : 600,
                    color: isMe ? PURPLE : "#17152d",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {entry.agentName}{isMe ? " (you)" : ""}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: isMe ? PURPLE : "#6b7280" }}>
                    {entry.points}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {myPts && !board.find(e => e.agentName === myName) && (
          <div style={{
            marginTop: 10,
            padding: "9px 12px",
            borderRadius: 13,
            background: "#f0ecff",
            border: `1.5px solid #c4b5fd`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>—</span>
            <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: PURPLE }}>
              {myName} (you)
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: PURPLE }}>{myPts.points}</span>
          </div>
        )}
      </div>

      {/* My points card */}
      <div style={{
        background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE2})`,
        borderRadius: 22,
        padding: "18px 18px",
        color: "#fff",
        boxShadow: "0 8px 24px rgba(109,70,255,.25)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.8, marginBottom: 4 }}>YOUR POINTS THIS WEEK</div>
        <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1 }}>{myPts?.points ?? 0}</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>+10 pts per send</div>
      </div>
    </aside>
  );
}

// ── Right Stats Panel ─────────────────────────────────────────────────────────
function RightPanel({
  total,
  done,
  streak,
  recentWins,
  queueCards,
  cardIndex,
}: {
  total: number;
  done: number;
  streak: number;
  recentWins: RecentWin[];
  queueCards: Array<{ id: number; quickAction: string | null; body: string }>;
  cardIndex: number;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <aside style={{
      width: 280,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      {/* Session stats */}
      <div style={{
        background: "#fff",
        border: "1px solid #e9e6fb",
        borderRadius: 22,
        padding: "18px 16px",
        boxShadow: "0 8px 24px rgba(52,42,95,.07)",
      }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#17152d", marginBottom: 14 }}>🎯 Session</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginBottom: 12 }}>
          {[
            { label: "Total", value: total, color: PURPLE },
            { label: "Done", value: done, color: GREEN },
            { label: "Streak", value: streak, color: "#ff922f" },
            { label: "%", value: `${pct}%`, color: "#ff922f" },
          ].map(s => (
            <div key={s.label} style={{
              border: "1px solid #e9e6fb",
              borderRadius: 12,
              textAlign: "center",
              padding: "9px 4px",
            }}>
              <strong style={{ display: "block", color: s.color, fontSize: 18, fontWeight: 800 }}>{s.value}</strong>
              <small style={{ color: "#7e829c", fontSize: 10 }}>{s.label}</small>
            </div>
          ))}
        </div>
        <div style={{ height: 7, background: "#ece9fa", borderRadius: 999, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${PURPLE}, ${PURPLE2})`,
            borderRadius: 999,
            transition: "width 0.3s ease",
          }} />
        </div>
      </div>

      {/* Recent wins */}
      <div style={{
        background: "#fff",
        border: "1px solid #e9e6fb",
        borderRadius: 22,
        padding: "18px 16px",
        boxShadow: "0 8px 24px rgba(52,42,95,.07)",
      }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#17152d", marginBottom: 12 }}>Recent Wins</div>
        {recentWins.length === 0 ? (
          <div style={{ fontSize: 12, color: "#9ca3af" }}>Act on a card to see wins here.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {recentWins.slice(0, 5).map((w, i) => (
              <div key={i} style={{
                display: "grid",
                gridTemplateColumns: "32px 1fr auto",
                gap: 8,
                alignItems: "center",
                padding: "9px 0",
                borderBottom: i < Math.min(recentWins.length, 5) - 1 ? "1px solid #f0eeff" : "none",
              }}>
                <div style={{
                  width: 30,
                  height: 30,
                  borderRadius: 10,
                  background: w.type === "call" ? "#fff3e5" : "#eaf8f2",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 14,
                }}>
                  {w.type === "sms" ? "✉" : w.type === "email" ? "📧" : "☎"}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#17152d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                    {w.label}
                  </div>
                  <div style={{ fontSize: 11, color: GREEN, fontWeight: 600 }}>Sent</div>
                </div>
                <time style={{ fontSize: 10, color: "#9da1b4" }}>
                  {Math.floor((Date.now() - w.ts) / 60000)}m ago
                </time>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Queue preview */}
      <div style={{
        background: "#fff",
        border: "1px solid #e9e6fb",
        borderRadius: 22,
        padding: "18px 16px",
        boxShadow: "0 8px 24px rgba(52,42,95,.07)",
      }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: "#17152d", marginBottom: 8 }}>Queue Preview</div>
        <div style={{ fontSize: 12, color: "#7e829c", marginBottom: 10 }}>What's ahead</div>
        <div style={{ display: "flex", marginBottom: 10 }}>
          {queueCards.slice(cardIndex + 1, cardIndex + 6).map((c, i) => {
            const initials = (c.body ?? "?").slice(0, 1).toUpperCase();
            return (
              <div key={c.id} style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: `linear-gradient(135deg, #f2b998, #75483f)`,
                color: "#fff",
                fontWeight: 800,
                fontSize: 13,
                display: "grid",
                placeItems: "center",
                marginLeft: i === 0 ? 0 : -8,
                border: "2px solid #fff",
              }}>
                {initials}
              </div>
            );
          })}
        </div>
        <strong style={{ fontSize: 13, color: "#17152d" }}>
          {Math.max(0, total - done - 1)} card{total - done - 1 !== 1 ? "s" : ""} remaining
        </strong>
      </div>
    </aside>
  );
}

// ── Celebration Screen ────────────────────────────────────────────────────────
function CelebrationScreen({
  streak,
  pointsEarned,
  onContinue,
}: {
  streak: number;
  pointsEarned: number;
  onContinue: () => void;
}) {
  return (
    <div style={{
      background: "radial-gradient(circle at 80% 50%,#eee9ff,transparent 28%),radial-gradient(circle at 20% 50%,#fff1dd,transparent 28%),white",
      borderRadius: 24,
      border: "1px solid #e9e6fb",
      boxShadow: "0 20px 55px rgba(67,45,145,.13)",
      padding: "40px 32px",
      textAlign: "center",
    }}>
      <div style={{
        width: 70,
        height: 70,
        margin: "0 auto 16px",
        borderRadius: "50%",
        background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE2})`,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: 34,
        boxShadow: `0 15px 30px ${PURPLE}44`,
      }}>
        ✓
      </div>
      <h2 style={{ font: "700 26px Georgia,serif", margin: "0 0 6px", color: "#17152d" }}>Sent! 🎉</h2>
      <p style={{ color: "#7e829c", marginBottom: 20 }}>Madison's got this one.</p>
      <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <div style={{ padding: "9px 14px", border: "1px solid #e9e6fb", borderRadius: 12, fontSize: 13, fontWeight: 800, background: "#fff" }}>
          ⭐ +{pointsEarned} pts
        </div>
        <div style={{ padding: "9px 14px", border: "1px solid #e9e6fb", borderRadius: 12, fontSize: 13, fontWeight: 800, background: "#fff" }}>
          🔥 {streak} in a row
        </div>
        <div style={{ padding: "9px 14px", border: "1px solid #e9e6fb", borderRadius: 12, fontSize: 13, fontWeight: 800, background: "#fff" }}>
          😊 Great job!
        </div>
      </div>
      <button
        onClick={onContinue}
        style={{
          padding: "14px 32px",
          background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE2})`,
          color: "#fff",
          border: "none",
          borderRadius: 16,
          fontWeight: 700,
          fontSize: 15,
          cursor: "pointer",
          boxShadow: `0 10px 22px ${PURPLE}33`,
        }}
      >
        Continue to next card →
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MadisonFocus() {
  const [view, setView] = useState<ViewState>("hero");
  const [cardIndex, setCardIndex] = useState(0);
  const [showCelebration, setShowCelebration] = useState(false);
  const [sessionStreak, setSessionStreak] = useState(0);
  const [sessionDone, setSessionDone] = useState(0);
  const [recentWins, setRecentWins] = useState<RecentWin[]>([]);
  const [, navigate] = useLocation();

  const utils = trpc.useUtils();
  const { data: cards = [], isLoading } = trpc.opsChat.getFocusCards.useQuery(
    undefined,
    { staleTime: 0 }
  );

  const awardPoints = trpc.opsChat.awardFocusPoints.useMutation();
  const { data: myPtsData } = trpc.opsChat.getMyFocusPoints.useQuery(undefined, { staleTime: 15_000 });
  const myName = ""; // resolved from leaderboard context — opsCaller.name not exposed to frontend directly

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
  const onCardActed = (acted: "sent" | "dismissed" = "sent") => {
    utils.opsChat.getFocusCards.invalidate();
    if (acted === "sent") {
      // Award points (fire-and-forget)
      awardPoints.mutate();
      utils.opsChat.getMyFocusPoints.invalidate();
      utils.opsChat.getFocusLeaderboard.invalidate();
      // Update session stats
      setSessionStreak(s => s + 1);
      setSessionDone(d => d + 1);
      // Add to recent wins
      const currentCard = cards[cardIndex];
      if (currentCard) {
        const type: RecentWin["type"] =
          currentCard.quickAction === "madison_sms_draft" ? "sms" :
          currentCard.quickAction === "madison_email_draft" ? "email" : "call";
        const label = (currentCard.body ?? "").slice(0, 40) || "Card";
        setRecentWins(w => [{ label, type, ts: Date.now() }, ...w]);
      }
      // Show celebration screen briefly
      setShowCelebration(true);
    } else {
      setSessionDone(d => d + 1);
      setSessionStreak(0);
      if (cardIndex < cards.length - 1) setCardIndex(i => i + 1);
      else setView("done");
    }
  };

  const onCelebrationContinue = () => {
    setShowCelebration(false);
    if (cardIndex < cards.length - 1) setCardIndex(i => i + 1);
    else setView("done");
  };

  const exitReview = () => { setView("hero"); setCardIndex(0); setShowCelebration(false); };

  const currentCard = cards[cardIndex];
  const progress = cards.length > 0 ? ((cardIndex + 1) / cards.length) * 100 : 0;

  // ── Hero ──────────────────────────────────────────────────────────────────
  if (view === "hero") {
    return (
      <div style={{ minHeight: "100vh", background: "#f7f8ff", fontFamily: "Inter, Arial, sans-serif" }}>
        <AdminHeader activeTab="madison-focus" />
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
          <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 28, boxShadow: "0 24px 64px rgba(0,0,0,.09)", overflow: "hidden" }}>
            <div style={{ padding: "36px 36px 32px", background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE2})`, color: "#fff" }}>
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
                    <div style={{ fontSize: 32, fontWeight: 700, color: PURPLE }}>{callCount}</div>
                    <div style={{ fontSize: 13, color: "#7a8092", fontWeight: 600, marginTop: 3 }}>Inbound Calls</div>
                  </div>
                )}
                {smsCount > 0 && (
                  <div style={{ flex: 1, padding: "22px 28px", borderRight: emailCount > 0 ? "1px solid #f0eeff" : undefined }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: PURPLE }}>{smsCount}</div>
                    <div style={{ fontSize: 13, color: "#7a8092", fontWeight: 600, marginTop: 3 }}>SMS Drafts</div>
                  </div>
                )}
                {emailCount > 0 && (
                  <div style={{ flex: 1, padding: "22px 28px" }}>
                    <div style={{ fontSize: 32, fontWeight: 700, color: PURPLE }}>{emailCount}</div>
                    <div style={{ fontSize: 13, color: "#7a8092", fontWeight: 600, marginTop: 3 }}>Email Drafts</div>
                  </div>
                )}
              </div>
            )}
            {!isLoading && cards.length > 0 && (
              <div style={{ padding: "24px 28px" }}>
                <button
                  onClick={startReview}
                  style={{ width: "100%", padding: "17px 0", background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE2})`, color: "#fff", border: "none", borderRadius: 16, fontWeight: 700, fontSize: 17, cursor: "pointer" }}
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
      <div style={{ minHeight: "100vh", background: "#f7f8ff", fontFamily: "Inter, Arial, sans-serif" }}>
        <AdminHeader activeTab="madison-focus" />
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px" }}>
          <div style={{ background: "#fff", border: "1px solid #e8e8f6", borderRadius: 28, boxShadow: "0 24px 64px rgba(0,0,0,.09)", padding: "70px 48px", textAlign: "center" }}>
            <div style={{ fontSize: 52, marginBottom: 18 }}>✅</div>
            <div style={{ font: "700 28px Georgia, serif", color: "#1a1a2e", marginBottom: 12 }}>You're all caught up</div>
            <div style={{ fontSize: 17, color: "#6b7280", marginBottom: 8 }}>No more pending items right now.</div>
            {sessionDone > 0 && (
              <div style={{ fontSize: 15, color: PURPLE, fontWeight: 700, marginBottom: 24 }}>
                🔥 {sessionDone} card{sessionDone !== 1 ? "s" : ""} handled this session · +{sessionDone * 10} pts
              </div>
            )}
            <button
              onClick={exitReview}
              style={{ padding: "14px 32px", background: `linear-gradient(135deg, ${PURPLE}, ${PURPLE2})`, color: "#fff", border: "none", borderRadius: 16, fontWeight: 700, fontSize: 16, cursor: "pointer" }}
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
    <div style={{ minHeight: "100vh", background: "#f7f8ff", fontFamily: "Inter, Arial, sans-serif" }}>
      <AdminHeader activeTab="madison-focus" />
      <div style={{
        display: "flex",
        gap: 18,
        padding: "24px 20px 48px",
        maxWidth: 1200,
        margin: "0 auto",
        alignItems: "flex-start",
      }}>
        {/* Left: Leaderboard */}
        <LeaderboardSidebar myName={myName} />

        {/* Center: Card */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button onClick={exitReview} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 14, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}>
              <X style={{ width: 15, height: 15 }} /> Exit
            </button>
            <span style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{cardIndex + 1} of {cards.length}</span>
            <span style={{ fontSize: 13, color: "#9ca3af" }}>Focus Mode 🎯</span>
          </div>

          {/* Progress bar */}
          <div style={{ height: 7, background: "#ececf8", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: `linear-gradient(90deg, ${PURPLE}, ${PURPLE2})`, borderRadius: 999, transition: "width 0.3s ease" }} />
          </div>

          {/* Celebration or Card */}
          {showCelebration ? (
            <CelebrationScreen
              streak={sessionStreak}
              pointsEarned={10}
              onContinue={onCelebrationContinue}
            />
          ) : (
            <div key={currentCard.id} style={{ background: "#fff", borderRadius: 20, boxShadow: "0 8px 32px rgba(0,0,0,.07)", overflow: "hidden" }}>
              {currentCard.quickAction === "madison_sms_draft" ? (
                <MadisonSmsDraftCard key={currentCard.id} msg={msgObj} callerName="" onActed={() => onCardActed("sent")} />
              ) : currentCard.quickAction === "madison_email_draft" ? (
                <MadisonEmailDraftCard key={currentCard.id} msg={msgObj} callerName="" onActed={() => onCardActed("sent")} />
              ) : (
                <MadisonCallSummaryCard
                  key={currentCard.id}
                  msg={msgObj}
                  onCallBack={(_name, phone) => { window.open(`tel:${phone}`, "_self"); }}
                  onTextBack={(_name, phone) => { navigate(`/admin/leads?tab=callbacks&phone=${encodeURIComponent(phone)}`); }}
                  onActed={() => onCardActed("dismissed")}
                />
              )}
            </div>
          )}

          {/* Nav buttons */}
          {!showCelebration && (
            <>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={goPrev}
                  disabled={cardIndex === 0}
                  style={{ display: "flex", alignItems: "center", gap: 7, padding: "14px 22px", borderRadius: 14, border: "1.5px solid #ddd5ff", background: "#fff", color: cardIndex === 0 ? "#d1d5db" : PURPLE, fontWeight: 700, fontSize: 15, cursor: cardIndex === 0 ? "not-allowed" : "pointer" }}
                >
                  <ChevronLeft style={{ width: 17, height: 17 }} /> Prev
                </button>
                <button
                  onClick={goNext}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "14px 22px", borderRadius: 14, border: "1.5px solid #ddd5ff", background: "#fff", color: PURPLE, fontWeight: 700, fontSize: 15, cursor: "pointer" }}
                >
                  <SkipForward style={{ width: 17, height: 17 }} />
                  {cardIndex < cards.length - 1 ? "Skip" : "Done"}
                </button>
              </div>
              <div style={{ textAlign: "center", fontSize: 12, color: "#9ca3af" }}>
                Skip moves to the next card without acting. The card stays in your queue.
              </div>
            </>
          )}
        </div>

        {/* Right: Stats */}
        <RightPanel
          total={cards.length}
          done={sessionDone}
          streak={sessionStreak}
          recentWins={recentWins}
          queueCards={cards}
          cardIndex={cardIndex}
        />
      </div>
    </div>
  );
}
