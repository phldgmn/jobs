import type { Job, JobData } from "../schemas";

type Remote = JobData["remote"];

// Fit bands: score >= FIT_STRONG is strong, >= FIT_PARTIAL partial, below weak.
export const FIT_STRONG = 70;
export const FIT_PARTIAL = 40;

export type Filters = {
  q: string;
  remote: Remote | "any";
  visibility: "applicable" | "expired" | "all";
  // Minimum fit score. 0 = no filter; any positive value also hides unscored jobs.
  minFit: number;
  sort: "deadline_asc" | "deadline_desc" | "added_desc" | "company_asc" | "fit_desc" | "fit_asc";
};

export const defaultFilters: Filters = {
  q: "",
  remote: "any",
  visibility: "applicable",
  minFit: 0,
  sort: "deadline_asc",
};

type Parsed = Job & { data: JobData };
const isParsed = (j: Job): j is Parsed => j.data !== null;

// Nulls always last, in both directions.
function compareNullable(a: string | null, b: string | null, dir: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * a.localeCompare(b);
}

function compareFit(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * (a - b);
}

type Cmp = (a: Parsed, b: Parsed) => number;
type Family = "deadline" | "fit" | "added" | "company";

// Deadline: lowest time to deadline first; nulls last.
const deadlineCmp = (dir: 1 | -1): Cmp => (a, b) => compareNullable(a.data.deadline, b.data.deadline, dir);
// Fit: highest first; unscored last.
const fitCmp = (dir: 1 | -1): Cmp => (a, b) => compareFit(a.suitability?.score ?? null, b.suitability?.score ?? null, dir);
// Added: newest (highest id) first.
const byAdded: Cmp = (a, b) => b.id - a.id;

const primaryFor: Record<Filters["sort"], { family: Family; cmp: Cmp }> = {
  deadline_asc: { family: "deadline", cmp: deadlineCmp(1) },
  deadline_desc: { family: "deadline", cmp: deadlineCmp(-1) },
  added_desc: { family: "added", cmp: byAdded },
  company_asc: { family: "company", cmp: (a, b) => compareNullable(a.data.company, b.data.company, 1) },
  fit_desc: { family: "fit", cmp: fitCmp(-1) },
  fit_asc: { family: "fit", cmp: fitCmp(1) },
};

// Fixed secondary order after the primary key: deadline, fit, added.
const secondary: { family: Family; cmp: Cmp }[] = [
  { family: "deadline", cmp: deadlineCmp(1) },
  { family: "fit", cmp: fitCmp(-1) },
  { family: "added", cmp: byAdded },
];

// shortcut: client-side filtering over all jobs; move to SQL/FTS5 if >~5k jobs
export function applyFilters(jobs: Job[], f: Filters, today: string): Job[] {
  const q = f.q.trim().toLowerCase();

  const matches = jobs.filter(isParsed).filter(job => {
    const d = job.data;
    if (q) {
      const haystack = [
        d.title,
        d.company,
        d.description,
        d.company_description,
        d.location,
        d.salary,
        ...d.must_haves,
        ...d.nice_to_haves,
      ]
        .join("\n")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (f.remote !== "any" && d.remote !== f.remote) return false;

    const score = job.suitability?.score ?? null;
    if (f.minFit > 0 && (score === null || score < f.minFit)) return false;

    const expired = d.expired || (d.deadline !== null && d.deadline < today);
    if (f.visibility === "applicable" && expired) return false;
    if (f.visibility === "expired" && !expired) return false;
    return true;
  });

  const primary = primaryFor[f.sort];
  const comparators: Cmp[] = [
    primary.cmp,
    ...secondary.filter(s => s.family !== primary.family).map(s => s.cmp),
  ];

  return [...matches].sort((a, b) => {
    for (const cmp of comparators) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  });
}
