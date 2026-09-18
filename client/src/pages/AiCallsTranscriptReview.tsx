import { useState } from "react";
import { ArrowLeft, AudioLines, Bell, CheckCircle2, Clock3, FileText, Headphones, PhoneIncoming, Play, Sparkles } from "lucide-react";
import "./voice-workspaces-review.css";
import "./ai-calls-transcript-review.css";

type TranscriptTurn = {
  speaker: "Madison" | "Caller" | "System";
  text: string;
  time: string;
};

type TranscriptCall = {
  id: number;
  caller: string;
  phone: string;
  duration: string;
  date: string;
  outcome: string;
  outcomeTone: "amber" | "blue" | "mint";
  summary: string;
  cue: string;
  nextStep: string;
  note: string;
  transcript: TranscriptTurn[];
};

const CALLER_PORTRAITS: Record<string, string> = {
  "Jordan Lee": "/manus-storage/leads-crm-owner-james-taylor_6fac06b4.png",
  "Avery Morgan": "/manus-storage/leads-crm-owner-kate-chen_1285ffcf.png",
  "Casey Rivera": "/manus-storage/leads-crm-owner-hannah-mills_c84fd53e.png",
};

const TRANSCRIPT_CALLS: TranscriptCall[] = [
  {
    id: 1,
    caller: "Jordan Lee",
    phone: "(202) 555-0147",
    duration: "2:18",
    date: "Today · 10:42 AM",
    outcome: "Callback requested",
    outcomeTone: "amber",
    summary: "A short call with a clearly stated afternoon callback window.",
    cue: "Caller is between meetings and wants recurring-service availability before deciding.",
    nextStep: "Call during the 2:00–4:00 PM window",
    note: "No quote was promised. The next human touch is a quick availability discussion.",
    transcript: [
      { speaker: "Madison", time: "00:03", text: "Thanks for calling Maid in Black. I can help with availability or arrange a call from the team." },
      { speaker: "Caller", time: "00:19", text: "I’m between meetings right now. Could someone call me later this afternoon about recurring service?" },
      { speaker: "Madison", time: "00:37", text: "Absolutely. What time works best for you?" },
      { speaker: "Caller", time: "00:44", text: "Sometime between two and four would be great." },
      { speaker: "System", time: "00:48", text: "Preferred callback window captured for the static review example." },
    ],
  },
  {
    id: 2,
    caller: "Avery Morgan",
    phone: "(301) 555-0173",
    duration: "4:06",
    date: "Today · 9:18 AM",
    outcome: "Quote given",
    outcomeTone: "blue",
    summary: "The caller wants a little time to compare the sample quote with a partner.",
    cue: "A positive quote conversation; the decision is paused rather than lost.",
    nextStep: "Prepare a concise after-work follow-up",
    note: "Keep the follow-up focused on timing and the discussed quote range.",
    transcript: [
      { speaker: "Madison", time: "00:06", text: "I can walk through the service options and a sample price range." },
      { speaker: "Caller", time: "00:31", text: "That helps. I want to compare it with my partner before we make a decision." },
      { speaker: "Madison", time: "00:49", text: "Of course. Would an after-work follow-up be useful?" },
      { speaker: "Caller", time: "00:57", text: "Yes, after 5:30 would be perfect." },
      { speaker: "System", time: "01:02", text: "A local follow-up cue is shown here; no outreach was created." },
    ],
  },
  {
    id: 3,
    caller: "Casey Rivera",
    phone: "(703) 555-0129",
    duration: "3:41",
    date: "Yesterday · 4:26 PM",
    outcome: "FAQ answered",
    outcomeTone: "mint",
    summary: "Service-area question resolved, with a requested morning check-in.",
    cue: "The caller needs to coordinate at home before submitting a request.",
    nextStep: "Confirm the 10:00–11:00 AM check-in",
    note: "The review cue is a human check-in, not a confirmed appointment.",
    transcript: [
      { speaker: "Caller", time: "00:09", text: "Do you service my neighborhood?" },
      { speaker: "Madison", time: "00:16", text: "We can confirm availability by area and help with the next step." },
      { speaker: "Caller", time: "00:34", text: "Great. Please call tomorrow morning so I can coordinate at home." },
      { speaker: "Madison", time: "00:43", text: "I’ll note the preferred morning window for the team." },
      { speaker: "System", time: "00:47", text: "Static review cue only — no appointment or callback record changed." },
    ],
  },
];

// Fixed review-only bar geometry: dense irregular peaks and a left-to-right color fade,
// intentionally closer to a real audio silhouette than a repeating CSS pattern.
const WAVEFORM_BARS = [38, 72, 56, 86, 48, 67, 91, 58, 75, 43, 68, 82, 51, 62, 77, 54, 88, 46, 69, 58, 81, 49, 73, 63, 45, 78, 56, 84, 52, 66, 79, 57, 70, 47, 85, 61, 76, 54, 82, 49, 68, 90, 59, 74, 43, 65, 78, 55, 71, 46, 64, 82, 53, 69, 42, 76, 58, 84, 47, 66, 56, 75, 44, 70, 52, 81, 48, 63, 72, 45, 67, 54, 79, 50, 62, 73, 46, 68, 57, 77, 44, 64, 51, 71, 47, 61, 55, 69, 43, 58, 49, 64, 46, 56, 41, 52] as const;

function CallerPortrait({ caller, className }: { caller: string; className: string }) {
  return <img className={className} src={CALLER_PORTRAITS[caller]} alt={`Static review portrait for ${caller}`} />;
}

function ReviewWaveform() {
  return <div className="transcript-waveform" aria-label="Static call waveform" aria-hidden="true">{WAVEFORM_BARS.map((height, index) => <i key={index} className={index < 16 ? "is-blue" : index < 45 ? "is-olive" : index < 58 ? "is-amber" : "is-silver"} style={{ height: `${height}%` }} />)}</div>;
}

