import { useMemo, useState } from "react";
import { ArrowUpRight, AudioLines, Bell, CalendarDays, CheckCircle2, ChevronRight, CreditCard, Ellipsis, Headphones, Home, House, Mail, MapPin, MessageCircle, MoreHorizontal, Phone, Play, Plus, RefreshCw, Send, ShieldCheck, Sparkles, UserRound, Users } from "lucide-react";
import "./customer-profile-review.css";
import "./customer-profile-portraits.css";
import "./customer-profile-messages-command-stream.css";

type CustomerProfileTab = "overview" | "bookings" | "messages" | "payments" | "my-home";

const TABS: Array<{ id: CustomerProfileTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "bookings", label: "Bookings" },
  { id: "messages", label: "Messages" },
  { id: "payments", label: "Payments" },
  { id: "my-home", label: "My Home" },
];

const STATIC_BOOKINGS = [
  { id: "sample-upcoming", label: "Upcoming visit", service: "Recurring home service", date: "Tue, Sep 15 · 10:00 AM", status: "Confirmed", price: "$184", team: "Team North", tone: "mint" },
  { id: "sample-complete-a", label: "Completed visit", service: "Deep home service", date: "Tue, Sep 1 · 9:00 AM", status: "Completed", price: "$246", team: "Team Central", tone: "violet" },
  { id: "sample-complete-b", label: "Completed visit", service: "Recurring home service", date: "Tue, Aug 18 · 10:00 AM", status: "Completed", price: "$184", team: "Team North", tone: "blue" },
];

const STATIC_MESSAGES = [
  { sender: "Customer", time: "Today · 9:12 AM", body: "Hi — the entry instructions are in the booking notes. Thank you!", kind: "customer" },
  { sender: "MIB team", time: "Today · 9:16 AM", body: "Thanks. Your service team has the updated note for the upcoming visit.", kind: "team" },
  { sender: "Customer", time: "Sep 1 · 3:42 PM", body: "The deep cleaning looked great. Please keep the same timing for the next visit.", kind: "customer" },
];

const STATIC_ACTIVITY = [
  { label: "Upcoming visit confirmed", detail: "Recurring home service · Tue, Sep 15", time: "Today", icon: CalendarDays, tone: "mint" },
  { label: "Customer portal viewed", detail: "Static portal context · review only", time: "Yesterday", icon: House, tone: "violet" },
  { label: "Payment method verified", detail: "Static card-on-file indicator", time: "Sep 1", icon: ShieldCheck, tone: "blue" },
];

const STATIC_CUSTOMER_PORTRAIT = "/manus-storage/leads-crm-owner-emma-green_55d28723.png";
const STATIC_TEAM_PORTRAIT = "/manus-storage/leads-crm-owner-kate-chen_1285ffcf.png";
const CUSTOMER_CALL_BARS = [43, 78, 56, 88, 49, 67, 91, 59, 74, 45, 69, 82, 52, 64, 78, 54, 87, 47, 72, 58, 81, 51, 73, 63, 46, 77, 55, 84, 50, 68, 80, 57, 71, 48, 86, 61, 75, 54, 82, 51, 67, 89, 59, 73, 44, 65, 78, 55, 70, 46, 63, 80, 52, 69, 43, 76] as const;

