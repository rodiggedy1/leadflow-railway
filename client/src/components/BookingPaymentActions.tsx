import { CreditCard, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";

function verifyAction(message: string): boolean {
  return window.confirm(message);
}

export function BookingPaymentActions({ bookingId, totalCents, paymentStatus }: { bookingId: number; totalCents: number; paymentStatus: string }) {
  const detail = trpc.bookingPaymentAdmin.getForBooking.useQuery({ bookingId }, { staleTime: 5_000 });
  const utils = trpc.useUtils();
  const refetch = () => { void detail.refetch(); void utils.bookings.get.invalidate({ id: bookingId }); void utils.bookings.list.invalidate(); };
  const placeHold = trpc.bookingPaymentAdmin.placeHold.useMutation({ onSuccess: refetch });
  const captureHold = trpc.bookingPaymentAdmin.captureHold.useMutation({ onSuccess: refetch });
  const cancelHold = trpc.bookingPaymentAdmin.cancelHold.useMutation({ onSuccess: refetch });
  const chargeCard = trpc.bookingPaymentAdmin.chargeSavedCard.useMutation({ onSuccess: refetch });
  const pending = placeHold.isPending || captureHold.isPending || cancelHold.isPending || chargeCard.isPending;
  const profile = detail.data?.profile;
  const activeHold = detail.data?.authorizations.find((authorization) => authorization.status === "authorized");
  const hasCard = paymentStatus === "card_on_file" || Boolean(profile?.stripePaymentMethodId);
  const amount = `$${(totalCents / 100).toFixed(0)}`;
  if (detail.isLoading) return <div className="bookings-card-panel missing"><Loader2 className="animate-spin" /><div><strong>Loading payment</strong><p>Checking saved card status…</p></div></div>;
  if (!hasCard) return <div className="bookings-card-panel missing"><CreditCard /><div><strong>Payment not started</strong><p>Customer has not saved a card yet.</p></div></div>;
  return <div className="space-y-3 rounded-xl border border-[#cfe9df] bg-[#f3fbf7] p-3.5"><div className="flex items-start gap-3"><CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-[#168d61]" /><div><strong className="text-[12px] text-[#2a4539]">{profile?.cardBrand ?? "Card"} •••• {profile?.cardLast4 ?? "saved"}</strong><p className="mt-1 text-[10px] leading-5 text-[#41695a]">{activeHold ? `Hold active for ${amount}.` : "Card is securely on file. No charge has been made."}</p></div></div>{activeHold ? <div className="grid grid-cols-2 gap-2"><button type="button" disabled={pending} onClick={() => { if (verifyAction(`Capture ${amount} from this booking hold?`)) captureHold.mutate({ bookingId, confirmed: true }); }} className="rounded-lg bg-[#168d61] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Capture {amount}</button><button type="button" disabled={pending} onClick={() => { if (verifyAction(`Cancel the ${amount} hold for this booking?`)) cancelHold.mutate({ bookingId, confirmed: true }); }} className="rounded-lg border border-[#a5d8c3] bg-white px-3 py-2 text-[10px] font-bold text-[#276b53] disabled:opacity-50">Cancel hold</button></div> : <div className="grid grid-cols-2 gap-2"><button type="button" disabled={pending} onClick={() => { if (verifyAction(`Place a ${amount} hold on the saved card for this booking?`)) placeHold.mutate({ bookingId, confirmed: true }); }} className="rounded-lg bg-[#168d61] px-3 py-2 text-[10px] font-bold text-white disabled:opacity-50">Place hold</button><button type="button" disabled={pending} onClick={() => { if (verifyAction(`Charge ${amount} to the saved card now?`)) chargeCard.mutate({ bookingId, confirmed: true }); }} className="rounded-lg border border-[#a5d8c3] bg-white px-3 py-2 text-[10px] font-bold text-[#276b53] disabled:opacity-50">Charge {amount}</button></div>}{(placeHold.error || captureHold.error || cancelHold.error || chargeCard.error) && <p role="alert" className="rounded-lg bg-red-50 px-2.5 py-2 text-[10px] font-semibold text-red-700">{placeHold.error?.message ?? captureHold.error?.message ?? cancelHold.error?.message ?? chargeCard.error?.message}</p>}</div>;
}
