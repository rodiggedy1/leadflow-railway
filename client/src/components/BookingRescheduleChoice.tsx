import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BookingRescheduleMode } from "@shared/bookingReschedule";

type Props = {
  open: boolean;
  date: string;
  time: string;
  pending: boolean;
  onCancel: () => void;
  onChoose: (mode: BookingRescheduleMode) => void;
};

export function BookingRescheduleChoice({
  open,
  date,
  time,
  pending,
  onCancel,
  onChoose,
}: Props) {
  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!value && !pending) onCancel();
      }}
    >
      <DialogContent
        className="z-[120]"
        onEscapeKeyDown={event => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Reschedule recurring visit</DialogTitle>
          <DialogDescription>
            Move this visit to {date} at {time}. Should subsequent visits shift
            too?
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => onChoose("visit")}
            className="rounded-lg border p-4 text-left disabled:opacity-50"
          >
            <strong className="block">Move only this visit</strong>
            <span className="text-sm text-muted-foreground">
              Keep subsequent visits on their original dates and times.
            </span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onChoose("subsequent")}
            className="rounded-lg border p-4 text-left disabled:opacity-50"
          >
            <strong className="block">Shift subsequent visits</strong>
            <span className="text-sm text-muted-foreground">
              Move subsequent scheduled visits by the same number of calendar
              days and use the new time. Keep the recurring interval.
            </span>
          </button>
        </div>
        <DialogFooter>
          <button type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