export default function AiCallsTranscriptReview() {
  const [selectedId, setSelectedId] = useState(TRANSCRIPT_CALLS[0].id);
  const [notice, setNotice] = useState("Static transcript review · no live recording, call, contact, callback, or transcript is connected");
  const selectedCall = TRANSCRIPT_CALLS.find((call) => call.id === selectedId) ?? TRANSCRIPT_CALLS[0];

  return <main className="voice-review transcript-review" data-review-only="true">
    <header className="voice-utility">
      <div className="transcript-utility-copy"><AudioLines size={17} /><span>AI Calls</span><i /> <small>Transcript-forward review</small></div>
      <div><button type="button" className="voice-utility-bell" aria-label="Static AI call notifications" onClick={() => setNotice("Static preview only — notifications are not connected.")}><Bell size={18} /><i /></button><span className="voice-owner">RG</span></div>
    </header>

    <div className="voice-content voice-content--transcript">
      <section className="transcript-page-head">
        <div>
          <span className="voice-eyebrow">AI Calls · Alternate review</span>
          <h1>Hear the decision in context</h1>
          <p>This second static composition gives the recorded conversation and speaker-attributed transcript the primary visual role.</p>
        </div>
        <a className="transcript-back-link" href="/review/ai-calls"><ArrowLeft size={14} />Command Deck version</a>
      </section>

      <p className="voice-page-status voice-page-status--wide"><Sparkles size={14} />{notice}</p>

      <section className="transcript-lab-layout" aria-label="Static transcript-first AI Calls workspace">
        <aside className="transcript-queue">
          <header><div><span className="voice-eyebrow">Recent calls</span><h2>Conversation queue</h2></div><span>3 static</span></header>
          <div className="transcript-queue-list">
            {TRANSCRIPT_CALLS.map((call) => <button key={call.id} type="button" className={`transcript-queue-row ${selectedCall.id === call.id ? "is-selected" : ""}`} onClick={() => { setSelectedId(call.id); setNotice(`${call.caller} is selected locally. This review does not load a recording or change a callback.`); }}>
              <CallerPortrait caller={call.caller} className="transcript-caller-portrait transcript-caller-portrait--queue" />
              <span className="transcript-queue-copy"><strong>{call.caller}</strong><small>{call.summary}</small><em><Clock3 size={11} />{call.date}</em></span>
              <span className={`transcript-queue-dot is-${call.outcomeTone}`} aria-hidden="true" />
            </button>)}
          </div>
          <footer><FileText size={14} /><span>Selections update locally</span></footer>
        </aside>

        <article className="transcript-main-stage">
          <section className="transcript-listening-card">
            <div className="transcript-listening-head">
              <div className="transcript-caller-identity"><CallerPortrait caller={selectedCall.caller} className="transcript-caller-portrait transcript-caller-portrait--hero" /><div><h2>{selectedCall.caller}</h2><p><PhoneIncoming size={14} />AI-handled inbound call</p></div></div>
              <span className={`transcript-outcome is-${selectedCall.outcomeTone}`}>{selectedCall.outcome}</span>
            </div>
            <div className="transcript-waveform-row"><button type="button" className="transcript-play" aria-label="Static playback unavailable" onClick={() => setNotice("Playback is unavailable in this static review. The waveform is visual evidence only.")}><Play size={17} fill="currentColor" /></button><ReviewWaveform /><span>{selectedCall.duration}</span></div>
            <footer><span><Headphones size={14} />Static recording visualization</span><span>{selectedCall.date}</span></footer>
          </section>

          <section className="transcript-record" aria-label={`Static transcript for ${selectedCall.caller}`}>
            <header><div><span className="voice-eyebrow">Conversation evidence</span><h2>Transcript</h2></div><span className="transcript-record-source">Speaker-attributed · static</span></header>
            <div className="transcript-turns">
              {selectedCall.transcript.map((turn, index) => <article className={`transcript-turn transcript-turn--${turn.speaker.toLowerCase()}`} key={`${turn.speaker}-${index}`}>
                <div className="transcript-speaker"><span className="transcript-speaker-avatar">{turn.speaker === "Caller" ? <CallerPortrait caller={selectedCall.caller} className="transcript-caller-portrait transcript-caller-portrait--turn" /> : turn.speaker === "Madison" ? <Sparkles size={14} /> : <CheckCircle2 size={14} />}</span><strong>{turn.speaker === "Caller" ? selectedCall.caller : turn.speaker === "Madison" ? "Madison · AI assistant" : "Call cue"}</strong><time>{turn.time}</time></div>
                <p>{turn.text}</p>
              </article>)}
            </div>
          </section>
        </article>

        <aside className="transcript-brief">
          <section className="transcript-brief-card transcript-brief-card--signal">
            <span className="voice-eyebrow">Call cue</span><h2>{selectedCall.cue}</h2><div className="transcript-brief-meta"><span>Duration <strong>{selectedCall.duration}</strong></span><span>Contact <strong>{selectedCall.phone}</strong></span></div>
          </section>
          <section className="transcript-brief-card">
            <span className="voice-eyebrow">Recommended next step</span><strong className="transcript-next-step">{selectedCall.nextStep}</strong><button type="button" onClick={() => setNotice(`Follow-up preparation for ${selectedCall.caller} is local-only in this static review.`)}><Sparkles size={14} />Prepare follow-up</button>
          </section>
          <section className="transcript-brief-card transcript-brief-card--note">
            <span className="voice-eyebrow">Reviewer note</span><p>{selectedCall.note}</p>
          </section>
        </aside>
      </section>
    </div>
  </main>;
}
