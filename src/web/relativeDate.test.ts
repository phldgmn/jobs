import { describe, expect, test } from "bun:test";
import { relativeDeadline } from "./relativeDate";

const today = "2026-10-23";

describe("relativeDeadline", () => {
  test("same day is today", () => {
    expect(relativeDeadline("2026-10-23", today)).toBe("today");
  });

  test("under a week uses days, singular and plural", () => {
    expect(relativeDeadline("2026-10-24", today)).toBe("in 1 day");
    expect(relativeDeadline("2026-10-25", today)).toBe("in 2 days");
    expect(relativeDeadline("2026-10-20", today)).toBe("3 days ago");
  });

  test("weeks plus remaining days, dropping zero parts", () => {
    expect(relativeDeadline("2026-10-30", today)).toBe("in 1 week");
    expect(relativeDeadline("2026-11-06", today)).toBe("in 2 weeks");
    expect(relativeDeadline("2026-11-10", today)).toBe("in 2 weeks 4 days");
    expect(relativeDeadline("2026-10-02", today)).toBe("3 weeks ago");
  });
});
