import React, {useEffect, useId, useRef, useState} from 'react';
import {CalendarDays, ChevronDown, ChevronLeft, ChevronRight} from 'lucide-react';
import './audit-calendar.css';

// These dates represent calendar days, not instants in the browser's timezone.
const utcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const toIso = (date: Date) => `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
const monthOf = (iso: string) => `${iso.slice(0, 7)}-01`;
const dayNumber = (iso: string) => Number(iso.slice(8, 10));
const fullDate = new Intl.DateTimeFormat('en-US', {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'});
const monthLabel = new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'});
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function addDays(iso: string, count: number) {
  const date = utcDate(iso);
  date.setUTCDate(date.getUTCDate() + count);
  return toIso(date);
}

function addMonths(month: string, count: number) {
  const date = utcDate(monthOf(month));
  date.setUTCMonth(date.getUTCMonth() + count);
  return toIso(date);
}

function daysInMonth(month: string) {
  return dayNumber(addDays(addMonths(month, 1), -1));
}

function dateInMonth(month: string, day: number) {
  return `${month.slice(0, 7)}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`;
}

export default function AuditCalendar({value, min, onChange}: {value: string; min: string; onChange: (iso: string) => void}) {
  const id = useId();
  const popoverId = `${id}-calendar`;
  const titleId = `${id}-title`;
  const monthId = `${id}-month`;
  const helpId = `${id}-help`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef(false);
  const anchor = value && value >= min ? value : min;
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthOf(anchor));
  const [focusedDate, setFocusedDate] = useState(anchor);
  const minMonth = monthOf(min);
  const month = visibleMonth < minMonth ? minMonth : visibleMonth;
  const activeDate = focusedDate >= min && monthOf(focusedDate) === month
    ? focusedDate
    : (month === minMonth ? min : month);

  function close(returnFocus = true) {
    pendingFocus.current = false;
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({preventScroll: true});
  }

  function openCalendar() {
    // Opening always resets navigation, including after clearing the value.
    setVisibleMonth(monthOf(anchor));
    setFocusedDate(anchor);
    pendingFocus.current = true;
    setOpen(true);
  }

  useEffect(() => {
    if (open && pendingFocus.current) {
      pendingFocus.current = false;
      dayRefs.current.get(activeDate)?.focus({preventScroll: true});
    }
  }, [open, month, activeDate]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        // Do not steal focus from the outside control being clicked.
        pendingFocus.current = false;
        setOpen(false);
      }
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        pendingFocus.current = false;
        setOpen(false);
        triggerRef.current?.focus({preventScroll: true});
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function navigateMonth(amount: number) {
    const next = addMonths(month, amount);
    if (next < minMonth) return;
    const nextDate = dateInMonth(next, dayNumber(activeDate));
    setVisibleMonth(next);
    setFocusedDate(nextDate < min ? min : nextDate);
    // Navigation buttons retain focus, allowing repeated month changes.
  }

  function navigateDay(event: React.KeyboardEvent<HTMLButtonElement>, iso: string) {
    let next: string;
    const weekday = utcDate(iso).getUTCDay();
    switch (event.key) {
      case 'ArrowLeft': next = addDays(iso, -1); break;
      case 'ArrowRight': next = addDays(iso, 1); break;
      case 'ArrowUp': next = addDays(iso, -7); break;
      case 'ArrowDown': next = addDays(iso, 7); break;
      case 'Home': next = addDays(iso, -weekday); break;
      case 'End': next = addDays(iso, 6 - weekday); break;
      case 'PageUp': next = dateInMonth(addMonths(iso, -1), dayNumber(iso)); break;
      case 'PageDown': next = dateInMonth(addMonths(iso, 1), dayNumber(iso)); break;
      default: return; // Native button Enter/Space activate the chosen day.
    }
    event.preventDefault();
    if (next < min) next = min;
    pendingFocus.current = true;
    setVisibleMonth(monthOf(next));
    setFocusedDate(next);
  }

  function selectDate(iso: string) {
    if (iso < min) return;
    onChange(iso);
    close();
  }

  const offset = utcDate(month).getUTCDay();
  const totalDays = daysInMonth(month);
  const rows = Array.from({length: Math.ceil((offset + totalDays) / 7)}, (_, row) =>
    Array.from({length: 7}, (_, column) => {
      const day = row * 7 + column - offset + 1;
      return day > 0 && day <= totalDays ? dateInMonth(month, day) : null;
    })
  );

  return <div
    className="br-calendar"
    ref={rootRef}
    onBlur={event => {
      if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(false);
    }}
  >
    <button
      ref={triggerRef}
      type="button"
      className="br-calendar-trigger"
      aria-label="Message date"
      aria-expanded={open}
      aria-controls={popoverId}
      aria-haspopup="dialog"
      onClick={() => open ? close() : openCalendar()}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' && !open) {
          event.preventDefault();
          openCalendar();
        }
      }}
    >
      <span className="br-calendar-field-icon" aria-hidden="true"><CalendarDays/></span>
      <span className="br-calendar-field-copy">
        <span className="br-calendar-field-label">Message date</span>
        <span className={`br-calendar-field-value${value ? '' : ' br-calendar-placeholder'}`}>
          {value ? fullDate.format(utcDate(value)) : 'Choose your date'}
        </span>
      </span>
      <ChevronDown className="br-calendar-chevron" aria-hidden="true"/>
    </button>
    {open && <div id={popoverId} className="br-calendar-popover" role="dialog" aria-modal={false} aria-label="Choose your message date">
      <div className="br-calendar-heading">
        <span className="br-calendar-eyebrow">DAILY ACTION AUDIT</span>
        <h3 id={titleId}>Choose your message date</h3>
      </div>
      <div className="br-calendar-month-nav">
        <button type="button" className="br-calendar-nav-button" aria-label="Previous month" disabled={month <= minMonth} onClick={() => navigateMonth(-1)}><ChevronLeft aria-hidden="true"/></button>
        <span id={monthId} className="br-calendar-month" aria-live="polite" aria-atomic="true">{monthLabel.format(utcDate(month))}</span>
        <button type="button" className="br-calendar-nav-button" aria-label="Next month" onClick={() => navigateMonth(1)}><ChevronRight aria-hidden="true"/></button>
      </div>
      <div className="br-calendar-grid" role="grid" aria-labelledby={monthId} aria-describedby={helpId}>
        <div className="br-calendar-weekdays" role="row">
          {weekdays.map(day => <span key={day} role="columnheader" aria-label={day}>{day.slice(0, 2)}</span>)}
        </div>
        {rows.map((row, index) => <div className="br-calendar-week" role="row" key={index}>
          {row.map((iso, column) => <div className="br-calendar-cell" role="gridcell" key={iso || `blank-${column}`}>
            {iso && <button
              type="button"
              ref={node => { if (node) dayRefs.current.set(iso, node); else dayRefs.current.delete(iso); }}
              className={`br-calendar-day${iso === value ? ' br-calendar-selected' : ''}`}
              aria-label={fullDate.format(utcDate(iso))}
              aria-pressed={iso === value}
              disabled={iso < min}
              tabIndex={iso === activeDate ? 0 : -1}
              onFocus={() => setFocusedDate(iso)}
              onKeyDown={event => navigateDay(event, iso)}
              onClick={() => selectDate(iso)}
            >{dayNumber(iso)}</button>}
          </div>)}
        </div>)}
      </div>
      <p id={helpId} className="br-calendar-sr-only">Use arrow keys to move by day or week, Home and End for the week boundaries, and Page Up or Page Down to change months. Press Enter to select or Escape to close.</p>
      <div className="br-calendar-footer">
        <button type="button" className="br-calendar-clear" disabled={!value} onClick={() => {onChange(''); close();}}>Clear date</button>
        <button type="button" className="br-calendar-done" onClick={() => close()}>Done</button>
      </div>
    </div>}
  </div>;
}
