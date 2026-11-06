import { api, type ApiResponse } from "./api";

export type Bootstrap = ApiResponse<typeof api, "getBootstrap">;
export type RangeData = ApiResponse<typeof api, "getRange">;
export type EventItem = RangeData["events"][number];
export type DailyValue = RangeData["dailyValues"][number];
export type Assignment = RangeData["dutyAssignments"][number];
export type Conflict = RangeData["conflicts"][number];
export type Person = Bootstrap["people"][number];
export type ItemDef = Bootstrap["items"][number];
export type DutyDef = Bootstrap["duties"][number];
export type ViewDef = Bootstrap["views"][number];

export type ColumnDef = {
  kind: "category" | "daily_item" | "duty";
  category?: string;
  itemId?: number;
  dutyId?: number;
  label: string;
};

export const CATEGORIES = ["行事", "会議", "出張", "研修", "〆切", "休暇", "その他"];
export const ABSENCE_CATEGORIES = ["出張", "休暇", "研修"];
// Default leave classifications for 休暇 events. The live list is editable
// in settings and stored on the server (settings.leaveTypes); this constant
// is only the fallback / reset target. Direct input is also allowed.
export const DEFAULT_LEAVE_TYPES = [
  "年休",
  "病休",
  "特休",
  "夏特",
  "看護",
  "職専免",
  "振休",
  "その他",
];
// Back-compat alias (prefer bootstrap.settings.leaveTypes in components).
export const LEAVE_TYPES = DEFAULT_LEAVE_TYPES;
export function leaveTypesOf(bootstrap: Bootstrap | null | undefined): string[] {
  const list = bootstrap?.settings?.leaveTypes;
  if (Array.isArray(list) && list.length > 0) return list;
  return [...DEFAULT_LEAVE_TYPES];
}
export const CERTAINTY_OPTIONS = [
  { value: "confirmed", label: "確定" },
  { value: "planned", label: "予定" },
  { value: "tentative", label: "仮" },
  { value: "draft", label: "案" },
];
export const VISIBILITY_OPTIONS = [
  { value: "staff_only", label: "職員のみ" },
  { value: "guardian", label: "保護者可" },
  { value: "student", label: "生徒可" },
  { value: "public", label: "公開" },
];
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
export const LAYOUTS = [
  { key: "month_rows", label: "L1 月・縦表" },
  { key: "week_rows", label: "L2 週・縦表" },
  { key: "year_columns", label: "L3 年間・横連結" },
  { key: "calendar_grid", label: "L4 カレンダー" },
  { key: "week_timeline", label: "L5 週タイムライン" },
  { key: "transposed", label: "L6 転置表" },
] as const;

