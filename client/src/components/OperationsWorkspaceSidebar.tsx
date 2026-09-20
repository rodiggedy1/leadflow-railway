import {
  Activity,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Command,
  CreditCard,
  LayoutDashboard,
  Mail,
  MessageSquareMore,
  PanelsTopLeft,
  PhoneCall,
  PhoneOutgoing,
  Receipt,
  Route,
  Settings2,
  Sparkles,
  Star,
  UserRound,
  UserRoundCheck,
  Users,
  UsersRound,
  WalletCards,
  Workflow,
} from "lucide-react";
import "./operations-workspace-sidebar.css";

type WorkspaceDestination = {
  label: string;
  href: string;
  icon: typeof CalendarDays;
};

const WORKSPACE_GROUPS: Array<{ label: string; items: WorkspaceDestination[] }> = [
  {
    label: "CRM OVERVIEW",
    items: [
      { label: "Dashboard", href: "/admin/leads", icon: LayoutDashboard },
      { label: "Workspace Chat", href: "/admin/command-chat", icon: Command },
      { label: "Leads CRM", href: "/admin/leads", icon: LayoutDashboard },
      { label: "Bookings CRM", href: "/admin/bookings", icon: CalendarDays },
    ],
  },
  {
    label: "CUSTOMER OPERATIONS",
    items: [
      { label: "Customer Profile", href: "/admin/customer-profile", icon: UserRound },
      { label: "Schedule", href: "/admin/schedule", icon: CalendarRange },
      { label: "Day Board", href: "/admin/day-board", icon: PanelsTopLeft },
      { label: "Confirmation Calls", href: "/admin/confirmation-calls", icon: PhoneOutgoing },
    ],
  },
  {
    label: "FIELD MANAGEMENT",
    items: [
      { label: "Control Tower", href: "/admin/field-management?tab=tower", icon: Activity },
      { label: "Job Log", href: "/admin/field-management?tab=log", icon: ClipboardList },
      { label: "Workflow", href: "/admin/field-management?tab=workflow", icon: Workflow },
      { label: "AI Concierge", href: "/admin/field-management?tab=concierge", icon: Sparkles },
    ],
  },
  {
    label: "CUSTOMER COMMUNICATION",
    items: [
      { label: "SMS", href: "/admin/sms", icon: MessageSquareMore },
      { label: "Emails", href: "/admin/emails", icon: Mail },
      { label: "AI Calls", href: "/admin/ai-calls", icon: PhoneCall },
    ],
  },
  {
    label: "FINANCE & BILLING",
    items: [
      { label: "Invoices", href: "/admin/invoices", icon: Receipt },
      { label: "Payments", href: "/admin/payments", icon: CreditCard },
    ],
  },
  {
    label: "TEAM OPERATIONS",
    items: [
      { label: "Team", href: "/admin/team-availability", icon: UsersRound },
      { label: "Reviews & Quality", href: "/admin/quality", icon: Star },
      { label: "Payroll Summary", href: "/admin/payroll-summary", icon: WalletCards },
      { label: "Hiring Admin", href: "/admin/hiring", icon: UserRoundCheck },
    ],
  },
];

export default function OperationsWorkspaceSidebar({ activePath }: { activePath: string }) {
  return (
    <aside className="operations-workspace-sidebar" aria-label="Operations workspaces">
      <a className="operations-workspace-brand" href="/admin/day-board">
        <span className="operations-workspace-mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span><strong>Sales CRM</strong><small>Company pipeline</small></span>
      </a>
      <nav className="operations-workspace-links">
        {WORKSPACE_GROUPS.map(group => (
          <section key={group.label}>
            <p>{group.label}</p>
            {group.items.map(item => {
              const Icon = item.icon;
              const active = activePath === item.href;
              return <a href={item.href} className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} key={item.href}><Icon /><span>{item.label}</span></a>;
            })}
          </section>
        ))}
      </nav>
      <div className="operations-workspace-sidebar-footer">
        <a href="/admin/team-availability"><Users /><span>Team availability</span></a>
        <a href="/admin/settings"><Settings2 /><span>Settings</span></a>
      </div>
    </aside>
  );
}
