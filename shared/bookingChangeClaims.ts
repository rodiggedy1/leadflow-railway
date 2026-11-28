/** Booking-change wording checks (2026-11-28). Pure text checks, no AI.
 * A request to cancel, reschedule, skip, pause or change the frequency of a cleaning.
 * Frequency words alone ("a biweekly cleaning") are how new leads ask for a quote, so only a CHANGE of frequency counts. */
const BOOKING_CHANGE_REQUEST = /\bcancel|\breschedul|\bpostpone|\bpush (it|this|my|the|our)\b|\bmove (it|this|my|the|our|to)\b|\bskip|\bpause|\bfrequency\b|\b(change|switch|go|move|reduce|increase|cut)\b[^.?!\n]{0,40}\b(weekly|bi-?weekly|monthly|every (other|two|three|four|2|3|4) weeks?)\b|\bchange (my|the|our)? ?(date|day|time|booking|appointment|cleaning|schedule|plan)\b|\bdifferent (day|date|time)\b|\bnot (be )?(home|available)\b|\bcan'?t make it\b/i;
// Thanks for, or mentions of, a change that was already made ("thanks for rescheduling", "it was moved") are not a
// new request, so the reply to them ("you're all set!") is never blocked.
const ALREADY_MADE = /\b(thanks?|thank you|thx|appreciate( it)?)( so much| very much)?( for)?( the| you)? (cancel\w*|reschedul\w*|mov\w*|chang\w*|skipp\w*|paus\w*|updat\w*)|\b(was|were|been|got|is|are|it'?s|now) (cancel(l)?ed|rescheduled|moved|changed|skipped|paused|updated)\b/gi;
/** True when the text asks for a booking change of any kind. */
export function looksLikeBookingChange(...texts: Array<string | null | undefined>): boolean {
  return texts.some(text => BOOKING_CHANGE_REQUEST.test((text ?? "").replace(ALREADY_MADE, " ")));
}

// Verbs that always describe a booking change; softer verbs count only in a sentence about the booking itself
// ("we've updated your booking" counts, "we updated your notes" does not).
const CHANGE_VERB = "(cancel(l)?ed|rescheduled|moved|skipped|paused|postponed)";
const SOFT_VERB = "(changed|updated|switched|removed|confirmed|completed|processed|taken care of|done)";
const BOOKING_WORDS = /\b(booking|appointment|cleaning|visit|service|schedule|frequency|date|time|day|plan|change|request|cancellation|reschedule)s?\b/i;
const HAS_DONE = `(i|we)('ve| have| just| already| went ahead and)* ?(gone ahead and )?`;
const WAS_DONE = `(has|have|'s|is|are|was|were) (now |already |just |been |all )*`;
const CHANGE_CLAIMS = [new RegExp(`\\b${HAS_DONE}${CHANGE_VERB}\\b`, "i"), new RegExp(`\\b${WAS_DONE}${CHANGE_VERB}\\b`, "i")];
const SOFT_CLAIMS = [new RegExp(`\\b${HAS_DONE}${SOFT_VERB}\\b`, "i"), new RegExp(`\\b${WAS_DONE}${SOFT_VERB}\\b`, "i")];
const ALL_SET = /\b(all set|you'?re set|it'?s done|that'?s done|done!)/i;
// "We'll cancel", "once it's been rescheduled", "if it's cancelled": future or conditional, allowed.
const FUTURE = /\b(will|'ll|going to|once|if|when|as soon as|shall|let me|let us|happy to|able to)\b/i;
/** True when a reply says a booking change has already been made. Each sentence is checked on its own; a sentence that
 * only talks about the future ("we'll cancel it and confirm") does not count. */
export function claimsBookingChangeDone(reply: string): boolean {
  return reply.split(/(?<=[.!?\n])\s+/).some(sentence => !FUTURE.test(sentence) && (CHANGE_CLAIMS.some(pattern => pattern.test(sentence))
    || ALL_SET.test(sentence) || (BOOKING_WORDS.test(sentence) && SOFT_CLAIMS.some(pattern => pattern.test(sentence)))));
}
