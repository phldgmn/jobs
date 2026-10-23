const DAY_MS = 86_400_000;

// "in 2 days", "in 2 weeks 4 days", "3 days ago", "today". Both args are YYYY-MM-DD;
// Date.parse of that form is UTC, so the difference is exact whatever the local timezone.
export function relativeDeadline(deadline: string, today: string): string {
  const n = Math.round((Date.parse(deadline) - Date.parse(today)) / DAY_MS);
  if (n === 0) return "today";
  const abs = Math.abs(n);
  const weeks = Math.floor(abs / 7);
  const days = abs % 7;
  const text =
    weeks > 0
      ? [plural(weeks, "week"), days > 0 ? plural(days, "day") : null].filter(Boolean).join(" ")
      : plural(days, "day");
  return n > 0 ? `in ${text}` : `${text} ago`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
