import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clipboard,
  ChevronRight,
  Clock3,
  CreditCard,
  Heart,
  Home,
  LockKeyhole,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PremiumCardSetupForm } from "@/components/BookingPaymentCheckout";
import { useCanonicalBookingFlow } from "@/components/useCanonicalBookingFlow";
import { easternCalendarWeekday, easternDateIso, easternDateLabel, easternMonthDate, easternMonthLabel, parseEasternDate } from "@shared/easternTime";
import standardBedroom from "@/assets/book-now-review/standard-bedroom.png";
import deepKitchen from "@/assets/book-now-review/deep-kitchen.png";
import moveoutBoxes from "@/assets/book-now-review/moveout-boxes.png";
import livingRoom from "@/assets/book-now-review/living-room.jpg";
import kitchen from "@/assets/book-now-review/kitchen.jpg";
import stillLife from "@/assets/book-now-review/still-life.jpg";
import upsellCarpetCleaning from "@/assets/book-now-review/upsell-carpet-cleaning.webp";
import upsellExteriorWindowCleaning from "@/assets/book-now-review/upsell-exterior-window-cleaning.jpeg";
import {
  calculatePublicBookingPrice,
  getPublicBookingServiceName,
  PUBLIC_BOOKING_PRICED_EXTRAS,
  PUBLIC_BOOKING_POST_BOOKING_UPSELLS,
  PUBLIC_BOOKING_PRICING_VERSION,
  type PublicBookingHomeType,
} from "@shared/publicBookingPricing";
import {
  CANONICAL_CONDITION_COPY,
  CANONICAL_FREQUENCIES,
  CANONICAL_SERVICE_IDS,
  CANONICAL_TIME_SLOTS,
  createCanonicalBookingInput,
  createCanonicalPricingInput,
} from "@shared/canonicalBooking";
import { CANONICAL_POST_BOOKING_UPSELLS } from "@shared/canonicalBookingCatalog";
import "./booking-flow-review.css";
import "./internal-booking.css";

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string
);
const SERVICES = CANONICAL_SERVICE_IDS;
const FREQUENCIES = CANONICAL_FREQUENCIES;
const HOME_TYPES: PublicBookingHomeType[] = [
  "House",
  "Apartment",
  "Townhome",
  "Condo",
];
const TIMES = CANONICAL_TIME_SLOTS;
const EXTRA_OPTIONS = Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS);
const CONDITION_COPY = CANONICAL_CONDITION_COPY;
const STEPS = [
  "Cleaning type",
  "Home details",
  "Home condition",
  "Extras",
  "Date & time",
  "Customer",
  "Payment method",
  "Final review",
  "Additional services",
];

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
type PaymentMethod = "card" | "cashapp" | "invoice";
type AdditionalService = {
  id: string;
  title: string;
  copy: string;
  unitPriceCents: number;
  quantityLabel: string;
  image: string;
};
const ADDITIONAL_SERVICE_IMAGES = {
  "moving-help": livingRoom,
  "carpet-cleaning": upsellCarpetCleaning,
  "exterior-window-cleaning": upsellExteriorWindowCleaning,
  "junk-removal": livingRoom,
  "furniture-cleaning": kitchen,
  "appliance-cleaning": stillLife,
  "window-cleaning": livingRoom,
  "pet-area-cleaning": kitchen,
} as const;
const ADDITIONAL_SERVICES: AdditionalService[] = Object.entries(CANONICAL_POST_BOOKING_UPSELLS).map(([id, value]) => ({
  id,
  title: value.title,
  copy: value.copy,
  unitPriceCents: value.unitPriceCents,
  quantityLabel: value.quantityLabel,
  image: ADDITIONAL_SERVICE_IMAGES[id as keyof typeof ADDITIONAL_SERVICE_IMAGES],
}));

