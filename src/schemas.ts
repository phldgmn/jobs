import { z } from "zod";

// Server and client both import this file. The client uses `import type` only.

export const Remote = z.enum(["full", "mostly", "partly", "none", "unknown"]);
const str = z.string().nullable().default(null);
const list = z.array(z.string()).default([]);

export const JobData = z.object({
  title: z.string(),
  company: str,
  description: z.string().default(""), // role, responsibilities, team; condensed but faithful
  company_description: str,
  must_haves: list,
  nice_to_haves: list,
  salary: str, // human-readable as stated, e.g. "65.000–80.000 EUR/year"
  salary_min: z.number().nullable().default(null),
  salary_max: z.number().nullable().default(null),
  salary_currency: str, // ISO 4217
  location: str,
  remote: Remote.catch("unknown"),
  language: z.string().default("en"), // ISO 639-1 of ORIGINAL posting
  required_spoken_languages: z.array(z.string()).default([]), // ISO 639-1; explicitly required to speak
  required_written_languages: z.array(z.string()).default([]), // ISO 639-1; explicitly required to write/read
  translated: z.boolean().default(false),
  deadline: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null)
    .default(null),
  expired: z.boolean().catch(false).default(false), // page says closed/expired, independent of deadline
});
export type JobData = z.output<typeof JobData>;

// AI fit of a job against the candidate profile. Stored apart from JobData so manual edits don't wipe it.
export const Suitability = z.object({
  score: z.number().int().min(0).max(100), // 0 = no fit, 100 = ideal match; comparable across jobs
  strengths: list, // where the profile matches the posting
  issues: list, // gaps, risks, mismatches
});
export type Suitability = z.output<typeof Suitability>;

export type JobStatus = "pending" | "parsed" | "error";
export type Job = {
  id: number;
  url: string;
  status: JobStatus;
  error: string | null;
  data: JobData | null;
  suitability: Suitability | null;
  suitability_error: string | null;
  evaluating: boolean;
  applied_at: string | null; // set when marked applied; null = not applied
  materials: Material[];
  created_at: string;
};

// File supplied with an application. Content is fetched by id, never inlined in the job list.
export type Material = { id: number; name: string; mime: string; size: number; created_at: string };

const period = { start: str, end: str }; // "YYYY-MM" or "YYYY"; end null = present

export const Profile = z.object({
  name: str,
  headline: str,
  email: str,
  phone: str,
  location: str,
  links: list,
  summary: str,
  skills: list,
  languages: z.array(z.object({ language: z.string(), level: str })).default([]),
  education: z
    .array(z.object({ institution: z.string(), degree: str, field: str, ...period, details: str }))
    .default([]),
  experience: z
    .array(
      z.object({
        company: z.string(),
        title: z.string(),
        location: str,
        ...period,
        description: str,
        highlights: list,
      }),
    )
    .default([]),
  certifications: list,
  projects: z.array(z.object({ name: z.string(), description: str, link: str })).default([]),
  preferences: z
    .object({
      desired_roles: list,
      locations: list,
      remote: str,
      salary_expectation: str,
      notes: str,
    })
    .default({ desired_roles: [], locations: [], remote: null, salary_expectation: null, notes: null }),
});
export type Profile = z.output<typeof Profile>;

// AI call kinds: job parse (page -> JobData) and fit evaluation (profile vs job).
export const TaskKind = z.enum(["parse", "evaluate"]);
export type TaskKind = z.output<typeof TaskKind>;

// Prompt as sent to the model.
export const LlmRequest = z.object({ model: z.string(), system: z.string(), user: z.string() });
export type LlmRequest = z.output<typeof LlmRequest>;

// Queued or running AI call; in memory only.
export type ActiveTask = {
  id: number;
  jobId: number;
  kind: TaskKind;
  url: string;
  state: "queued" | "running";
  queuedAt: string;
  startedAt: string | null;
  title: string | null; // job title from parsed data; null until parsed
};

// Failed AI call; kept until a new attempt starts or the job is deleted.
// request = null when failure happened before any model call (e.g. page fetch).
export type FailedTask = {
  id: number;
  jobId: number;
  kind: TaskKind;
  url: string;
  error: string;
  request: LlmRequest | null;
  failedAt: string;
  title: string | null;
};
