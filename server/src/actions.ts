// Actions for the generic school event-schedule app (Phase 1 prototype).
// Design: DESIGN.md v0.6 — definition-driven model, cell direct input,
// duty swap/substitute + conflict detection, five standard layouts.

import { defineAction, z, type ActionsModule, type Ctx } from "@hatch/space-sdk";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import * as schema from "./schema";


// ---------- date helpers (calendar dates as YYYY-MM-DD text) ----------
function parseDate(s: string): Date {
  const [y = 2026, m = 1, d = 1] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(s: string, n: number): string {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to && out.length < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
function mondayOf(s: string): string {
  const d = parseDate(s);
  const dow = d.getDay(); // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(s, diff);
}
function diffDays(from: string, to: string): number {
  const a = parseDate(from).getTime();
  const b = parseDate(to).getTime();
  return Math.round((b - a) / 86400000);
}

const ABSENCE_CATEGORIES = ["出張", "休暇", "研修"];
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

function parseLeaveTypes(json: string | null | undefined): string[] {
  if (!json) return [...DEFAULT_LEAVE_TYPES];
  try {
    const arr = JSON.parse(json) as unknown;
    if (Array.isArray(arr)) {
      const cleaned = arr
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter((x) => x !== "");
      // Dedupe while preserving order
      const seen = new Set<string>();
      const out: string[] = [];
      for (const v of cleaned) {
        if (!seen.has(v)) {
          seen.add(v);
          out.push(v);
        }
      }
      return out.length > 0 ? out : [...DEFAULT_LEAVE_TYPES];
    }
  } catch {
    /* fall through */
  }
  return [...DEFAULT_LEAVE_TYPES];
}

// ---------- shared loaders ----------
async function loadSettings(ctx: Ctx) {
  const db = ctx.db<typeof schema>();
  const rows = await db.select().from(schema.settings).limit(1);
  if (rows.length === 0) {
    await db.insert(schema.settings).values({ id: 1 });
    return {
      schoolName: "",
      schoolYear: 2026,
      presetApplied: null as string | null,
      leaveTypes: [...DEFAULT_LEAVE_TYPES],
    };
  }
  const r = rows[0]!;
  return {
    schoolName: r.schoolName,
    schoolYear: r.schoolYear,
    presetApplied: r.presetApplied,
    leaveTypes: parseLeaveTypes(r.leaveTypesJson),
  };
}

const personShape = z.object({
  id: z.number(),
  name: z.string(),
  role: z.string(),
  sort: z.number(),
});
const locationShape = z.object({
  id: z.number(),
  name: z.string(),
  kind: z.string(),
  sort: z.number(),
});
const itemShape = z.object({
  id: z.number(),
  key: z.string(),
  name: z.string(),
  valueType: z.string(),
  targetGroupId: z.number().nullable(),
  granularity: z.string(),
  defaultVisibility: z.string(),
  isAggregatable: z.number(),
  sort: z.number(),
  isActive: z.number(),
  options: z.array(
    z.object({
      id: z.number(),
      code: z.string(),
      label: z.string(),
      meaning: z.string(),
      countsAs: z.number(),
      sort: z.number(),
    }),
  ),
});
const dutyShape = z.object({
  id: z.number(),
  name: z.string(),
  granularity: z.string(),
  applicablePeriod: z.string(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  sort: z.number(),
  members: z.array(
    z.object({
      id: z.number(),
      personId: z.number().nullable(),
      freeTextName: z.string().nullable(),
      sort: z.number(),
    }),
  ),
});
const viewShape = z.object({
  id: z.number(),
  name: z.string(),
  layout: z.string(),
  audience: z.string(),
  columnsJson: z.string(),
  printJson: z.string(),
  sort: z.number(),
});
const eventShape = z.object({
  id: z.number(),
  title: z.string(),
  category: z.string(),
  datePrecision: z.string(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  isAllDay: z.number(),
  slot: z.string(),
  periodFrom: z.number().nullable(),
  periodTo: z.number().nullable(),
  locationId: z.number().nullable(),
  locationText: z.string().nullable(),
  leaveType: z.string().nullable(),
  description: z.string(),
  certainty: z.string(),
  visibility: z.string(),
  submitTo: z.string().nullable(),
  assignees: z.array(
    z.object({
      id: z.number(),
      personId: z.number().nullable(),
      freeTextName: z.string().nullable(),
      role: z.string(),
    }),
  ),
  targetIds: z.array(z.number()),
});
const assignmentShape = z.object({
  id: z.number(),
  dutyDefinitionId: z.number(),
  date: z.string(),
  slot: z.string(),
  personId: z.number().nullable(),
  freeTextName: z.string().nullable(),
  note: z.string(),
  isManualOverride: z.number(),
  origin: z.string(),
});
const conflictShape = z.object({
  kind: z.string(), // absence | double | unassigned
  assignmentId: z.number().nullable(),
  dutyDefinitionId: z.number(),
  dutyName: z.string(),
  date: z.string(),
  slot: z.string(),
  personId: z.number().nullable(),
  personName: z.string(),
  eventId: z.number().nullable(),
  eventTitle: z.string(),
});

async function loadEvents(ctx: Ctx, from: string, to: string) {
  const db = ctx.db<typeof schema>();
  const rows = await db
    .select()
    .from(schema.events)
    .where(
      and(
        lte(schema.events.startsOn, to),
        gte(schema.events.endsOn, from),
      ),
    )
    .orderBy(asc(schema.events.startsOn), asc(schema.events.id));
  // month / undecided events have no day range; include those whose month overlaps
  const monthRows = await db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.datePrecision, "month"),
        lte(schema.events.startsOn, to),
        gte(schema.events.startsOn, from.slice(0, 7) + "-01"),
      ),
    );
  const undecided = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.datePrecision, "undecided"));
  const byId = new Map<number, (typeof rows)[number]>();
  for (const r of [...rows, ...monthRows, ...undecided]) byId.set(r.id, r);
  const all = [...byId.values()];
  const assignees = all.length
    ? await db.select().from(schema.eventAssignees)
    : [];
  const targets = all.length ? await db.select().from(schema.eventTargets) : [];
  return all.map((e) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    datePrecision: e.datePrecision,
    startsOn: e.startsOn,
    endsOn: e.endsOn,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    isAllDay: e.isAllDay,
    slot: e.slot,
    periodFrom: e.periodFrom,
    periodTo: e.periodTo,
    locationId: e.locationId,
    locationText: e.locationText,
    leaveType: e.leaveType,
    description: e.description,
    certainty: e.certainty,
    visibility: e.visibility,
    submitTo: e.submitTo,
    assignees: assignees
      .filter((a) => a.eventId === e.id)
      .map((a) => ({
        id: a.id,
        personId: a.personId,
        freeTextName: a.freeTextName,
        role: a.role,
      })),
    targetIds: targets.filter((t) => t.eventId === e.id).map((t) => t.targetId),
  }));
}

function slotsOverlap(a: string, b: string): boolean {
  if (a === "week" || b === "week") return true;
  if (a === "all_day" || b === "all_day") return true;
  return a === b;
}