function tomorrowIso() {
  return easternDateIso(new Date(), 1);
}
function money(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function label(value: string) {
  if (value === "one-time") return "One-time";
  if (value === "biweekly") return "Bi-weekly";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function dateLabel(value: string) {
  if (!value) return "Choose a date";
  return easternDateLabel(value);
}

function BookingTeleprompter() {
  const [mode, setMode] = useState<"full" | "manual" | "auto">("full");
  const [line, setLine] = useState(0);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const faq = trpc.bookingFunnel.answerFaq.useMutation();
  const lines = [
    "Absolutely — I can help you get that set up. Let me first make sure we choose the right cleaning.",
    "Is this more of a routine cleaning, does the home need a deeper reset, or are you moving in or out?",
  ];

  useEffect(() => {
    if (mode !== "auto") return;
    const timer = window.setInterval(() => {
      setLine(current => (current + 1) % lines.length);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [mode, lines.length]);

  const askFaq = async () => {
    const trimmed = question.trim();
    if (trimmed.length < 2 || faq.isPending) return;
    const result = await faq.mutateAsync({ question: trimmed });
    setAnswer(result.answer);
  };

  return (
    <section className="booking-teleprompter" aria-label="Live call script">
      <header className="booking-teleprompter-head">
        <div className="booking-teleprompter-title">
          <span className="booking-teleprompter-dot" />
          <div>
            <strong>LIVE CALL · CLEANING TYPE</strong>
            <span>Conversation follows the booking</span>
          </div>
        </div>
        <div className="booking-teleprompter-controls">
          {(["full", "manual", "auto"] as const).map(option => (
            <button
              key={option}
              type="button"
              className={mode === option ? "active" : ""}
              onClick={() => {
                setMode(option);
                setLine(0);
              }}
            >
              {option[0].toUpperCase() + option.slice(1)}
            </button>
          ))}
          <button
            type="button"
            className="booking-teleprompter-question-button"
            onClick={() => setQuestionOpen(open => !open)}
          >
            <Sparkles /> Customer asked a question
          </button>
        </div>
      </header>
      <div
        className={`booking-teleprompter-body booking-teleprompter-body--${mode}`}
      >
        {mode === "full" ? (
          <>
            <div className="booking-teleprompter-label">
              ✦ CALL SCRIPT · CLEANING TYPE
            </div>
            <p>
              “Absolutely — I can help you get that set up. Let me first make
              sure we choose the right cleaning.{" "}
              <strong>
                Is this more of a routine cleaning, does the home need a deeper
                reset, or are you moving in or out?
              </strong>
              ”
            </p>
          </>
        ) : (
          <p>{lines[line]}</p>
        )}
      </div>
      {mode === "manual" && (
        <footer className="booking-teleprompter-footer">
          <button
            type="button"
            onClick={() => setLine(current => Math.max(0, current - 1))}
            disabled={line === 0}
          >
            Previous
          </button>
          <span>
            {line + 1} of {lines.length}
          </span>
          <button
            type="button"
            onClick={() =>
              setLine(current => Math.min(lines.length - 1, current + 1))
            }
            disabled={line === lines.length - 1}
          >
            Next
          </button>
        </footer>
      )}
      {questionOpen && (
        <div className="booking-teleprompter-faq">
          <label htmlFor="booking-customer-question">
            Ask the FAQ assistant
          </label>
          <div>
            <input
              id="booking-customer-question"
              value={question}
              onChange={event => setQuestion(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") void askFaq();
              }}
              placeholder="Type the customer’s question"
            />
            <button
              type="button"
              onClick={() => void askFaq()}
              disabled={faq.isPending || question.trim().length < 2}
            >
              {faq.isPending ? "Thinking…" : "Ask"}
            </button>
          </div>
          {answer && <p>{answer}</p>}
        </div>
      )}
    </section>
  );
}


function ChoiceCard({
  selected,
  onClick,
  icon: Icon,
  title,
  description,
  image,
  price,
  meta,
  say,
}: {
  selected: boolean;
  onClick: () => void;
  icon: typeof Sparkles;
  title: string;
  description: string;
  image?: string;
  price?: string;
  meta?: string;
  say?: string;
}) {
  return (
    <article
      type="button"
      className={`service-card${selected ? " selected" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") onClick();
      }}
    >
      <div className="image-wrap">
        <img src={image} alt={title} />
        <span className="radio" />
      </div>
      <div className="card-body">
        <div className="title-row">
          <h3>{title}</h3>
          <span className="help">?</span>
        </div>
        <p>{description}</p>
        {price && (
          <div className="price-row">
            <span>From</span>
            <strong>{price}</strong>
          </div>
        )}
        {meta && <div className="meta">{meta}</div>}
        {say && (
          <div className="say-box">
            <strong>◌ &nbsp; What to say to the customer</strong>
            <p>“{say}”</p>
          </div>
        )}
      </div>
    </article>
  );
}

function StepperCard({
  title,
  value,
  min,
  max,
  display,
  onChange,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <article className="counter-card">
      <div className="counter-head">
        <span>
          {title === "Bedrooms" ? "▣" : title === "Bathrooms" ? "♧" : "♙"}{" "}
          &nbsp; {title}
        </span>
        <span className="help">?</span>
      </div>
      <strong>{display}</strong>
      <div>
        <button
          type="button"
          aria-label={`Decrease ${title}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <button
          type="button"
          aria-label={`Increase ${title}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          ＋
        </button>
      </div>
    </article>
  );
}

function ReviewCard({
  number,
  title,
  detail,
  icon: Icon,
  onEdit,
}: {
  number: number;
  title: string;
  detail: string;
  icon: typeof Home;
  onEdit: () => void;
}) {
  return (
    <article className="internal-review-card">
      <span className="internal-review-icon">
        <Icon />
      </span>
      <div>
        <small>STEP {number}</small>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <button type="button" onClick={onEdit}>
        Edit <ChevronRight />
      </button>
    </article>
  );
}

export function InternalBooking({ onClose }: { onClose?: () => void }) {
  const [, navigate] = useLocation();
  const {
    draft: canonicalDraft,
    step,
    setStep,
    pricingInput,
    pricing,
    serviceId,
    setServiceId,
    pricingMode,
    setPricingMode,
    bedrooms,
    setBedrooms,
    bathrooms,
    setBathrooms,
    homeType,
    setHomeType,
    maidCount,
    setMaidCount,
    hourCount,
    setHourCount,
    condition,
    setCondition,
    frequency,
    setFrequency,
    date,
    setDate,
    time,
    setTime,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerEmail,
    setCustomerEmail,
    address,
    setAddress,
    extras,
    setExtra,
  } = useCanonicalBookingFlow({ stepCount: 9 });
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [additionalServices, setAdditionalServices] = useState<
    Record<string, number>
  >({});
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scriptCopied, setScriptCopied] = useState(false);
  const [createdBooking, setCreatedBooking] = useState<{
    bookingId: number;
    publicBookingNumber: string;
  } | null>(null);
  const [cardClientSecret, setCardClientSecret] = useState<string | null>(null);
  const [cardSetupIntentId, setCardSetupIntentId] = useState<string | null>(
    null
  );
  const [cardSaved, setCardSaved] = useState(false);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step, success, createdBooking]);

  const selectedExtras = EXTRA_OPTIONS.filter(([id]) => (extras[id] ?? 0) > 0);
  const selectedAdditionalServices = ADDITIONAL_SERVICES.filter(
    service => (additionalServices[service.id] ?? 0) > 0
  );
  const additionalServicesTotalCents = selectedAdditionalServices.reduce(
    (total, service) =>
      total + service.unitPriceCents * (additionalServices[service.id] ?? 0),
    0
  );
  const setAdditionalService = (id: string, delta: number) =>
    setAdditionalServices(current => ({
      ...current,
      [id]: Math.max(0, (current[id] ?? 0) + delta),
    }));
  const startCardSetup =
    trpc.bookingPaymentAdmin.startInternalCardSetup.useMutation({
      onSuccess: result => {
        if (result.alreadyComplete) {
          setCardSaved(true);
          setCardClientSecret(null);
          setCardSetupIntentId(null);
          setStep(8);
          return;
        }
        setCardClientSecret(result.clientSecret);
        setCardSetupIntentId(result.setupIntentId);
      },
      onError: mutationError => setError(mutationError.message),
    });
  const confirmCardSetup =
    trpc.bookingPaymentAdmin.confirmInternalCardSetup.useMutation({
      onSuccess: () => {
        setCardSaved(true);
        setCardClientSecret(null);
        setCardSetupIntentId(null);
        setStep(8);
      },
      onError: mutationError => setError(mutationError.message),
    });
  const updateAdditionalServices =
    trpc.bookings.updateAdditionalServices.useMutation({
      onSuccess: () => {
        if (createdBooking)
          setSuccess(
            `${createdBooking.publicBookingNumber} created with card saved. It is now in Bookings for assignment and follow-up.`
          );
      },
      onError: mutationError => setError(mutationError.message),
    });
  const createBooking = trpc.bookings.createInternal.useMutation({
    onSuccess: result => {
      if (paymentMethod === "card") {
        setCreatedBooking({
          bookingId: result.bookingId,
          publicBookingNumber: result.publicBookingNumber,
        });
        startCardSetup.mutate({ bookingId: result.bookingId });
      } else
        setSuccess(
          `${result.publicBookingNumber} created at ${money(result.totalCents)}. It is now in Bookings for assignment and follow-up.`
        );
      setError(null);
    },
    onError: mutationError => {
      setError(mutationError.message);
      setSuccess(null);
    },
  });

  const submit = () => {
    setError(null);
    if (createdBooking) {
      updateAdditionalServices.mutate({
        bookingId: createdBooking.bookingId,
        additionalServices: Object.entries(additionalServices)
          .filter(([, quantity]) => quantity > 0)
          .map(([id, quantity]) => ({ id, quantity })),
      });
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    createBooking.mutate({
      idempotencyKey,
      paymentMethod,
      companyNotes: notes.trim() || null,
      additionalServices: paymentMethod === "card"
        ? []
        : Object.entries(additionalServices)
            .filter(([, quantity]) => quantity > 0)
            .map(([id, quantity]) => ({ id, quantity })),
      booking: {
        ...createCanonicalBookingInput(canonicalDraft, {
          idempotencyKey,
          surface: "popup",
          acceptedPricingVersion: PUBLIC_BOOKING_PRICING_VERSION,
          acceptedTotalCents: pricing.firstCleaningTotalCents,
        }),
        pricing: {
          ...pricingInput,
          extras: [...pricingInput.extras],
        },
      },
    });
  };
  const next = () => {
    setError(null);
    if (
      step === 6 &&
      (!customerName.trim() ||
        !customerPhone.trim() ||
        !customerEmail.trim() ||
        !address.trim())
    ) {
      setError("Complete the customer information before continuing.");
      return;
    }
    if (step === 6 && paymentMethod === "card" && !createdBooking) {
      setStep(7);
      submit();
      return;
    }
    if (step === 7 && paymentMethod === "card" && !createdBooking) {
      submit();
      return;
    }
    if (
      step === 7 &&
      paymentMethod === "card" &&
      createdBooking &&
      !cardSaved
    ) {
      setError("Save the card before continuing.");
      return;
    }
    if (step === 9) {
      submit();
      return;
    }
    setStep(Math.min(9, step + 1) as Step);
  };
  const back = () => {
    setError(null);
    setStep(Math.max(1, step - 1) as Step);
  };
  const shellClass = onClose
    ? "internal-booking-modal-shell"
    : "internal-booking-shell";

  if (success)
    return (
      <main className={shellClass}>
        <section className="internal-booking-success">
          <CheckCircle2 size={44} />
          <p className="eyebrow">BOOKING CREATED</p>
          <h1>{success.split(" created")[0]}</h1>
          <p>{success.slice(success.indexOf(" created") + 1)}</p>
          <button
            type="button"
            onClick={() => (onClose ? onClose() : navigate("/admin/bookings"))}
          >
            Open bookings CRM
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setSuccess(null);
              setCreatedBooking(null);
              setCardClientSecret(null);
              setCardSetupIntentId(null);
              setStep(1);
            }}
          >
            Create another booking
          </button>
        </section>
      </main>
    );

  const serviceName = getPublicBookingServiceName(serviceId);
  const homeDetail =
    pricingMode === "hourly"
      ? `${maidCount} maids · ${hourCount} hours`
      : `${bedrooms === 0 ? "Studio" : `${bedrooms} bed`} · ${bathrooms} bath · ${homeType}`;
  const customerFirstName =
    customerName.trim().split(/\s+/).filter(Boolean)[0] || "there";
  const selectedTimeLabel =
    TIMES.find(value => value === time) === "08:30"
      ? "8:30 AM"
      : TIMES.find(value => value === time) === "11:00"
        ? "11:00 AM"
        : TIMES.find(value => value === time) === "13:30"
          ? "1:30 PM"
          : TIMES.find(value => value === time) === "16:30"
            ? "4:30 PM"
            : time || "your selected time";
  const selectedExtrasScript = selectedExtras
    .map(([, extra]) => extra.label)
    .join(", ");
  const homeScript =
    pricingMode === "hourly"
      ? `${maidCount}-maid, ${hourCount}-hour cleaning`
      : `${bedrooms === 0 ? "studio" : `${bedrooms}-bedroom`}, ${bathrooms}-bathroom ${homeType.toLowerCase()} home`;
  const recurrenceScript = label(frequency);
  const customerScript = [
    `Alright ${customerFirstName}, let me make sure I have everything right.`,
    `You're scheduled for a ${serviceName} for your ${homeScript} on ${dateLabel(date)}.`,
    `Your arrival window is ${selectedTimeLabel} to ${selectedTimeLabel === "8:30 AM" ? "10:30 AM" : selectedTimeLabel === "11:00 AM" ? "1:00 PM" : selectedTimeLabel === "1:30 PM" ? "3:30 PM" : selectedTimeLabel === "4:30 PM" ? "6:30 PM" : "the end of the arrival window"}.`,
    selectedExtrasScript ? `We're also adding ${selectedExtrasScript}.` : "",
    frequency === "one-time"
      ? `Your cleaning total is ${money(pricing.firstCleaningTotalCents)}.`
      : `Your first cleaning is ${money(pricing.firstCleaningTotalCents)}, and your ${recurrenceScript.toLowerCase()} cleanings after that will be ${money(pricing.futureVisitTotalCents ?? pricing.firstCleaningTotalCents)}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const stepContent =
    step === 1 ? (
      <>
        <BookingTeleprompter />
        <div className="content-top">
          <div className="eyebrow">STEP 1 OF 9</div>
          <h2>Select service type</h2>
          <p className="subtitle">
            Choose the cleaning service that best fits what the customer needs.
          </p>
        </div>
        <div className="suggestion">
          <div className="suggestion-icon">✦</div>
          <div>
            <strong>AI suggestion</strong>
            <span>
              Based on what you’ve shared, Deep Cleaning is likely the best fit.
            </span>
          </div>
          <button
            type="button"
            className="outline-btn"
            onClick={() => setServiceId("deep")}
          >
            Use suggestion
          </button>
          <button type="button" className="icon-btn" aria-label="Dismiss">
            ×
          </button>
        </div>
        <div className="service-grid">
          {SERVICES.map(value => (
            <ChoiceCard
              key={value}
              selected={serviceId === value}
              onClick={() => setServiceId(value)}
              icon={Sparkles}
              image={
                value === "standard"
                  ? standardBedroom
                  : value === "deep"
                    ? deepKitchen
                    : moveoutBoxes
              }
              price={money(
                calculatePublicBookingPrice({
                  pricingMode,
                  serviceId: value,
                  bedrooms,
                  bathrooms,
                  homeType,
                  condition,
                  maidCount,
                  hourCount,
                  extras: Object.entries(extras)
                    .filter(([, quantity]) => quantity > 0)
                    .map(([id, quantity]) => ({ id, quantity })),
                  recurrence: frequency,
                }).firstCleaningTotalCents
              )}
              meta={
                value === "standard"
                  ? "~ 2.5 hours • Team payout ~$93"
                  : value === "deep"
                    ? "~ 3.5 hours • Team payout ~$137"
                    : "~ 4 hours • Team payout ~$164"
              }
              say={
                value === "standard"
                  ? "This is our most popular option. It keeps your home clean and fresh with all the essential cleaning tasks."
                  : value === "deep"
                    ? "This is a more detailed clean. We focus on the areas that build up over time, so your home feels like a fresh start."
                    : "This is a top-to-bottom clean that gets the home ready for a new tenant or homeowner. We clean inside cabinets, appliances, and more."
              }
              title={getPublicBookingServiceName(value)}
              description={
                value === "standard"
                  ? "Routine cleaning for a regular, well-maintained home."
                  : value === "deep"
                    ? "A more detailed clean for homes that need extra attention."
                    : "A thorough clean before a move or handoff."
              }
            />
          ))}
        </div>
      </>
    ) : step === 2 ? (
      <>
        <div className="content-top">
          <div className="eyebrow">STEP 2 OF 9</div>
          <h2>Tell us about the home</h2>
          <p className="subtitle">
            Use the same bedroom, bathroom, hourly, and recurring options as the
            public form.
          </p>
        </div>
        <div className="mode-toggle">
          <button
            type="button"
            className={`mode${pricingMode === "home" ? " selected" : ""}`}
            onClick={() => setPricingMode("home")}
          >
            Bedrooms &amp; bathrooms
          </button>
          <button
            type="button"
            className={`mode${pricingMode === "hourly" ? " selected" : ""}`}
            onClick={() => setPricingMode("hourly")}
          >
            Book hourly instead
          </button>
        </div>
        {pricingMode === "home" ? (
          <>
            <div className="counter-grid">
              <StepperCard
                title="Bedrooms"
                value={bedrooms}
                min={0}
                max={7}
                display={bedrooms === 0 ? "Studio" : String(bedrooms)}
                onChange={setBedrooms}
              />
              <StepperCard
                title="Bathrooms"
                value={bathrooms}
                min={1}
                max={5}
                display={String(bathrooms)}
                onChange={setBathrooms}
              />
            </div>
            <div className="field-label">Home type</div>
            <div className="home-type-grid">
              {HOME_TYPES.map(value => (
                <button
                  type="button"
                  key={value}
                  className={`choice${homeType === value ? " selected" : ""}`}
                  onClick={() => setHomeType(value)}
                >
                  <span>
                    {value === "House"
                      ? "⌂"
                      : value === "Apartment"
                        ? "▥"
                        : value === "Townhome"
                          ? "♧"
                          : "▥"}
                  </span>
                  <strong>{value}</strong>
                  <i />
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="counter-grid">
            <StepperCard
              title="Maids"
              value={maidCount}
              min={1}
              max={4}
              display={String(maidCount)}
              onChange={setMaidCount}
            />
            <StepperCard
              title="Hours"
              value={hourCount}
              min={1}
              max={8}
              display={String(hourCount)}
              onChange={setHourCount}
            />
          </div>
        )}
        <div className="divider" />
        <div className="field-label">Recurring frequency</div>
        <div className="frequency-grid">
          {FREQUENCIES.map(value => (
            <button
              type="button"
              key={value}
              className={`frequency${frequency === value ? " selected" : ""}`}
              onClick={() => setFrequency(value)}
            >
              <span>▦</span>
              <strong>{label(value)}</strong>
              <small>
                {value === "weekly"
                  ? "Save 20% after visit one"
                  : value === "biweekly"
                    ? "Save 15% after visit one"
                    : value === "monthly"
                      ? "Save 10% after visit one"
                      : "Single visit"}
              </small>
              <i />
            </button>
          ))}
        </div>
        <div className="guidance page2-guidance">
          <div className="guidance-icon">✦</div>
          <div>
            <strong>AI guidance</strong>
            <p>
              A 2 bed / 2 bath house with bi-weekly service is a common setup.
              Consider mentioning any pets or specific areas in the notes if
              relevant.
            </p>
          </div>
          <button type="button" className="outline-btn">
            Add to notes
          </button>
        </div>
      </>
    ) : step === 3 ? (
      <>
        <div className="content-top">
          <div className="eyebrow">STEP 3 OF 9</div>
          <h2>How is the home currently maintained?</h2>
          <p className="subtitle">
            This helps set a fair estimate and enough time for the team.
          </p>
        </div>
        <div className="condition-grid">
          {CONDITION_COPY.map((copy, index) => (
            <button
              type="button"
              key={copy}
              className={`condition${condition === index + 1 ? " selected" : ""}`}
              onClick={() => setCondition(index + 1)}
            >
              <b>{index + 1}</b>
              <span className="condition-icon">
                {["✦", "♡", "⌂", "▰", "♣", "!", "♢", "↻", "✧", "⌂"][index]}
              </span>
              <strong>{copy}</strong>
              <small>
                {copy === "Bring the good gloves"
                  ? "Pets in the home or extra care needed."
                  : "Normal day-to-day condition."}
              </small>
              <i />
            </button>
          ))}
        </div>
        <div className="guidance page3-guidance">
          <div className="guidance-icon">✦</div>
          <div>
            <strong>AI guidance</strong>
            <p>
              You mentioned a pet in the home. Selecting “Bring the good gloves”
              makes sense. This option includes extra time and the right
              supplies for pet hair and care.
            </p>
          </div>
          <button
            type="button"
            className="outline-btn"
            onClick={() => setCondition(5)}
          >
            Use this
          </button>
        </div>
      </>
    ) : step === 4 ? (
      <>
        <div className="content-top">
          <div className="eyebrow">STEP 4 OF 9</div>
          <h2>Need anything else?</h2>
          <p className="subtitle">
            Add services and quantities while you are on the call.
          </p>
        </div>
        <div className="extras-grid">
          {EXTRA_OPTIONS.map(([id, extra], index) => {
            const quantity = extras[id] ?? 0;
            const icons = ["▣", "▤", "▥", "⊞", "▥", "▱", "▤", "✦", "⌂"];
            const descriptions = [
              "Clean inside kitchen cabinets.",
              "Clean inside refrigerator.",
              "Deep clean oven interior.",
              "Clean interior windows.",
              "Includes living areas and floors.",
              "General organizing help.",
              "Wash, dry and fold.",
              "Spot clean walls and doors.",
              "Sweep and tidy garage.",
            ];
            return (
              <article
                className={`extra-card${quantity ? " selected" : ""}`}
                key={id}
              >
                <button
                  className="extra-check"
                  type="button"
                  aria-label={`Select ${extra.label}`}
                  onClick={() => setExtra(id, quantity ? -quantity : 1)}
                >
                  {quantity ? "✓" : "□"}
                </button>
                <span className="extra-icon">{icons[index]}</span>
                <div>
                  <strong>{extra.label}</strong>
                  <small>{descriptions[index]}</small>
                  <em>
                    ${extra.unitPrice}
                    {extra.quantityUnit ? ` / ${extra.quantityUnit}` : ""}
                  </em>
                </div>
                <div className="quantity">
                  <button
                    type="button"
                    onClick={() => setExtra(id, -1)}
                    disabled={!quantity}
                  >
                    −
                  </button>
                  <b>{quantity}</b>
                  <button type="button" onClick={() => setExtra(id, 1)}>
                    ＋
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </>
    ) : step === 5 ? (
      <>
        <div className="content-top">
          <div className="eyebrow">STEP 5 OF 9</div>
          <h2>When should the cleaning happen?</h2>
          <p className="subtitle">
            Choose the date and arrival window that works best for the customer.
          </p>
        </div>
        <div className="schedule-layout">
          <section className="calendar-card">
            <div className="schedule-card-head">
              <strong>Select a date</strong>
              <span>
                {easternMonthLabel(parseEasternDate(date))}
                <button type="button" aria-label="Previous month">
                  ‹
                </button>
                <button type="button" aria-label="Next month">
                  ›
                </button>
              </span>
            </div>
            <div className="weekdays">
              {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => (
                <span key={day}>{day}</span>
              ))}
            </div>
            <div className="calendar-grid">
              {Array.from(
                {
                  length:
                    easternCalendarWeekday(parseEasternDate(date).getUTCFullYear(), parseEasternDate(date).getUTCMonth()) +
                    new Date(Date.UTC(parseEasternDate(date).getUTCFullYear(), parseEasternDate(date).getUTCMonth() + 1, 0, 12)).getUTCDate(),
                },
                (_, index) => index
              ).map(index => {
                const monthDate = parseEasternDate(date);
                const firstDay = easternCalendarWeekday(monthDate.getUTCFullYear(), monthDate.getUTCMonth());
                const day = index - firstDay + 1;
                if (day < 1)
                  return <span className="muted" key={`empty-${index}`} />;
                const value = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                return (
                  <button
                    className={`day${value === date ? " selected" : ""}`}
                    disabled={value < tomorrowIso()}
                    key={value}
                    type="button"
                    onClick={() => setDate(value)}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </section>
          <section className="arrival-card">
            <strong>Select an arrival window</strong>
            <p>We&apos;ll send your team within a 2-hour window.</p>
            <div className="arrival-list">
              {TIMES.map((value, index) => {
                const end = ["10:30", "13:00", "15:30", "18:00"][index];
                const formatTime = (raw: string) => {
                  const [hour, minute] = raw.split(":").map(Number);
                  const suffix = hour >= 12 ? "PM" : "AM";
                  const displayHour = hour % 12 || 12;
                  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
                };
                return (
                  <button
                    className={`arrival${time === value ? " selected" : ""}`}
                    key={value}
                    type="button"
                    onClick={() => setTime(value)}
                  >
                    <i />
                    <span>◷</span>
                    <b>
                      {formatTime(value)} – {formatTime(end)}
                    </b>
                    {index === 0 && <em>Most popular</em>}
                  </button>
                );
              })}
            </div>
          </section>
          <aside className="window-info">
            <h3>
              <span>ⓘ</span> About the 2-hour window
            </h3>
            <p>
              We&apos;ll send your cleaning team within the selected 2-hour
              window. You&apos;ll get a text when they&apos;re on the way with a
              more exact ETA (usually 30–60 minutes before arrival).
            </p>
            <hr />
            <h3>Need a specific time?</h3>
            <p>
              If it&apos;s urgent or you have a preference, add a note and
              we&apos;ll do our best to accommodate.
            </p>
          </aside>
        </div>
      </>
    ) : step === 6 ? (
      <>
        <div className="content-top">
          <div className="eyebrow">STEP 6 OF 9</div>
          <h2>Who are we booking for?</h2>
          <p className="subtitle">
            Capture the customer details and anything the team should know.
          </p>
        </div>
        <div className="customer-form">
          <label>
            Full name
            <input
              required
              value={customerName}
              onChange={event => setCustomerName(event.target.value)}
              placeholder="Rohan Gilkes"
            />
          </label>
          <label>
            Phone number
            <input
              required
              value={customerPhone}
              onChange={event => setCustomerPhone(event.target.value)}
              placeholder="(302) 981-6192"
            />
          </label>
          <label>
            Email <span>(for receipt and updates)</span>
            <input
              required
              type="email"
              value={customerEmail}
              onChange={event => setCustomerEmail(event.target.value)}
              placeholder="customer@example.com"
            />
          </label>
          <label>
            Service address{" "}
            <button
              className="apt-prompt"
              type="button"
              onClick={() =>
                document.getElementById("internal-service-address")?.focus()
              }
            >
              Apt / Unit number?
            </button>
            <div className="address-field">
              <input
                id="internal-service-address"
                required
                value={address}
                onChange={event => setAddress(event.target.value)}
                placeholder="Street, city, state, ZIP"
              />
            </div>
          </label>
          <label className="notes-field">
            Access details / notes <span>(optional)</span>
            <textarea
              value={notes}
              onChange={event => setNotes(event.target.value)}
              maxLength={500}
              placeholder="Gate code, parking, pets, or anything the team should know"
            />
            <small className="char-count">{notes.length}/500</small>
          </label>
        </div>
        <div className="guidance customer-guidance">
          <div className="guidance-icon">▤</div>
          <div>
            <strong>AI guidance</strong>
            <p>
              Collect any important access details (gate codes, lockbox,
              parking, pets) and share customer preferences with the team.
            </p>
          </div>
        </div>
      </>
    ) : step === 7 ? (
      <>
        <div className="content-top">
          <div className="eyebrow">STEP 7 OF 9</div>
          <h2>Payment</h2>
          <p className="subtitle">
            Add a card to hold the booking. You won’t be charged until after the
            service is completed.
          </p>
        </div>
        <div className="payment-methods">
          {(["card", "cashapp", "invoice"] as PaymentMethod[]).map(value => (
            <button
              key={value}
              className={`payment-method${paymentMethod === value ? " selected" : ""}`}
              type="button"
              disabled={!!createdBooking}
              onClick={() => setPaymentMethod(value)}
            >
              <i />
              <span
                className={`payment-icon${value === "cashapp" ? " cash" : ""}`}
              >
                {value === "cashapp" ? "$" : value === "invoice" ? "▤" : "▣"}
              </span>
              <strong>
                {value === "cashapp"
                  ? "Cash App"
                  : value === "invoice"
                    ? "Invoice"
                    : "Credit card"}
                {value === "card" && <small>Recommended</small>}
              </strong>
              <em>
                {value === "card"
                  ? "Most common"
                  : value === "cashapp"
                    ? "Send payment request\nafter booking"
                    : "Mark as pay later\nCollect on service day"}
              </em>
            </button>
          ))}
        </div>
        {paymentMethod === "card" &&
        createdBooking &&
        cardClientSecret &&
        cardSetupIntentId ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: cardClientSecret,
              appearance: { theme: "stripe" },
            }}
          >
            <PremiumCardSetupForm
              customerName={customerName}
              clientSecret={cardClientSecret}
              dark
              onConfirm={paymentMethodId =>
                confirmCardSetup
                  .mutateAsync({
                    bookingId: createdBooking.bookingId,
                    setupIntentId: cardSetupIntentId,
                    paymentMethodId,
                  })
                  .then(() => undefined)
              }
            />
          </Elements>
        ) : paymentMethod === "card" && createdBooking ? (
          <div className="booking-card-acceptance booking-card-acceptance-loading">
            Preparing secure card entry…
          </div>
        ) : null}
      </>
    ) : step === 8 ? (
      <>
        <div className="content-top">
          <div className="eyebrow">STEP 8 OF 9</div>
          <h2>Review and book</h2>
          <p className="subtitle">
            Please confirm all details before we complete your booking.
          </p>
        </div>
        <div className="final-review-layout">
          <div className="review-cards">
            <article className="review-card">
              <span>⌂</span>
              <div>
                <strong>Service &amp; home details</strong>
                <p>
                  {serviceName}
                  <br />
                  {homeDetail}
                </p>
              </div>
              <button type="button" onClick={() => setStep(1)}>
                Edit
              </button>
            </article>
            <article className="review-card">
              <span>✦</span>
              <div>
                <strong>Home condition</strong>
                <p>
                  {CONDITION_COPY[condition - 1]}
                  <br />
                  Condition {condition}/10.
                </p>
              </div>
              <button type="button" onClick={() => setStep(3)}>
                Edit
              </button>
            </article>
            <article className="review-card">
              <span>⊕</span>
              <div>
                <strong>Extras</strong>
                <p>
                  {selectedExtras.length
                    ? selectedExtras.map(([id, extra]) => (
                        <span key={id}>
                          {extra.label} <b>${extra.unitPrice}</b>
                          <br />
                        </span>
                      ))
                    : "No extras selected"}
                </p>
              </div>
              <button type="button" onClick={() => setStep(4)}>
                Edit
              </button>
            </article>
            <article className="review-card">
              <span>▦</span>
              <div>
                <strong>Date &amp; time</strong>
                <p>
                  {dateLabel(date)}
                  <br />
                  {time}
                  <br />
                  <small>
                    ⓘ We&apos;ll send your team within a 2-hour window.
                  </small>
                </p>
              </div>
              <button type="button" onClick={() => setStep(5)}>
                Edit
              </button>
            </article>
            <article className="review-card">
              <span>♙</span>
              <div>
                <strong>Your information</strong>
                <p>
                  {customerName || "Customer name"}
                  <br />
                  {customerPhone || "Phone number"}
                  <br />
                  {customerEmail || "Email"}
                  <br />
                  {address || "Service address"}
                </p>
              </div>
              <button type="button" onClick={() => setStep(6)}>
                Edit
              </button>
            </article>
            <article className="review-card">
              <span>▣</span>
              <div>
                <strong>Payment method</strong>
                <p>
                  {paymentMethod === "card"
                    ? "Card on file"
                    : paymentMethod === "cashapp"
                      ? "Cash App"
                      : "Invoice"}
                  <br />
                  {paymentMethod === "card"
                    ? "Securely saved after booking"
                    : "Collection selected"}
                </p>
              </div>
              <button type="button" onClick={() => setStep(7)}>
                Edit
              </button>
            </article>
          </div>
          <section
            className="customer-script-card"
            aria-label="Customer script"
          >
            <div className="customer-script-heading">
              <div>
                <span className="eyebrow">CUSTOMER SCRIPT</span>
                <h3>Ready to read or text</h3>
              </div>
              <button
                type="button"
                className="customer-script-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(customerScript);
                  setScriptCopied(true);
                  window.setTimeout(() => setScriptCopied(false), 1800);
                }}
              >
                <Clipboard size={14} /> {scriptCopied ? "Copied" : "Copy script"}
              </button>
            </div>
            <p>{customerScript}</p>
            <small>
              Uses the current booking details, arrival window, extras, and live
              pricing.
            </small>
          </section>
          <div className="confirmation-panel">
            <img src={deepKitchen} alt="Clean home interior" />
            <h3>You&apos;re almost all set!</h3>
            <p>
              Review your details and confirm your booking.
              <br />
              You&apos;ll receive a confirmation text shortly after booking.
            </p>
            <div className="confirmation-benefits">
              <p>
                <b>♢</b>
                <strong>
                  Secure payment
                  <small>Your information is encrypted and safe.</small>
                </strong>
              </p>
              <p>
                <b>◷</b>
                <strong>
                  Flexible arrival window
                  <small>
                    We&apos;ll send your team within 2 hours of your selected
                    time.
                  </small>
                </strong>
              </p>
              <p>
                <b>▦</b>
                <strong>
                  Easy changes
                  <small>
                    Need to reschedule? Just reply to your confirmation text.
                  </small>
                </strong>
              </p>
            </div>
          </div>
        </div>
      </>
    ) : (
      <>
        <div className="content-top">
          <div className="eyebrow">STEP 9 OF 9</div>
          <h2>Would you like to add anything else?</h2>
          <p className="subtitle">
            Offer helpful add-on services before you complete the booking.
          </p>
        </div>
        <div className="additional-services-intro">
          <span>✦</span>
          <div>
            <strong>Additional services</strong>
            <p>
              These services can be added to the booking now. Choose a quantity
              or leave everything at zero.
            </p>
          </div>
        </div>
        <div className="additional-services-grid">
          {ADDITIONAL_SERVICES.map((service, index) => {
            const quantity = additionalServices[service.id] ?? 0;
            const symbols = ["↔", "▦", "⊞", "⌂", "▰", "▤", "▥", "♣"];
            return (
              <article
                className={`additional-service-card${quantity ? " selected" : ""}`}
                key={service.id}
              >
                <span className="service-symbol">{symbols[index]}</span>
                <div>
                  <strong>{service.title}</strong>
                  <small>{service.copy}</small>
                  <em>
                    From {money(service.unitPriceCents)} /{" "}
                    {service.quantityLabel.slice(0, -1)}
                  </em>
                </div>
                <div className="quantity">
                  <button
                    type="button"
                    aria-label={`Decrease ${service.title}`}
                    disabled={!quantity}
                    onClick={() => setAdditionalService(service.id, -1)}
                  >
                    −
                  </button>
                  <b>{quantity}</b>
                  <button
                    type="button"
                    aria-label={`Increase ${service.title}`}
                    onClick={() => setAdditionalService(service.id, 1)}
                  >
                    ＋
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="additional-services-note">
          <span>ⓘ</span>
          <p>
            Selected services will appear in the booking summary and final
            total.
          </p>
        </div>
      </>
    );

  return (
    <main className={shellClass}>
      {onClose && (
        <button
          type="button"
          className="internal-booking-modal-close"
          onClick={onClose}
          aria-label="Close new booking form"
        >
          ×
        </button>
      )}
      <div className="review-badge">
        REVIEW ONLY · SAMPLE DATA · PAGE {step} OF 9
      </div>
      <section className="internal-booking-frame app-shell">
        <aside className="internal-booking-progress sidebar panel">
          <button
            type="button"
            className="back-link"
            onClick={() => (onClose ? onClose() : navigate("/admin/bookings"))}
          >
            <span>←</span> Back to bookings
          </button>
          <div className="brand-block">
            <div className="eyebrow">INTERNAL BOOKING</div>
            <h1>New Booking</h1>
            <p>
              Create a booking while on the phone or in chat with the customer.
            </p>
          </div>
          <nav className="steps" aria-label="Booking steps">
            {STEPS.map((title, index) => {
              const number = index + 1;
              const reviewTitle =
                number === 6
                  ? "Customer"
                  : number === 8
                    ? "Final review"
                    : title;
              return (
                <button
                  type="button"
                  key={title}
                  className={`step${number === step ? " active" : ""}`}
                  onClick={() => number <= step && setStep(number as Step)}
                >
                  <b>{number}</b>
                  <span>{reviewTitle}</span>
                </button>
              );
            })}
          </nav>
          <div className="autosave">
            <span className="spark">✦</span>
            <div>
              <strong>Auto-save enabled</strong>
              <small>Draft saved 12s ago</small>
            </div>
          </div>
        </aside>
        <section className="internal-booking-stage content panel">
          <div className="internal-step-content">{stepContent}</div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <footer className="internal-step-actions actions">
            <button
              type="button"
              className="internal-back-button back-button"
              onClick={back}
              disabled={step === 1 || createBooking.isPending}
            >
              <ArrowLeft /> Back
            </button>
            <span>
              <Heart /> A cleaner, happier home is just a few steps away.
            </span>
            <button
              type="button"
              className="internal-next-button continue-button"
              onClick={next}
              disabled={
                createBooking.isPending ||
                startCardSetup.isPending ||
                confirmCardSetup.isPending ||
                updateAdditionalServices.isPending ||
                (step === 7 && paymentMethod === "card" && !!createdBooking)
              }
            >
              {createBooking.isPending || startCardSetup.isPending ? (
                "Preparing card…"
              ) : confirmCardSetup.isPending ? (
                "Saving card…"
              ) : updateAdditionalServices.isPending ? (
                "Updating booking…"
              ) : step === 9 ? (
                <>
                  <Check /> Create booking
                </>
              ) : (
                <>
                  Continue <ArrowRight />
                </>
              )}
            </button>
          </footer>
        </section>
        <aside className="internal-booking-right-rail right-rail">
          <section className="internal-booking-summary-card summary">
            <div className="internal-summary-head summary-head">
              <div>
                <h2>Booking summary</h2>
                <span>Estimated first cleaning</span>
              </div>
              <strong>
                {money(
                  pricing.firstCleaningTotalCents + additionalServicesTotalCents
                )}
              </strong>
            </div>
            <div className="internal-summary-list summary-list">
              <div>
                <span>Cleaning</span>
                <b>{serviceName}</b>
                <button type="button" onClick={() => setStep(1)}>
                  Edit
                </button>
              </div>
              <div>
                <span>Home</span>
                <b>{homeDetail}</b>
                <button type="button" onClick={() => setStep(2)}>
                  Edit
                </button>
              </div>
              <div>
                <span>Condition</span>
                <b>{condition}/10</b>
                <button type="button" onClick={() => setStep(3)}>
                  Edit
                </button>
              </div>
              <div>
                <span>Frequency</span>
                <b>{label(frequency)}</b>
                <button type="button" onClick={() => setStep(2)}>
                  Edit
                </button>
              </div>
              {additionalServicesTotalCents > 0 && (
                <div>
                  <span>Additional services</span>
                  <b>{money(additionalServicesTotalCents)}</b>
                  <button type="button" onClick={() => setStep(9)}>
                    Edit
                  </button>
                </div>
              )}
            </div>
            {pricing.futureVisitTotalCents !== null && (
              <button
                className="internal-breakdown-button breakdown"
                type="button"
              >
                <span>{label(frequency)} after visit one</span>
                <b>
                  {money(
                    pricing.futureVisitTotalCents + additionalServicesTotalCents
                  )}{" "}
                  / visit
                </b>
              </button>
            )}
          </section>
          <section className="internal-booking-notes-card notes">
            <h3>✦ AI Booking Notes</h3>
            <textarea
              id="internal-company-notes"
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Type notes from the customer call... (e.g. pets, specific areas, access requests)"
            />
            <button
              type="button"
              className="internal-add-note-button add-note"
              onClick={() =>
                document.getElementById("internal-company-notes")?.focus()
              }
            >
              + Add note
            </button>
            <p>
              These notes stay with the booking and are visible to the team.
            </p>
          </section>
          <section className="internal-booking-tips-card tips">
            <h3>Booking tips</h3>
            <ul>
              <li>Confirm the arrival window with the customer.</li>
              <li>Ask about pets, parking, and access before booking.</li>
              <li>
                Card payments are saved securely and charged after service.
              </li>
            </ul>
          </section>
        </aside>
      </section>
    </main>
  );
}

export default InternalBooking;
