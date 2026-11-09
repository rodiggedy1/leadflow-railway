import React from "react";
import { Sunrise, Sun, Sunset, Clock, CheckCircle2 } from "lucide-react";
import {
  CANONICAL_TIME_SLOTS,
  CANONICAL_TIME_SLOT_LABELS,
} from "@shared/canonicalBooking";
import {
  useApprovedBookArrival,
  useApprovedBookContext,
  approvedBookExactWindow,
} from "./ApprovedBookContext";
import type { BookingArrivalMode } from "@shared/bookingArrival";
import "./arrival-options.css";

const modes: {
  id: BookingArrivalMode;
  title: string;
  saving?: string;
  detail: string;
  Icon: typeof Sun;
}[] = [
  {
    id: "flexible",
    title: "Flexible",
    saving: "Save 10%",
    detail: "All-day arrival",
    Icon: Sun,
  },
  {
    id: "preferred",
    title: "Preferred",
    saving: "Save 5%",
    detail: "Morning or afternoon",
    Icon: Sunrise,
  },
  {
    id: "exact",
    title: "Short window / Exact",
    detail: "2-hour arrival window",
    Icon: Clock,
  },
];
export default function ArrivalOptions({
  selectedTimeIndex,
}: {
  selectedTimeIndex: number;
}) {
  const arrival = useApprovedBookArrival();
  const { onArrivalChange } = useApprovedBookContext();
  return (
    <div className="br2-arrival-options">
      <div
        className="br2-arrival-modes"
        role="radiogroup"
        aria-label="Arrival preference"
      >
        {modes.map(({ id, title, saving, detail, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-label={
              id === "exact" ? "Short window / Exact" : `${title} — ${saving}`
            }
            aria-checked={arrival.mode === id}
            className={`br2-arrival-mode${arrival.mode === id ? " is-selected" : ""}`}
            onClick={() =>
              onArrivalChange(
                id,
                id === "preferred" ? (arrival.period ?? "morning") : undefined,
                CANONICAL_TIME_SLOTS[selectedTimeIndex]
              )
            }
          >
            <Icon />
            <span className="br2-arrival-mode-title">{title}</span>
            {saving && <span className="br2-arrival-saving">{saving}</span>}
            <small>{detail}</small>
          </button>
        ))}
      </div>
      <div className="br2-arrival-panel">
        {arrival.mode === "flexible" && (
          <div className="br2-all-day">
            <Sun />
            <div>
              <h4>All-day arrival</h4>
              <strong>8:30 AM – 5:00 PM</strong>
              <p>Give us the full day to arrive and save 10%.</p>
            </div>
          </div>
        )}
        {arrival.mode === "preferred" && (
          <>
            <div className="br2-arrival-panel-heading">
              Choose your preferred part of the day
            </div>
            <div
              className="br2-preferred-grid"
              role="radiogroup"
              aria-label="Preferred arrival period"
            >
              {(["morning", "afternoon"] as const).map(period => {
                const Icon = period === "morning" ? Sunrise : Sun;
                const selected = arrival.period === period;
                return (
                  <button
                    key={period}
                    type="button"
                    role="radio"
                    aria-label={
                      period === "morning"
                        ? "Morning arrival"
                        : "Afternoon arrival"
                    }
                    aria-checked={selected}
                    className={selected ? "is-selected" : ""}
                    onClick={() => onArrivalChange("preferred", period)}
                  >
                    <Icon />
                    <b>{period === "morning" ? "Morning" : "Afternoon"}</b>
                    <small>Save 5% · {period} arrival</small>
                    {selected && <CheckCircle2 className="br2-time-check" />}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {arrival.mode === "exact" && (
          <>
            <div className="br2-arrival-panel-heading">
              Choose the start of your 2-hour arrival window
            </div>
            <div
              className="br2-arrival-grid"
              role="radiogroup"
              aria-label="Preferred arrival time"
            >
              {CANONICAL_TIME_SLOT_LABELS.map((label, index) => {
                const Icon = index < 2 ? Sunrise : index < 4 ? Sun : Sunset;
                const selected = selectedTimeIndex === index;
                return (
                  <button
                    type="button"
                    role="radio"
                    key={label}
                    aria-label={`${label} ${index < 2 ? "Morning" : index < 4 ? "Afternoon" : "Late afternoon"}`}
                    aria-checked={selected}
                    className={selected ? "is-selected" : ""}
                    onClick={() =>
                      onArrivalChange(
                        "exact",
                        undefined,
                        CANONICAL_TIME_SLOTS[index]
                      )
                    }
                  >
                    <Icon />
                    <b>{label}</b>
                    <small>
                      {index < 2
                        ? "Morning"
                        : index < 4
                          ? "Afternoon"
                          : "Late afternoon"}
                    </small>
                    {selected && <CheckCircle2 className="br2-time-check" />}
                  </button>
                );
              })}
            </div>
            <p className="br2-arrival-window-label">
              Arrival between{" "}
              <strong>
                {approvedBookExactWindow(
                  CANONICAL_TIME_SLOTS[selectedTimeIndex]
                )}
              </strong>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
