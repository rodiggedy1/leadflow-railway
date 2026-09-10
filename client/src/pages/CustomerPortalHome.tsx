import type { ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CirclePlus,
  CreditCard,
  Headphones,
  Home,
  House,
  MapPin,
  MessageCircle,
  Plus,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { CustomerPortalService } from "@shared/customerPortalServices";
import { formatCustomerPortalServiceTime } from "@/lib/customerPortalTime";
import "./customer-portal-live-home.css";
import "./customer-portal-summary-row.css";
import "./customer-portal-message-availability.css";

type CustomerHomePage = "home" | "bookings" | "services" | "payments" | "messages" | "account";

type HomeBooking = {
  bookingId: number | null;
  jobDate: string;
  serviceDateTime: string | null;
  serviceType: string | null;
  teamName: string | null;
  bookingStatus: string;
};

type HomeServiceCard = {
  id: string | null;
  title: string;
  price: string;
  image: string;
  alt: string;
};

type CustomerPortalHomeProps = {
  customerName: string;
  homeAddress: string;
  nextBooking: HomeBooking | null;
  nextBookingDate: string | null;
  nextBookingDetails: string | null;
  totalBookingCount: number;
  paymentMethodLabel: string;
  bookingStatusLabel: string;
  activePage: CustomerHomePage;
  todayStatus: ReactNode;
  onGoToPage: (page: CustomerHomePage) => void;
  onMessageTeam: () => void;
  canMessageTeamToday: boolean;
  onBookHomeCleaning: () => void;
  onOpenService: (serviceId: string) => void;
};

const HERO_IMAGE = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/LNsiGwvJSDyOxDXQ.png";
const TEAM_IMAGE = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/rWFyoQgfdOxgwMpg.png";
const RECURRING_IMAGE = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/rrfUUNcyvtIVqmJl.png";

const topServices: HomeServiceCard[] = [
  { id: "home-cleaning", title: "House Cleaning", price: "From $99", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/bkDcxwPksZSaCtof.png", alt: "White towels and green houseplant" },
  { id: "lawn-yard-care", title: "Lawn Care", price: "From $79", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/pwfDluckRclRJlTj.png", alt: "Sunlit manicured lawn" },
  { id: "handyman", title: "Handyman", price: "From $89", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/LkpGUwXNnJiNSpWf.png", alt: "Handyman hammer and pliers" },
  { id: "moving-help", title: "Moving Help", price: "From $129", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/RftyEUKUmLVDpozD.png", alt: "Moving boxes and houseplant" },
  { id: "junk-removal", title: "Junk Removal", price: "From $99", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/QFLPAXxQrOkLCWKm.png", alt: "Junk removal truck, furniture, boxes, and bags" },
  { id: "pressure-washing", title: "Pressure Washing", price: "From $99", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/kItDwOUigEGJKBKu.png", alt: "Pressure washing patio or walkway" },
];

const additionalServices: HomeServiceCard[] = [
  { id: null, title: "Oven Cleaning", price: "From $49", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/uJuGdDbETkOKCEfG.jpg", alt: "Spotless oven interior" },
  { id: null, title: "Fridge Cleaning", price: "From $49", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/roQuxuTpVgiyAzUq.png", alt: "Fresh organized refrigerator interior" },
  { id: null, title: "Window Cleaning", price: "From $89", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/BUgPGkbQtpLzKBvH.png", alt: "Window being cleaned with a squeegee" },
  { id: null, title: "Laundry Service", price: "From $29", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ROyyPSpvuvYaSqrW.png", alt: "Stacked white towels beside a green houseplant" },
  { id: null, title: "Home Organization", price: "From $59", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/JdkabodznNWkNRdU.jpg", alt: "Organized home shelving with baskets" },
];

function PassiveAction({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <button type="button" className={className} aria-disabled="true">{children}</button>;
}

function ServiceCard({ service, onOpenService }: { service: HomeServiceCard; onOpenService: (serviceId: string) => void }) {
  if (!service.id) {
    return <PassiveAction className="mib-customer-home__service-card"><img src={service.image} alt={service.alt} /><span><b>{service.title}</b><small>{service.price}</small></span><ChevronRight /></PassiveAction>;
  }
  return <button className="mib-customer-home__service-card" type="button" onClick={() => onOpenService(service.id)}><img src={service.image} alt={service.alt} /><span><b>{service.title}</b><small>{service.price}</small></span><ChevronRight /></button>;
}

export default function CustomerPortalHome({ customerName, homeAddress, nextBooking, nextBookingDate, nextBookingDetails, totalBookingCount, paymentMethodLabel, bookingStatusLabel, activePage, todayStatus, onGoToPage, onMessageTeam, canMessageTeamToday, onBookHomeCleaning, onOpenService }: CustomerPortalHomeProps) {
  const firstName = customerName.split(" ")[0] || "there";
  const nextService = nextBooking?.serviceType || "Home cleaning";
  const bookingTime = formatCustomerPortalServiceTime(nextBooking?.serviceDateTime);
  const statusDetail = nextBooking ? "Your booking details are saved." : "Book when you’re ready.";
  const teamName = nextBooking?.teamName || "Not yet assigned";
  const teamDetail = nextBooking?.teamName ? "Your team is assigned to this visit" : "Your team will be confirmed soon";

  return <div className="mib-customer-home-shell" id="mib-home">
    <div className="mib-customer-home-layout">
      <aside className="mib-customer-home-sidebar" aria-label="Customer portal navigation">
        <div className="mib-customer-home-logo"><img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/MIB_logo_final_138df3e8.png" alt="Maids in Black" /></div>
        <nav>
          <button className={activePage === "home" ? "active" : ""} type="button" onClick={() => onGoToPage("home")}><Home /><span>Home</span></button>
          <button className={activePage === "bookings" ? "active" : ""} type="button" onClick={() => onGoToPage("bookings")}><CalendarDays /><span>My bookings</span></button>
          <button className={activePage === "services" ? "active" : ""} type="button" onClick={() => onGoToPage("services")}><Sparkles /><span>Services</span></button>
          <button className={activePage === "payments" ? "active" : ""} type="button" onClick={() => onGoToPage("payments")}><CreditCard /><span>Payments</span></button>
          <button className={activePage === "messages" ? "active" : ""} type="button" onClick={() => onGoToPage("messages")}><MessageCircle /><span>Messages</span></button>
          <button className={activePage === "account" ? "active" : ""} type="button" onClick={() => onGoToPage("account")}><UserRound /><span>Account</span></button>
        </nav>
        <div className="mib-customer-home-help"><Headphones /><span><b>Need help?</b><small>We’re here for you.</small></span><span className="mib-customer-home-help-link">Contact us</span></div>
      </aside>

      <main className="mib-customer-home" aria-label="My home">
        <header className="mib-customer-home__header">
          <div><p>My home</p><h1>Good morning, {firstName}.</h1><span>Your home. Our priority.</span></div>
          <div className="mib-customer-home__header-actions"><button className="mib-customer-home__book" type="button" onClick={onBookHomeCleaning}><CirclePlus /> Book a new cleaning</button><span className="mib-customer-home__bell" aria-label="Notifications"><Bell /><i /></span></div>
        </header>

        <section className="mib-customer-home__more-ways" aria-labelledby="mib-more-ways-heading"><header><div><h2 id="mib-more-ways-heading">More ways we can help</h2><p>Book other trusted home services — all in one place.</p></div><button type="button" onClick={() => onGoToPage("services")}>View all services <ChevronRight /></button></header><div className="mib-customer-home__service-list">{topServices.map(service => <ServiceCard key={service.title} service={service} onOpenService={service.id === "home-cleaning" ? onBookHomeCleaning : onOpenService} />)}</div></section>

        <div className="mib-customer-home__grid">
          <section className="mib-customer-home__main-column">
            <article className="mib-customer-home__next-cleaning">
              <div className="mib-customer-home__next-copy"><p>Next cleaning</p><h2>{nextBookingDate || "No upcoming cleaning"}</h2><strong>{bookingTime}</strong><div className="mib-customer-home__service-details"><span><MapPin /><b>{homeAddress || "Address saved with booking"}</b><small>{homeAddress ? "Your saved service address" : "Add an address when you book"}</small></span><span><Sparkles /><b>{nextService}</b><small>{nextBookingDetails || "Your service details will appear here."}</small></span></div><div className="mib-customer-home__hero-actions"><button className="is-primary" type="button" onClick={() => onGoToPage("bookings")}>View details <ChevronRight /></button><PassiveAction><CalendarDays /> Reschedule</PassiveAction><PassiveAction><Plus /> Add extras</PassiveAction></div></div>
              <div className="mib-customer-home__room-image"><img src={HERO_IMAGE} alt="Sunlit living room with cream sofa, greenery, and a round wood coffee table" /><span><Check /><b>{bookingStatusLabel}</b><small>{statusDetail}</small></span></div>
            </article>
            {todayStatus && <section className="mib-customer-home__live-status">{todayStatus}</section>}
            <section className="mib-customer-home__summary-row" aria-label="My home summary">
              <article><span className="is-coral"><CalendarDays /></span><div><p>Total bookings</p><strong>{totalBookingCount}</strong><button type="button" onClick={() => onGoToPage("bookings")}>View all bookings <ChevronRight /></button></div></article>
              <article><span className="is-amber"><Sparkles /></span><div><p>Next visit</p><strong>{nextBookingDate || "Not scheduled"}</strong><button type="button" onClick={() => onGoToPage("bookings")}>{nextBooking ? nextService : "Book when you’re ready"} <ChevronRight /></button></div></article>
              <article><span className="is-blue"><CreditCard /></span><div><p>Payment method</p><strong>{paymentMethodLabel}</strong><button type="button" onClick={() => onGoToPage("payments")}>Manage payment <ChevronRight /></button></div></article>
              <article><span className="is-mint"><MessageCircle /></span><div><p>Messages</p><strong>Team chat</strong><button type="button" onClick={() => onGoToPage("messages")}>View messages <ChevronRight /></button></div></article>
            </section>
            <section className="mib-customer-home__additional-services" aria-labelledby="mib-additional-services-heading"><header><div><h2 id="mib-additional-services-heading">Additional services</h2><p>Make your home even more comfortable.</p></div><button type="button" onClick={() => onGoToPage("services")}>View all services <ChevronRight /></button></header><div className="mib-customer-home__additional-list">{additionalServices.map(service => <article className="mib-customer-home__additional-service" key={service.title}><img src={service.image} alt={service.alt} /><div><h3>{service.title}</h3><small>{service.price}</small><PassiveAction>Add to booking</PassiveAction></div></article>)}</div></section>
          </section>

          <aside className="mib-customer-home__right-rail">
            <article className="mib-customer-home__team-card"><h2>Your cleaning team</h2><div className="mib-customer-home__team-summary"><img src={TEAM_IMAGE} alt="Maids in Black cleaning professionals in black work shirts" /><div><strong>{teamName}</strong><small>{teamDetail}</small></div></div><button type="button" onClick={onMessageTeam} disabled={!canMessageTeamToday} title={canMessageTeamToday ? undefined : "Messaging is available on the day of your service"}><MessageCircle /> Message your team</button></article>
            <article className="mib-customer-home__quick-card"><h2>Quick actions</h2><ul><li><span className="coral"><CalendarDays /></span><button type="button" onClick={onBookHomeCleaning}>Book a new cleaning</button><ChevronRight /></li><li><span className="blue"><RefreshCw /></span><PassiveAction>Manage recurring plan</PassiveAction><ChevronRight /></li><li><span className="green"><House /></span><PassiveAction>Update my home details</PassiveAction><ChevronRight /></li><li><span className="mint"><CreditCard /></span><button type="button" onClick={() => onGoToPage("payments")}>Payment methods</button><ChevronRight /></li></ul></article>
            <article className="mib-customer-home__recurring-card"><img src={RECURRING_IMAGE} alt="Warm kitchen with pendant lights and plants" /><div><h2>Keep your home<br />consistently clean.</h2><p>Save time, get priority scheduling, and enjoy discounted rates.</p><PassiveAction>Manage recurring plan <ChevronRight /></PassiveAction></div></article>
          </aside>
        </div>
      </main>
    </div>
  </div>;
}