function StaticAction({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return <button type="button" className={className} onClick={onClick}>{label}</button>;
}

function CustomerAiSummary() {
  return <aside className="cpr-overview-ai-summary cpr-overview-ai-note" aria-label="Static Customer AI Summary"><header><span>AI Summary</span><b>Internal</b></header><p className="cpr-overview-ai-brief">For the upcoming static service, Team North is scheduled for Tuesday, Sep 15, from 10:00 AM to 1:00 PM. The sample customer context requests the same team, a text on arrival, and the front door locked after service; review the last service notes, then send a concise arrival confirmation.</p></aside>;
}

function BookingCard({ booking, onClick }: { booking: typeof STATIC_BOOKINGS[number]; onClick: () => void }) {
  return <button type="button" className="cpr-booking-card" onClick={onClick} aria-label={`Open static ${booking.service} booking`}>
    <span className={`cpr-booking-icon ${booking.tone}`}><CalendarDays size={16} /></span>
    <span className="cpr-booking-copy"><small>{booking.label}</small><strong>{booking.service}</strong><em>{booking.date} · {booking.team}</em></span>
    <span className="cpr-booking-meta"><b>{booking.price}</b><i className={booking.status === "Confirmed" ? "is-confirmed" : ""}>{booking.status}</i></span>
    <ChevronRight size={16} />
  </button>;
}

function OverviewTab({ staticAction }: { staticAction: (label: string) => void }) {
  return <div className="cpr-overview-grid">
    <section className="cpr-main-stack">
      <article className="cpr-next-service">
        <header className="cpr-next-service-header"><span><CalendarDays />Upcoming service</span><div><b><i />Scheduled</b><button type="button" aria-label="More static service options" onClick={() => staticAction("Service options")}><MoreHorizontal /></button></div></header><div className="cpr-next-service-copy"><h2>Next cleaning is scheduled.</h2><p>Recurring service · 3 bedrooms · 2 bathrooms · Bi-weekly</p></div><div className="cpr-service-facts"><section><span><CalendarDays /></span><div><small>Date & time</small><strong>Tue, Sep 15, 2025</strong><em>10:00 AM – 1:00 PM</em></div></section><section><span><MapPin /></span><div><small>Address</small><strong>123 Example Street</strong><em>Washington, DC 20001</em></div></section><section><span><Users /></span><div><small>Team</small><strong>Team North</strong><em><i />Confirmed</em></div></section><section><span><RefreshCw /></span><div><small>Frequency</small><strong>Every 2 weeks</strong><em>Next: Sep 29, 2025</em></div></section></div><section className="cpr-service-all-set"><span><Sparkles /></span><div><strong>All set</strong><p>Client has been notified. Team is confirmed. No action needed.</p></div><StaticAction label="View service details" onClick={() => staticAction("Booking detail")} className="cpr-service-detail-button" /></section><div className="cpr-hero-actions cpr-reference-actions"><StaticAction label="Open booking" onClick={() => staticAction("Booking detail")} className="cpr-primary-button" /><StaticAction label="Request a change" onClick={() => staticAction("Schedule request")} className="cpr-secondary-button" /><StaticAction label="Add extras" onClick={() => staticAction("Extras request")} className="cpr-secondary-button" /><StaticAction label="More" onClick={() => staticAction("Service options")} className="cpr-secondary-button" /></div><section className="cpr-service-note"><span><MessageCircle /></span><div><strong>Client notes</strong><p>Prefers the same team. Please lock the front door and text on arrival.</p></div><button type="button" onClick={() => staticAction("Client notes")} aria-label="Edit static client notes"><Ellipsis /></button></section>
      </article>

      <section className="cpr-summary-grid" aria-label="Static customer profile summary">
        <article><span className="coral"><CalendarDays size={16} /></span><div><small>TOTAL BOOKINGS</small><strong>8</strong><p>Since static account creation</p></div></article>
        <article><span className="blue"><CreditCard size={16} /></span><div><small>AVG. SERVICE</small><strong>$202</strong><p>Static all-time average</p></div></article>
        <article><span className="mint"><Sparkles size={16} /></span><div><small>PLAN</small><strong>Bi-weekly</strong><p>Recurring service profile</p></div></article>
        <article><span className="violet"><MessageCircle size={16} /></span><div><small>LAST MESSAGE</small><strong>Today</strong><p>Customer conversation</p></div></article>
      </section>

      <section className="cpr-panel cpr-bookings-panel"><header><div><small>BOOKING HISTORY</small><h2>Services at a glance</h2></div><StaticAction label="View all" onClick={() => staticAction("Booking history")} className="cpr-link-button" /></header><div>{STATIC_BOOKINGS.map(booking => <BookingCard key={booking.id} booking={booking} onClick={() => staticAction(`${booking.service} detail`)} />)}</div></section>
    </section>
    <aside className="cpr-side-stack">
      <CustomerAiSummary />
      <section className="cpr-panel cpr-home-panel"><header><div><small>MY HOME</small><h2>Saved home context</h2></div><House size={18} /></header><p className="cpr-address"><MapPin size={15} />123 Example Street<br /><span>Washington, DC 20008</span></p><div className="cpr-home-specs"><span><b>3</b> Bedrooms</span><span><b>2</b> Bathrooms</span><span><b>2,100</b> sq ft</span></div><div className="cpr-home-note"><span>STATIC SERVICE NOTE</span><p>Customer preference: confirm arrival timing before the visit.</p></div><StaticAction label="Edit static home context" onClick={() => staticAction("Home context")} className="cpr-block-button" /></section>
      <section className="cpr-panel cpr-message-preview"><header><div><small>RECENT CONVERSATION</small><h2>Customer message</h2></div><MessageCircle size={18} /></header><p>“The entry instructions are in the booking notes. Thank you!”</p><div><span>Customer · Today, 9:12 AM</span><StaticAction label="Open messages" onClick={() => staticAction("Messages")} className="cpr-link-button" /></div></section>
    </aside>
  </div>;
}

function BookingsTab({ staticAction }: { staticAction: (label: string) => void }) {
  return <section className="cpr-tab-page"><header className="cpr-tab-page-header"><div><small>STATIC BOOKING HISTORY</small><h2>Appointments and service records</h2><p>All dates, prices, teams, and statuses are isolated review samples.</p></div><StaticAction label="New static booking" onClick={() => staticAction("New booking")} className="cpr-primary-button" /></header><div className="cpr-booking-history">{STATIC_BOOKINGS.map(booking => <BookingCard key={booking.id} booking={booking} onClick={() => staticAction(`${booking.service} detail`)} />)}<article className="cpr-booking-empty"><Plus size={17} /><div><strong>More booking history</strong><span>Additional static past and future service records would appear here.</span></div></article></div></section>;
}

function CustomerCallEvidence({ staticAction }: { staticAction: (label: string) => void }) {
  return <article className="cpr-customer-call" aria-label="Static call evidence for Sample household A"><header><div className="cpr-customer-call-identity"><img src={STATIC_CUSTOMER_PORTRAIT} alt="Static sample customer portrait" /><span><strong>Sample household — A</strong><small><AudioLines />AI-handled inbound call</small></span></div><b>Callback requested</b></header><div className="cpr-customer-call-player"><button type="button" aria-label="Play static customer call evidence" onClick={() => staticAction("Call playback")}><Play size={14} fill="currentColor" /></button><span className="cpr-customer-waveform" aria-hidden="true">{CUSTOMER_CALL_BARS.map((height, index) => <i key={index} className={index < 10 ? "is-blue" : index < 29 ? "is-olive" : index < 40 ? "is-amber" : "is-silver"} style={{ height: `${height}%` }} />)}</span><time>2:18</time></div><footer><span><Headphones />Static recording visualization</span><time>Today · 9:14 AM</time></footer></article>;
}

function MessagesTab({ staticAction }: { staticAction: (label: string) => void }) {
  const [draft, setDraft] = useState("");
  const renderMessage = (message: typeof STATIC_MESSAGES[number], index: number) => <article className={`cpr-command-message ${message.kind === "team" ? "is-team" : "is-customer"}`} key={`${message.time}-${index}`}><img src={message.kind === "customer" ? STATIC_CUSTOMER_PORTRAIT : STATIC_TEAM_PORTRAIT} alt={message.kind === "customer" ? "Static sample customer portrait" : "Static MIB team portrait"} /><div className="cpr-command-message-copy"><div className="cpr-command-message-meta"><strong>{message.sender}</strong><em>{message.kind === "customer" ? "Customer" : "MIB team"}</em><time>{message.time}</time></div><p>{message.body}</p></div></article>;
  return <section className="cpr-tab-page cpr-messages-page cpr-command-messages-page"><header className="cpr-tab-page-header"><div><small>STATIC MESSAGE CONTEXT</small><h2>Customer conversation</h2><p>Local review stream only; no message, call, recording, or callback is connected.</p></div><span className="cpr-thread-status">Active customer thread</span></header><div className="cpr-command-message-layout"><section className="cpr-command-thread" aria-label="Static customer message and call stream"><header className="cpr-command-thread-header"><div><span><MessageCircle /></span><p><strong>Customer messages</strong><small>Conversation and call evidence · static</small></p></div><b>Review only</b></header><div className="cpr-command-thread-body"><div className="cpr-command-day-marker"><span>Today</span></div>{renderMessage(STATIC_MESSAGES[0], 0)}<div className="cpr-command-system"><CheckCircle2 />Entry note shared with service team <time>9:14 AM</time></div>{renderMessage(STATIC_MESSAGES[1], 1)}<CustomerCallEvidence staticAction={staticAction} />{renderMessage(STATIC_MESSAGES[2], 2)}</div><form className="cpr-composer cpr-command-composer" onSubmit={event => { event.preventDefault(); staticAction("Message draft"); setDraft(""); }}><label htmlFor="cpr-static-message">Static reply draft</label><textarea id="cpr-static-message" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Write a local preview message…" /><button type="submit" disabled={!draft.trim()}><Send size={14} />Save static draft</button></form></section><aside className="cpr-command-message-context"><section className="cpr-command-message-card"><header><div><small>CUSTOMER CONTEXT</small><h2>Current household</h2></div><UserRound /></header><div className="cpr-command-contact"><img src={STATIC_CUSTOMER_PORTRAIT} alt="Static sample customer portrait" /><span><strong>Sample household — A</strong><small>Recurring customer · Since 2024</small><em><i />Active static thread</em></span></div></section><section className="cpr-command-message-card"><header><div><small>UPCOMING SERVICE</small><h2>Next visit</h2></div><CalendarDays /></header><div className="cpr-command-context-visit"><span><CheckCircle2 />Confirmed</span><strong>Recurring home service</strong><p>Tue, Sep 15 · 10:00 AM<br />Team North · $184 static total</p><button type="button" onClick={() => staticAction("Booking detail")}>Open static booking</button></div></section><section className="cpr-command-message-card"><header><div><small>CONVERSATION SIGNALS</small><h2>Ready context</h2></div><Sparkles /></header><div className="cpr-command-signal-list"><div className="cpr-command-signal"><i className="is-mint" /><span><strong>Entry instructions</strong><small>Shared with the static service team</small></span><b>Ready</b></div><div className="cpr-command-signal"><i className="is-amber" /><span><strong>Callback cue</strong><small>Customer requested human follow-up</small></span><b>Review</b></div><div className="cpr-command-signal"><i className="is-blue" /><span><strong>Preferred timing</strong><small>Keep the next visit window</small></span><b>Noted</b></div></div></section></aside></div></section>;
}

function PaymentsTab({ staticAction }: { staticAction: (label: string) => void }) {
  return <section className="cpr-tab-page"><header className="cpr-tab-page-header"><div><small>STATIC PAYMENT PROFILE</small><h2>Payment method and service charges</h2><p>Review-only payment state; no card, charge, refund, or payment link is connected.</p></div><StaticAction label="Add static card" onClick={() => staticAction("Payment method")} className="cpr-primary-button" /></header><div className="cpr-payment-layout"><article className="cpr-payment-card"><div><CreditCard size={19} /><span>DEFAULT PAYMENT</span></div><strong>Visa ·•••• 4242</strong><p>Static verified payment method for customer-profile layout review.</p><em><ShieldCheck size={14} />Verified payment indicator</em></article><article className="cpr-payment-summary"><small>UPCOMING SERVICE</small><h3>Recurring home service</h3><p>Tue, Sep 15 · Static total $184</p><div><span>Card-on-file status</span><strong>Ready for confirmation</strong></div></article></div><section className="cpr-panel cpr-payment-history"><header><div><small>STATIC PAYMENT HISTORY</small><h2>Recent service totals</h2></div></header>{STATIC_BOOKINGS.slice(1).map(booking => <div key={booking.id}><span>{booking.service}<small>{booking.date}</small></span><b>{booking.price}</b><em>Static payment record</em></div>)}</section></section>;
}

function MyHomeTab({ staticAction }: { staticAction: (label: string) => void }) {
  return <section className="cpr-tab-page"><header className="cpr-tab-page-header"><div><small>STATIC MY HOME PROFILE</small><h2>Home address and service preferences</h2><p>This mirrors the profile context that supports booking and customer-portal surfaces.</p></div><StaticAction label="Edit static profile" onClick={() => staticAction("Home profile")} className="cpr-primary-button" /></header><div className="cpr-home-detail-grid"><article className="cpr-panel"><span className="cpr-home-large-icon"><Home size={24} /></span><small>SERVICE ADDRESS</small><h3>123 Example Street</h3><p>Washington, DC 20008</p><button type="button" onClick={() => staticAction("Address details")}><MapPin size={14} />View static location context</button></article><article className="cpr-panel"><span className="cpr-home-large-icon"><Sparkles size={24} /></span><small>RECURRING PREFERENCE</small><h3>Bi-weekly service</h3><p>3 bedrooms · 2 bathrooms · preferred 10:00 AM window</p><button type="button" onClick={() => staticAction("Recurring plan")}><CalendarDays size={14} />Open static plan details</button></article><article className="cpr-panel cpr-home-guidance"><span className="cpr-home-large-icon"><ShieldCheck size={24} /></span><small>CUSTOMER CONTEXT</small><h3>Know before you reply</h3><ul><li>Customer prefers arrival confirmation.</li><li>Recent service history shows no unresolved issue.</li><li>All entries are static review content.</li></ul></article></div></section>;
}

export default function CustomerProfileReview() {
  const [tab, setTab] = useState<CustomerProfileTab>("overview");
  const [notice, setNotice] = useState("");
  const staticAction = (label: string) => setNotice(`${label} is review-only — no customer, booking, payment, portal, or message action was run.`);
  const activeContent = useMemo(() => {
    if (tab === "bookings") return <BookingsTab staticAction={staticAction} />;
    if (tab === "messages") return <MessagesTab staticAction={staticAction} />;
    if (tab === "payments") return <PaymentsTab staticAction={staticAction} />;
    if (tab === "my-home") return <MyHomeTab staticAction={staticAction} />;
    return <OverviewTab staticAction={staticAction} />;
  }, [tab, notice]);

  return <main className="customer-profile-review" data-review-only="true">
    <header className="cpr-topbar"><div className="cpr-crumb"><span>CUSTOMER OPERATIONS</span><ChevronRight size={13} /><strong>Customer Profile</strong><i>Static review</i></div><div className="cpr-top-actions"><button type="button" onClick={() => staticAction("Search")} aria-label="Search static customer profile"><UserRound size={15} /></button><button type="button" onClick={() => staticAction("Notifications")} aria-label="Static notifications"><Bell size={15} /></button><button type="button" onClick={() => staticAction("More actions")} aria-label="More static customer actions"><Ellipsis size={16} /></button></div></header>
    <section className="cpr-profile-header"><div className="cpr-avatar"><img src={STATIC_CUSTOMER_PORTRAIT} alt="Static sample customer portrait" /></div><div className="cpr-profile-identity"><span>STATIC CUSTOMER RECORD</span><h1>Sample household — A</h1><p><Phone size={14} />(202) 555-0141 <i /> <Mail size={14} />sample-household-a@example.test</p><div><b>Recurring customer</b><b className="is-subtle">Customer since 2024</b></div></div><div className="cpr-profile-actions"><StaticAction label="Message" onClick={() => { setTab("messages"); staticAction("Messages"); }} className="cpr-primary-button" /><StaticAction label="View My Home" onClick={() => setTab("my-home")} className="cpr-secondary-button" /><button type="button" onClick={() => staticAction("More actions")} aria-label="More static customer actions"><MoreHorizontal size={17} /></button></div></section>
    <nav className="cpr-tabs" aria-label="Customer profile sections">{TABS.map(item => <button type="button" className={tab === item.id ? "is-active" : ""} key={item.id} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav>
    {notice && <div className="cpr-notice" role="status">{notice}</div>}
    {activeContent}
  </main>;
}
