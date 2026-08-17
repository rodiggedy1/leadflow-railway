import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { getCsInboxReplyPhoneNumberId } from "@shared/csInboxPhoneNumberRouting";

const OUTREACH_STYLES = `
  .cs2-outreach-preview{min-height:0;overflow:auto;background:#f7f7fa;color:#171820;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .cs2-outreach-shell{max-width:1180px;min-height:100%;margin:0 auto;padding:28px 34px 80px}
  .cs2-outreach-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:34px}
  .cs2-outreach-brand{display:flex;gap:12px;align-items:center}.cs2-outreach-logo{width:38px;height:38px;border-radius:11px;background:#171922;color:#fff;display:grid;place-items:center;font-weight:900}
  .cs2-outreach-brand b{font:700 18px Georgia,serif}.cs2-outreach-brand small{display:block;color:#8b909b;margin-top:2px}
  .cs2-outreach-icon{border:1px solid #e1e3e8;background:#fff;border-radius:10px;padding:10px 13px;cursor:pointer;color:#343741;font:inherit;line-height:1}.cs2-outreach-icon:disabled{opacity:.5;cursor:default}
  .cs2-outreach-intro{text-align:center;max-width:700px;margin:0 auto 30px}.cs2-outreach-intro small{color:#7147e9;font-weight:850;letter-spacing:.08em}.cs2-outreach-intro h1{font:700 35px Georgia,serif;margin:8px 0}.cs2-outreach-intro p{color:#777d89;line-height:1.5;margin:0}
  .cs2-outreach-progress{display:flex;justify-content:center;gap:8px;margin-top:18px;flex-wrap:wrap}.cs2-outreach-pill{font-size:12px;background:#fff;border:1px solid #e4e5ea;border-radius:99px;padding:7px 10px}.cs2-outreach-pill strong{color:#7147e9}
  .cs2-outreach-card{max-width:760px;margin:auto;background:#fff;border:1px solid #e3e5eb;border-radius:20px;box-shadow:0 12px 40px #23233a0a;overflow:hidden}.cs2-outreach-top{padding:22px 24px 16px;border-bottom:1px solid #eff0f3;display:flex;justify-content:space-between;gap:12px}.cs2-outreach-rank{font-size:11px;color:#8c919d;font-weight:800}.cs2-outreach-urgency{font-size:11px;background:#fff0e5;color:#d96e16;padding:6px 8px;border-radius:8px;font-weight:850;white-space:nowrap}
  .cs2-outreach-body{padding:24px}.cs2-outreach-person{display:flex;gap:12px;align-items:center}.cs2-outreach-avatar{width:45px;height:45px;border-radius:50%;background:#7047eb;color:#fff;display:grid;place-items:center;font-weight:850}.cs2-outreach-person h2{margin:0 0 4px;font-size:19px}.cs2-outreach-meta{font-size:12px;color:#858b98}.cs2-outreach-phone{margin-top:2px;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;color:#858b98}.cs2-outreach-last-touch{margin-top:4px;font-size:12px;color:#858b98}.cs2-outreach-last-touch b{font-size:10px;letter-spacing:.06em;color:#6940dc;margin-right:6px}
  .cs2-outreach-why{margin:22px 0 18px;padding:14px 16px;background:#faf8ff;border-radius:12px;border:1px solid #e8e1ff}.cs2-outreach-why b{display:block;font-size:10px;letter-spacing:.06em;color:#6940dc;margin-bottom:5px}.cs2-outreach-why span{font-size:13px;line-height:1.5}
  .cs2-outreach-context{margin:0 0 18px;border:1px solid #e7e8ee;border-radius:12px;overflow:hidden}.cs2-outreach-context-latest{padding:13px 15px;background:#fbfbfd}.cs2-outreach-context-latest b{display:block;font-size:10px;letter-spacing:.06em;color:#6940dc;margin-bottom:5px}.cs2-outreach-context-latest span{font-size:13px;line-height:1.5;white-space:pre-wrap}.cs2-outreach-context-toggle{width:100%;display:flex;justify-content:space-between;align-items:center;border:0;border-top:1px solid #e7e8ee;background:#fff;padding:11px 15px;font:750 12px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#4a4f5a;cursor:pointer}.cs2-outreach-context-toggle:hover{background:#fafafd}.cs2-outreach-history{border-top:1px solid #e7e8ee;padding:8px 15px 13px;display:grid;gap:8px}.cs2-outreach-history-row{padding:9px 11px;border-radius:9px;background:#f5f6f8}.cs2-outreach-history-row[data-role="customer"]{background:#faf8ff}.cs2-outreach-history-role{display:block;font-size:10px;font-weight:850;letter-spacing:.05em;color:#6940dc;margin-bottom:3px}.cs2-outreach-history-row[data-role="us"] .cs2-outreach-history-role{color:#626977}.cs2-outreach-history-text{font-size:12px;line-height:1.45;color:#3f4350;white-space:pre-wrap}
  .cs2-outreach-label{font-size:10px;color:#858b98;font-weight:850;letter-spacing:.05em}.cs2-outreach-message{width:100%;margin-top:7px;background:#f4f5f7;border:0;border-radius:13px;padding:15px;font:14px/1.55 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#3f4350;min-height:82px;outline:none;resize:vertical}.cs2-outreach-message:focus{box-shadow:0 0 0 2px #d9ccff}
  .cs2-outreach-actions{display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:13px}.cs2-outreach-send{border:0;border-radius:11px;background:#7047eb;color:#fff;padding:13px;font-weight:850;cursor:pointer;font:inherit}.cs2-outreach-skip{border:1px solid #e1e3e8;background:#fff;border-radius:11px;padding:13px 16px;font-weight:750;cursor:pointer;font:inherit;color:#343741}.cs2-outreach-send:hover{background:#6238dc}.cs2-outreach-skip:hover,.cs2-outreach-icon:hover{background:#fafafd}.cs2-outreach-send:disabled,.cs2-outreach-skip:disabled{opacity:.5;cursor:default}
  .cs2-outreach-after{text-align:center;color:#8b909c;font-size:11px;margin-top:13px}.cs2-outreach-next{max-width:760px;margin:17px auto 0;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:13px 18px;color:#7e8490;font-size:12px}.cs2-outreach-next b{color:#343741}.cs2-outreach-error{max-width:760px;margin:12px auto;color:#b42318;background:#fef3f2;border:1px solid #fecdca;border-radius:10px;padding:10px 13px;font-size:12px}.cs2-outreach-caught{max-width:760px;margin:auto;background:#fff;border:1px solid #e3e5eb;border-radius:20px;padding:46px 26px;text-align:center;box-shadow:0 12px 40px #23233a0a}.cs2-outreach-caught h2{font:700 25px Georgia,serif;margin:0 0 8px}.cs2-outreach-caught p{margin:0;color:#777d89}
  .cs2-outreach-query-error{max-width:760px;margin:auto;background:#fff;border:1px solid #fecdca;border-radius:20px;padding:42px 26px;text-align:center;box-shadow:0 12px 40px #23233a0a}.cs2-outreach-query-error h2{font:700 25px Georgia,serif;margin:0 0 8px;color:#79251b}.cs2-outreach-query-error p{margin:0;color:#777d89}.cs2-outreach-retry{margin-top:18px;border:0;border-radius:10px;background:#7047eb;color:#fff;padding:11px 17px;font:750 13px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}.cs2-outreach-retry:disabled{opacity:.5;cursor:default}
  @media (max-width:720px){.cs2-outreach-shell{padding:20px 16px 48px}.cs2-outreach-intro h1{font-size:29px}.cs2-outreach-card{border-radius:16px}.cs2-outreach-top,.cs2-outreach-body{padding:18px}.cs2-outreach-next{padding:12px 0}.cs2-outreach-actions{grid-template-columns:1fr}.cs2-outreach-skip{padding:12px}}
`;

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "?";
}

