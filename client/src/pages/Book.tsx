import { trpc } from "@/lib/trpc";
import {
  BookingPaymentCheckout,
  PublicBookingCardSetupBeforeReservation,
} from "@/components/BookingPaymentCheckout";
import { BookingWalletCardOnFileCheckout } from "@/components/BookingApplePayCheckout";
import { BookingCashAppCheckout } from "@/components/BookingCashAppCheckout";
import { useCanonicalBookingFlow } from "@/components/useCanonicalBookingFlow";
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  CreditCard,
  Heart,
  House,
  Leaf,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Plus,
  ShieldCheck,
  Sparkles,
  Star,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BookingFunnelPublicResult,
  UpdateBookingFunnelInput,
} from "@shared/bookingFunnel";
import type {
  BookingWidgetRecurringFrequency,
  BookingWidgetServiceId,
} from "@shared/bookingWidgetConfig";
import {
  PUBLIC_BOOKING_PRICING_VERSION,
  calculatePublicBookingPrice,
  createPublicBookingPriceSnapshot,
  getPublicBookingServiceName,
  type PublicBookingHomeType,
  type PublicBookingPricingMode,
} from "@shared/publicBookingPricing";
import {
  CANONICAL_CONDITION_COPY,
  CANONICAL_TIME_SLOT_LABELS,
  createCanonicalPricingInput,
  selectedCanonicalExtras,
} from "@shared/canonicalBooking";
import {
  easternCalendarWeekday,
  easternDateIso,
  easternDateIsoFromDate,
  easternDateLabel,
  easternMonthDate,
  easternMonthLabel,
  parseEasternDate,
} from "@shared/easternTime";
import livingRoom from "@/assets/book-now-review/living-room.jpg";
import promiseImage from "@/assets/book-now-review/sunlit-marble-tabletop-vignette.png";
import kitchen from "@/assets/book-now-review/kitchen.jpg";
import stillLife from "@/assets/book-now-review/still-life.jpg";
import testimonialCleaner from "@/assets/book-now-review/testimonial-cleaner.webp";
import amberTestimonial from "@/assets/book-now-review/amber-testimonial.png";
import reviewCustomerStory from "@/assets/book-now-review/review-customer-story.jpg";
import standardBedroom from "@/assets/book-now-review/standard-bedroom.png";
import deepKitchen from "@/assets/book-now-review/deep-kitchen.png";
import moveoutBoxes from "@/assets/book-now-review/moveout-boxes.png";
import homeDetailsRail from "@/assets/book-now-review/home-details-rail.png";
import extrasBathroomRail from "@/assets/book-now-review/extras-bathroom-rail.png";
import extrasCabinets from "@/assets/book-now-review/extras-cabinets.png";
import extrasFridge from "@/assets/book-now-review/extras-fridge.png";
import extrasBaseboards from "@/assets/book-now-review/extras-baseboards.png";
import extrasLaundry from "@/assets/book-now-review/extras-laundry.png";
import extrasOven from "@/assets/book-now-review/extras-oven.png";
import extrasWindows from "@/assets/book-now-review/extras-windows.png";
import extrasCeilingFans from "@/assets/book-now-review/extras-ceiling-fans.png";
import extrasDoors from "@/assets/book-now-review/extras-doors.png";
import spotlessHouse from "@/assets/book-now-review/condition-01-spotless-house-ui.png";
import refreshedHouse from "@/assets/book-now-review/condition-02-refresh-house-ui.png";
import normalSofa from "@/assets/book-now-review/condition-03-sofa-ui.png";
import livedInHouse from "@/assets/book-now-review/condition-04-lived-in-house-ui.png";
import prettyLivedInSofa from "@/assets/book-now-review/condition-05-pretty-lived-in-sofa-ui.png";
import laundryBasket from "@/assets/book-now-review/condition-06-laundry-basket-ui.png";
import goodGlovesHouse from "@/assets/book-now-review/condition-07-good-gloves-ui.png";
import aTeamCleaningKit from "@/assets/book-now-review/condition-08-a-team-cleaning-kit-ui.png";
import reinforcementsBoxes from "@/assets/book-now-review/condition-09-reinforcements-boxes-ui.png";
import trashBags from "@/assets/book-now-review/condition-10-trash-bags-ui.png";
import "./booking-flow-review.css";

type Service = BookingWidgetServiceId;
type Frequency = BookingWidgetRecurringFrequency;
type Extra = { id: string; title: string; description: string; image: string };
type FunnelPatch = UpdateBookingFunnelInput["patch"];

const BOOKING_PHASES = [
  {
    title: "Your home",
    subtitle: "Tell us a few details about your home.",
    icon: House,
    steps: [2, 3],
  },
  {
    title: "Your cleaning",
    subtitle: "Choose your service and any extras.",
    icon: Sparkles,
    steps: [1, 4],
  },
  {
    title: "Schedule",
    subtitle: "Pick a date and time that works for you.",
    icon: CalendarDays,
    steps: [5],
  },
  {
    title: "Confirm",
    subtitle: "Add your info, payment method, and book.",
    icon: Check,
    steps: [6, 7, 8],
  },
] as const;

const SERVICES: Array<{
  id: Service;
  title: string;
  body: string;
  bullets: string[];
  image: string;
}> = [
  {
    id: "standard",
    title: "Standard Cleaning",
    body: "Keep your home fresh, clean and comfortable.",
    bullets: ["Everyday cleaning", "Most popular", "Great for recurring"],
    image: standardBedroom,
  },
  {
    id: "deep",
    title: "Deep Cleaning",
    body: "A more detailed, top-to-bottom clean.",
    bullets: [
      "Inside appliances",
      "Baseboards & more",
      "Best for first-time cleans",
    ],
    image: deepKitchen,
  },
  {
    id: "moveout",
    title: "Move-out Cleaning",
    body: "A complete clean for your next chapter.",
    bullets: [
      "Detailed top-to-bottom",
      "Inside cabinets",
      "Perfect for moving",
    ],
    image: moveoutBoxes,
  },
];

const EXTRAS: readonly Extra[] = [
  {
    id: "inside-cabinets",
    title: "Inside Cabinets",
    description: "Wipe down inside cabinets.",
    image: extrasCabinets,
  },
  {
    id: "inside-fridge",
    title: "Inside Fridge",
    description: "We’ll clean the inside and outside.",
    image: extrasFridge,
  },
  {
    id: "inside-oven",
    title: "Inside Oven",
    description: "Remove grease and residue.",
    image: extrasOven,
  },
  {
    id: "interior-windows",
    title: "Interior Windows",
    description: "Clean interior windows and sills.",
    image: extrasWindows,
  },
  {
    id: "basement",
    title: "Basement",
    description: "Add a detailed basement cleaning.",
    image: extrasBaseboards,
  },
  {
    id: "organizing-hour",
    title: "One Hour of Organizing",
    description: "Focused organizing support where you need it.",
    image: extrasDoors,
  },
  {
    id: "laundry-load",
    title: "Laundry",
    description: "Wash, dry and fold one load.",
    image: extrasLaundry,
  },
  {
    id: "wipe-walls-room",
    title: "Wipe Walls",
    description: "Wipe walls in one room.",
    image: extrasCeilingFans,
  },
  {
    id: "sweep-garage",
    title: "Sweep Garage",
    description: "Sweep and tidy your garage.",
    image: extrasDoors,
  },
];

const EXTRA_RATES: Readonly<Record<string, number>> = {
  "inside-cabinets": 50,
  "inside-fridge": 45,
  "inside-oven": 45,
  "interior-windows": 10,
  basement: 60,
  "organizing-hour": 70,
  "laundry-load": 25,
  "wipe-walls-room": 20,
  "sweep-garage": 30,
};

const FREQUENCY_OPTIONS: ReadonlyArray<{
  id: Frequency;
  label: string;
  savings?: string;
  discountPercent: number;
}> = [
  { id: "one-time", label: "One-time", discountPercent: 0 },
  { id: "weekly", label: "Weekly", savings: "Save 20%", discountPercent: 20 },
  {
    id: "biweekly",
    label: "Bi-weekly",
    savings: "Save 15%",
    discountPercent: 15,
  },
  { id: "monthly", label: "Monthly", savings: "Save 10%", discountPercent: 10 },
];

const CONDITION_COPY = CANONICAL_CONDITION_COPY;
const CONDITION_IMAGES = [
  spotlessHouse,
  refreshedHouse,
  normalSofa,
  livedInHouse,
  prettyLivedInSofa,
  laundryBasket,
  goodGlovesHouse,
  aTeamCleaningKit,
  reinforcementsBoxes,
  trashBags,
] as const;
const LITERAL_CONDITION_OPTIONS = [
  {
    id: "normal",
    score: 5,
    title: "Light / normal",
    description: "Routine dusting, wiping and floors",
  },
  {
    id: "moderate",
    score: 6,
    title: "Moderately messy",
    description: "Extra clutter or buildup",
  },
  {
    id: "heavy",
    score: 8,
    title: "Heavy cleaning needed",
    description: "Significant dirt or buildup",
  },
  {
    id: "restoration",
    score: 10,
    title: "Full reset / restoration",
    description:
      "Severe buildup or a long-unattended home — may need a full-day team reset",
  },
] as const;
const LITERAL_REVIEW_STORIES = [
  {
    quote:
      "“The booking process was simple, and I knew exactly what to expect before the team arrived.”",
    name: "Customer story 01",
    detail: "Illustrative customer feedback",
  },
  {
    quote:
      "“Everything felt organized, from choosing my cleaning to confirming the appointment.”",
    name: "Customer story 02",
    detail: "Illustrative customer feedback",
  },
  {
    quote:
      "“I appreciated being able to review the service details and payment terms before booking.”",
    name: "Customer story 03",
    detail: "Illustrative customer feedback",
  },
] as const;
const TIME_SLOTS = CANONICAL_TIME_SLOT_LABELS;
const REVIEW_OPENING_COUNTS = [2, 4, 3] as const;

function money(cents: number) {
  return `$${Math.round(cents / 100)}`;
}

