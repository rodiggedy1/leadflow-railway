import { trpc } from "@/lib/trpc";
import { BookingPaymentCheckout } from "@/components/BookingPaymentCheckout";
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
  X,
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
import { CANONICAL_POST_BOOKING_UPSELLS } from "@shared/canonicalBookingCatalog";
import livingRoom from "@/assets/book-now-review/living-room.jpg";
import kitchen from "@/assets/book-now-review/kitchen.jpg";
import stillLife from "@/assets/book-now-review/still-life.jpg";
import upsellCarpetCleaning from "@/assets/book-now-review/upsell-carpet-cleaning.webp";
import upsellExteriorWindowCleaning from "@/assets/book-now-review/upsell-exterior-window-cleaning.jpeg";
import testimonialCleaner from "@/assets/book-now-review/testimonial-cleaner.webp";
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

const STEPS = [
  ["Cleaning Type", "Choose your service"],
  ["Home Details", "Tell us about your home"],
  ["Home Condition", "Helps us give you the best experience."],
  ["Extras", "Add more (optional)"],
  ["Date & Time", "Pick what works for you"],
  ["Your Info", "Contact details"],
  ["Payment", "Secure and easy"],
  ["Review & Book", "Confirm your cleaning"],
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
const TIME_SLOTS = CANONICAL_TIME_SLOT_LABELS;
const POST_BOOKING_UPSELL_IMAGES = {
  "moving-help": livingRoom,
  "carpet-cleaning": upsellCarpetCleaning,
  "exterior-window-cleaning": upsellExteriorWindowCleaning,
  "junk-removal": livingRoom,
  "furniture-cleaning": kitchen,
  "appliance-cleaning": stillLife,
  "window-cleaning": livingRoom,
  "pet-area-cleaning": kitchen,
} as const;
const POST_BOOKING_UPSELLS = Object.entries(CANONICAL_POST_BOOKING_UPSELLS).map(([id, value]) => ({
  ...value,
  id,
  image: POST_BOOKING_UPSELL_IMAGES[id as keyof typeof POST_BOOKING_UPSELL_IMAGES],
}));
type PostBookingUpsell = (typeof POST_BOOKING_UPSELLS)[number];

function money(cents: number) {
  return `$${Math.round(cents / 100)}`;
}
function getPostBookingUpsellUnitPrice(upsell: PostBookingUpsell) {
  return `From ${money(upsell.unitPriceCents)}/${upsell.quantityLabel.slice(0, -1)}`;
}
function formatPostBookingUpsellQuantity(
  quantity: number,
  quantityLabel: string
) {
  return `${quantity} ${quantity === 1 ? quantityLabel.slice(0, -1) : quantityLabel}`;
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
function firstBookableDate(): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + 1);
  return date;
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
    return new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
  });
  const selectedDate = useMemo(() => new Date(`${requestedLocalDate}T12:00:00`), [requestedLocalDate]);
  const setSelectedDate = (date: Date) => setRequestedLocalDate(isoDate(date));
  const selectedTime = (TIME_SLOTS.find(slot => timeLabelTo24Hour(slot) === requestedLocalTime) ?? TIME_SLOTS[0]);
  const setSelectedTime = (slot: (typeof TIME_SLOTS)[number]) => setRequestedLocalTime(timeLabelTo24Hour(slot));
  const [formError, setFormError] = useState("");
  const [cardOnFile, setCardOnFile] = useState(false);
  const [cardLabel, setCardLabel] = useState("");
  const [funnelRecord, setFunnelRecord] =
    useState<BookingFunnelPublicResult | null>(null);
  const funnelRecordRef = useRef<BookingFunnelPublicResult | null>(null);
  const bookingAttemptIdRef = useRef(createBookingAttemptId());
  const beginFunnelMutation = trpc.bookingFunnel.begin.useMutation();
  const updateFunnelMutation = trpc.bookingFunnel.update.useMutation();
  const reserveFunnelMutation = trpc.bookingFunnel.reserve.useMutation();
  const finalizeBookingMutation = trpc.bookingPayments.finalize.useMutation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step, complete]);

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
    finalizeBookingMutation.isPending;

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
  const reserveBooking = async () => {
    if (fullName.split(/\s+/).filter(Boolean).length < 2) {
      setFormError("Enter your first and last name.");
      return false;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setFormError("Enter a valid phone number.");
      return false;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setFormError("Enter a valid email address.");
      return false;
    }
    if (address.trim().length < 5) {
      setFormError("Enter the complete service address.");
      return false;
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
      return true;
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "We could not save your booking details. Please try again."
      );
      return false;
    }
  };
  const next = async () => {
    if (step === 6) {
      if (await reserveBooking()) setStep(7);
      return;
    }
    if (step === 8) {
      const current = funnelRecordRef.current;
      if (!current || !cardOnFile) {
        setFormError("Add a card before confirming your booking.");
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
      return;
    }
    setStep(current => current + 1);
  };
  const changeExtra = (id: string, delta: number) =>
    setExtras(current => ({
      ...current,
      [id]: Math.max(0, (current[id] ?? 0) + delta),
    }));

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
        funnelRecord={funnelRecord}
      />
    );

  const progressDetails = [
    selectedService.title,
    pricingMode === "hourly"
      ? `${maidCount} maids × ${hourCount} hrs`
      : `${bedrooms === 0 ? "Studio" : `${bedrooms} bed`} · ${bathrooms} bath · ${homeType}`,
    `${condition} · ${CONDITION_COPY[condition - 1]}`,
    selectedExtras.length
      ? `${selectedExtras.length} extras selected`
      : "No extras selected",
    `${dateLabel} · ${selectedTime}`,
    fullName || "Contact details",
    cardOnFile ? "Card securely on file" : "Card required",
    "Confirm your cleaning",
  ];

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
            {STEPS.map(([title, subtitle], index) => {
              const itemStep = index + 1;
              return (
                <li
                  key={title}
                  className={
                    itemStep < step
                      ? "done"
                      : itemStep === step
                        ? "current"
                        : "future"
                  }
                >
                  <span>{itemStep < step ? <Check /> : itemStep}</span>
                  <div>
                    <strong>{title}</strong>
                    <small>
                      {itemStep < step ? progressDetails[index] : subtitle}
                    </small>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="booking-review-secure">
            <ShieldCheck />
            <div>
              <strong>Secure booking</strong>
              <span>Your information is always protected.</span>
            </div>
          </div>
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
                      new Date(date.getFullYear(), date.getMonth(), 1)
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
                    homeServiceBaseTotalCents={priceBreakdown.homeServiceBaseTotalCents}
                    hourlyServiceTotalCents={priceBreakdown.hourlyServiceTotalCents}
                    conditionAdjustmentCents={priceBreakdown.conditionAdjustmentCents}
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
                onClick={() => setStep(current => Math.max(1, current - 1))}
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

function CleaningType({
  selected,
  onSelect,
}: {
  selected: Service;
  onSelect: (service: Service) => void;
}) {
  return (
    <>
      <h1>What can we help you with?</h1>
      <p className="booking-review-lede">
        Choose the type of cleaning that fits your needs.
      </p>
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
  const monthLabel = visibleMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const first = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth(),
    1
  );
  const leading = first.getDay();
  const days = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    0
  ).getDate();
  const earliest = firstBookableDate();
  const earliestMonth = new Date(
    earliest.getFullYear(),
    earliest.getMonth(),
    1
  );
  const previousMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() - 1,
    1
  );
  const nextMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    1
  );
  return (
    <>
      <h1>When works for you?</h1>
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
              const date = new Date(
                visibleMonth.getFullYear(),
                visibleMonth.getMonth(),
                day,
                12
              );
              const unavailable = date < earliest;
              return (
                <button
                  type="button"
                  className={
                    isoDate(date) === isoDate(selectedDate)
                      ? "selected"
                      : unavailable
                        ? "muted"
                        : ""
                  }
                  disabled={unavailable}
                  key={day}
                  onClick={() => onSelectDate(date)}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <div className="booking-review-note">
            <CalendarDays />
            <span>
              <strong>Need something sooner?</strong> Text us at{" "}
              <b>(202) 888-5362</b> — we’ll do our best to help.
            </span>
          </div>
        </section>
        <section className="booking-times">
          <h3>Arrival window</h3>
          {TIME_SLOTS.map(time => (
            <button
              type="button"
              className={selectedTime === time ? "selected" : ""}
              key={time}
              onClick={() => onSelectTime(time)}
            >
              {time}
            </button>
          ))}
        </section>
      </div>
    </>
  );
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
              onChange={event => props.onPhone(event.target.value)}
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
      <h1>Payment</h1>
      <p className="booking-review-lede">
        Add a card to hold your booking. You won’t be charged until after your
        service is completed.
      </p>
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
          <dt>{pricingMode === "hourly" ? "Hourly service" : "Base cleaning"}</dt>
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
  funnelRecord,
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
  funnelRecord: BookingFunnelPublicResult | null;
}) {
  const [selectedUpsell, setSelectedUpsell] =
    useState<PostBookingUpsell | null>(null);
  const [draftQuantity, setDraftQuantity] = useState(1);
  const [addedUpsells, setAddedUpsells] = useState<Record<string, number>>({});
  const [upsellError, setUpsellError] = useState("");
  const addPostBookingUpsellsMutation =
    trpc.bookingPayments.addPostBookingUpsells.useMutation();
  const addedItems = POST_BOOKING_UPSELLS.filter(
    upsell => (addedUpsells[upsell.id] ?? 0) > 0
  );
  const addedServicesTotal = addedItems.reduce(
    (sum, upsell) =>
      sum + upsell.unitPriceCents * (addedUpsells[upsell.id] ?? 0),
    0
  );
  const updatedBookingTotal = total + addedServicesTotal;
  const openQuantityPicker = (upsell: PostBookingUpsell) => {
    setSelectedUpsell(upsell);
    setDraftQuantity(addedUpsells[upsell.id] ?? 1);
  };
  const applyUpsell = async () => {
    if (!selectedUpsell) return;
    if (!funnelRecord) {
      setUpsellError("Your booking session expired. Please contact us to add this service.");
      return;
    }
    const nextUpsells = {
      ...addedUpsells,
      [selectedUpsell.id]: draftQuantity,
    };
    setUpsellError("");
    try {
      await addPostBookingUpsellsMutation.mutateAsync({
        publicFunnelNumber: funnelRecord.publicFunnelNumber,
        mutationToken: funnelRecord.mutationToken,
        upsells: Object.entries(nextUpsells).map(([id, quantity]) => ({ id, quantity })),
      });
      setAddedUpsells(nextUpsells);
      setSelectedUpsell(null);
    } catch (error) {
      setUpsellError(
        error instanceof Error
          ? error.message
          : "We could not add that service. Please try again."
      );
    }
  };
  return (
    <main className="booking-review-page">
      <header className="booking-review-header">
        <a href="/" className="booking-review-brand">
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
      <section className="booking-success-layout">
        <div>
          <section className="booking-success-intro">
            <span>
              <Check />
            </span>
            <div>
              <h1>You’re booked!</h1>
              <p>Thanks for choosing Maids in Black.</p>
              <small>
                <MessageCircle />
                We’ll text your appointment details shortly.
              </small>
              <small>
                <MessageCircle />
                We’ll also email your confirmation and receipt.
              </small>
            </div>
          </section>
          <section className="booking-upsells">
            <div>
              <small>MAKE LIFE EVEN EASIER</small>
              <h2>Need anything else?</h2>
              <p>Add more services and let us take care of it all.</p>
            </div>
            {addedItems.length > 0 && (
              <section className="booking-upsell-added" aria-live="polite">
                <strong>Added to your booking</strong>
                <ul>
                  {addedItems.map(upsell => {
                    const quantity = addedUpsells[upsell.id] ?? 0;
                    return (
                      <li key={upsell.id}>
                        <span>
                          {upsell.title} ·{" "}
                          {formatPostBookingUpsellQuantity(
                            quantity,
                            upsell.quantityLabel
                          )}
                          <small>
                            {money(upsell.unitPriceCents * quantity)}
                          </small>
                        </span>
                        <button
                          type="button"
                          onClick={() => openQuantityPicker(upsell)}
                        >
                          Edit
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="booking-upsell-estimate">
                  <div>
                    <span>Estimated add-ons</span>
                    <strong>{money(addedServicesTotal)}</strong>
                  </div>
                  <div>
                    <span>Updated booking estimate</span>
                    <strong>{money(updatedBookingTotal)}</strong>
                  </div>
                </div>
              </section>
            )}
            <div className="booking-upsell-grid">
              {POST_BOOKING_UPSELLS.map(upsell => {
                const quantity = addedUpsells[upsell.id] ?? 0;
                return (
                  <article key={upsell.id}>
                    <img src={upsell.image} alt="Home service visual" />
                    <div>
                      <strong>{upsell.title}</strong>
                      <p>{upsell.copy}</p>
                      <b>{getPostBookingUpsellUnitPrice(upsell)}</b>
                      <button
                        type="button"
                        onClick={() => openQuantityPicker(upsell)}
                      >
                        {quantity > 0
                          ? `Added · ${formatPostBookingUpsellQuantity(
                              quantity,
                              upsell.quantityLabel
                            )}`
                          : "Add to Booking"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {upsellError && (
              <div className="booking-live-error" role="alert">
                {upsellError}
              </div>
            )}
          </section>
        </div>
        <aside className="booking-success-summary">
          <img src={stillLife} alt="Warm clean home interior" />
          <h2>Booking Details</h2>
          <dl>
            <div>
              <CalendarDays />
              <span>
                {dateLabel}
                <br />
                <small>{time}</small>
              </span>
            </div>
            <div>
              <House />
              <span>
                {bedrooms === 0 ? "Studio" : `${bedrooms} bed`} · {bathrooms}{" "}
                bath
              </span>
            </div>
            <div>
              <Sparkles />
              <span>{service}</span>
            </div>
            <div>
              <UsersRound />
              <span>
                {name}
                <br />
                <small>Booking contact</small>
              </span>
            </div>
            <div>
              <CreditCard />
              <span>{cardLabel || "Card securely on file"}</span>
            </div>
          </dl>
          <div className="booking-success-total">
            <span>First cleaning</span>
            <strong>{money(updatedBookingTotal)}</strong>
          </div>
          {futureTotal !== null && (
            <div className="booking-success-recurring">
              <span>
                {frequencyLabel} future visits
                <small>After your first cleaning</small>
              </span>
              <strong>
                {money(futureTotal)}
                <small>/visit</small>
              </strong>
            </div>
          )}
        </aside>
      </section>
      {selectedUpsell && (
        <div
          className="booking-upsell-modal-backdrop"
          role="presentation"
          onClick={() => setSelectedUpsell(null)}
        >
          <section
            className="booking-upsell-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-upsell-modal-title"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="booking-upsell-modal-close"
              aria-label="Close service quantity picker"
              onClick={() => setSelectedUpsell(null)}
            >
              <X />
            </button>
            <img src={selectedUpsell.image} alt="" />
            <div>
              <span>ADD TO BOOKING</span>
              <h2 id="booking-upsell-modal-title">{selectedUpsell.title}</h2>
              <p>{selectedUpsell.copy}</p>
              <b>{getPostBookingUpsellUnitPrice(selectedUpsell)}</b>
            </div>
            <div className="booking-upsell-quantity">
              <span>How many {selectedUpsell.quantityLabel}?</span>
              <div>
                <button
                  type="button"
                  aria-label={`Reduce ${selectedUpsell.title} quantity`}
                  onClick={() =>
                    setDraftQuantity(quantity => Math.max(1, quantity - 1))
                  }
                  disabled={draftQuantity === 1}
                >
                  <Minus />
                </button>
                <output aria-live="polite">{draftQuantity}</output>
                <button
                  type="button"
                  aria-label={`Increase ${selectedUpsell.title} quantity`}
                  onClick={() => setDraftQuantity(quantity => quantity + 1)}
                >
                  <Plus />
                </button>
              </div>
            </div>
            <button
              type="button"
              className="booking-upsell-modal-apply"
              onClick={applyUpsell}
              disabled={addPostBookingUpsellsMutation.isPending}
            >
              {addPostBookingUpsellsMutation.isPending
                ? "Saving…"
                : addedUpsells[selectedUpsell.id]
                ? `Update estimate · ${money(
                    selectedUpsell.unitPriceCents * draftQuantity
                  )}`
                : `Add to estimate · ${money(
                    selectedUpsell.unitPriceCents * draftQuantity
                  )}`}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
