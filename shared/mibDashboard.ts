export type MibDashboardBookingRow = {
  key: string;
  source: "job";
  id: number;
  customerName: string;
  customerPhone: string | null;
  requestedLocalDate: string | null;
  requestedLocalTime: string | null;
  serviceName: string | null;
  assignmentStatus: string;
  paymentStatus: string;
  firstCleaningTotalCents: number | null;
  status: string;
  customerRating: number | null;
  isNewCustomer: boolean;
};

type LeadflowJobInput = {
  id: number;
  customerName: string;
  customerPhone: string | null;
  jobDate: string;
  serviceDateTime: string | null;
  serviceName: string | null;
  bookingStatus: string;
  teamName: string | null;
  jobTotalCents: number;
  hasStripeCard: number;
  customerRating: number | null;
};

function phoneKey(phone: string | null) {
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : null;
}

/**
 * Normalizes the LeadFlow-owned jobs table into the fixed dashboard contract.
 * All output is read-only and is derived only from jobs-table fields.
 */
export function mapLeadflowJobsForMibDashboard(
  jobs: LeadflowJobInput[],
  firstJobDateByPhone: Record<string, string>,
): MibDashboardBookingRow[] {
  return jobs.map((job) => {
    const customerKey = phoneKey(job.customerPhone);
    return {
      key: `job:${job.id}`,
      source: "job",
      id: job.id,
      customerName: job.customerName,
      customerPhone: job.customerPhone,
      requestedLocalDate: job.jobDate,
      requestedLocalTime: job.serviceDateTime ? job.serviceDateTime.slice(11, 16) : null,
      serviceName: job.serviceName,
      assignmentStatus: job.teamName?.trim() ? "assigned" : "unassigned",
      paymentStatus: job.hasStripeCard ? "card_on_file" : "not_started",
      firstCleaningTotalCents: job.jobTotalCents,
      status: job.bookingStatus,
      customerRating: job.customerRating,
      isNewCustomer: Boolean(customerKey && firstJobDateByPhone[customerKey] === job.jobDate),
    };
  });
}

export function bookingsForMibDashboardDate(rows: MibDashboardBookingRow[], date: string) {
  return rows.filter((row) => row.requestedLocalDate === date);
}

export function bookingMetricSummary(rows: MibDashboardBookingRow[]) {
  const ratedRows = rows.filter((row) => row.customerRating !== null);
  return {
    totalBookings: rows.length,
    revenueCents: rows.reduce((sum, row) => sum + (row.firstCleaningTotalCents ?? 0), 0),
    assignedBookings: rows.filter((row) => row.assignmentStatus === "assigned").length,
    cardsOnFile: rows.filter((row) => row.paymentStatus === "card_on_file").length,
    newCustomers: rows.filter((row) => row.isNewCustomer).length,
    averageRating: ratedRows.length ? ratedRows.reduce((sum, row) => sum + (row.customerRating ?? 0), 0) / ratedRows.length : null,
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
