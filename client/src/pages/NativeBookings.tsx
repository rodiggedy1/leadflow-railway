import AdminPageGuard from "@/components/AdminPageGuard";
import NativeBookingsWorkspace from "@/components/NativeBookingsWorkspace";

export default function NativeBookings() {
  return <AdminPageGuard pageId="bookings"><NativeBookingsWorkspace /></AdminPageGuard>;
}
