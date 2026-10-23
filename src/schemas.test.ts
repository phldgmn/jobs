import { describe, expect, test } from "bun:test";
import { JobData, Profile, Suitability } from "./schemas";

describe("JobData", () => {
  test("unknown remote value, bad deadline and missing fields fall back to defaults", () => {
    const parsed = JobData.parse({ title: "X", remote: "hybrid-ish", deadline: "31.12.2026" });
    expect(parsed.remote).toBe("unknown");
    expect(parsed.deadline).toBeNull();
    expect(parsed.must_haves).toEqual([]);
    expect(parsed.company).toBeNull();
  });
});

describe("Profile", () => {
  test("empty object is valid and yields empty experience", () => {
    expect(Profile.parse({}).experience).toEqual([]);
  });
});

describe("Suitability", () => {
  test("score must be integer 0-100; strengths and issues default to empty", () => {
    expect(Suitability.parse({ score: 72 })).toEqual({ score: 72, strengths: [], issues: [] });
    expect(Suitability.safeParse({ score: 101 }).success).toBe(false);
    expect(Suitability.safeParse({ score: 50.5 }).success).toBe(false);
  });
});
