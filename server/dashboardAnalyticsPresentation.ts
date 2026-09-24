export type DashboardSourceRow = {
  leadSource: string | null;
  utmSource: string | null;
  gclid: string | null;
  count: number;
};

export type DashboardSourceSummary = {
  source: string;
  count: number;
  previousCount: number;
};

const DISPLAY_SOURCE_ORDER = [
  "Thumbtack",
  "Google",
  "Yelp",
  "Nextdoor",
  "Website / AI",
  "Angi",
  "Meta",
  "Bark",
  "Phone",
  "Campaign",
  "Direct",
  "Other",
] as const;

function normalized(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Maps the existing persisted attribution fields to the dashboard's compact
 * source labels. This is a presentation-only aggregation: no session changes
 * or attribution writes are performed.
 */
export function dashboardSourceLabel(row: Pick<DashboardSourceRow, "leadSource" | "utmSource" | "gclid">) {
  const lead = normalized(row.leadSource);
  const utm = normalized(row.utmSource);

  if (["thumbtack", "thumbtack-sms"].includes(lead) || ["thumbtack", "thumbtack-sms"].includes(utm)) return "Thumbtack";
  if (["bark", "bark-sms"].includes(lead) || ["bark", "bark-sms"].includes(utm)) return "Bark";
  if (lead === "yelp" || utm === "yelp") return "Yelp";
  if (lead === "angi" || utm === "angi") return "Angi";
  if (lead === "nextdoor" || utm === "nextdoor") return "Nextdoor";
  if (["google", "email"].includes(lead) || utm === "google" || Boolean(row.gclid)) return "Google";
  if (["meta", "facebook", "instagram"].includes(lead) || ["meta", "facebook", "instagram"].includes(utm)) return "Meta";
  if (["form", "widget"].includes(lead) || ["form", "widget"].includes(utm)) return "Website / AI";
  if (["voice", "phone"].includes(lead) || ["voice", "phone"].includes(utm)) return "Phone";
  if (lead === "reactivation" || lead === "command-center" || lead.startsWith("campaign:") || lead.startsWith("always-on:")) return "Campaign";
  if (!lead && !utm) return "Direct";
  return row.utmSource?.trim() || row.leadSource?.trim() || "Other";
}

export function summarizeDashboardSources(currentRows: DashboardSourceRow[], previousRows: DashboardSourceRow[]): DashboardSourceSummary[] {
  const current = new Map<string, number>();
  const previous = new Map<string, number>();
  for (const row of currentRows) {
    const label = dashboardSourceLabel(row);
    current.set(label, (current.get(label) ?? 0) + Number(row.count));
  }
  for (const row of previousRows) {
    const label = dashboardSourceLabel(row);
    previous.set(label, (previous.get(label) ?? 0) + Number(row.count));
  }
  const labels = new Set([...Array.from(current.keys()), ...Array.from(previous.keys())]);
  return Array.from(labels, source => ({ source, count: current.get(source) ?? 0, previousCount: previous.get(source) ?? 0 }))
    .filter(row => row.count > 0)
    .sort((first, second) => {
      const firstRank = DISPLAY_SOURCE_ORDER.indexOf(first.source as typeof DISPLAY_SOURCE_ORDER[number]);
      const secondRank = DISPLAY_SOURCE_ORDER.indexOf(second.source as typeof DISPLAY_SOURCE_ORDER[number]);
      const rankDifference = (firstRank < 0 ? DISPLAY_SOURCE_ORDER.length : firstRank) - (secondRank < 0 ? DISPLAY_SOURCE_ORDER.length : secondRank);
      return rankDifference || second.count - first.count || first.source.localeCompare(second.source);
    })
    .slice(0, 6);
}

export const SERVICE_CATEGORY_ORDER = ["Cleaning", "Move Out", "Junk Removal", "Lawn Care", "Handyman", "Other"] as const;
export type DashboardServiceCategory = typeof SERVICE_CATEGORY_ORDER[number];

/**
 * Converts the imported Launch27 service-name string into the six compact
 * dashboard categories shown in the approved card. Bedroom counts and hourly
 * maid services are cleaning work, rather than individual visual categories.
 */
export function dashboardServiceCategory(serviceName: string | null): DashboardServiceCategory {
  const value = normalized(serviceName);
  if (/move\s*-?\s*out|moveout/.test(value)) return "Move Out";
  if (/junk|haul/.test(value)) return "Junk Removal";
  if (/lawn|yard|grass/.test(value)) return "Lawn Care";
  if (/handyman|furniture|mount|picture|plumb|electric|lighting|repair|paint/.test(value)) return "Handyman";
  if (/clean|bedroom|bathroom|hourly|maid|recurring|standard|deep|commercial|office|airbnb/.test(value)) return "Cleaning";
  return "Other";
}

export function summarizeDashboardServices(rows: Array<{ serviceName: string | null; count: number }>) {
  const counts = new Map<DashboardServiceCategory, number>(SERVICE_CATEGORY_ORDER.map(category => [category, 0]));
  for (const row of rows) {
    const category = dashboardServiceCategory(row.serviceName);
    counts.set(category, (counts.get(category) ?? 0) + Number(row.count));
  }
  return SERVICE_CATEGORY_ORDER.map(label => ({ label, count: counts.get(label) ?? 0 }));
}

export function percentChange(current: number, previous: number) {
  if (previous === 0) return current === 0 ? null : null;
  return Math.round(((current - previous) / previous) * 100);
}
