import type { BookingQuotePresentationLanguage } from "./bookingQuotePresentation";
import type { SmsBookingQuoteAdvanceResult, SmsBookingQuoteFields, SmsBookingQuoteUpdate } from "./smsBookingQuote";

const questions: Partial<Record<keyof SmsBookingQuoteFields, Record<BookingQuotePresentationLanguage, string>>> = {
  pricingMode: { en: "Would you like a home-cleaning quote or an hourly-cleaning quote?", es: "¿Quieres una cotización de limpieza del hogar o de limpieza por horas?" },
  serviceId: { en: "Would you like a standard, deep or move-out cleaning?", es: "¿Quieres una limpieza estándar, profunda o de mudanza?" },
  bedrooms: { en: "How many bedrooms are there, or is it a studio?", es: "¿Cuántas habitaciones hay, o es un estudio?" },
  bathrooms: { en: "How many bathrooms are there?", es: "¿Cuántos baños hay?" },
  homeType: { en: "One detail before I can prepare your quote: is this a house, apartment, townhome or condo?", es: "Un detalle antes de preparar tu cotización: ¿es una casa, apartamento, casa adosada o condominio?" },
  condition: { en: "How much cleaning does it need (1 to 10)?\n1 = already clean, 5 = normal, 10 = heavy buildup.", es: "¿Cuánta limpieza necesita (del 1 al 10)?\n1 = limpio, 5 = normal, 10 = mucha suciedad." },
  maidCount: { en: "How many cleaners would you like for your hourly cleaning?", es: "¿Cuántas personas quieres para tu limpieza por horas?" },
  hourCount: { en: "How many hours would you like for your hourly cleaning?", es: "¿Cuántas horas quieres para tu limpieza por horas?" },
  extras: { en: "Would you like any extras, or no extras?", es: "¿Quieres algún servicio adicional o ninguno?" },
  extrasConfirmed: { en: "Are the extras you've selected correct, or would you like to change them?", es: "¿Son correctos los servicios adicionales que seleccionaste o quieres cambiarlos?" },
  recurrence: { en: "Would you like one-time, weekly, biweekly or monthly cleaning?", es: "¿Quieres una limpieza única, semanal, cada dos semanas o mensual?" },
  customerName: { en: "What name would you like to use for your cleaning quote?", es: "¿Qué nombre quieres usar para tu cotización de limpieza?" },
  address: { en: "What is the address for your cleaning?", es: "¿Cuál es la dirección para tu limpieza?" },
  requestedLocalDate: { en: "Which upcoming date would you prefer for your cleaning?", es: "¿Qué próxima fecha prefieres para tu limpieza?" },
  requestedLocalTime: { en: "What time would you prefer for your cleaning?", es: "¿Qué horario prefieres para tu limpieza?" },
};

/** Presentation only. Canonical qualification remains the sole required-field policy.
 * A premature quote/link asks one missing fact instead of passing through page prose.
 * Ordinary collection and fulfilled canonical quotes/links retain their existing copy. */
export function createSmsBookingQuoteMissingQuestion(advanced: SmsBookingQuoteAdvanceResult,
  action: SmsBookingQuoteUpdate["action"], language: BookingQuotePresentationLanguage = "en"): string | null {
  if (action === "collect" || (action === "quote" && advanced.preview?.success)
    || (action === "link" && advanced.input !== null && advanced.preview?.success)) return null;
  const field = advanced.missing[0] as keyof SmsBookingQuoteFields | undefined;
  const questionField = field === "extrasConfirmed" && advanced.state.fields.extras?.length === 0 ? "extras" : field;
  const question = questionField === undefined ? undefined : questions[questionField]?.[language];
  // Do not fall back to a model claim or invent a fact for an unknown requirement.
  if (!question) throw new Error("SMS_QUOTE_MISSING_QUESTION");
  return question;
}
