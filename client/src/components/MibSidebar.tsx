import {
  BadgeDollarSign,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Headphones,
  LayoutDashboard,
  LineChart,
  MessageCircle,
  PhoneCall,
  Settings,
  WalletCards,
} from "lucide-react";
import "@/pages/mib-home-preview.css";

type MibSidebarItem = "Dashboard" | "Bookings";

const sidebarItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/admin2" },
  { label: "Bookings", icon: CalendarDays, href: "/admin/bookings" },
  { label: "Campaigns", icon: ClipboardCheck, href: "https://quote.maidinblack.com/admin/sms-campaigns" },
  { label: "Team pay", icon: BadgeDollarSign, href: "https://quote.maidinblack.com/admin/team-pay" },
  { label: "Schedule", icon: CalendarDays, href: "https://quote.maidinblack.com/admin/field-management" },
  { label: "Hiring", icon: ClipboardCheck, href: "https://quote.maidinblack.com/admin/hiring" },
  { label: "Messages", icon: MessageCircle, href: "https://quote.maidinblack.com/admin/cs-inbox-2" },
  { label: "Payments", icon: WalletCards, href: "https://quote.maidinblack.com/admin/payments" },
  { label: "Callbacks", icon: PhoneCall, href: "https://quote.maidinblack.com/admin/leads?tab=callbacks" },
  { label: "Performance", icon: LineChart, href: "https://quote.maidinblack.com/admin/performance" },
  { label: "Invoices", icon: FileText, href: "https://quote.maidinblack.com/admin/invoices" },
  { label: "Settings", icon: Settings, href: "https://quote.maidinblack.com/admin/settings" },
] as const;

export default function MibSidebar({ activeItem }: { activeItem: MibSidebarItem }) {
  return (
    <aside className="mib-home-preview__sidebar" aria-label="MIB navigation">
      <div className="mib-home-preview__brand">
        <img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/MIB_logo_final_138df3e8.png" alt="Maids in Black" />
      </div>
      <nav>
        {sidebarItems.map(({ label, icon: Icon, href }) => {
          const active = label === activeItem;
          const className = active ? "active" : "";
          const content = <><Icon /><b>{label}</b></>;

          return <a key={label} href={href} className={className} aria-current={active ? "page" : undefined}>{content}</a>;
        })}
      </nav>
      <div className="mib-home-preview__help">
        <Headphones />
        <strong>Need help?</strong>
        <p>We’re here for you.</p>
        <button type="button" disabled>Contact support</button>
      </div>
    </aside>
  );
}