async function computeConflicts(
  ctx: Ctx,
  from: string,
  to: string,
): Promise<z.infer<typeof conflictShape>[]> {
  const out: z.infer<typeof conflictShape>[] = [];
  const db = ctx.db<typeof schema>();
  const defs = await db.select().from(schema.dutyDefinitions);
  const defName = new Map(defs.map((d) => [d.id, d.name]));
  const peopleRows = await db.select().from(schema.people);
  const personName = new Map(peopleRows.map((p) => [p.id, p.name]));
  const assignments = await db
    .select()
    .from(schema.dutyAssignments)
    .where(
      and(
        gte(schema.dutyAssignments.date, addDays(from, -7)),
        lte(schema.dutyAssignments.date, to),
      ),
    );
  const evs = await loadEvents(ctx, from, to);
  const absenceEvents = evs.filter((e) =>
    ABSENCE_CATEGORIES.includes(e.category),
  );
  const waivers = await db.select().from(schema.dutyConflictWaivers);
  const waived = new Set(waivers.map((w) => `${w.assignmentId}:${w.eventId}`));

  const effDates = (a: { date: string; slot: string }): string[] =>
    a.slot === "week" ? eachDate(a.date, addDays(a.date, 6)) : [a.date];

  // absence overlap + double assignment
  for (const a of assignments) {
    if (a.personId == null) continue;
    const name =
      personName.get(a.personId) ?? a.freeTextName ?? "";
    for (const d of effDates(a)) {
      if (d < from || d > to) continue;
      for (const e of absenceEvents) {
        if (!e.startsOn || !e.endsOn) continue;
        if (d < e.startsOn || d > e.endsOn) continue;
        const hasPerson = e.assignees.some((x) => x.personId === a.personId);
        if (!hasPerson) continue;
        const evSlot = e.isAllDay === 1 ? e.slot : "all_day";
        if (!slotsOverlap(a.slot, evSlot)) continue;
        if (waived.has(`${a.id}:${e.id}`)) continue;
        out.push({
          kind: "absence",
          assignmentId: a.id,
          dutyDefinitionId: a.dutyDefinitionId,
          dutyName: defName.get(a.dutyDefinitionId) ?? "",
          date: d,
          slot: a.slot,
          personId: a.personId,
          personName: name,
          eventId: e.id,
          eventTitle: `${e.category}：${e.title}`,
        });
      }
    }
  }
  const seenDouble = new Set<string>();
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      const a = assignments[i]!;
      const b = assignments[j]!;
      if (a.personId == null || a.personId !== b.personId) continue;
      for (const d of effDates(a)) {
        if (d < from || d > to) continue;
        if (!effDates(b).includes(d)) continue;
        if (!slotsOverlap(a.slot, b.slot)) continue;
        const key = `${a.id}:${b.id}:${d}`;
        if (seenDouble.has(key)) continue;
        seenDouble.add(key);
        out.push({
          kind: "double",
          assignmentId: a.id,
          dutyDefinitionId: a.dutyDefinitionId,
          dutyName: `${defName.get(a.dutyDefinitionId) ?? ""}／${defName.get(b.dutyDefinitionId) ?? ""}`,
          date: d,
          slot: a.slot,
          personId: a.personId,
          personName: personName.get(a.personId) ?? "",
          eventId: null,
          eventTitle: "当番の二重割当",
        });
      }
    }
  }
  // unassigned slots
  for (const def of defs) {
    const applies = (d: string): boolean => {
      if (def.applicablePeriod === "all_year") return true;
      if (def.startsOn && d < def.startsOn) return false;
      if (def.endsOn && d > def.endsOn) return false;
      return true;
    };
    const slots =
      def.granularity === "am_pm"
        ? ["am", "pm"]
        : def.granularity === "week"
          ? ["week"]
          : ["all_day"];
    for (const d of eachDate(from, to)) {
      if (!applies(d)) continue;
      if (def.granularity === "week" && parseDate(d).getDay() !== 1) continue;
      for (const s of slots) {
        const has = assignments.some(
          (a) => a.dutyDefinitionId === def.id && a.date === d && a.slot === s,
        );
        if (!has) {
          out.push({
            kind: "unassigned",
            assignmentId: null,
            dutyDefinitionId: def.id,
            dutyName: def.name,
            date: d,
            slot: s,
            personId: null,
            personName: "",
            eventId: null,
            eventTitle: "",
          });
        }
      }
    }
  }
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return out;
}

// ---------- presets ----------
async function applyPresetData(
  ctx: Ctx,
  preset: "elem_no_bus" | "elem_bus" | "junior_high",
) {
  const db = ctx.db<typeof schema>();
  const groups = await db.select().from(schema.targetGroups);
  const groupIdByKey = new Map(groups.map((g) => [g.key, g.id]));
  const ensureGroup = async (
    key: string,
    name: string,
    targetNames: string[],
  ): Promise<number> => {
    let id = groupIdByKey.get(key);
    if (id == null) {
      const [row] = await db
        .insert(schema.targetGroups)
        .values({ key, name, sort: groups.length })
        .returning({ id: schema.targetGroups.id });
      id = row!.id;
      groupIdByKey.set(key, id);
      for (let i = 0; i < targetNames.length; i++) {
        await db.insert(schema.targets).values({
          groupId: id,
          name: targetNames[i]!,
          sort: i,
        });
      }
    }
    return id;
  };
  const gradeNames =
    preset === "junior_high" ? ["1年", "2年", "3年"] : ["1年", "2年", "3年", "4年", "5年", "6年"];
  const gradeGroupId = await ensureGroup("grade", "学年", gradeNames);
  let busGroupId: number | null = null;
  if (preset === "elem_bus") {
    busGroupId = await ensureGroup("bus_route", "バス便", ["①便", "②便", "③便", "④便"]);
  }
  if (preset === "junior_high") {
    await ensureGroup("club", "部活動", []);
  }

  const existingItems = await db.select().from(schema.itemDefinitions);
  const itemIdByKey = new Map(existingItems.map((i) => [i.key, i.id]));
  const ensureItem = async (
    key: string,
    name: string,
    valueType: string,
    opts: {
      targetGroupId?: number | null;
      visibility?: string;
      aggregatable?: boolean;
      options?: { code: string; label: string; meaning: string; countsAs?: number }[];
    } = {},
  ): Promise<number> => {
    const found = itemIdByKey.get(key);
    if (found != null) {
      // Preset family-facing items used to default to guardian visibility;
      // the student view needs them reachable by students, so re-applying a
      // preset upgrades exactly that old default. Any other value a school
      // chose itself is left untouched.
      if (opts.visibility === "student") {
        const row = existingItems.find((i) => i.id === found);
        if (row && row.defaultVisibility === "guardian") {
          await db
            .update(schema.itemDefinitions)
            .set({ defaultVisibility: "student" })
            .where(eq(schema.itemDefinitions.id, found));
        }
      }
      return found;
    }
    const [row] = await db
      .insert(schema.itemDefinitions)
      .values({
        key,
        name,
        valueType,
        targetGroupId: opts.targetGroupId ?? null,
        defaultVisibility: opts.visibility ?? "staff_only",
        isAggregatable: opts.aggregatable ? 1 : 0,
        sort: itemIdByKey.size,
      })
      .returning({ id: schema.itemDefinitions.id });
    const id = row!.id;
    itemIdByKey.set(key, id);
    const options = opts.options ?? [];
    for (let i = 0; i < options.length; i++) {
      const o = options[i]!;
      await db.insert(schema.itemOptions).values({
        itemDefinitionId: id,
        code: o.code,
        label: o.label,
        meaning: o.meaning,
        countsAs: o.countsAs ?? 0,
        sort: i,
      });
    }
    return id;
  };

  const lunchId = await ensureItem("lunch", "給食", "symbol", {
    visibility: "student",
    aggregatable: true,
    options: [
      { code: "○", label: "○", meaning: "給食あり", countsAs: 1 },
      { code: "×", label: "×", meaning: "給食なし" },
      { code: "弁", label: "弁", meaning: "弁当の日" },
    ],
  });
  const cleaningId = await ensureItem("cleaning", "清掃", "symbol", {
    options: [
      { code: "○", label: "○", meaning: "清掃あり" },
      { code: "×", label: "×", meaning: "清掃なし" },
    ],
  });
  const afterschoolId = await ensureItem("afterschool", "放課後", "symbol", {
    options: [
      { code: "○", label: "○", meaning: "放課後活動あり" },
      { code: "×", label: "×", meaning: "なし" },
    ],
  });
  let dismissalId: number | null = null;
  let busId: number | null = null;
  let clubId: number | null = null;
  let lastDismissalId: number | null = null;
  if (preset !== "junior_high") {
    dismissalId = await ensureItem("dismissal", "下校時刻", "time_range", {
      targetGroupId: gradeGroupId,
      visibility: "student",
    });
  }
  if (preset === "elem_bus") {
    busId = await ensureItem("bus", "スクールバス", "text", {
      targetGroupId: busGroupId,
      visibility: "student",
    });
  }
  if (preset === "junior_high") {
    clubId = await ensureItem("club_activity", "部活動", "symbol", {
      visibility: "student",
      options: [
        { code: "○", label: "○", meaning: "活動あり" },
        { code: "×", label: "×", meaning: "活動なし" },
        { code: "大", label: "大", meaning: "大会" },
      ],
    });
    lastDismissalId = await ensureItem("last_dismissal", "最終下校", "time", {
      visibility: "student",
    });
  }

  // duty definitions
  const existingDuties = await db.select().from(schema.dutyDefinitions);
  const dutyIdByName = new Map(existingDuties.map((d) => [d.name, d.id]));
  const ensureDuty = async (
    name: string,
    granularity: string,
  ): Promise<number> => {
    const found = dutyIdByName.get(name);
    if (found != null) return found;
    const [row] = await db
      .insert(schema.dutyDefinitions)
      .values({ name, granularity, sort: dutyIdByName.size })
      .returning({ id: schema.dutyDefinitions.id });
    dutyIdByName.set(name, row!.id);
    return row!.id;
  };
  let dutyDayId: number | null = null;
  let dutyWeekId: number | null = null;
  if (preset === "elem_bus") dutyDayId = await ensureDuty("日番", "day");
  if (preset === "junior_high") {
    dutyDayId = await ensureDuty("日直", "day");
    dutyWeekId = await ensureDuty("週番", "week");
  }

  // period pattern (6 periods)
  const patterns = await db.select().from(schema.periodPatterns);
  if (!patterns.some((p) => p.code === "通常")) {
    const [pat] = await db
      .insert(schema.periodPatterns)
      .values({ code: "通常", name: "通常日課（6限）", sort: 0 })
      .returning({ id: schema.periodPatterns.id });
    const periods: [number, string, string, string][] = [
      [0, "朝", "08:20", "08:40"],
      [1, "1限", "08:45", "09:30"],
      [2, "2限", "09:40", "10:25"],
      [3, "3限", "10:45", "11:30"],
      [4, "4限", "11:40", "12:25"],
      [5, "5限", "13:30", "14:15"],
      [6, "6限", "14:25", "15:10"],
      [99, "放課後", "15:10", "16:00"],
    ];
    for (let i = 0; i < periods.length; i++) {
      const [no, label, s, e] = periods[i]!;
      await db.insert(schema.periodDefinitions).values({
        patternId: pat!.id,
        periodNo: no,
        label,
        startsAt: s,
        endsAt: e,
        sort: i,
      });
    }
  }

  // views
  const existingViews = await db.select().from(schema.viewDefinitions);
  const viewNames = new Set(existingViews.map((v) => v.name));
  const staffColumns: Record<string, unknown>[] = [
    { kind: "category", category: "行事", label: "行事等予定" },
    { kind: "category", category: "会議", label: "会議" },
    { kind: "category", category: "出張", label: "職員動静" },
    { kind: "category", category: "〆切", label: "各種〆切" },
    { kind: "category", category: "休暇", label: "休暇予定" },
  ];
  if (dutyDayId != null)
    staffColumns.push({ kind: "duty", dutyId: dutyDayId, label: preset === "junior_high" ? "日直" : "日番" });
  if (dutyWeekId != null)
    staffColumns.push({ kind: "duty", dutyId: dutyWeekId, label: "週番" });
  if (busId != null)
    staffColumns.push({ kind: "daily_item", itemId: busId, label: "スクールバス" });
  staffColumns.push({ kind: "daily_item", itemId: lunchId, label: "給食" });
  staffColumns.push({ kind: "daily_item", itemId: cleaningId, label: "清掃" });
  if (clubId != null)
    staffColumns.push({ kind: "daily_item", itemId: clubId, label: "部活動" });
  staffColumns.push({ kind: "daily_item", itemId: afterschoolId, label: "放課後" });
  if (dismissalId != null)
    staffColumns.push({ kind: "daily_item", itemId: dismissalId, label: "下校時刻" });
  if (lastDismissalId != null)
    staffColumns.push({ kind: "daily_item", itemId: lastDismissalId, label: "最終下校" });

  const guardianColumns: Record<string, unknown>[] = [
    { kind: "category", category: "行事", label: "行事等予定" },
    { kind: "daily_item", itemId: lunchId, label: "給食" },
  ];
  if (dismissalId != null)
    guardianColumns.push({ kind: "daily_item", itemId: dismissalId, label: "下校時刻" });
  if (busId != null)
    guardianColumns.push({ kind: "daily_item", itemId: busId, label: "スクールバス" });
  if (clubId != null)
    guardianColumns.push({ kind: "daily_item", itemId: clubId, label: "部活動" });
  if (lastDismissalId != null)
    guardianColumns.push({ kind: "daily_item", itemId: lastDismissalId, label: "最終下校" });

  if (!viewNames.has("職員用月表")) {
    await db.insert(schema.viewDefinitions).values({
      name: "職員用月表",
      layout: "month_rows",
      audience: "staff",
      columnsJson: JSON.stringify(staffColumns),
      printJson: JSON.stringify({ paper: "A4", orientation: "landscape" }),
      sort: 0,
    });
  }
  if (!viewNames.has("保護者用月表")) {
    await db.insert(schema.viewDefinitions).values({
      name: "保護者用月表",
      layout: "month_rows",
      audience: "guardian",
      columnsJson: JSON.stringify(guardianColumns),
      printJson: JSON.stringify({ paper: "A4", orientation: "landscape" }),
      sort: 1,
    });
  }
  // Student view: same family-facing columns as the guardian view, but the
  // audience filter additionally drops events/items whose visibility does
  // not reach students (whitelist by visibility, DESIGN §9).
  if (!viewNames.has("生徒用月表")) {
    await db.insert(schema.viewDefinitions).values({
      name: "生徒用月表",
      layout: "month_rows",
      audience: "student",
      columnsJson: JSON.stringify(guardianColumns),
      printJson: JSON.stringify({ paper: "A4", orientation: "landscape" }),
      sort: 2,
    });
  }
  // Transposed views: rows are the targets of one axis (grades / clubs),
  // columns are the days — the club-activity table form (DESIGN §4.8).
  if (dismissalId != null && !viewNames.has("転置表（学年別）")) {
    await db.insert(schema.viewDefinitions).values({
      name: "転置表（学年別）",
      layout: "transposed",
      audience: "staff",
      columnsJson: JSON.stringify([
        { kind: "daily_item", itemId: dismissalId, label: "下校時刻" },
      ]),
      printJson: JSON.stringify({ paper: "A3", orientation: "landscape" }),
      sort: 3,
    });
  }
  if (clubId != null && !viewNames.has("部活動予定表")) {
    await db.insert(schema.viewDefinitions).values({
      name: "部活動予定表",
      layout: "transposed",
      audience: "guardian",
      columnsJson: JSON.stringify([
        { kind: "daily_item", itemId: clubId, label: "部活動" },
      ]),
      printJson: JSON.stringify({ paper: "A3", orientation: "landscape" }),
      sort: 3,
    });
  }
}

