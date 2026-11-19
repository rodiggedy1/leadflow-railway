import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { UpdateNativeBookingManualAmountResult } from "@shared/nativeBookingManualAmounts";

const MAX_AMOUNT_CENTS = 10_000_000;

export function parseNativeBookingAmount(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_AMOUNT_CENTS
    ? cents
    : null;
}

export function formatNativeBookingAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export type NativeBookingAmountSelection = {
  key: string;
  source: string;
  id: number;
  requestedLocalDate: string | null;
  recurrence: string | null;
  firstCleaningTotalCents: number | null;
  futureVisitTotalCents: number | null;
  manualAmountRevision?: number;
};

export function nativeBookingAmountSummary(result: UpdateNativeBookingManualAmountResult): string {
  const selected = result.selectedChanged
    ? `This job's amount was saved as $${formatNativeBookingAmount(result.selectedAmountCents)}.`
    : "This job's amount was not changed.";
  const visits = `${result.changedVisitCount} visit${result.changedVisitCount === 1 ? "" : "s"} changed (${result.changedJobCount} existing job${result.changedJobCount === 1 ? "" : "s"} updated).`;
  const future = result.futureRuleChanged ? " The future-visit amount rule was saved." : "";
  return `${selected} ${visits}${future}`;
}

export function NativeBookingAmountEditor({
  active,
  disabled = false,
  onAmountUpdated,
  onReload,
}: {
  active: NativeBookingAmountSelection;
  disabled?: boolean;
  onAmountUpdated: () => void;
  onReload: () => void | Promise<unknown>;
}) {
  const mutation = trpc.bookings.updateManualAmount.useMutation({ retry: false });
  const identity = JSON.stringify([
    active.key, active.source, active.id, active.requestedLocalDate,
    active.firstCleaningTotalCents, active.manualAmountRevision ?? 0, active.recurrence,
  ]);
  const selection = JSON.stringify([active.key, active.source, active.id, active.requestedLocalDate]);
  const currentIdentity = useRef(identity);
  const selectionVersion = useRef(0);
  if (currentIdentity.current !== identity) {
    currentIdentity.current = identity;
    selectionVersion.current += 1;
  }
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState(() => ({
    identity,
    amount: active.firstCleaningTotalCents === null ? "" : formatNativeBookingAmount(active.firstCleaningTotalCents),
    scope: "visit" as "visit" | "subsequent",
  }));
  const [notice, setNotice] = useState<{ identity: string; selection: string; message: string; error: boolean; reloadRequired: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setDraft({
      identity,
      amount: active.firstCleaningTotalCents === null ? "" : formatNativeBookingAmount(active.firstCleaningTotalCents),
      scope: "visit",
    });
  }, [identity]);
  if (active.source !== "booking") return null;

  const recurring = active.recurrence === "weekly" || active.recurrence === "biweekly" || active.recurrence === "monthly";
  const currentDraft = draft.identity === identity ? draft : {
    identity,
    amount: active.firstCleaningTotalCents === null ? "" : formatNativeBookingAmount(active.firstCleaningTotalCents),
    scope: "visit" as const,
  };
  const amountCents = parseNativeBookingAmount(currentDraft.amount);
  const currentNotice = notice && (notice.error ? notice.identity === identity : notice.selection === selection) ? notice : null;
  const busy = pending || mutation.isPending;
  const unavailable = !active.requestedLocalDate || active.firstCleaningTotalCents === null;
  const save = async () => {
    if (!mounted.current || inFlight.current || busy || disabled || unavailable || currentNotice?.reloadRequired || amountCents === null || currentIdentity.current !== identity) return;
    if (!recurring && currentDraft.scope !== "visit") return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    const submittedVersion = selectionVersion.current;
    try {
      const result = await mutation.mutateAsync({
        bookingId: active.id,
        expectedDate: active.requestedLocalDate!,
        expectedAmountCents: active.firstCleaningTotalCents!,
        expectedRevision: active.manualAmountRevision ?? 0,
        amountCents,
        scope: currentDraft.scope,
        requestId: crypto.randomUUID(),
      });
      // Refresh only through the existing detail/list/jobs callback. Never put an
      // amount into the old details save or apply a mutation response to a row.
      onAmountUpdated();
      if (!mounted.current || currentIdentity.current !== identity || selectionVersion.current !== submittedVersion) return;
      if (result.bookingId !== active.id || result.selectedDate !== active.requestedLocalDate) {
        setNotice({ identity, selection, message: "The amount response did not match this booking. Reload booking and review its current amount.", error: true, reloadRequired: true });
        return;
      }
      setDraft({ ...currentDraft, amount: formatNativeBookingAmount(result.selectedAmountCents) });
      setNotice({ identity, selection, message: nativeBookingAmountSummary(result), error: false, reloadRequired: false });
    } catch (error) {
      if (!mounted.current || currentIdentity.current !== identity || selectionVersion.current !== submittedVersion) return;
      const failure = error as { message?: string; data?: { code?: string } };
      const conflict = failure.data?.code === "CONFLICT";
      setNotice({
        identity,
        selection,
        message: `Amount could not be saved: ${failure.message || "Please try again."}${conflict ? " Reload booking and review the current date and amount before saving again." : ""}`,
        error: true,
        reloadRequired: conflict,
      });
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  const reload = async () => {
    if (!mounted.current || inFlight.current || busy || disabled) return;
    inFlight.current = true;
    setPending(true);
    try {
      await onReload();
      if (mounted.current && currentIdentity.current === identity) setNotice(null);
    } catch {
      // Preserve the conflict and its reload action if authoritative reload fails.
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return (
    <div className="bcr-native-amount-editor" aria-label="Native booking amount">
      <label className="bcr-booking-price-input">
        Final price ($)
        <input
          type="text"
          inputMode="decimal"
          value={currentDraft.amount}
          onChange={event => setDraft({ ...currentDraft, amount: event.target.value })}
          disabled={busy || disabled || unavailable}
          aria-describedby={`booking-amount-hint-${active.id}`}
          aria-invalid={amountCents === null}
        />
      </label>
      <fieldset className="bcr-native-amount-scope" disabled={busy || disabled || unavailable}>
        <legend>Apply amount to</legend>
        <label>
          <input type="radio" name={`booking-amount-scope-${active.id}`} value="visit" checked={currentDraft.scope === "visit"} onChange={() => setDraft({ ...currentDraft, scope: "visit" })} />
          This job only
        </label>
        {recurring && (
          <label>
            <input type="radio" name={`booking-amount-scope-${active.id}`} value="subsequent" checked={currentDraft.scope === "subsequent"} onChange={() => setDraft({ ...currentDraft, scope: "subsequent" })} />
            This and future jobs
          </label>
        )}
      </fieldset>
      <p id={`booking-amount-hint-${active.id}`} className="bcr-editor-hint">
        {currentDraft.scope === "visit"
          ? recurring && active.futureVisitTotalCents !== null
            ? `Only this job. Future visits remain $${formatNativeBookingAmount(active.futureVisitTotalCents)}.`
            : "Only this job. This does not create recurring visits."
          : "Apply from this job forward."}
        {" "}Save amount is separate from extras, company notes, and schedule updates. No payment is charged or refunded.
      </p>
      {amountCents === null && <p className="bcr-editor-hint" role="alert">Enter an amount from $0.00 to $100,000.00 using no more than two decimal places.</p>}
      {unavailable && <p className="bcr-editor-hint" role="alert">Reload booking to load its current date and amount before saving.</p>}
      <button type="button" className="bcr-native-amount-save" disabled={busy || disabled || unavailable || amountCents === null || Boolean(currentNotice?.reloadRequired)} onClick={save}>
        {busy ? "Saving amount…" : "Save amount"}
      </button>
      {currentNotice && <p className="bcr-native-amount-notice" role={currentNotice.error ? "alert" : "status"}>{currentNotice.message}</p>}
      {(currentNotice?.error || unavailable) && (
        <button type="button" className="bcr-native-amount-reload" disabled={busy || disabled} onClick={reload}>
          Reload booking
        </button>
      )}
    </div>
  );
}
