/**
 * HiringStatus — public magic-link page for applicants to track their application.
 * Route: /hiring-status/:token
 */
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Circle, Clock, Loader2, AlertCircle, ArrowRight, Video, Users, Shield, ClipboardCheck, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Stage ordering & metadata ────────────────────────────────────────────────

type Stage =
  | "APPLIED"
  | "INTERVIEW_LINK_SENT"
  | "INTERVIEW_LINK_DONE"
  | "REAL_INTERVIEW"
  | "BACKGROUND_CHECK"
  | "PAID_TEST_CLEAN"
  | "ONBOARDING"
  | "REJECTED"
  | "ARCHIVED";

interface StepDef {
  key: Stage | Stage[];
  label: string;
  sublabel: string;
  icon: React.ReactNode;
}

const STEPS: StepDef[] = [
  {
    key: "APPLIED",
    label: "Application submitted",
    sublabel: "We received your application",
    icon: <ClipboardCheck className="w-5 h-5" />,
  },
  {
    key: ["INTERVIEW_LINK_SENT", "INTERVIEW_LINK_DONE"],
    label: "AI interview",
    sublabel: "2-minute voice screening",
    icon: <Video className="w-5 h-5" />,
  },
  {
    key: "REAL_INTERVIEW",
    label: "Real interview",
    sublabel: "Video call with our team",
    icon: <Users className="w-5 h-5" />,
  },
  {
    key: "BACKGROUND_CHECK",
    label: "Background check",
    sublabel: "Identity & background verification",
    icon: <Shield className="w-5 h-5" />,
  },
  {
    key: "PAID_TEST_CLEAN",
    label: "Paid test clean",
    sublabel: "Hands-on skills assessment",
    icon: <CheckCircle2 className="w-5 h-5" />,
  },
  {
    key: "ONBOARDING",
    label: "Onboarding",
    sublabel: "Welcome to the team!",
    icon: <GraduationCap className="w-5 h-5" />,
  },
];

// Map each DB stage to a step index (0-based)
const STAGE_TO_STEP: Record<Stage, number> = {
  APPLIED: 0,
  INTERVIEW_LINK_SENT: 1,
  INTERVIEW_LINK_DONE: 1,
  REAL_INTERVIEW: 2,
  BACKGROUND_CHECK: 3,
  PAID_TEST_CLEAN: 4,
  ONBOARDING: 5,
  REJECTED: -1,
  ARCHIVED: -1,
};

// ─── CTA panel content per stage ─────────────────────────────────────────────

interface CtaContent {
  title: string;
  body: string;
  buttonLabel?: string;
  buttonHref?: string;
  color: string;
}

