// Pure, dependency-free logic shared by the actions. Kept out of
// actions.ts so it can be unit-tested without the space runtime
// (`bun test server`). Nothing here touches the database.

// ---------- calendar dates (YYYY-MM-DD) ----------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True only for a real calendar date written as YYYY-MM-DD (no rollover: 2026-02-30 is false). */
export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return false;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= last;
}

/** True for a wall-clock time written as HH:MM (00:00–23:59). */
export function isValidTimeString(s: string): boolean {
  return TIME_RE.test(s);
}

// ---------- slots ----------

export function slotsOverlap(a: string, b: string): boolean {
  if (a === "week" || b === "week") return true;
  if (a === "all_day" || b === "all_day") return true;
  return a === b;
}

/** Noon boundary that splits 午前 / 午後 for timed events. */
const NOON = "12:00";

/**
 * The part of the day an event occupies, for duty-conflict matching
 * (DESIGN §4.7.2: a morning-only trip does not conflict with an afternoon
 * duty). An explicit am/pm slot wins; otherwise a timed event is placed
 * by its hours — ending by noon is "am", starting at/after noon is "pm",
 * anything spanning noon (or with unknown times) is "all_day".
 */
export function eventSlot(e: {
  isAllDay: number;
  slot: string;
  startsAt: string | null;
  endsAt: string | null;
}): string {
  if (e.slot === "am" || e.slot === "pm") return e.slot;
  if (e.isAllDay === 1) return "all_day";
  const s = e.startsAt && isValidTimeString(e.startsAt) ? e.startsAt : null;
  const t = e.endsAt && isValidTimeString(e.endsAt) ? e.endsAt : null;
  if (s && t && t <= NOON) return "am";
  if (s && s >= NOON) return "pm";
  if (!s && t && t <= NOON) return "am";
  return "all_day";
}

// ---------- duty definitions ----------

/**
 * Whether a duty definition is in force on a date. "all_year" always
 * applies. Every other kind (long_vacation_only, custom_range, …) applies
 * only inside its configured dates; with no dates configured it applies
 * nowhere, rather than silently applying all year and flooding the
 * unassigned-duty warnings.
 */
export function dutyAppliesOn(
  def: { applicablePeriod: string; startsOn: string | null; endsOn: string | null },
  date: string,
): boolean {
  if (def.applicablePeriod === "all_year") return true;
  if (!def.startsOn && !def.endsOn) return false;
  if (def.startsOn && date < def.startsOn) return false;
  if (def.endsOn && date > def.endsOn) return false;
  return true;
}

/**
 * Where a rotation should resume so that regenerating month by month
 * continues the cycle instead of restarting at the first member: the
 * member after whoever held the most recent assignment before the
 * period. Falls back to 0 when nothing earlier matches a member.
 */
export function nextRotationIndex(
  members: { personId: number | null; freeTextName: string | null }[],
  last: { personId: number | null; freeTextName: string | null } | null,
): number {
  if (!last || members.length === 0) return 0;
  const i = members.findIndex((m) =>
    last.personId != null
      ? m.personId === last.personId
      : m.personId == null &&
        normalizeName(m.freeTextName) !== "" &&
        normalizeName(m.freeTextName) === normalizeName(last.freeTextName),
  );
  return i < 0 ? 0 : (i + 1) % members.length;
}

// ---------- names ----------

/** Name comparison key: trims and removes all whitespace (half/full width). */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "").replace(/[\s　]+/g, "");
}

/**
 * Whether a duty holder and an event assignee are the same person. Ids
 * match when both are registered; otherwise names are compared, so a
 * free-text assignee (未登録の非常勤など) still produces conflicts.
 */
export function samePerson(
  a: { personId: number | null; name: string },
  b: { personId: number | null; name: string },
): boolean {
  if (a.personId != null && b.personId != null) return a.personId === b.personId;
  const na = normalizeName(a.name);
  return na !== "" && na === normalizeName(b.name);
}
