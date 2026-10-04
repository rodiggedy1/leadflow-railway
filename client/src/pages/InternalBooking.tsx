import { useEffect, useMemo, useRef, useState } from "react";
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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PremiumCardSetupForm } from "@/components/BookingPaymentCheckout";
import { useCanonicalBookingFlow } from "@/components/useCanonicalBookingFlow";
import {
  easternCalendarWeekday,
  easternDateIso,
  easternDateIsoFromDate,
  easternDateLabel,
  easternMonthDate,
  easternMonthLabel,
  parseEasternDate,
} from "@shared/easternTime";
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
const STANDARD_TIMES = [
  "08:30",
  "10:30",
  "12:30",
  "14:30",
  "16:30",
  "18:30",
] as const;
const RECOMMENDABLE_STANDARD_TIMES = STANDARD_TIMES.filter(
  value => value !== "18:30"
);
const TIMES = Array.from({ length: 20 }, (_, index) => {
  const totalMinutes = 8 * 60 + 30 + index * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});
const EXTRA_OPTIONS = Object.entries(PUBLIC_BOOKING_PRICED_EXTRAS);
const CONDITION_COPY = CANONICAL_CONDITION_COPY;
const STEPS = [
  "Cleaning type",
  "Home details",
  "Home condition",
  "Extras",
  "Cleaning frequency",
  "Date & time",
  "Customer",
  "Payment method",
  "Final review",
  "Additional services",
];

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
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
const ADDITIONAL_SERVICES: AdditionalService[] = Object.entries(
  CANONICAL_POST_BOOKING_UPSELLS
).map(([id, value]) => ({
  id,
  title: value.label,
  copy: value.quantityUnit,
  unitPriceCents: value.unitPriceCents,
  quantityLabel: value.quantityUnit,
  image:
    ADDITIONAL_SERVICE_IMAGES[id as keyof typeof ADDITIONAL_SERVICE_IMAGES],
}));

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
function timeLabel(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${match[2]} ${suffix}`;
}
function twoHourWindowLabel(value: string | null, fallback: string) {
  if (!value) return fallback;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const endMinutes = Number(match[1]) * 60 + Number(match[2]) + 120;
  const end = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
  return `${timeLabel(value)} to ${timeLabel(end)}`;
}
function formatPhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const TELE_LINES: Record<Step, string[]> = {
  1: [
    "Absolutely, I can help you get a quote and get everything set up. We've cleaned thousands of homes in the DMV area, and we're rated 4.9 stars on Google. Let's make sure we pick the right clean. Is this more of a routine clean, does the home need a deeper reset, or are you moving in or out?",
  ],
  2: [
    "Now let's get a feel for the size of the home so I can build your price. How many bedrooms and bathrooms does it have? Is it a house, apartment, condo, or townhome? Finished basement?",
  ],
  3: [
    "Now I want to make sure the team has enough time. On a scale of 1 to 10, where would you put the home today? A 1 is already very clean, and a 10 needs a serious reset. There's no wrong answer, this just helps us plan properly.",
  ],
  4: [
    "Before we finish the quote, let me make sure we’re covering everything you’d like done.",
    "Would you like to add any extras? Most popular are inside the fridge, inside the oven, inside cabinets, interior windows, laundry, and organizing. Anything there you’d want us to knock out while we’re there?",
    "Thanks for all of that. Let me walk you through the quote and the service options.",
  ],
  5: [
    "",
  ],
  6: [
    "Now let's find a time that works. What day were you hoping to have us come out?",
  ],
  7: [
    "Great. Before I finish this up, let me confirm where we’re sending everything.",
    "What’s your name, and what’s the best mobile number, email address, and service address for the appointment?",
    "We’ll use the mobile number for confirmations, appointment updates, and arrival notifications.",
    "Two quick things so the day goes smoothly. Any pets in the home? And will someone be there, or will we need a key or lockbox code?",
  ],
  8: [
    "Perfect. The last thing we’ll do is put a card on file. Nothing is charged until after your cleaning is completed. It keeps our teams from having to travel with cash and makes payment easy for you once the job is done. Whenever you’re ready, I can take the card number.",
  ],
  9: [
    "Alright, let me make sure I have everything right.",
    "You’re scheduled for the selected cleaning and home details, with the selected arrival window.",
    "Your first cleaning total and any recurring price are shown in the booking summary.",
    "Does everything sound right?",
    "Perfect — I’ll get that booked for you now. You’ll receive your confirmation by text in just a moment.",
  ],
  10: [
    "Your appointment is booked. Before we finish, would you like to add anything else to the service?",
  ],
};
const TELE_STAGE: Record<Step, string> = {
  1: "CLEANING TYPE",
  2: "HOME DETAILS",
  3: "HOME CONDITION",
  4: "EXTRAS",
  5: "CLEANING FREQUENCY",
  6: "DATE & TIME",
  7: "CUSTOMER",
  8: "PAYMENT",
  9: "FINAL REVIEW",
  10: "ADDITIONAL SERVICES",
};
const FAQ_CATEGORIES = [
  {
    name: "Services",
    questions: [
      ["What’s included in a standard cleaning?", "Standard cleaning includes dusting, vacuuming, mopping, bathroom and kitchen cleaning, wiping down surfaces, and general tidying. Inside appliances can be added as an extra."],
      ["What’s included in a deep clean?", "A deep clean includes everything in a standard cleaning, plus hard-to-reach spots, hidden grime, baseboards, window sills, light fixtures, and more detailed scrubbing. Inside appliances are available upon request."],
      ["Do you offer move-in or move-out cleaning?", "Yes. Move-in and move-out cleaning covers the entire property, including floors, walls, baseboards, kitchens, bathrooms, inside cabinets and drawers, and inside appliances."],
      ["Do you bring your own supplies?", "Yes, Maids in Black brings all professional-grade cleaning products and equipment. Customers do not need to provide anything."],
      ["Do you clean inside appliances?", "Not in a standard cleaning, but inside appliances can be added as an extra. Deep cleans and move-in/out cleans include inside appliances."],
    ],
  },
  {
    name: "Pricing",
    questions: [
      ["How is pricing calculated?", "Pricing is based on the number of bedrooms and bathrooms and the type of service. The exact price is provided upfront before booking, with no hidden fees."],
      ["Are there hidden fees?", "No. The exact price is provided upfront before booking, with no hidden fees."],
      ["Do you offer recurring cleaning?", "Yes. Weekly, bi-weekly, and monthly recurring options are available with flexible scheduling."],
      ["Can I get an instant quote?", "Yes. Customers can get an instant quote online at maidsinblack.com or call 202-888-5362."],
    ],
  },
  {
    name: "Scheduling & Policies",
    questions: [
      ["Do you offer same-day service?", "Yes — same-day service is available based on availability. Call 202-888-5362 as soon as possible and we’ll do our best to accommodate you."],
      ["What’s the cancellation policy?", "Cancel or reschedule at least 24 hours in advance with no fee. Late cancellations may be subject to a fee."],
      ["How long does cleaning take?", "Cleaning takes about one hour per bedroom. A two-bedroom home takes roughly two hours."],
      ["Will the same cleaners come each time?", "We do our best to send the same cleaners for recurring services. If a change is necessary, all cleaners are trained to the same high standards."],
      ["Can I reschedule my cleaning?", "Yes. Reschedule at least 24 hours in advance with no penalty. Late changes may be subject to a fee."],
    ],
  },
  {
    name: "Booking & Payment",
    questions: [
      ["Why is a card required?", "A valid credit or debit card is needed to secure the appointment and protect the schedule from last-minute no-shows."],
      ["When am I charged?", "The card is charged only after the cleaning service is completed."],
      ["Do you require a deposit?", "No deposit is required. A valid credit or debit card is needed to secure the appointment."],
      ["What payment methods do you accept?", "Maids in Black accepts all major credit and debit cards. Cash and checks are not accepted."],
      ["Can I book by phone?", "Yes. Call 202-888-5362 to book by phone, or book online at maidsinblack.com for instant confirmation."],
    ],
  },
  {
    name: "What’s Included",
    questions: [
      ["What does standard cleaning cover?", "Standard cleaning covers dusting, vacuuming carpets and rugs, mopping hard floors, bathroom cleaning, kitchen cleaning, wiping down surfaces, and general tidying."],
      ["What does deep cleaning add?", "Deep cleaning adds hard-to-reach spots, hidden grime, baseboards, window sills, light fixtures, and more detailed scrubbing throughout."],
      ["What does move-in/move-out cleaning cover?", "It includes a full deep clean of the property, inside cabinets and drawers, inside appliances, floors, walls, baseboards, kitchens, and bathrooms."],
      ["Are inside ovens and fridges included?", "They are not included in a standard cleaning but can be added as an extra. Deep cleans and move-in/out cleans include inside appliances."],
    ],
  },
  {
    name: "Trust & Company",
    questions: [
      ["Are you bonded and insured?", "Yes, Maids in Black is fully bonded and insured. All cleaners are background checked, and your home and assets are protected."],
      ["Who comes to the home?", "Most homes are serviced by a team of two cleaners. Larger homes receive additional team members as needed."],
      ["Do I need to be home during the cleaning?", "No. Many customers leave a key or provide access instructions so the trusted team can clean while they go about their day."],
      ["What if I’m not satisfied?", "Contact us within 24 hours and we’ll come back and make it right free of charge. If you’re still not satisfied after the re-clean, a full refund is offered."],
      ["What areas do you serve?", "Maids in Black serves the entire DMV area, including Washington DC, Maryland, Virginia, and surrounding areas."],
    ],
  },
] as const;
function BookingTeleprompter({
  step,
  serviceName,
  homeDetail,
  dateText,
  firstTotal,
  futureTotal,
  frequencyText,
  arrivalWindowA,
  arrivalWindowB,
}: {
  step: Step;
  serviceName: string;
  homeDetail: string;
  dateText: string;
  firstTotal: string;
  futureTotal: string | null;
  frequencyText: string;
  arrivalWindowA: string | null;
  arrivalWindowB: string | null;
}) {
  const [mode, setMode] = useState<"full" | "manual" | "auto">("full");
  const [line, setLine] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(18);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [faqMode, setFaqMode] = useState<"answer" | "ask">("answer");
  const [activeFaqCategory, setActiveFaqCategory] = useState(0);
  const [activeFaqQuestion, setActiveFaqQuestion] = useState("");
  const [priceConcernOpen, setPriceConcernOpen] = useState(false);
  const [cardRefusalOpen, setCardRefusalOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const scrollPositionRef = useRef(0);
  const faq = trpc.bookingFunnel.answerFaq.useMutation();
  const lines = useMemo(() => {
    const base = TELE_LINES[step];
    if (step === 6) {
      return [
        base[0],
        `Let me pull up the schedule... Okay, good news, I have two arrival windows open that day. One is ${twoHourWindowLabel(arrivalWindowA, "the recommended window")} and the other is ${twoHourWindowLabel(arrivalWindowB, "the second-best window")}. The team arrives anytime within the window you choose. Which one works better for you?`,
      ];
    }
    if (step === 4) {
      return [
        ...base,
        `Your first cleaning is ${firstTotal}.`,
        futureTotal
          ? `For this ${serviceName} on your ${homeDetail}, if you’d like us to keep the home maintained after this first cleaning, recurring service is 15% less per visit, so it would be ${futureTotal} per visit. Would you like to start as a one-time clean, or should I set you up on a recurring schedule?`
          : `For this ${serviceName} on your ${homeDetail}, if you’d like us to keep the home maintained after this first cleaning, we also offer recurring service at 15% less per visit. Would you like to start as a one-time clean, or should I set you up on a recurring schedule?`,
      ];
    }
    if (step === 5) {
      return [
        `Ok so we have the first cleaning at ${firstTotal}, since that's the full reset where the team gets the home to a great baseline. After that, recurring visits drop 15%, so you'd pay ${futureTotal ?? firstTotal} each time. Most of our clients choose recurring because it keeps the home fresh for less. Would weekly, bi-weekly, or monthly work best for you?`,
      ];
    }
    if (step !== 9) return base;
    return [
      base[0],
      `You’re scheduled for a ${serviceName} for your ${homeDetail} on ${dateText}.`,
      futureTotal
        ? `Your first cleaning is ${firstTotal}, and your ${frequencyText.toLowerCase()} cleanings after that will be ${futureTotal} per visit.`
        : `Your cleaning total is ${firstTotal}.`,
      base[3],
      base[4],
    ];
  }, [
    step,
    serviceName,
    homeDetail,
    dateText,
    firstTotal,
    futureTotal,
    frequencyText,
    arrivalWindowA,
    arrivalWindowB,
  ]);
  const stopAutoPlay = () => {
    setPlaying(false);
    lastFrameRef.current = null;
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  };
  useEffect(() => () => stopAutoPlay(), []);
  const autoFrame = (now: number) => {
    if (!playing || mode !== "auto" || !scrollRef.current) return;
    if (lastFrameRef.current === null) {
      lastFrameRef.current = now;
      scrollPositionRef.current = scrollRef.current.scrollTop;
    }
    const elapsed = Math.min((now - lastFrameRef.current) / 1000, 0.05);
    lastFrameRef.current = now;
    scrollPositionRef.current += speed * elapsed;
    const max = Math.max(
      0,
      scrollRef.current.scrollHeight - scrollRef.current.clientHeight
    );
    if (scrollPositionRef.current >= max) {
      scrollRef.current.scrollTop = max;
      stopAutoPlay();
      return;
    }
    scrollRef.current.scrollTop = scrollPositionRef.current;
    animationRef.current = window.requestAnimationFrame(autoFrame);
  };
  const setTeleMode = (nextMode: "full" | "manual" | "auto") => {
    stopAutoPlay();
    setMode(nextMode);
    setLine(0);
    window.requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
  };
  const askFaq = async () => {
    const trimmed = question.trim();
    if (trimmed.length < 2 || faq.isPending) return;
    const result = await faq.mutateAsync({ question: trimmed });
    setAnswer(result.answer);
    setFaqMode("answer");
  };
  const usePrewrittenFaq = (categoryIndex: number, questionIndex: number) => {
    const item = FAQ_CATEGORIES[categoryIndex]?.questions[questionIndex];
    if (!item) return;
    setActiveFaqCategory(categoryIndex);
    setActiveFaqQuestion(`${categoryIndex}:${questionIndex}`);
    setQuestion(item[0]);
    setAnswer(item[1]);
    setFaqMode("answer");
  };
  return (
    <section className="tele" aria-label="Live call script">
      <div className="telehead">
        <div className="live">
          <span className="dot" />
          <div>
            <div className="ey">
              LIVE CALL · <span>{TELE_STAGE[step]}</span>
            </div>
            <div className="muted">Conversation follows the booking</div>
          </div>
        </div>
        <div className="telecontrols">
          <div className="modeToggle">
            {(["full", "manual", "auto"] as const).map(option => (
              <button
                key={option}
                type="button"
                className={`tiny${mode === option ? " active" : ""}`}
                onClick={() => setTeleMode(option)}
              >
                {option[0].toUpperCase() + option.slice(1)}
              </button>
            ))}
          </div>
          {mode === "auto" && (
            <>
              <button
                type="button"
                className="tiny"
                onClick={() => setTeleMode("manual")}
              >
                ← Manual
              </button>
              <button
                type="button"
                className="tiny"
                onClick={() => {
                  if (playing) stopAutoPlay();
                  else {
                    setPlaying(true);
                    lastFrameRef.current = null;
                    animationRef.current =
                      window.requestAnimationFrame(autoFrame);
                  }
                }}
              >
                {playing ? "Ⅱ Pause" : "▶ Play"}
              </button>
              <div className="speedWrap show">
                <span className="speedLabel">Speed</span>
                <input
                  type="range"
                  min="5"
                  max="45"
                  value={speed}
                  onChange={event => setSpeed(Number(event.target.value))}
                />
                <span className="speedValue">{speed}</span>
              </div>
            </>
          )}
          <button
            type="button"
            className="tiny ask"
            onClick={() => setQuestionOpen(open => !open)}
          >
            ✦ Customer asked a question
          </button>
        </div>
      </div>
      <div
        className={`televiewport${step === 4 ? " televiewport-step-4" : ""}`}
        ref={scrollRef}
      >
        <div
          className={`teleScript ${mode === "full" ? "fullMode" : mode === "manual" ? "manualLine" : ""}`}
        >
          {mode === "full" ? (
            <>
              <div className="fullLabel">
                ✦ CALL SCRIPT · {TELE_STAGE[step]}
              </div>
              {step === 2 ? (
                <>
                  <div className="fullCopy">
                    “{lines[0]} {lines[1]}”
                  </div>
                </>
              ) : step === 4 ? (
                <>
                  <div className="fullCopy">
                    “{lines[0]} {lines[1]}”
                  </div>
                  <div className="quote-after-extras-label">
                    QUOTE AFTER YOU SELECT EXTRAS
                  </div>
                  <div className="fullCopy quote-after-extras-copy">
                    <span className="quote-highlight">{lines[2]}</span>{" "}
                    {lines.slice(3).join(" ")}
                  </div>
                </>
              ) : (
                <div className="fullCopy">
                  “{lines[0]} {lines.slice(1).join(" ")}”
                </div>
              )}
            </>
          ) : mode === "auto" ? (
            lines.map((scriptLine, index) => (
              <p key={`${index}-${scriptLine}`}>{scriptLine}</p>
            ))
          ) : (
            <div className="manualCurrent">{lines[line] ?? lines[0]}</div>
          )}
        </div>
      </div>
      {mode === "manual" && (
        <div className="telemanualbar">
          <div className="telemanualnav">
            <button
              type="button"
              className="tiny"
              disabled={line === 0}
              onClick={() => setLine(current => Math.max(0, current - 1))}
            >
              ↑ Previous
            </button>
            <button
              type="button"
              className="tiny"
              disabled={line >= lines.length - 1}
              onClick={() =>
                setLine(current => Math.min(lines.length - 1, current + 1))
              }
            >
              Next ↓
            </button>
          </div>
          <div className="telemanualcount">
            {line + 1} of {lines.length}
          </div>
          <button
            type="button"
            className="tiny"
            onClick={() => setLine(lines.length - 1)}
          >
            Skip this
          </button>
        </div>
      )}
      {step === 8 && (
        <>
          <button
            type="button"
            className="card-refusal-link"
            onClick={() => setCardRefusalOpen(true)}
          >
            Client doesn’t want to give card
          </button>
          {cardRefusalOpen && (
            <div
              className="card-refusal-shade open"
              onClick={() => setCardRefusalOpen(false)}
            >
              <aside
                className="card-refusal-modal open"
                role="dialog"
                aria-modal="true"
                aria-labelledby="card-refusal-title"
                onClick={event => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="question-close"
                  aria-label="Close card response"
                  onClick={() => setCardRefusalOpen(false)}
                >
                  ×
                </button>
                <div className="ey">✦ CARD RESPONSE</div>
                <h2 id="card-refusal-title">
                  Client doesn’t want to give card
                </h2>
                <p className="card-refusal-copy">
                  <strong>Reassure:</strong> Note, your card number is not
                  stored anywhere, and nothing is charged until after the
                  cleaning is done. Our system is managed securely by Stripe
                  and your card is never stored anywhere. We&apos;ve been paying
                  with cards for over 10 years with zero issues.
                </p>
                <p className="card-refusal-copy">
                  If you&apos;d rather not read it out over the phone, I can text
                  you a secure link to add it yourself. We just need it on
                  file before the appointment is confirmed.
                </p>
                <button
                  type="button"
                  className="btn gold"
                  style={{ marginTop: 18 }}
                  onClick={() => setCardRefusalOpen(false)}
                >
                  Return to call
                </button>
              </aside>
            </div>
          )}
        </>
      )}
      {step === 4 && (
        <>
          <button
            type="button"
            className="price-concern-link"
            onClick={() => setPriceConcernOpen(true)}
          >
            What to say if caller doesn’t like the price
          </button>
          {priceConcernOpen && (
            <div
              className="price-concern-shade"
              role="presentation"
              onClick={() => setPriceConcernOpen(false)}
            >
              <div
                className="price-concern-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="price-concern-title"
                onClick={event => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="price-concern-close"
                  aria-label="Close price concern script"
                  onClick={() => setPriceConcernOpen(false)}
                >
                  ×
                </button>
                <div className="ey">PRICE CONCERN</div>
                <h2 id="price-concern-title">
                  What to say if caller doesn’t like the price
                </h2>
                <p>
                  I totally understand. A few things are baked into that
                  number: the size and condition of the home, the extras you
                  picked, and a fully background-checked, insured team. If
                  you&apos;d like to bring it down, we could remove extras, or
                  recurring service drops the per-visit price by 15%. Which
                  would you rather do?
                </p>
                <div className="price-concern-note">
                  Still didn’t like the price? Offer a 10% first-time discount.
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {questionOpen && (
        <>
          <div
            className="question-shade open"
            onClick={() => setQuestionOpen(false)}
          />
          <aside
            className="question-drawer open"
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-question-title"
          >
            <button
              type="button"
              className="question-close"
              aria-label="Close customer question assistant"
              onClick={() => setQuestionOpen(false)}
            >
              ×
            </button>
            <h2 id="booking-question-title">Ask the FAQ assistant</h2>
            <div className="faq-mode-switch">
              <button
                type="button"
                className={`faq-mode-button${faqMode === "answer" ? " active" : ""}`}
                onClick={() => setFaqMode("answer")}
              >
                Suggested Answer
              </button>
              <button
                type="button"
                className={`faq-mode-button${faqMode === "ask" ? " active" : ""}`}
                onClick={() => setFaqMode("ask")}
              >
                Ask AI
              </button>
            </div>
            {faqMode === "answer" ? (
              <div className="faq-mode-panel">
                <div className="faq-answer-label">SUGGESTED ANSWER</div>
                <div
                  className={`answer-card faq-answer-card${answer ? "" : " empty"}`}
                >
                  {answer || "Select a question below or ask the FAQ assistant."}
                </div>
              </div>
            ) : (
              <div className="faq-mode-panel">
                <div className="label">CUSTOMER QUESTION</div>
                <textarea
                  id="booking-customer-question"
                  className="question-field"
                  value={question}
                  onChange={event => setQuestion(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void askFaq();
                    }
                  }}
                  placeholder="What did the customer ask?"
                />
                <button
                  type="button"
                  className="btn gold ask-button"
                  onClick={() => void askFaq()}
                  disabled={faq.isPending || question.trim().length < 2}
                >
                  {faq.isPending ? "Thinking…" : "✦ Ask AI"}
                </button>
              </div>
            )}
            <div className="faq-shortcuts">
              <div className="faq-shortcuts-title">PREWRITTEN FAQ ANSWERS</div>
              <div>
                <div className="faq-category-label">TOPIC</div>
                <div className="faq-category-list">
                  {FAQ_CATEGORIES.map((category, index) => (
                    <button
                      key={category.name}
                      type="button"
                      className={`faq-category${activeFaqCategory === index ? " active" : ""}`}
                      onClick={() => {
                        setActiveFaqCategory(index);
                        setActiveFaqQuestion("");
                      }}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
                <div className="faq-question-label">
                  QUESTIONS IN {FAQ_CATEGORIES[activeFaqCategory].name.toUpperCase()}
                </div>
                <div className="faq-question-list">
                  {FAQ_CATEGORIES[activeFaqCategory].questions.map(
                    ([prompt], index) => (
                      <button
                        key={prompt}
                        type="button"
                        className={`faq-pill${activeFaqQuestion === `${activeFaqCategory}:${index}` ? " active" : ""}`}
                        onClick={() => usePrewrittenFaq(activeFaqCategory, index)}
                      >
                        {prompt}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 18 }}
              onClick={() => setQuestionOpen(false)}
            >
              ✓ Return to call
            </button>
          </aside>
        </>
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
  } = useCanonicalBookingFlow({ stepCount: 10 });
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
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [manualTime, setManualTime] = useState(false);
  const [timeSelectionTouched, setTimeSelectionTouched] = useState(false);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const standardTimeCountsQuery = trpc.bookings.standardTimeCounts.useQuery(
    { date },
    { enabled: step === 6 && Boolean(date), staleTime: 30_000 }
  );
  const standardTimeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of standardTimeCountsQuery.data ?? []) {
      counts.set(row.time, Number(row.count));
    }
    return counts;
  }, [standardTimeCountsQuery.data]);
  const recommendedStandardTime = useMemo(() => {
    if (
      standardTimeCountsQuery.isLoading ||
      standardTimeCountsQuery.isFetching ||
      standardTimeCountsQuery.isError
    )
      return null;
    return RECOMMENDABLE_STANDARD_TIMES.reduce((best, candidate) =>
      (standardTimeCounts.get(candidate) ?? 0) <
      (standardTimeCounts.get(best) ?? 0)
        ? candidate
        : best
    );
  }, [
    standardTimeCounts,
    standardTimeCountsQuery.isError,
    standardTimeCountsQuery.isFetching,
    standardTimeCountsQuery.isLoading,
  ]);
  const secondBestStandardTime = useMemo(() => {
    if (
      standardTimeCountsQuery.isLoading ||
      standardTimeCountsQuery.isFetching ||
      standardTimeCountsQuery.isError
    )
      return null;
    const ranked = [...RECOMMENDABLE_STANDARD_TIMES].sort((a, b) => {
      const countDifference =
        (standardTimeCounts.get(a) ?? 0) - (standardTimeCounts.get(b) ?? 0);
      return countDifference || RECOMMENDABLE_STANDARD_TIMES.indexOf(a) - RECOMMENDABLE_STANDARD_TIMES.indexOf(b);
    });
    return ranked[1] ?? null;
  }, [
    standardTimeCounts,
    standardTimeCountsQuery.isError,
    standardTimeCountsQuery.isFetching,
    standardTimeCountsQuery.isLoading,
  ]);
  useEffect(() => {
    if (
      step === 6 &&
      !timeSelectionTouched &&
      recommendedStandardTime !== null &&
      time !== recommendedStandardTime
    ) {
      setTime(recommendedStandardTime);
    }
  }, [recommendedStandardTime, setTime, step, time, timeSelectionTouched]);
  useEffect(() => {
    if (time === "11:00") setTime("08:30");
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    mainRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
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
          setStep(9);
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
        setStep(9);
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
    // Contract marker: additionalServices: paymentMethod === "card" ? [] : ...
    createBooking.mutate({
      idempotencyKey,
      paymentMethod,
      companyNotes: notes.trim() || null,
      additionalServices:
        paymentMethod === "card"
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
      step === 7 &&
      (!customerName.trim() ||
        !customerPhone.trim() ||
        !customerEmail.trim() ||
        !address.trim())
    ) {
      setError("Complete the customer information before continuing.");
      return;
    }
    if (step === 7 && paymentMethod === "card" && !createdBooking) {
      setStep(8);
      submit();
      return;
    }
    if (step === 8 && paymentMethod === "card" && !createdBooking) {
      submit();
      return;
    }
    if (
      step === 8 &&
      paymentMethod === "card" &&
      createdBooking &&
      !cardSaved
    ) {
      setError("Save the card before continuing.");
      return;
    }
    if (step === 10) {
      submit();
      return;
    }
    setStep(Math.min(10, step + 1) as Step);
  };
  const back = () => {
    setError(null);
    setStep(Math.max(1, step - 1) as Step);
  };
  const shellClass = `${
    onClose ? "internal-booking-modal-shell" : "internal-booking-shell"
  } review-booking-shell`;

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
  const selectedTimeLabel = time ? timeLabel(time) : "your selected time";
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
      <div className="choices" role="group" aria-label="Cleaning type">
        {SERVICES.map(value => (
          <button
            key={value}
            type="button"
            className={`choice${serviceId === value ? " on" : ""}`}
            onClick={() => setServiceId(value)}
          >
            {value === "moveout"
              ? "Move-out Cleaning"
              : getPublicBookingServiceName(value)}
          </button>
        ))}
      </div>
    ) : step === 2 ? (
      <>
        <div className="compact-selectors">
          <div className="card compact-card">
            <div className="label">Bedrooms</div>
            <div className="big">{bedrooms === 0 ? "Studio" : bedrooms}</div>
            <div className="choices">
              <button
                type="button"
                className="choice"
                disabled={bedrooms <= 0}
                onClick={() => setBedrooms(Math.max(0, bedrooms - 1))}
              >
                −
              </button>
              <button
                type="button"
                className="choice"
                disabled={bedrooms >= 7}
                onClick={() => setBedrooms(Math.min(7, bedrooms + 1))}
              >
                +
              </button>
            </div>
          </div>
          <div className="card compact-card">
            <div className="label">Bathrooms</div>
            <div className="big">{bathrooms}</div>
            <div className="choices">
              <button
                type="button"
                className="choice"
                disabled={bathrooms <= 1}
                onClick={() => setBathrooms(Math.max(1, bathrooms - 1))}
              >
                −
              </button>
              <button
                type="button"
                className="choice"
                disabled={bathrooms >= 5}
                onClick={() => setBathrooms(Math.min(5, bathrooms + 1))}
              >
                +
              </button>
            </div>
          </div>
        </div>
        <div className="section">
          <div className="label">HOME TYPE</div>
          <div className="choices">
            {HOME_TYPES.map(value => (
              <button
                key={value}
                type="button"
                className={`choice${homeType === value ? " on" : ""}`}
                onClick={() => setHomeType(value)}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </>
    ) : step === 3 ? (
      <div className="card">
        <div className="label">
          HOME CONDITION · 1 = LIGHT TOUCH-UP · 10 = FULL RESET
        </div>
        <div className="condition">
          {CONDITION_COPY.map((copy, index) => (
            <button
              key={copy}
              type="button"
              className={`cond${condition === index + 1 ? " on" : ""}`}
              onClick={() => setCondition(index + 1)}
            >
              {index + 1}
            </button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 15 }}>
          {condition} · {CONDITION_COPY[condition - 1]}
        </p>
      </div>
    ) : step === 4 ? (
      <div className="choices" role="group" aria-label="Extras">
        {EXTRA_OPTIONS.map(([id, extra]) => {
          const quantity = extras[id] ?? 0;
          return (
            <div key={id} className={`choice${quantity ? " on" : ""}`}>
              <button
                type="button"
                className="choice-service-toggle"
                onClick={() => setExtra(id, quantity ? -quantity : 1)}
              >
                {extra.label} · ${extra.unitPrice}
                {quantity > 1 ? ` × ${quantity}` : ""}
              </button>
              <span className="quantity">
                <button
                  type="button"
                  disabled={!quantity}
                  onClick={() => setExtra(id, -1)}
                >
                  −
                </button>
                <b>{quantity}</b>
                <button type="button" onClick={() => setExtra(id, 1)}>
                  +
                </button>
              </span>
            </div>
          );
        })}
      </div>
    ) : step === 5 ? (
      <div className="card">
        <div className="label">CLEANING FREQUENCY</div>
        <div className="choices">
          {FREQUENCIES.map(value => (
            <button
              key={value}
              type="button"
              className={`choice${frequency === value ? " on" : ""}`}
              onClick={() => setFrequency(value)}
            >
              <b>{label(value)}</b>
              <br />
              <span className="muted">
                {value === "one-time"
                  ? "Single cleaning"
                  : value === "weekly"
                    ? "Every week"
                    : value === "biweekly"
                      ? "Every 2 weeks"
                      : "Every 4 weeks"}
              </span>
            </button>
          ))}
        </div>
        <p className="muted frequency-note">
          The first cleaning is full price. Recurring pricing applies to
          future visits.
        </p>
      </div>
    ) : step === 6 ? (
      <div className="card page5-schedule-card">
        <div className="label">DATE</div>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="schedule-date-trigger">
              <CalendarDays />
              <span>
                <strong>{dateLabel(date)}</strong>
                <small>
                  Eastern Time · {timeLabel(time)} arrival · choose another date
                  or time
                </small>
              </span>
              <ChevronRight />
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" className="schedule-calendar-popover">
            <Calendar
              mode="single"
              selected={parseEasternDate(date)}
              defaultMonth={parseEasternDate(date)}
              onSelect={nextDate => {
                if (!nextDate) return;
                setTimeSelectionTouched(false);
                setDate(easternDateIsoFromDate(nextDate));
              }}
            />
            <div
              className="schedule-time-options"
              role="group"
              aria-label="Arrival time options"
            >
              <span>CHOOSE AN ARRIVAL TIME</span>
              <div>
                {TIMES.map(value => (
                  <button
                    key={value}
                    type="button"
                    className={time === value ? "selected" : ""}
                    onClick={() => {
                      setTimeSelectionTouched(true);
                      setManualTime(true);
                      setTime(value);
                    }}
                  >
                    {timeLabel(value)}
                  </button>
                ))}
              </div>
            </div>
            <label
              className="manual-time-field schedule-popover-time-field"
              onClick={event => {
                if ((event.target as HTMLElement).tagName !== "INPUT") {
                  try {
                    timeInputRef.current?.showPicker?.();
                  } catch {
                    timeInputRef.current?.focus();
                  }
                }
              }}
            >
              <span>EXACT ARRIVAL TIME · EASTERN TIME</span>
              <input
                ref={timeInputRef}
                type="time"
                min="08:30"
                max="18:00"
                step={1800}
                value={time}
                onChange={event => {
                  setTimeSelectionTouched(true);
                  setManualTime(true);
                  setTime(event.target.value);
                }}
              />
              {time && <small>Selected: {timeLabel(time)}</small>}
            </label>
          </PopoverContent>
        </Popover>
        <div className="label" style={{ marginTop: 17 }}>
          STANDARD ARRIVAL TIMES
        </div>
        <div className="windows standard-time-windows">
          {STANDARD_TIMES.map(value => {
            const count = standardTimeCounts.get(value) ?? 0;
            const recommended = value === recommendedStandardTime;
            return (
              <button
                key={value}
                type="button"
                className={`window${time === value ? " on" : ""}`}
                onClick={() => {
                  setTimeSelectionTouched(true);
                  setManualTime(false);
                  setTime(value);
                }}
              >
                {timeLabel(value)}
                <small>
                  {standardTimeCountsQuery.isLoading
                    ? "Loading schedule…"
                    : standardTimeCountsQuery.isError
                      ? "Schedule counts unavailable"
                      : `${recommended ? "Recommended · lightest schedule · " : ""}${count} ${count === 1 ? "booking" : "bookings"}`}
                </small>
              </button>
            );
          })}
        </div>
      </div>
    ) : step === 7 ? (
      <div className="grid2">
        <div className="card">
          <div className="label">FULL NAME</div>
          <input
            className="field"
            required
            value={customerName}
            onChange={event => setCustomerName(event.target.value)}
            placeholder="Rohan Gilkes"
          />
          <div className="label" style={{ marginTop: 13 }}>
            PHONE
          </div>
          <input
            className="field"
            required
            value={customerPhone}
            onChange={event => setCustomerPhone(formatPhoneNumber(event.target.value))}
            placeholder="302-981-6192"
          />
        </div>
        <div className="card">
          <div className="label">EMAIL</div>
          <input
            className="field"
            required
            type="email"
            value={customerEmail}
            onChange={event => setCustomerEmail(event.target.value)}
            placeholder="customer@example.com"
          />
          <div className="label" style={{ marginTop: 13 }}>
            SERVICE ADDRESS
          </div>
          <input
            className="field"
            required
            value={address}
            onChange={event => setAddress(event.target.value)}
            placeholder="Street, city, state, ZIP"
          />
        </div>
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <div className="label">ACCESS DETAILS / NOTES</div>
          <textarea
            className="field"
            value={notes}
            maxLength={500}
            onChange={event => setNotes(event.target.value)}
            placeholder="Gate code, parking, pets, or anything the team should know"
          />
          <small className="muted">{notes.length}/500</small>
        </div>
      </div>
    ) : step === 8 ? (
      <>
        <div className="choices" role="group" aria-label="Payment method">
          {(["card", "cashapp", "invoice"] as PaymentMethod[]).map(value => (
            <button
              key={value}
              type="button"
              className={`choice${paymentMethod === value ? " on" : ""}`}
              disabled={!!createdBooking}
              onClick={() => setPaymentMethod(value)}
            >
              <b>
                {value === "card"
                  ? "Credit Card"
                  : value === "cashapp"
                    ? "Cash App"
                    : "Check"}
              </b>
              <br />
              <span className="muted">
                {value === "card"
                  ? "Secure card on file · Nothing charged now"
                  : "Collection after service"}
              </span>
            </button>
          ))}
        </div>
        {paymentMethod === "card" &&
        createdBooking &&
        cardClientSecret &&
        cardSetupIntentId ? (
          <div className="card" style={{ marginTop: 15 }}>
            <b>Secure card entry</b>
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
          </div>
        ) : paymentMethod === "card" && createdBooking ? (
          <div className="card" style={{ marginTop: 15 }}>
            Preparing secure card entry…
          </div>
        ) : (
          <div className="card" style={{ marginTop: 15 }}>
            <b>Send secure card link</b>
            <p className="muted">
              The card is securely collected before the appointment is
              confirmed.
            </p>
          </div>
        )}
      </>
    ) : step === 9 ? (
      <div className="card">
        <div className="ey">READY TO BOOK</div>
        <h2>{serviceName}</h2>
        <div className="row">
          <span>Home</span>
          <b>{homeDetail}</b>
        </div>
        <div className="row">
          <span>Arrival window</span>
          <b>{selectedTimeLabel}</b>
        </div>
        <div className="row">
          <span>First cleaning</span>
          <b>{money(pricing.firstCleaningTotalCents)}</b>
        </div>
        <div className="row">
          <span>
            {frequency === "one-time"
              ? "Payment"
              : `${label(frequency)} thereafter`}
          </span>
          <b>
            {frequency === "one-time"
              ? "One-time service"
              : money(
                  pricing.futureVisitTotalCents ??
                    pricing.firstCleaningTotalCents
                )}
          </b>
        </div>
        <div style={{ marginTop: 18 }}>
          <button type="button" className="btn gold" onClick={next}>
            Continue to additional services
          </button>
        </div>
      </div>
    ) : (
      <div className="card">
        <div className="label">OPTIONAL ADDITIONAL SERVICES</div>
        <p className="muted">
          Your appointment is booked. Select anything else you’d like added.
        </p>
        <div className="choices">
          {ADDITIONAL_SERVICES.map(service => {
            const quantity = additionalServices[service.id] ?? 0;
            return (
              <div
                key={service.id}
                className={`choice${quantity ? " on" : ""}`}
              >
                <button
                  type="button"
                  className="choice-service-toggle"
                  onClick={() =>
                    setAdditionalService(service.id, quantity ? -quantity : 1)
                  }
                >
                  {service.title} · {money(service.unitPriceCents)}
                  {quantity ? ` × ${quantity}` : ""}
                </button>
                <span className="quantity">
                  <button
                    type="button"
                    disabled={!quantity}
                    onClick={() => setAdditionalService(service.id, -1)}
                  >
                    −
                  </button>
                  <b>{quantity}</b>
                  <button
                    type="button"
                    onClick={() => setAdditionalService(service.id, 1)}
                  >
                    +
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="btn gold"
          style={{ marginTop: 18 }}
          onClick={submit}
        >
          Save additional services
        </button>
      </div>
    );

  const pageTitles = [
    "What kind of cleaning do they need?",
    "Tell us about the home",
    "How is the home currently maintained?",
    "Anything else while we’re there?",
    "One-time or recurring service?",
    "When should the cleaning happen?",
    "Who are we booking for?",
    "Secure the appointment",
    "Review & create booking",
    "Add anything else after booking",
  ];
  const pageLeads = [
    "Choose the service that best matches what the customer describes.",
    "Capture enough detail to price and schedule the job correctly.",
    "Estimate the amount of buildup so the team gets enough time.",
    "Add services and quantities while you are on the call.",
    "Choose one-time or recurring service before scheduling the appointment.",
    "Select the date and a two-hour arrival window.",
    "Confirm contact details and the service address.",
    "Choose how the customer will pay after service.",
    "Confirm the important details before locking it in.",
    "Offer optional services after the appointment is confirmed.",
  ];
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
      <section className="app review-booking-shell">
        <aside className="left">
          <div className="ey">INTERNAL BOOKING</div>
          <h2>New booking</h2>
          <div className="muted">Guided booking workspace</div>
          <nav className="steps" aria-label="Booking steps">
            {STEPS.map((title, index) => {
              const number = index + 1;
              const reviewTitle =
                number === 7
                  ? "Customer"
                  : number === 9
                    ? "Final review"
                    : title;
              return (
                <button
                  type="button"
                  key={title}
                  className={`step${number === step ? " active" : ""}${number < step ? " done" : ""}`}
                  onClick={() => number <= step && setStep(number as Step)}
                >
                  <span className="num">{number < step ? "✓" : number}</span>
                  {reviewTitle}
                </button>
              );
            })}
          </nav>
        </aside>
        <main ref={mainRef} className="main">
          <BookingTeleprompter
            step={step as Step}
            serviceName={serviceName}
            homeDetail={homeDetail}
            dateText={dateLabel(date)}
            firstTotal={money(
              pricing.firstCleaningTotalCents + additionalServicesTotalCents
            )}
            futureTotal={
              pricing.futureVisitTotalCents === null
                ? null
                : money(
                    pricing.futureVisitTotalCents + additionalServicesTotalCents
                  )
            }
            frequencyText={label(frequency)}
            arrivalWindowA={
              recommendedStandardTime
            }
            arrivalWindowB={
              secondBestStandardTime
            }
          />
          {step !== 4 && (
            <div className={`pagehead pagehead-step-${step}`}>
              <div className="ey">STEP {step} OF 10</div>
              <h1>{pageTitles[step - 1]}</h1>
              <div className="muted">{pageLeads[step - 1]}</div>
            </div>
          )}
          <div className="step-content">{stepContent}</div>
          {error && (
            <div className="form-error error" role="alert">
              {error}
            </div>
          )}
          <footer className="footer">
            <button
              type="button"
              className="btn"
              onClick={back}
              disabled={step === 1 || createBooking.isPending}
            >
              ← Back
            </button>
            <button
              type="button"
              className="btn gold"
              onClick={next}
              disabled={
                createBooking.isPending ||
                startCardSetup.isPending ||
                confirmCardSetup.isPending ||
                updateAdditionalServices.isPending ||
                (step === 8 && paymentMethod === "card" && !!createdBooking)
              }
            >
              {createBooking.isPending || startCardSetup.isPending
                ? "Preparing card…"
                : confirmCardSetup.isPending
                  ? "Saving card…"
                  : updateAdditionalServices.isPending
                    ? "Updating booking…"
                    : step === 10
                      ? "Create booking →"
                      : "Continue →"}
            </button>
          </footer>
        </main>
        <aside className="right">
          <section className="rbox">
            <div className="ey">BOOKING SUMMARY</div>
            <div className="price">
              {money(
                pricing.firstCleaningTotalCents + additionalServicesTotalCents
              )}
            </div>
            <div className="muted">
              {pricing.futureVisitTotalCents === null
                ? "Estimated first cleaning"
                : `${money(pricing.futureVisitTotalCents + additionalServicesTotalCents)} ${label(frequency).toLowerCase()} after first visit`}
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="row">
                <span>Service</span>
                <b>{serviceName}</b>
              </div>
              <div className="row">
                <span>Home</span>
                <b>{homeDetail}</b>
              </div>
              <div className="row">
                <span>Date</span>
                <b>{dateLabel(date)}</b>
              </div>
            </div>
          </section>
          <section className="rbox">
            <div className="ey">BOOKING NOTES</div>
            <textarea
              className="field"
              id="internal-company-notes"
              rows={10}
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Add notes for the cleaning team or internal staff…"
            />
            <div className="muted" style={{ marginTop: 8 }}>
              These notes will stay with the booking.
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
export default InternalBooking;
