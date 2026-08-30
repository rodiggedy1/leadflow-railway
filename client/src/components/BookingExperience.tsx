import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { BookingSurface } from "@shared/booking";
import BookingWidgetConfigPanel from "./BookingWidgetConfigPanel";

export default function BookingExperience({ surface }: { surface: BookingSurface }) {
  const configQuery = trpc.bookings.getPublicWidgetConfig.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  if (configQuery.isLoading) {
    return <div className="grid min-h-[420px] place-items-center bg-[#f5f5f3] text-[#ff684c]"><Loader2 className="h-8 w-8 animate-spin" aria-label="Loading booking experience" /></div>;
  }

  return <BookingWidgetConfigPanel savedValue={JSON.stringify(configQuery.data)} mode="live" surface={surface} />;
}
