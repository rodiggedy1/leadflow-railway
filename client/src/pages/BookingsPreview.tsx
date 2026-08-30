import AdminHeader from "@/components/AdminHeader";
import AdminPageGuard from "@/components/AdminPageGuard";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import {
  CalendarDays,
  Check,
  CreditCard,
  Filter,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type BookingStatus = "Confirmed" | "Needs attention" | "Completed";
type BookingFrequency = "One-time" | "Weekly" | "Every 2 weeks" | "Monthly";

type DemoBooking = {
  id: string;
  time: string;
  date: string;
  name: string;
  phone: string;
  address: string;
  service: string;
  home: string;
  price: number;
  status: BookingStatus;
  frequency: BookingFrequency;
  team: string;
  teamInitials: string;
  teamTone: "violet" | "coral" | "green" | "gray";
  card: boolean;
  extras: string[];
  notes: string;
};

const DEMO_BOOKINGS: DemoBooking[] = [
  { id: "DEMO-1842", time: "8:30 AM", date: "2026-08-30", name: "Demo Customer A", phone: "(000) 000-0001", address: "101 Preview Avenue, Washington, DC", service: "Deep cleaning", home: "2 bed · 2 bath", price: 405, status: "Confirmed", frequency: "Every 2 weeks", team: "Demo Team Amara", teamInitials: "AM", teamTone: "violet", card: true, extras: ["Inside fridge"], notes: "Sample note: text before arrival." },
  { id: "DEMO-1843", time: "10:30 AM", date: "2026-08-30", name: "Demo Customer B", phone: "(000) 000-0002", address: "202 Sample Street, Washington, DC", service: "Standard cleaning", home: "1 bed · 1 bath", price: 164, status: "Confirmed", frequency: "Every 2 weeks", team: "Demo Team Janna", teamInitials: "JT", teamTone: "coral", card: true, extras: [], notes: "Sample access note for UI review." },
  { id: "DEMO-1844", time: "1:00 PM", date: "2026-08-30", name: "Demo Customer C", phone: "(000) 000-0003", address: "303 Prototype Drive, Oxon Hill, MD", service: "Move-out cleaning", home: "3 bed · 2 bath", price: 399, status: "Needs attention", frequency: "One-time", team: "Unassigned", teamInitials: "?", teamTone: "gray", card: false, extras: ["Inside oven", "Inside cabinets"], notes: "Sample note: flexible arrival window." },
  { id: "DEMO-1845", time: "2:30 PM", date: "2026-08-30", name: "Demo Customer D", phone: "(000) 000-0004", address: "404 Demo Lane, Silver Spring, MD", service: "Deep cleaning", home: "3 bed · 2 bath", price: 369, status: "Completed", frequency: "Monthly", team: "Demo Team Amara", teamInitials: "AM", teamTone: "violet", card: true, extras: ["Interior windows", "Inside oven"], notes: "Sample pet note for UI review." },
  { id: "DEMO-1846", time: "9:00 AM", date: "2026-08-31", name: "Demo Customer E", phone: "(000) 000-0005", address: "505 Example Court, Washington, DC", service: "Standard cleaning", home: "2 bed · 1 bath", price: 189, status: "Confirmed", frequency: "Weekly", team: "Demo Team Janna", teamInitials: "JT", teamTone: "coral", card: true, extras: [], notes: "" },
];

const DATE_OPTIONS = [
  { value: "2026-08-29", day: "FRI", date: "29" },
  { value: "2026-08-30", day: "SAT", date: "30" },
  { value: "2026-08-31", day: "SUN", date: "31" },
  { value: "2026-09-01", day: "MON", date: "1" },
] as const;

const STATUS_OPTIONS: Array<"All" | BookingStatus> = ["All", "Confirmed", "Needs attention", "Completed"];
const EXTRA_CHOICES = ["Inside fridge", "Inside oven", "Interior windows", "Baseboards", "Inside cabinets", "Laundry", "Basement"];
const FREQUENCIES: BookingFrequency[] = ["One-time", "Weekly", "Every 2 weeks", "Monthly"];
const DEMO_TEAMS = [
  { name: "Demo Team Amara", initials: "AM", tone: "violet" as const, note: "2 cleaners · sample availability" },
  { name: "Demo Team Janna", initials: "JT", tone: "coral" as const, note: "2 cleaners · sample availability" },
  { name: "Demo Team Imani", initials: "IM", tone: "green" as const, note: "2 cleaners · sample availability" },
  { name: "Unassigned", initials: "?", tone: "gray" as const, note: "Leave open" },
];

const teamToneClasses: Record<DemoBooking["teamTone"], string> = {
  violet: "bg-violet-100 text-violet-700",
  coral: "bg-[#ffe8e2] text-[#d95138]",
  green: "bg-emerald-100 text-emerald-700",
  gray: "bg-gray-100 text-gray-600",
};

function TeamAvatar({ initials, tone }: { initials: string; tone: DemoBooking["teamTone"] }) {
  return <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-extrabold ${teamToneClasses[tone]}`}>{initials}</span>;
}

function MetricCard({ label, value, helper, icon, tone }: { label: string; value: string; helper: string; icon: React.ReactNode; tone: string }) {
  return (
    <article className="flex min-w-0 items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}>{icon}</span>
      <div className="min-w-0"><p className="text-[10px] font-extrabold uppercase tracking-[0.09em] text-gray-400">{label}</p><strong className="mt-1 block text-xl tracking-tight text-gray-900">{value}</strong><p className="mt-0.5 truncate text-[11px] text-gray-500">{helper}</p></div>
    </article>
  );
}

function BookingsPreviewContent() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  const [bookings, setBookings] = useState(DEMO_BOOKINGS);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState("2026-08-30");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"All" | BookingStatus>("All");

  const activeBooking = bookings.find((booking) => booking.id === activeId) ?? null;
  const visibleBookings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return bookings.filter((booking) => {
      const matchesDate = booking.date === selectedDate;
      const matchesStatus = status === "All" || booking.status === status;
      const searchable = `${booking.name} ${booking.address} ${booking.team} ${booking.service}`.toLowerCase();
      return matchesDate && matchesStatus && (!normalizedQuery || searchable.includes(normalizedQuery));
    });
  }, [bookings, query, selectedDate, status]);

  const assignedCount = visibleBookings.filter((booking) => booking.team !== "Unassigned").length;
  const cardCount = visibleBookings.filter((booking) => booking.card).length;
  const bookedRevenue = visibleBookings.reduce((sum, booking) => sum + booking.price, 0);

  const updateActiveBooking = (changes: Partial<DemoBooking>) => {
    if (!activeBooking) return;
    setBookings((current) => current.map((booking) => booking.id === activeBooking.id ? { ...booking, ...changes } : booking));
  };

  const previewOnly = (action: string) => toast.info(`${action} is a UI preview. Nothing was sent, booked, charged, or saved.`);

  const toggleExtra = (extra: string) => {
    if (!activeBooking) return;
    updateActiveBooking({ extras: activeBooking.extras.includes(extra) ? activeBooking.extras.filter((item) => item !== extra) : [...activeBooking.extras, extra] });
  };

  const assignTeam = (teamName: string) => {
    const team = DEMO_TEAMS.find((option) => option.name === teamName);
    if (!team) return;
    updateActiveBooking({ team: team.name, teamInitials: team.initials, teamTone: team.tone });
  };

  return (
    <div className="min-h-screen bg-[#f6f6f4] text-[#24262b]">
      <AdminHeader activeTab="bookings" pagePermissions={pagePermissions} isAdmin={isAdmin} />
      <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-7 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.13em] text-[#e9573e]"><Sparkles className="h-4 w-4" />Operations · UI preview</div><h1 className="mt-1 font-serif text-4xl font-bold tracking-tight text-[#24262b]">Bookings</h1><p className="mt-1 text-sm text-gray-500">Run the day without losing the details. Sample records only.</p></div>
          <button type="button" onClick={() => previewOnly("New booking")} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#24262b] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-black"><Plus className="h-4 w-4" />New booking</button>
        </div>

        <section aria-label="Select demo booking date" className="mt-6 flex items-center gap-2 overflow-x-auto pb-1">
          {DATE_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => { setSelectedDate(option.value); setActiveId(null); }} className={`relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl border text-center transition ${selectedDate === option.value ? "border-[#ff684c] bg-[#fff5f2] text-[#da4f36] shadow-sm" : "border-gray-200 bg-white hover:border-gray-300"}`}><span className="text-[9px] font-extrabold text-gray-400">{option.day}</span><strong className="text-lg leading-none">{option.date}</strong>{selectedDate === option.value && <span className="absolute bottom-1.5 h-1 w-1 rounded-full bg-[#ff684c]" />}</button>)}
          <label className="flex h-16 shrink-0 items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 text-[#e9573e]"><CalendarDays className="h-4 w-4" /><input aria-label="Choose demo booking date" type="date" value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setActiveId(null); }} className="bg-transparent text-xs text-gray-600 outline-none" /></label>
        </section>

        <section aria-label="Demo booking metrics" className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard label="Bookings" value={String(visibleBookings.length)} helper="on selected date" icon={<CalendarDays className="h-5 w-5" />} tone="bg-[#fff0ec] text-[#ff684c]" />
          <MetricCard label="Teams assigned" value={`${assignedCount}/${visibleBookings.length}`} helper={assignedCount === visibleBookings.length ? "Everything covered" : `${visibleBookings.length - assignedCount} needs a team`} icon={<Users className="h-5 w-5" />} tone="bg-violet-50 text-violet-600" />
          <MetricCard label="Cards on file" value={`${cardCount}/${visibleBookings.length}`} helper={cardCount === visibleBookings.length ? "All secured" : `${visibleBookings.length - cardCount} needs attention`} icon={<CreditCard className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600" />
          <MetricCard label="Booked revenue" value={`$${bookedRevenue.toLocaleString()}`} helper="sample values only" icon={<span className="text-base font-black">$</span>} tone="bg-amber-50 text-amber-700" />
        </section>

        <section className="mt-6 flex flex-wrap items-center gap-3">
          <label className="flex h-11 min-w-0 flex-1 basis-full items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 shadow-sm md:basis-64"><Search className="h-4 w-4 shrink-0 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, address, team, or service" className="w-full bg-transparent text-sm outline-none" /></label>
          <div className="flex max-w-full overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 shadow-sm">{STATUS_OPTIONS.map((option) => <button key={option} type="button" onClick={() => setStatus(option)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold transition ${status === option ? "bg-[#24262b] text-white" : "text-gray-500 hover:bg-gray-50"}`}>{option}</button>)}</div>
          <button type="button" onClick={() => previewOnly("Filters")} className="hidden h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-xs font-bold text-gray-600 shadow-sm transition hover:bg-gray-50 md:flex"><Filter className="h-4 w-4" />Filters</button>
        </section>

        <section aria-label="Demo bookings list" className="mt-3 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="hidden grid-cols-[1.55fr_1.2fr_1fr_.75fr_.4fr_24px] gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.07em] text-gray-400 lg:grid"><span>Time & customer</span><span>Service</span><span>Team</span><span>Payment</span><span>Total</span><span /></div>
          {visibleBookings.length ? visibleBookings.map((booking) => <button key={booking.id} type="button" onClick={() => setActiveId(booking.id)} className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-gray-100 px-4 py-4 text-left transition last:border-b-0 hover:bg-[#fff8f6] lg:grid-cols-[1.55fr_1.2fr_1fr_.75fr_.4fr_24px] ${activeId === booking.id ? "bg-[#fff8f6] shadow-[inset_3px_0_#ff684c]" : "bg-white"}`}>
            <span className="flex min-w-0 items-center gap-3"><span className="w-16 shrink-0 text-sm font-extrabold">{booking.time}</span><span className={`h-2 w-2 shrink-0 rounded-full ${booking.status === "Needs attention" ? "bg-amber-400" : booking.status === "Completed" ? "bg-gray-300" : "bg-emerald-500"}`} /><span className="min-w-0"><strong className="block truncate text-sm">{booking.name}</strong><small className="mt-1 flex items-center gap-1 truncate text-xs text-gray-500"><MapPin className="h-3 w-3 shrink-0" />{booking.address}</small></span></span>
            <span className="hidden min-w-0 lg:block"><strong className="block truncate text-sm">{booking.service}</strong><small className="mt-1 block truncate text-xs text-gray-500">{booking.home} · {booking.frequency}</small>{booking.extras.length > 0 && <em className="mt-1 inline-flex rounded-full bg-[#fff0ec] px-2 py-0.5 text-[10px] font-bold not-italic text-[#d85037]">+{booking.extras.length} extra{booking.extras.length > 1 ? "s" : ""}</em>}</span>
            <span className="hidden items-center gap-2 lg:flex"><TeamAvatar initials={booking.teamInitials} tone={booking.teamTone} /><span className="min-w-0"><strong className="block truncate text-xs">{booking.team}</strong><small className="text-[11px] text-gray-500">{booking.team === "Unassigned" ? "Assign now" : "Assigned"}</small></span></span>
            <span className={`hidden items-center gap-1.5 text-xs font-bold lg:flex ${booking.card ? "text-emerald-600" : "text-[#d45a3f]"}`}>{booking.card ? <ShieldCheck className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}{booking.card ? "Card on file" : "Card needed"}</span>
            <strong className="hidden text-sm lg:block">${booking.price}</strong>
            <MoreHorizontal className="h-4 w-4 text-gray-400" />
          </button>) : <div className="grid place-items-center px-4 py-16 text-center"><CalendarDays className="h-8 w-8 text-gray-300" /><h2 className="mt-3 text-base font-bold">No demo bookings found</h2><p className="mt-1 text-sm text-gray-500">Try another date or clear the filters.</p></div>}
        </section>
      </main>

      {activeBooking && <>
        <button type="button" aria-label="Close booking details" onClick={() => setActiveId(null)} className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" />
        <aside aria-label={`Demo booking details for ${activeBooking.name}`} className="fixed bottom-0 right-0 top-[var(--admin-header-height,0px)] z-50 flex w-full max-w-[430px] flex-col border-l border-gray-200 bg-white shadow-[-16px_0_40px_rgba(24,24,27,0.12)]">
          <header className="flex items-start justify-between border-b border-gray-200 px-5 py-5"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-gray-400">Booking {activeBooking.id}</p><h2 className="mt-1 font-serif text-2xl font-bold">{activeBooking.name}</h2><span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold ${activeBooking.status === "Needs attention" ? "bg-amber-50 text-amber-700" : activeBooking.status === "Completed" ? "bg-gray-100 text-gray-600" : "bg-emerald-50 text-emerald-700"}`}>{activeBooking.status}</span></div><button type="button" onClick={() => setActiveId(null)} aria-label="Close booking detail panel" className="grid h-9 w-9 place-items-center rounded-xl border border-gray-200 text-gray-500 transition hover:bg-gray-50"><X className="h-4 w-4" /></button></header>
          <div className="flex-1 overflow-y-auto">
            <section className="grid grid-cols-2 gap-4 bg-gray-50 px-5 py-4"><div className="flex gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[#e9573e]" /><span><small className="block text-[9px] font-extrabold uppercase tracking-[0.08em] text-gray-400">Appointment</small><strong className="mt-1 block text-xs">{activeBooking.time} · {activeBooking.date}</strong></span></div><div className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#e9573e]" /><span><small className="block text-[9px] font-extrabold uppercase tracking-[0.08em] text-gray-400">Address</small><strong className="mt-1 block text-xs leading-5">{activeBooking.address}</strong></span></div></section>
            <section className="border-b border-gray-200 px-5 py-5"><div className="flex justify-between gap-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-gray-400">Service & extras</p><h3 className="mt-1 text-sm font-extrabold">{activeBooking.service}</h3></div><strong className="text-xl">${activeBooking.price}</strong></div><p className="mt-1 text-xs text-gray-500">{activeBooking.home}</p><div className="mt-3 flex flex-wrap gap-2">{activeBooking.extras.map((extra) => <button key={extra} type="button" onClick={() => toggleExtra(extra)} className="inline-flex items-center gap-1 rounded-full border border-[#ffd2c8] bg-[#fff6f3] px-2.5 py-1.5 text-[11px] font-bold text-[#ce4b34]">{extra}<X className="h-3 w-3" /></button>)}</div><div className="mt-3 grid grid-cols-2 gap-2">{EXTRA_CHOICES.map((extra) => <button key={extra} type="button" onClick={() => toggleExtra(extra)} className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-left text-[11px] font-semibold transition ${activeBooking.extras.includes(extra) ? "border-[#ffad9c] bg-[#fff8f6] text-[#c94832]" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>{activeBooking.extras.includes(extra) && <Check className="h-3 w-3" />}{extra}</button>)}</div></section>
            <section className="border-b border-gray-200 px-5 py-5"><p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-gray-400">Recurring service</p><div className="mt-3 grid grid-cols-2 gap-2">{FREQUENCIES.map((frequency) => <button key={frequency} type="button" onClick={() => updateActiveBooking({ frequency })} className={`min-h-12 rounded-xl border px-2 text-xs font-extrabold transition ${activeBooking.frequency === frequency ? "border-[#ff684c] bg-[#fff7f5] text-[#d95138] shadow-[0_0_0_2px_rgba(255,104,76,0.08)]" : "border-gray-200 hover:bg-gray-50"}`}>{frequency}{frequency !== "One-time" && <span className="mt-1 block text-[9px] font-bold text-emerald-600">{frequency === "Weekly" ? "Save 20%" : frequency === "Every 2 weeks" ? "Save 15%" : "Save 10%"}</span>}</button>)}</div><p className="mt-2 text-[11px] leading-5 text-gray-500">The first cleaning remains full price. Discounts begin with visit two.</p></section>
            <section className="border-b border-gray-200 px-5 py-5"><p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-gray-400">Assigned team</p><div className="mt-3 grid grid-cols-2 gap-2">{DEMO_TEAMS.map((team) => <button key={team.name} type="button" onClick={() => assignTeam(team.name)} className={`flex min-w-0 items-center gap-2 rounded-xl border p-2 text-left transition ${activeBooking.team === team.name ? "border-emerald-300 bg-emerald-50" : "border-gray-200 hover:bg-gray-50"}`}><TeamAvatar initials={team.initials} tone={team.tone} /><span className="min-w-0"><strong className="block truncate text-[11px]">{team.name}</strong><small className="mt-0.5 block truncate text-[9px] text-gray-500">{team.note}</small></span>{activeBooking.team === team.name && <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-600" />}</button>)}</div></section>
            <section className="border-b border-gray-200 px-5 py-5"><p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-gray-400">Payment</p><div className={`mt-3 flex items-center gap-3 rounded-xl p-3 ${activeBooking.card ? "bg-emerald-50 text-emerald-700" : "bg-[#fff4f1] text-[#c64c36]"}`}><CreditCard className="h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><strong className="block text-xs">{activeBooking.card ? "Demo Visa ending in 4242" : "No demo card on file"}</strong><p className="mt-0.5 text-[10px]">{activeBooking.card ? "Sample Stripe status" : "Secure card link action is not connected"}</p></div>{activeBooking.card ? <ShieldCheck className="h-4 w-4" /> : <button type="button" onClick={() => previewOnly("Send card link")} className="rounded-lg bg-[#ff684c] px-2.5 py-2 text-[10px] font-extrabold text-white">Send link</button>}</div></section>
            <section className="px-5 py-5"><p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-gray-400">Notes & special requests</p><textarea value={activeBooking.notes} onChange={(event) => updateActiveBooking({ notes: event.target.value })} placeholder="Sample access details, pets, or priorities…" className="mt-3 min-h-24 w-full resize-y rounded-xl border border-gray-200 p-3 text-xs outline-none transition focus:border-[#ff684c] focus:ring-2 focus:ring-[#ff684c]/10" /><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => previewOnly("Text customer")} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50"><MessageCircle className="h-4 w-4" />Text customer</button><button type="button" onClick={() => previewOnly("Reschedule")} className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50"><CalendarDays className="h-4 w-4" />Reschedule</button></div></section>
          </div>
          <footer className="flex gap-2 border-t border-gray-200 bg-white p-4"><button type="button" onClick={() => previewOnly("Cancel booking")} className="h-11 rounded-xl border border-red-200 px-3 text-xs font-extrabold text-red-600 hover:bg-red-50">Cancel booking</button><button type="button" onClick={() => toast.success("UI preview updated in this browser. No booking was saved.")} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#24262b] text-xs font-extrabold text-white hover:bg-black"><Check className="h-4 w-4" />Save preview changes</button></footer>
        </aside>
      </>}
    </div>
  );
}

export default function BookingsPreview() {
  return <AdminPageGuard pageId="bookings"><BookingsPreviewContent /></AdminPageGuard>;
}
