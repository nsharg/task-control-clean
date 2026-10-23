/**
 * Turns milestone sizes (agent-hours left) into calendar dates. Milestones on
 * one track are built back to back in their order, starting today; different
 * tracks run side by side. Only working days carry hours.
 */
export type Capacity = { hoursPerDay: number; workDays: number[] };

export type RoadmapMilestone = {
  id: string;
  track: string | null;
  remainingHours: number;
  /** Every counted task is done. */
  shipped: boolean;
  startedAt: number | null;
  lastDoneAt: number | null;
};

export type Slot = {
  id: string;
  /** Local midnight of the first and last day of the bar (inclusive). */
  start: number;
  end: number;
  /** Where the remaining work starts; null when shipped. */
  from: number | null;
  shipped: boolean;
};

const DAY = 86_400_000;

export function dayStart(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Adds whole calendar days, safe across daylight-saving changes. */
export function addDays(t: number, n: number) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** A position inside a day: which day, and how many of its hours are used. */
type Cursor = { day: number; used: number };

function nextWorkDay(c: Cursor, cap: Capacity): Cursor {
  let day = c.day;
  let used = c.used;
  for (let i = 0; i < 14 && (!cap.workDays.includes(new Date(day).getDay()) || used >= cap.hoursPerDay); i++) {
    day = addDays(day, 1);
    used = 0;
  }
  return { day, used };
}

/** Spends `hours` from the cursor; returns the first and last day worked and where the next piece starts. */
function spend(from: Cursor, hours: number, cap: Capacity) {
  let c = nextWorkDay(from, cap);
  const first = c.day;
  let last = c.day;
  let left = hours;
  while (left > 1e-9) {
    c = nextWorkDay(c, cap);
    const take = Math.min(left, cap.hoursPerDay - c.used);
    left -= take;
    last = c.day;
    c = { day: c.day, used: c.used + take };
  }
  return { first, last, next: c };
}

export function schedule(milestones: RoadmapMilestone[], cap: Capacity, now = Date.now()) {
  const today = dayStart(now);
  const lanes = new Map<string, Cursor>();
  const slots: Slot[] = [];
  let finish: number | null = null;
  let hoursLeft = 0;
  for (const m of milestones) {
    if (m.shipped) {
      const end = dayStart(m.lastDoneAt ?? now);
      slots.push({ id: m.id, start: Math.min(dayStart(m.startedAt ?? end), end), end, from: null, shipped: true });
      continue;
    }
    const lane = m.track ?? "";
    const { first, last, next } = spend(lanes.get(lane) ?? { day: today, used: 0 }, Math.max(m.remainingHours, 0), cap);
    lanes.set(lane, next);
    hoursLeft += Math.max(m.remainingHours, 0);
    finish = Math.max(finish ?? last, last);
    const began = m.startedAt !== null ? dayStart(m.startedAt) : first;
    slots.push({ id: m.id, start: Math.min(began, first), end: last, from: first, shipped: false });
  }
  return { slots, finish, hoursLeft: Math.round(hoursLeft), today };
}

/** Sprints are calendar weeks starting on Sunday. */
export function weekStart(t: number) {
  const d = new Date(dayStart(t));
  return addDays(d.getTime(), -d.getDay());
}

export const daysBetween = (a: number, b: number) => Math.round((dayStart(b) - dayStart(a)) / DAY);
