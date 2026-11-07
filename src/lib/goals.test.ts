import { describe, expect, it } from "vitest";
import { accountProgress, goalProgress, monthsUntil, type GoalFigures } from "./goals";

const base: GoalFigures = {
  targetMinor: 3_000_000, // 30 000 kr
  targetDate: null,
  startsOn: "2026-11-01",
  contributedMinor: 0,
  account: null,
};

describe("monthsUntil", () => {
  it("counts this month and every month before the target month, plus the target month if its day is later", () => {
    expect(monthsUntil("2026-11-07", "2027-06-01")).toBe(7);
    expect(monthsUntil("2026-11-07", "2027-06-30")).toBe(8);
    expect(monthsUntil("2026-11-07", "2026-11-30")).toBe(1);
    expect(monthsUntil("2026-11-07", "2026-12-07")).toBe(1);
    expect(monthsUntil("2026-11-07", "2026-12-08")).toBe(2);
    expect(monthsUntil("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("is zero on or after the target date", () => {
    expect(monthsUntil("2026-11-07", "2026-11-07")).toBe(0);
    expect(monthsUntil("2026-11-07", "2026-10-01")).toBe(0);
  });
});

describe("accountProgress", () => {
  it("uses growth since the start by default", () => {
    expect(accountProgress({ basis: "growth", growthMinor: 50_000, balanceMinor: 900_000 })).toEqual({
      minor: 50_000,
      source: "growth",
      balanceUnavailable: false,
    });
  });

  it("uses the balance when asked and known, and says so when it falls back", () => {
    expect(accountProgress({ basis: "balance", growthMinor: 50_000, balanceMinor: 900_000 }).minor).toBe(900_000);
    expect(accountProgress({ basis: "balance", growthMinor: 50_000, balanceMinor: null })).toEqual({
      minor: 50_000,
      source: "growth",
      balanceUnavailable: true,
    });
  });
});

describe("goalProgress", () => {
  it("adds contributions and the linked account", () => {
    const p = goalProgress(
      { ...base, contributedMinor: 250_000, account: { basis: "growth", growthMinor: 500_000, balanceMinor: null } },
      "2026-11-07",
    );
    expect(p).toMatchObject({ savedMinor: 750_000, fromAccountMinor: 500_000, fromContributionsMinor: 250_000, percent: 25, leftMinor: 2_250_000 });
    expect(p.reached).toBe(false);
    expect(p.schedule).toBeNull();
  });

  it("rounds percent down so 100 % means reached", () => {
    expect(goalProgress({ ...base, contributedMinor: 2_999_900 }, "2026-11-07").percent).toBe(99);
    const done = goalProgress({ ...base, contributedMinor: 3_500_000 }, "2026-11-07");
    expect(done).toMatchObject({ percent: 100, leftMinor: 0, reached: true });
  });

  it("never shows negative progress when more was taken out than put in", () => {
    const p = goalProgress({ ...base, contributedMinor: -10_000 }, "2026-11-07");
    expect(p).toMatchObject({ savedMinor: -10_000, percent: 0, leftMinor: 3_000_000, reached: false });
  });

  it("works out the monthly amount needed, rounded up to whole kroner", () => {
    // 30 000 kr by the end of April 2027 from 7 Nov 2026: Nov … Apr = 6 months.
    const p = goalProgress({ ...base, targetDate: "2027-04-30", contributedMinor: 1_000_001 }, "2026-11-07");
    expect(p.schedule?.monthsLeft).toBe(6);
    // 1 999 999 øre left / 6 = 333 333.17 øre → 3 334 kr.
    expect(p.schedule?.perMonthMinor).toBe(333_400);
  });

  it("compares progress with a steady pace from the start date", () => {
    const goal = { ...base, startsOn: "2026-01-01", targetDate: "2027-01-01" }; // 365 days
    const today = "2026-07-02"; // 182 days in: a steady pace is 1 495 890 øre.
    expect(goalProgress({ ...goal, contributedMinor: 1_500_000 }, today).schedule).toMatchObject({
      expectedByNowMinor: 1_495_890,
      status: "on_track",
    });
    expect(goalProgress({ ...goal, contributedMinor: 2_000_000 }, today).schedule?.status).toBe("ahead");
    const behind = goalProgress({ ...goal, contributedMinor: 1_000_000 }, today).schedule;
    expect(behind?.status).toBe("behind");
    expect(behind?.gapMinor).toBe(-495_890);
  });

  it("is on track on day one, overdue after the date, and reached whenever the money is there", () => {
    const goal = { ...base, targetDate: "2027-05-01" };
    expect(goalProgress(goal, "2026-11-01").schedule?.status).toBe("on_track");
    const late = goalProgress({ ...goal, contributedMinor: 100_000 }, "2027-05-02").schedule;
    expect(late).toMatchObject({ status: "overdue", monthsLeft: 0, perMonthMinor: 0, expectedByNowMinor: 3_000_000 });
    expect(goalProgress({ ...goal, contributedMinor: 3_000_000 }, "2027-06-01").schedule).toMatchObject({ status: "reached", perMonthMinor: 0 });
  });

  it("stays exact for large targets over long periods", () => {
    const p = goalProgress(
      { ...base, targetMinor: 9_999_999_999_999, startsOn: "2000-01-01", targetDate: "2099-12-31" },
      "2050-01-01",
    );
    const total = BigInt(36_524); // days from 2000-01-01 to 2099-12-31
    const elapsed = BigInt(18_263);
    expect(p.schedule?.expectedByNowMinor).toBe(Number((BigInt(9_999_999_999_999) * elapsed) / total));
    expect(Number.isSafeInteger(p.schedule?.perMonthMinor)).toBe(true);
  });

  it("rejects amounts that are not safe integers", () => {
    expect(() => goalProgress({ ...base, contributedMinor: 0.5 }, "2026-11-07")).toThrow(RangeError);
  });
});
