import NativeBookingsWorkspace from "@/components/NativeBookingsWorkspace";
import { Link } from "wouter";
import { ArrowUpRight, FileText, Plus, RefreshCw, Send, Sparkles } from "lucide-react";
import "./quotes-workspace.css";

const money = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const statusLabel = (status: string) => {
  const labels: Record<string, string> = {
    lead: "Draft",
    booked: "Accepted",
    payment_incomplete: "Awaiting payment",
    pending_payment: "Awaiting payment",
    confirmed: "Confirmed",
  };
  return labels[status] ?? status.replace(/_/g, " ");
};

export default function QuotesWorkspace() {
  return (
    <NativeBookingsWorkspace
      realtimeEnabled
      initialView="quotes"
      render={({ rows, funnelListQuery, setQuery, query }: any) => {
        const quoteRows = (rows ?? []) as Array<any>;
        return (
          <main className="quotes-workspace">
            <header className="quotes-hero">
              <div>
                <div className="quotes-kicker"><Sparkles size={15} /> REVENUE WORKSPACE</div>
                <h1>Quotes</h1>
                <p>Every customer quote in one calm, reviewable pipeline.</p>
              </div>
              <Link className="quotes-primary-action" href="/admin/customer-booking-links">
                <Plus size={18} /> New quote
              </Link>
            </header>

            <section className="quotes-toolbar">
              <div className="quotes-toolbar-title">
                <FileText size={19} />
                <div><strong>Sent quotes</strong><span>{quoteRows.length} total</span></div>
              </div>
              <div className="quotes-toolbar-actions">
                <label className="quotes-search">
                  <span className="sr-only">Search quotes</span>
                  <input value={query ?? ""} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, phone, or address" />
                </label>
                <button type="button" className="quotes-refresh" onClick={() => void funnelListQuery?.refetch()} title="Refresh quotes"><RefreshCw size={16} /></button>
              </div>
            </section>

            {funnelListQuery?.isLoading ? (
              <div className="quotes-empty"><RefreshCw className="quotes-spin" size={22} /><p>Loading your quotes…</p></div>
            ) : quoteRows.length === 0 ? (
              <div className="quotes-empty"><Send size={28} /><h2>No quotes yet</h2><p>Create a personalized quote and it will appear here as soon as it is sent.</p><Link href="/admin/customer-booking-links" className="quotes-secondary-action"><Plus size={16} /> Create first quote</Link></div>
            ) : (
              <section className="quotes-grid" aria-label="Sent quotes">
                {quoteRows.map((quote) => (
                  <article className="quote-card" key={quote.key}>
                    <div className="quote-card-topline"><Link className="quote-number quote-number-link" href={`/book/${quote.publicNumber}`} aria-label={`Open quote ${quote.publicNumber}`}>{quote.publicNumber}</Link><span className={`quote-status quote-status--${quote.status}`}>{statusLabel(quote.status)}</span></div>
                    <div className="quote-customer"><div className="quote-avatar">{String(quote.customerName || "?").trim().charAt(0).toUpperCase()}</div><div><h2>{quote.customerName || "Unnamed customer"}</h2><p>{quote.customerPhone || quote.customerEmail || "No contact details"}</p></div></div>
                    <div className="quote-details"><div><span>Service</span><strong>{quote.serviceName || "Home cleaning"}</strong></div><div><span>First cleaning</span><strong>{money(quote.firstCleaningTotalCents)}</strong></div><div><span>Address</span><strong>{quote.address || "Address pending"}</strong></div></div>
                    <div className="quote-card-footer"><span>{quote.requestedLocalDate || "Date pending"}{quote.requestedLocalTime ? ` · ${quote.requestedLocalTime}` : ""}</span><Link href="/admin/bookings" className="quote-open-link">View CRM <ArrowUpRight size={15} /></Link></div>
                  </article>
                ))}
              </section>
            )}
          </main>
        );
      }}
    />
  );
}
