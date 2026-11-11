import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, CreditCard, Send, Smartphone } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./internal-booking-thank-you.css";

type Method = "apple_pay" | "cashapp" | "card";
type Overview = {
  bookingId: number;
  publicBookingNumber: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  address: string;
  requestedLocalDate: string;
  arrivalLabel: string;
  serviceName: string;
  firstCleaningTotalCents: number;
  paymentStatus: string | null;
  cardLabel: string | null;
};
type CreatedLink = {
  bookingId: number;
  method: Method;
  token: string;
  url: string;
  expiresAt: string | Date;
  amountCents: number;
  customerName: string;
  customerPhone: string | null;
  message: string;
  paymentStatus?: string | null;
};
type CreateInput = { bookingId: number; method: Method; requestId: string; expectedAmountCents: number; confirmed: true };
type SendInput = { bookingId: number; method: Method; token: string; message: string; confirmed: true };
type Attempt = { input: CreateInput; link?: CreatedLink; message?: string; sendInput?: SendInput; accepted?: boolean };
const actions: ReadonlyArray<{ method: Method; title: string; label: string; detail: string }> = [
  { method: "apple_pay", title: "Send Apple Pay card-on-file link", label: "Apple Pay", detail: "Save a card through Apple Pay on a compatible device. No charge is made through this link." },
  { method: "cashapp", title: "Send Cash App payment link", label: "Cash App", detail: "Immediate payment for the first cleaning only." },
  { method: "card", title: "Send card-on-file link", label: "Card on file", detail: "Save a card only. No charge is made through this link." },
];
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const savedText = (value: string | null | undefined) => value?.trim() || "Not available";
function safeError(error: unknown, fallback: string) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return "Your staff session could not be verified. Sign in again before continuing.";
  if (code === "CONFLICT" || code === "BAD_REQUEST") return "The booking or link could not be verified. Refresh the saved summary and review it before retrying.";
  if (code === "NOT_FOUND") return "The saved booking or payment-link service is unavailable. Review the booking in the CRM.";
  return fallback;
}
function validUrl(value: string) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}
function usableLink(link: CreatedLink, bookingId: number, method: Method, amount: number) {
  const expires = new Date(link.expiresAt).getTime();
  return link.bookingId === bookingId && link.method === method && link.amountCents === amount
    && typeof link.token === "string" && !!link.token.trim() && typeof link.url === "string" && validUrl(link.url)
    && typeof link.message === "string" && !!link.message.trim() && Number.isFinite(expires) && expires > Date.now();
}

/** Staff-only handoff. Mounting reads saved booking data; every mutation requires an explicit click. */
export default function InternalBookingThankYou(props: {
  bookingId: number | undefined;
  onStartAnotherBooking: () => void;
  onOpenBookings: () => void;
}) {
  // A native target change unmounts the old request owner, including pending async callbacks.
  return <BookingHandoff key={props.bookingId ?? "missing"} {...props} />;
}

