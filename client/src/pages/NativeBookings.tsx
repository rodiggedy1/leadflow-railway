import AdminPageGuard from "@/components/AdminPageGuard";
import MibSidebar from "@/components/MibSidebar";
import NativeBookingsWorkspace from "@/components/NativeBookingsWorkspace";

export default function NativeBookings() {
  return <AdminPageGuard pageId="bookings"><div className="bookings-leadflow-shell min-h-screen bg-gray-50"><div className="bookings-reference-frame"><MibSidebar activeItem="Bookings" /><NativeBookingsWorkspace /></div></div></AdminPageGuard>;
}
