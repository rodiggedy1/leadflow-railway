import AdminPageGuard from "@/components/AdminPageGuard";
import NativeBookingsWorkspace from "@/components/NativeBookingsWorkspace";
import AdminHeader from "@/components/AdminHeader";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";
import { CalendarDays, CircleHelp, CreditCard, House, MessageCircle, Star, UserRound } from "lucide-react";

const visualNavigation = [
  { label: "Home", icon: House },
  { label: "Bookings", icon: CalendarDays, active: true },
  { label: "Messages", icon: MessageCircle, badge: "2" },
  { label: "Payments", icon: CreditCard },
  { label: "My Home", icon: House },
  { label: "Reviews", icon: Star },
  { label: "Account", icon: UserRound },
];

export default function NativeBookings() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  return <AdminPageGuard pageId="bookings"><div className="bookings-leadflow-shell min-h-screen bg-gray-50"><AdminHeader activeTab="bookings" pagePermissions={pagePermissions} isAdmin={isAdmin} /><div className="bookings-reference-frame"><aside className="bookings-reference-sidebar" aria-label="Bookings workspace navigation" data-presentation-only="true"><div className="bookings-reference-brand"><img src="https://d2xsxph8kpxj0f.cloudfront.net/310519663254023424/CAeRhAUjAZoEuxNGm5QbPr/MIB_logo_final_138df3e8.png" alt="Maids in Black" /></div><nav>{visualNavigation.map(({ label, icon: Icon, active, badge }) => <span key={label} className={`bookings-reference-nav-item${active ? " active" : ""}`}><Icon /><b>{label}</b>{badge && <em>{badge}</em>}</span>)}</nav><div className="bookings-reference-help"><CircleHelp /><strong>Need help?</strong><p>We’re here for you.</p><button type="button" disabled>Contact us</button></div></aside><NativeBookingsWorkspace /></div></div></AdminPageGuard>;
}
