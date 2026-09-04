import { CreditCard, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

function verifyAction(message: string): boolean {
  return window.confirm(message);
}

export function PortalRequestPaymentActions({ requestId, totalCents, onPaymentUpdated }: { requestId: number; totalCents: number; onPaymentUpdated: () => void }) {
  const detail = trpc.bookingPaymentAdmin.getForPortalRequest.useQuery({ requestId }, { staleTime: 5_000 });
  const refetch = () => { void detail.refetch(); onPaymentUpdated(); };
  const placeHold = trpc.bookingPaymentAdmin.placePortalRequestHold.useMutation({ onSuccess: refetch });
  const captureHold = trpc.bookingPaymentAdmin.capturePortalRequestHold.useMutation({ onSuccess: refetch });
  const cancelHold = trpc.bookingPaymentAdmin.cancelPortalRequestHold.useMutation({ onSuccess: refetch });
  const charge = trpc.bookingPaymentAdmin.chargePortalRequestSavedCard.useMutation({ onSuccess: refetch });
  const amount = `$${(totalCents / 100).toFixed(0)}`;
  const activeHold = detail.data?.activeHold;
  const pending = placeHold.isPending || captureHold.isPending || cancelHold.isPending || charge.isPending;

  if (detail.isLoading) return <div className="bookings-card-panel missing"><Loader2 className="animate-spin" /><div><strong>Loading payment</strong><p>Checking the selected request card…</p></div></div>;
  if (detail.error || !detail.data) return <div className="bookings-card-panel missing"><CreditCard /><div><strong>Payment not available</strong><p>{detail.error?.message ?? "No saved card was selected for this service request."}</p></div></div>;
  if (detail.data.paymentStatus === "captured") return <div className="space-y-3 rounded-xl border border-[#cfe9df] bg-[#f3fbf7] p-3.5"><div className="flex items-start gap-3"><CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-[#168d61]" /><div><strong className="text-[12px] text-[#2a4539]">{detail.data.cardBrand ?? "Card"} •••• {detail.data.cardLast4}</strong><p className="mt-1 text-[10px] leading-5 text-[#41695a]">{amount} was charged for this service request.</p></div></div></div>;
  return <div className="space-y-3 rounded-xl border border-[#cfe9df] bg-[#f3fbf7] p-3.5"><div className="flex items-start gap-3"><CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-[#168d61]" /><div><strong className="text-[12px] text-[#2a4539]">{detail.data.cardBrand ?? "Card"} •••• {detail.data.cardLast4}</strong><p className="mt-1 text-[10px] leading-5 text-[#41695a]">{activeHold ? `Hold active for ${amount}.` : "This is the card the customer selected for this request. No charge has been made."}</p></div></div>{activeHold ? <div className="grid grid-cols-2 gap-2"><button type="button" disabled={pending} onClick={() => { if (verifyAction(`Capture ${amount} from this service request hold?`)) captureHold.mutate({ requestId, confirmed: true }); }} className="rounded-lg bg-[#168d61] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Capture {amount}</button><button type="button" disabled={pending} onClick={() => { if (verifyAction(`Cancel the ${amount} hold for this service request?`)) cancelHold.mutate({ requestId, confirmed: true }); }} className="rounded-lg border border-[#a5d8c3] bg-white px-3 py-2 text-[10px] font-bold text-[#276b53] disabled:opacity-50">Cancel hold</button></div> : <div className="grid grid-cols-2 gap-2"><button type="button" disabled={pending} onClick={() => { if (verifyAction(`Place a ${amount} hold on the selected saved card for this service request?`)) placeHold.mutate({ requestId, confirmed: true }); }} className="rounded-lg bg-[#168d61] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Place hold</button><button type="button" disabled={pending} onClick={() => { if (verifyAction(`Charge ${amount} to the selected saved card for this service request?`)) charge.mutate({ requestId, confirmed: true }); }} className="rounded-lg border border-[#a5d8c3] bg-white px-3 py-2 text-[10px] font-bold text-[#276b53] disabled:opacity-50">Charge {amount}</button></div>}{(placeHold.error || captureHold.error || cancelHold.error || charge.error) && <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-2 text-[10px] font-semibold text-red-700">{placeHold.error?.message ?? captureHold.error?.message ?? cancelHold.error?.message ?? charge.error?.message}</p>}</div>;
}
