import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  FileCheck2,
  FileText,
  GraduationCap,
  House,
  Loader2,
  Mail,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./applicant-portal-review.css";

type Tone = "complete" | "active" | "waiting";

const serviceTeams = [
  { title: "Home cleaning", detail: "Recurring, deep, and move-in / move-out", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/OMZeVeJTuXKHcklg.png" },
  { title: "Mounting & assembly", detail: "TV mounting, furniture, and picture hanging", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/YbrwIIinneIBHZgg.png" },
  { title: "Handyman & repairs", detail: "Minor home repairs and skilled service help", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/oYjQJpyKIbXSpYen.png" },
  { title: "Painting & trades", detail: "Interior painting, plumbing, and electrical", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/OMZeVeJTuXKHcklg.png" },
  { title: "Outdoor services", detail: "Lawn care and pressure washing", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/ZxpoieFGtNqtUWPJ.png" },
  { title: "Moving & removal", detail: "Moving help and junk removal", image: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663254023424/hbdXlmHSoMTgpjne.png" },
];

const nextSteps = [
  ["01", "Application review", "We check your information and service qualifications."],
  ["02", "Interview", "A short conversation about your experience and availability."],
  ["03", "Offer & onboarding", "Complete the next requirements if there is a mutual fit."],
  ["04", "Start planning", "Confirm training and your first available assignment."],
];

const faqs = [
  "How long does the hiring process take?",
  "Can I apply for more than one service team?",
  "What should I expect during the interview?",
  "How will I hear about next steps?",
];

function StaticButton({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <button type="button" aria-disabled="true" className={dark ? "review-button review-button--dark" : "review-button"}>{children}</button>;
}

function toProgress(stage: string, hasCompletedInterview: boolean) {
  const steps = ["Application Submitted", "AI Interview", "Real Interview", "Background Check", "Paid Test Clean", "Onboarding", "Active"];
  const stageIndex = Math.max(0, steps.indexOf(stage));
  const interviewCurrent = stage === "Application Submitted" && !hasCompletedInterview;
  return [
    { label: "Application", detail: "Received", tone: "complete" as Tone, icon: Check },
    { label: "Review", detail: stageIndex > 0 ? "Completed" : "In progress", tone: stageIndex > 0 ? "complete" as Tone : "active" as Tone, icon: ClipboardCheck },
    { label: "Interview", detail: hasCompletedInterview || stageIndex > 1 ? "Completed" : "Up next", tone: hasCompletedInterview || stageIndex > 1 ? "complete" as Tone : interviewCurrent ? "active" as Tone : "waiting" as Tone, icon: MessageCircle },
    { label: "Onboarding", detail: stageIndex >= 5 ? "In progress" : "When ready", tone: stageIndex >= 5 ? "active" as Tone : "waiting" as Tone, icon: GraduationCap },
    { label: "Start date", detail: stage === "Active" ? "Welcome aboard" : "To be confirmed", tone: stage === "Active" ? "complete" as Tone : "waiting" as Tone, icon: Sparkles },
  ];
}

function nextStep(stage: string, hasCompletedInterview: boolean, interviewPath: string) {
  if (stage === "Application Submitted" && !hasCompletedInterview) {
    return {
      title: "Complete your short interview",
      detail: "Tell us about your experience, availability, and the types of home services you enjoy providing.",
      label: "Start interview",
      href: interviewPath,
      tone: "active" as Tone,
    };
  }
  if (stage === "Rejected") {
    return { title: "Your application has been reviewed", detail: "Thank you for the time you invested in applying to join our team.", label: null, href: null, tone: "waiting" as Tone };
  }
  return { title: "Your application is moving forward", detail: "Our hiring team will contact you when there is a next step or detail to confirm.", label: null, href: null, tone: "active" as Tone };
}

export default function ApplicantPortal() {
  const portal = trpc.applicantPortal.me.useQuery(undefined, { retry: false });

  if (portal.isLoading) {
    return <div className="applicant-portal-loading"><Loader2 size={28} className="animate-spin" /> Loading your applicant portal…</div>;
  }

  if (!portal.data) {
    return <div className="applicant-portal-loading"><div><h1>Your applicant link is not available</h1><p>Please open the latest secure link sent to you by text, or return to the application.</p><a href="/apply">Return to application</a></div></div>;
  }

  const applicant = portal.data;
  const progress = toProgress(applicant.stage, applicant.hasCompletedInterview);
  const action = nextStep(applicant.stage, applicant.hasCompletedInterview, applicant.interviewPath);
  const applicationItems = [
    { label: "Personal information", status: "Completed", tone: "complete" as Tone, icon: UserRound },
    { label: "Service qualifications", status: "Completed", tone: "complete" as Tone, icon: Wrench },
    { label: "Eligibility checks", status: "Completed", tone: "complete" as Tone, icon: ShieldCheck },
    { label: "Interview", status: applicant.hasCompletedInterview ? "Completed" : "Action needed", tone: applicant.hasCompletedInterview ? "complete" as Tone : "active" as Tone, icon: MessageCircle },
    { label: "Offer & onboarding", status: applicant.stage === "Onboarding" || applicant.stage === "Active" ? "In progress" : "Not started", tone: applicant.stage === "Onboarding" || applicant.stage === "Active" ? "active" as Tone : "waiting" as Tone, icon: FileCheck2 },
  ];

  return (
    <div className="applicant-review applicant-live">
      <aside className="review-sidebar">
        <div className="review-brand" aria-label="Maids in Black"><div className="review-brand__mark">MIB</div><div><strong>Maids in Black</strong><span>HOME SERVICES</span></div></div>
        <nav className="review-nav" aria-label="Applicant portal navigation">
          <a className="is-active" href="#dashboard"><House size={18} /> Home</a>
          <a href="#application"><FileText size={18} /> Application</a>
          <a href="#teams"><BriefcaseBusiness size={18} /> Service teams</a>
          <a href="#path"><GraduationCap size={18} /> Training</a>
          <a href="#faqs"><CircleHelp size={18} /> FAQs</a>
          <a href="#support"><MessageCircle size={18} /> Support</a>
        </nav>
        <div className="review-help-card"><div className="review-help-card__icon"><MessageCircle size={19} /></div><strong>Need help?</strong><p>Our hiring team is here when you need them.</p><StaticButton dark>Contact hiring team</StaticButton></div>
      </aside>

      <main className="review-main" id="dashboard">
        <header className="review-topbar"><span className="review-mobile-brand">MIB</span><div className="review-applicant"><div className="review-avatar">{`${applicant.firstName[0] ?? ""}${applicant.lastName[0] ?? ""}`.toUpperCase()}</div><span><strong>{applicant.firstName} {applicant.lastName}</strong><small>Applicant portal</small></span><ChevronDown size={16} /></div></header>

        <section className="review-hero-card" aria-labelledby="applicant-portal-title">
          <div className="review-welcome-card__heading"><div><span className="review-eyebrow">APPLICANT HOME</span><h1 id="applicant-portal-title">Welcome, {applicant.firstName}.</h1><p>Here is where you are in the hiring process.</p></div><span className="review-sample-pill">Secure applicant access</span></div>
          <div className="review-progress" aria-label="Application progress">{progress.map((step, index) => { const Icon = step.icon; return <div className={`review-progress__item review-progress__item--${step.tone}`} key={step.label}>{index < progress.length - 1 && <span className="review-progress__line" aria-hidden="true" />}<span className="review-progress__icon"><Icon size={18} /></span><strong>{step.label}</strong><small>{step.detail}</small></div>; })}</div>
          <div className="review-next-step"><div className="review-next-step__icon"><CalendarDays size={23} /></div><div className="review-next-step__copy"><span className="review-eyebrow">YOUR NEXT STEP</span><h2>{action.title}</h2><p>{action.detail}</p></div><div className="review-next-step__actions"><span className={`review-status-pill review-status-pill--${action.tone}`}>{action.label ? "Action needed" : applicant.stage}</span>{action.href && action.label && <a className="review-button review-button--dark" href={action.href}>{action.label} <ArrowRight size={16} /></a>}</div></div>
        </section>

        <div className="review-content-grid">
          <div className="review-primary-column">
            <section className="review-card" id="teams" aria-labelledby="service-teams-title">
              <div className="review-section-header"><div><span className="review-eyebrow">EXPLORE THE WORK</span><h2 id="service-teams-title">Service teams you can grow with</h2><p>One applicant portal, with opportunities across the home services our customers rely on.</p></div><a href="#application">Your application <ChevronRight size={16} /></a></div>
              <div className="review-service-grid">{serviceTeams.map((team) => <article className="review-service-card" key={team.title}><img className="review-service-card__art" src={team.image} alt="" /><h3>{team.title}</h3><p>{team.detail}</p></article>)}</div>
            </section>

            <section className="review-card review-path" id="path" aria-labelledby="review-path-title">
              <div className="review-section-header"><div><span className="review-eyebrow">WHAT HAPPENS NEXT</span><h2 id="review-path-title">A transparent path forward</h2></div></div>
              <div className="review-path__grid">{nextSteps.map(([number, title, detail]) => <div className="review-path__item" key={number}><span>{number}</span><h3>{title}</h3><p>{detail}</p></div>)}</div>
            </section>

            <section className="review-card review-faqs" id="faqs" aria-labelledby="review-faq-title">
              <div className="review-section-header"><div><span className="review-eyebrow">COMMON QUESTIONS</span><h2 id="review-faq-title">Frequently asked questions</h2></div><a href="#support">All FAQs <ChevronRight size={16} /></a></div>
              <div className="review-faq-list">{faqs.map((faq) => <button type="button" key={faq} aria-disabled="true"><span>{faq}</span><ChevronDown size={17} /></button>)}</div>
            </section>
          </div>

          <aside className="review-right-rail">
            <section className="review-card review-application-card" id="application" aria-labelledby="application-title"><div className="review-section-header review-section-header--tight"><h2 id="application-title">Your application</h2><a href="#application">View <ChevronRight size={16} /></a></div><div className="review-application-list">{applicationItems.map((item) => { const Icon = item.icon; return <div className="review-application-row" key={item.label}><span className="review-application-row__icon"><Icon size={16} /></span><strong>{item.label}</strong><span className={`review-status-pill review-status-pill--${item.tone}`}>{item.status}</span></div>; })}</div></section>
            <section className="review-card review-role-card" aria-labelledby="role-title"><span className="review-eyebrow">THE OPPORTUNITY</span><h2 id="role-title">Built for people who take pride in great service.</h2><p>Choose work that suits your skills, develop new ones, and be supported by a team that values reliable, thoughtful service.</p><ul><li><Check size={15} /> Flexible work options</li><li><Check size={15} /> Clear expectations</li><li><Check size={15} /> Paid training where relevant</li><li><Check size={15} /> Room to grow</li></ul></section>
            <section className="review-support-card" id="support"><div className="review-support-card__icon"><Mail size={20} /></div><div><h2>Still have questions?</h2><p>Our hiring team can help you understand the process.</p></div><StaticButton dark>Contact hiring team</StaticButton></section>
            <section className="review-brand-card" aria-label="Applicant thank-you message"><img className="review-brand-card__art" src="/manus-storage/applicant-portal-thank-you_02640bfe.png" alt="Great people make clean homes possible. Thanks for applying." /></section>
          </aside>
        </div>
      </main>
    </div>
  );
}
