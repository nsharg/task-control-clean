import { describe, expect, test } from "vitest";
import { addDays, schedule, type RoadmapMilestone } from "../lib/roadmap";

// Sunday 20 Sep 2026, local time.
const SUN = new Date(2026, 8, 20).getTime();
const day = (n: number) => addDays(SUN, n);
const SUN_THU = { hoursPerDay: 4, workDays: [0, 1, 2, 3, 4] };
const m = (id: string, remainingHours: number, extra: Partial<RoadmapMilestone> = {}): RoadmapMilestone => ({
  id, track: null, remainingHours, shipped: false, startedAt: null, lastDoneAt: null, ...extra,
});

describe("schedule", () => {
  test("milestones run back to back and skip non-working days", () => {
    const { slots, finish, hoursLeft } = schedule([m("a", 20), m("b", 6)], SUN_THU, SUN);
    // 20 h at 4 h/day: Sun to Thu. Then Fri and Sat are off, so b starts Sunday.
    expect(slots[0]).toMatchObject({ start: day(0), end: day(4) });
    expect(slots[1]).toMatchObject({ start: day(7), end: day(8) });
    expect(finish).toBe(day(8));
    expect(hoursLeft).toBe(26);
  });

  test("a part-used day carries over to the next milestone", () => {
    const { slots } = schedule([m("a", 2), m("b", 2)], SUN_THU, SUN);
    expect(slots[1]).toMatchObject({ start: day(0), end: day(0) });
  });

  test("started work reaches back to when it began; shipped work is pinned", () => {
    const { slots } = schedule(
      [m("done", 0, { shipped: true, startedAt: day(-10), lastDoneAt: day(-3) }), m("half", 4, { startedAt: day(-5) })],
      SUN_THU,
      SUN,
    );
    expect(slots[0]).toMatchObject({ start: day(-10), end: day(-3), shipped: true, from: null });
    expect(slots[1]).toMatchObject({ start: day(-5), from: day(0), end: day(0) });
  });

  test("tracks are built in parallel", () => {
    const { slots } = schedule([m("track-a", 8, { track: "Track A" }), m("track-b", 8, { track: "Track B" }), m("track-a2", 4, { track: "Track A" })], SUN_THU, SUN);
    expect(slots.map((s) => s.start)).toEqual([day(0), day(0), day(2)]);
  });
});
