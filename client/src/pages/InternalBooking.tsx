import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  CardElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
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
import { CARD_ELEMENT_OPTIONS } from "@/components/useStripeCardSetup";
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
  PUBLIC_BOOKING_PRICING_VERSION,
  type PublicBookingHomeType,
  type PublicBookingPricingMode,
} from "@shared/publicBookingPricing";
import type {
  BookingWidgetServiceId,
  BookingWidgetRecurringFrequency,
} from "@shared/bookingWidgetConfig";
import "./internal-booking.css";
import "./booking-flow-review.css";

const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string
);
const SERVICES: BookingWidgetServiceId[] = ["standard", "deep", "moveout"];
const FREQUENCIES: BookingWidgetRecurringFrequency[] = [
  "one-time",
  "weekly",
  "biweekly",
  "monthly",
];
const HOME_TYPES: PublicBookingHomeType[] = [
  "House",
  "Apartment",
  "Townhome",
  "Condo",
];
const TIMES = ["08:30", "11:00", "13:30", "16:30"];
const EXTRA_OPTIONS = Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS);
const CONDITION_COPY = [
  "Light touch-up",
  "Well cared for",
  "Typical home",
  "A little lived-in",
  "Bring the good gloves",
  "Needs extra attention",
  "Heavy-duty clean",
  "A serious reset",
  "Major cleanup",
  "Full transformation",
];
const STEPS = [
  "Cleaning type",
  "Home details",
  "Home condition",
  "Extras",
  "Date & time",
  "Your information",
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
const ADDITIONAL_SERVICES: AdditionalService[] = [
  {
    id: "moving-help",
    title: "Moving Help",
    copy: "Let our trusted team handle the heavy lifting.",
    unitPriceCents: 9900,
    quantityLabel: "hours",
    image: livingRoom,
  },
  {
    id: "carpet-cleaning",
    title: "Carpet Cleaning",
    copy: "Refresh your carpets with a professional deep clean.",
    unitPriceCents: 7500,
    quantityLabel: "rooms",
    image: upsellCarpetCleaning,
  },
  {
    id: "exterior-window-cleaning",
    title: "Exterior Window Cleaning",
    copy: "Streak-free exterior windows for a brighter home.",
    unitPriceCents: 7500,
    quantityLabel: "hours",
    image: upsellExteriorWindowCleaning,
  },
  {
    id: "junk-removal",
    title: "Junk Removal",
    copy: "We haul it away so you don’t have to.",
    unitPriceCents: 9900,
    quantityLabel: "loads",
    image: livingRoom,
  },
  {
    id: "furniture-cleaning",
    title: "Furniture Cleaning",
    copy: "Deep clean your sofas, mattresses, and more.",
    unitPriceCents: 9900,
    quantityLabel: "items",
    image: kitchen,
  },
  {
    id: "appliance-cleaning",
    title: "Appliance Cleaning",
    copy: "Inside your fridge, oven, and more.",
    unitPriceCents: 4900,
    quantityLabel: "appliances",
    image: stillLife,
  },
  {
    id: "window-cleaning",
    title: "Window Cleaning",
    copy: "Streak-free windows for a brighter home.",
    unitPriceCents: 9900,
    quantityLabel: "windows",
    image: livingRoom,
  },
  {
    id: "pet-area-cleaning",
    title: "Pet Area Cleaning",
    copy: "Tackle pet hair, odors, and messes.",
    unitPriceCents: 7900,
    quantityLabel: "areas",
    image: kitchen,
  },
];

function tomorrowIso() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
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
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function InternalCardForm({
  customerName,
  clientSecret,
  onConfirmed,
}: {
  customerName: string;
  clientSecret: string;
  onConfirmed: (paymentMethodId: string) => Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [name, setName] = useState(customerName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setPending(true);
    setError(null);
    const card = elements.getElement(CardElement);
    if (!card) {
      setError("Card field is not ready yet.");
      setPending(false);
      return;
    }
    const result = await stripe.confirmCardSetup(clientSecret, {
      payment_method: { card, billing_details: { name } },
    });
    if (result.error || !result.setupIntent?.payment_method) {
      setError(
        result.error?.message ?? "Card verification failed. Please try again."
      );
      setPending(false);
      return;
    }
    try {
      await onConfirmed(result.setupIntent.payment_method as string);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Card verification failed. Please try again."
      );
      setPending(false);
    }
  };
  return (
    <form onSubmit={submit} className="booking-card-acceptance">
      <header className="booking-card-acceptance-head">
        <span className="booking-card-acceptance-mark">
          <LockKeyhole />
        </span>
        <span>
          <small>SECURE CARD DETAILS</small>
          <strong>Add your card</strong>
          <em>Your card is stored securely and charged only after service.</em>
        </span>
      </header>
      <div className="booking-card-acceptance-fields">
        <label>
          <span>Name on card</span>
          <input
            required
            value={name}
            onChange={event => setName(event.target.value)}
            autoComplete="cc-name"
            placeholder="Name as it appears on your card"
          />
        </label>
        <label>
          <span>Card details</span>
          <span className="booking-card-element-shell">
            <CardElement options={CARD_ELEMENT_OPTIONS} className="w-full" />
          </span>
        </label>
      </div>
      {error && (
        <p role="alert" className="booking-card-acceptance-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || !stripe}
        className="booking-card-acceptance-submit"
      >
        <LockKeyhole className="h-4 w-4" />
        {pending ? "Saving secure card…" : "Save card to reserve →"}
      </button>
    </form>
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
    <button
      type="button"
      className={`internal-choice-card${image ? " service-choice-card" : ""}${selected ? " selected" : ""}`}
      onClick={onClick}
    >
      {image && (
        <span className="internal-choice-image">
          <img src={image} alt="" />
          <span className="internal-choice-radio" />
        </span>
      )}
      <span className="internal-choice-icon">
        <Icon />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
        {price && <em className="internal-choice-price">From {price}</em>}
        {meta && <em className="internal-choice-meta">{meta}</em>}
        {say && (
          <span className="internal-choice-say">
            <strong>◌ &nbsp; What to say to the customer</strong>
            <small>{say}</small>
          </span>
        )}
      </span>
      <span className="internal-choice-check">
        {selected ? <Check /> : <ChevronRight />}
      </span>
    </button>
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
    <div className="internal-stepper-card">
      <span>{title}</span>
      <output>{display}</output>
      <div>
        <button
          type="button"
          aria-label={`Decrease ${title}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          <Minus />
        </button>
        <button
          type="button"
          aria-label={`Increase ${title}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          <Plus />
        </button>
      </div>
    </div>
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
  const [step, setStep] = useState<Step>(1);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [address, setAddress] = useState("");
  const [serviceId, setServiceId] =
    useState<BookingWidgetServiceId>("standard");
  const [pricingMode, setPricingMode] =
    useState<PublicBookingPricingMode>("home");
  const [bedrooms, setBedrooms] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [homeType, setHomeType] = useState<PublicBookingHomeType>("House");
  const [maidCount, setMaidCount] = useState(2);
  const [hourCount, setHourCount] = useState(2);
  const [condition, setCondition] = useState(5);
  const [frequency, setFrequency] =
    useState<BookingWidgetRecurringFrequency>("biweekly");
  const [date, setDate] = useState(tomorrowIso);
  const [time, setTime] = useState("11:00");
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("card");
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [additionalServices, setAdditionalServices] = useState<
    Record<string, number>
  >({});
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<{
    bookingId: number;
    publicBookingNumber: string;
  } | null>(null);
  const [cardClientSecret, setCardClientSecret] = useState<string | null>(null);
  const [cardSetupIntentId, setCardSetupIntentId] = useState<string | null>(
    null
  );
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step, success, createdBooking]);

  const pricing = useMemo(
    () =>
      calculatePublicBookingPrice({
        pricingMode,
        serviceId,
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
      }),
    [
      pricingMode,
      serviceId,
      bedrooms,
      bathrooms,
      homeType,
      condition,
      maidCount,
      hourCount,
      extras,
      frequency,
    ]
  );
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
  const setExtra = (id: string, delta: number) =>
    setExtras(current => ({
      ...current,
      [id]: Math.max(0, (current[id] ?? 0) + delta),
    }));
  const startCardSetup =
    trpc.bookingPaymentAdmin.startInternalCardSetup.useMutation({
      onSuccess: result => {
        setCardClientSecret(result.clientSecret);
        setCardSetupIntentId(result.setupIntentId);
      },
      onError: mutationError => setError(mutationError.message),
    });
  const confirmCardSetup =
    trpc.bookingPaymentAdmin.confirmInternalCardSetup.useMutation({
      onSuccess: () => {
        if (createdBooking)
          setSuccess(
            `${createdBooking.publicBookingNumber} created with card on file. It is now in Bookings for assignment and follow-up.`
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
    const pricingInput = {
      pricingMode,
      serviceId,
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
    };
    createBooking.mutate({
      idempotencyKey: crypto.randomUUID(),
      paymentMethod,
      companyNotes: notes.trim() || null,
      additionalServices: Object.entries(additionalServices)
        .filter(([, quantity]) => quantity > 0)
        .map(([id, quantity]) => ({ id, quantity })),
      booking: {
        surface: "full_page",
        customer: {
          fullName: customerName.trim(),
          phone: customerPhone.trim(),
          email: customerEmail.trim(),
        },
        service: {
          serviceId,
          bedrooms,
          bathrooms,
          extras: pricingInput.extras,
          specialRequestNotes: [],
        },
        address: address.trim(),
        requestedSchedule: { localDate: date, localTime: time },
        recurrence: frequency,
        acceptedPricing: {
          version: PUBLIC_BOOKING_PRICING_VERSION,
          totalCents: pricing.firstCleaningTotalCents,
        },
        pricing: pricingInput,
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

  if (createdBooking && cardClientSecret && cardSetupIntentId && !success)
    return (
      <main className={shellClass}>
        <section className="internal-booking-card-stage">
          <p className="eyebrow">PAYMENT METHOD</p>
          <h1>Add the card</h1>
          <p>
            The card is saved securely to this booking. Nothing is charged
            today.
          </p>
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret: cardClientSecret,
              appearance: { theme: "stripe" },
            }}
          >
            <InternalCardForm
              customerName={customerName}
              clientSecret={cardClientSecret}
              onConfirmed={paymentMethodId =>
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
        </section>
      </main>
    );
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
  const stepContent =
    step === 1 ? (
      <>
        <h1>What kind of cleaning do they need?</h1>
        <p className="internal-lede">
          Choose the service that best matches the customer&apos;s request.
        </p>
        <div className="internal-choice-grid">
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
                  ? "~ 2.5 hours"
                  : value === "deep"
                    ? "~ 3.5 hours"
                    : "~ 4 hours"
              }
              say={
                value === "standard"
                  ? "This is our most popular option. It keeps the home clean and fresh with all the essential cleaning tasks."
                  : value === "deep"
                    ? "This is a more detailed clean. We focus on the areas that build up over time, so the home feels like a fresh start."
                    : "This is a top-to-bottom clean that gets the home ready for a new tenant or homeowner."
              }
              title={getPublicBookingServiceName(value)}
              description={
                value === "standard"
                  ? "A reliable reset for a well-kept home."
                  : value === "deep"
                    ? "Extra detail for a home needing more attention."
                    : "A thorough clean before a move or handoff."
              }
            />
          ))}
        </div>
      </>
    ) : step === 2 ? (
      <>
        <h1>Tell us about the home</h1>
        <p className="internal-lede">
          Use the same bedroom, bathroom, hourly, and recurring options as the
          public form.
        </p>
        <div className="internal-mode-toggle">
          <button
            type="button"
            className={pricingMode === "home" ? "selected" : ""}
            onClick={() => setPricingMode("home")}
          >
            Bedrooms &amp; bathrooms
          </button>
          <button
            type="button"
            className={pricingMode === "hourly" ? "selected" : ""}
            onClick={() => setPricingMode("hourly")}
          >
            Book hourly instead
          </button>
        </div>
        {pricingMode === "home" ? (
          <>
            <div className="internal-stepper-grid">
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
            <div className="internal-card-label">Home type</div>
            <div className="internal-pill-grid">
              {HOME_TYPES.map(value => (
                <button
                  type="button"
                  key={value}
                  className={homeType === value ? "selected" : ""}
                  onClick={() => setHomeType(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="internal-stepper-grid">
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
        <div className="internal-frequency-block">
          <div className="internal-card-label">Recurring frequency</div>
          <div className="internal-frequency-grid">
            {FREQUENCIES.map(value => (
              <button
                type="button"
                key={value}
                className={frequency === value ? "selected" : ""}
                onClick={() => setFrequency(value)}
              >
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
              </button>
            ))}
          </div>
        </div>
      </>
    ) : step === 3 ? (
      <>
        <h1>How is the home currently maintained?</h1>
        <p className="internal-lede">
          This helps set a fair estimate and enough time for the team.
        </p>
        <div className="internal-condition-grid">
          {CONDITION_COPY.map((copy, index) => (
            <button
              type="button"
              key={copy}
              className={condition === index + 1 ? "selected" : ""}
              onClick={() => setCondition(index + 1)}
            >
              <span>{index + 1}</span>
              <strong>{copy}</strong>
            </button>
          ))}
        </div>
        <input
          className="internal-condition-range"
          type="range"
          min="1"
          max="10"
          value={condition}
          onChange={event => setCondition(Number(event.target.value))}
        />
        <div className="internal-condition-selected">
          <strong>{condition}</strong>
          <span>{CONDITION_COPY[condition - 1]}</span>
        </div>
      </>
    ) : step === 4 ? (
      <>
        <h1>Need anything else?</h1>
        <p className="internal-lede">
          Add services and quantities while you are on the call.
        </p>
        <div className="internal-extras-grid">
          {EXTRA_OPTIONS.map(([id, extra]) => (
            <article className="internal-extra-card" key={id}>
              <div>
                <strong>{extra.label}</strong>
                <small>
                  ${extra.unitPrice}
                  {extra.quantityUnit ? ` / ${extra.quantityUnit}` : ""}
                </small>
              </div>
              <div className="internal-quantity">
                <button
                  type="button"
                  onClick={() => setExtra(id, -1)}
                  disabled={!extras[id]}
                >
                  <Minus />
                </button>
                <output>{extras[id] ?? 0}</output>
                <button type="button" onClick={() => setExtra(id, 1)}>
                  <Plus />
                </button>
              </div>
            </article>
          ))}
        </div>
      </>
    ) : step === 5 ? (
      <>
        <h1>When should the cleaning happen?</h1>
        <p className="internal-lede">
          Choose the date and arrival window that works best for the customer.
        </p>
        <div className="schedule-layout">
          <section className="calendar-card">
            <div className="schedule-card-head">
              <strong>Select a date</strong>
              <span>
                {new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
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
                    new Date(
                      new Date(`${date}T12:00:00`).getFullYear(),
                      new Date(`${date}T12:00:00`).getMonth(),
                      1
                    ).getDay() +
                    new Date(
                      new Date(`${date}T12:00:00`).getFullYear(),
                      new Date(`${date}T12:00:00`).getMonth() + 1,
                      0
                    ).getDate(),
                },
                (_, index) => index
              ).map(index => {
                const monthDate = new Date(`${date}T12:00:00`);
                const firstDay = new Date(
                  monthDate.getFullYear(),
                  monthDate.getMonth(),
                  1
                ).getDay();
                const day = index - firstDay + 1;
                if (day < 1)
                  return <span className="muted" key={`empty-${index}`} />;
                const value = `${monthDate.getFullYear()}-${String(
                  monthDate.getMonth() + 1
                ).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
        <h1>Who are we booking for?</h1>
        <p className="internal-lede">
          Capture the customer details and anything the team should know.
        </p>
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
        <h1>How would the customer like to pay?</h1>
        <p className="internal-lede">
          Choose a payment method and collect the details.
        </p>
        <div className="payment-methods">
          {(["card", "cashapp", "invoice"] as PaymentMethod[]).map(value => (
            <button
              key={value}
              className={`payment-method${paymentMethod === value ? " selected" : ""}`}
              type="button"
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
        {paymentMethod === "card" && (
          <>
            <section className="card-details">
              <div className="card-details-head">
                <strong>Card details</strong>
                <span>♧ &nbsp; Secure payment powered by Stripe</span>
              </div>
              <label>
                Card number
                <div className="fake-input">
                  ▣ &nbsp;{" "}
                  <span>
                    Card entry opens securely after booking details are
                    confirmed
                  </span>
                </div>
              </label>
              <div className="card-row">
                <label>
                  <span>Expiration date</span>
                  <div className="fake-input">
                    <span>MM / YY</span>
                  </div>
                </label>
                <label>
                  <span>CVC</span>
                  <div className="fake-input">
                    <span>123</span>
                    <b>▣</b>
                  </div>
                </label>
              </div>
              <label>
                Name on card
                <input
                  type="text"
                  value={customerName}
                  onChange={event => setCustomerName(event.target.value)}
                  placeholder="Name on card"
                />
              </label>
              <label className="save-card">
                <input type="checkbox" checked readOnly />
                <strong>Save card for future bookings</strong>
                <small>Speeds up booking and recurring services.</small>
              </label>
            </section>
            <div className="card-on-file">
              <span>▣</span>
              <div>
                <strong>Card on file</strong>
                <p>
                  We keep your card on file for easier scheduling, recurring
                  cleanings, and any additional services.
                  <br />
                  You&apos;ll only be charged for confirmed services.
                </p>
              </div>
              <b>ⓘ</b>
            </div>
          </>
        )}
      </>
    ) : step === 8 ? (
      <>
        <h1>Review and book</h1>
        <p className="internal-lede">
          Please confirm all details before we complete your booking.
        </p>
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
        <h1>Would you like to add anything else?</h1>
        <p className="internal-lede">
          Offer helpful add-on services before you complete the booking.
        </p>
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
      <section className="internal-booking-frame">
        <aside className="internal-booking-progress">
          <p className="eyebrow">INTERNAL BOOKING</p>
          <h2>New booking</h2>
          <p>Same options as the public form, streamlined for a phone call.</p>
          <ol>
            {STEPS.map((title, index) => {
              const number = index + 1;
              return (
                <li
                  key={title}
                  className={
                    number === step ? "current" : number < step ? "done" : ""
                  }
                >
                  <span>{number < step ? <Check /> : number}</span>
                  <div>
                    <strong>{title}</strong>
                    {number < step && (
                      <small>
                        {number === 1
                          ? serviceName
                          : number === 2
                            ? homeDetail
                            : number === 5
                              ? dateLabel(date)
                              : number === 6
                                ? customerName || "Contact details"
                                : number === 7
                                  ? label(paymentMethod)
                                  : number === 9
                                    ? selectedAdditionalServices.length
                                      ? `${selectedAdditionalServices.length} selected`
                                      : "None selected"
                                    : "Complete"}
                      </small>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="internal-progress-secure">
            <ShieldCheck />
            <span>
              <strong>Secure booking</strong>
              <small>Information stays protected.</small>
            </span>
          </div>
        </aside>
        <section className="internal-booking-stage">
          <div className="internal-step-overline">STEP {step} OF 9</div>
          <div className="internal-step-content">{stepContent}</div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <footer className="internal-step-actions">
            <button
              type="button"
              className="internal-back-button"
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
              className="internal-next-button"
              onClick={next}
              disabled={createBooking.isPending || startCardSetup.isPending}
            >
              {createBooking.isPending || startCardSetup.isPending ? (
                "Creating…"
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
        <aside className="internal-booking-right-rail">
          <section className="internal-booking-summary-card">
            <div className="internal-summary-head">
              <div>
                <h2>Booking summary</h2>
                <span>Live estimate</span>
              </div>
              <strong>
                {money(
                  pricing.firstCleaningTotalCents + additionalServicesTotalCents
                )}
              </strong>
            </div>
            <div className="internal-summary-list">
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
              <button className="internal-breakdown-button" type="button">
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
          <section className="internal-booking-notes-card">
            <h3>
              Company notes <span>· internal</span>
            </h3>
            <textarea
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Gate code, parking, pets, or anything the team should know"
            />
            <p>
              These notes stay with the booking and are visible to the team.
            </p>
          </section>
          <section className="internal-booking-tips-card">
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