function getCtaContent(stage: Stage, interviewLink: string, hasCompletedInterview: boolean): CtaContent {
  switch (stage) {
    case "APPLIED":
    case "INTERVIEW_LINK_SENT":
      return {
        title: hasCompletedInterview ? "Interview received!" : "Complete your AI interview",
        body: hasCompletedInterview
          ? "We've received your AI interview. Our team will review it and reach out within 1–2 business days."
          : "Your next step is a quick 2-minute AI voice interview. It only takes a few minutes and can be done from your phone.",
        buttonLabel: hasCompletedInterview ? undefined : "Start AI interview →",
        buttonHref: hasCompletedInterview ? undefined : interviewLink,
        color: "from-amber-500 to-orange-500",
      };
    case "INTERVIEW_LINK_DONE":
      return {
        title: "Interview received!",
        body: "Great work! We've received your AI interview. Our team will review it and reach out within 1–2 business days to schedule a video call.",
        color: "from-amber-500 to-orange-500",
      };
    case "REAL_INTERVIEW":
      return {
        title: "Real interview scheduled",
        body: "You're moving forward! Check your phone — we'll be in touch soon to confirm your video interview time with our team.",
        color: "from-blue-500 to-indigo-500",
      };
    case "BACKGROUND_CHECK":
      return {
        title: "Background check in progress",
        body: "Almost there! We're running a standard background check. This typically takes 2–3 business days. We'll notify you as soon as it's complete.",
        color: "from-purple-500 to-violet-500",
      };
    case "PAID_TEST_CLEAN":
      return {
        title: "Paid test clean scheduled",
        body: "Exciting news — you've been selected for a paid test clean! This is your chance to show your skills. Check your phone for scheduling details.",
        color: "from-teal-500 to-emerald-500",
      };
    case "ONBOARDING":
      return {
        title: "Welcome to Maids in Black! 🎉",
        body: "Congratulations! You've been hired. Our team will reach out with onboarding details, your first assignment, and everything you need to get started.",
        color: "from-green-500 to-emerald-600",
      };
    case "REJECTED":
      return {
        title: "Application status update",
        body: "Thank you for your interest in Maids in Black. After careful consideration, we've decided to move forward with other candidates at this time. We appreciate your time and wish you the best.",
        color: "from-slate-500 to-slate-600",
      };
    default:
      return {
        title: "Application received",
        body: "Thank you for applying! We'll be in touch soon.",
        color: "from-[#E8735A] to-[#d4614a]",
      };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HiringStatus() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const { data, isLoading, error } = trpc.hiring.getApplicantStatus.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-[#E8735A] mx-auto mb-4" />
          <p className="text-slate-500 text-sm">Loading your application status…</p>
        </div>
      </div>
    );
  }

  // ── Error / invalid token ────────────────────────────────────────────────
  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 max-w-md w-full text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-800 mb-2">Link not found</h1>
          <p className="text-slate-500 text-sm">
            This link may have expired or is invalid. Please check your SMS for the correct link, or{" "}
            <a href="/apply" className="text-[#E8735A] underline">apply again</a>.
          </p>
        </div>
      </div>
    );
  }

  const stage = data.stage as Stage;
  const currentStep = STAGE_TO_STEP[stage] ?? 0;
  const isRejected = stage === "REJECTED" || stage === "ARCHIVED";
  const cta = getCtaContent(stage, data.interviewLink, data.hasCompletedInterview);

  const appliedDate = data.appliedAt
    ? new Date(data.appliedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  const location = [data.city, data.state].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <img
            src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/MIB_logo_final_138df3e8.png"
            alt="Maids in Black"
            className="w-9 h-9 rounded-full object-cover"
          />
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Maids in Black</p>
            <p className="text-sm font-semibold text-slate-800 leading-tight">Application Tracker</p>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Applicant greeting */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">
            Hey {data.firstName}! 👋
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {location && <span>{location} · </span>}
            {appliedDate && <span>Applied {appliedDate}</span>}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          {/* ── Left: Timeline ─────────────────────────────────────────── */}
          <div className="md:col-span-3 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-6">Your hiring journey</h2>

            {isRejected ? (
              <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <AlertCircle className="w-5 h-5 text-slate-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-slate-700">Application closed</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Thank you for applying. We appreciate your interest in joining our team.
                  </p>
                </div>
              </div>
            ) : (
              <ol className="relative">
                {STEPS.map((step, idx) => {
                  const isCompleted = idx < currentStep;
                  const isCurrent = idx === currentStep;
                  const isUpcoming = idx > currentStep;
                  const isLast = idx === STEPS.length - 1;

                  return (
                    <li key={idx} className="relative flex gap-4 pb-6 last:pb-0">
                      {/* Connector line */}
                      {!isLast && (
                        <div
                          className={`absolute left-[18px] top-9 w-0.5 h-full -translate-x-1/2 ${
                            isCompleted ? "bg-[#E8735A]" : "bg-slate-200"
                          }`}
                        />
                      )}

                      {/* Icon */}
                      <div
                        className={`relative z-10 flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                          isCompleted
                            ? "bg-[#E8735A] border-[#E8735A] text-white"
                            : isCurrent
                            ? "bg-white border-[#E8735A] text-[#E8735A] shadow-md"
                            : "bg-white border-slate-200 text-slate-300"
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : isCurrent ? (
                          <Clock className="w-4 h-4" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </div>

                      {/* Text */}
                      <div className="pt-1.5 min-w-0">
                        <p
                          className={`text-sm font-semibold leading-tight ${
                            isCompleted
                              ? "text-slate-700"
                              : isCurrent
                              ? "text-slate-900"
                              : "text-slate-400"
                          }`}
                        >
                          {step.label}
                          {isCurrent && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 uppercase tracking-wide">
                              Current
                            </span>
                          )}
                        </p>
                        <p
                          className={`text-xs mt-0.5 ${
                            isUpcoming ? "text-slate-300" : "text-slate-500"
                          }`}
                        >
                          {step.sublabel}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {/* Progress bar */}
            {!isRejected && (
              <div className="mt-6 pt-5 border-t border-slate-100">
                <div className="flex justify-between text-xs text-slate-500 mb-2">
                  <span>Progress</span>
                  <span className="font-medium text-slate-700">
                    Step {currentStep + 1} of {STEPS.length}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#E8735A] to-[#d4614a] rounded-full transition-all duration-700"
                    style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Right: CTA panel ───────────────────────────────────────── */}
          <div className="md:col-span-2 flex flex-col gap-4">
            {/* Main CTA card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className={`bg-gradient-to-r ${cta.color} px-5 py-4`}>
                <p className="text-white text-xs font-semibold uppercase tracking-wider opacity-80">
                  Next action
                </p>
                <h3 className="text-white text-lg font-bold mt-1 leading-tight">{cta.title}</h3>
              </div>
              <div className="p-5">
                <p className="text-slate-600 text-sm leading-relaxed">{cta.body}</p>
                {cta.buttonLabel && cta.buttonHref && (
                  <a
                    href={cta.buttonHref}
                    className="mt-4 flex items-center justify-center gap-2 w-full bg-[#E8735A] hover:bg-[#d4614a] text-white font-semibold text-sm rounded-xl py-3 transition-colors"
                  >
                    {cta.buttonLabel}
                    <ArrowRight className="w-4 h-4" />
                  </a>
                )}
              </div>
            </div>

            {/* Info card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <h4 className="text-sm font-semibold text-slate-800 mb-3">Questions?</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Text <span className="font-medium text-slate-700">Jade</span> at Maids in Black anytime — just reply to the SMS you received with your status link.
              </p>
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2">
                <img
                  src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/MIB_logo_final_138df3e8.png"
                  alt="MIB"
                  className="w-8 h-8 rounded-full object-cover"
                />
                <div>
                  <p className="text-xs font-semibold text-slate-800">Maids in Black</p>
                  <p className="text-[11px] text-slate-400">Professional Cleaning Services</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
