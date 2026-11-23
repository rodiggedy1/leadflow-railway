import { StickyNote, Loader2, RefreshCw, MessageSquare, Phone, ArrowDownLeft, ArrowUpRight, Check } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { LeadCallNote } from "@shared/leadCallNotes";
import "./lead-call-notes.css";

type Lead = { name: string; phone: string | null; sessionId: number | null };

export function LeadCallNotesButton({ name, onOpen }: { name: string; onOpen: (button: HTMLButtonElement) => void }) {
  return <button type="button" className="lcn-note-button" title="Call notes" aria-label={`View call notes for ${name}`} aria-haspopup="dialog"
    onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onOpen(event.currentTarget); }}><StickyNote aria-hidden="true" /></button>;
}

const speakers = /^(Assistant|AI|User|Caller|Customer|Client|Staff|Agent|Unattributed)$/i;
export type CallReadingTurn = { speaker: string | null; paragraphs: string[] };
/** Presentation only: preserve saved words and never infer a speaker from a phone/ID. */
export function callNotesTranscriptTurns(transcript: string): CallReadingTurn[] {
  const paragraphs = (text: string) => text.match(/(?:\s*\S+){1,60}\s*/g) ?? [text];
  try {
    const value: unknown = JSON.parse(transcript);
    if (Array.isArray(value)) return value.flatMap(turn => {
      if (!turn || typeof turn !== "object" || typeof turn.content !== "string" || !turn.content.trim()) return [];
      const label = typeof turn.identifier === "string" && speakers.test(turn.identifier.trim()) ? turn.identifier.trim() : null;
      return [{ speaker: label, paragraphs: paragraphs(turn.content) }];
    });
  } catch { /* Existing plain-text call transcripts are also supported. */ }
  return transcript.split(/(?=^[\t ]*(?:Assistant|AI|User|Caller|Customer|Client|Staff|Agent|Unattributed):)/im).filter(block => block.trim()).map(block => {
    const match = block.match(/^[\t ]*(Assistant|AI|User|Caller|Customer|Client|Staff|Agent|Unattributed):([\s\S]*)$/i);
    return { speaker: match?.[1] ?? null, paragraphs: paragraphs(match?.[2] ?? block) };
  });
}

function callDate(value: number) {
  return new Date(value).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function callDuration(seconds: number | null) {
  if (seconds === null) return null;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export function LeadCallNotesHistory({ calls }: { calls: LeadCallNote[] }) {
  if (!calls.length) return <div className="lcn-empty"><StickyNote aria-hidden="true" /><strong>No call notes yet</strong><p>Saved call details will appear here after a call with this customer is processed.</p></div>;
  return <div className="lcn-history">{calls.map(call => {
    const turns = call.transcript ? callNotesTranscriptTurns(call.transcript) : [];
    return <article className="lcn-call" key={call.id}>
      <header><span className={`lcn-source is-${call.source}`}><Phone aria-hidden="true" />{call.source === "madison" ? "Madison" : call.source === "outbound_ai" ? "AI call" : "Staff call"}</span><time dateTime={new Date(call.startedAt).toISOString()}>{callDate(call.startedAt)}</time></header>
      <div className="lcn-call-meta"><span>{call.direction === "incoming" ? <ArrowDownLeft aria-hidden="true" /> : <ArrowUpRight aria-hidden="true" />}{call.direction === "incoming" ? "Incoming" : "Outgoing"}</span>{callDuration(call.durationSeconds) && <span>{callDuration(call.durationSeconds)}</span>}{call.outcome && <span>{call.outcome.replace(/_/g, " ")}</span>}</div>
      <section aria-label="Saved call summary"><h3>{call.source === "staff" ? "AI call summary" : "Call summary"}</h3>{call.summary ? <p className="lcn-summary">{call.summary}</p> : <p className="lcn-muted">No saved call summary yet.</p>}</section>
      {call.details.length > 0 && <section aria-label="Saved call details"><h3>Details from the call</h3><dl>{call.details.map((detail, index) => <div key={`${detail.label}-${index}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl></section>}
      {call.followUps.length > 0 && <section aria-label="Recorded requests and follow-ups"><h3>Requests &amp; follow-ups</h3><ul className="lcn-followups">{call.followUps.map((item, index) => <li key={`${item.taskId}-${index}`}><div><strong>{item.title}</strong><span className={item.status === "done" ? "is-done" : "is-open"}>{item.status === "done" && <Check aria-hidden="true" />}{item.status === "done" ? "Done" : "Open"}</span></div><blockquote>{item.evidenceQuote}</blockquote></li>)}</ul></section>}
      {turns.length > 0 && <details className="lcn-transcript"><summary><MessageSquare aria-hidden="true" />Full transcript</summary>{turns.some(turn => !turn.speaker || /^unattributed$/i.test(turn.speaker)) && <p className="lcn-muted">Some saved transcript speakers are not identified.</p>}{turns.map((turn, index) => <div className="lcn-transcript-turn" key={index}>{turn.speaker && <strong>{turn.speaker}:</strong>}{turn.paragraphs.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>)}</div>)}</details>}
    </article>;
  })}</div>;
}

/** Mounted only when a lead's note icon is opened. No polling or generation. */
export function LeadCallNotesDialog({ lead, onClose, returnFocus }: { lead: Lead; onClose: () => void; returnFocus: () => void }) {
  const linked = Boolean(lead.phone || lead.sessionId);
  const query = trpc.voice.getLeadCallNotes.useQuery({ sessionId: lead.sessionId, phone: lead.phone }, {
    enabled: linked, staleTime: 30_000, refetchOnMount: "always", refetchOnWindowFocus: false, retry: false,
  });
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="lcn-dialog" onCloseAutoFocus={event => { event.preventDefault(); returnFocus(); }}>
      <div className="lcn-heading"><span><StickyNote aria-hidden="true" /></span><div><DialogTitle>Call notes</DialogTitle><DialogDescription>{lead.name}{lead.phone && ` · ${lead.phone}`}</DialogDescription></div></div>
      <div className="lcn-toolbar"><p>Calls with this customer · newest first</p><button type="button" title="Refresh call notes" aria-label="Refresh call notes" disabled={!linked || query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}</button></div>
      <div className="lcn-body">
        {!linked ? <div className="lcn-empty"><strong>No phone number attached yet</strong><p>Call details can be matched once this lead has a phone number.</p></div>
          : query.isLoading ? <div className="lcn-empty" role="status"><Loader2 className="animate-spin" aria-hidden="true" /><p>Loading call notes…</p></div>
          : query.isError ? <div className="lcn-empty" role="alert"><strong>Call notes couldn’t be loaded</strong><p>Please use Refresh to try again.</p></div>
          : <LeadCallNotesHistory calls={query.data?.calls ?? []} />}
      </div>
      <p className="lcn-footnote">Existing saved summaries, call details and follow-ups. Opening notes does not create or change tasks.</p>
    </DialogContent>
  </Dialog>;
}
