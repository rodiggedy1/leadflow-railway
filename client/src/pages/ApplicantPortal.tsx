import { ArrowRight, BriefcaseBusiness, Check, ClipboardCheck, FileCheck2, FileText, GraduationCap, House, Loader2, MessageCircle, ShieldCheck, Sparkles, UserRound, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./applicant-portal-review.css";

type Tone = "complete" | "active" | "waiting";

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
  if (stage === "Application Submitted" && !hasCompletedInterview) return { title: "Complete your short interview", detail: "Tell us about your experience, availability, and the types of home services you enjoy providing.", label: "Start interview", href: interviewPath, tone: "active" as Tone };
  if (stage === "Rejected") return { title: "Your application has been reviewed", detail: "Thank you for the time you invested in applying to join our team.", label: null, href: null, tone: "waiting" as Tone };
  return { title: "Your application is moving forward", detail: "Our hiring team will contact you when there is a next step or detail to confirm.", label: null, href: null, tone: "active" as Tone };
}

export default function ApplicantPortal() {
  const portal = trpc.applicantPortal.me.useQuery(undefined, { retry: false });
  if (portal.isLoading) return <div className="applicant-portal-loading"><Loader2 size={28} className="animate-spin" /> Loading your applicant portal…</div>;
  if (!portal.data) return <div className="applicant-portal-loading"><div><h1>Your applicant link is not available</h1><p>Please open the latest secure link sent to you by text, or return to the application.</p><a href="/apply">Return to application</a></div></div>;
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
        <div className="review-brand"><div className="review-brand__mark">MIB</div><div><strong>Maids in Black</strong><span>HOME SERVICES</span></div></div>
        <nav className="review-nav" aria-label="Applicant portal navigation"><a className="is-active" href="#dashboard"><House size={18} /> Home</a><a href="#application"><FileText size={18} /> Application</a><a href="#teams"><BriefcaseBusiness size={18} /> Service teams</a></nav>
        <div className="review-help-card"><div className="review-help-card__icon"><MessageCircle size={19} /></div><strong>Need help?</strong><p>Reply to the hiring-team text thread and we will help with your application.</p></div>
      </aside>
      <main className="review-main" id="dashboard">
        <header className="review-topbar"><span className="review-mobile-brand">MIB</span><div className="review-applicant"><div className="review-avatar">{`${applicant.firstName[0] ?? ""}${applicant.lastName[0] ?? ""}`.toUpperCase()}</div><span><strong>{applicant.firstName} {applicant.lastName}</strong><small>Applicant portal</small></span></div></header>
        <section className="review-hero-card"><div className="review-welcome-card__heading"><div><span className="review-eyebrow">APPLICANT HOME</span><h1>Welcome, {applicant.firstName}.</h1><p>Here is where you are in the hiring process.</p></div><span className="review-sample-pill">Secure applicant access</span></div>
          <div className="review-progress" aria-label="Application progress">{progress.map((step, index) => { const Icon = step.icon; return <div className={`review-progress__item review-progress__item--${step.tone}`} key={step.label}>{index < progress.length - 1 && <span className="review-progress__line" aria-hidden="true" />}<span className="review-progress__icon"><Icon size={18} /></span><strong>{step.label}</strong><small>{step.detail}</small></div>; })}</div>
          <div className="review-next-step"><div className="review-next-step__icon"><ClipboardCheck size={23} /></div><div className="review-next-step__copy"><span className="review-eyebrow">YOUR NEXT STEP</span><h2>{action.title}</h2><p>{action.detail}</p></div><div className="review-next-step__actions"><span className={`review-status-pill review-status-pill--${action.tone}`}>{action.label ? "Action needed" : applicant.stage}</span>{action.href && action.label && <a className="review-button review-button--dark" href={action.href}>{action.label} <ArrowRight size={16} /></a>}</div></div>
        </section>
        <div className="review-content-grid"><div className="review-primary-column"><section className="review-card" id="teams"><div className="review-section-header"><div><span className="review-eyebrow">YOUR SERVICE QUALIFICATIONS</span><h2>Work you applied to provide</h2><p>These are the home service areas included with your application.</p></div></div><div className="applicant-live-services">{applicant.specialties.length ? applicant.specialties.map((service) => <span key={service}><Check size={15} /> {service}</span>) : <p>No service qualifications were selected.</p>}</div></section><section className="review-card review-path"><div className="review-section-header"><div><span className="review-eyebrow">WHAT HAPPENS NEXT</span><h2>A transparent path forward</h2></div></div><div className="review-path__grid"><div className="review-path__item"><span>01</span><h3>Application review</h3><p>We review your information and service qualifications.</p></div><div className="review-path__item"><span>02</span><h3>Interview</h3><p>Complete the interview when it is your next action.</p></div><div className="review-path__item"><span>03</span><h3>Next steps</h3><p>We will contact you when there is an update to share.</p></div></div></section></div><aside className="review-right-rail"><section className="review-card review-application-card" id="application"><div className="review-section-header review-section-header--tight"><h2>Your application</h2></div><div className="review-application-list">{applicationItems.map((item) => { const Icon = item.icon; return <div className="review-application-row" key={item.label}><span className="review-application-row__icon"><Icon size={16} /></span><strong>{item.label}</strong><span className={`review-status-pill review-status-pill--${item.tone}`}>{item.status}</span></div>; })}</div></section><section className="review-support-card"><div className="review-support-card__icon"><MessageCircle size={20} /></div><div><h2>Questions about your application?</h2><p>Reply to your hiring-team text thread for help.</p></div></section></aside></div>
      </main>
    </div>
  );
}
