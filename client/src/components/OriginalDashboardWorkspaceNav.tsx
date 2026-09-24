import { useEffect, useState } from "react";
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Command, CreditCard, LayoutDashboard, Mail, MessageSquareMore, PanelsTopLeft, PhoneCall, PhoneOutgoing, Receipt, SlidersHorizontal, Star, UserRound, UserRoundCheck, UsersRound, WalletCards } from "lucide-react";
import { useLocation } from "wouter";
import "./original-dashboard-workspace-nav.css";

type DashboardDestination = { label: string; href: string; icon: typeof LayoutDashboard };

const NAV_GROUPS: Array<{ label: string; items: DashboardDestination[] }> = [
  { label: "CRM OVERVIEW", items: [{ label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard }, { label: "Workspace Chat", href: "/admin/command-chat", icon: Command }, { label: "Leads CRM", href: "/admin/leads", icon: LayoutDashboard }, { label: "Bookings CRM", href: "/admin/bookings", icon: CalendarDays }] },
  { label: "CUSTOMER OPERATIONS", items: [{ label: "Customer Profile", href: "/admin/customer-profile", icon: UserRound }, { label: "Schedule", href: "/admin/schedule", icon: CalendarRange }, { label: "Day Board", href: "/admin/day-board", icon: PanelsTopLeft }, { label: "Confirmation Calls", href: "/admin/confirmation-calls", icon: PhoneOutgoing }] },
  { label: "CUSTOMER COMMUNICATION", items: [{ label: "SMS", href: "/admin/sms", icon: MessageSquareMore }, { label: "Emails", href: "/admin/emails", icon: Mail }, { label: "AI Calls", href: "/admin/ai-calls", icon: PhoneCall }] },
  { label: "FINANCE & BILLING", items: [{ label: "Invoices", href: "/admin/invoices", icon: Receipt }, { label: "Payments", href: "/admin/payments", icon: CreditCard }] },
  { label: "TEAM OPERATIONS", items: [{ label: "Team", href: "/admin/team", icon: UsersRound }, { label: "Reviews & Quality", href: "/admin/quality", icon: Star }, { label: "Payroll Summary", href: "/admin/payroll-summary", icon: WalletCards }, { label: "Hiring Admin", href: "/admin/hiring", icon: UserRoundCheck }] },
];

export default function OriginalDashboardWorkspaceNav() {
  const [location] = useLocation();
  const [expanded, setExpanded] = useState(true);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return <aside className={`review-workspace-nav odr-original-nav ${expanded ? "is-expanded" : ""}`} aria-label="Operations workspaces">
    <button type="button" className="review-workspace-toggle" aria-label={expanded ? "Collapse workspace navigation" : "Open workspace navigation"} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span className="review-workspace-mark"><i /><i /><i /><i /></span>
      <span className="review-workspace-toggle-copy"><strong>Workspaces</strong><small>Review only</small></span>
      {expanded ? <ChevronLeft /> : <ChevronRight />}
    </button>
    <nav className="review-workspace-scroll">
      {NAV_GROUPS.map(group => <section className="review-workspace-group" key={group.label}><p>{group.label}</p>{group.items.map(item => {
        const Icon = item.icon;
        const active = location === item.href;
        return <a href={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} key={item.href}><Icon /><span>{item.label}</span></a>;
      })}</section>)}
    </nav>
    <div className="review-workspace-bottom"><a href="/admin/settings" className={location === "/admin/settings" ? "is-active" : ""} aria-current={location === "/admin/settings" ? "page" : undefined}><SlidersHorizontal /><span>Settings</span></a><div className="review-workspace-footer"><span>Static pages</span><small>18 workspaces</small></div></div>
  </aside>;
}