// ---- date helpers (YYYY-MM-DD text, local calendar) ----
export function parseDate(s: string): Date {
  const [y = 2026, m = 1, d = 1] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function todayStr(): string {
  return fmtDate(new Date());
}
export function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
export function addMonths(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return fmtDate(d);
}
export function monthStart(s: string): string {
  return `${s.slice(0, 7)}-01`;
}
export function monthEnd(s: string): string {
  const d = parseDate(monthStart(s));
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return fmtDate(d);
}
export function mondayOf(s: string): string {
  const dow = parseDate(s).getDay();
  return addDays(s, dow === 0 ? -6 : 1 - dow);
}
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to && out.length < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
export function weekdayOf(s: string): number {
  return parseDate(s).getDay();
}
export function monthLabel(s: string): string {
  const d = parseDate(s);
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}
export function dayLabel(s: string): string {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()] ?? ""}）`;
}
export function slotLabel(slot: string): string {
  if (slot === "am") return "午前";
  if (slot === "pm") return "午後";
  if (slot === "week") return "週";
  return "終日";
}
export function personNameOf(
  people: Person[],
  personId: number | null,
  freeTextName: string | null,
): string {
  if (personId != null) {
    return people.find((p) => p.id === personId)?.name ?? freeTextName ?? "";
  }
  return freeTextName ?? "";
}
/**
 * The label shown for an event in tables, lists and the timeline. For 休暇
 * events the meaningful identity is who takes the leave, so the taker
 * name(s) replace the title; the title is only a fallback until a taker
 * has been set.
 */
export function eventHeadline(
  e: Pick<EventItem, "category" | "title" | "assignees">,
  people: Person[],
): string {
  if (e.category === "休暇") {
    const names = e.assignees
      .map((a) => personNameOf(people, a.personId, a.freeTextName))
      .filter(Boolean);
    if (names.length > 0) return names.join("、");
  }
  return e.title;
}
/**
 * Compresses an ordered list of target names into a range label.
 * ["1年","2年","3年","4年","5年","6年"] -> "1～6年" (shared suffix kept once),
 * ["1年","2年"] -> "1～2年", a single name is returned as-is.
 * Falls back to "first～last" when the names share no numeric+ suffix shape.
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
  return `${first}～${last}`;
}
// ---- Phase 3: entitlements & link mode (DESIGN §10) ----
export type Entitlement = Bootstrap["entitlements"][number];
export type MasterLink = Bootstrap["masterLinks"][number];
export const PRODUCT_LABELS: Record<string, string> = {
  event_schedule: "行事予定",
  timetable: "時間割（school-timetable）",
};
export const PLAN_LABELS: Record<string, string> = {
  free: "フリー",
  standard: "スタンダード",
  pro: "プロ",
};
export const ENT_STATUS_LABELS: Record<string, string> = {
  active: "有効",
  trial: "体験中",
  suspended: "停止",
  none: "未契約",
};
/**
 * The entitlement row that governs this school for a product: an exact
 * school-name match wins, then a row with a blank school name (meaning
 * "this school"). No governing row means the product is treated as
 * usable — entitlements only restrict once someone records them.
 */
export function governingEntitlement(
  bootstrap: Bootstrap,
  product: string,
): Entitlement | undefined {
  const rows = bootstrap.entitlements.filter((e) => e.product === product);
  const name = bootstrap.settings.schoolName;
  return (
    rows.find((e) => name !== "" && e.schoolName === name) ??
    rows.find((e) => e.schoolName === "") ??
    (rows.length === 1 ? rows[0] : undefined)
  );
}
export function entitlementUsable(e: Entitlement | undefined): boolean {
  if (!e) return true;
  return e.status === "active" || e.status === "trial";
}

/** Stable identity key for a view column, used to store its drag-adjusted width. */
export function columnWidthKey(c: ColumnDef): string {
  if (c.kind === "category") return `cat:${c.category ?? ""}`;
  if (c.kind === "daily_item") return `item:${c.itemId ?? ""}`;
  return `duty:${c.dutyId ?? ""}`;
}
export const COL_WIDTH_MIN = 48;
export const COL_WIDTH_MAX = 800;
export function clampColWidth(w: number): number {
  return Math.min(COL_WIDTH_MAX, Math.max(COL_WIDTH_MIN, Math.round(w)));
}
/** Parses a view's saved column widths (px, keyed by column identity). */
export function parseWidths(view: ViewDef | null): Record<string, number> {
  if (!view) return {};
  try {
    const obj = JSON.parse(view.widthsJson) as Record<string, unknown>;
    if (obj == null || typeof obj !== "object") return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = clampColWidth(v);
    }
    return out;
  } catch {
    return {};
  }
}
export function parseColumns(view: ViewDef | null): ColumnDef[] {
  if (!view) return [{ kind: "category", category: "行事", label: "行事等予定" }];
  try {
    const arr = JSON.parse(view.columnsJson) as ColumnDef[];
    if (Array.isArray(arr) && arr.length > 0) return arr;
  } catch {
    /* fall through */
  }
  return [{ kind: "category", category: "行事", label: "行事等予定" }];
}
export function eventsOnDate(events: EventItem[], date: string): EventItem[] {
  return events.filter((e) => {
    if (e.datePrecision === "month" || e.datePrecision === "undecided") return false;
    if (!e.startsOn || !e.endsOn) return false;
    return e.startsOn <= date && date <= e.endsOn;
  });
}
export function sortEvents(events: EventItem[]): EventItem[] {
  return [...events].sort((a, b) => {
    if (a.isAllDay !== b.isAllDay) return b.isAllDay - a.isAllDay;
    const ta = a.startsAt ?? "";
    const tb = b.startsAt ?? "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.id - b.id;
  });
}
