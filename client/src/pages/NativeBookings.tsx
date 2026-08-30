import AdminPageGuard from "@/components/AdminPageGuard";
import NativeBookingsWorkspace from "@/components/NativeBookingsWorkspace";
import AdminHeader from "@/components/AdminHeader";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";

export default function NativeBookings() {
  const { pagePermissions, isAdmin } = useAgentPermissions();
  return <AdminPageGuard pageId="bookings"><div className="bookings-leadflow-shell min-h-screen bg-gray-50"><AdminHeader activeTab="bookings" pagePermissions={pagePermissions} isAdmin={isAdmin} /><NativeBookingsWorkspace /></div></AdminPageGuard>;
}
