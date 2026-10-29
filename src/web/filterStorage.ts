import { z } from "zod";
import { defaultFilters, type Filters } from "./filter";

const KEY = "jobs.filters.v1";

// localStorage is untrusted input: validate every field, fall back to defaults.
// Unknown keys (e.g. the removed language/fit fields from older saves) are dropped.
const Stored = z.object({
  q: z.string(),
  remote: z.enum(["any", "full", "mostly", "partly", "none", "unknown"]),
  visibility: z.enum(["applicable", "expired", "all"]),
  applied: z.enum(["hide", "only", "all"]).default("hide"),
  minFit: z.number().int().min(0).max(100).default(0),
  sort: z.enum(["deadline_asc", "deadline_desc", "added_desc", "company_asc", "fit_desc", "fit_asc"]),
});

export function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return defaultFilters;
    const result = Stored.safeParse(JSON.parse(raw));
    return result.success ? result.data : defaultFilters;
  } catch {
    return defaultFilters;
  }
}

export function saveFilters(f: Filters): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {
    // storage full or disabled: filters simply don't persist
  }
}