function BookingHandoff({ bookingId, onStartAnotherBooking, onOpenBookings }: {
  bookingId: number | undefined;
  onStartAnotherBooking: () => void;
  onOpenBookings: () => void;
}) {
  const targetValid = typeof bookingId === "number" && Number.isSafeInteger(bookingId) && bookingId > 0;
  const handoff = trpc.bookingPaymentAdmin.handoff;
  const overviewQuery = handoff.overview.useQuery({ bookingId: bookingId ?? 0 }, {
    enabled: targetValid, refetchInterval: false, refetchOnWindowFocus: false,
  });
  const create = handoff.create.useMutation();
  const send = handoff.send.useMutation();
  const overview: Overview | undefined = overviewQuery.data;
  const summary = !overviewQuery.isError && targetValid && overview?.bookingId === bookingId ? overview : undefined;
  const amountValid = !!summary && Number.isSafeInteger(summary.firstCleaningTotalCents) && summary.firstCleaningTotalCents >= 0;
  const canReview = !!summary && amountValid && !overviewQuery.isFetching;
  const [selection, setSelection] = useState<{ method: Method; mode: "send" | "copy" } | null>(null);
  const [busy, setBusy] = useState<"create" | "send" | "copy" | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const attempts = useRef<Partial<Record<Method, Attempt>>>({});
  const lock = useRef(false);
  const owner = useRef({ active: true, bookingId });
  const reviewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    owner.current.active = true;
    return () => { owner.current.active = false; };
  }, []);
  useEffect(() => { if (selection) reviewRef.current?.focus(); }, [selection]);
  const current = () => owner.current.active && owner.current.bookingId === bookingId;
  const attempt = selection ? attempts.current[selection.method] : undefined;
  const link = attempt?.link;
  const linkReady = !!(link && summary && selection && usableLink(link, bookingId!, selection.method, summary.firstCleaningTotalCents));
  const action = actions.find(item => item.method === selection?.method);
  const refresh = () => {
    if (!current() || lock.current || !targetValid) return;
    setSelection(null);
    setNotice(null);
    void overviewQuery.refetch();
  };
  const choose = (method: Method, mode: "send" | "copy") => {
    if (!current() || lock.current || !canReview) return;
    setNotice(null);
    setSelection({ method, mode });
  };
  const createForReview = async () => {
    if (!current() || lock.current || !selection || !summary || !canReview) return;
    lock.current = true;
    setBusy("create");
    setNotice(null);
    const method = selection.method;
    let request = attempts.current[method];
    try {
      if (!request || request.input.expectedAmountCents !== summary.firstCleaningTotalCents) {
        request = { input: { bookingId: bookingId!, method, requestId: crypto.randomUUID(), expectedAmountCents: summary.firstCleaningTotalCents, confirmed: true } };
        attempts.current[method] = request;
      }
      // An unchanged retry reuses the same UUID; an already-created link is never recreated automatically.
      const result: CreatedLink = await create.mutateAsync(request.input);
      if (!current() || attempts.current[method] !== request) return;
      if (!usableLink(result, bookingId!, method, request.input.expectedAmountCents)) {
        setNotice({ error: true, text: "The returned link could not be verified for this booking, amount, or expiry. Nothing was sent or copied." });
        return;
      }
      request.link = result;
      request.message = result.message;
      setRevision(value => value + 1);
    } catch (error) {
      if (current()) setNotice({ error: true, text: safeError(error, "Link creation was not confirmed. Nothing was sent or copied. Retry keeps the same request reference.") });
    } finally {
      if (current()) { lock.current = false; setBusy(null); }
    }
  };
  const confirmSend = async () => {
    if (!current() || lock.current || !canReview || !linkReady || !attempt || !link || !selection || selection.mode !== "send" || attempt.accepted) return;
    if (!summary || !usableLink(link, bookingId!, selection.method, summary.firstCleaningTotalCents)) {
      setNotice({ error: true, text: "This link is no longer valid for the saved booking. Nothing was sent." });
      return;
    }
    const message = attempt.message ?? "";
    if (!link.customerPhone?.trim() || !message.trim() || !message.includes(link.url)) {
      setNotice({ error: true, text: "A saved recipient and a message containing the reviewed link are required. Nothing was sent." });
      return;
    }
    lock.current = true;
    setBusy("send");
    setNotice(null);
    const request = attempt;
    // Freeze the exact reviewed message/token. Unchanged retries submit identical input.
    if (!request.sendInput || request.sendInput.message !== message) {
      request.sendInput = { bookingId: bookingId!, method: selection.method, token: link.token, message, confirmed: true };
    }
    try {
      const result = await send.mutateAsync(request.sendInput);
      if (!current() || attempts.current[selection.method] !== request) return;
      if (result.success !== true || result.submitted === false) {
        setNotice({ error: true, text: "Send was not confirmed. Delivery status is unknown. Retry uses the same link and unchanged message; do not assume the customer received it." });
        return;
      }
      request.accepted = true;
      setRevision(value => value + 1);
      setNotice({ error: false, text: result.submitted === true
        ? "Message submitted to the messaging provider. Delivery is not confirmed."
        : "Send request accepted. Delivery is not confirmed." });
      // A read-only refresh may reveal an updated payment status; it is not proof of payment or delivery.
      void overviewQuery.refetch();
    } catch (error) {
      if (current()) setNotice({ error: true, text: safeError(error, "Send was not confirmed. Delivery status is unknown. Retry uses the same link and unchanged message.") });
    } finally {
      if (current()) { lock.current = false; setBusy(null); }
    }
  };
  const copyLink = async () => {
    if (!current() || lock.current || !canReview || !linkReady || !link || !selection) return;
    if (!summary || !usableLink(link, bookingId!, selection.method, summary.firstCleaningTotalCents)) {
      setNotice({ error: true, text: "This link is no longer valid for the saved booking. Nothing was copied." });
      return;
    }
    lock.current = true;
    setBusy("copy");
    setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(link.url);
      if (current()) setNotice({ error: false, text: "Link copied. No message was sent." });
    } catch {
      if (current()) setNotice({ error: true, text: "Could not copy the link. Select and copy the reviewed URL manually. No message was sent." });
    } finally {
      if (current()) { lock.current = false; setBusy(null); }
    }
  };

  return (
    <main className="internal-booking-thank-you" data-revision={revision}>
      <header className="ibty-heading">
        <span className="ibty-check" aria-hidden="true"><Check /></span>
        <div><p className="ibty-eyebrow">INTERNAL BOOKING · STAFF HANDOFF</p><h1>Booking created</h1><p>Review the saved booking, then choose an optional customer payment link.</p></div>
      </header>
      {!targetValid ? <p role="alert" className="ibty-error">The saved native booking ID is unavailable. Review the booking in the CRM. Payment-link actions are disabled.</p>
        : overviewQuery.isError ? <p role="alert" className="ibty-error">{safeError(overviewQuery.error, "The saved booking summary could not be loaded. Payment-link actions are disabled.")}</p>
        : !summary ? <p role={overviewQuery.isPending ? "status" : "alert"}>{overviewQuery.isPending ? "Loading the server-saved booking summary…" : "The saved booking could not be verified. Payment-link actions are disabled."}</p>
        : <section className="ibty-summary" aria-label="Server-saved booking summary">
          <div className="ibty-summary-top"><strong>{savedText(summary.customerName)}</strong><span>Booking {savedText(summary.publicBookingNumber)}</span></div>
          <dl>
            <div><dt>Cleaning</dt><dd>{savedText(summary.serviceName)}</dd></div>
            <div><dt>Date / arrival</dt><dd>{savedText(summary.requestedLocalDate)}<br />{savedText(summary.arrivalLabel)}</dd></div>
            <div><dt>Service address</dt><dd>{savedText(summary.address)}</dd></div>
            <div><dt>First cleaning total</dt><dd>{amountValid ? money(summary.firstCleaningTotalCents) : "Amount unavailable"}</dd></div>
            <div><dt>Actual payment status</dt><dd>{savedText(summary.paymentStatus)}{summary.cardLabel ? <small>{summary.cardLabel}</small> : null}</dd></div>
            <div><dt>Customer contact</dt><dd>{savedText(summary.customerPhone)}<small>{savedText(summary.customerEmail)}</small></dd></div>
          </dl>
        </section>}
      {targetValid && <button className="ibty-text-button" type="button" disabled={!!busy || overviewQuery.isFetching} onClick={refresh}>{overviewQuery.isFetching ? "Refreshing saved summary…" : "Refresh saved summary"}</button>}
      <section aria-labelledby="ibty-actions-title" className="ibty-actions">
        <div className="ibty-section-heading"><h2 id="ibty-actions-title">Customer payment handoff</h2><p>No link is created or sent until you review and confirm. Creating or copying a link does not charge the customer.</p></div>
        <div className="ibty-action-grid">{actions.map(item => (
          <article className="ibty-action" key={item.method}>
            <span className="ibty-action-icon" aria-hidden="true">{item.method === "card" ? <CreditCard /> : <Smartphone />}</span>
            <h3>{item.title}</h3><p>{item.detail}</p>
            <div className="ibty-card-buttons">
              <button type="button" className="ibty-primary" disabled={!canReview || !!busy} onClick={() => choose(item.method, "send")} aria-label={`Send link: ${item.label}`}><Send aria-hidden="true" />Send link</button>
              <button type="button" disabled={!canReview || !!busy} onClick={() => choose(item.method, "copy")} aria-label={`Copy link: ${item.label}`}><Copy aria-hidden="true" />Copy link</button>
            </div>
          </article>
        ))}</div>
      </section>
      {selection && action && <section className="ibty-review" ref={reviewRef} tabIndex={-1} aria-labelledby="ibty-review-title" aria-busy={!!busy}>
        <div className="ibty-review-top"><h2 id="ibty-review-title">Review {action.label} link</h2><button type="button" disabled={!!busy} onClick={() => { setSelection(null); setNotice(null); }}>Cancel review</button></div>
        <p>{action.detail}</p>
        <dl className="ibty-review-facts"><div><dt>Customer</dt><dd>{savedText(linkReady ? link?.customerName : summary?.customerName)}</dd></div><div><dt>Recipient · SMS</dt><dd>{savedText(linkReady ? link?.customerPhone : summary?.customerPhone)}</dd></div><div><dt>{selection.method === "cashapp" ? "Immediate first-cleaning payment" : "Saved booking amount (no charge)"}</dt><dd>{summary && amountValid ? money(summary.firstCleaningTotalCents) : "Amount unavailable"}</dd></div></dl>
        {!link ? <><p>A link and message have not been created. Confirm creation, then review the returned URL and message before sending.</p><button type="button" className="ibty-primary" disabled={!canReview || !!busy} onClick={() => void createForReview()}>{busy === "create" ? "Creating link…" : "Create link for review"}</button></>
          : !linkReady ? <p role="alert" className="ibty-error">This link has expired or no longer matches the saved booking amount. Do not send it. Refresh the summary and review this booking in the CRM.</p>
          : <>
            <label className="ibty-field">Review link<input readOnly value={link.url} aria-label="Review link" onFocus={event => event.currentTarget.select()} /></label>
            <p className="ibty-expiry">Expires {new Date(link.expiresAt).toLocaleString("en-US")}. No payment is confirmed by creating this link.</p>
            <label className="ibty-field">Review message<textarea aria-label="Review message" rows={4} value={attempt?.message ?? ""} disabled={!!busy || !!attempt?.accepted} onChange={event => { if (!attempt || lock.current || attempt.accepted) return; attempt.message = event.currentTarget.value; setNotice(null); setRevision(value => value + 1); }} /></label>
            {!link.customerPhone?.trim() && <p role="alert" className="ibty-error">No saved phone recipient is available. Sending is disabled; you may copy the link.</p>}
            <div className="ibty-review-buttons">{selection.mode === "send" && <button type="button" className="ibty-primary" disabled={!canReview || !!busy || !!attempt?.accepted || !link.customerPhone?.trim() || !attempt?.message?.trim() || !attempt.message.includes(link.url)} onClick={() => void confirmSend()}>{busy === "send" ? "Submitting…" : attempt?.accepted ? "Send accepted · delivery unconfirmed" : "Confirm Send"}</button>}<button type="button" disabled={!canReview || !!busy} onClick={() => void copyLink()}><Copy aria-hidden="true" />{busy === "copy" ? "Copying…" : "Copy link"}</button></div>
          </>}
      </section>}
      {notice && <p className={notice.error ? "ibty-error" : "ibty-notice"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      <footer className="ibty-footer"><button type="button" onClick={onOpenBookings}><ArrowLeft aria-hidden="true" />Back to Booking CRM</button><button type="button" className="ibty-primary" onClick={onStartAnotherBooking}>Create another booking</button></footer>
    </main>
  );
}
