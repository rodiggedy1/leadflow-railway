export function normalizePayrollPercent(value: string | number | null | undefined, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
}
