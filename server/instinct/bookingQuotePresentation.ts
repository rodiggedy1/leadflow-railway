import type { CreateCustomerBookingLinkInput } from "../../shared/bookingFunnel";
import { createPublicBookingPriceSnapshot, type PublicBookingPriceSnapshot } from "../../shared/publicBookingPricing";
import type { CallBookingQuoteReceipt } from "./callBookingQuoteStore";

export type BookingQuotePresentationLanguage = "en" | "es";
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const spanishExtras: Readonly<Record<string, string>> = {
  "inside-cabinets": "Interior de los gabinetes",
  "inside-fridge": "Interior del refrigerador",
  "inside-oven": "Interior del horno",
  "interior-windows": "Ventanas interiores",
  basement: "Sótano",
  "organizing-hour": "Una hora de organización",
  "laundry-load": "Lavandería",
  "wipe-walls-room": "Limpieza de paredes",
  "sweep-garage": "Barrido del garaje",
};
const spanishRecurrence = { weekly: "semanales", biweekly: "cada dos semanas", monthly: "mensuales" } as const;

/** The working call's factual formatting, shared without a second pricing calculation. */
function bookingQuoteFacts(snapshot: PublicBookingPriceSnapshot, language: BookingQuotePresentationLanguage = "en") {
  const extras = snapshot.breakdown.extras.length
    ? snapshot.breakdown.extras.map(extra => `${extra.quantity > 1 ? `${extra.quantity} × ` : ""}${language === "es" ? spanishExtras[extra.id] ?? extra.label : extra.label}`).join("\n")
    : language === "es" ? "No se seleccionaron servicios adicionales" : "No add-ons selected";
  const recurrence = snapshot.input.recurrence;
  const futureVisitPrice = recurrence !== "one-time" && snapshot.breakdown.futureVisitTotalCents !== null
    ? money(snapshot.breakdown.futureVisitTotalCents) : null;
  const frequency = futureVisitPrice === null ? "" : language === "es"
    ? `\nPróximas visitas (${spanishRecurrence[recurrence as keyof typeof spanishRecurrence]}): ${futureVisitPrice}.`
    : `\nYour ${recurrence} follow-up cleaning price is ${futureVisitPrice}.`;
  return { extras, frequency, firstCleaningPrice: money(snapshot.breakdown.firstCleaningTotalCents), futureVisitPrice };
}

/** Mechanically extracted call presentation. Call validation, sending and lifecycle stay with its owner. */
export function buildCallBookingQuoteSms(input: CreateCustomerBookingLinkInput, link: CallBookingQuoteReceipt["link"], origin: string): string {
  const snapshot = createPublicBookingPriceSnapshot(input.pricing);
  const url = new URL(link.urlPath, origin);
  if (url.origin !== new URL(origin).origin || !/^\/book\/mib-[a-z0-9-]+$/.test(url.pathname) || url.search || url.hash) throw new Error("CALL_QUOTE_LINK_INVALID");
  if (link.firstCleaningTotalCents !== snapshot.breakdown.firstCleaningTotalCents) throw new Error("CALL_QUOTE_PRICE_CHANGED");
  const firstName = input.customerName.split(/\s+/)[0];
  const { extras, frequency } = bookingQuoteFacts(snapshot);
  return `Hi ${firstName}! Madison from Maids in Black here. Thanks for chatting with me!\n\nHere’s your ${snapshot.serviceName.toLowerCase()} quote for your ${input.pricing.bedrooms === 0 ? "studio" : `${input.pricing.bedrooms}-bedroom`} ${input.pricing.homeType.toLowerCase()}:\n${extras}\n\nYour first-cleaning quote is ${money(link.firstCleaningTotalCents)}.${frequency}\nYou can review the details, choose your time and complete your booking here:\n${url.href}`;
}

function smsQuoteText(language: BookingQuotePresentationLanguage, first: string, future: string | null, extras: string,
  recurrence: PublicBookingPriceSnapshot["input"]["recurrence"], bookingLink: string | null): string {
  if (language === "es") {
    return `Tu cotización para la primera limpieza es ${first}.`
      + (future !== null && recurrence !== "one-time" ? `\nPróximas visitas (${spanishRecurrence[recurrence]}): ${future}.` : "")
      + `\nServicios adicionales:\n${extras}`
      + (bookingLink !== null ? `\nRevisa los detalles, elige tu horario y completa tu reserva en esta página:\n${bookingLink}` : "");
  }
  return `Your first-cleaning quote is ${first}.`
    + (future !== null && recurrence !== "one-time" ? `\nYour ${recurrence} follow-up cleaning price is ${future}.` : "")
    + `\nExtras:\n${extras}`
    + (bookingLink !== null ? `\nReview the details, choose your time and complete your booking on this page:\n${bookingLink}` : "");
}

