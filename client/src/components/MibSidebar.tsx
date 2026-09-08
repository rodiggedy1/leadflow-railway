import {
  CalendarDays,
  Headphones,
  LayoutDashboard,
  LineChart,
  Megaphone,
  MessageCircle,
  Settings,
  Star,
  Users,
  UserRound,
  WalletCards,
} from "lucide-react";
import "@/pages/mib-home-preview.css";

type MibSidebarItem = "Dashboard" | "Bookings";

const sidebarItems = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/admin2" },
  { label: "Bookings", icon: CalendarDays, href: "/admin/bookings" },
  { label: "Customers", icon: UserRound },
  { label: "Teams", icon: Users },
  { label: "Schedule", icon: CalendarDays },
  { label: "Leads", icon: Megaphone },
  { label: "Messages", icon: MessageCircle },
  { label: "Payments", icon: WalletCards },
  { label: "Reviews", icon: Star },
  { label: "Marketing", icon: Megaphone },
  { label: "Reports", icon: LineChart },
  { label: "Settings", icon: Settings },
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

          return href ? (
            <a key={label} href={href} className={className} aria-current={active ? "page" : undefined}>{content}</a>
          ) : (
            <span key={label} className={className} data-presentation-only="true">{content}</span>
          );
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
