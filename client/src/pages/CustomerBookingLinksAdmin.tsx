import { useMemo, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import {
  calculatePublicBookingPrice,
  PUBLIC_BOOKING_PRICED_EXTRAS,
  type PublicBookingHomeType,
  type PublicBookingPricingInput,
} from "@shared/publicBookingPricing";

type ServiceId = "standard" | "deep" | "moveout";
type Recurrence = "one-time" | "weekly" | "biweekly" | "monthly";
type ExtraId = keyof typeof PUBLIC_BOOKING_PRICED_EXTRAS;

const tomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
};

const EXTRA_OPTIONS: Array<{ id: ExtraId; label: string; price: number }> = Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS).map(([id, extra]) => ({
  id: id as ExtraId,
  label: extra.label,
  price: extra.unitPrice,
}));

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export default function CustomerBookingLinksAdmin() {
  const { agentId } = useAgentPermissions();
  const create = trpc.bookingFunnel.createCustomerLink.useMutation();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [date, setDate] = useState(tomorrow());
  const [time, setTime] = useState("10:30");
  const [serviceId, setServiceId] = useState<ServiceId>("standard");
  const [bedrooms, setBedrooms] = useState(2);
  const [bathrooms, setBathrooms] = useState(2);
  const [homeType, setHomeType] = useState<PublicBookingHomeType>("House");
  const [condition, setCondition] = useState(5);
  const [recurrence, setRecurrence] = useState<Recurrence>("one-time");
  const [selectedExtras, setSelectedExtras] = useState<ExtraId[]>([]);
  const [customPrice, setCustomPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const customPriceCents = customPrice.trim() === "" ? undefined : Math.round(Number(customPrice) * 100);
  const pricing = useMemo<PublicBookingPricingInput>(() => ({
    pricingMode: "home",
    serviceId,
    bedrooms,
    bathrooms,
    homeType,
    condition,
    maidCount: 1,
    hourCount: 1,
    extras: selectedExtras.map(id => ({ id, quantity: 1 })),
    recurrence,
    ...(customPriceCents !== undefined ? { customPriceCents } : {}),
  }), [serviceId, bedrooms, bathrooms, homeType, condition, selectedExtras, recurrence, customPriceCents]);

  const breakdown = useMemo(() => {
    try {
      return calculatePublicBookingPrice(pricing);
    } catch {
      return null;
    }
  }, [pricing]);

  const toggleExtra = (id: ExtraId) => {
    setSelectedExtras(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };

  if (agentId === null) {
    return <main className="min-h-screen bg-[#f6f2ec] p-8 text-[#241b16]"><div className="mx-auto max-w-xl rounded-3xl bg-white p-8 shadow-xl"><h1 className="text-2xl font-bold">Agent sign-in required</h1><p className="mt-2 text-slate-600">Sign in as an agent to create a personalized customer booking link.</p></div></main>;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setCreatedPath(null);
    try {
      const result = await create.mutateAsync({
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
        address,
        requestedLocalDate: date,
        requestedLocalTime: time,
        pricing,
        notes: notes.split("\n").map(item => item.trim()).filter(Boolean),
      });
      setCreatedPath(result.urlPath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create link.");
    }
  };

  return <main className="min-h-screen bg-[#f6f2ec] px-4 py-6 text-[#241b16] md:px-8 md:py-10">
    <div className="mx-auto max-w-6xl">
      <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#a25c35]">Bookings · agent tools</p><h1 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">Create a customer booking link</h1><p className="mt-2 max-w-2xl text-[#71665e]">Build the quote with the customer’s exact service, arrival window, extras, and price. Then send one secure link so they can complete the native booking.</p></div>
        <Link href="/admin/bookings" className="w-fit rounded-full border border-[#d8cec5] bg-white px-4 py-2 text-sm font-semibold shadow-sm">Back to bookings</Link>
      </header>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-3xl bg-white p-6 shadow-[0_18px_60px_rgba(74,54,35,0.1)] md:p-8">
            <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#a25c35]">Step 1</p><h2 className="mt-1 text-2xl font-bold">Customer details</h2><p className="mt-1 text-sm text-[#81766e]">These details are pre-filled for the customer.</p></div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Customer name" required value={name} onChange={setName} placeholder="Sarah Johnson" />
              <Field label="Phone number" required value={phone} onChange={setPhone} placeholder="302-981-6191" />
              <Field label="Email address" required type="email" value={email} onChange={setEmail} placeholder="sarah@example.com" />
              <Field label="Service address" required value={address} onChange={setAddress} placeholder="123 Main Street, Bethesda, MD" />
            </div>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-[0_18px_60px_rgba(74,54,35,0.1)] md:p-8">
            <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#a25c35]">Step 2</p><h2 className="mt-1 text-2xl font-bold">Schedule</h2><p className="mt-1 text-sm text-[#81766e]">Choose the date and the two-hour arrival window to reserve.</p></div>
            <div className="grid gap-4 md:grid-cols-2"><Field label="Service date" required type="date" value={date} onChange={setDate} min={tomorrow()} /><Field label="Arrival window start" required type="time" value={time} onChange={setTime} /></div>
            <div className="mt-3 rounded-2xl bg-[#fbf7f1] px-4 py-3 text-sm text-[#705b4d]">Team arrival window: <b>{formatWindow(time)}</b></div>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-[0_18px_60px_rgba(74,54,35,0.1)] md:p-8">
            <div className="mb-5"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#a25c35]">Step 3</p><h2 className="mt-1 text-2xl font-bold">Build the quote</h2><p className="mt-1 text-sm text-[#81766e]">The total below uses the same public-booking pricing engine used at submission.</p></div>
            <label className="block text-sm font-semibold">Cleaning type<select value={serviceId} onChange={event => setServiceId(event.target.value as ServiceId)} className="mt-2 w-full rounded-2xl border border-[#d8cec5] bg-white p-3.5"><option value="standard">Standard Cleaning</option><option value="deep">Deep Cleaning</option><option value="moveout">Move-out Cleaning</option></select></label>
            <div className="mt-4 grid gap-4 md:grid-cols-3"><NumberField label="Bedrooms" value={bedrooms} min={0} max={7} onChange={setBedrooms} /><NumberField label="Bathrooms" value={bathrooms} min={1} max={5} onChange={setBathrooms} /><label className="block text-sm font-semibold">Home type<select value={homeType} onChange={event => setHomeType(event.target.value as PublicBookingHomeType)} className="mt-2 w-full rounded-2xl border border-[#d8cec5] bg-white p-3.5"><option>House</option><option>Apartment</option><option>Townhome</option><option>Condo</option></select></label></div>
            <label className="mt-4 block text-sm font-semibold">Home condition: <span className="font-normal text-[#81766e]">{condition}/10</span><input type="range" min="1" max="10" value={condition} onChange={event => setCondition(Number(event.target.value))} className="mt-3 w-full accent-[#8a5a38]" /><span className="mt-1 flex justify-between text-xs font-normal text-[#81766e]"><span>Already clean</span><span>Needs a serious reset</span></span></label>
            <div className="mt-6"><p className="text-sm font-semibold">Extras</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{EXTRA_OPTIONS.map(extra => <button key={extra.id} type="button" onClick={() => toggleExtra(extra.id)} className={`flex items-center justify-between rounded-2xl border p-3 text-left text-sm transition ${selectedExtras.includes(extra.id) ? "border-[#684326] bg-[#fbf7f1] ring-1 ring-[#684326]" : "border-[#e1d8d0] bg-white hover:border-[#b89476]"}`}><span><span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full border text-xs">{selectedExtras.includes(extra.id) ? "✓" : ""}</span>{extra.label}</span><b className="text-[#684326]">+${extra.price}</b></button>)}</div></div>
            <div className="mt-6 rounded-2xl border border-[#d8cec5] bg-[#fbf7f1] p-4"><label className="block text-sm font-semibold">Custom first-cleaning price <span className="font-normal text-[#81766e]">(optional)</span><input type="number" min="1" step="0.01" value={customPrice} onChange={event => setCustomPrice(event.target.value)} placeholder={breakdown ? (breakdown.firstCleaningTotalCents / 100).toFixed(2) : "0.00"} className="mt-2 w-full rounded-2xl border border-[#d8cec5] bg-white p-3.5 font-normal" /></label><p className="mt-2 text-xs text-[#81766e]">Leave blank to use the calculated price. Enter the exact amount you want the customer to see and pay for the first cleaning.</p>{customPrice.trim() !== "" && !Number.isFinite(customPriceCents) && <p className="mt-2 text-xs font-semibold text-red-700">Enter a valid dollar amount.</p>}</div>
            <div className="mt-6"><p className="text-sm font-semibold">Future service frequency</p><div className="mt-3 grid gap-2 sm:grid-cols-4">{(["one-time", "weekly", "biweekly", "monthly"] as const).map(option => <button key={option} type="button" onClick={() => setRecurrence(option)} className={`rounded-2xl border px-3 py-3 text-sm font-semibold ${recurrence === option ? "border-[#684326] bg-[#fbf7f1] text-[#684326] ring-1 ring-[#684326]" : "border-[#e1d8d0] bg-white"}`}>{option === "one-time" ? "One time" : option === "biweekly" ? "Every 2 weeks" : option === "weekly" ? "Weekly" : "Monthly"}</button>)}</div></div>
            <label className="mt-6 block text-sm font-semibold">Internal notes <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} placeholder="Entry instructions or notes for the team" className="mt-2 w-full rounded-2xl border border-[#d8cec5] p-3.5 font-normal" /></label>
          </section>
        </div>

        <aside className="h-fit rounded-3xl bg-[#4a2d1b] p-6 text-white shadow-[0_18px_60px_rgba(74,54,35,0.22)] lg:sticky lg:top-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#e8c8a4]">Quote preview</p><h2 className="mt-2 text-2xl font-bold">{name || "Customer quote"}</h2><p className="mt-1 text-sm text-[#e4d4c7]">{serviceId === "standard" ? "Standard" : serviceId === "deep" ? "Deep" : "Move-out"} Cleaning · {bedrooms} bed · {bathrooms} bath</p>
          <div className="my-6 border-y border-white/20 py-5"><p className="text-sm text-[#e4d4c7]">First cleaning</p><p className="mt-1 text-5xl font-bold">{breakdown ? money(breakdown.firstCleaningTotalCents) : "—"}</p>{customPrice.trim() !== "" && breakdown && <p className="mt-2 text-xs text-[#e8c8a4]">Custom price applied · calculated price would be {money(calculatePublicBookingPrice({ ...pricing, customPriceCents: undefined }).firstCleaningTotalCents)}</p>}{breakdown?.futureVisitTotalCents != null && <p className="mt-2 text-sm text-[#e8c8a4]">{money(breakdown.futureVisitTotalCents)} per {recurrence} visit after the first cleaning</p>}</div>
          <div className="space-y-2 text-sm text-[#f2e6dc]"><div className="flex justify-between"><span>Service subtotal</span><b>{breakdown ? money(breakdown.serviceSubtotalCents) : "—"}</b></div><div className="flex justify-between"><span>Extras</span><b>{breakdown ? money(breakdown.extrasTotalCents) : "—"}</b></div><div className="flex justify-between"><span>Date</span><b>{date || "—"}</b></div><div className="flex justify-between"><span>Arrival</span><b>{formatWindow(time)}</b></div></div>
          <button type="submit" disabled={create.isPending || !breakdown || (customPrice.trim() !== "" && !Number.isFinite(customPriceCents))} className="mt-7 w-full rounded-2xl bg-white px-5 py-4 font-bold text-[#4a2d1b] shadow-lg disabled:cursor-not-allowed disabled:opacity-60">{create.isPending ? "Creating secure link…" : "Create secure booking link"}</button>
          {error && <p className="mt-4 rounded-xl bg-red-100 p-3 text-sm text-red-900" role="alert">{error}</p>}
          {createdPath && <div className="mt-5 rounded-2xl bg-emerald-100 p-4 text-emerald-950"><p className="font-bold">Link created. Attribution is saved.</p><a className="mt-2 block break-all text-sm underline" href={createdPath}>{window.location.origin}{createdPath}</a><button type="button" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${createdPath}`)} className="mt-3 rounded-full bg-emerald-800 px-4 py-2 text-sm font-bold text-white">Copy link</button></div>}
        </aside>
      </form>
    </div>
  </main>;
}

function Field({ label, value, onChange, placeholder, type = "text", required = false, min }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean; min?: string }) {
  return <label className="block text-sm font-semibold">{label}<input required={required} type={type} min={min} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="mt-2 w-full rounded-2xl border border-[#d8cec5] bg-white p-3.5 font-normal outline-none focus:border-[#a25c35] focus:ring-2 focus:ring-[#a25c35]/15" /></label>;
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (value: number) => void; min: number; max: number }) {
  return <label className="block text-sm font-semibold">{label}<input required type="number" min={min} max={max} value={value} onChange={event => onChange(Number(event.target.value))} className="mt-2 w-full rounded-2xl border border-[#d8cec5] bg-white p-3.5 font-normal" /></label>;
}

function formatWindow(start: string) {
  if (!start) return "Choose a time";
  const [hours, minutes] = start.split(":").map(Number);
  const end = (hours + 2) % 24;
  const format = (hour: number, minute: number) => `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
  return `${format(hours, minutes)} – ${format(end, minutes)}`;
}
