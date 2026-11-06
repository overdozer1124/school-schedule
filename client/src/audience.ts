// Audience whitelist (DESIGN §9): a guardian / student / public view sees
// only what its own columns list and what each item's or event's
// visibility lets through. Every display path — table, calendar symbol
// band, day detail, print — must take its data from here instead of
// reading bootstrap/range data directly, so no secondary path can list
// staff-only values or duty holders' names.
//
// Type-only imports keep this module free of runtime dependencies so it
// can be unit-tested (`bun test client`).

import type { ColumnDef, ItemDef, RangeData } from "./lib";

export const VIS_RANK: Record<string, number> = {
  staff_only: 0,
  guardian: 1,
  student: 2,
  public: 3,
};
export const AUDIENCE_RANK: Record<string, number> = {
  staff: 0,
  guardian: 1,
  student: 2,
  public: 3,
};

/** Rank of a view audience; unknown values fall back to the most open audience, never to staff. */
export function audienceRankOf(audience: string | null | undefined): number {
  if (audience == null) return 0;
  return AUDIENCE_RANK[audience] ?? AUDIENCE_RANK.public!;
}

/** Whether something with this visibility may be shown to the audience rank. Unknown visibility counts as staff-only. */
export function reaches(visibility: string, audienceRank: number): boolean {
  return (VIS_RANK[visibility] ?? 0) >= audienceRank;
}

/** View columns that the audience may see (daily items by visibility, duties only for staff). */
export function audienceColumns(
  columns: ColumnDef[],
  items: Pick<ItemDef, "id" | "defaultVisibility">[],
  audienceRank: number,
): ColumnDef[] {
  return columns.filter((c) => {
    if (c.kind === "daily_item") {
      const item = items.find((i) => i.id === c.itemId);
      if (!item) return false;
      return reaches(item.defaultVisibility, audienceRank);
    }
    if (c.kind === "duty") return audienceRank === 0;
    return true;
  });
}

/**
 * Daily items the audience may see anywhere on screen. Staff see every
 * item; any other audience sees only items that are columns of the view
 * AND whose visibility reaches it (whitelist, not "hide what is secret").
 */
export function audienceItems<T extends Pick<ItemDef, "id" | "defaultVisibility">>(
  items: T[],
  visibleColumns: ColumnDef[],
  audienceRank: number,
): T[] {
  if (audienceRank === 0) return items;
  const ids = new Set(
    visibleColumns.filter((c) => c.kind === "daily_item").map((c) => c.itemId),
  );
  return items.filter((i) => ids.has(i.id) && reaches(i.defaultVisibility, audienceRank));
}

/**
 * The range data a view may render. Staff get it unchanged. Other
 * audiences get events filtered by visibility, daily values only for the
 * allowed items, and no duty assignments, conflicts or duty history
 * (those carry staff names and are staff-only by definition).
 */
export function filterRangeForAudience(
  range: RangeData,
  allowedItemIds: Set<number>,
  audienceRank: number,
): RangeData {
  if (audienceRank === 0) return range;
  return {
    ...range,
    events: range.events.filter((e) => reaches(e.visibility, audienceRank)),
    dailyValues: range.dailyValues.filter((d) => allowedItemIds.has(d.itemDefinitionId)),
    dutyAssignments: [],
    conflicts: [],
    dutyChanges: [],
  };
}

/**
 * Compresses an ordered list of consecutive target names into a label.
 * ["1年",…,"6年"] -> "1～6年" (shared suffix kept once); a single name is
 * returned as-is. Names without a shared numeric shape (学部名・部門名
 * など) are listed instead of ranged (DESIGN §4.8.2): ["小学部","中学部"]
 * -> "小学部・中学部".
 */
export function targetRangeLabel(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  const first = names[0] ?? "";
  const last = names[names.length - 1] ?? "";
  const fm = first.match(/^(\d+)(.*)$/);
  const lm = last.match(/^(\d+)(.*)$/);
  if (fm && lm && fm[2] !== "" && fm[2] === lm[2]) {
    return `${fm[1]}～${last}`;
  }
  return names.join("・");
}
