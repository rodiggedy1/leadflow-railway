import { CreditCard, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

function verifyAction(message: string): boolean {
  return window.confirm(message);
}

export function PortalRequestPaymentActions({ requestId, totalCents, onPaymentUpdated }: { requestId: number; totalCents: number; onPaymentUpdated: () => void }) {
  const detail = trpc.bookingPaymentAdmin.getForPortalRequest.useQuery({ requestId }, { staleTime: 5_000 });
  const charge = trpc.bookingPaymentAdmin.chargePortalRequestSavedCard.useMutation({ onSuccess: onPaymentUpdated });
  const amount = `$${(totalCents / 100).toFixed(0)}`;

  if (detail.isLoading) return <div className="bookings-card-panel missing"><Loader2 className="animate-spin" /><div><strong>Loading payment</strong><p>Checking the selected request card…</p></div></div>;
  if (detail.error || !detail.data) return <div className="bookings-card-panel missing"><CreditCard /><div><strong>Payment not available</strong><p>{detail.error?.message ?? "No saved card was selected for this service request."}</p></div></div>;
  if (detail.data.paymentStatus === "captured") return <div className="space-y-3 rounded-xl border border-[#cfe9df] bg-[#f3fbf7] p-3.5"><div className="flex items-start gap-3"><CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-[#168d61]" /><div><strong className="text-[12px] text-[#2a4539]">{detail.data.cardBrand ?? "Card"} •••• {detail.data.cardLast4}</strong><p className="mt-1 text-[10px] leading-5 text-[#41695a]">{amount} was charged for this service request.</p></div></div></div>;
  return <div className="space-y-3 rounded-xl border border-[#cfe9df] bg-[#f3fbf7] p-3.5"><div className="flex items-start gap-3"><CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-[#168d61]" /><div><strong className="text-[12px] text-[#2a4539]">{detail.data.cardBrand ?? "Card"} •••• {detail.data.cardLast4}</strong><p className="mt-1 text-[10px] leading-5 text-[#41695a]">This is the card the customer selected for this request. No charge has been made.</p></div></div><button type="button" disabled={charge.isPending} onClick={() => { if (verifyAction(`Charge ${amount} to the selected saved card for this service request?`)) charge.mutate({ requestId, confirmed: true }); }} className="w-full rounded-lg border border-[#a5d8c3] bg-white px-3 py-2 text-[10px] font-bold text-[#276b53] disabled:opacity-50">{charge.isPending ? "Charging…" : `Charge ${amount}`}</button>{charge.error && <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-2 text-[10px] font-semibold text-red-700">{charge.error.message}</p>}</div>;
}
