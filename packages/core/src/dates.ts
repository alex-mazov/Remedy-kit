/** Date helpers. Dates are ISO strings `YYYY-MM-DD` throughout the core. */

/** Today's date in the user's time zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last day of the month for `YYYY-MM`. */
export function endOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0));
  return last.toISOString().slice(0, 10);
}

export type ExpiryStatus = "ok" | "expiring" | "expired" | "unknown";

/**
 * A package is usable through its expiry date inclusive, so it is
 * expired only from the next day on.
 */
export function expiryStatus(expiryDate: string | null, today: string, notifyDays: number): ExpiryStatus {
  if (!expiryDate) return "unknown";
  if (expiryDate < today) return "expired";
  if (expiryDate <= addDays(today, notifyDays)) return "expiring";
  return "ok";
}
