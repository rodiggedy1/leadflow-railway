import { useEffect, useState, type CSSProperties, type FocusEvent, type MouseEvent } from "react";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Command, CreditCard, LayoutDashboard, Mail, MessageSquareMore, PanelsTopLeft, PhoneCall, PhoneOutgoing, Receipt, SlidersHorizontal, Star, UserRound, UserRoundCheck, UsersRound, WalletCards } from "lucide-react";
import { useLocation } from "wouter";
import "./review-workspace-nav.css";

type ReviewDestination = {
  label: string;
  href: string;
  liveHref?: string;
  icon: typeof LayoutDashboard;
};

const NAV_GROUPS: Array<{ label: string; items: ReviewDestination[] }> = [
  { label: "CRM OVERVIEW", items: [{ label: "Dashboard", href: "/review/operations-dashboard", liveHref: "/admin/dashboard", icon: LayoutDashboard }, { label: "Workspace Chat", href: "/review/command-chat-crm", liveHref: "/admin/command-chat", icon: Command }, { label: "Leads CRM", href: "/review/leads-crm", liveHref: "/admin/leads", icon: LayoutDashboard }, { label: "Bookings CRM", href: "/review/bookings-crm", liveHref: "/admin/bookings", icon: CalendarDays }] },
  {
    label: "CUSTOMER OPERATIONS",
    items: [
      { label: "Customer Profile", href: "/review/customer-profile", liveHref: "/admin/customer-profile", icon: UserRound },
      { label: "Schedule", href: "/review/schedule-crm", liveHref: "/admin/schedule", icon: CalendarRange },
      { label: "Day Board", href: "/review/day-board-crm", liveHref: "/admin/day-board", icon: PanelsTopLeft },
      { label: "Confirmation Calls", href: "/review/confirmation-calls", liveHref: "/admin/confirmation-calls", icon: PhoneOutgoing },
    ],
  },
  {
    label: "CUSTOMER COMMUNICATION",
    items: [
      { label: "SMS", href: "/review/sms", liveHref: "/admin/sms", icon: MessageSquareMore },
      { label: "Emails", href: "/review/emails", liveHref: "/admin/emails", icon: Mail },
      { label: "AI Calls", href: "/review/ai-calls-transcript", liveHref: "/admin/ai-calls", icon: PhoneCall },
    ],
  },
  { label: "FINANCE & BILLING", items: [{ label: "Invoices", href: "/review/invoices", liveHref: "/admin/invoices", icon: Receipt }, { label: "Payments", href: "/review/payments", liveHref: "/admin/payments", icon: CreditCard }] },
  { label: "TEAM OPERATIONS", items: [{ label: "Team", href: "/review/team", liveHref: "/admin/team", icon: UsersRound }, { label: "Reviews & Quality", href: "/review/reviews-quality", icon: Star }, { label: "Payroll Summary", href: "/review/payroll-summary", liveHref: "/admin/payroll-summary", icon: WalletCards }, { label: "Hiring Admin", href: "/review/hiring-admin", liveHref: "/admin/hiring", icon: UserRoundCheck }] },
];

export default function ReviewWorkspaceNav({ activePath }: { activePath?: string }) {
  const [location] = useLocation();
  const defaultOpenRoutes = ["/review/operations-dashboard", "/review/leads-crm", "/review/operations-crm", "/review/settings", "/review/customer-profile", "/review/bookings-crm", "/review/schedule-crm", "/review/day-board-crm", "/review/confirmation-calls", "/review/sms", "/review/emails", "/review/ai-calls-transcript", "/review/invoices", "/review/payments", "/review/team", "/review/reviews-quality", "/review/payroll-summary", "/review/hiring-admin"];
  const routeKey = activePath ?? location;
  const useLiveDestinations = activePath !== undefined;
  const settingsHref = useLiveDestinations ? "/admin/settings" : "/review/settings";
  const [expanded, setExpanded] = useState(() => defaultOpenRoutes.includes(routeKey));
  const [tooltip, setTooltip] = useState<{ label: string; top: number } | null>(null);

  const showBaseboardTooltip = (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, label: string) => {
    if (expanded) return;
    const target = event.currentTarget;
    const navTop = target.closest(".review-workspace-nav")?.getBoundingClientRect().top ?? 0;
    const rect = target.getBoundingClientRect();
    setTooltip({ label, top: rect.top - navTop + rect.height / 2 });
  };
  const hideBaseboardTooltip = () => setTooltip(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const collapseNavigation = () => setExpanded(false);
    window.addEventListener("review-workspace-collapse", collapseNavigation);
    return () => window.removeEventListener("review-workspace-collapse", collapseNavigation);
  }, []);

  return (
    <aside className={`review-workspace-nav ${expanded ? "is-expanded" : ""}`} aria-label="Baseboard navigation" style={tooltip ? { "--baseboard-tooltip-top": `${tooltip.top}px` } as CSSProperties : undefined}>
      <button
        type="button"
        className="review-workspace-toggle"
        aria-label={expanded ? "Collapse Baseboard navigation" : "Open Baseboard navigation"}
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
        onMouseEnter={(event) => showBaseboardTooltip(event, "Baseboard")}
        onMouseLeave={hideBaseboardTooltip}
        onFocus={(event) => showBaseboardTooltip(event, "Baseboard")}
        onBlur={hideBaseboardTooltip}
      >
        <span className="review-workspace-mark"><i /><i /><i /><i /></span>
        <span className="review-workspace-toggle-copy"><strong>Baseboard</strong></span>
        {expanded ? <ChevronLeft /> : <ChevronRight />}
      </button>
      <nav className="review-workspace-scroll">
        {NAV_GROUPS.map(group => (
          <section className="review-workspace-group" key={group.label}>
            <p>{group.label}</p>
            {group.items.map(item => {
              const Icon = item.icon;
              const active = routeKey === item.href;
              const href = useLiveDestinations ? item.liveHref ?? item.href : item.href;
              return (
                <a
                  href={href}
                  className={active ? "is-active" : ""}
                  aria-current={active ? "page" : undefined}
                  key={item.href}
                  onClick={() => setExpanded(defaultOpenRoutes.includes(item.href))}
                  onMouseEnter={(event) => showBaseboardTooltip(event, item.label)}
                  onMouseLeave={hideBaseboardTooltip}
                  onFocus={(event) => showBaseboardTooltip(event, item.label)}
                  onBlur={hideBaseboardTooltip}
                >
                  <Icon />
                  <span>{item.label}</span>
                </a>
              );
            })}
          </section>
        ))}
      </nav>
      <div className="review-workspace-bottom">
        <a href={settingsHref} className={routeKey === "/review/settings" ? "is-active" : ""} aria-current={routeKey === "/review/settings" ? "page" : undefined} onClick={() => setExpanded(true)} onMouseEnter={(event) => showBaseboardTooltip(event, "Settings")} onMouseLeave={hideBaseboardTooltip} onFocus={(event) => showBaseboardTooltip(event, "Settings")} onBlur={hideBaseboardTooltip}>
          <SlidersHorizontal />
          <span>Settings</span>
        </a>
        <div className="review-workspace-footer"><span>Static pages</span><small>18 workspaces</small></div>
      </div>
      {tooltip && <div className="review-workspace-tooltip" role="tooltip">{tooltip.label}</div>}
    </aside>
  );
}
