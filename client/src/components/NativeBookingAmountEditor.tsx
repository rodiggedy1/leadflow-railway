import { useEffect, useRef, useState, type MutableRefObject } from "react";
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

export type NativeBookingAmountSaveState = { identity: string; dirty: boolean; canSave: boolean };
export type NativeBookingAmountSaveControl = NativeBookingAmountSaveState & {
  save: (options?: { deferRefresh?: boolean }) => Promise<boolean>;
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
  saveControlRef,
  onSaveStateChange,
}: {
  active: NativeBookingAmountSelection;
  disabled?: boolean;
  onAmountUpdated: () => void;
  onReload: () => void | Promise<unknown>;
  saveControlRef: MutableRefObject<NativeBookingAmountSaveControl | null>;
  onSaveStateChange: (state: NativeBookingAmountSaveState) => void;
}) {
  const mutation = trpc.bookings.updateManualAmount.useMutation({ retry: false });
  const identity = JSON.stringify([
    active.key, active.source, active.id, active.requestedLocalDate,
    active.firstCleaningTotalCents, active.manualAmountRevision ?? 0, active.recurrence,
  ]);
  const selection = JSON.stringify([active.key, active.source, active.id, active.requestedLocalDate]);
  const currentIdentity = useRef(identity);
  const currentSelection = useRef(selection);
  const currentActive = useRef(active);
  currentActive.current = active;
  const selectionVersion = useRef(0);
  currentIdentity.current = identity;
  if (currentSelection.current !== selection) {
    currentSelection.current = selection;
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
  const [savedDraft, setSavedDraft] = useState<{ identity: string; amount: number; scope: string } | null>(null);
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
  const alreadySaved = savedDraft?.identity === identity && savedDraft.amount === amountCents && savedDraft.scope === currentDraft.scope;
  const acknowledgedAmount = savedDraft?.identity === identity ? savedDraft.amount : active.firstCleaningTotalCents;
  const dirty = !alreadySaved && (amountCents !== acknowledgedAmount || currentDraft.scope === "subsequent");
  const canSave = !busy && !disabled && !unavailable && amountCents !== null && !currentNotice?.reloadRequired;
  const save = async (options?: { deferRefresh?: boolean }): Promise<boolean> => {
    if (active.source !== "booking" || !mounted.current || inFlight.current || !canSave || currentIdentity.current !== identity) return false;
    if (!recurring && currentDraft.scope !== "visit") return false;
    if (!dirty) return true;
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
      // The footer defers refresh until the existing details save finishes.
      // Never put this amount into the legacy extras/notes price field.
      if (!options?.deferRefresh) onAmountUpdated();
      if (!mounted.current || currentSelection.current !== selection || selectionVersion.current !== submittedVersion) return false;
      const refreshedResult = currentActive.current.manualAmountRevision === result.manualAmountRevision &&
        currentActive.current.firstCleaningTotalCents === result.selectedAmountCents && currentActive.current.recurrence === active.recurrence;
      if (currentIdentity.current !== identity && !refreshedResult) return false;
      if (result.bookingId !== active.id || result.selectedDate !== active.requestedLocalDate) {
        setNotice({ identity, selection, message: "The amount response did not match this booking. Reload booking and review its current amount.", error: true, reloadRequired: true });
        return false;
      }
      if (currentIdentity.current !== identity) return true;
      setSavedDraft({ identity, amount: result.selectedAmountCents, scope: currentDraft.scope });
      setDraft({ ...currentDraft, amount: formatNativeBookingAmount(result.selectedAmountCents) });
      setNotice({ identity, selection, message: nativeBookingAmountSummary(result), error: false, reloadRequired: false });
      return true;
    } catch (error) {
      if (!mounted.current || currentIdentity.current !== identity || selectionVersion.current !== submittedVersion) return false;
      const failure = error as { message?: string; data?: { code?: string } };
      const conflict = failure.data?.code === "CONFLICT";
      setNotice({
        identity,
        selection,
        message: `Amount could not be saved: ${failure.message || "Please try again."}${conflict ? " Reload booking and review the current date and amount before saving again." : ""}`,
        error: true,
        reloadRequired: conflict,
      });
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  };
  useEffect(() => {
    const control = { identity, dirty, canSave, save };
    saveControlRef.current = control;
    return () => { if (saveControlRef.current === control) saveControlRef.current = null; };
  });
  useEffect(() => {
    onSaveStateChange({ identity, dirty, canSave });
  }, [identity, dirty, canSave, onSaveStateChange]);
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
  if (active.source !== "booking") return null;
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
        {" "}Use Save booking updates below to save your changes. No payment is charged or refunded.
      </p>
      {amountCents === null && <p className="bcr-editor-hint" role="alert">Enter an amount from $0.00 to $100,000.00 using no more than two decimal places.</p>}
      {unavailable && <p className="bcr-editor-hint" role="alert">Reload booking to load its current date and amount before saving.</p>}
      {currentNotice && <p className="bcr-native-amount-notice" role={currentNotice.error ? "alert" : "status"}>{currentNotice.message}</p>}
      {(currentNotice?.error || unavailable) && (
        <button type="button" className="bcr-native-amount-reload" disabled={busy || disabled} onClick={reload}>
          Reload booking
        </button>
      )}
    </div>
  );
}