function createBookingAttemptId(): string {
  return crypto.randomUUID();
}
function timeLabelTo24Hour(time: string): string {
  const match = /^(\d{1,2}):(\d{2})\s+(AM|PM)$/i.exec(time);
  if (!match) throw new Error("Select a valid arrival time.");
  const hour =
    (Number(match[1]) % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}
function isoDate(date: Date): string {
  return easternDateIsoFromDate(date);
}
function formatDate(date: Date): string {
  return easternDateLabel(isoDate(date));
}
function firstBookableDate(): Date {
  return parseEasternDate(easternDateIso(new Date(), 1));
}

export default function Book() {
  const {
    step,
    setStep,
    complete,
    setComplete,
    service,
    setService,
    bedrooms,
    setBedrooms,
    bathrooms,
    setBathrooms,
    homeType,
    setHomeType,
    frequency,
    setFrequency,
    pricingMode,
    setPricingMode,
    maidCount,
    setMaidCount,
    hourCount,
    setHourCount,
    condition,
    setCondition,
    extras,
    setExtras,
    pricingInput,
    pricing: priceBreakdown,
    snapshot,
    customerName,
    setCustomerName,
    firstName,
    lastName,
    setFirstName,
    setLastName,
    customerPhone: phone,
    setCustomerPhone: setPhone,
    customerEmail: email,
    setCustomerEmail: setEmail,
    address,
    setAddress,
    notes,
    setNotes,
    requestedLocalDate,
    setRequestedLocalDate,
    requestedLocalTime,
    setRequestedLocalTime,
  } = useCanonicalBookingFlow({ stepCount: 8 });
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const firstDate = firstBookableDate();
    return easternMonthDate(
      firstDate.getUTCFullYear(),
      firstDate.getUTCMonth(),
      1
    );
  });
  const selectedDate = useMemo(
    () => parseEasternDate(requestedLocalDate),
    [requestedLocalDate]
  );
  const setSelectedDate = (date: Date) => setRequestedLocalDate(isoDate(date));
  const selectedTime =
    TIME_SLOTS.find(slot => timeLabelTo24Hour(slot) === requestedLocalTime) ??
    TIME_SLOTS[0];
  const setSelectedTime = (slot: (typeof TIME_SLOTS)[number]) =>
    setRequestedLocalTime(timeLabelTo24Hour(slot));
  const [formError, setFormError] = useState("");
  const [cardOnFile, setCardOnFile] = useState(false);
  const [cardLabel, setCardLabel] = useState("");
  const [applePayAvailable, setApplePayAvailable] = useState(false);
  const [googlePayAvailable, setGooglePayAvailable] = useState(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const [cashAppBusy, setCashAppBusy] = useState(false);
  const [cashAppExitRequest, setCashAppExitRequest] = useState<
    "card" | "apple_pay" | "google_pay" | null
  >(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<
    "card" | "apple_pay" | "cashapp" | "google_pay" | null
  >(null);
  const [funnelRecord, setFunnelRecord] =
    useState<BookingFunnelPublicResult | null>(null);
  const funnelRecordRef = useRef<BookingFunnelPublicResult | null>(null);
  const bookingAttemptIdRef = useRef(createBookingAttemptId());
  const beginFunnelMutation = trpc.bookingFunnel.begin.useMutation();
  const updateFunnelMutation = trpc.bookingFunnel.update.useMutation();
  const reserveFunnelMutation = trpc.bookingFunnel.reserve.useMutation();
  const finalizeBookingMutation = trpc.bookingPayments.finalize.useMutation();
  const [quoteHoldSeconds, setQuoteHoldSeconds] = useState(600);
  const [reviewStoryIndex, setReviewStoryIndex] = useState(0);
  const [showAllExtras, setShowAllExtras] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step, complete]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setQuoteHoldSeconds(current => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const fullName = `${firstName} ${lastName}`.trim();
  const selectedService =
    SERVICES.find(item => item.id === service) ?? SERVICES[0];
  const selectedExtras = EXTRAS.filter(extra => (extras[extra.id] ?? 0) > 0);
  const selectedFrequency =
    FREQUENCY_OPTIONS.find(option => option.id === frequency) ??
    FREQUENCY_OPTIONS[0];
  const dateLabel = formatDate(selectedDate);
  const dateIso = isoDate(selectedDate);
  const isSaving =
    beginFunnelMutation.isPending ||
    updateFunnelMutation.isPending ||
    reserveFunnelMutation.isPending ||
    finalizeBookingMutation.isPending ||
    walletBusy ||
    cashAppBusy;
  const choosePaymentMethod = (
    method: "card" | "apple_pay" | "cashapp" | "google_pay" | null
  ) => {
    if (
      cashAppBusy &&
      selectedPaymentMethod === "cashapp" &&
      (method === "card" || method === "apple_pay" || method === "google_pay")
    ) {
      setCashAppExitRequest(method);
      return;
    }
    setCashAppExitRequest(null);
    setSelectedPaymentMethod(method);
    setFormError("");
  };

  const rememberFunnelRecord = (record: BookingFunnelPublicResult) => {
    funnelRecordRef.current = record;
    setFunnelRecord(record);
  };
  const buildPatch = (): FunnelPatch => ({
    customerName: fullName,
    customerPhone: phone,
    customerEmail: email,
    serviceId: service,
    serviceName: getPublicBookingServiceName(service),
    bedrooms,
    bathrooms,
    extras: selectedCanonicalExtras(extras),
    specialRequestNotes: notes.trim() ? [notes.trim()] : [],
    address,
    requestedLocalDate: dateIso,
    requestedLocalTime: timeLabelTo24Hour(selectedTime),
    requestedTimeZone: "America/New_York",
    recurrence: frequency,
    pricingVersion: PUBLIC_BOOKING_PRICING_VERSION,
    firstCleaningTotalCents: priceBreakdown.firstCleaningTotalCents,
    futureVisitTotalCents: priceBreakdown.futureVisitTotalCents,
    priceSnapshot: snapshot,
  });
  const reserveBooking =
    async (): Promise<BookingFunnelPublicResult | null> => {
      if (fullName.split(/\s+/).filter(Boolean).length < 2) {
        setFormError("Enter your first and last name.");
        return null;
      }
      if (phone.replace(/\D/g, "").length < 10) {
        setFormError("Enter a valid phone number.");
        return null;
      }
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setFormError("Enter a valid email address.");
        return null;
      }
      if (address.trim().length < 5) {
        setFormError("Enter the complete service address.");
        return null;
      }
      try {
        let current = funnelRecordRef.current;
        if (!current) {
          current = await beginFunnelMutation.mutateAsync({
            idempotencyKey: bookingAttemptIdRef.current,
            source: "book-page",
            customerName: fullName,
            customerPhone: phone,
          });
          rememberFunnelRecord(current);
        }
        const input = {
          publicFunnelNumber: current.publicFunnelNumber,
          mutationToken: current.mutationToken,
          expectedVersion: current.version,
          patch: buildPatch(),
        };
        const next =
          current.stage === "lead"
            ? await reserveFunnelMutation.mutateAsync(input)
            : await updateFunnelMutation.mutateAsync(input);
        rememberFunnelRecord(next);
        setFormError("");
        return next;
      } catch (error) {
        setFormError(
          error instanceof Error
            ? error.message
            : "We could not save your booking details. Please try again."
        );
        return null;
      }
    };
  const finalizeConfirmedCard = async () => {
    const current = funnelRecordRef.current;
    if (!current) {
      setFormError("We couldn't confirm your booking. Please try again.");
      return;
    }
    try {
      await finalizeBookingMutation.mutateAsync({
        publicFunnelNumber: current.publicFunnelNumber,
        mutationToken: current.mutationToken,
      });
      setComplete(true);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "We could not confirm your booking. Please try again."
      );
    }
  };
  const next = async () => {
    setStep(current => current + 1);
  };
  const changeExtra = (id: string, delta: number) =>
    setExtras(current => ({
      ...current,
      [id]: Math.max(0, (current[id] ?? 0) + delta),
    }));

  const quoteHoldCountdown = `${String(Math.floor(quoteHoldSeconds / 60)).padStart(2, "0")}:${String(quoteHoldSeconds % 60).padStart(2, "0")}`;
  const cashAppReturnToken = new URLSearchParams(window.location.search).get(
    "cashapp_return"
  );

  if (cashAppReturnToken)
    return <CashAppBookingReturn returnToken={cashAppReturnToken} />;

  if (complete)
    return (
      <BookingSuccess
        name={firstName}
        service={selectedService.title}
        bedrooms={bedrooms}
        bathrooms={bathrooms}
        dateLabel={dateLabel}
        time={selectedTime}
        total={priceBreakdown.firstCleaningTotalCents}
        futureTotal={priceBreakdown.futureVisitTotalCents}
        frequencyLabel={selectedFrequency.label}
        cardLabel={cardLabel}
      />
    );

  if (step === 1)
    return (
      <main className="literal-book-page-one">
        <div className="literal-book-shell">
          <aside className="literal-book-side" aria-label="Booking progress">
            <a
              className="literal-book-logo"
              href="https://maidsinblack.com/"
              aria-label="Visit Maids in Black"
            >
              MAIDS <span>IN BLACK</span>
              <div className="literal-book-subbrand">SNAPCLEAN</div>
            </a>
            <div className="literal-book-brand-intro">
              <span className="literal-book-accent-line" />
              <p className="literal-book-promise">
                A clean home, <em>without the hassle.</em>
              </p>
              <p className="literal-book-support">
                Choose your service. See your price. Book in minutes.
              </p>
            </div>
            <div className="literal-book-stepnav">
              {[
                "Your home",
                "Cleaning details",
                "Your quote",
                "Schedule",
                "Checkout",
                "Confirmation",
              ].map((label, index) => (
                <div
                  className={`literal-book-navitem${index === 0 ? " active" : ""}`}
                  key={label}
                >
                  <span className="literal-book-num">{index + 1}</span>
                  {label}
                </div>
              ))}
            </div>
          </aside>
          <section className="literal-book-main">
            <div className="literal-book-top">
              <span>STEP 1 OF 6</span>
              <div
                className="literal-book-clock"
                aria-label="Quote and time hold preview"
              >
                <span className="literal-book-clock-icon" aria-hidden="true">
                  ◷
                </span>
                <span className="literal-book-clock-copy">
                  <span className="literal-book-clock-label">
                    Quote &amp; time hold
                  </span>
                  <span className="literal-book-clock-note">
                    We&apos;ll keep your estimate while you finish
                  </span>
                </span>
                <span className="literal-book-clock-value">
                  {quoteHoldCountdown}
                </span>
              </div>
            </div>

            <div className="literal-book-eyebrow">Book with confidence</div>
            <h1>Let&apos;s get your home cleaned.</h1>
            <p className="literal-book-lead">
              Choose how you&apos;d like to book your cleaning. You&apos;ll see
              the estimate after you tell us what you need.
            </p>

            <div className="literal-book-field">
              <label>How would you like to book?</label>
              <div
                className="literal-book-options"
                role="radiogroup"
                aria-label="Booking price type"
              >
                <button
                  type="button"
                  className={`literal-book-choice${pricingMode === "home" ? " selected" : ""}`}
                  role="radio"
                  aria-checked={pricingMode === "home"}
                  onClick={() => setPricingMode("home")}
                >
                  <span>
                    <b>By bedrooms &amp; bathrooms</b>
                    <small>
                      A cleaning price based on the size of your home
                    </small>
                  </span>
                  <span className="literal-book-toggle">
                    {pricingMode === "home" ? "✓" : ""}
                  </span>
                </button>
                <button
                  type="button"
                  className={`literal-book-choice${pricingMode === "hourly" ? " selected" : ""}`}
                  role="radio"
                  aria-checked={pricingMode === "hourly"}
                  onClick={() => setPricingMode("hourly")}
                >
                  <span>
                    <b>By the hour</b>
                    <small>Choose how many cleaners and how many hours</small>
                  </span>
                  <span className="literal-book-toggle">
                    {pricingMode === "hourly" ? "✓" : ""}
                  </span>
                </button>
              </div>
            </div>

            {pricingMode === "home" ? (
              <div className="literal-book-counter-grid">
                <LiteralPageOneCounter
                  label="Bedrooms"
                  value={bedrooms}
                  minimum={0}
                  maximum={7}
                  onChange={setBedrooms}
                />
                <LiteralPageOneCounter
                  label="Bathrooms"
                  value={bathrooms}
                  minimum={1}
                  maximum={5}
                  onChange={setBathrooms}
                />
              </div>
            ) : (
              <div className="literal-book-counter-grid">
                <LiteralPageOneCounter
                  label="# of maids"
                  value={maidCount}
                  minimum={1}
                  maximum={4}
                  onChange={setMaidCount}
                />
                <LiteralPageOneCounter
                  label="# of hours"
                  value={hourCount}
                  minimum={1}
                  maximum={8}
                  onChange={setHourCount}
                />
              </div>
            )}

            <div className="literal-book-microproof">
              <span>✓ 200% satisfaction guarantee</span>
              <span>✓ Insured cleaning teams</span>
            </div>
            <div className="literal-book-actions">
              <button type="button" onClick={() => void next()}>
                Continue →
              </button>
            </div>
            <div className="literal-book-powered">Powered by Baseboard</div>
          </section>
        </div>
      </main>
    );

  if (step === 2)
    return (
      <LiteralPageTwo
        condition={condition}
        onCondition={setCondition}
        pricingMode={pricingMode}
        maidCount={maidCount}
        hourCount={hourCount}
        bedrooms={bedrooms}
        bathrooms={bathrooms}
        quoteHoldCountdown={quoteHoldCountdown}
        onBack={() => setStep(1)}
        onContinue={() => void next()}
        reviewStoryIndex={reviewStoryIndex}
        onReviewStoryChange={setReviewStoryIndex}
      />
    );

  if (step === 3)
    return (
      <LiteralPageThree
        service={service}
        onService={setService}
        pricingMode={pricingMode}
        bedrooms={bedrooms}
        bathrooms={bathrooms}
        maidCount={maidCount}
        hourCount={hourCount}
        extras={extras}
        onExtraChange={changeExtra}
        frequency={frequency}
        onFrequency={setFrequency}
        priceBreakdown={priceBreakdown}
        quoteHoldCountdown={quoteHoldCountdown}
        showAllExtras={showAllExtras}
        onShowAllExtrasChange={setShowAllExtras}
        onBack={() => setStep(2)}
        onContinue={() => setStep(5)}
      />
    );
  if (step === 5)
    return (
      <LiteralPageFour
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        visibleMonth={visibleMonth}
        address={address}
        quoteHoldCountdown={quoteHoldCountdown}
        onSelectDate={date => {
          setSelectedDate(date);
          setVisibleMonth(
            easternMonthDate(date.getUTCFullYear(), date.getUTCMonth(), 1)
          );
        }}
        onVisibleMonthChange={setVisibleMonth}
        onSelectTime={setSelectedTime}
        onAddress={setAddress}
        onBack={() => setStep(3)}
        onContinue={() => void next()}
      />
    );
  if (step === 6 || step === 7)
    return (
      <LiteralPageFive
        phase={step}
        service={selectedService.title}
        pricingMode={pricingMode}
        bedrooms={bedrooms}
        bathrooms={bathrooms}
        maidCount={maidCount}
        hourCount={hourCount}
        condition={condition}
        frequencyLabel={selectedFrequency.label}
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        total={priceBreakdown.firstCleaningTotalCents}
        customerName={customerName}
        firstName={firstName}
        lastName={lastName}
        phone={phone}
        email={email}
        notes={notes}
        onCustomerName={setCustomerName}
        onPhone={setPhone}
        onEmail={setEmail}
        onNotes={setNotes}
        quoteHoldCountdown={quoteHoldCountdown}
        onEditSchedule={() => setStep(5)}
        onBack={() =>
          setStep(current => (current === 6 ? 5 : current === 7 ? 6 : 7))
        }
        onPrepareReservation={reserveBooking}
        isSaving={isSaving}
        formError={formError}
        cardOnFile={cardOnFile}
        applePayAvailable={applePayAvailable}
        googlePayAvailable={googlePayAvailable}
        selectedPaymentMethod={selectedPaymentMethod}
        onPaymentMethodChange={choosePaymentMethod}
        allowCashAppSwitch={
          selectedPaymentMethod === "cashapp" &&
          cashAppBusy &&
          cashAppExitRequest === null
        }
        cashAppExitRequest={cashAppExitRequest}
        onApplePayAvailable={setApplePayAvailable}
        onGooglePayAvailable={setGooglePayAvailable}
        onWalletBusyChange={setWalletBusy}
        onWalletReady={(wallet, brand, last4) => {
          setCardLabel(
            `${wallet === "apple_pay" ? "Apple Pay" : "Google Pay"} · ${brand} ending in ${last4}`
          );
          setCardOnFile(true);
          setFormError("");
          void finalizeConfirmedCard();
        }}
        onCashAppBusyChange={setCashAppBusy}
        onCashAppPaid={totalCents => {
          setCardLabel(`Cash App · ${money(totalCents)} paid today`);
          setFormError("");
          setComplete(true);
        }}
        onCashAppExited={(destination, notice) => {
          setCashAppExitRequest(null);
          setSelectedPaymentMethod(destination);
          setFormError(notice ?? "");
        }}
        onCardReady={(brand, last4) => {
          setCardLabel(`${brand} ending in ${last4}`);
          setCardOnFile(true);
          setFormError("");
          void finalizeConfirmedCard();
        }}
        onRetryFinalization={() => void finalizeConfirmedCard()}
      />
    );
  return (
    <main className="booking-review-page booking-live-page">
      <header className="booking-review-header">
        <a
          href="/"
          className="booking-review-brand"
          aria-label="Maids in Black home"
        >
          <strong>
            Maids in Black<sup>®</sup>
          </strong>
          <span>CLEAN HOMES. BRIGHTER LIVES.</span>
        </a>
        <div className="booking-review-help">
          <MessageCircle /> <span>Need help? Text us</span>
          <i /> <strong>(202) 888-5362</strong>
        </div>
      </header>
      <section className="booking-review-shell">
        <aside
          className="booking-review-progress"
          aria-label="Booking progress"
        >
          <ol>
            {BOOKING_PHASES.map(
              ({ title, subtitle, icon: Icon, steps }, index) => {
                const phaseNumber = index + 1;
                const isDone = steps.every(itemStep => itemStep < step);
                const isCurrent =
                  !isDone &&
                  (step === 1
                    ? index === 0
                    : steps.includes(step as (typeof steps)[number]));
                return (
                  <li
                    key={title}
                    className={
                      isDone ? "done" : isCurrent ? "current" : "future"
                    }
                  >
                    <span className="booking-review-progress-number">
                      {isDone ? <Check /> : phaseNumber}
                    </span>
                    <div>
                      <span className="booking-review-progress-icon">
                        <Icon />
                      </span>
                      <strong>{title}</strong>
                      <small>{subtitle}</small>
                    </div>
                  </li>
                );
              }
            )}
          </ol>
        </aside>
        <section className="booking-review-stage">
          <div
            className={`booking-review-card${step === 1 ? " booking-review-card--service" : step === 3 ? " booking-review-card--condition" : ""}`}
          >
            <div className="booking-review-card-main">
              <div className="booking-review-overline">STEP {step} OF 8</div>
              {step === 1 && (
                <CleaningType selected={service} onSelect={setService} />
              )}
              {step === 2 && (
                <HomeDetails
                  bedrooms={bedrooms}
                  bathrooms={bathrooms}
                  homeType={homeType}
                  frequency={frequency}
                  pricingMode={pricingMode}
                  maidCount={maidCount}
                  hourCount={hourCount}
                  firstTotal={priceBreakdown.firstCleaningTotalCents}
                  futureTotal={priceBreakdown.futureVisitTotalCents}
                  onBedrooms={setBedrooms}
                  onBathrooms={setBathrooms}
                  onHomeType={setHomeType}
                  onFrequency={setFrequency}
                  onPricingMode={setPricingMode}
                  onMaidCount={setMaidCount}
                  onHourCount={setHourCount}
                />
              )}
              {step === 3 && (
                <HomeCondition value={condition} onChange={setCondition} />
              )}
              {step === 4 && <Extras extras={extras} onChange={changeExtra} />}
              {step === 5 && (
                <DateTime
                  selectedDate={selectedDate}
                  selectedTime={selectedTime}
                  visibleMonth={visibleMonth}
                  onSelectDate={date => {
                    setSelectedDate(date);
                    setVisibleMonth(
                      easternMonthDate(
                        date.getUTCFullYear(),
                        date.getUTCMonth(),
                        1
                      )
                    );
                  }}
                  onVisibleMonthChange={setVisibleMonth}
                  onSelectTime={setSelectedTime}
                />
              )}
              {step === 6 && (
                <YourInformation
                  firstName={firstName}
                  lastName={lastName}
                  phone={phone}
                  email={email}
                  address={address}
                  notes={notes}
                  onFirstName={setFirstName}
                  onLastName={setLastName}
                  onPhone={setPhone}
                  onEmail={setEmail}
                  onAddress={setAddress}
                  onNotes={setNotes}
                />
              )}
              {step === 7 && (
                <Payment
                  funnelRecord={funnelRecord}
                  fullName={fullName}
                  amountCents={priceBreakdown.firstCleaningTotalCents}
                  cardOnFile={cardOnFile}
                  onCardReady={(brand, last4) => {
                    setCardLabel(`${brand} ending in ${last4}`);
                    setCardOnFile(true);
                    setFormError("");
                    setStep(8);
                  }}
                />
              )}
              {step === 8 && (
                <ReviewAndBook
                  service={selectedService.title}
                  bedrooms={bedrooms}
                  bathrooms={bathrooms}
                  homeType={homeType}
                  pricingMode={pricingMode}
                  maidCount={maidCount}
                  hourCount={hourCount}
                  condition={condition}
                  extras={selectedExtras}
                  quantities={extras}
                  total={priceBreakdown.firstCleaningTotalCents}
                  futureTotal={priceBreakdown.futureVisitTotalCents}
                  frequencyLabel={selectedFrequency.label}
                  onEdit={setStep}
                />
              )}
              {formError && (
                <div className="booking-live-error" role="alert">
                  {formError}
                </div>
              )}
            </div>
            {step !== 1 && step !== 3 && (
              <aside className="booking-review-rail">
                {step === 7 || step === 8 ? (
                  <BookingSummary
                    service={selectedService.title}
                    bedrooms={bedrooms}
                    bathrooms={bathrooms}
                    homeType={homeType}
                    condition={condition}
                    extras={selectedExtras}
                    quantities={extras}
                    dateLabel={dateLabel}
                    time={selectedTime}
                    pricingMode={pricingMode}
                    homeServiceBaseTotalCents={
                      priceBreakdown.homeServiceBaseTotalCents
                    }
                    hourlyServiceTotalCents={
                      priceBreakdown.hourlyServiceTotalCents
                    }
                    conditionAdjustmentCents={
                      priceBreakdown.conditionAdjustmentCents
                    }
                    conditionMultiplier={priceBreakdown.conditionMultiplier}
                    total={priceBreakdown.firstCleaningTotalCents}
                    futureTotal={priceBreakdown.futureVisitTotalCents}
                    frequencyLabel={selectedFrequency.label}
                  />
                ) : (
                  <ReassuranceRail
                    image={
                      step === 2
                        ? homeDetailsRail
                        : step === 4
                          ? extrasBathroomRail
                          : stillLife
                    }
                    step={step}
                  />
                )}
              </aside>
            )}
            <footer className="booking-review-actions">
              <button
                type="button"
                className="booking-review-back"
                onClick={() =>
                  setStep(current =>
                    current === 5 ? 3 : Math.max(1, current - 1)
                  )
                }
                disabled={step === 1 || isSaving}
              >
                <ArrowLeft />
                Back
              </button>
              <div>
                <Heart />
                <span>
                  {step === 8
                    ? "You won’t be charged until after your cleaning."
                    : "A cleaner, happier home is just a few steps away."}
                </span>
              </div>
              <button
                type="button"
                className="booking-review-next"
                disabled={isSaving || (step === 7 && !cardOnFile)}
                onClick={() => void next()}
              >
                {isSaving ? (
                  "Saving…"
                ) : step === 8 ? (
                  <>
                    <Check />
                    Everything looks good
                  </>
                ) : step === 7 ? (
                  <>
                    Continue to final review <ArrowRight />
                  </>
                ) : (
                  <>
                    Continue <ArrowRight />
                  </>
                )}
              </button>
            </footer>
          </div>
        </section>
      </section>
    </main>
  );
}

