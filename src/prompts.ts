import { z } from "zod";
import { type Job, type JobData, Profile } from "./schemas";

export const JOB_SYSTEM = `You extract structured data from a job posting. Rules:
- \`description\` = responsibilities, tasks, team, and what the role is about. Condense boilerplate, keep every concrete detail.
- \`must_haves\` = explicitly required qualifications. \`nice_to_haves\` = 'plus', 'preferred', 'ideally'. One item per requirement.
- \`remote\`: full = fully remote; mostly = remote with occasional office; partly = hybrid with regular office days; none = on-site only; unknown = not stated.
- \`deadline\` = application deadline as YYYY-MM-DD, or null.
- \`expired\` = true if the page says the posting is closed, expired, no longer accepting applications, or no longer available (e.g. "Det här jobbet har gått ut", "job has expired", "position filled"). Otherwise false. Set true even when no deadline date can be found.
- \`salary\` exactly as stated. Numeric min/max are annual amounts when possible.
- \`language\` = ISO 639-1 code of the posting's original language.
- \`required_spoken_languages\` = ISO 639-1 codes of languages explicitly required to speak/communicate orally. \`required_written_languages\` = ISO 639-1 codes of languages explicitly required to write or read. Only when the posting explicitly states the requirement; the posting's own language does not imply a requirement. Use [] otherwise.
- If the original language is German or English, keep all text in that language and set translated=false. Otherwise translate all text fields into English and set translated=true.
- Never invent information. Use null or [] when absent.`;

export const EVAL_SYSTEM = `You rate how well a job posting fits a candidate, based only on the candidate profile and the posting. Rules:
- \`score\` = integer 0-100, comparable across jobs. 0 = no fit, 50 = partial fit with real gaps, 100 = ideal match. Weigh must-haves most, then location/remote/language fit, then nice-to-haves.
- \`strengths\` = concrete points where the profile matches the posting. One item per point, short.
- \`issues\` = concrete gaps, risks, or mismatches (missing skills, location, language, salary, seniority). One item per point, short.
- Write in English. Use only facts present in the profile and posting. Never invent experience the candidate does not list. Use [] when nothing applies.`;

// text:/file: keys are content hashes, not URLs; they are left out of prompts to keep them noise-free.
export const isSyntheticKey = (url: string): boolean => url.startsWith("text:") || url.startsWith("file:");

export function suitabilityInput(profile: Profile, job: JobData, url: string): string {
  const { description, company_description: _cd, ...rest } = job;
  const jobText = JSON.stringify({ ...rest, description: description.slice(0, 4000) });
  const label = isSyntheticKey(url) ? "" : ` (${url})`;
  return `PROFILE:\n${JSON.stringify(profile)}\n\nJOB${label}:\n${jobText}`;
}

export const CV_SYSTEM = `You extract a person's profile from their CV/resume. Keep original wording for descriptions, dates as YYYY-MM or YYYY, end=null if ongoing. Never invent information.`;

export function externalCvPrompt(): string {
  return (
    CV_SYSTEM +
    "\n\nRead the attached CV and return ONLY a JSON (or YAML) document matching this JSON Schema:\n" +
    JSON.stringify(z.toJSONSchema(Profile, { io: "input", unrepresentable: "any" }), null, 2)
  );
}

// shortcut: whole job list in context; switch to retrieval/tool-calls when it exceeds model context
export function chatSystem(profile: Profile, jobs: Job[], today: string): string {
  const open = jobs
    .filter(j => j.status === "parsed" && j.data)
    .filter(j => !j.data!.expired && (j.data!.deadline === null || j.data!.deadline >= today))
    .map(j => {
      const d = j.data!;
      return {
        id: j.id,
        title: d.title,
        company: d.company,
        location: d.location,
        remote: d.remote,
        deadline: d.deadline,
        salary: d.salary,
        must_haves: d.must_haves,
        required_spoken_languages: d.required_spoken_languages,
        required_written_languages: d.required_written_languages,
        nice_to_haves: d.nice_to_haves,
        description: d.description.slice(0, 1500),
      };
    });

  return (
    `You are a career advisor. Today is ${today}. The candidate's profile and their collected open positions are below. ` +
    `Assess fit honestly, based on requirements vs. profile. Refer to jobs as '#<id> <title> @ <company>'. Answer in the user's language.\n\n` +
    `PROFILE:\n${JSON.stringify(profile)}\n\nJOBS:\n${JSON.stringify(open)}`
  );
}