const okResponse = z.object({ ok: z.literal(true) });
const idResponse = z.object({ id: z.number() });

const eventInput = z.object({
  title: z.string().min(1),
  category: z.string().default("行事"),
  datePrecision: z.string().default("day"),
  startsOn: z.string().nullable().default(null),
  endsOn: z.string().nullable().default(null),
  startsAt: z.string().nullable().default(null),
  endsAt: z.string().nullable().default(null),
  isAllDay: z.number().default(1),
  slot: z.string().default("all_day"),
  periodFrom: z.number().nullable().default(null),
  periodTo: z.number().nullable().default(null),
  locationId: z.number().nullable().default(null),
  locationText: z.string().nullable().default(null),
  leaveType: z.string().nullable().default(null),
  description: z.string().default(""),
  certainty: z.string().default("confirmed"),
  visibility: z.string().default("staff_only"),
  submitTo: z.string().nullable().default(null),
  assignees: z
    .array(
      z.object({
        personId: z.number().nullable().default(null),
        freeTextName: z.string().nullable().default(null),
        role: z.string().default("担当"),
      }),
    )
    .default([]),
  targetIds: z.array(z.number()).default([]),
});

async function replaceEventChildren(
  ctx: Ctx,
  eventId: number,
  args: z.infer<typeof eventInput>,
) {
  const db = ctx.db<typeof schema>();
  await db.delete(schema.eventAssignees).where(eq(schema.eventAssignees.eventId, eventId));
  await db.delete(schema.eventTargets).where(eq(schema.eventTargets.eventId, eventId));
  for (const a of args.assignees) {
    if (a.personId == null && !a.freeTextName) continue;
    await db.insert(schema.eventAssignees).values({
      eventId,
      personId: a.personId,
      freeTextName: a.freeTextName,
      role: a.role,
    });
  }
  for (const t of args.targetIds) {
    await db.insert(schema.eventTargets).values({ eventId, targetId: t });
  }
}

