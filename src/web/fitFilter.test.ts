import { describe, expect, test } from "bun:test";
import { applyFilters, defaultFilters, type Filters } from "./filter";
import type { Job, JobData } from "../schemas";

const TODAY = "2026-05-01";

const data = (over: Partial<JobData>): JobData => ({
  title: "T",
  company: "C",
  description: "",
  company_description: null,
  must_haves: [],
  nice_to_haves: [],
  salary: null,
  salary_min: null,
  salary_max: null,
  salary_currency: null,
  location: null,
  remote: "unknown",
  language: "en",
  required_spoken_languages: [],
  required_written_languages: [],
  translated: false,
  deadline: null,
  expired: false,
  ...over,
});

const job = (id: number, score: number | null): Job => ({
  id,
  url: `https://example.com/${id}`,
  status: "parsed",
  error: null,
  data: data({ title: `J${id}` }),
  suitability: score === null ? null : { score, strengths: [], issues: [] },
  suitability_error: null,
  evaluating: false,
  created_at: "2026-01-01 00:00:00",
});

// Scores cover both band edges (69/70, 39/40) and an unscored job.
const jobs = [job(1, 69), job(2, 70), job(3, 40), job(4, 39), job(5, null), job(6, 100)];

const ids = (over: Partial<Filters>) =>
  applyFilters(jobs, { ...defaultFilters, visibility: "all", ...over }, TODAY).map(j => j.id);

describe("minimum fit filter", () => {
  test("0 keeps every job, including unscored", () => {
    expect(ids({ minFit: 0 }).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("threshold is inclusive at the boundary", () => {
    expect(ids({ minFit: 70 }).sort()).toEqual([2, 6]);
    expect(ids({ minFit: 40 }).sort()).toEqual([1, 2, 3, 6]);
  });

  test("any positive threshold hides unscored jobs", () => {
    expect(ids({ minFit: 1 })).not.toContain(5);
  });

  test("threshold above every score returns nothing", () => {
    expect(ids({ minFit: 100 }).sort()).toEqual([6]);
    expect(ids({ minFit: 100 }).length).toBe(1);
  });
});

describe("fit sorting", () => {
  test("fit_desc orders highest first, unscored last", () => {
    expect(ids({ sort: "fit_desc" })).toEqual([6, 2, 1, 3, 4, 5]);
  });

  test("fit_asc orders lowest first, unscored still last", () => {
    expect(ids({ sort: "fit_asc" })).toEqual([4, 3, 1, 2, 6, 5]);
  });

  test("primary fit, ties broken by deadline then newest added", () => {
    const mk = (id: number, deadline: string | null): Job => ({ ...job(id, 80), data: data({ title: `J${id}`, deadline }) });
    const scored = [mk(10, "2026-12-31"), mk(11, "2026-06-01"), mk(12, null), mk(13, "2026-06-01")];
    const got = applyFilters(scored, { ...defaultFilters, sort: "fit_desc", visibility: "all" }, TODAY).map(j => j.id);
    expect(got).toEqual([13, 11, 10, 12]);
  });
});