function LiteralPageThree({
  service,
  onService,
  pricingMode,
  bedrooms,
  bathrooms,
  maidCount,
  hourCount,
  extras,
  onExtraChange,
  frequency,
  onFrequency,
  priceBreakdown,
  quoteHoldCountdown,
  showAllExtras,
  onShowAllExtrasChange,
  onBack,
  onContinue,
}: {
  service: Service;
  onService: (value: Service) => void;
  pricingMode: PublicBookingPricingMode;
  bedrooms: number;
  bathrooms: number;
  maidCount: number;
  hourCount: number;
  extras: Record<string, number>;
  onExtraChange: (id: string, delta: number) => void;
  frequency: Frequency;
  onFrequency: (value: Frequency) => void;
  priceBreakdown: ReturnType<typeof calculatePublicBookingPrice>;
  quoteHoldCountdown: string;
  showAllExtras: boolean;
  onShowAllExtrasChange: (value: boolean) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const isHourly = pricingMode === "hourly";
  const selectedService =
    SERVICES.find(item => item.id === service) ?? SERVICES[0];
  const selectedExtras = EXTRAS.filter(extra => (extras[extra.id] ?? 0) > 0);
  const visibleExtras = showAllExtras ? EXTRAS : EXTRAS.slice(0, 8);
  const selectedExtraCount = selectedExtras.length;
  const frequencyOption =
    FREQUENCY_OPTIONS.find(option => option.id === frequency) ??
    FREQUENCY_OPTIONS[0];
  const serviceDetail = isHourly
    ? `${hourCount} hours · ${maidCount} cleaner${maidCount === 1 ? "" : "s"}`
    : `${bedrooms} bedroom${bedrooms === 1 ? "" : "s"} · ${bathrooms} bathroom${bathrooms === 1 ? "" : "s"}`;
  const servicePrice = isHourly
    ? priceBreakdown.hourlyServiceTotalCents
    : priceBreakdown.serviceSubtotalCents;
  const quoteSummary = isHourly
    ? `Hourly visit · ${hourCount} hours · ${maidCount} cleaner${maidCount === 1 ? "" : "s"}`
    : frequency === "one-time"
      ? "One-time cleaning"
      : `First cleaning: ${money(priceBreakdown.firstCleaningTotalCents)} · future visits: ${money(priceBreakdown.futureVisitTotalCents ?? 0)}`;
  const serviceChoices: ReadonlyArray<{
    id: Service;
    title: string;
    description: string;
  }> = [
    {
      id: "standard",
      title: "Standard cleaning",
      description: "Routine upkeep, floors, counters and bathrooms",
    },
    {
      id: "deep",
      title: "Deep cleaning",
      description: "More detailed attention to buildup and surfaces",
    },
    {
      id: "moveout",
      title: "Move-in / move-out cleaning",
      description: "For an empty home before move-in or after move-out",
    },
  ];
  const extraIcons: Readonly<Record<string, string>> = {
    "inside-oven": "♨",
    "inside-fridge": "▤",
    "inside-cabinets": "▥",
    "interior-windows": "▦",
    basement: "⌂",
    "organizing-hour": "▧",
    "laundry-load": "▤",
    "wipe-walls-room": "▥",
    "sweep-garage": "⌂",
  };

  return (
    <main className="literal-book-page-three">
      <div className="literal-book-shell">
        <aside className="literal-book-side" aria-label="Booking progress">
          <a
            className="literal-book-logo"
            href="https://maidsinblack.com/"
            aria-label="Visit Maids in Black"
          >
            MAIDS <span>IN BLACK</span>
            <div className="literal-book-subbrand">SNAPCLEAN</div>
          </a>
          <div className="literal-book-brand-intro">
            <span className="literal-book-accent-line" />
            <p className="literal-book-promise">
              A clean home, <em>without the hassle.</em>
            </p>
            <p className="literal-book-support">
              Choose your service. See your price. Book in minutes.
            </p>
          </div>
          <div className="literal-book-stepnav">
            {[
              "Your home",
              "Cleaning details",
              "Your quote",
              "Schedule",
              "Checkout",
              "Confirmation",
            ].map((label, index) => (
              <div
                className={`literal-book-navitem${index === 2 ? " active" : index < 2 ? " done" : ""}`}
                key={label}
              >
                <span className="literal-book-num">
                  {index < 2 ? "✓" : index + 1}
                </span>
                {label}
              </div>
            ))}
          </div>
        </aside>
        <section className="literal-book-main">
          <div className="literal-book-top">
            <span>STEP 3 OF 6</span>
            <div
              className="literal-book-clock"
              aria-label="Quote and time hold preview"
            >
              <span className="literal-book-clock-icon" aria-hidden="true">
                ◷
              </span>
              <span className="literal-book-clock-copy">
                <span className="literal-book-clock-label">
                  Quote &amp; time hold
                </span>
                <span className="literal-book-clock-note">
                  We&apos;ll keep your estimate while you finish
                </span>
              </span>
              <span className="literal-book-clock-value">
                {quoteHoldCountdown}
              </span>
            </div>
          </div>

          <div className="literal-book-eyebrow">
            Transparent pricing · no obligation
          </div>
          <h1>Let&apos;s make it spotless.</h1>
          <p className="literal-book-lead">
            Customize your cleaning. Your estimated total updates instantly.
          </p>

          <section
            className="literal-book-estimate"
            aria-label="Estimated cleaning price"
          >
            <div>
              <small>YOUR ESTIMATED CLEANING PRICE</small>
              <strong>{money(priceBreakdown.firstCleaningTotalCents)}</strong>
              <small>{quoteSummary}</small>
            </div>
            <span aria-hidden="true">✦</span>
          </section>

          {isHourly ? (
            <div className="literal-book-hourly-notice">
              Your hourly estimate is based on {hourCount} hours and {maidCount}{" "}
              cleaner{maidCount === 1 ? "" : "s"}. No room-size charges are
              added.
            </div>
          ) : (
            <section className="literal-book-field">
              <label>Cleaning level</label>
              <div
                className="literal-book-options"
                role="radiogroup"
                aria-label="Cleaning level"
              >
                {serviceChoices.map(choice => (
                  <button
                    type="button"
                    className={`literal-book-choice${service === choice.id ? " selected" : ""}`}
                    key={choice.id}
                    role="radio"
                    aria-checked={service === choice.id}
                    onClick={() => onService(choice.id)}
                  >
                    <span>
                      <b>{choice.title}</b>
                      <small>{choice.description}</small>
                    </span>
                    <span className="literal-book-toggle">
                      {service === choice.id ? "✓" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section
            className="literal-book-extras-section"
            aria-label="Cleaning extras"
          >
            <div className="literal-book-extras-head">
              <div>
                <span className="literal-book-quote-kicker">MAKE IT YOURS</span>
                <h2>Anything else we can take care of?</h2>
                <p>
                  Select any extras you&apos;d like. Your quote updates
                  automatically.
                </p>
              </div>
              <span className="literal-book-extras-selected">
                {selectedExtraCount} selected
              </span>
            </div>
            <div className="literal-book-extras-grid">
              {visibleExtras.map(extra => {
                const quantity = extras[extra.id] ?? 0;
                const selected = quantity > 0;
                return (
                  <article
                    className={`literal-book-extra-tile${selected ? " active" : ""}`}
                    key={extra.id}
                  >
                    <button
                      className="literal-book-extra-select"
                      type="button"
                      aria-pressed={selected}
                      aria-label={`${selected ? "Remove" : "Add"} ${extra.title}`}
                      onClick={() =>
                        onExtraChange(extra.id, selected ? -quantity : 1)
                      }
                    >
                      <span
                        className="literal-book-extra-icon"
                        aria-hidden="true"
                      >
                        {extraIcons[extra.id]}
                      </span>
                      <span className="literal-book-extra-copy">
                        <b>{extra.title}</b>
                        <small>{extra.description}</small>
                        <strong>+{money(EXTRA_RATES[extra.id] * 100)}</strong>
                      </span>
                      <span
                        className="literal-book-extra-check"
                        aria-hidden="true"
                      >
                        {selected ? "✓" : "+"}
                      </span>
                    </button>
                    {selected && (
                      <div className="literal-book-extra-quantity">
                        <button
                          type="button"
                          aria-label={`Decrease ${extra.title.toLowerCase()} quantity`}
                          onClick={() => onExtraChange(extra.id, -1)}
                          disabled={quantity <= 1}
                        >
                          −
                        </button>
                        <span aria-label={`${quantity} selected`}>
                          {quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase ${extra.title.toLowerCase()} quantity`}
                          onClick={() => onExtraChange(extra.id, 1)}
                          disabled={quantity >= 50}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            {EXTRAS.length > 8 && (
              <button
                className="literal-book-extras-more"
                type="button"
                onClick={() => onShowAllExtrasChange(!showAllExtras)}
              >
                {showAllExtras
                  ? "Show fewer extras"
                  : `View all ${EXTRAS.length} extras`}{" "}
                <span aria-hidden="true">{showAllExtras ? "↑" : "↓"}</span>
              </button>
            )}
          </section>

          <section className="literal-book-field literal-book-frequency-field">
            <label>How often?</label>
            <div
              className="literal-book-options"
              role="radiogroup"
              aria-label="Cleaning frequency"
            >
              {FREQUENCY_OPTIONS.map(option => (
                <button
                  type="button"
                  className={`literal-book-choice${frequency === option.id ? " selected" : ""}`}
                  key={option.id}
                  role="radio"
                  aria-checked={frequency === option.id}
                  onClick={() => onFrequency(option.id)}
                >
                  <span>
                    <b>
                      {option.id === "one-time"
                        ? "Just this once"
                        : option.id === "weekly"
                          ? "Every week"
                          : option.id === "biweekly"
                            ? "Every two weeks"
                            : "Every month"}
                    </b>
                    <small>
                      {option.id === "one-time"
                        ? "One-time cleaning"
                        : `${option.savings} on future visits · first clean full price`}
                    </small>
                  </span>
                  <span className="literal-book-toggle">
                    {frequency === option.id ? "✓" : ""}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section
            className="literal-book-quote-redesign"
            aria-label="Your personalized estimate"
          >
            <div className="literal-book-quote-top">
              <div>
                <span className="literal-book-quote-kicker">
                  YOUR PERSONALIZED ESTIMATE
                </span>
                <h2>Here&apos;s your breakdown.</h2>
                <p>Everything in one place, with no guesswork.</p>
              </div>
              <span className="literal-book-quote-symbol" aria-hidden="true">
                ✦
              </span>
            </div>
            <div className="literal-book-quote-lines">
              <div className="literal-book-quote-line">
                <span>
                  <b>{isHourly ? "Hourly cleaning" : selectedService.title}</b>
                  <small>{serviceDetail}</small>
                </span>
                <strong>{money(servicePrice)}</strong>
              </div>
              <div className="literal-book-quote-line">
                <span>
                  <b>Selected extras</b>
                  <small>
                    {selectedExtras.length
                      ? selectedExtras
                          .map(
                            extra =>
                              `${extra.title}${(extras[extra.id] ?? 0) > 1 ? ` × ${extras[extra.id]}` : ""}`
                          )
                          .join(" · ")
                      : "No extras selected"}
                  </small>
                </span>
                <strong>
                  {priceBreakdown.extrasTotalCents
                    ? money(priceBreakdown.extrasTotalCents)
                    : "Included"}
                </strong>
              </div>
            </div>
            {priceBreakdown.futureVisitTotalCents !== null && (
              <div className="literal-book-quote-repeat">
                <span>
                  <b>{frequencyOption.discountPercent}% off future visits</b>
                  <small>Your first clean remains full price</small>
                </span>
                <strong>
                  {money(priceBreakdown.futureVisitTotalCents)}{" "}
                  <small>/ visit</small>
                </strong>
              </div>
            )}
            <div className="literal-book-quote-bottom">
              <span>✓ No surprise add-ons without approval</span>
              <span>✓ 200% satisfaction guarantee</span>
            </div>
          </section>
          <p className="literal-book-quote-footnote">
            Estimates shown are illustrative. Final service scope and pricing
            are confirmed before a real booking.
          </p>
          <div className="literal-book-actions literal-book-actions--split">
            <button
              className="literal-book-back"
              type="button"
              onClick={onBack}
            >
              ← Back
            </button>
            <button type="button" onClick={onContinue}>
              Choose my cleaning time →
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function LiteralPageFour({
  selectedDate,
  selectedTime,
  visibleMonth,
  address,
  quoteHoldCountdown,
  onSelectDate,
  onVisibleMonthChange,
  onSelectTime,
  onAddress,
  onBack,
  onContinue,
}: {
  selectedDate: Date;
  selectedTime: (typeof TIME_SLOTS)[number];
  visibleMonth: Date;
  address: string;
  quoteHoldCountdown: string;
  onSelectDate: (value: Date) => void;
  onVisibleMonthChange: (value: Date) => void;
  onSelectTime: (value: (typeof TIME_SLOTS)[number]) => void;
  onAddress: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const earliest = firstBookableDate();
  const earliestMonth = easternMonthDate(
    earliest.getUTCFullYear(),
    earliest.getUTCMonth(),
    1
  );
  const year = visibleMonth.getUTCFullYear();
  const month = visibleMonth.getUTCMonth();
  const leading = easternCalendarWeekday(year, month);
  const days = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  const previousMonth = easternMonthDate(year, month - 1, 1);
  const nextMonth = easternMonthDate(year, month + 1, 1);
  const quickDateStrings = useMemo(
    () => [1, 2, 3, 4].map(offset => easternDateIso(new Date(), offset)),
    []
  );
  const quickDates = quickDateStrings.map(parseEasternDate);
  const scheduleDateLabel = selectedDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  const selectDate = (date: Date, closeCalendar = false) => {
    onSelectDate(date);
    if (closeCalendar) setCalendarOpen(false);
  };

  return (
    <main className="literal-book-page-four">
      <div className="literal-book-shell">
        <aside className="literal-book-side" aria-label="Booking progress">
          <a
            className="literal-book-logo"
            href="https://maidsinblack.com/"
            aria-label="Visit Maids in Black"
          >
            MAIDS <span>IN BLACK</span>
            <div className="literal-book-subbrand">SNAPCLEAN</div>
          </a>
          <div className="literal-book-brand-intro">
            <span className="literal-book-accent-line" />
            <p className="literal-book-promise">
              A clean home, <em>without the hassle.</em>
            </p>
            <p className="literal-book-support">
              Choose your service. See your price. Book in minutes.
            </p>
          </div>
          <div className="literal-book-stepnav">
            {[
              "Your home",
              "Cleaning details",
              "Your quote",
              "Schedule",
              "Checkout",
              "Confirmation",
            ].map((label, index) => (
              <div
                className={`literal-book-navitem${index === 3 ? " active" : index < 3 ? " done" : ""}`}
                key={label}
              >
                <span className="literal-book-num">
                  {index < 3 ? "✓" : index + 1}
                </span>
                {label}
              </div>
            ))}
          </div>
        </aside>

        <section className="literal-book-main">
          <div className="literal-book-top">
            <span>STEP 4 OF 6</span>
            <div
              className="literal-book-clock"
              aria-label="Quote and time hold preview"
            >
              <span className="literal-book-clock-icon" aria-hidden="true">
                ◷
              </span>
              <span className="literal-book-clock-copy">
                <span className="literal-book-clock-label">
                  Quote &amp; time hold
                </span>
                <span className="literal-book-clock-note">
                  We&apos;ll keep your estimate while you finish
                </span>
              </span>
              <span className="literal-book-clock-value">
                {quoteHoldCountdown}
              </span>
            </div>
          </div>

          <div className="literal-book-eyebrow">Almost there</div>
          <h1>Pick a day that works.</h1>
          <p className="literal-book-lead">
            Choose a preferred day and arrival window. We&apos;ll confirm the
            appointment before it&apos;s booked.
          </p>

          <section className="literal-book-schedule-field">
            <label>Preferred cleaning day</label>
            <div className="literal-book-dates" role="radiogroup">
              {quickDates.map(date => {
                const selected = isoDate(date) === isoDate(selectedDate);
                return (
                  <button
                    type="button"
                    className={`literal-book-date${selected ? " selected" : ""}`}
                    key={isoDate(date)}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => selectDate(date)}
                  >
                    <small>
                      {date.toLocaleDateString("en-US", {
                        weekday: "short",
                        timeZone: "America/New_York",
                      })}
                    </small>
                    <b>{date.getUTCDate()}</b>
                    <small>
                      {date.toLocaleDateString("en-US", {
                        month: "short",
                        timeZone: "America/New_York",
                      })}
                    </small>
                  </button>
                );
              })}
            </div>

            <div className="literal-book-calendar-row">
              <button
                id="literal-book-calendar-toggle"
                className="literal-book-calendar-open"
                type="button"
                aria-expanded={calendarOpen}
                aria-controls="literal-book-calendar-panel"
                onClick={() => setCalendarOpen(current => !current)}
              >
                <span>
                  <span className="literal-book-calendar-caption">
                    Choose another date
                  </span>
                  <span className="literal-book-calendar-sub">
                    Browse the full calendar
                  </span>
                </span>
                <span className="literal-book-calendar-action">
                  <span aria-hidden="true">▦</span>
                  {calendarOpen ? "Close" : "Calendar"}
                  <span aria-hidden="true">{calendarOpen ? "⌃" : "⌄"}</span>
                </span>
              </button>
              {calendarOpen && (
                <div
                  className="literal-book-calendar-panel"
                  id="literal-book-calendar-panel"
                  role="group"
                  aria-label="Choose cleaning date"
                >
                  <div className="literal-book-calendar-top">
                    <span className="literal-book-calendar-month">
                      {easternMonthLabel(visibleMonth)}
                    </span>
                    <div className="literal-book-calendar-arrows">
                      <button
                        className="literal-book-calendar-arrow"
                        type="button"
                        aria-label="Previous month"
                        disabled={previousMonth < earliestMonth}
                        onClick={() => onVisibleMonthChange(previousMonth)}
                      >
                        ‹
                      </button>
                      <button
                        className="literal-book-calendar-arrow"
                        type="button"
                        aria-label="Next month"
                        onClick={() => onVisibleMonthChange(nextMonth)}
                      >
                        ›
                      </button>
                    </div>
                  </div>
                  <div
                    className="literal-book-calendar-week"
                    aria-hidden="true"
                  >
                    {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
                      <span key={`${day}-${index}`}>{day}</span>
                    ))}
                  </div>
                  <div className="literal-book-calendar-days">
                    {Array.from({ length: leading + days }, (_, index) => {
                      const day = index - leading + 1;
                      if (index < leading)
                        return (
                          <span
                            className="literal-book-calendar-day blank"
                            key={`empty-${index}`}
                          />
                        );
                      const date = easternMonthDate(year, month, day);
                      const unavailable = date < earliest;
                      const selected = isoDate(date) === isoDate(selectedDate);
                      return (
                        <button
                          type="button"
                          className={`literal-book-calendar-day${selected ? " selected" : ""}`}
                          disabled={unavailable}
                          aria-current={selected ? "date" : undefined}
                          key={day}
                          onClick={() => selectDate(date, true)}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                  <div className="literal-book-calendar-bottom">
                    <span>Choose your preferred cleaning date</span>
                    <button
                      type="button"
                      onClick={() => selectDate(earliest, true)}
                    >
                      Earliest date
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="literal-book-selected-day">
              Selected: <strong>{scheduleDateLabel}</strong>
            </div>
          </section>

          <section className="literal-book-schedule-field">
            <label>Arrival window</label>
            <div className="literal-book-slot-grid" role="radiogroup">
              {TIME_SLOTS.map((time, index) => {
                const selected = selectedTime === time;
                return (
                  <button
                    type="button"
                    className={`literal-book-slot${selected ? " active" : ""}`}
                    key={time}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onSelectTime(time)}
                  >
                    <b>{time}</b>
                    <small>
                      {index === 0
                        ? "Early arrival window"
                        : "Requested arrival window"}
                    </small>
                  </button>
                );
              })}
            </div>
            <p className="literal-book-slot-note">
              Choose your preferred arrival window. Your selection does not
              reserve a booking.
            </p>
          </section>

          <label className="literal-book-address-field">
            <span>Service address</span>
            <input
              value={address}
              autoComplete="street-address"
              placeholder="Street address, city, ZIP"
              onChange={event => onAddress(event.target.value)}
            />
          </label>

          <div className="literal-book-booking-recap">
            <span>Selected arrival window</span>
            <b>
              {scheduleDateLabel} · {selectedTime}
            </b>
          </div>

          <details className="literal-book-schedule-help">
            <summary>Can I change my appointment?</summary>
            <p>
              Appointment changes depend on the cleaning team&apos;s
              availability and the cancellation policy. The live flow will show
              the policy before confirmation.
            </p>
          </details>

          <div className="literal-book-actions literal-book-actions--split">
            <button
              className="literal-book-back"
              type="button"
              onClick={onBack}
            >
              ← Back
            </button>
            <button type="button" onClick={onContinue}>
              Continue to checkout →
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function LiteralPageTwo({
  condition,
  onCondition,
  pricingMode,
  maidCount,
  hourCount,
  bedrooms,
  bathrooms,
  quoteHoldCountdown,
  onBack,
  onContinue,
  reviewStoryIndex,
  onReviewStoryChange,
}: {
  condition: number;
  onCondition: (value: number) => void;
  pricingMode: PublicBookingPricingMode;
  maidCount: number;
  hourCount: number;
  bedrooms: number;
  bathrooms: number;
  quoteHoldCountdown: string;
  onBack: () => void;
  onContinue: () => void;
  reviewStoryIndex: number;
  onReviewStoryChange: (value: number) => void;
}) {
  const selectedCondition =
    LITERAL_CONDITION_OPTIONS.find(option => option.score === condition) ??
    LITERAL_CONDITION_OPTIONS[0];
  const reviewStory = LITERAL_REVIEW_STORIES[reviewStoryIndex];
  const isHourly = pricingMode === "hourly";
  const insight = isHourly
    ? selectedCondition.id === "restoration"
      ? {
          title: "A full-day team may be needed",
          body: "This review estimate includes a restoration allowance. Select enough cleaner-hours for a full-day reset; final scope is confirmed before a real booking.",
        }
      : {
          title: "We’ll prioritize your cleaning goals",
          body: "Your selected hours and number of cleaners determine your hourly estimate. Tell the team what matters most during the visit.",
        }
    : selectedCondition.id === "restoration"
      ? {
          title: "Full reset / restoration plan",
          body: "This level of buildup may need an all-day team reset. We’ll confirm the final scope before a real booking.",
        }
      : selectedCondition.id === "heavy"
        ? {
            title: "Deep cleaning recommended",
            body: "For significant buildup, deep cleaning is likely the better fit. You can still choose standard.",
          }
        : selectedCondition.id === "moderate"
          ? {
              title: "A little extra attention may help",
              body: "Deep cleaning is worth considering for buildup. Standard is still available.",
            }
          : {
              title: "Standard cleaning looks like a good fit",
              body: "Based on your home condition, routine cleaning may be all you need.",
            };

  return (
    <main className="literal-book-page-two">
      <div className="literal-book-shell">
        <aside className="literal-book-side" aria-label="Booking progress">
          <a
            className="literal-book-logo"
            href="https://maidsinblack.com/"
            aria-label="Visit Maids in Black"
          >
            MAIDS <span>IN BLACK</span>
            <div className="literal-book-subbrand">SNAPCLEAN</div>
          </a>
          <div className="literal-book-brand-intro">
            <span className="literal-book-accent-line" />
            <p className="literal-book-promise">
              A clean home, <em>without the hassle.</em>
            </p>
            <p className="literal-book-support">
              Choose your service. See your price. Book in minutes.
            </p>
          </div>
          <div className="literal-book-stepnav">
            {[
              "Your home",
              "Cleaning details",
              "Your quote",
              "Schedule",
              "Checkout",
              "Confirmation",
            ].map((label, index) => (
              <div
                className={`literal-book-navitem${index === 1 ? " active" : index < 1 ? " done" : ""}`}
                key={label}
              >
                <span className="literal-book-num">
                  {index < 1 ? "✓" : index + 1}
                </span>
                {label}
              </div>
            ))}
          </div>
        </aside>

        <section className="literal-book-main">
          <div className="literal-book-top">
            <span>STEP 2 OF 6</span>
            <div
              className="literal-book-clock"
              aria-label="Quote and time hold preview"
            >
              <span className="literal-book-clock-icon" aria-hidden="true">
                ◷
              </span>
              <span className="literal-book-clock-copy">
                <span className="literal-book-clock-label">
                  Quote &amp; time hold
                </span>
                <span className="literal-book-clock-note">
                  We&apos;ll keep your estimate while you finish
                </span>
              </span>
              <span className="literal-book-clock-value">
                {quoteHoldCountdown}
              </span>
            </div>
          </div>

          <div className="literal-book-eyebrow">Personalize your clean</div>
          <h1>Tell us what matters most.</h1>
          <p className="literal-book-lead">
            {isHourly
              ? "Help your cleaners prioritize their time."
              : "Help us recommend the right cleaning level."}{" "}
            Your{" "}
            {isHourly
              ? `${hourCount}-hour visit with ${maidCount} cleaner${maidCount > 1 ? "s" : ""}`
              : `${bedrooms}-bedroom, ${bathrooms}-bathroom home`}{" "}
            is already saved.
          </p>

          <div className="literal-book-field">
            <label>How would you describe the overall condition?</label>
            <div
              className="literal-book-options"
              role="radiogroup"
              aria-label="Overall home condition"
            >
              {LITERAL_CONDITION_OPTIONS.map(option => (
                <button
                  type="button"
                  className={`literal-book-choice${selectedCondition.id === option.id ? " selected" : ""}`}
                  key={option.id}
                  role="radio"
                  aria-checked={selectedCondition.id === option.id}
                  onClick={() => onCondition(option.score)}
                >
                  <span>
                    <b>{option.title}</b>
                    <small>{option.description}</small>
                  </span>
                  <span className="literal-book-toggle">
                    {selectedCondition.id === option.id ? "✓" : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="literal-book-insight">
            <span className="literal-book-glyph" aria-hidden="true">
              ✦
            </span>
            <div>
              <b>{insight.title}</b>
              <p>{insight.body}</p>
            </div>
          </div>

          <details className="literal-book-helpdetails">
            <summary>What does the cleaning include?</summary>
            <p>
              Standard cleaning covers routine surfaces, bathrooms and floors.
              Deep cleaning adds more detailed attention to buildup and
              neglected areas. Move-in / move-out cleaning is for an empty home
              before or after a move. Full reset / restoration is for severe
              buildup or a long-unattended home and may need an all-day team
              plan. Hourly cleaning is limited to the booked time and agreed
              priorities.
            </p>
          </details>

          <section
            className="literal-book-proof"
            aria-label="Sample customer stories"
          >
            <div className="literal-book-proof-heading">
              <div>
                <div className="literal-book-review-eyebrow">
                  THE MAIDS IN BLACK EXPERIENCE
                </div>
                <h3>Why customers choose Maids in Black</h3>
              </div>
              <div className="literal-book-review-controls">
                <button
                  type="button"
                  aria-label="Previous review"
                  onClick={() =>
                    onReviewStoryChange(
                      (reviewStoryIndex - 1 + LITERAL_REVIEW_STORIES.length) %
                        LITERAL_REVIEW_STORIES.length
                    )
                  }
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label="Next review"
                  onClick={() =>
                    onReviewStoryChange(
                      (reviewStoryIndex + 1) % LITERAL_REVIEW_STORIES.length
                    )
                  }
                >
                  ›
                </button>
              </div>
            </div>
            <div className="literal-book-review-feature">
              <div className="literal-book-review-photo-wrap">
                <img
                  className="literal-book-review-photo"
                  src={reviewCustomerStory}
                  alt=""
                />
              </div>
              <div className="literal-book-review-quote">
                <div
                  className="literal-book-review-stars"
                  aria-label="Five decorative stars"
                >
                  ★★★★★
                </div>
                <blockquote>{reviewStory.quote}</blockquote>
                <strong>{reviewStory.name}</strong>
                <span>{reviewStory.detail}</span>
                <div className="literal-book-review-dots">
                  {LITERAL_REVIEW_STORIES.map((_, index) => (
                    <button
                      type="button"
                      key={index}
                      aria-label={`Show sample review ${index + 1}`}
                      aria-pressed={index === reviewStoryIndex}
                      className={index === reviewStoryIndex ? "selected" : ""}
                      onClick={() => onReviewStoryChange(index)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <p className="literal-book-review-disclaimer">
              Design preview — customer portrait and testimonials are
              illustrative. Replace with real, permissioned customer reviews
              before launch.
            </p>
          </section>

          <div className="literal-book-actions literal-book-actions--split">
            <button
              className="literal-book-back"
              type="button"
              onClick={onBack}
            >
              ← Back
            </button>
            <button type="button" onClick={onContinue}>
              Continue to my quote →
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function LiteralPageOneCounter({
  label,
  value,
  minimum,
  maximum,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="literal-book-counter-card">
      <span className="literal-book-counter-title">{label}</span>
      <div className="literal-book-counter-actions">
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(minimum, value - 1))}
          disabled={value <= minimum}
        >
          −
        </button>
        <strong>{value}</strong>
        <button
          type="button"
          aria-label={`Add ${label.toLowerCase()}`}
          onClick={() => onChange(Math.min(maximum, value + 1))}
          disabled={value >= maximum}
        >
          +
        </button>
      </div>
    </div>
  );
}

function CleaningType({
  selected,
  onSelect,
}: {
  selected: Service;
  onSelect: (service: Service) => void;
}) {
  return (
    <>
      <div className="booking-review-promise">
        <div className="booking-review-promise-copy">
          <h1>
            Book your cleaning
            <br />
            in 60 seconds.
          </h1>
          <p className="booking-review-lede">
            Get your price, choose a time, and you&apos;re booked.
          </p>
          <div
            className="booking-review-trust-signals"
            aria-label="Booking assurances"
          >
            <span>
              <i>
                <UsersRound />
              </i>
              <b>
                Background-checked
                <br />
                teams
              </b>
            </span>
            <span>
              <i>
                <ShieldCheck />
              </i>
              <b>Insured</b>
            </span>
            <span>
              <i>
                <Star />
              </i>
              <b>
                Satisfaction
                <br />
                guaranteed
              </b>
            </span>
          </div>
        </div>
        <div className="booking-review-promise-image-wrap">
          <img
            className="booking-review-promise-image"
            src={promiseImage}
            alt="Sunlit living room with a marble table"
          />
        </div>
      </div>
      <div className="booking-service-grid">
        {SERVICES.map(item => (
          <button
            type="button"
            key={item.id}
            className={selected === item.id ? "selected" : ""}
            onClick={() => onSelect(item.id)}
          >
            <img src={item.image} alt="Warm home interior" />
            <span className="booking-service-radio">
              {selected === item.id && <Check />}
            </span>
            <h2>{item.title}</h2>
            <p>{item.body}</p>
            <ul>
              {item.bullets.map(bullet => (
                <li key={bullet}>
                  <Check />
                  {bullet}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </>
  );
}
function HomeDetailStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: "Bedrooms" | "Bathrooms";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = `booking-${label.toLowerCase()}-stepper-label`;
  const valueLabel =
    label === "Bedrooms" && value === 0
      ? "Studio"
      : `${value} ${value === 1 ? label.slice(0, -1) : label}`;
  return (
    <div className="booking-home-stepper">
      <label id={id}>{label}</label>
      <div
        className="booking-home-stepper-control"
        role="group"
        aria-labelledby={id}
      >
        <button
          type="button"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value === min}
        >
          <Minus />
        </button>
        <output aria-live="polite">{valueLabel}</output>
        <button
          type="button"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value === max}
        >
          <Plus />
        </button>
      </div>
    </div>
  );
}
function HomeDetails({
  bedrooms,
  bathrooms,
  homeType,
  frequency,
  pricingMode,
  maidCount,
  hourCount,
  firstTotal,
  futureTotal,
  onBedrooms,
  onBathrooms,
  onHomeType,
  onFrequency,
  onPricingMode,
  onMaidCount,
  onHourCount,
}: {
  bedrooms: number;
  bathrooms: number;
  homeType: PublicBookingHomeType;
  frequency: Frequency;
  pricingMode: PublicBookingPricingMode;
  maidCount: number;
  hourCount: number;
  firstTotal: number;
  futureTotal: number | null;
  onBedrooms: (value: number) => void;
  onBathrooms: (value: number) => void;
  onHomeType: (value: PublicBookingHomeType) => void;
  onFrequency: (value: Frequency) => void;
  onPricingMode: (value: PublicBookingPricingMode) => void;
  onMaidCount: (value: number) => void;
  onHourCount: (value: number) => void;
}) {
  const isHourly = pricingMode === "hourly";
  const option =
    FREQUENCY_OPTIONS.find(item => item.id === frequency) ??
    FREQUENCY_OPTIONS[0];
  return (
    <>
      <h1>{isHourly ? "Book by the hour" : "Tell us about your home"}</h1>
      <p className="booking-review-lede">
        {isHourly
          ? "Choose the team size and time you need. Hourly service is $70 per maid, per hour."
          : "This helps us give you the most accurate price and send the right team."}
      </p>
      {isHourly ? (
        <>
          <section className="booking-hourly-service">
            <header>
              <div>
                <span>Hourly service</span>
                <p>$70 per maid, per hour</p>
              </div>
              <strong>{money(firstTotal)}</strong>
            </header>
            <div className="booking-hourly-selects">
              <label>
                Number of maids
                <span>
                  <select
                    value={maidCount}
                    onChange={event => onMaidCount(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4].map(count => (
                      <option value={count} key={count}>
                        {count} {count === 1 ? "maid" : "maids"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown />
                </span>
              </label>
              <label>
                Number of hours
                <span>
                  <select
                    value={hourCount}
                    onChange={event => onHourCount(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map(count => (
                      <option value={count} key={count}>
                        {count} {count === 1 ? "hour" : "hours"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown />
                </span>
              </label>
            </div>
            <footer>
              <span>
                {maidCount} maids × {hourCount} hours × $70
              </span>
              <b>Hourly service estimate</b>
            </footer>
          </section>
          <p className="booking-hourly-option">
            <button type="button" onClick={() => onPricingMode("home")}>
              Use bedroom & bathroom estimate
            </button>
          </p>
        </>
      ) : (
        <>
          <div className="booking-home-row">
            <HomeDetailStepper
              label="Bedrooms"
              value={bedrooms}
              min={0}
              max={7}
              onChange={onBedrooms}
            />
            <HomeDetailStepper
              label="Bathrooms"
              value={bathrooms}
              min={1}
              max={5}
              onChange={onBathrooms}
            />
          </div>
          <p className="booking-hourly-option">
            Need a different option?{" "}
            <button type="button" onClick={() => onPricingMode("hourly")}>
              Book hourly instead
            </button>
          </p>
          <div className="booking-home-type">
            <span>Home type</span>
            <div>
              {(
                [
                  ["House", House],
                  ["Apartment", BedDouble],
                  ["Townhome", House],
                  ["Condo", BedDouble],
                ] as const
              ).map(([name, Icon]) => (
                <button
                  type="button"
                  className={homeType === name ? "selected" : ""}
                  key={name}
                  onClick={() => onHomeType(name)}
                >
                  <Icon />
                  {name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="booking-frequency">
        <span>
          Is this a recurring cleaning? <CircleHelp />
        </span>
        <div>
          {FREQUENCY_OPTIONS.map(({ id, label, savings }) => (
            <button
              type="button"
              className={frequency === id ? "selected" : ""}
              key={id}
              onClick={() => onFrequency(id)}
            >
              <span>{label}</span>
              {savings && <small>{savings}</small>}
            </button>
          ))}
        </div>
      </div>
      {futureTotal !== null && (
        <section className="booking-recurring-price">
          <div>
            <span>{option.label} after your first cleaning</span>
            <p>
              First cleaning: {money(firstTotal)} · Save{" "}
              {option.discountPercent}% beginning with visit two.
            </p>
          </div>
          <strong>
            {money(futureTotal)}
            <small>/visit</small>
          </strong>
        </section>
      )}
      <blockquote className="booking-home-testimonial">
        <img
          className="booking-home-testimonial-avatar"
          src={amberTestimonial}
          alt="Amber C."
        />
        <span className="booking-home-testimonial-divider" aria-hidden="true" />
        <div className="booking-home-testimonial-copy">
          <span
            className="booking-home-testimonial-stars"
            aria-label="5 out of 5 stars"
          >
            <Star fill="currentColor" />
            <Star fill="currentColor" />
            <Star fill="currentColor" />
            <Star fill="currentColor" />
            <Star fill="currentColor" />
          </span>
          <p>
            “Our 3 bedroom, 3 bathroom house has never looked and smelled so
            clean.”
          </p>
          <footer>
            <strong>— Amber C.</strong>
          </footer>
        </div>
      </blockquote>
    </>
  );
}
function HomeCondition({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const percent = ((value - 1) / 9) * 100;
  return (
    <>
      <h1>How much love does your home need?</h1>
      <p className="booking-review-lede">
        No judgment — this just helps us allow enough time and give fairer
        pricing.
      </p>
      <section className="booking-condition-canvas">
        <div className="booking-condition-choices">
          {CONDITION_COPY.map((copy, index) => (
            <button
              type="button"
              className={value === index + 1 ? "selected" : ""}
              onClick={() => onChange(index + 1)}
              key={copy}
            >
              <span className="booking-condition-emoji">
                <img src={CONDITION_IMAGES[index]} alt="" />
              </span>
              <span>{copy}</span>
              <b>{index + 1}</b>
            </button>
          ))}
        </div>
        <div className="booking-condition-slider">
          <div className="booking-condition-track">
            <input
              aria-label="Home condition score"
              type="range"
              min="1"
              max="10"
              value={value}
              style={{
                background: `linear-gradient(90deg, #e7d8c3 0%, #e7d8c3 ${percent}%, #171613 ${percent}%, #171613 100%)`,
              }}
              onChange={event => onChange(Number(event.target.value))}
            />
            <output
              className="booking-condition-value"
              aria-hidden="true"
              style={{ left: `${percent}%` }}
            >
              {value}
            </output>
          </div>
          <div>
            {Array.from({ length: 10 }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
        </div>
        <div className="booking-condition-feedback">
          <span aria-hidden="true">😅</span>
          <div>
            <strong>{CONDITION_COPY[value - 1]}</strong>
            <p>Totally normal! We’ll make it feel fresh and clean again.</p>
          </div>
        </div>
      </section>
    </>
  );
}
function Extras({
  extras,
  onChange,
}: {
  extras: Record<string, number>;
  onChange: (id: string, delta: number) => void;
}) {
  return (
    <>
      <h1>Add any extras?</h1>
      <p className="booking-review-lede">
        Make it your own. You can always add more later.
      </p>
      <div className="booking-extras-grid">
        {EXTRAS.map(extra => {
          const quantity = extras[extra.id] ?? 0;
          return (
            <article key={extra.id}>
              <img src={extra.image} alt="Clean home detail" />
              <div>
                <strong>{extra.title}</strong>
                <p>{extra.description}</p>
                <b>+${EXTRA_RATES[extra.id]}</b>
              </div>
              <div className="booking-quantity">
                <button
                  type="button"
                  onClick={() => onChange(extra.id, -1)}
                  disabled={quantity === 0}
                >
                  <Minus />
                </button>
                <span>{quantity}</span>
                <button type="button" onClick={() => onChange(extra.id, 1)}>
                  <Plus />
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="booking-review-note">
        <Sparkles />
        <span>
          <strong>Not sure what you need?</strong> No problem — you can always
          add more later or tell your team on the day of your cleaning.
        </span>
      </div>
    </>
  );
}
function DateTime({
  selectedDate,
  selectedTime,
  visibleMonth,
  onSelectDate,
  onVisibleMonthChange,
  onSelectTime,
}: {
  selectedDate: Date;
  selectedTime: (typeof TIME_SLOTS)[number];
  visibleMonth: Date;
  onSelectDate: (value: Date) => void;
  onVisibleMonthChange: (value: Date) => void;
  onSelectTime: (value: (typeof TIME_SLOTS)[number]) => void;
}) {
  const monthLabel = easternMonthLabel(visibleMonth);
  const year = visibleMonth.getUTCFullYear();
  const month = visibleMonth.getUTCMonth();
  const leading = easternCalendarWeekday(year, month);
  const days = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  const earliest = firstBookableDate();
  const earliestMonth = easternMonthDate(
    earliest.getUTCFullYear(),
    earliest.getUTCMonth(),
    1
  );
  const previousMonth = easternMonthDate(year, month - 1, 1);
  const nextMonth = easternMonthDate(year, month + 1, 1);
  const quickDateStrings = useMemo(
    () => [0, 1, 2].map(offset => easternDateIso(new Date(), offset)),
    []
  );
  const quickDates = quickDateStrings.map(parseEasternDate);
  return (
    <>
      <h1>When should we come?</h1>
      <p className="booking-review-lede">
        Select a date and time for your cleaning.
      </p>
      <div className="booking-date-layout">
        <section className="booking-calendar">
          <header>
            <button
              type="button"
              aria-label="Previous month"
              disabled={previousMonth < earliestMonth}
              onClick={() => onVisibleMonthChange(previousMonth)}
            >
              <ChevronLeft />
            </button>
            <strong>{monthLabel}</strong>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => onVisibleMonthChange(nextMonth)}
            >
              <ChevronRight />
            </button>
          </header>
          <div className="booking-calendar-week">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="booking-calendar-days">
            {Array.from({ length: leading + days }, (_, index) => {
              const day = index - leading + 1;
              if (index < leading) return <span key={`empty-${index}`} />;
              const date = easternMonthDate(year, month, day);
              const unavailable = date < earliest;
              const selected = isoDate(date) === isoDate(selectedDate);
              const hasAvailability =
                !unavailable && [1, 2, 3, 5, 6].includes(date.getUTCDay());
              return (
                <button
                  type="button"
                  className={selected ? "selected" : unavailable ? "muted" : ""}
                  disabled={unavailable}
                  key={day}
                  onClick={() => onSelectDate(date)}
                >
                  {day}
                  {hasAvailability && !selected && (
                    <span
                      className="booking-calendar-availability-dot"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="booking-calendar-quick-dates">
            {quickDates.map((date, index) => (
              <button
                type="button"
                key={isoDate(date)}
                className={
                  isoDate(date) === isoDate(selectedDate) ? "selected" : ""
                }
                onClick={() => onSelectDate(date)}
              >
                <span className="booking-calendar-quick-date-label">
                  <strong>
                    {index === 0
                      ? "Today"
                      : index === 1
                        ? "Tomorrow"
                        : formatDate(date).split(",")[0]}
                  </strong>
                  <ChevronRight aria-hidden="true" />
                </span>
                <span>{REVIEW_OPENING_COUNTS[index]} openings</span>
              </button>
            ))}
          </div>
        </section>
        <section className="booking-times">
          <header className="booking-times-header">
            <div>
              <strong>{formatDate(selectedDate).split(",")[0]}</strong>
              <span>
                {formatDate(selectedDate).split(",").slice(1).join(",").trim()}
              </span>
            </div>
            <b>4 openings</b>
          </header>
          <p className="booking-times-label">
            Choose your 2-hour arrival window
          </p>
          {TIME_SLOTS.map(time => (
            <button
              type="button"
              className={selectedTime === time ? "selected" : ""}
              key={time}
              onClick={() => onSelectTime(time)}
            >
              <span className="booking-time-radio" aria-hidden="true" />
              <span>
                <strong>{time}</strong>
                <small>Arrival window</small>
              </span>
              {selectedTime === time && <em>Selected</em>}
            </button>
          ))}
        </section>
      </div>
    </>
  );
}
function LiteralCheckoutContactForm({
  name,
  phone,
  email,
  notes,
  onName,
  onPhone,
  onEmail,
  onNotes,
}: {
  name: string;
  phone: string;
  email: string;
  notes: string;
  onName: (value: string) => void;
  onPhone: (value: string) => void;
  onEmail: (value: string) => void;
  onNotes: (value: string) => void;
}) {
  return (
    <div className="literal-book-checkout-contact-fields">
      <div className="literal-book-checkout-contact-grid">
        <label>
          <span>Full name</span>
          <input
            value={name}
            onChange={event => onName(event.target.value)}
            placeholder="Alex Morgan"
            autoComplete="name"
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            value={phone}
            onChange={event => onPhone(formatPhoneInput(event.target.value))}
            placeholder="(555) 123-4567"
            inputMode="tel"
            autoComplete="tel"
          />
        </label>
      </div>
      <label>
        <span>Email</span>
        <input
          value={email}
          onChange={event => onEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          autoComplete="email"
        />
      </label>
      <label className="literal-book-checkout-notes">
        <span>
          Access notes <em>(optional)</em>
        </span>
        <textarea
          value={notes}
          onChange={event => onNotes(event.target.value)}
          placeholder="Gate code, lockbox, parking instructions, pets, or other access details"
        />
      </label>
    </div>
  );
}

function LiteralPageFive({
  phase,
  service,
  pricingMode,
  bedrooms,
  bathrooms,
  maidCount,
  hourCount,
  condition,
  frequencyLabel,
  selectedDate,
  selectedTime,
  total,
  customerName,
  firstName,
  lastName,
  phone,
  email,
  notes,
  onCustomerName,
  onPhone,
  onEmail,
  onNotes,
  quoteHoldCountdown,
  onEditSchedule,
  onBack,
  onPrepareReservation,
  isSaving,
  formError,
  cardOnFile,
  applePayAvailable,
  googlePayAvailable,
  selectedPaymentMethod,
  onPaymentMethodChange,
  allowCashAppSwitch,
  cashAppExitRequest,
  onApplePayAvailable,
  onGooglePayAvailable,
  onWalletBusyChange,
  onWalletReady,
  onCashAppBusyChange,
  onCashAppPaid,
  onCashAppExited,
  onCardReady,
  onRetryFinalization,
}: {
  phase: 6 | 7;
  service: string;
  pricingMode: PublicBookingPricingMode;
  bedrooms: number;
  bathrooms: number;
  maidCount: number;
  hourCount: number;
  condition: number;
  frequencyLabel: string;
  selectedDate: Date;
  selectedTime: (typeof TIME_SLOTS)[number];
  total: number;
  customerName: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  notes: string;
  onCustomerName: (value: string) => void;
  onPhone: (value: string) => void;
  onEmail: (value: string) => void;
  onNotes: (value: string) => void;
  quoteHoldCountdown: string;
  onEditSchedule: () => void;
  onBack: () => void;
  onPrepareReservation: () => Promise<BookingFunnelPublicResult | null>;
  isSaving: boolean;
  formError: string;
  cardOnFile: boolean;
  applePayAvailable: boolean;
  googlePayAvailable: boolean;
  selectedPaymentMethod: "card" | "apple_pay" | "cashapp" | "google_pay" | null;
  onPaymentMethodChange: (
    method: "card" | "apple_pay" | "cashapp" | "google_pay" | null
  ) => void;
  allowCashAppSwitch: boolean;
  cashAppExitRequest: "card" | "apple_pay" | "google_pay" | null;
  onApplePayAvailable: (available: boolean) => void;
  onGooglePayAvailable: (available: boolean) => void;
  onWalletBusyChange: (busy: boolean) => void;
  onWalletReady: (
    wallet: "apple_pay" | "google_pay",
    brand: string,
    last4: string
  ) => void;
  onCashAppBusyChange: (busy: boolean) => void;
  onCashAppPaid: (totalCents: number) => void;
  onCashAppExited: (
    destination: "card" | "apple_pay" | "google_pay" | null,
    notice?: string
  ) => void;
  onCardReady: (brand: string, last4: string) => void;
  onRetryFinalization: () => void;
}) {
  const dateLabel = selectedDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  const serviceDetails =
    pricingMode === "hourly"
      ? `${maidCount} cleaner${maidCount === 1 ? "" : "s"} · ${hourCount} hours`
      : `${bedrooms === 0 ? "Studio" : `${bedrooms} bedrooms`} · ${bathrooms} bathrooms`;
  const serviceSummary = `${frequencyLabel} · ${CONDITION_COPY[condition - 1]}`;
  const showCardEntry = phase === 6 || phase === 7;

  return (
    <main className="literal-book-page-five">
      <div className="literal-book-shell">
        <aside className="literal-book-side" aria-label="Booking progress">
          <a
            className="literal-book-logo"
            href="https://maidsinblack.com/"
            aria-label="Visit Maids in Black"
          >
            MAIDS <span>IN BLACK</span>
            <div className="literal-book-subbrand">SNAPCLEAN</div>
          </a>
          <div className="literal-book-brand-intro">
            <span className="literal-book-accent-line" />
            <p className="literal-book-promise">
              A clean home, <em>without the hassle.</em>
            </p>
            <p className="literal-book-support">
              Choose your service. See your price. Book in minutes.
            </p>
          </div>
          <div className="literal-book-stepnav">
            {[
              "Your home",
              "Cleaning details",
              "Your quote",
              "Schedule",
              "Checkout",
              "Confirmation",
            ].map((label, index) => (
              <div
                className={`literal-book-navitem${index === 4 ? " active" : index < 4 ? " done" : ""}`}
                key={label}
              >
                <span className="literal-book-num">
                  {index < 4 ? "✓" : index + 1}
                </span>
                {label}
              </div>
            ))}
          </div>
        </aside>

        <section className="literal-book-main">
          <div className="literal-book-top">
            <span>STEP 5 OF 6</span>
            <div
              className="literal-book-clock"
              aria-label="Quote and time hold"
            >
              <span className="literal-book-clock-icon" aria-hidden="true">
                ◷
              </span>
              <span className="literal-book-clock-copy">
                <span className="literal-book-clock-label">
                  Quote &amp; time hold
                </span>
                <span className="literal-book-clock-note">
                  We&apos;ll keep your estimate while you finish
                </span>
              </span>
              <span className="literal-book-clock-value">
                {quoteHoldCountdown}
              </span>
            </div>
          </div>

          <section className="literal-book-checkout-intro">
            <div className="literal-book-eyebrow">
              YOUR BOOKING · FINAL STEP
            </div>
            <h1>
              Let&apos;s make it official<span>.</span>
            </h1>
            <p className="literal-book-lead">
              Everything looks good. Review your cleaning, add your contact
              details, and choose how you&apos;d like to pay.
            </p>
          </section>

          <section className="literal-book-checkout-ticket">
            <div className="literal-book-ticket-top">
              <div className="literal-book-ticket-title">
                <span className="literal-book-ticket-icon" aria-hidden="true">
                  ✦
                </span>
                <div>
                  <span>YOUR CLEANING</span>
                  <strong>{service}</strong>
                </div>
              </div>
              <button type="button" onClick={onEditSchedule}>
                Edit booking ↗
              </button>
            </div>
            <div className="literal-book-ticket-info">
              <div className="literal-book-ticket-detail">
                <span aria-hidden="true">
                  <CalendarDays />
                </span>
                <div>
                  <small>DATE &amp; ARRIVAL</small>
                  <b>{dateLabel}</b>
                  <em>{selectedTime}</em>
                </div>
              </div>
              <div className="literal-book-ticket-detail">
                <span aria-hidden="true">
                  <House />
                </span>
                <div>
                  <small>SERVICE DETAILS</small>
                  <b>{serviceDetails}</b>
                  <em>{serviceSummary}</em>
                </div>
              </div>
            </div>
            <div className="literal-book-ticket-total">
              <div>
                <small>FIRST CLEANING ESTIMATE</small>
                <strong>{money(total)}</strong>
              </div>
              <span>Clear pricing, no surprises</span>
            </div>
          </section>
          <section className="literal-book-checkout-contact">
            <h2>Where should we send your confirmation?</h2>
            <p>We&apos;ll use these details to coordinate your cleaning.</p>
            {phase === 6 ? (
              <LiteralCheckoutContactForm
                name={customerName}
                phone={phone}
                email={email}
                notes={notes}
                onName={onCustomerName}
                onPhone={onPhone}
                onEmail={onEmail}
                onNotes={onNotes}
              />
            ) : (
              <div className="literal-book-checkout-contact-saved">
                <span>
                  <b>{`${firstName} ${lastName}`.trim()}</b>
                  <small>{phone}</small>
                </span>
                <span>
                  <b>{email}</b>
                  {notes ? <small>Access notes saved</small> : null}
                </span>
              </div>
            )}
          </section>

          {showCardEntry && (
            <>
              <section className="literal-book-payment-heading">
                <div className="literal-book-eyebrow">Secure checkout</div>
                <h2>How would you like to secure your booking?</h2>
                <p>
                  Choose the option that works best for you.
                </p>
              </section>

              <section
                className={`literal-book-card-choice${selectedPaymentMethod === "card" ? " is-selected" : ""}`}
                aria-label="Card on file payment method"
              >
                <button
                  type="button"
                  className="literal-book-card-choice-head"
                  aria-expanded={selectedPaymentMethod === "card"}
                  onClick={() => onPaymentMethodChange("card")}
                  disabled={isSaving && !allowCashAppSwitch}
                >
                  <span aria-hidden="true">
                    {selectedPaymentMethod === "card" ? "✓" : ""}
                  </span>
                  <span>
                    <strong>Card on file · pay after service</strong>
                    <p>
                      Securely save your card now. You&apos;re charged after the
                      cleaning.
                    </p>
                  </span>
                </button>
                <div
                  className={`literal-book-card-detail${selectedPaymentMethod === "card" ? " is-open" : ""}`}
                  aria-hidden={selectedPaymentMethod !== "card"}
                >
                  {cardOnFile ? (
                    <div className="literal-book-card-message">
                      <Check /> Your card is securely on file. Confirming your
                      booking now.
                    </div>
                  ) : (
                    <PublicBookingCardSetupBeforeReservation
                      customerName={customerName}
                      onPrepareReservation={onPrepareReservation}
                      creatingBooking={isSaving}
                      onComplete={result =>
                        onCardReady(result.cardBrand, result.cardLast4)
                      }
                    />
                  )}
                </div>
              </section>
              <section
                className={`literal-book-apple-pay-choice${selectedPaymentMethod === "apple_pay" ? " is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="literal-book-card-choice-head"
                  aria-expanded={selectedPaymentMethod === "apple_pay"}
                  onClick={() => onPaymentMethodChange("apple_pay")}
                  disabled={isSaving && !allowCashAppSwitch}
                >
                  <span aria-hidden="true">
                    {selectedPaymentMethod === "apple_pay" ? "✓" : ""}
                  </span>
                  <span>
                    <strong>Apple Pay</strong>
                    <p>
                      Securely save Apple Pay now. You&apos;re charged after the
                      cleaning.
                    </p>
                  </span>
                </button>
                <div
                  className={`literal-book-apple-pay-detail${selectedPaymentMethod === "apple_pay" ? " is-open" : ""}`}
                >
                  <p className="literal-book-apple-pay-note">
                    Use Apple Pay to securely save your card. You&apos;re charged
                    after the cleaning.
                  </p>
                  {!applePayAvailable ? (
                    <p className="literal-book-apple-pay-unavailable" role="status">
                      Apple Pay is not available in this browser or Wallet. You
                      can use Card on file or Google Pay instead.
                    </p>
                  ) : null}
                  <BookingWalletCardOnFileCheckout
                    wallet="apple_pay"
                    active={selectedPaymentMethod === "apple_pay"}
                    customerName={customerName}
                    deferredAmountCents={total}
                    deferredPaymentDate={selectedDate}
                    onAvailabilityChange={onApplePayAvailable}
                    onPrepareReservation={onPrepareReservation}
                    onComplete={({ cardBrand, cardLast4 }) =>
                      onWalletReady("apple_pay", cardBrand, cardLast4)
                    }
                    onBusyChange={onWalletBusyChange}
                  />
                </div>
              </section>
              <section
                className={`literal-book-cashapp-choice${selectedPaymentMethod === "cashapp" ? " is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="literal-book-card-choice-head"
                  aria-expanded={selectedPaymentMethod === "cashapp"}
                  onClick={() => onPaymentMethodChange("cashapp")}
                  disabled={isSaving && !allowCashAppSwitch}
                >
                  <span aria-hidden="true">
                    {selectedPaymentMethod === "cashapp" ? "✓" : ""}
                  </span>
                  <span>
                    <strong>Pay with Cash App</strong>
                    <p>
                      Pay {money(total)} today for your first cleaning.
                    </p>
                  </span>
                </button>
                <div
                  className={`literal-book-cashapp-detail${selectedPaymentMethod === "cashapp" ? " is-open" : ""}`}
                >
                  <p className="literal-book-cashapp-note">
                    Cash App securely charges {money(total)} today for the first
                    cleaning only.
                  </p>
                  <BookingCashAppCheckout
                    active={selectedPaymentMethod === "cashapp"}
                    totalCents={total}
                    exitRequest={
                      selectedPaymentMethod === "cashapp"
                        ? cashAppExitRequest
                        : null
                    }
                    onPrepareReservation={onPrepareReservation}
                    onBusyChange={onCashAppBusyChange}
                    onPaid={onCashAppPaid}
                    onExited={onCashAppExited}
                  />
                </div>
              </section>
              <section
                className={`literal-book-google-pay-choice${selectedPaymentMethod === "google_pay" ? " is-selected" : ""}`}
              >
                <button
                  type="button"
                  className="literal-book-card-choice-head"
                  aria-expanded={selectedPaymentMethod === "google_pay"}
                  onClick={() => onPaymentMethodChange("google_pay")}
                  disabled={isSaving && !allowCashAppSwitch}
                >
                  <span aria-hidden="true">
                    {selectedPaymentMethod === "google_pay" ? "✓" : ""}
                  </span>
                  <span>
                    <strong>Google Pay</strong>
                    <p>
                      Securely save Google Pay now. You&apos;re charged after the
                      cleaning.
                    </p>
                  </span>
                </button>
                <div
                  className={`literal-book-google-pay-detail${selectedPaymentMethod === "google_pay" ? " is-open" : ""}`}
                >
                  <p className="literal-book-google-pay-note">
                    Use Google Pay to securely save your card. You&apos;re charged
                    after the cleaning.
                  </p>
                  {!googlePayAvailable ? (
                    <p className="literal-book-google-pay-unavailable" role="status">
                      Google Pay is not available in this browser or Wallet. You
                      can use Card on file or Apple Pay instead.
                    </p>
                  ) : null}
                  <BookingWalletCardOnFileCheckout
                    wallet="google_pay"
                    active={selectedPaymentMethod === "google_pay"}
                    customerName={customerName}
                    deferredAmountCents={total}
                    deferredPaymentDate={selectedDate}
                    onAvailabilityChange={onGooglePayAvailable}
                    onPrepareReservation={onPrepareReservation}
                    onComplete={({ cardBrand, cardLast4 }) =>
                      onWalletReady("google_pay", cardBrand, cardLast4)
                    }
                    onBusyChange={onWalletBusyChange}
                  />
                </div>
              </section>
            </>
          )}

          <div className="literal-book-trust-grid">
            <div>
              <b>✓ 200% satisfaction guarantee</b>
              <span>We stand behind the cleaning service.</span>
            </div>
            <div>
              <b>✓ Insured cleaning teams</b>
              <span>Professional service with added peace of mind.</span>
            </div>
          </div>
          <div className="literal-book-google-proof" aria-label="Google reviews">
            <span aria-hidden="true">★★★★★</span>
            <strong>123 Google reviews</strong>
          </div>

          {formError && (
            <div className="literal-book-checkout-error" role="alert">
              {formError}
            </div>
          )}

          <div className="literal-book-checkout-dock">
            <div>
              <b>First cleaning · {money(total)}</b>
              <span>
                {selectedPaymentMethod === "apple_pay"
                  ? "Apple Pay charged after service"
                  : selectedPaymentMethod === "google_pay"
                    ? "Google Pay charged after service"
                  : selectedPaymentMethod === "cashapp"
                    ? "Cash App charged today"
                    : selectedPaymentMethod === "card"
                    ? "Card charged after service"
                    : "Choose a payment method"}
              </span>
            </div>
            <em>Secure checkout</em>
            {cardOnFile && formError ? (
              <button
                type="button"
                onClick={onRetryFinalization}
                disabled={isSaving}
              >
                Try confirming booking →
              </button>
            ) : null}
          </div>
          <button
            className="literal-book-checkout-back"
            type="button"
            onClick={onBack}
            disabled={isSaving}
          >
            ←{" "}
            {phase === 6
              ? "Back to schedule"
              : phase === 7
                ? "Back to contact details"
                : "Back to card setup"}
          </button>
          <details className="literal-book-checkout-help">
            <summary>When would I be charged?</summary>
            <p>
              {selectedPaymentMethod === "apple_pay"
                ? "Apple Pay is securely saved at booking and charged once the cleaning is completed."
                : selectedPaymentMethod === "google_pay"
                  ? "Google Pay is securely saved at booking and charged once the cleaning is completed."
                : selectedPaymentMethod === "cashapp"
                  ? `Cash App charges ${money(total)} today for the first cleaning.`
                  : selectedPaymentMethod === "card"
                  ? "Your card is securely collected at booking and charged once the cleaning is completed."
                  : "Choose a payment method to see when you would be charged."}
            </p>
          </details>
        </section>
      </div>
    </main>
  );
}

function CashAppBookingReturn({ returnToken }: { returnToken: string }) {
  const payment = trpc.cashApp.booking.returnStatus.useQuery(
    { returnToken },
    {
      refetchInterval: query => (query.state.data?.booking ? false : 1_500),
      refetchIntervalInBackground: false,
    }
  );
  const booking = payment.data?.booking;
  if (booking) {
    const time =
      TIME_SLOTS.find(
        slot => timeLabelTo24Hour(slot) === booking.requestedLocalTime
      ) ?? booking.requestedLocalTime;
    return (
      <BookingSuccess
        name={booking.customerName.split(/\s+/)[0] || booking.customerName}
        service={booking.serviceName}
        bedrooms={booking.bedrooms}
        bathrooms={booking.bathrooms}
        dateLabel={easternDateLabel(booking.requestedLocalDate)}
        time={time}
        total={booking.firstCleaningTotalCents}
        futureTotal={booking.futureVisitTotalCents}
        frequencyLabel={booking.recurrence}
        cardLabel={`Cash App · ${money(booking.firstCleaningTotalCents)} paid today`}
      />
    );
  }
  return (
    <main className="literal-book-cashapp-return">
      <section className="literal-book-cashapp-return-card">
        <div className="literal-book-eyebrow">SECURE CHECKOUT</div>
        <h1>{payment.isError ? "Cash App payment was not completed." : "Confirming your Cash App payment…"}</h1>
        <p>
          {payment.isError
            ? payment.error?.message ?? "Cash App could not confirm the payment."
            : "Please keep this page open while we confirm your booking."}
        </p>
        {payment.isError ? <a href="/book">Return to booking</a> : null}
      </section>
    </main>
  );
}

function formatPhoneInput(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function YourInformation(props: {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  onFirstName: (value: string) => void;
  onLastName: (value: string) => void;
  onPhone: (value: string) => void;
  onEmail: (value: string) => void;
  onAddress: (value: string) => void;
  onNotes: (value: string) => void;
}) {
  return (
    <>
      <h1>Your information</h1>
      <p className="booking-review-lede">
        We’ll use this to confirm your booking and keep you updated.
      </p>
      <div className="booking-contact-grid">
        <label>
          First name *
          <input
            value={props.firstName}
            onChange={event => props.onFirstName(event.target.value)}
            autoComplete="given-name"
          />
        </label>
        <label>
          Last name *
          <input
            value={props.lastName}
            onChange={event => props.onLastName(event.target.value)}
            autoComplete="family-name"
          />
        </label>
        <label className="full">
          Phone number *
          <span className="booking-input-with-icon">
            <MessageCircle />
            <input
              value={props.phone}
              onChange={event =>
                props.onPhone(formatPhoneInput(event.target.value))
              }
              inputMode="tel"
              autoComplete="tel"
            />
          </span>
        </label>
        <label className="full">
          Email address *
          <span className="booking-input-with-icon">
            <MessageCircle />
            <input
              value={props.email}
              onChange={event => props.onEmail(event.target.value)}
              type="email"
              autoComplete="email"
            />
          </span>
          <small>We’ll send your confirmation and receipts here.</small>
        </label>
        <label className="full">
          Service address *
          <span className="booking-input-with-icon">
            <MapPin />
            <input
              value={props.address}
              onChange={event => props.onAddress(event.target.value)}
              autoComplete="street-address"
            />
          </span>
        </label>
        <label className="full">
          Access notes <em>(optional)</em>
          <textarea
            value={props.notes}
            onChange={event => props.onNotes(event.target.value)}
            placeholder="e.g. gate code, lockbox, parking instructions, pets, etc."
          />
        </label>
      </div>
    </>
  );
}
function Payment({
  funnelRecord,
  fullName,
  amountCents,
  cardOnFile,
  onCardReady,
}: {
  funnelRecord: BookingFunnelPublicResult | null;
  fullName: string;
  amountCents: number;
  cardOnFile: boolean;
  onCardReady: (brand: string, last4: string) => void;
}) {
  return (
    <>
      <section className="booking-payment-hero">
        <h1>Reserve your cleaning</h1>
        <div className="booking-payment-reassurance">
          <span className="booking-payment-reassurance-icon">
            <LockKeyhole />
          </span>
          <div>
            <strong>You won’t be charged today.</strong>
            <p>
              Your card securely reserves your appointment.
              <br />
              Payment is processed after your cleaning is completed.
            </p>
          </div>
        </div>
        <div className="booking-payment-trust" aria-label="Payment assurances">
          <div>
            <span>
              <ShieldCheck />
            </span>
            <strong>
              Secure
              <br />
              payments
            </strong>
            <small>Powered by Stripe</small>
          </div>
          <div>
            <span>
              <CreditCard />
            </span>
            <strong>
              Your card
              <br />
              is not stored
            </strong>
            <small>
              Handled securely
              <br />
              by Stripe
            </small>
          </div>
          <div>
            <span>
              <ShieldCheck />
            </span>
            <strong>Protects our teams</strong>
            <small>
              Helps us avoid traveling with cash throughout the city
            </small>
          </div>
        </div>
      </section>
      {cardOnFile ? (
        <div className="booking-live-card-saved">
          <Check />
          Your card is securely on file. Continue to take a final look at your
          booking.
        </div>
      ) : funnelRecord ? (
        <BookingPaymentCheckout
          publicFunnelNumber={funnelRecord.publicFunnelNumber}
          mutationToken={funnelRecord.mutationToken}
          customerName={fullName}
          amountCents={amountCents}
          directCardEntry
          deferConfirmation
          onComplete={result => onCardReady(result.cardBrand, result.cardLast4)}
        />
      ) : (
        <div className="booking-live-error">
          Your booking details need to be saved before secure card entry.
        </div>
      )}
    </>
  );
}
function ReviewAndBook({
  service,
  bedrooms,
  bathrooms,
  homeType,
  pricingMode,
  maidCount,
  hourCount,
  condition,
  extras,
  quantities,
  total,
  futureTotal,
  frequencyLabel,
  onEdit,
}: {
  service: string;
  bedrooms: number;
  bathrooms: number;
  homeType: string;
  pricingMode: PublicBookingPricingMode;
  maidCount: number;
  hourCount: number;
  condition: number;
  extras: readonly Extra[];
  quantities: Record<string, number>;
  total: number;
  futureTotal: number | null;
  frequencyLabel: string;
  onEdit: (step: number) => void;
}) {
  const pricing =
    pricingMode === "hourly"
      ? `Hourly · ${maidCount} maids × ${hourCount} hours`
      : `${bedrooms === 0 ? "Studio" : `${bedrooms} bedrooms`} · ${bathrooms} bathrooms · ${homeType}`;
  const cards = [
    [1, "Cleaning Type", service, Sparkles],
    [
      2,
      pricingMode === "hourly" ? "Hourly service" : "Home Details",
      pricing,
      House,
    ],
    [
      3,
      "Home Condition",
      `${condition} · ${CONDITION_COPY[condition - 1]}`,
      House,
    ],
    [
      4,
      "Extras",
      extras.length
        ? extras.map(item => item.title).join(", ")
        : "No extras selected",
      Sparkles,
    ],
    [5, "Date & Time", "Selected arrival window", CalendarDays],
    [6, "Your Information", "Your booking contact details", UsersRound],
    [
      7,
      "Payment Method",
      "Card on file · charged after service completion",
      CreditCard,
    ],
  ] as const;
  return (
    <>
      <h1>Thanks for booking!</h1>
      <section className="booking-final-notes">
        <label>
          Take a final look{" "}
          <span>
            Your card is securely on file. Confirm below to complete your
            booking.
          </span>
        </label>
      </section>
      <div className="booking-final-grid">
        {cards.map(([target, title, detail, Icon]) => (
          <article key={title}>
            <Icon />
            <div>
              <strong>{title}</strong>
              <p>{detail}</p>
            </div>
            <button type="button" onClick={() => onEdit(target)}>
              <span>Edit</span>
              <ChevronRight />
            </button>
          </article>
        ))}
      </div>
      <div className="booking-live-final-note">
        <ShieldCheck />
        Your first cleaning is {money(total)}
        {futureTotal !== null
          ? `; ${frequencyLabel} visits after the first are ${money(futureTotal)}.`
          : "."}
      </div>
    </>
  );
}
function ReassuranceRail({ image, step }: { image: string; step: number }) {
  const contents =
    step === 4
      ? [
          "Professional, detail-oriented cleaners",
          "Eco-friendly products",
          "Save time and get more done",
          "A home you’ll love coming back to",
        ]
      : [
          "Trusted & insured",
          "Background-checked team",
          "Eco-friendly products",
          "Easy online booking",
          "Satisfaction guaranteed",
        ];
  return (
    <div className="booking-reassurance">
      <img src={image} alt="Warm clean home interior" />
      <h2>
        {step === 4
          ? "Little extras. A big difference."
          : "A cleaner, happier home is just a few steps away."}
      </h2>
      <i />{" "}
      <ul>
        {contents.map((item, index) => (
          <li key={item}>
            {index === 0 ? (
              <ShieldCheck />
            ) : index === 1 ? (
              <UsersRound />
            ) : index === 2 ? (
              <Leaf />
            ) : index === 3 ? (
              <CalendarDays />
            ) : (
              <Heart />
            )}
            {item}
          </li>
        ))}
      </ul>
      {step === 6 && (
        <blockquote>
          <img
            className="booking-testimonial-cleaner"
            src={testimonialCleaner}
            alt="Maids in Black cleaner in a kitchen"
          />
          “Booking was so easy and the team was amazing. Highly recommend!”
          <span className="booking-testimonial-meta">
            <span
              className="booking-testimonial-stars"
              aria-label="5 out of 5 stars"
            >
              <Star fill="currentColor" />
              <Star fill="currentColor" />
              <Star fill="currentColor" />
              <Star fill="currentColor" />
              <Star fill="currentColor" />
            </span>
            <span className="booking-testimonial-attribution">
              — DC Customer
            </span>
          </span>
        </blockquote>
      )}
    </div>
  );
}
function BookingSummary({
  service,
  bedrooms,
  bathrooms,
  homeType,
  condition,
  extras,
  quantities,
  dateLabel,
  time,
  pricingMode,
  homeServiceBaseTotalCents,
  hourlyServiceTotalCents,
  conditionAdjustmentCents,
  conditionMultiplier,
  total,
  futureTotal,
  frequencyLabel,
}: {
  service: string;
  bedrooms: number;
  bathrooms: number;
  homeType: string;
  condition: number;
  extras: readonly Extra[];
  quantities: Record<string, number>;
  dateLabel: string;
  time: string;
  pricingMode: PublicBookingPricingMode;
  homeServiceBaseTotalCents: number;
  hourlyServiceTotalCents: number;
  conditionAdjustmentCents: number;
  conditionMultiplier: number;
  total: number;
  futureTotal: number | null;
  frequencyLabel: string;
}) {
  return (
    <div className="booking-summary-rail">
      <img src={stillLife} alt="Warm clean home interior" />
      <h2>Booking summary</h2>
      <dl>
        <div>
          <dt>Cleaning type</dt>
          <dd>{service}</dd>
        </div>
        <div>
          <dt>Home details</dt>
          <dd>
            {bedrooms === 0 ? "Studio" : `${bedrooms} bed`} · {bathrooms} bath ·{" "}
            {homeType}
          </dd>
        </div>
        <div>
          <dt>Home condition</dt>
          <dd>
            {condition} · {CONDITION_COPY[condition - 1]}
          </dd>
        </div>
        <div>
          <dt>
            {pricingMode === "hourly" ? "Hourly service" : "Base cleaning"}
          </dt>
          <dd>
            {money(
              pricingMode === "hourly"
                ? hourlyServiceTotalCents
                : homeServiceBaseTotalCents
            )}
          </dd>
        </div>
        {pricingMode === "home" && (
          <div>
            <dt>
              Home condition adjustment
              {conditionAdjustmentCents > 0
                ? ` (+${Math.round((conditionMultiplier - 1) * 100)}%)`
                : ""}
            </dt>
            <dd>
              {conditionAdjustmentCents > 0
                ? `+${money(conditionAdjustmentCents)}`
                : money(0)}
            </dd>
          </div>
        )}
        {extras.map(extra => (
          <div key={extra.id}>
            <dt>
              {extra.title}
              {quantities[extra.id] > 1 ? ` × ${quantities[extra.id]}` : ""}
            </dt>
            <dd>{money(EXTRA_RATES[extra.id] * quantities[extra.id] * 100)}</dd>
          </div>
        ))}
        <div>
          <dt>Date & time</dt>
          <dd>
            {dateLabel} · {time}
          </dd>
        </div>
      </dl>
      <div className="booking-summary-total">
        <span>
          First cleaning <CircleHelp />
        </span>
        <strong>{money(total)}</strong>
      </div>
      {futureTotal !== null && (
        <div className="booking-summary-recurring">
          <span>
            {frequencyLabel} after visit one
            <small>
              Future visits exclude first-visit extras and condition adjustment
            </small>
          </span>
          <strong>
            {money(futureTotal)}
            <small>/visit</small>
          </strong>
        </div>
      )}
      <div className="booking-summary-guarantee">
        <ShieldCheck />
        <span>
          <strong>Satisfaction guaranteed</strong>
          <small>
            Not happy? We’ll make it right. Our team is committed to your
            satisfaction.
          </small>
        </span>
      </div>
    </div>
  );
}
function BookingSuccess({
  name,
  service,
  bedrooms,
  bathrooms,
  dateLabel,
  time,
  total,
  futureTotal,
  frequencyLabel,
  cardLabel,
}: {
  name: string;
  service: string;
  bedrooms: number;
  bathrooms: number;
  dateLabel: string;
  time: string;
  total: number;
  futureTotal: number | null;
  frequencyLabel: string;
  cardLabel: string;
}) {
  const homeDetails = `${bedrooms === 0 ? "Studio" : `${bedrooms} bedrooms`} · ${bathrooms} bathrooms`;

  return (
    <main className="literal-book-page-six">
      <div className="literal-book-shell">
        <aside className="literal-book-side" aria-label="Booking progress">
          <a
            className="literal-book-logo"
            href="https://maidsinblack.com/"
            aria-label="Visit Maids in Black"
          >
            MAIDS <span>IN BLACK</span>
            <div className="literal-book-subbrand">SNAPCLEAN</div>
          </a>
          <div className="literal-book-brand-intro">
            <span className="literal-book-accent-line" />
            <p className="literal-book-promise">
              A clean home, <em>without the hassle.</em>
            </p>
            <p className="literal-book-support">
              Your booking is confirmed. We&apos;ll take it from here.
            </p>
          </div>
          <div className="literal-book-stepnav">
            {[
              "Your home",
              "Cleaning details",
              "Your quote",
              "Schedule",
              "Checkout",
              "Confirmation",
            ].map((label, index) => (
              <div
                className={`literal-book-navitem${index === 5 ? " active" : " done"}`}
                key={label}
              >
                <span className="literal-book-num">✓</span>
                {label}
              </div>
            ))}
          </div>
        </aside>

        <section className="literal-book-main">
          <div className="literal-book-top">
            <span>BOOKING CONFIRMED</span>
            <span className="literal-book-complete-pill">
              <Check aria-hidden="true" /> All set
            </span>
          </div>

          <section className="literal-book-thankyou">
            <div className="literal-book-celebrate-art" aria-hidden="true">
              <span>✦</span>
              <span>✳</span>
              <span>✦</span>
              <span>✧</span>
              <div>
                <Check />
              </div>
            </div>
            <div className="literal-book-eyebrow">YOU&apos;RE ALL SET</div>
            <h1>
              Let the clean begin<span>.</span>
            </h1>
            <p className="literal-book-thankyou-lead">
              A fresh home is on the horizon. Here&apos;s everything you need to
              know about your cleaning.
            </p>

            <section className="literal-book-thankyou-recap">
              <div>
                <small>YOUR CLEANING</small>
                <strong>{service}</strong>
                <span>{homeDetails}</span>
              </div>
              <div>
                <small>YOUR PREFERRED ARRIVAL</small>
                <strong>{dateLabel}</strong>
                <span>{time}</span>
              </div>
              <div>
                <small>BOOKING TOTAL</small>
                <strong>{money(total)}</strong>
                <span>{cardLabel || "Card securely on file"}</span>
              </div>
            </section>

            {futureTotal !== null && (
              <section className="literal-book-thankyou-recurring">
                <span>{frequencyLabel} visits after your first cleaning</span>
                <strong>{money(futureTotal)}/visit</strong>
              </section>
            )}

            <section className="literal-book-thankyou-next">
              <div className="literal-book-thankyou-heading">
                <span className="literal-book-eyebrow">THE GOOD PART</span>
                <h2>What happens next?</h2>
              </div>
              <div className="literal-book-next-steps">
                <div className="literal-book-next-step">
                  <span>
                    <MessageCircle aria-hidden="true" />
                  </span>
                  <div>
                    <b>1. Confirmation details</b>
                    <p>
                      We&apos;ll text your appointment details and email your
                      confirmation and receipt.
                    </p>
                  </div>
                </div>
                <div className="literal-book-next-step">
                  <span>
                    <House aria-hidden="true" />
                  </span>
                  <div>
                    <b>2. Get your home ready</b>
                    <p>
                      Put away valuables and clear access to the areas
                      you&apos;d like cleaned. We&apos;ll bring the cleaning
                      supplies.
                    </p>
                  </div>
                </div>
                <div className="literal-book-next-step">
                  <span>
                    <Sparkles aria-hidden="true" />
                  </span>
                  <div>
                    <b>3. We&apos;ll take it from here</b>
                    <p>
                      Your team will follow up about your requested arrival
                      window before the appointment.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <a className="literal-book-secondary" href="/book">
              Start another booking <ArrowRight aria-hidden="true" />
            </a>
            <p className="literal-book-powered-final">Powered by Baseboard</p>
          </section>
        </section>
      </div>
    </main>
  );
}