export const Actions = {
  getBootstrap: defineAction({
    description:
      "Loads all configuration for the schedule app: settings, people, locations, holidays, target groups, item definitions, period patterns, duty definitions, views, and publications.",
    request: z.object({}),
    response: z.object({
      settings: z.object({
        schoolName: z.string(),
        schoolYear: z.number(),
        presetApplied: z.string().nullable(),
        leaveTypes: z.array(z.string()),
      }),
      people: z.array(personShape),
      locations: z.array(locationShape),
      holidays: z.array(
        z.object({ id: z.number(), date: z.string(), name: z.string(), kind: z.string() }),
      ),
      targetGroups: z.array(
        z.object({
          id: z.number(),
          key: z.string(),
          name: z.string(),
          sort: z.number(),
          targets: z.array(
            z.object({ id: z.number(), name: z.string(), sort: z.number() }),
          ),
        }),
      ),
      items: z.array(itemShape),
      periodPatterns: z.array(
        z.object({
          id: z.number(),
          code: z.string(),
          name: z.string(),
          sort: z.number(),
          periods: z.array(
            z.object({
              id: z.number(),
              periodNo: z.number(),
              label: z.string(),
              startsAt: z.string().nullable(),
              endsAt: z.string().nullable(),
              sort: z.number(),
            }),
          ),
        }),
      ),
      duties: z.array(dutyShape),
      views: z.array(viewShape),
      publications: z.array(
        z.object({
          id: z.number(),
          viewDefinitionId: z.number().nullable(),
          viewName: z.string(),
          targetMonth: z.string(),
          versionLabel: z.string(),
          note: z.string(),
          publishedAt: z.string(),
        }),
      ),
    }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const settingsRow = await loadSettings(ctx);
      const peopleRows = await db.select().from(schema.people).orderBy(asc(schema.people.sort), asc(schema.people.id));
      const locationRows = await db.select().from(schema.locations).orderBy(asc(schema.locations.sort), asc(schema.locations.id));
      const holidayRows = await db.select().from(schema.holidays).orderBy(asc(schema.holidays.date));
      const groupRows = await db.select().from(schema.targetGroups).orderBy(asc(schema.targetGroups.sort));
      const targetRows = await db.select().from(schema.targets).orderBy(asc(schema.targets.sort));
      const itemRows = await db.select().from(schema.itemDefinitions).orderBy(asc(schema.itemDefinitions.sort));
      const optionRows = await db.select().from(schema.itemOptions).orderBy(asc(schema.itemOptions.sort));
      const patternRows = await db.select().from(schema.periodPatterns).orderBy(asc(schema.periodPatterns.sort));
      const periodRows = await db.select().from(schema.periodDefinitions).orderBy(asc(schema.periodDefinitions.sort));
      const dutyRows = await db.select().from(schema.dutyDefinitions).orderBy(asc(schema.dutyDefinitions.sort));
      const memberRows = await db.select().from(schema.rotationMembers).orderBy(asc(schema.rotationMembers.sort));
      const viewRows = await db.select().from(schema.viewDefinitions).orderBy(asc(schema.viewDefinitions.sort));
      const pubRows = await db.select().from(schema.publications).orderBy(desc(schema.publications.id));
      return {
        settings: settingsRow,
        people: peopleRows.map((p) => ({ id: p.id, name: p.name, role: p.role, sort: p.sort })),
        locations: locationRows.map((l) => ({ id: l.id, name: l.name, kind: l.kind, sort: l.sort })),
        holidays: holidayRows.map((h) => ({ id: h.id, date: h.date, name: h.name, kind: h.kind })),
        targetGroups: groupRows.map((g) => ({
          id: g.id,
          key: g.key,
          name: g.name,
          sort: g.sort,
          targets: targetRows
            .filter((t) => t.groupId === g.id)
            .map((t) => ({ id: t.id, name: t.name, sort: t.sort })),
        })),
        items: itemRows.map((i) => ({
          id: i.id,
          key: i.key,
          name: i.name,
          valueType: i.valueType,
          targetGroupId: i.targetGroupId,
          granularity: i.granularity,
          defaultVisibility: i.defaultVisibility,
          isAggregatable: i.isAggregatable,
          sort: i.sort,
          isActive: i.isActive,
          options: optionRows
            .filter((o) => o.itemDefinitionId === i.id)
            .map((o) => ({
              id: o.id,
              code: o.code,
              label: o.label,
              meaning: o.meaning,
              countsAs: o.countsAs,
              sort: o.sort,
            })),
        })),
        periodPatterns: patternRows.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          sort: p.sort,
          periods: periodRows
            .filter((d) => d.patternId === p.id)
            .map((d) => ({
              id: d.id,
              periodNo: d.periodNo,
              label: d.label,
              startsAt: d.startsAt,
              endsAt: d.endsAt,
              sort: d.sort,
            })),
        })),
        duties: dutyRows.map((d) => ({
          id: d.id,
          name: d.name,
          granularity: d.granularity,
          applicablePeriod: d.applicablePeriod,
          startsOn: d.startsOn,
          endsOn: d.endsOn,
          sort: d.sort,
          members: memberRows
            .filter((m) => m.dutyDefinitionId === d.id)
            .map((m) => ({
              id: m.id,
              personId: m.personId,
              freeTextName: m.freeTextName,
              sort: m.sort,
            })),
        })),
        views: viewRows.map((v) => ({
          id: v.id,
          name: v.name,
          layout: v.layout,
          audience: v.audience,
          columnsJson: v.columnsJson,
          printJson: v.printJson,
          sort: v.sort,
        })),
        publications: pubRows.map((p) => ({
          id: p.id,
          viewDefinitionId: p.viewDefinitionId,
          viewName: p.viewName,
          targetMonth: p.targetMonth,
          versionLabel: p.versionLabel,
          note: p.note,
          publishedAt: p.publishedAt.toISOString(),
        })),
      };
    },
  }),

  getRange: defineAction({
    description:
      "Loads events, daily values, duty assignments, day records, derived duty conflicts, and duty change history for a date range.",
    request: z.object({ from: z.string(), to: z.string() }),
    response: z.object({
      events: z.array(eventShape),
      dailyValues: z.array(
        z.object({
          id: z.number(),
          date: z.string(),
          itemDefinitionId: z.number(),
          targetId: z.number().nullable(),
          slot: z.string(),
          valueText: z.string().nullable(),
          valueNumber: z.number().nullable(),
          valueOptionId: z.number().nullable(),
          valuePersonId: z.number().nullable(),
        }),
      ),
      dutyAssignments: z.array(assignmentShape),
      dayRecords: z.array(
        z.object({
          id: z.number(),
          date: z.string(),
          dayType: z.string(),
          periodPatternId: z.number().nullable(),
          note: z.string(),
        }),
      ),
      conflicts: z.array(conflictShape),
      dutyChanges: z.array(
        z.object({
          id: z.number(),
          dutyDefinitionId: z.number(),
          kind: z.string(),
          fromLabel: z.string(),
          toLabel: z.string(),
          reason: z.string(),
          status: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const events = await loadEvents(ctx, args.from, args.to);
      const daily = await db
        .select()
        .from(schema.dailyValues)
        .where(
          and(
            gte(schema.dailyValues.date, args.from),
            lte(schema.dailyValues.date, args.to),
          ),
        );
      const assigns = await db
        .select()
        .from(schema.dutyAssignments)
        .where(
          and(
            gte(schema.dutyAssignments.date, addDays(args.from, -7)),
            lte(schema.dutyAssignments.date, args.to),
          ),
        );
      const days = await db
        .select()
        .from(schema.dayRecords)
        .where(
          and(
            gte(schema.dayRecords.date, args.from),
            lte(schema.dayRecords.date, args.to),
          ),
        );
      const conflicts = await computeConflicts(ctx, args.from, args.to);
      const changes = await db
        .select()
        .from(schema.dutyChanges)
        .orderBy(desc(schema.dutyChanges.id))
        .limit(100);
      return {
        events,
        dailyValues: daily.map((d) => ({
          id: d.id,
          date: d.date,
          itemDefinitionId: d.itemDefinitionId,
          targetId: d.targetId,
          slot: d.slot,
          valueText: d.valueText,
          valueNumber: d.valueNumber,
          valueOptionId: d.valueOptionId,
          valuePersonId: d.valuePersonId,
        })),
        dutyAssignments: assigns.map((a) => ({
          id: a.id,
          dutyDefinitionId: a.dutyDefinitionId,
          date: a.date,
          slot: a.slot,
          personId: a.personId,
          freeTextName: a.freeTextName,
          note: a.note,
          isManualOverride: a.isManualOverride,
          origin: a.origin,
        })),
        dayRecords: days.map((d) => ({
          id: d.id,
          date: d.date,
          dayType: d.dayType,
          periodPatternId: d.periodPatternId,
          note: d.note,
        })),
        conflicts,
        dutyChanges: changes.map((c) => ({
          id: c.id,
          dutyDefinitionId: c.dutyDefinitionId,
          kind: c.kind,
          fromLabel: c.fromLabel,
          toLabel: c.toLabel,
          reason: c.reason,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
        })),
      };
    },
  }),

  getSummary: defineAction({
    description:
      "Derives period totals for a date range (DESIGN §8): school-day counts by day type (explicit day records win; otherwise weekends and registered holidays count as 休業日 and other days as 授業日), and for every aggregatable item the number of days whose symbol counts (item_options.counts_as), with a per-target breakdown. Nothing is stored; everything is derived from day records and daily values.",
    request: z.object({ from: z.string(), to: z.string() }),
    response: z.object({
      schoolDays: z.number(),
      dayTypeCounts: z.array(
        z.object({ dayType: z.string(), count: z.number() }),
      ),
      items: z.array(
        z.object({
          itemId: z.number(),
          name: z.string(),
          total: z.number(),
          byTarget: z.array(
            z.object({
              targetId: z.number().nullable(),
              targetName: z.string(),
              count: z.number(),
            }),
          ),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const dates = eachDate(args.from, args.to);
      const dayRows = await db
        .select()
        .from(schema.dayRecords)
        .where(
          and(
            gte(schema.dayRecords.date, args.from),
            lte(schema.dayRecords.date, args.to),
          ),
        );
      const dayTypeByDate = new Map(dayRows.map((d) => [d.date, d.dayType]));
      const holidayRows = await db.select().from(schema.holidays);
      const holidaySet = new Set(holidayRows.map((h) => h.date));
      const counts = new Map<string, number>();
      for (const date of dates) {
        let t = dayTypeByDate.get(date);
        if (!t) {
          const dow = parseDate(date).getDay();
          t = dow === 0 || dow === 6 || holidaySet.has(date) ? "休業日" : "授業日";
        }
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const order = ["授業日", "行事日", "登校日", "休業日", "その他"];
      const dayTypeCounts = [...counts.entries()]
        .map(([dayType, count]) => ({ dayType, count }))
        .sort(
          (a, b) =>
            (order.indexOf(a.dayType) === -1 ? 99 : order.indexOf(a.dayType)) -
            (order.indexOf(b.dayType) === -1 ? 99 : order.indexOf(b.dayType)),
        );

      const itemRows = await db
        .select()
        .from(schema.itemDefinitions)
        .where(
          and(
            eq(schema.itemDefinitions.isAggregatable, 1),
            eq(schema.itemDefinitions.isActive, 1),
          ),
        )
        .orderBy(asc(schema.itemDefinitions.sort));
      const optionRows = await db.select().from(schema.itemOptions);
      const countsAsOptionIds = new Set(
        optionRows.filter((o) => o.countsAs === 1).map((o) => o.id),
      );
      const targetRows = await db.select().from(schema.targets);
      const targetName = new Map(targetRows.map((t) => [t.id, t.name]));
      const daily = await db
        .select()
        .from(schema.dailyValues)
        .where(
          and(
            gte(schema.dailyValues.date, args.from),
            lte(schema.dailyValues.date, args.to),
          ),
        );
      const items = itemRows.map((item) => {
        const byTargetMap = new Map<number | null, number>();
        let total = 0;
        for (const d of daily) {
          if (d.itemDefinitionId !== item.id) continue;
          if (d.valueOptionId == null || !countsAsOptionIds.has(d.valueOptionId))
            continue;
          total++;
          const key = d.targetId ?? null;
          byTargetMap.set(key, (byTargetMap.get(key) ?? 0) + 1);
        }
        return {
          itemId: item.id,
          name: item.name,
          total,
          byTarget: [...byTargetMap.entries()].map(([targetId, count]) => ({
            targetId,
            targetName:
              targetId != null ? (targetName.get(targetId) ?? "") : "全体",
            count,
          })),
        };
      });
      return {
        schoolDays: counts.get("授業日") ?? 0,
        dayTypeCounts,
        items,
      };
    },
  }),

  saveSettings: defineAction({
    description: "Saves the school name and current school year.",
    request: z.object({ schoolName: z.string(), schoolYear: z.number().int() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await loadSettings(ctx);
      await db
        .update(schema.settings)
        .set({ schoolName: args.schoolName, schoolYear: args.schoolYear })
        .where(eq(schema.settings.id, 1));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  saveLeaveTypes: defineAction({
    description:
      "Saves the editable list of leave classifications shown for 休暇 events (quick setup step and detail modal). Order is preserved; blank and duplicate entries are dropped. An empty list restores the defaults.",
    request: z.object({
      leaveTypes: z.array(z.string()),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await loadSettings(ctx);
      const seen = new Set<string>();
      const cleaned: string[] = [];
      for (const raw of args.leaveTypes) {
        const v = raw.trim();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        cleaned.push(v);
      }
      const finalList = cleaned.length > 0 ? cleaned : [...DEFAULT_LEAVE_TYPES];
      await db
        .update(schema.settings)
        .set({ leaveTypesJson: JSON.stringify(finalList) })
        .where(eq(schema.settings.id, 1));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  applyPreset: defineAction({
    description:
      "Applies a school-type preset (elementary without bus, elementary with bus, or junior high), creating item definitions, target groups, duty definitions, a period pattern, and default staff/guardian views. Existing definitions are never duplicated or overwritten.",
    request: z.object({
      preset: z.enum(["elem_no_bus", "elem_bus", "junior_high"]),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await loadSettings(ctx);
      await applyPresetData(ctx, args.preset);
      await db
        .update(schema.settings)
        .set({ presetApplied: args.preset })
        .where(eq(schema.settings.id, 1));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  upsertPerson: defineAction({
    description: "Creates or updates a person (staff member) in the master list.",
    request: z.object({
      id: z.number().nullable().default(null),
      name: z.string().min(1),
      role: z.string().default(""),
      sort: z.number().default(0),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id != null) {
        await db
          .update(schema.people)
          .set({ name: args.name, role: args.role, sort: args.sort })
          .where(eq(schema.people.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const [row] = await db
        .insert(schema.people)
        .values({ name: args.name, role: args.role, sort: args.sort })
        .returning({ id: schema.people.id });
      ctx.invalidateQueries();
      return { id: row!.id };
    },
  }),

  deletePerson: defineAction({
    description: "Deletes a person from the master list.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.people).where(eq(schema.people.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  upsertLocation: defineAction({
    description: "Creates or updates a registered location.",
    request: z.object({
      id: z.number().nullable().default(null),
      name: z.string().min(1),
      kind: z.string().default(""),
      sort: z.number().default(0),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id != null) {
        await db
          .update(schema.locations)
          .set({ name: args.name, kind: args.kind, sort: args.sort })
          .where(eq(schema.locations.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const [row] = await db
        .insert(schema.locations)
        .values({ name: args.name, kind: args.kind, sort: args.sort })
        .returning({ id: schema.locations.id });
      ctx.invalidateQueries();
      return { id: row!.id };
    },
  }),

  deleteLocation: defineAction({
    description: "Deletes a registered location.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.locations).where(eq(schema.locations.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  upsertHoliday: defineAction({
    description: "Creates or updates a holiday / school closure day.",
    request: z.object({
      id: z.number().nullable().default(null),
      date: z.string(),
      name: z.string().min(1),
      kind: z.string().default("祝日"),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id != null) {
        await db
          .update(schema.holidays)
          .set({ date: args.date, name: args.name, kind: args.kind })
          .where(eq(schema.holidays.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const [row] = await db
        .insert(schema.holidays)
        .values({ date: args.date, name: args.name, kind: args.kind })
        .returning({ id: schema.holidays.id });
      ctx.invalidateQueries();
      return { id: row!.id };
    },
  }),

  deleteHoliday: defineAction({
    description: "Deletes a holiday entry.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.holidays).where(eq(schema.holidays.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  upsertTargetGroup: defineAction({
    description: "Creates or updates a target group (axis such as grades, clubs, bus routes).",
    request: z.object({
      id: z.number().nullable().default(null),
      key: z.string().min(1),
      name: z.string().min(1),
      sort: z.number().default(0),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id != null) {
        await db
          .update(schema.targetGroups)
          .set({ key: args.key, name: args.name, sort: args.sort })
          .where(eq(schema.targetGroups.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const [row] = await db
        .insert(schema.targetGroups)
        .values({ key: args.key, name: args.name, sort: args.sort })
        .returning({ id: schema.targetGroups.id });
      ctx.invalidateQueries();
      return { id: row!.id };
    },
  }),

  deleteTargetGroup: defineAction({
    description: "Deletes a target group and its targets.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.targets).where(eq(schema.targets.groupId, args.id));
      await db.delete(schema.targetGroups).where(eq(schema.targetGroups.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  upsertTarget: defineAction({
    description: "Creates or updates a target within a target group.",
    request: z.object({
      id: z.number().nullable().default(null),
      groupId: z.number(),
      name: z.string().min(1),
      sort: z.number().default(0),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id != null) {
        await db
          .update(schema.targets)
          .set({ groupId: args.groupId, name: args.name, sort: args.sort })
          .where(eq(schema.targets.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const [row] = await db
        .insert(schema.targets)
        .values({ groupId: args.groupId, name: args.name, sort: args.sort })
        .returning({ id: schema.targets.id });
      ctx.invalidateQueries();
      return { id: row!.id };
    },
  }),

  deleteTarget: defineAction({
    description: "Deletes a target.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.targets).where(eq(schema.targets.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  upsertItemDefinition: defineAction({
    description:
      "Creates or updates an item definition (a customizable column) together with its symbol/code options.",
    request: z.object({
      id: z.number().nullable().default(null),
      key: z.string().min(1),
      name: z.string().min(1),
      valueType: z.string().default("text"),
      targetGroupId: z.number().nullable().default(null),
      granularity: z.string().default("day"),
      defaultVisibility: z.string().default("staff_only"),
      isAggregatable: z.number().default(0),
      sort: z.number().default(0),
      options: z
        .array(
          z.object({
            code: z.string(),
            label: z.string(),
            meaning: z.string().default(""),
            countsAs: z.number().default(0),
          }),
        )
        .default([]),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let id = args.id;
      if (id != null) {
        await db
          .update(schema.itemDefinitions)
          .set({
            key: args.key,
            name: args.name,
            valueType: args.valueType,
            targetGroupId: args.targetGroupId,
            granularity: args.granularity,
            defaultVisibility: args.defaultVisibility,
            isAggregatable: args.isAggregatable,
            sort: args.sort,
          })
          .where(eq(schema.itemDefinitions.id, id));
      } else {
        const [row] = await db
          .insert(schema.itemDefinitions)
          .values({
            key: args.key,
            name: args.name,
            valueType: args.valueType,
            targetGroupId: args.targetGroupId,
            granularity: args.granularity,
            defaultVisibility: args.defaultVisibility,
            isAggregatable: args.isAggregatable,
            sort: args.sort,
          })
          .returning({ id: schema.itemDefinitions.id });
        id = row!.id;
      }
      await db
        .delete(schema.itemOptions)
        .where(eq(schema.itemOptions.itemDefinitionId, id));
      for (let i = 0; i < args.options.length; i++) {
        const o = args.options[i]!;
        await db.insert(schema.itemOptions).values({
          itemDefinitionId: id,
          code: o.code,
          label: o.label,
          meaning: o.meaning,
          countsAs: o.countsAs,
          sort: i,
        });
      }
      ctx.invalidateQueries();
      return { id };
    },
  }),

  deleteItemDefinition: defineAction({
    description: "Deletes an item definition, its options, and its daily values.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.dailyValues).where(eq(schema.dailyValues.itemDefinitionId, args.id));
      await db.delete(schema.itemOptions).where(eq(schema.itemOptions.itemDefinitionId, args.id));
      await db.delete(schema.itemDefinitions).where(eq(schema.itemDefinitions.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  upsertPeriodPattern: defineAction({
    description: "Creates or updates a period pattern (day schedule) with its period rows.",
    request: z.object({
      id: z.number().nullable().default(null),
      code: z.string().min(1),
      name: z.string().min(1),
      sort: z.number().default(0),
      periods: z
        .array(
          z.object({
            periodNo: z.number(),
            label: z.string(),
            startsAt: z.string().nullable().default(null),
            endsAt: z.string().nullable().default(null),
          }),
        )
        .default([]),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let id = args.id;
      if (id != null) {
        await db
          .update(schema.periodPatterns)
          .set({ code: args.code, name: args.name, sort: args.sort })
          .where(eq(schema.periodPatterns.id, id));
      } else {
        const [row] = await db
          .insert(schema.periodPatterns)
          .values({ code: args.code, name: args.name, sort: args.sort })
          .returning({ id: schema.periodPatterns.id });
        id = row!.id;
      }
      await db.delete(schema.periodDefinitions).where(eq(schema.periodDefinitions.patternId, id));
      for (let i = 0; i < args.periods.length; i++) {
        const p = args.periods[i]!;
        await db.insert(schema.periodDefinitions).values({
          patternId: id,
          periodNo: p.periodNo,
          label: p.label,
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          sort: i,
        });
      }
      ctx.invalidateQueries();
      return { id };
    },
  }),

  deletePeriodPattern: defineAction({
    description: "Deletes a period pattern and its periods.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.periodDefinitions).where(eq(schema.periodDefinitions.patternId, args.id));
      await db.delete(schema.periodPatterns).where(eq(schema.periodPatterns.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  upsertDutyDefinition: defineAction({
    description:
      "Creates or updates a duty definition (granularity day / am_pm / week, applicable period including long-vacation-only) and replaces its rotation member order.",
    request: z.object({
      id: z.number().nullable().default(null),
      name: z.string().min(1),
      granularity: z.string().default("day"),
      applicablePeriod: z.string().default("all_year"),
      startsOn: z.string().nullable().default(null),
      endsOn: z.string().nullable().default(null),
      sort: z.number().default(0),
      memberPersonIds: z.array(z.number()).default([]),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let id = args.id;
      if (id != null) {
        await db
          .update(schema.dutyDefinitions)
          .set({
            name: args.name,
            granularity: args.granularity,
            applicablePeriod: args.applicablePeriod,
            startsOn: args.startsOn,
            endsOn: args.endsOn,
            sort: args.sort,
          })
          .where(eq(schema.dutyDefinitions.id, id));
      } else {
        const [row] = await db
          .insert(schema.dutyDefinitions)
          .values({
            name: args.name,
            granularity: args.granularity,
            applicablePeriod: args.applicablePeriod,
            startsOn: args.startsOn,
            endsOn: args.endsOn,
            sort: args.sort,
          })
          .returning({ id: schema.dutyDefinitions.id });
        id = row!.id;
      }
      await db.delete(schema.rotationMembers).where(eq(schema.rotationMembers.dutyDefinitionId, id));
      for (let i = 0; i < args.memberPersonIds.length; i++) {
        await db.insert(schema.rotationMembers).values({
          dutyDefinitionId: id,
          personId: args.memberPersonIds[i]!,
          sort: i,
        });
      }
      ctx.invalidateQueries();
      return { id };
    },
  }),

  deleteDutyDefinition: defineAction({
    description: "Deletes a duty definition, its rotation members, and its assignments.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.dutyAssignments).where(eq(schema.dutyAssignments.dutyDefinitionId, args.id));
      await db.delete(schema.rotationMembers).where(eq(schema.rotationMembers.dutyDefinitionId, args.id));
      await db.delete(schema.dutyDefinitions).where(eq(schema.dutyDefinitions.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  createEvent: defineAction({
    description: "Creates an event object (from cell direct input or the detail modal).",
    request: eventInput,
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [row] = await db
        .insert(schema.events)
        .values({
          title: args.title,
          category: args.category,
          datePrecision: args.datePrecision,
          startsOn: args.startsOn,
          endsOn: args.endsOn ?? args.startsOn,
          startsAt: args.startsAt,
          endsAt: args.endsAt,
          isAllDay: args.isAllDay,
          slot: args.slot,
          periodFrom: args.periodFrom,
          periodTo: args.periodTo,
          locationId: args.locationId,
          locationText: args.locationText,
          leaveType: args.leaveType,
          description: args.description,
          certainty: args.certainty,
          visibility: args.visibility,
          submitTo: args.submitTo,
        })
        .returning({ id: schema.events.id });
      await replaceEventChildren(ctx, row!.id, args);
      ctx.invalidateQueries();
      return { id: row!.id };
    },
  }),

  updateEvent: defineAction({
    description: "Updates an event and its assignees / targets.",
    request: eventInput.extend({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.events)
        .set({
          title: args.title,
          category: args.category,
          datePrecision: args.datePrecision,
          startsOn: args.startsOn,
          endsOn: args.endsOn ?? args.startsOn,
          startsAt: args.startsAt,
          endsAt: args.endsAt,
          isAllDay: args.isAllDay,
          slot: args.slot,
          periodFrom: args.periodFrom,
          periodTo: args.periodTo,
          locationId: args.locationId,
          locationText: args.locationText,
          leaveType: args.leaveType,
          description: args.description,
          certainty: args.certainty,
          visibility: args.visibility,
          submitTo: args.submitTo,
        })
        .where(eq(schema.events.id, args.id));
      await replaceEventChildren(ctx, args.id, args);
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deleteEvent: defineAction({
    description: "Deletes an event and its assignees / targets.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.eventAssignees).where(eq(schema.eventAssignees.eventId, args.id));
      await db.delete(schema.eventTargets).where(eq(schema.eventTargets.eventId, args.id));
      await db.delete(schema.dutyConflictWaivers).where(eq(schema.dutyConflictWaivers.eventId, args.id));
      await db.delete(schema.events).where(eq(schema.events.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  moveEvent: defineAction({
    description:
      "Moves an event to a different date by drag-and-drop. A single-day event lands on the target date; a multi-day (range) event shifts as a whole by the distance between the grabbed day (sourceDate) and the target date, preserving its length. Month-only / undecided events become day events on the target date. When targetCategory is given and differs, the event's category changes to the dropped column's category. Times, assignees and all other fields are preserved.",
    request: z.object({
      id: z.number(),
      targetDate: z.string(),
      sourceDate: z.string().nullable().default(null),
      targetCategory: z.string().nullable().default(null),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const [ev] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, args.id))
        .limit(1);
      if (!ev) throw new Error("移動対象の予定が見つかりません");
      const patch: {
        startsOn: string | null;
        endsOn: string | null;
        datePrecision: string;
        category?: string;
      } = {
        startsOn: ev.startsOn,
        endsOn: ev.endsOn,
        datePrecision: ev.datePrecision,
      };
      if (
        ev.datePrecision === "undecided" ||
        ev.datePrecision === "month" ||
        !ev.startsOn ||
        !ev.endsOn
      ) {
        patch.startsOn = args.targetDate;
        patch.endsOn = args.targetDate;
        patch.datePrecision = "day";
      } else if (ev.startsOn === ev.endsOn) {
        patch.startsOn = args.targetDate;
        patch.endsOn = args.targetDate;
        patch.datePrecision = ev.datePrecision === "range" ? "day" : ev.datePrecision;
      } else {
        const anchor =
          args.sourceDate &&
          args.sourceDate >= ev.startsOn &&
          args.sourceDate <= ev.endsOn
            ? args.sourceDate
            : ev.startsOn;
        const delta = diffDays(anchor, args.targetDate);
        patch.startsOn = addDays(ev.startsOn, delta);
        patch.endsOn = addDays(ev.endsOn, delta);
      }
      if (args.targetCategory && args.targetCategory !== ev.category) {
        patch.category = args.targetCategory;
      }
      await db.update(schema.events).set(patch).where(eq(schema.events.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  moveDailyValues: defineAction({
    description:
      "Moves all daily values for one item definition from one date to another (drag-and-drop of a daily cell such as 下校時刻 or 給食). Every target/slot row for that item on the source date moves; rows already on the destination for the same item/target/slot are replaced.",
    request: z.object({
      itemDefinitionId: z.number(),
      fromDate: z.string(),
      toDate: z.string(),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      if (args.fromDate === args.toDate) return { ok: true as const };
      const db = ctx.db<typeof schema>();
      const src = await db
        .select()
        .from(schema.dailyValues)
        .where(
          and(
            eq(schema.dailyValues.date, args.fromDate),
            eq(schema.dailyValues.itemDefinitionId, args.itemDefinitionId),
          ),
        );
      if (src.length === 0) return { ok: true as const };
      const dest = await db
        .select()
        .from(schema.dailyValues)
        .where(
          and(
            eq(schema.dailyValues.date, args.toDate),
            eq(schema.dailyValues.itemDefinitionId, args.itemDefinitionId),
          ),
        );
      // Destination rows that collide on target+slot are replaced.
      for (const d of dest) {
        const collides = src.some(
          (s) => (s.targetId ?? null) === (d.targetId ?? null) && s.slot === d.slot,
        );
        if (collides) {
          await db.delete(schema.dailyValues).where(eq(schema.dailyValues.id, d.id));
        }
      }
      for (const s of src) {
        await db
          .update(schema.dailyValues)
          .set({ date: args.toDate })
          .where(eq(schema.dailyValues.id, s.id));
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  setDayRecord: defineAction({
    description: "Upserts the day record (day type, period pattern, note) for one date.",
    request: z.object({
      date: z.string(),
      dayType: z.string(),
      periodPatternId: z.number().nullable().default(null),
      note: z.string().default(""),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select()
        .from(schema.dayRecords)
        .where(eq(schema.dayRecords.date, args.date))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(schema.dayRecords)
          .set({
            dayType: args.dayType,
            periodPatternId: args.periodPatternId,
            note: args.note,
          })
          .where(eq(schema.dayRecords.date, args.date));
      } else {
        await db.insert(schema.dayRecords).values({
          date: args.date,
          dayType: args.dayType,
          periodPatternId: args.periodPatternId,
          note: args.note,
        });
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  setDailyValue: defineAction({
    description:
      "Sets (or clears, when all values are null) one daily value cell: date × item × target × slot.",
    request: z.object({
      date: z.string(),
      itemDefinitionId: z.number(),
      targetId: z.number().nullable().default(null),
      slot: z.string().default("all_day"),
      valueText: z.string().nullable().default(null),
      valueNumber: z.number().nullable().default(null),
      valueOptionId: z.number().nullable().default(null),
      valuePersonId: z.number().nullable().default(null),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select()
        .from(schema.dailyValues)
        .where(
          and(
            eq(schema.dailyValues.date, args.date),
            eq(schema.dailyValues.itemDefinitionId, args.itemDefinitionId),
            eq(schema.dailyValues.slot, args.slot),
          ),
        );
      const match = existing.find(
        (r) => (r.targetId ?? null) === (args.targetId ?? null),
      );
      const empty =
        args.valueText == null &&
        args.valueNumber == null &&
        args.valueOptionId == null &&
        args.valuePersonId == null;
      if (match) {
        if (empty) {
          await db.delete(schema.dailyValues).where(eq(schema.dailyValues.id, match.id));
        } else {
          await db
            .update(schema.dailyValues)
            .set({
              valueText: args.valueText,
              valueNumber: args.valueNumber,
              valueOptionId: args.valueOptionId,
              valuePersonId: args.valuePersonId,
            })
            .where(eq(schema.dailyValues.id, match.id));
        }
      } else if (!empty) {
        await db.insert(schema.dailyValues).values({
          date: args.date,
          itemDefinitionId: args.itemDefinitionId,
          targetId: args.targetId,
          slot: args.slot,
          valueText: args.valueText,
          valueNumber: args.valueNumber,
          valueOptionId: args.valueOptionId,
          valuePersonId: args.valuePersonId,
        });
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  setDutyAssignment: defineAction({
    description:
      "Manually sets one duty assignment cell (marks it as a manual override so rotation regeneration never overwrites it). Null person clears the assignment.",
    request: z.object({
      dutyDefinitionId: z.number(),
      date: z.string(),
      slot: z.string().default("all_day"),
      personId: z.number().nullable().default(null),
      freeTextName: z.string().nullable().default(null),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const existing = await db
        .select()
        .from(schema.dutyAssignments)
        .where(
          and(
            eq(schema.dutyAssignments.dutyDefinitionId, args.dutyDefinitionId),
            eq(schema.dutyAssignments.date, args.date),
            eq(schema.dutyAssignments.slot, args.slot),
          ),
        )
        .limit(1);
      if (args.personId == null && !args.freeTextName) {
        if (existing.length > 0) {
          await db.delete(schema.dutyAssignments).where(eq(schema.dutyAssignments.id, existing[0]!.id));
        }
      } else if (existing.length > 0) {
        await db
          .update(schema.dutyAssignments)
          .set({
            personId: args.personId,
            freeTextName: args.freeTextName,
            isManualOverride: 1,
            origin: "manual",
          })
          .where(eq(schema.dutyAssignments.id, existing[0]!.id));
      } else {
        await db.insert(schema.dutyAssignments).values({
          dutyDefinitionId: args.dutyDefinitionId,
          date: args.date,
          slot: args.slot,
          personId: args.personId,
          freeTextName: args.freeTextName,
          isManualOverride: 1,
          origin: "manual",
        });
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  previewRotation: defineAction({
    description:
      "Previews a simple rotation assignment draft for a duty definition over a date range, cycling the rotation member order and optionally skipping weekends and holidays.",
    request: z.object({
      dutyDefinitionId: z.number(),
      from: z.string(),
      to: z.string(),
      startIndex: z.number().int().min(0).default(0),
      skipWeekend: z.boolean().default(true),
      skipHoliday: z.boolean().default(true),
    }),
    response: z.object({
      entries: z.array(
        z.object({
          date: z.string(),
          slot: z.string(),
          personId: z.number().nullable(),
          personName: z.string(),
        }),
      ),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [def] = await db
        .select()
        .from(schema.dutyDefinitions)
        .where(eq(schema.dutyDefinitions.id, args.dutyDefinitionId))
        .limit(1);
      if (!def) return { entries: [] };
      const members = await db
        .select()
        .from(schema.rotationMembers)
        .where(eq(schema.rotationMembers.dutyDefinitionId, def.id))
        .orderBy(asc(schema.rotationMembers.sort));
      if (members.length === 0) return { entries: [] };
      const peopleRows = await db.select().from(schema.people);
      const personName = new Map(peopleRows.map((p) => [p.id, p.name]));
      const holidayRows = await db.select().from(schema.holidays);
      const holidaySet = new Set(holidayRows.map((h) => h.date));
      const entries: {
        date: string;
        slot: string;
        personId: number | null;
        personName: string;
      }[] = [];
      let idx = args.startIndex % members.length;
      const next = () => {
        const m = members[idx % members.length]!;
        idx++;
        return {
          personId: m.personId,
          personName:
            (m.personId != null ? personName.get(m.personId) : undefined) ??
            m.freeTextName ??
            "",
        };
      };
      const skip = (d: string): boolean => {
        const dow = parseDate(d).getDay();
        if (args.skipWeekend && (dow === 0 || dow === 6)) return true;
        if (args.skipHoliday && holidaySet.has(d)) return true;
        if (
          def.applicablePeriod !== "all_year" &&
          ((def.startsOn && d < def.startsOn) || (def.endsOn && d > def.endsOn))
        )
          return true;
        return false;
      };
      if (def.granularity === "week") {
        let cur = mondayOf(args.from);
        while (cur <= args.to) {
          if (!skip(cur)) {
            const n = next();
            entries.push({ date: cur, slot: "week", ...n });
          }
          cur = addDays(cur, 7);
        }
      } else {
        for (const d of eachDate(args.from, args.to)) {
          if (skip(d)) continue;
          if (def.granularity === "am_pm") {
            entries.push({ date: d, slot: "am", ...next() });
            entries.push({ date: d, slot: "pm", ...next() });
          } else {
            entries.push({ date: d, slot: "all_day", ...next() });
          }
        }
      }
      return { entries };
    },
  }),

  applyRotation: defineAction({
    description:
      "Applies rotation draft entries, skipping any slot that already has an assignment (manual overrides and swaps are never overwritten).",
    request: z.object({
      dutyDefinitionId: z.number(),
      entries: z.array(
        z.object({
          date: z.string(),
          slot: z.string(),
          personId: z.number().nullable(),
          personName: z.string().default(""),
        }),
      ),
    }),
    response: z.object({ inserted: z.number(), skipped: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let inserted = 0;
      let skipped = 0;
      for (const e of args.entries) {
        const existing = await db
          .select()
          .from(schema.dutyAssignments)
          .where(
            and(
              eq(schema.dutyAssignments.dutyDefinitionId, args.dutyDefinitionId),
              eq(schema.dutyAssignments.date, e.date),
              eq(schema.dutyAssignments.slot, e.slot),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          skipped++;
          continue;
        }
        await db.insert(schema.dutyAssignments).values({
          dutyDefinitionId: args.dutyDefinitionId,
          date: e.date,
          slot: e.slot,
          personId: e.personId,
          freeTextName: e.personId == null ? e.personName || null : null,
          origin: "auto",
          isManualOverride: 0,
        });
        inserted++;
      }
      ctx.invalidateQueries();
      return { inserted, skipped };
    },
  }),

  applyDutyChange: defineAction({
    description:
      "Applies a duty change as a first-class operation: swap exchanges two assignments' people; substitute replaces one assignment's person for that occasion only. The change is recorded in duty change history.",
    request: z.object({
      kind: z.enum(["swap", "substitute"]),
      assignmentAId: z.number(),
      assignmentBId: z.number().nullable().default(null),
      toPersonId: z.number().nullable().default(null),
      toFreeTextName: z.string().nullable().default(null),
      reason: z.string().default(""),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      const [a] = await db
        .select()
        .from(schema.dutyAssignments)
        .where(eq(schema.dutyAssignments.id, args.assignmentAId))
        .limit(1);
      if (!a) throw new Error("対象の当番割当が見つかりません");
      const peopleRows = await db.select().from(schema.people);
      const personName = new Map(peopleRows.map((p) => [p.id, p.name]));
      const label = (personId: number | null, free: string | null) =>
        (personId != null ? personName.get(personId) : undefined) ?? free ?? "未割当";
      const fromLabel = `${a.date} ${label(a.personId, a.freeTextName)}`;
      if (args.kind === "swap") {
        if (args.assignmentBId == null) throw new Error("交換相手の割当が必要です");
        const [b] = await db
          .select()
          .from(schema.dutyAssignments)
          .where(eq(schema.dutyAssignments.id, args.assignmentBId))
          .limit(1);
        if (!b) throw new Error("交換相手の割当が見つかりません");
        await db
          .update(schema.dutyAssignments)
          .set({ personId: b.personId, freeTextName: b.freeTextName, origin: "swap" })
          .where(eq(schema.dutyAssignments.id, a.id));
        await db
          .update(schema.dutyAssignments)
          .set({ personId: a.personId, freeTextName: a.freeTextName, origin: "swap" })
          .where(eq(schema.dutyAssignments.id, b.id));
        await db.insert(schema.dutyChanges).values({
          dutyDefinitionId: a.dutyDefinitionId,
          kind: "swap",
          assignmentAId: a.id,
          assignmentBId: b.id,
          fromLabel,
          toLabel: `${b.date} ${label(b.personId, b.freeTextName)} と交換`,
          reason: args.reason,
          status: "applied",
        });
      } else {
        await db
          .update(schema.dutyAssignments)
          .set({
            personId: args.toPersonId,
            freeTextName: args.toPersonId == null ? args.toFreeTextName : null,
            origin: "swap",
          })
          .where(eq(schema.dutyAssignments.id, a.id));
        await db.insert(schema.dutyChanges).values({
          dutyDefinitionId: a.dutyDefinitionId,
          kind: "substitute",
          assignmentAId: a.id,
          assignmentBId: null,
          fromLabel,
          toLabel: `${label(args.toPersonId, args.toFreeTextName)} が代行`,
          reason: args.reason,
          status: "applied",
        });
      }
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  waiveConflict: defineAction({
    description:
      "Records that an absence/duty conflict was reviewed and intentionally left as-is, with a reason. The conflict stops being reported for that assignment/event pair.",
    request: z.object({
      assignmentId: z.number(),
      eventId: z.number(),
      reason: z.string().default(""),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.insert(schema.dutyConflictWaivers).values({
        assignmentId: args.assignmentId,
        eventId: args.eventId,
        reason: args.reason,
      });
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  upsertView: defineAction({
    description: "Creates or updates a view definition (layout, audience, column composition, print settings).",
    request: z.object({
      id: z.number().nullable().default(null),
      name: z.string().min(1),
      layout: z.string().default("month_rows"),
      audience: z.string().default("staff"),
      columnsJson: z.string().default("[]"),
      printJson: z.string().default("{}"),
      sort: z.number().default(0),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.id != null) {
        await db
          .update(schema.viewDefinitions)
          .set({
            name: args.name,
            layout: args.layout,
            audience: args.audience,
            columnsJson: args.columnsJson,
            printJson: args.printJson,
            sort: args.sort,
          })
          .where(eq(schema.viewDefinitions.id, args.id));
        ctx.invalidateQueries();
        return { id: args.id };
      }
      const [row] = await db
        .insert(schema.viewDefinitions)
        .values({
          name: args.name,
          layout: args.layout,
          audience: args.audience,
          columnsJson: args.columnsJson,
          printJson: args.printJson,
          sort: args.sort,
        })
        .returning({ id: schema.viewDefinitions.id });
      ctx.invalidateQueries();
      return { id: row!.id };
    },
  }),

  deleteView: defineAction({
    description: "Deletes a view definition.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.viewDefinitions).where(eq(schema.viewDefinitions.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  createPublication: defineAction({
    description:
      "Records a publication version for a monthly view (the version label printed on the PDF/print output).",
    request: z.object({
      viewDefinitionId: z.number().nullable().default(null),
      viewName: z.string().default(""),
      targetMonth: z.string(),
      versionLabel: z.string().min(1),
      note: z.string().default(""),
    }),
    response: idResponse,
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [row] = await db
        .insert(schema.publications)
        .values({
          viewDefinitionId: args.viewDefinitionId,
          viewName: args.viewName,
          targetMonth: args.targetMonth,
          versionLabel: args.versionLabel,
          note: args.note,
        })
        .returning({ id: schema.publications.id });
      ctx.invalidateQueries();
      return { id: row!.id };
    },
  }),

  updatePublication: defineAction({
    description:
      "Edits a recorded publication version (its version label and note). The target period and view name stay as recorded.",
    request: z.object({
      id: z.number(),
      versionLabel: z.string().min(1),
      note: z.string().default(""),
    }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .update(schema.publications)
        .set({ versionLabel: args.versionLabel, note: args.note })
        .where(eq(schema.publications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),

  deletePublication: defineAction({
    description: "Deletes one publication history record.",
    request: z.object({ id: z.number() }),
    response: okResponse,
    async handler(ctx, args): Promise<z.infer<typeof okResponse>> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.publications)
        .where(eq(schema.publications.id, args.id));
      ctx.invalidateQueries();
      return { ok: true as const };
    },
  }),
} satisfies ActionsModule;
