export type MibDashboardBookingRow = {
  key: string;
  source: "booking" | "funnel";
  id: number;
  customerName: string;
  requestedLocalDate: string | null;
  requestedLocalTime: string | null;
  serviceName: string | null;
  assignmentStatus: string;
  paymentStatus: string;
  firstCleaningTotalCents: number | null;
  status: string;
};

type NativeBookingInput = {
  id: number;
  customerName: string;
  requestedLocalDate: string | null;
  requestedLocalTime: string | null;
  serviceName: string | null;
  assignmentStatus: string;
  paymentStatus: string;
  firstCleaningTotalCents: number | null;
  status: string;
};

type FunnelBookingInput = {
  id: number;
  bookingId: number | null;
  customerName: string;
  requestedLocalDate: string | null;
  requestedLocalTime: string | null;
  serviceName: string | null;
  paymentLast4: string | null;
  firstCleaningTotalCents: number | null;
  stage: string;
};

/**
 * Mirrors the existing Bookings workspace: native rows plus funnel rows that
 * have not created a native booking yet, with funnel leads excluded from the
 * booking view. The function is pure so its treatment is regression-tested.
 */
export function mergeMibDashboardBookings(
  bookings: NativeBookingInput[],
  funnelRecords: FunnelBookingInput[],
): MibDashboardBookingRow[] {
  const nativeRows: MibDashboardBookingRow[] = bookings.map((booking) => ({
    key: `booking:${booking.id}`,
    source: "booking",
    id: booking.id,
    customerName: booking.customerName,
    requestedLocalDate: booking.requestedLocalDate,
    requestedLocalTime: booking.requestedLocalTime,
    serviceName: booking.serviceName,
    assignmentStatus: booking.assignmentStatus,
    paymentStatus: booking.paymentStatus,
    firstCleaningTotalCents: booking.firstCleaningTotalCents,
    status: booking.status,
  }));
  const funnelRows: MibDashboardBookingRow[] = funnelRecords
    .filter((record) => !record.bookingId && record.stage !== "lead")
    .map((record) => ({
      key: `funnel:${record.id}`,
      source: "funnel",
      id: record.id,
      customerName: record.customerName,
      requestedLocalDate: record.requestedLocalDate,
      requestedLocalTime: record.requestedLocalTime,
      serviceName: record.serviceName,
      assignmentStatus: "unassigned",
      paymentStatus: record.paymentLast4 ? "card_on_file" : "not_started",
      firstCleaningTotalCents: record.firstCleaningTotalCents,
      status: record.stage,
    }));

  return [...funnelRows, ...nativeRows];
}

export function bookingsForMibDashboardDate(rows: MibDashboardBookingRow[], date: string) {
  return rows.filter((row) => row.requestedLocalDate === date);
}

export function bookingMetricSummary(rows: MibDashboardBookingRow[]) {
  return {
    totalBookings: rows.length,
    revenueCents: rows.reduce((sum, row) => sum + (row.firstCleaningTotalCents ?? 0), 0),
    assignedBookings: rows.filter((row) => row.assignmentStatus === "assigned").length,
    cardsOnFile: rows.filter((row) => row.paymentStatus === "card_on_file").length,
  };
}

export function shiftMibDashboardDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function businessDateForMibDashboard(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? null : null;
  return Math.round(((current - previous) / previous) * 100);
}
