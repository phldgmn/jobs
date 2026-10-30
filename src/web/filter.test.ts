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

const job = (id: number, d: Partial<JobData>): Job => ({
  id,
  url: `https://example.com/${id}`,
  status: "parsed",
  suitability: null,
  suitability_error: null,
  evaluating: false,
  applied_at: null,
  materials: [],
  error: null,
  data: data(d),
  created_at: "2026-01-01 00:00:00",
});

const jobs = [
  job(1, { title: "Past", company: "Alpha", deadline: "2026-01-01" }),
  job(2, { title: "Near", company: "Beta", deadline: "2026-06-01", nice_to_haves: ["Terraform"] }),
  job(3, { title: "Far", company: "Gamma", deadline: "2026-12-31" }),
  job(4, { title: "NoDeadline", company: "Delta", deadline: null }),
];

const run = (over: Partial<Filters>) =>
  applyFilters(jobs, { ...defaultFilters, ...over }, TODAY).map(j => j.id);

describe("applyFilters sorting", () => {
  test("deadline ascending puts past, near, far, then null", () => {
    expect(run({ sort: "deadline_asc", visibility: "all" })).toEqual([1, 2, 3, 4]);
  });

  test("deadline descending puts far, near, past, then null", () => {
    expect(run({ sort: "deadline_desc", visibility: "all" })).toEqual([3, 2, 1, 4]);
  });
});

describe("applyFilters visibility", () => {
  const withExpired = [...jobs, job(5, { title: "Gone", company: "Eps", deadline: null, expired: true })];
  const ids = (f: Partial<Filters>) =>
    applyFilters(withExpired, { ...defaultFilters, ...f }, TODAY).map(j => j.id);

  test("applicable keeps future and no-deadline jobs, drops past and expired", () => {
    expect(ids({ visibility: "applicable" })).toEqual([2, 3, 4]);
  });

  test("expired keeps past-deadline and expired-flag jobs", () => {
    expect(ids({ visibility: "expired" })).toEqual([1, 5]);
  });

  test("all keeps everything; deadline sort ties undated jobs by newest added", () => {
    expect(ids({ visibility: "all" })).toEqual([1, 2, 3, 5, 4]);
  });

  test("applicable sort puts nearest deadline first, no-deadline last", () => {
    expect(ids({ visibility: "applicable", sort: "deadline_asc" })).toEqual([2, 3, 4]);
  });
});

describe("applyFilters text search", () => {
  test("matches a term only present in nice_to_haves, case-insensitively", () => {
    expect(run({ q: "TERRAFORM" })).toEqual([2]);
  });
});
