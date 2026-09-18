import BookingsCRMExactLive from "@/pages/BookingsCRMExactLive";
import { useAgentPermissions } from "@/hooks/useAgentPermissions";

export default function NativeBookings() {
  const { agentId } = useAgentPermissions();
  return <BookingsCRMExactLive realtimeEnabled={agentId !== null} />;
}
