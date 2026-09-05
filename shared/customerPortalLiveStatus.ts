export type CustomerPortalTodayJob = {
  jobDate: string;
  serviceDateTime: string | null;
  serviceType: string | null;
  teamName: string | null;
  jobStatus: string | null;
  bookingStatus: string | null;
  delayMinutes: number | null;
  etaTimestamp: number | null;
  etaTimeStr: string | null;
};

const INACTIVE_BOOKING_STATUSES = new Set(["cancelled", "canceled", "rescheduled", "completed"]);

export function getCustomerPortalBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function isCustomerPortalLiveJob(job: Pick<CustomerPortalTodayJob, "jobStatus" | "bookingStatus">): boolean {
  const bookingStatus = job.bookingStatus?.toLowerCase() ?? "";
  return job.jobStatus !== "completed" && !INACTIVE_BOOKING_STATUSES.has(bookingStatus);
}

function formatEta(job: CustomerPortalTodayJob): string | null {
  if (job.etaTimeStr?.trim()) return job.etaTimeStr.trim();
  if (!job.etaTimestamp || !Number.isFinite(job.etaTimestamp)) return null;
  const eta = new Date(job.etaTimestamp);
  if (Number.isNaN(eta.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(eta);
}

export function getCustomerPortalLiveStatusView(job: CustomerPortalTodayJob): {
  title: string;
  detail: string;
  progressIndex: number;
  isRunningLate: boolean;
} {
  const eta = formatEta(job);
  switch (job.jobStatus) {
    case "on_the_way":
      return { title: "Your team is on the way", detail: eta ? `Expected arrival ${eta}` : "Your team is on the way.", progressIndex: 1, isRunningLate: false };
    case "running_late": {
      const delay = typeof job.delayMinutes === "number" && job.delayMinutes > 0 ? `Running ${job.delayMinutes} minutes late` : "Your team is running a little behind";
      return { title: "Your team is running late", detail: eta ? `${delay} · Updated arrival ${eta}` : delay, progressIndex: 1, isRunningLate: true };
    }
    case "arrived":
      return { title: "Your team has arrived", detail: "Your service is getting started.", progressIndex: 2, isRunningLate: false };
    case "in_progress":
      return { title: "Your cleaning is underway", detail: "Your team is taking care of your home.", progressIndex: 2, isRunningLate: false };
    case "finishing_up":
    case "wrapping_up":
      return { title: "Your team is finishing up", detail: "Your service will be complete shortly.", progressIndex: 2, isRunningLate: false };
    case "issue_at_property":
      return { title: "We’re checking in on today’s service", detail: "We’ll keep you updated here.", progressIndex: 2, isRunningLate: false };
    default:
      return { title: "Your cleaning is scheduled", detail: "We’ll keep you updated here.", progressIndex: 0, isRunningLate: false };
  }
}