/** A server-authored localized presentation, not permission to render model-owned layout. */
export function createSmsBookingQuotePresentation(snapshot: PublicBookingPriceSnapshot, hasLink: boolean,
  language: BookingQuotePresentationLanguage = "en"): string {
  return smsQuoteText(language, "{{firstCleaningPrice}}",
    snapshot.input.recurrence !== "one-time" && snapshot.breakdown.futureVisitTotalCents !== null ? "{{futureVisitPrice}}" : null,
    "{{extras}}", snapshot.input.recurrence, hasLink ? "{{bookingLink}}" : null);
}

/** The caller validates base and verifies the link URL/price/identity before rendering.
 * Only an exact server-authored Spanish presentation selects Spanish; all other
 * layouts (including old sparse or repeated-first-price templates) are ignored.
 * No model template is substituted into customer-facing factual text. */
export function renderSmsBookingQuoteText(base: string, presentation: string | null | undefined,
  snapshot: PublicBookingPriceSnapshot, bookingLinkUrl: string | null): string {
  const language = presentation === createSmsBookingQuotePresentation(snapshot, bookingLinkUrl !== null, "es") ? "es" : "en";
  const facts = bookingQuoteFacts(snapshot, language);
  return `${base}\n\n${smsQuoteText(language, facts.firstCleaningPrice, facts.futureVisitPrice, facts.extras, snapshot.input.recurrence, bookingLinkUrl)}`;
}

/** Fulfilled SMS links only. All facts come from the verified canonical input/snapshot;
 * this is presentation, not a second pricing engine or booking confirmation. */
export function renderSmsBookingQuoteSummary(input: CreateCustomerBookingLinkInput,
  snapshot: PublicBookingPriceSnapshot, bookingLinkUrl: string,
  language: BookingQuotePresentationLanguage = "en"): string {
  const facts = bookingQuoteFacts(snapshot, language);
  const locale = language === "es" ? "es-US" : "en-US";
  const date = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${input.requestedLocalDate}T12:00:00Z`));
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" })
    .format(new Date(`2000-01-01T${input.requestedLocalTime}:00Z`));
  const size = snapshot.input.bedrooms === 0 ? language === "es" ? "Estudio" : "Studio"
    : language === "es" ? `${snapshot.input.bedrooms} habitaciones` : `${snapshot.input.bedrooms} bed`;
  if (language === "es") {
    return `Tu limpieza está lista para agendar. Estos son los detalles:\n\n`
      + `📅 Fecha solicitada: ${date}\n⏰ Hora solicitada: ${time}\n📍 Dirección: ${input.address}\n`
      + `🧹 Servicio: ${snapshot.serviceName}\n🛏️ Tamaño: ${size} / ${snapshot.input.bathrooms} baños\n💵 Total: ${facts.firstCleaningPrice}`
      + facts.frequency + `\nServicios adicionales:\n${facts.extras}\n\n`
      + `Antes de nuestra llegada:\nRetira los objetos personales de las superficies y los pisos\n`
      + `Avísanos si hay mascotas o instrucciones de acceso 🧼\n\n`
      + `Último paso para completar tu reserva: 👇\n`
      + `Agregamos tus datos a este enlace rápido para que puedas terminar en unos 60 segundos ⏱️\n🔗 ${bookingLinkUrl}`;
  }
  return `Your cleaning is ready to schedule. Here are the details:\n\n`
    + `📅 Requested date: ${date}\n⏰ Requested time: ${time}\n📍 Address: ${input.address}\n`
    + `🧹 Service: ${snapshot.serviceName}\n🛏️ Home size: ${size} / ${snapshot.input.bathrooms} bath\n💵 Total: ${facts.firstCleaningPrice}`
    + facts.frequency + `\nExtras:\n${facts.extras}\n\n`
    + `Before we arrive:\nPlease clear personal items off counters and floors\n`
    + `Let us know about pets or any entry instructions 🧼\n\n`
    + `Last step to complete your booking: 👇\n`
    + `We’ve added your info to this quick link, so you can finish in about 60 seconds ⏱️\n🔗 ${bookingLinkUrl}`;
}