function categoryLabel(category: string) {
  switch (category) {
    case "customer_waiting": return "CUSTOMER WAITING ON US";
    case "urgent_high_intent": return "URGENT / HIGH INTENT";
    case "follow_up_due": return "FOLLOW-UP DUE";
    case "re_engagement": return "RE-ENGAGEMENT";
    default: return "NEXT BEST ACTION";
  }
}

function formatElapsed(elapsedMs: number): string {
  const minutes = Math.max(1, Math.floor(elapsedMs / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatLastTouch(timestamp: number | null, role: string | null): string {
  if (timestamp === null) return "No recorded touch";
  const elapsed = formatElapsed(Math.max(0, Date.now() - timestamp));
  if (role === "user") return `Customer replied ${elapsed} ago`;
  if (role === "assistant") return `Outreach sent ${elapsed} ago`;
  return `Last activity ${elapsed} ago`;
}

function formatPhone(phone: string): string {
  return phone.replace(/^\+1/, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");
}

type MadisonHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

function parseMadisonHistory(raw: string): MadisonHistoryMessage[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((message): MadisonHistoryMessage[] => {
      if (!message || typeof message !== "object") return [];
      const candidate = message as { role?: unknown; content?: unknown };
      const content = typeof candidate.content === "string" ? candidate.content.trim() : "";
      if (!content) return [];
      if (candidate.role === "user" || candidate.role === "customer") return [{ role: "user", content }];
      if (candidate.role === "assistant") return [{ role: "assistant", content }];
      return [];
    });
  } catch {
    return [];
  }
}

/** Madison V1: a thin UI over existing query, draft, send, and live-update infrastructure. */
export default function CsInboxOutreachPreview() {
  const utils = trpc.useUtils();
  const queue = trpc.madison.getNextBestActions.useQuery(undefined, { staleTime: 0 });
  const deferMutation = trpc.madison.deferNextBestAction.useMutation();
  const sendMutation = trpc.leads.sendMessage.useMutation();
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");
  const [showConversation, setShowConversation] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fallbackReplyMutation = trpc.opsChat.csReply.useMutation();

  const current = queue.data?.current ?? null;
  const upNext = queue.data?.upNext ?? null;

  useOpsStream(
    { onLeadUpdate: () => { void utils.madison.getNextBestActions.invalidate(); } },
    { enabled: Boolean(queue.data), label: "Madison" },
  );

  useEffect(() => {
    if (!current) {
      setDraft("");
      setDrafting(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft("");
    setDrafting(true);
    setError("");
    setShowConversation(false);

    const jobContext = [
      current.serviceType ? `Service: ${current.serviceType}` : "",
      current.address ? `Address: ${current.address}` : "",
      current.quotedPrice ? `Quoted price: ${current.quotedPrice}` : "",
    ].filter(Boolean).join("\n");
    const history = parseMadisonHistory(current.messageHistory);

    void (async () => {
      try {
        const response = await fetch("/api/cs-reply-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            conversationContext: current.messageHistory,
            customerName: current.leadName,
            jobContext,
            scenario: current.whyNow,
            sessionId: current.sessionId,
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const payload = line.trim();
            if (!payload.startsWith("data:")) continue;
            const raw = payload.slice(5).trim();
            if (raw === "[DONE]") continue;
            const event = JSON.parse(raw) as { token?: string; error?: string };
            if (event.error) throw new Error(event.error);
            if (event.token) {
              accumulated += event.token;
              setDraft(accumulated);
            }
          }
        }
        if (!accumulated.trim()) throw new Error("AI stream ended without a draft");
      } catch (streamError) {
        if ((streamError as Error).name === "AbortError") return;
        try {
          const fallback = await fallbackReplyMutation.mutateAsync({
            customerName: current.leadName,
            jobContext,
            conversationContext: current.messageHistory,
            scenario: current.whyNow,
            history,
          });
          if (!controller.signal.aborted) setDraft(fallback.reply);
        } catch {
          if (!controller.signal.aborted) {
            setError("Madison could not generate a suggested response. Please try again.");
          }
        }
      } finally {
        if (!controller.signal.aborted) setDrafting(false);
      }
    })();

    return () => controller.abort();
  }, [current?.sessionId]);

  async function sendAndNext() {
    if (!current || !draft.trim() || sendMutation.isPending) return;
    setError("");
    try {
      await sendMutation.mutateAsync({
        sessionId: current.sessionId,
        message: draft.trim(),
        fromNumberId: getCsInboxReplyPhoneNumberId(current.lastInboundPhoneNumberId),
      });
      setDraft("");
      await utils.madison.getNextBestActions.invalidate();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send. Please try again.");
    }
  }

  async function skip() {
    if (!current || deferMutation.isPending) return;
    setError("");
    try {
      await deferMutation.mutateAsync({ sessionId: current.sessionId });
      setDraft("");
      await utils.madison.getNextBestActions.invalidate();
    } catch (skipError) {
      setError(skipError instanceof Error ? skipError.message : "Unable to skip this action. Please try again.");
    }
  }

  const busy = drafting || sendMutation.isPending || deferMutation.isPending;
  const conversation = current ? parseMadisonHistory(current.messageHistory) : [];
  const latestCustomerMessage = [...conversation].reverse().find(message => message.role === "user") ?? null;
  const recentConversation = conversation.slice(-5);

  return (
    <section className="cs2-outreach-preview" aria-label="Madison next best action">
      <style>{OUTREACH_STYLES}</style>
      <div className="cs2-outreach-shell">
        <header className="cs2-outreach-header">
          <div className="cs2-outreach-brand">
            <div className="cs2-outreach-logo">M</div>
            <div><b>Madison</b><small>Your sales copilot</small></div>
          </div>
          <button className="cs2-outreach-icon" onClick={() => void queue.refetch()} disabled={queue.isFetching} title="Refresh outreach queue" aria-label="Refresh outreach queue">↻</button>
        </header>

        <div className="cs2-outreach-intro">
          <small>YOUR NEXT BEST ACTION</small>
          <h1>Focus on the conversation that matters most.</h1>
          <p>One lead at a time. Madison ranks existing conversations so the next human action stays clear.</p>
          <div className="cs2-outreach-progress" aria-label="Outreach queue status">
            {!queue.isError && <span className="cs2-outreach-pill"><strong>{queue.data?.eligibleCount ?? 0}</strong> eligible</span>}
            <span className="cs2-outreach-pill">Follow-up after <strong>2 hours</strong></span>
            <span className="cs2-outreach-pill">Skip for <strong>4 hours</strong></span>
          </div>
        </div>

        {queue.isLoading ? (
          <div className="cs2-outreach-caught"><h2>Loading Madison…</h2><p>Finding the next best conversation.</p></div>
        ) : queue.isError ? (
          <div className="cs2-outreach-query-error" role="alert">
            <h2>Madison couldn&apos;t load.</h2>
            <p>The outreach queue is unavailable right now. Please retry.</p>
            <button className="cs2-outreach-retry" onClick={() => void queue.refetch()} disabled={queue.isFetching}>Retry</button>
          </div>
        ) : !current ? (
          <div className="cs2-outreach-caught"><h2>You&apos;re caught up.</h2><p>No eligible conversations need a manual outreach action right now.</p></div>
        ) : (
          <>
            <article className="cs2-outreach-card">
              <div className="cs2-outreach-top">
                <span className="cs2-outreach-rank">{categoryLabel(current.category)}</span>
                <span className="cs2-outreach-urgency">NEXT BEST ACTION</span>
              </div>
              <div className="cs2-outreach-body">
                <div className="cs2-outreach-person">
                  <div className="cs2-outreach-avatar">{initials(current.leadName)}</div>
                  <div>
                    <h2>{current.leadName}</h2>
                    <div className="cs2-outreach-meta">{[current.serviceType, current.address].filter(Boolean).join(" · ") || current.leadPhone}</div>
                    <div className="cs2-outreach-phone">{formatPhone(current.leadPhone)}</div>
                    <div className="cs2-outreach-last-touch"><b>LAST TOUCH</b>{formatLastTouch(current.lastMessageTs, current.lastMessageRole)}</div>
                  </div>
                </div>
                <div className="cs2-outreach-why"><b>WHY NOW</b><span>{current.whyNow}</span></div>
                {latestCustomerMessage && <div className="cs2-outreach-context">
                  <div className="cs2-outreach-context-latest">
                    <b>LATEST MESSAGE FROM CUSTOMER</b>
                    <span>{latestCustomerMessage.content}</span>
                  </div>
                  <button className="cs2-outreach-context-toggle" onClick={() => setShowConversation(value => !value)} aria-expanded={showConversation}>
                    <span>{showConversation ? "Hide conversation" : "View conversation"}</span>
                    <span aria-hidden="true">{showConversation ? "−" : "+"}</span>
                  </button>
                  {showConversation && <div className="cs2-outreach-history">
                    {recentConversation.map((message, index) => <div className="cs2-outreach-history-row" data-role={message.role === "user" ? "customer" : "us"} key={`${message.role}-${index}-${message.content}`}>
                      <span className="cs2-outreach-history-role">{message.role === "user" ? "CUSTOMER" : "US"}</span>
                      <span className="cs2-outreach-history-text">{message.content}</span>
                    </div>)}
                  </div>}
                </div>}
                <label className="cs2-outreach-label" htmlFor="madison-draft">MADISON&apos;S SUGGESTED MESSAGE</label>
                <textarea id="madison-draft" className="cs2-outreach-message" aria-label="Madison suggested outreach message" value={draft} onChange={event => setDraft(event.target.value)} placeholder={drafting ? "Generating suggested response…" : "Write a message"} />
                <div className="cs2-outreach-actions">
                  <button className="cs2-outreach-send" onClick={() => void sendAndNext()} disabled={busy || !draft.trim()}>{sendMutation.isPending ? "Sending…" : "Send & Next →"}</button>
                  <button className="cs2-outreach-skip" onClick={() => void skip()} disabled={busy}>{deferMutation.isPending ? "Skipping…" : "Skip"}</button>
                </div>
                <div className="cs2-outreach-after">Skip hides this conversation for four hours unless the customer replies.</div>
              </div>
            </article>
            {upNext && <div className="cs2-outreach-next"><span>Up next: <b>{upNext.leadName}</b> · {categoryLabel(upNext.category).toLowerCase()}</span><span>{upNext.whyNow}</span></div>}
          </>
        )}
        {error && <div className="cs2-outreach-error" role="alert">{error}</div>}
      </div>
    </section>
  );
}
